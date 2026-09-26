/**
 * @file Python Parser
 * @module @coreflow/scanner/parsers/python-parser
 * @description
 * Parses Python files to extract Pydantic models and FastAPI routes.
 * Uses regex-based parsing since we're in a Node.js environment.
 * Per spec Phase 6: Scanner - AST Parsers (T093)
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

export interface PydanticFieldInfo {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description?: string;
  alias?: string;
  validation?: string[];
}

export interface PydanticModelInfo {
  name: string;
  filePath: string;
  baseClass: string;
  fields: PydanticFieldInfo[];
  description?: string;
  validators?: string[];
  configOptions?: Record<string, string>;
}

export interface FastAPIParameterInfo {
  name: string;
  type: string;
  location: "path" | "query" | "body" | "header" | "cookie";
  required: boolean;
  default?: string;
  description?: string;
}

export interface FastAPIRouteInfo {
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
  functionName: string;
  filePath: string;
  description?: string;
  parameters: FastAPIParameterInfo[];
  responseModel?: string;
  tags?: string[];
  deprecated?: boolean;
}

export interface PythonParseResult {
  models: PydanticModelInfo[];
  routes: FastAPIRouteInfo[];
  errors: string[];
}

// ============================================================================
// Parser Implementation
// ============================================================================

/**
 * Python parser for Pydantic models and FastAPI routes
 * Uses regex-based parsing (no Python AST in Node.js)
 */
export class PythonParser {
  /**
   * Parse a single Python file
   */
  parseFile(filePath: string): PythonParseResult {
    const result: PythonParseResult = {
      models: [],
      routes: [],
      errors: [],
    };

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      
      // Extract Pydantic models
      result.models.push(...this.extractPydanticModels(content, filePath));
      
      // Extract FastAPI routes
      result.routes.push(...this.extractFastAPIRoutes(content, filePath));
      
    } catch (error) {
      result.errors.push(`Error parsing ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Parse multiple files
   */
  parseFiles(filePaths: string[]): PythonParseResult {
    const combined: PythonParseResult = {
      models: [],
      routes: [],
      errors: [],
    };

    for (const filePath of filePaths) {
      const result = this.parseFile(filePath);
      combined.models.push(...result.models);
      combined.routes.push(...result.routes);
      combined.errors.push(...result.errors);
    }

    return combined;
  }

  /**
   * Parse from source code string
   */
  parseSource(source: string, fileName: string = "temp.py"): PythonParseResult {
    const result: PythonParseResult = {
      models: [],
      routes: [],
      errors: [],
    };

    try {
      result.models.push(...this.extractPydanticModels(source, fileName));
      result.routes.push(...this.extractFastAPIRoutes(source, fileName));
    } catch (error) {
      result.errors.push(`Error parsing source: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  // ============================================================================
  // Pydantic Model Extraction
  // ============================================================================

  private extractPydanticModels(content: string, filePath: string): PydanticModelInfo[] {
    const models: PydanticModelInfo[] = [];

    // Match class definitions that inherit from BaseModel or similar
    const classPattern = /class\s+(\w+)\s*\(\s*(BaseModel|BaseSettings|BaseConfig)(?:\s*,\s*[^)]+)?\s*\)\s*:/g;
    let classMatch;

    while ((classMatch = classPattern.exec(content)) !== null) {
      const className = classMatch[1] || "";
      const baseClass = classMatch[2] || "BaseModel";
      const classStart = classMatch.index + classMatch[0].length;

      // Get docstring
      const docstring = this.extractDocstring(content, classStart);

      // Get class body
      const classBody = this.extractClassBody(content, classStart);

      // Extract fields
      const fields = this.extractPydanticFields(classBody);

      // Extract validators
      const validators = this.extractValidators(classBody);

      // Extract Config options
      const configOptions = this.extractConfigOptions(classBody);

      models.push({
        name: className,
        filePath,
        baseClass,
        fields,
        description: docstring,
        validators: validators.length > 0 ? validators : undefined,
        configOptions: Object.keys(configOptions).length > 0 ? configOptions : undefined,
      });
    }

    return models;
  }

  private extractDocstring(content: string, startPos: number): string | undefined {
    // Look for triple-quoted string after class definition
    const afterClass = content.slice(startPos, startPos + 500);
    const docMatch = afterClass.match(/^\s*"""([^"]*(?:""[^"]*)*?)"""/);
    if (docMatch) {
      return docMatch[1]?.trim();
    }
    const singleDocMatch = afterClass.match(/^\s*'''([^']*(?:''[^']*)*?)'''/);
    if (singleDocMatch) {
      return singleDocMatch[1]?.trim();
    }
    return undefined;
  }

  private extractClassBody(content: string, startPos: number): string {
    // Simple indentation-based extraction
    const lines = content.slice(startPos).split("\n");
    const bodyLines: string[] = [];
    let foundContent = false;

    for (const line of lines) {
      // Skip empty lines at the start
      if (!foundContent && line.trim() === "") continue;
      
      // Check if we're still in the class (indented)
      if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t") && foundContent) {
        break;
      }

      if (line.trim()) {
        foundContent = true;
      }
      bodyLines.push(line);
    }

    return bodyLines.join("\n");
  }

