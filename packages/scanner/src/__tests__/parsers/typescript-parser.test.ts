/**
 * @file TypeScript Parser Tests
 * @description Unit tests for TypeScript/React component parser.
 * Per spec Phase 6: Scanner Tests (T101)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TypeScriptParser } from "../../../src/parsers/typescript-parser";

describe("TypeScriptParser", () => {
  let parser: TypeScriptParser;

  beforeEach(() => {
    parser = new TypeScriptParser();
  });

  describe("parseSource", () => {
    it("should parse a function component", () => {
      const source = `
        import React from 'react';

        interface ButtonProps {
          label: string;
          onClick?: () => void;
          disabled?: boolean;
        }

        export function Button({ label, onClick, disabled = false }: ButtonProps) {
          return (
            <button onClick={onClick} disabled={disabled}>
              {label}
            </button>
          );
        }
      `;

      const result = parser.parseSource(source, "Button.tsx");

      expect(result.errors).toHaveLength(0);
      expect(result.components).toHaveLength(1);

      const button = result.components[0];
      expect(button.name).toBe("Button");
      expect(button.type).toBe("function");
      expect(button.props).toHaveLength(3);

      const labelProp = button.props.find((p) => p.name === "label");
      expect(labelProp).toBeDefined();
      expect(labelProp?.type).toBe("string");
      expect(labelProp?.required).toBe(true);

      const disabledProp = button.props.find((p) => p.name === "disabled");
      expect(disabledProp).toBeDefined();
      expect(disabledProp?.required).toBe(false);
      expect(disabledProp?.defaultValue).toBe("false");
    });

    it("should parse an arrow function component", () => {
      const source = `
        interface CardProps {
          title: string;
          children: React.ReactNode;
        }

        export const Card: React.FC<CardProps> = ({ title, children }) => (
          <div className="card">
            <h2>{title}</h2>
            {children}
          </div>
        );
      `;

      const result = parser.parseSource(source, "Card.tsx");

      expect(result.components).toHaveLength(1);
      const card = result.components[0];
      expect(card.name).toBe("Card");
      expect(card.type).toBe("arrow");
      expect(card.hasChildren).toBe(true);
    });

    it("should parse a forwardRef component", () => {
      const source = `
        import React, { forwardRef } from 'react';

        interface InputProps {
          value: string;
          onChange: (value: string) => void;
          placeholder?: string;
        }

        export const Input = forwardRef<HTMLInputElement, InputProps>(
          ({ value, onChange, placeholder }, ref) => (
            <input
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
            />
          )
        );
      `;

      const result = parser.parseSource(source, "Input.tsx");

      expect(result.components).toHaveLength(1);
      const input = result.components[0];
      expect(input.name).toBe("Input");
      expect(input.type).toBe("forwardRef");
    });

    it("should extract JSDoc documentation", () => {
      const source = `
        /**
         * A reusable alert component for displaying messages.
         * @param type - The type of alert (success, warning, error)
         * @param message - The message to display
         */
        interface AlertProps {
          /** The type of alert */
          type: 'success' | 'warning' | 'error';
          /** The message to display */
          message: string;
        }

        export function Alert({ type, message }: AlertProps) {
          return <div className={\`alert alert-\${type}\`}>{message}</div>;
        }
      `;

      const result = parser.parseSource(source, "Alert.tsx");

      expect(result.components).toHaveLength(1);
      const alert = result.components[0];
      expect(alert.description).toContain("reusable alert component");
    });

    it("should detect hooks usage", () => {
      const source = `
        import React, { useState, useEffect, useMemo } from 'react';

        interface CounterProps {
          initialValue: number;
        }

        export function Counter({ initialValue }: CounterProps) {
          const [count, setCount] = useState(initialValue);
          
          useEffect(() => {
            document.title = \`Count: \${count}\`;
          }, [count]);

          const doubled = useMemo(() => count * 2, [count]);

          return (
            <div>
              <span>{count} (doubled: {doubled})</span>
              <button onClick={() => setCount(c => c + 1)}>+</button>
            </div>
          );
        }
      `;

      const result = parser.parseSource(source, "Counter.tsx");

      expect(result.components).toHaveLength(1);
      const counter = result.components[0];
      expect(counter.usesHooks).toContain("useState");
      expect(counter.usesHooks).toContain("useEffect");
      expect(counter.usesHooks).toContain("useMemo");
    });

    it("should extract interface definitions", () => {
      const source = `
        export interface User {
          id: string;
          name: string;
          email: string;
          role: 'admin' | 'user';
        }

        export interface UserListProps {
          users: User[];
          onSelect: (user: User) => void;
        }
      `;

      const result = parser.parseSource(source, "types.ts");

      expect(result.interfaces).toHaveLength(2);
      
      const userInterface = result.interfaces.find((i) => i.name === "User");
      expect(userInterface).toBeDefined();
      expect(userInterface?.properties).toHaveLength(4);

      const userListInterface = result.interfaces.find((i) => i.name === "UserListProps");
      expect(userListInterface).toBeDefined();
    });

    it("should extract TODO and FIXME comments", () => {
      const source = `
        /**
         * Modal component
         * TODO: Add animation support
         * FIXME: Close button doesn't work on mobile
         */
        interface ModalProps {
          isOpen: boolean;
          onClose: () => void;
        }

        export function Modal({ isOpen, onClose }: ModalProps) {
          // TODO: Implement focus trap
          if (!isOpen) return null;
          return (
            <div className="modal">
              {/* FIXME: Accessibility issues */}
              <button onClick={onClose}>Close</button>
            </div>
          );
        }
      `;

      const result = parser.parseSource(source, "Modal.tsx");

      expect(result.components).toHaveLength(1);
      const modal = result.components[0];
      expect(modal.todos.length).toBeGreaterThan(0);
      expect(modal.fixmes.length).toBeGreaterThan(0);
    });

    it("should handle default exports", () => {
      const source = `
        interface PageProps {
          title: string;
        }

        function Page({ title }: PageProps) {
          return <h1>{title}</h1>;
        }

        export default Page;
      `;

      const result = parser.parseSource(source, "Page.tsx");

      expect(result.components).toHaveLength(1);
      const page = result.components[0];
      expect(page.exportType).toBe("default");
    });

    it("should parse class components", () => {
      const source = `
        import React, { Component } from 'react';

        interface ErrorBoundaryProps {
          children: React.ReactNode;
          fallback: React.ReactNode;
        }

        interface ErrorBoundaryState {
          hasError: boolean;
        }

        export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
          state = { hasError: false };

          static getDerivedStateFromError() {
            return { hasError: true };
          }

          render() {
            if (this.state.hasError) {
              return this.props.fallback;
            }
            return this.props.children;
          }
        }
      `;

      const result = parser.parseSource(source, "ErrorBoundary.tsx");

      expect(result.components).toHaveLength(1);
      const errorBoundary = result.components[0];
      expect(errorBoundary.name).toBe("ErrorBoundary");
      expect(errorBoundary.type).toBe("class");
    });

    it("should handle complex prop types", () => {
      const source = `
        type Size = 'sm' | 'md' | 'lg';
        
        interface ComplexProps {
          items: Array<{ id: string; label: string }>;
          config: {
            enabled: boolean;
            options?: string[];
          };
          size?: Size;
          renderItem?: (item: any) => React.ReactNode;
        }

        export function ComplexComponent({
          items,
          config,
          size = 'md',
          renderItem
        }: ComplexProps) {
          return <div>{items.length}</div>;
        }
      `;

      const result = parser.parseSource(source, "ComplexComponent.tsx");

      expect(result.components).toHaveLength(1);
      const component = result.components[0];
      expect(component.props.length).toBeGreaterThanOrEqual(4);

      const sizeProp = component.props.find((p) => p.name === "size");
      expect(sizeProp?.defaultValue).toBe("'md'");
    });
  });

  describe("parseFiles", () => {
    it("should handle non-existent files gracefully", () => {
      const result = parser.parseFiles(["/non/existent/file.tsx"]);

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
