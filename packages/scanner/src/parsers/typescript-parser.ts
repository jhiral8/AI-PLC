/**
 * @file TypeScript Parser
 * @module @coreflow/scanner/parsers/typescript-parser
 * @description
 * Parses TypeScript/TSX files to extract component information using ts-morph.
 * Extracts: component names, props, types, variants.
 * Per spec Phase 6: Scanner - AST Parsers (T091)
 */

import {
  Project,
  SourceFile,
  SyntaxKind,
  Node,
  FunctionDeclaration,
  VariableDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  PropertySignature,
  ParameterDeclaration,
  JSDocTag,
} from "ts-morph";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

export interface PropInfo {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  deprecated?: boolean;
  deprecationReason?: string;
}

export interface ComponentInfo {
  name: string;
  displayName?: string;
  filePath: string;
  type: "function" | "class" | "arrow" | "forwardRef";
  description?: string;
  props: PropInfo[];
  exportType: "default" | "named" | "both";
  hasJSDoc: boolean;
  tags: string[];
  variants?: string[];
  // React-specific
  usesHooks: string[];
  hasChildren: boolean;
  // Technical debt markers
  todos: string[];
  fixmes: string[];
}

export interface InterfaceInfo {
  name: string;
  filePath: string;
  description?: string;
  properties: PropInfo[];
  extends: string[];
  isExported: boolean;
}

export interface TypeInfo {
  name: string;
  filePath: string;
  type: string;
  description?: string;
  isExported: boolean;
}

export interface ParseResult {
  components: ComponentInfo[];
  interfaces: InterfaceInfo[];
  types: TypeInfo[];
  errors: string[];
}

// ============================================================================
// Parser Implementation
// ============================================================================

/**
 * TypeScript/React component parser using ts-morph
 */