  private extractPydanticFields(classBody: string): PydanticFieldInfo[] {
    const fields: PydanticFieldInfo[] = [];

    // Match field definitions like: field_name: Type = Field(...)
    // or simple: field_name: Type = default
    // or: field_name: Type
    const fieldPattern = /^\s+(\w+)\s*:\s*([^\n=]+)(?:\s*=\s*(.+))?$/gm;
    let fieldMatch;

    while ((fieldMatch = fieldPattern.exec(classBody)) !== null) {
      const name = fieldMatch[1] || "";
      let type = (fieldMatch[2] || "").trim();
      const defaultExpr = fieldMatch[3]?.trim();

      // Skip methods and class-level definitions
      if (name.startsWith("_") || type.includes("(")) continue;
      if (name === "Config" || name === "model_config") continue;

      // Parse Optional/Union types
      const isOptional = type.includes("Optional") || type.includes("None");
      
      // Clean up type
      type = type.replace(/Optional\[([^\]]+)\]/, "$1").trim();

      // Parse Field() if present
      let fieldInfo: Partial<PydanticFieldInfo> = {};
      let isFieldRequired = false;
      
      if (defaultExpr?.startsWith("Field(")) {
        fieldInfo = this.parseFieldCall(defaultExpr);
        // Field(...) means required
        isFieldRequired = defaultExpr.includes("...") && !fieldInfo.default;
      }
      
      // Determine required: no default, no Optional, and either no expression or Field(...)
      const hasDefault = fieldInfo.default || (defaultExpr && !defaultExpr.startsWith("Field("));
      const required = !isOptional && (!hasDefault || isFieldRequired);

      fields.push({
        name,
        type,
        required,
        default: fieldInfo.default || (defaultExpr && !defaultExpr.startsWith("Field(") ? defaultExpr : undefined),
        description: fieldInfo.description,
        alias: fieldInfo.alias,
        validation: fieldInfo.validation,
      });
    }

