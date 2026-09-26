/**
 * @file Python Parser Tests
 * @description Unit tests for Python Pydantic/FastAPI parser.
 * Per spec Phase 6: Scanner Tests (T103)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PythonParser } from "../../../src/parsers/python-parser";

describe("PythonParser", () => {
  let parser: PythonParser;

  beforeEach(() => {
    parser = new PythonParser();
  });

  describe("parseSource - Pydantic Models", () => {
    it("should parse a basic Pydantic model", () => {
      const source = `
from pydantic import BaseModel

class User(BaseModel):
    id: int
    name: str
    email: str
`;

      const result = parser.parseSource(source, "models.py");

      expect(result.errors).toHaveLength(0);
      expect(result.models).toHaveLength(1);

      const user = result.models[0];
      expect(user.name).toBe("User");
      expect(user.baseClass).toBe("BaseModel");
      expect(user.fields).toHaveLength(3);

      const idField = user.fields.find((f) => f.name === "id");
      expect(idField).toBeDefined();
      expect(idField?.type).toBe("int");
      expect(idField?.required).toBe(true);
    });

    it("should parse optional fields with defaults", () => {
      const source = `
from pydantic import BaseModel
from typing import Optional

class Product(BaseModel):
    name: str
    price: float
    description: Optional[str] = None
    quantity: int = 0
    active: bool = True
`;

      const result = parser.parseSource(source, "product.py");

      expect(result.models).toHaveLength(1);
      const product = result.models[0];

      const nameField = product.fields.find((f) => f.name === "name");
      expect(nameField?.required).toBe(true);

      const descField = product.fields.find((f) => f.name === "description");
      expect(descField?.required).toBe(false);
      expect(descField?.default).toBe("None");

      const quantityField = product.fields.find((f) => f.name === "quantity");
      expect(quantityField?.required).toBe(false);
      expect(quantityField?.default).toBe("0");
    });

    it("should parse Field() with validation", () => {
      const source = `
from pydantic import BaseModel, Field

class Person(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    age: int = Field(default=0, ge=0, le=150)
    email: str = Field(..., pattern=r'^[\\w.-]+@[\\w.-]+\\.\\w+$')
`;

      const result = parser.parseSource(source, "person.py");

      expect(result.models).toHaveLength(1);
      const person = result.models[0];

      const nameField = person.fields.find((f) => f.name === "name");
      expect(nameField?.required).toBe(true);
      expect(nameField?.validation).toBeDefined();
      expect(nameField?.validation).toContain("min_length=1");

      const ageField = person.fields.find((f) => f.name === "age");
      expect(ageField?.default).toBe("0");
    });

    it("should parse model with docstring", () => {
      const source = `
from pydantic import BaseModel

class Order(BaseModel):
    """
    Represents a customer order.
    
    Attributes:
        order_id: Unique order identifier
        items: List of order items
        total: Total order amount
    """
    order_id: str
    items: list[str]
    total: float
`;

      const result = parser.parseSource(source, "order.py");

      expect(result.models).toHaveLength(1);
      const order = result.models[0];
      expect(order.description).toContain("customer order");
    });

    it("should parse nested models", () => {
      const source = `
from pydantic import BaseModel

class Address(BaseModel):
    street: str
    city: str
    country: str

class Customer(BaseModel):
    name: str
    address: Address
    shipping_address: Optional[Address] = None
`;

      const result = parser.parseSource(source, "customer.py");

      expect(result.models).toHaveLength(2);
      
      const customer = result.models.find((m) => m.name === "Customer");
      expect(customer).toBeDefined();
      
      const addressField = customer?.fields.find((f) => f.name === "address");
      expect(addressField?.type).toBe("Address");
    });

    it("should detect validators", () => {
      const source = `
from pydantic import BaseModel, field_validator

class User(BaseModel):
    email: str
    password: str

    @field_validator('email')
    @classmethod
    def email_must_be_valid(cls, v):
        if '@' not in v:
            raise ValueError('Invalid email')
        return v

    @field_validator('password')
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError('Password too short')
        return v
`;

      const result = parser.parseSource(source, "user.py");

      expect(result.models).toHaveLength(1);
      const user = result.models[0];
      expect(user.validators).toBeDefined();
      expect(user.validators).toContain("email_must_be_valid");
      expect(user.validators).toContain("password_strength");
    });
  });

  describe("parseSource - FastAPI Routes", () => {
    it("should parse basic FastAPI routes", () => {
      const source = `
from fastapi import FastAPI

app = FastAPI()

@app.get("/users")
def get_users():
    return []

@app.post("/users")
def create_user(user: User):
    return user
`;

      const result = parser.parseSource(source, "main.py");

      expect(result.routes).toHaveLength(2);

      const getRoute = result.routes.find((r) => r.method === "GET");
      expect(getRoute).toBeDefined();
      expect(getRoute?.path).toBe("/users");
      expect(getRoute?.functionName).toBe("get_users");

      const postRoute = result.routes.find((r) => r.method === "POST");
      expect(postRoute).toBeDefined();
      expect(postRoute?.path).toBe("/users");
      expect(postRoute?.functionName).toBe("create_user");
    });

    it("should parse route parameters", () => {
      const source = `
from fastapi import FastAPI, Path, Query

app = FastAPI()

@app.get("/users/{user_id}")
def get_user(
    user_id: int = Path(..., description="The user ID"),
    include_posts: bool = Query(False, description="Include posts")
):
    return {"id": user_id}
`;

      const result = parser.parseSource(source, "routes.py");

      expect(result.routes).toHaveLength(1);
      const route = result.routes[0];
      expect(route.path).toBe("/users/{user_id}");
      
      const pathParam = route.parameters.find((p) => p.name === "user_id");
      expect(pathParam).toBeDefined();
      expect(pathParam?.location).toBe("path");
      expect(pathParam?.type).toBe("int");
      expect(pathParam?.required).toBe(true);

      const queryParam = route.parameters.find((p) => p.name === "include_posts");
      expect(queryParam).toBeDefined();
      expect(queryParam?.location).toBe("query");
      expect(queryParam?.default).toBe("False");
    });

    it("should parse response models", () => {
      const source = `
from fastapi import FastAPI
from pydantic import BaseModel

class UserResponse(BaseModel):
    id: int
    name: str

app = FastAPI()

@app.get("/users/{user_id}", response_model=UserResponse)
def get_user(user_id: int):
    return UserResponse(id=user_id, name="John")
`;

      const result = parser.parseSource(source, "api.py");

      expect(result.routes).toHaveLength(1);
      const route = result.routes[0];
      expect(route.responseModel).toBe("UserResponse");
    });

    it("should parse APIRouter routes", () => {
      const source = `
from fastapi import APIRouter

router = APIRouter(prefix="/api/v1", tags=["users"])

@router.get("/users")
def list_users():
    return []

@router.get("/users/{id}")
def get_user(id: int):
    return {"id": id}

@router.delete("/users/{id}")
def delete_user(id: int):
    return {"deleted": id}
`;

      const result = parser.parseSource(source, "users_router.py");

      expect(result.routes).toHaveLength(3);
      
      const methods = result.routes.map((r) => r.method);
      expect(methods).toContain("GET");
      expect(methods).toContain("DELETE");
    });

    it("should parse deprecated routes", () => {
      const source = `
from fastapi import FastAPI

app = FastAPI()

@app.get("/old-endpoint", deprecated=True)
def old_endpoint():
    return {"message": "This is deprecated"}
`;

      const result = parser.parseSource(source, "deprecated.py");

      expect(result.routes).toHaveLength(1);
      expect(result.routes[0].deprecated).toBe(true);
    });

    it("should parse route tags", () => {
      const source = `
from fastapi import FastAPI

app = FastAPI()

@app.get("/users", tags=["users", "public"])
def get_users():
    return []

@app.post("/admin/users", tags=["admin"])
def admin_create_user():
    return {}
`;

      const result = parser.parseSource(source, "tagged.py");

      expect(result.routes).toHaveLength(2);
      
      const publicRoute = result.routes.find((r) => r.path === "/users");
      expect(publicRoute?.tags).toContain("users");
      expect(publicRoute?.tags).toContain("public");
    });

    it("should parse async routes", () => {
      const source = `
from fastapi import FastAPI

app = FastAPI()

@app.get("/async-data")
async def get_async_data():
    return {"async": True}
`;

      const result = parser.parseSource(source, "async_routes.py");

      expect(result.routes).toHaveLength(1);
      expect(result.routes[0].functionName).toBe("get_async_data");
    });

    it("should parse body parameters", () => {
      const source = `
from fastapi import FastAPI, Body
from pydantic import BaseModel

class CreateUser(BaseModel):
    name: str
    email: str

app = FastAPI()

@app.post("/users")
def create_user(user: CreateUser):
    return user
`;

      const result = parser.parseSource(source, "body.py");

      expect(result.routes).toHaveLength(1);
      const route = result.routes[0];
      
      const bodyParam = route.parameters.find((p) => p.name === "user");
      expect(bodyParam).toBeDefined();
      expect(bodyParam?.location).toBe("body");
      expect(bodyParam?.type).toBe("CreateUser");
    });
  });

  describe("parseFiles", () => {
    it("should handle non-existent files gracefully", () => {
      const result = parser.parseFiles(["/non/existent/file.py"]);

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