export class TypeScriptParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 2, // React
        esModuleInterop: true,
      },
      useInMemoryFileSystem: false,
    });
  }

  /**
   * Parse a single TypeScript/TSX file
   */
  parseFile(filePath: string): ParseResult {
    const result: ParseResult = {
      components: [],
      interfaces: [],
      types: [],
      errors: [],
    };

    try {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      
      // Extract components
      result.components.push(...this.extractComponents(sourceFile, filePath));
      
      // Extract interfaces
      result.interfaces.push(...this.extractInterfaces(sourceFile, filePath));
      
      // Extract type aliases
      result.types.push(...this.extractTypes(sourceFile, filePath));
      
      // Cleanup
      this.project.removeSourceFile(sourceFile);
      
    } catch (error) {
      result.errors.push(`Error parsing ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Parse multiple files
   */
  parseFiles(filePaths: string[]): ParseResult {
    const combined: ParseResult = {
      components: [],
      interfaces: [],
      types: [],
      errors: [],
    };

    for (const filePath of filePaths) {
      const result = this.parseFile(filePath);
      combined.components.push(...result.components);
      combined.interfaces.push(...result.interfaces);
      combined.types.push(...result.types);
      combined.errors.push(...result.errors);
    }

    return combined;
  }

  /**
   * Parse from source code string
   */
  parseSource(source: string, fileName: string = "temp.tsx"): ParseResult {
    const result: ParseResult = {
      components: [],
      interfaces: [],
      types: [],
      errors: [],
    };

    try {
      const sourceFile = this.project.createSourceFile(fileName, source, {
        overwrite: true,
      });

      result.components.push(...this.extractComponents(sourceFile, fileName));
      result.interfaces.push(...this.extractInterfaces(sourceFile, fileName));
      result.types.push(...this.extractTypes(sourceFile, fileName));

      this.project.removeSourceFile(sourceFile);
    } catch (error) {
      result.errors.push(`Error parsing source: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  // ============================================================================
  // Component Extraction
  // ============================================================================

  private extractComponents(sourceFile: SourceFile, filePath: string): ComponentInfo[] {
    const components: ComponentInfo[] = [];

    // Extract function components
    sourceFile.getFunctions().forEach((func) => {
      if (this.isReactComponent(func)) {
        const component = this.extractFunctionComponent(func, filePath);
        if (component) components.push(component);
      }
    });

    // Extract arrow function components (const MyComponent = () => ...)
    sourceFile.getVariableDeclarations().forEach((varDecl) => {
      const component = this.extractArrowComponent(varDecl, filePath);
      if (component) components.push(component);
    });

    // Extract class components
    sourceFile.getClasses().forEach((classDecl) => {
      if (this.isReactClassComponent(classDecl)) {
        const component = this.extractClassComponent(classDecl, filePath);
        if (component) components.push(component);
      }
    });

    return components;
  }

  private isReactComponent(node: FunctionDeclaration | VariableDeclaration): boolean {
    const name = node.getName();
    if (!name || !name[0]?.match(/[A-Z]/)) return false;

    // Check if it returns JSX
    const text = node.getText();
    return text.includes("<") && (text.includes("return") || text.includes("=>"));
  }

  private isReactClassComponent(classDecl: ClassDeclaration): boolean {
    const heritage = classDecl.getHeritageClauses();
    return heritage.some((clause) =>
      clause.getText().includes("React.Component") ||
      clause.getText().includes("Component") ||
      clause.getText().includes("PureComponent")
    );
  }

  private extractFunctionComponent(
    func: FunctionDeclaration,
    filePath: string
  ): ComponentInfo | null {
    const name = func.getName();
    if (!name) return null;

    const jsDocs = func.getJsDocs();
    let description = jsDocs[0]?.getDescription()?.trim();
    const tags = this.extractJSDocTags(jsDocs);

    // Extract props from parameters (includes default values)
    const params = func.getParameters();
    const propsParam = params[0];
    const props = propsParam ? this.extractPropsFromParameter(propsParam) : [];
    
    // If no description on function, try to get it from the props interface
    if (!description && propsParam) {
      const propsDescription = this.getPropsInterfaceDescription(propsParam, func.getSourceFile());
      if (propsDescription) {
        description = propsDescription;
      }
    }

    // Check export status
    const isDefaultExport = func.isDefaultExport();
    const isNamedExport = func.isExported() && !isDefaultExport;
    
    const funcText = func.getText();
    
    // Check if component uses children
    const hasChildrenProp = props.some((p) => p.name === "children");
    const usesChildrenInJsx = funcText.includes("{children}") || funcText.includes("{ children }") || 
                              funcText.includes("children}") || funcText.includes("{children,");

    return {
      name,
      filePath,
      type: "function",
      description,
      props,
      exportType: isDefaultExport ? "default" : isNamedExport ? "named" : "named",
      hasJSDoc: jsDocs.length > 0 || !!description,
      tags: this.extractTagsFromJSDoc(jsDocs),
      usesHooks: this.extractHooksUsed(funcText),
      hasChildren: hasChildrenProp || usesChildrenInJsx,
      todos: this.extractTodos(funcText),
      fixmes: this.extractFixmes(funcText),
    };
  }
  
  private getPropsInterfaceDescription(param: ParameterDeclaration, sourceFile: SourceFile): string | undefined {
    const typeNode = param.getTypeNode();
    if (!typeNode) return undefined;

    const typeName = typeNode.getText();
    const iface = sourceFile.getInterface(typeName);
    if (iface) {
      const jsDocs = iface.getJsDocs();
      return jsDocs[0]?.getDescription()?.trim();
    }
    return undefined;
  }

  private extractArrowComponent(
    varDecl: VariableDeclaration,
    filePath: string
  ): ComponentInfo | null {
    const name = varDecl.getName();
    if (!name || !name[0]?.match(/[A-Z]/)) return null;

    const initializer = varDecl.getInitializer();
    if (!initializer) return null;

    const text = initializer.getText();
    
    // Check if it's an arrow function or forwardRef
    const isArrowFunction = initializer.getKind() === SyntaxKind.ArrowFunction;
    const isForwardRef = text.includes("forwardRef") || text.includes("React.forwardRef");
    
    if (!isArrowFunction && !isForwardRef) return null;

    // Check if it returns JSX
    if (!text.includes("<")) return null;

    // Get JSDoc from variable statement
    const varStatement = varDecl.getVariableStatement();
    const jsDocs = varStatement?.getJsDocs() || [];
    const description = jsDocs[0]?.getDescription()?.trim();

    // Try to extract props type
    const propsType = this.extractPropsTypeFromArrow(initializer);
    let props = propsType ? this.resolvePropsFromType(propsType, varDecl.getSourceFile()) : [];
    
    // Extract default values from the arrow function parameters
    const defaultValues = this.extractDefaultsFromDestructuring(text);
    props = props.map(prop => ({
      ...prop,
      defaultValue: defaultValues.get(prop.name) ?? prop.defaultValue,
      required: defaultValues.has(prop.name) ? false : prop.required,
    }));

    const statement = varDecl.getVariableStatement();
    const isExported = statement?.isExported() || false;
    const isDefaultExport = statement?.isDefaultExport() || false;
    
    // Check if component uses children
    const hasChildrenProp = props.some((p) => p.name === "children");
    const usesChildrenInJsx = text.includes("{children}") || text.includes("{ children }") || 
                              text.includes("children}") || text.includes("{children,");

    return {
      name,
      filePath,
      type: isForwardRef ? "forwardRef" : "arrow",
      description,
      props,
      exportType: isDefaultExport ? "default" : isExported ? "named" : "named",
      hasJSDoc: jsDocs.length > 0,
      tags: this.extractTagsFromJSDoc(jsDocs),
      usesHooks: this.extractHooksUsed(text),
      hasChildren: hasChildrenProp || usesChildrenInJsx,
      todos: this.extractTodos(text),
      fixmes: this.extractFixmes(text),
    };
  }

  private extractClassComponent(
    classDecl: ClassDeclaration,
    filePath: string
  ): ComponentInfo | null {
    const name = classDecl.getName();
    if (!name) return null;

    const jsDocs = classDecl.getJsDocs();
    const description = jsDocs[0]?.getDescription()?.trim();

    // Extract props from generic parameter
    const props: PropInfo[] = [];
    const heritage = classDecl.getHeritageClauses();
    for (const clause of heritage) {
      const typeArgs = clause.getTypeNodes();
      if (typeArgs.length > 0) {
        const propsType = typeArgs[0]?.getText();
        if (propsType) {
          props.push(...this.resolvePropsFromType(propsType, classDecl.getSourceFile()));
        }
      }
    }

    const isDefaultExport = classDecl.isDefaultExport();
    const isExported = classDecl.isExported();

    return {
      name,
      filePath,
      type: "class",
      description,
      props,
      exportType: isDefaultExport ? "default" : isExported ? "named" : "named",
      hasJSDoc: jsDocs.length > 0,
      tags: this.extractTagsFromJSDoc(jsDocs),
      usesHooks: [], // Class components don't use hooks
      hasChildren: props.some((p) => p.name === "children"),
      todos: this.extractTodos(classDecl.getText()),
      fixmes: this.extractFixmes(classDecl.getText()),
    };
  }

  // ============================================================================
  // Interface & Type Extraction
  // ============================================================================

  private extractInterfaces(sourceFile: SourceFile, filePath: string): InterfaceInfo[] {
    return sourceFile.getInterfaces().map((iface) => {
      const jsDocs = iface.getJsDocs();
      const description = jsDocs[0]?.getDescription()?.trim();

      return {
        name: iface.getName(),
        filePath,
        description,
        properties: iface.getProperties().map((prop) => this.extractPropSignature(prop)),
        extends: iface.getExtends().map((e) => e.getText()),
        isExported: iface.isExported(),
      };
    });
  }

  private extractTypes(sourceFile: SourceFile, filePath: string): TypeInfo[] {
    return sourceFile.getTypeAliases().map((type) => {
      const jsDocs = type.getJsDocs();
      const description = jsDocs[0]?.getDescription()?.trim();

      return {
        name: type.getName(),
        filePath,
        type: type.getType().getText(),
        description,
        isExported: type.isExported(),
      };
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private extractPropsFromParameter(param: ParameterDeclaration): PropInfo[] {
    const typeNode = param.getTypeNode();
    if (!typeNode) return [];

    const typeName = typeNode.getText();
    const baseProps = this.resolvePropsFromType(typeName, param.getSourceFile());
    
    // Extract default values from destructuring pattern
    const paramText = param.getText();
    const defaultValues = this.extractDefaultsFromDestructuring(paramText);
    
    // Merge defaults into props
    return baseProps.map(prop => ({
      ...prop,
      defaultValue: defaultValues.get(prop.name) ?? prop.defaultValue,
      required: defaultValues.has(prop.name) ? false : prop.required,
    }));
  }
  
  private extractDefaultsFromDestructuring(text: string): Map<string, string> {
    const defaults = new Map<string, string>();
    
    // Match patterns like { prop = defaultValue } or { prop = 'value' }
    const pattern = /(\w+)\s*=\s*([^,}]+)/g;
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const propName = match[1]?.trim();
      const defaultValue = match[2]?.trim();
      if (propName && defaultValue) {
        defaults.set(propName, defaultValue);
      }
    }
    
    return defaults;
  }

  private extractPropsTypeFromArrow(node: Node): string | null {
    const text = node.getText();
    
    // Match patterns like: (props: MyProps) => or ({ prop1, prop2 }: MyProps) =>
    const match = text.match(/(?:\(|\{)[^)]*:\s*([A-Z][a-zA-Z0-9]*(?:Props)?)/);
    if (match) return match[1] || null;

    // Match forwardRef pattern
    const refMatch = text.match(/forwardRef<[^,]+,\s*([A-Z][a-zA-Z0-9]*)/);
    if (refMatch) return refMatch[1] || null;

    return null;
  }

  private resolvePropsFromType(typeName: string, sourceFile: SourceFile): PropInfo[] {
    // Find the interface or type
    const iface = sourceFile.getInterface(typeName);
    if (iface) {
      return iface.getProperties().map((prop) => this.extractPropSignature(prop));
    }

    const typeAlias = sourceFile.getTypeAlias(typeName);
    if (typeAlias) {
      // Handle type aliases that are object types
      const typeText = typeAlias.getType().getText();
      // Parse inline object type
      return this.parseInlineObjectType(typeText);
    }

    return [];
  }

  private extractPropSignature(prop: PropertySignature): PropInfo {
    const jsDocs = prop.getJsDocs();
    const deprecatedTag = jsDocs.flatMap((d) => d.getTags()).find((t) => t.getTagName() === "deprecated");

    return {
      name: prop.getName(),
      type: prop.getType().getText(),
      required: !prop.hasQuestionToken(),
      description: jsDocs[0]?.getDescription()?.trim(),
      deprecated: !!deprecatedTag,
      deprecationReason: deprecatedTag?.getCommentText()?.trim(),
    };
  }

  private parseInlineObjectType(typeText: string): PropInfo[] {
    // Simple parser for { prop1: type1; prop2?: type2 }
    const props: PropInfo[] = [];
    const match = typeText.match(/\{([^}]+)\}/);
    if (!match) return props;

    const propsText = match[1] || "";
    const propMatches = propsText.matchAll(/(\w+)(\?)?\s*:\s*([^;]+)/g);

    for (const m of propMatches) {
      props.push({
        name: m[1] || "",
        type: (m[3] || "").trim(),
        required: !m[2],
      });
    }

    return props;
  }

  private extractJSDocTags(jsDocs: any[]): Map<string, string> {
    const tags = new Map<string, string>();
    
    for (const doc of jsDocs) {
      for (const tag of doc.getTags()) {
        tags.set(tag.getTagName(), tag.getCommentText()?.trim() || "");
      }
    }
    
    return tags;
  }

  private extractTagsFromJSDoc(jsDocs: any[]): string[] {
    const tags: string[] = [];
    
    for (const doc of jsDocs) {
      for (const tag of doc.getTags()) {
        if (tag.getTagName() === "tag" || tag.getTagName() === "category") {
          const text = tag.getCommentText()?.trim();
          if (text) tags.push(text);
        }
      }
    }
    
    return tags;
  }

  private extractHooksUsed(text: string): string[] {
    const hooks: string[] = [];
    const hookPattern = /use[A-Z][a-zA-Z]*/g;
    const matches = text.match(hookPattern);
    
    if (matches) {
      // Dedupe
      return [...new Set(matches)];
    }
    
    return hooks;
  }

  private extractTodos(text: string): string[] {
    const todos: string[] = [];
    
    // Match // TODO: comments
    const inlinePattern = /\/\/\s*TODO:?\s*(.+)/gi;
    let match;
    
    while ((match = inlinePattern.exec(text)) !== null) {
      todos.push(match[1]?.trim() || "");
    }
    
    // Match /* TODO: */ and /** TODO: */ block comments
    const blockPattern = /\/\*+\s*TODO:?\s*([^*]+)\*?\//gi;
    while ((match = blockPattern.exec(text)) !== null) {
      todos.push(match[1]?.trim() || "");
    }
    
    // Match TODO inside JSDoc: * TODO: ...
    const jsdocPattern = /\*\s*TODO:?\s*(.+)/gi;
    while ((match = jsdocPattern.exec(text)) !== null) {
      const todo = match[1]?.trim();
      if (todo && !todos.includes(todo)) {
        todos.push(todo);
      }
    }
    
    return todos;
  }

  private extractFixmes(text: string): string[] {
    const fixmes: string[] = [];
    
    // Match // FIXME: comments
    const inlinePattern = /\/\/\s*FIXME:?\s*(.+)/gi;
    let match;
    
    while ((match = inlinePattern.exec(text)) !== null) {
      fixmes.push(match[1]?.trim() || "");
    }
    
    // Match /* FIXME: */ and {/* FIXME: */} block comments
    const blockPattern = /\/\*+\s*FIXME:?\s*([^*]+)\*?\//gi;
    while ((match = blockPattern.exec(text)) !== null) {
      fixmes.push(match[1]?.trim() || "");
    }
    
    // Match FIXME inside JSDoc: * FIXME: ...
    const jsdocPattern = /\*\s*FIXME:?\s*(.+)/gi;
    while ((match = jsdocPattern.exec(text)) !== null) {
      const fixme = match[1]?.trim();
      if (fixme && !fixmes.includes(fixme)) {
        fixmes.push(fixme);
      }
    }
    
    return fixmes;
  }
}

// ============================================================================
// Export
// ============================================================================

export const typescriptParser = new TypeScriptParser();