    return fields;
  }

  private parseFieldCall(fieldExpr: string): Partial<PydanticFieldInfo> {
    const result: Partial<PydanticFieldInfo> = {};
    
    // Check for ... (required) - Ellipsis means required, no default
    const hasEllipsis = fieldExpr.match(/Field\(\s*\.\.\./) || fieldExpr.includes("Field(...)");
    
    // Extract default value
    const defaultMatch = fieldExpr.match(/(?:^Field\(|,\s*)default\s*=\s*([^,)]+)/);
    if (defaultMatch) {
      result.default = defaultMatch[1]?.trim();
    } else if (!hasEllipsis) {
      // If no explicit default and not ..., check first positional arg
      const firstArgMatch = fieldExpr.match(/Field\(\s*([^,)=]+)/);
      if (firstArgMatch && firstArgMatch[1]?.trim() !== "...") {
        result.default = firstArgMatch[1]?.trim();
      }
    }

    // Extract description
    const descMatch = fieldExpr.match(/description\s*=\s*["']([^"']+)["']/);
    if (descMatch) {
      result.description = descMatch[1];
    }

    // Extract alias
    const aliasMatch = fieldExpr.match(/alias\s*=\s*["']([^"']+)["']/);
    if (aliasMatch) {
      result.alias = aliasMatch[1];
    }

    // Extract validation constraints
    const validation: string[] = [];
    
    const minLengthMatch = fieldExpr.match(/min_length\s*=\s*(\d+)/);
    if (minLengthMatch) validation.push(`min_length=${minLengthMatch[1]}`);

    const maxLengthMatch = fieldExpr.match(/max_length\s*=\s*(\d+)/);
    if (maxLengthMatch) validation.push(`max_length=${maxLengthMatch[1]}`);

    const geMatch = fieldExpr.match(/ge\s*=\s*([^\s,)]+)/);
    if (geMatch) validation.push(`ge=${geMatch[1]}`);

    const leMatch = fieldExpr.match(/le\s*=\s*([^\s,)]+)/);
    if (leMatch) validation.push(`le=${leMatch[1]}`);

    const patternMatch = fieldExpr.match(/pattern\s*=\s*["']([^"']+)["']/);
    if (patternMatch) validation.push(`pattern=${patternMatch[1]}`);

    if (validation.length > 0) {
      result.validation = validation;
    }

    return result;
  }

  private extractValidators(classBody: string): string[] {
    const validators: string[] = [];
    
    // Match @validator('field')\ndef validator_name(...)
    const validatorPattern = /@validator\s*\(\s*["'][^"']+["']\s*\)[\s\S]*?\n\s*def\s+(\w+)\s*\(/g;
    let match;
    while ((match = validatorPattern.exec(classBody)) !== null) {
      validators.push(match[1] || "");
    }

    // Match @field_validator('field')\n@classmethod\ndef validator_name(...) (Pydantic v2)
    const fieldValidatorPattern = /@field_validator\s*\(\s*["'][^"']+["']\s*\)[\s\S]*?def\s+(\w+)\s*\(/g;
    while ((match = fieldValidatorPattern.exec(classBody)) !== null) {
      const validatorName = match[1];
      if (validatorName && !validators.includes(validatorName)) {
        validators.push(validatorName);
      }
    }

    return validators;
  }

  private extractConfigOptions(classBody: string): Record<string, string> {
    const config: Record<string, string> = {};

    // Look for class Config:
    const configMatch = classBody.match(/class\s+Config\s*:\s*\n((?:\s+.+\n?)+)/);
    if (configMatch) {
      const configBody = configMatch[1] || "";
      const optionPattern = /(\w+)\s*=\s*(.+)/g;
      let optMatch;
      while ((optMatch = optionPattern.exec(configBody)) !== null) {
        config[optMatch[1] || ""] = (optMatch[2] || "").trim();
      }
    }

    // Look for model_config = ConfigDict(...)  (Pydantic v2)
    const modelConfigMatch = classBody.match(/model_config\s*=\s*ConfigDict\(([^)]+)\)/);
    if (modelConfigMatch) {
      const configStr = modelConfigMatch[1] || "";
      const optionPattern = /(\w+)\s*=\s*([^,]+)/g;
      let optMatch;
      while ((optMatch = optionPattern.exec(configStr)) !== null) {
        config[optMatch[1] || ""] = (optMatch[2] || "").trim();
      }
    }

    return config;
  }

  // ============================================================================
  // FastAPI Route Extraction
  // ============================================================================

  private extractFastAPIRoutes(content: string, filePath: string): FastAPIRouteInfo[] {
    const routes: FastAPIRouteInfo[] = [];

    // Match FastAPI route decorators
    const methods = ["get", "post", "put", "patch", "delete", "options", "head"];
    const routerPrefixes = ["app", "router", "api_router"];

    for (const prefix of routerPrefixes) {
      for (const method of methods) {
        // Pattern to match decorator and function definition, capturing until closing paren
        // Using [\s\S] instead of . to match newlines
        const pattern = new RegExp(
          `@${prefix}\\.${method}\\s*\\(\\s*["']([^"']+)["'](?:,\\s*([^)]+))?\\)\\s*\\n(?:@\\w+[^\\n]*\\n)*\\s*(?:async\\s+)?def\\s+(\\w+)\\s*\\(([\\s\\S]*?)\\)\\s*(?:->\\s*[^:]+)?:`,
          "g"
        );

        let match;
        while ((match = pattern.exec(content)) !== null) {
          const routePath = match[1] || "";
          const decoratorArgs = match[2] || "";
          const functionName = match[3] || "";
          const funcParams = match[4] || "";

          // Extract route metadata from decorator args
          const tags = this.extractTags(decoratorArgs);
          const responseModel = this.extractResponseModel(decoratorArgs);
          const deprecated = decoratorArgs.includes("deprecated=True");

          // Get function docstring
          const funcStart = match.index + match[0].length;
          const description = this.extractDocstring(content, funcStart);

          // Extract parameters from function signature
          const parameters = this.extractRouteParameters(funcParams, routePath);

          routes.push({
            path: routePath,
            method: method.toUpperCase() as FastAPIRouteInfo["method"],
            functionName,
            filePath,
            description,
            parameters,
            responseModel,
            tags: tags.length > 0 ? tags : undefined,
            deprecated: deprecated || undefined,
          });
        }
      }
    }

    return routes;
  }

  private extractTags(decoratorArgs: string): string[] {
    const tagsMatch = decoratorArgs.match(/tags\s*=\s*\[([^\]]+)\]/);
    if (tagsMatch) {
      return tagsMatch[1]
        ?.match(/["']([^"']+)["']/g)
        ?.map((t) => t.replace(/["']/g, "")) || [];
    }
    return [];
  }

  private extractResponseModel(decoratorArgs: string): string | undefined {
    const match = decoratorArgs.match(/response_model\s*=\s*(\w+)/);
    return match ? match[1] : undefined;
  }

  private extractRouteParameters(
    funcParams: string,
    routePath: string
  ): FastAPIParameterInfo[] {
    const params: FastAPIParameterInfo[] = [];

    // Extract path parameters from route path
    const pathParams = routePath.match(/\{(\w+)\}/g)?.map((p) => p.replace(/[{}]/g, "")) || [];

    // Parse function parameters
    const paramPattern = /(\w+)\s*:\s*([^=,]+)(?:\s*=\s*([^,]+))?/g;
    let match;

    while ((match = paramPattern.exec(funcParams)) !== null) {
      const name = match[1] || "";
      const typeAnnotation = (match[2] || "").trim();
      const defaultValue = match[3]?.trim();

      // Skip self, request, etc.
      if (["self", "request", "response", "db", "session", "background_tasks"].includes(name)) {
        continue;
      }

      // Determine parameter location
      let location: FastAPIParameterInfo["location"] = "query";
      const isPathParam = pathParams.includes(name);
      
      if (isPathParam) {
        location = "path";
      } else if (typeAnnotation.includes("Body") || this.isComplexType(typeAnnotation)) {
        location = "body";
      } else if (typeAnnotation.includes("Header")) {
        location = "header";
      } else if (typeAnnotation.includes("Cookie")) {
        location = "cookie";
      }

      // Determine if required
      // Path(...), Query(...), Body(...) with ... means required
      const hasEllipsisDefault = defaultValue?.includes("...");
      const hasNoDefault = !defaultValue;
      const isOptional = typeAnnotation.includes("Optional") || typeAnnotation.includes("None");
      
      // Required if: path param with ellipsis, no default at all, or ellipsis in Path/Query/Body
      const required = !isOptional && (hasNoDefault || hasEllipsisDefault || isPathParam);

      // Clean up type
      let type = typeAnnotation
        .replace(/Optional\[([^\]]+)\]/, "$1")
        .replace(/Query\([^)]*\)/, "str")
        .replace(/Path\([^)]*\)/, "str")
        .replace(/Body\([^)]*\)/, "dict")
        .replace(/Header\([^)]*\)/, "str")
        .replace(/Cookie\([^)]*\)/, "str")
        .trim();
      
      // Extract actual default value from Query(value) or similar
      let extractedDefault: string | undefined = undefined;
      if (defaultValue && !hasEllipsisDefault) {
        const valueMatch = defaultValue.match(/(?:Query|Path|Body|Header|Cookie)\(([^,)]+)/);
        if (valueMatch && valueMatch[1]?.trim() !== "...") {
          extractedDefault = valueMatch[1]?.trim();
        } else if (!defaultValue.includes("(")) {
          extractedDefault = defaultValue;
        }
      }

      params.push({
        name,
        type,
        location,
        required,
        default: extractedDefault,
      });
    }

    return params;
  }

  private isComplexType(typeAnnotation: string): boolean {
    // Check if it's a Pydantic model (typically PascalCase and not a built-in)
    const builtins = ["str", "int", "float", "bool", "list", "dict", "set", "tuple", "Any", "Optional"];
    const cleanType = typeAnnotation.replace(/Optional\[([^\]]+)\]/, "$1").trim();
    
    if (builtins.some((b) => cleanType.toLowerCase() === b.toLowerCase())) {
      return false;
    }

    // PascalCase heuristic for model names
    return /^[A-Z][a-zA-Z0-9]*$/.test(cleanType);
  }
}

// ============================================================================
// Export
// ============================================================================

export const pythonParser = new PythonParser();
