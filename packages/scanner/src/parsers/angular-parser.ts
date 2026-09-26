/**
 * @file Angular Parser
 * @module @coreflow/scanner/parsers/angular-parser
 * @description
 * Parses Angular component files to extract component information.
 * Extracts: @Component, @Input, @Output decorators.
 * Per spec Phase 6: Scanner - AST Parsers (T092)
 */

import {
  Project,
  SourceFile,
  ClassDeclaration,
  Decorator,
  PropertyDeclaration,
} from "ts-morph";

// ============================================================================
// Types
// ============================================================================

export interface AngularInputInfo {
  name: string;
  alias?: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  transform?: string;
}

export interface AngularOutputInfo {
  name: string;
  alias?: string;
  type: string;
  description?: string;
}

export interface AngularComponentInfo {
  name: string;
  selector: string;
  filePath: string;
  templateUrl?: string;
  template?: string;
  styleUrls?: string[];
  standalone: boolean;
  inputs: AngularInputInfo[];
  outputs: AngularOutputInfo[];
  description?: string;
  imports?: string[];
  providers?: string[];
  changeDetection?: string;
  // Technical debt
  todos: string[];
  fixmes: string[];
}

export interface AngularDirectiveInfo {
  name: string;
  selector: string;
  filePath: string;
  inputs: AngularInputInfo[];
  outputs: AngularOutputInfo[];
  standalone: boolean;
  description?: string;
}

export interface AngularServiceInfo {
  name: string;
  filePath: string;
  providedIn: string;
  description?: string;
  methods: string[];
}

export interface AngularParseResult {
  components: AngularComponentInfo[];
  directives: AngularDirectiveInfo[];
  services: AngularServiceInfo[];
  errors: string[];
}

// ============================================================================
// Parser Implementation
// ============================================================================

/**
 * Angular component parser using ts-morph
 */
export class AngularParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: {
        allowJs: false,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
      useInMemoryFileSystem: false,
    });
  }

  /**
   * Parse a single Angular TypeScript file
   */
  parseFile(filePath: string): AngularParseResult {
    const result: AngularParseResult = {
      components: [],
      directives: [],
      services: [],
      errors: [],
    };

    try {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      
      // Process classes
      sourceFile.getClasses().forEach((classDecl) => {
        const decorators = classDecl.getDecorators();
        
        for (const decorator of decorators) {
          const name = decorator.getName();
          
          if (name === "Component") {
            const component = this.extractComponent(classDecl, decorator, filePath);
            if (component) result.components.push(component);
          } else if (name === "Directive") {
            const directive = this.extractDirective(classDecl, decorator, filePath);
            if (directive) result.directives.push(directive);
          } else if (name === "Injectable") {
            const service = this.extractService(classDecl, decorator, filePath);
            if (service) result.services.push(service);
          }
        }
      });

      this.project.removeSourceFile(sourceFile);
    } catch (error) {
      result.errors.push(`Error parsing ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Parse multiple files
   */
  parseFiles(filePaths: string[]): AngularParseResult {
    const combined: AngularParseResult = {
      components: [],
      directives: [],
      services: [],
      errors: [],
    };

    for (const filePath of filePaths) {
      const result = this.parseFile(filePath);
      combined.components.push(...result.components);
      combined.directives.push(...result.directives);
      combined.services.push(...result.services);
      combined.errors.push(...result.errors);
    }

    return combined;
  }

  /**
   * Parse from source code string
   */
  parseSource(source: string, fileName: string = "temp.component.ts"): AngularParseResult {
    const result: AngularParseResult = {
      components: [],
      directives: [],
      services: [],
      errors: [],
    };

    try {
      const sourceFile = this.project.createSourceFile(fileName, source, {
        overwrite: true,
      });

      sourceFile.getClasses().forEach((classDecl) => {
        const decorators = classDecl.getDecorators();
        
        for (const decorator of decorators) {
          const name = decorator.getName();
          
          if (name === "Component") {
            const component = this.extractComponent(classDecl, decorator, fileName);
            if (component) result.components.push(component);
          } else if (name === "Directive") {
            const directive = this.extractDirective(classDecl, decorator, fileName);
            if (directive) result.directives.push(directive);
          } else if (name === "Injectable") {
            const service = this.extractService(classDecl, decorator, fileName);
            if (service) result.services.push(service);
          }
        }
      });

      this.project.removeSourceFile(sourceFile);
    } catch (error) {
      result.errors.push(`Error parsing source: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  // ============================================================================
  // Component Extraction
  // ============================================================================

  private extractComponent(
    classDecl: ClassDeclaration,
    decorator: Decorator,
    filePath: string
  ): AngularComponentInfo | null {
    const name = classDecl.getName();
    if (!name) return null;

    const decoratorArgs = this.getDecoratorArguments(decorator);
    const jsDocs = classDecl.getJsDocs();
    const description = jsDocs[0]?.getDescription()?.trim();

    return {
      name,
      selector: decoratorArgs.selector || "",
      filePath,
      templateUrl: decoratorArgs.templateUrl,
      template: decoratorArgs.template,
      styleUrls: decoratorArgs.styleUrls,
      standalone: decoratorArgs.standalone === true,
      inputs: this.extractInputs(classDecl),
      outputs: this.extractOutputs(classDecl),
      description,
      imports: decoratorArgs.imports,
      providers: decoratorArgs.providers,
      changeDetection: decoratorArgs.changeDetection,
      todos: this.extractTodos(classDecl.getText()),
      fixmes: this.extractFixmes(classDecl.getText()),
    };
  }

  private extractDirective(
    classDecl: ClassDeclaration,
    decorator: Decorator,
    filePath: string
  ): AngularDirectiveInfo | null {
    const name = classDecl.getName();
    if (!name) return null;

    const decoratorArgs = this.getDecoratorArguments(decorator);
    const jsDocs = classDecl.getJsDocs();
    const description = jsDocs[0]?.getDescription()?.trim();

    return {
      name,
      selector: decoratorArgs.selector || "",
      filePath,
      inputs: this.extractInputs(classDecl),
      outputs: this.extractOutputs(classDecl),
      standalone: decoratorArgs.standalone === true,
      description,
    };
  }

  private extractService(
    classDecl: ClassDeclaration,
    decorator: Decorator,
    filePath: string
  ): AngularServiceInfo | null {
    const name = classDecl.getName();
    if (!name) return null;

    const decoratorArgs = this.getDecoratorArguments(decorator);
    const jsDocs = classDecl.getJsDocs();
    const description = jsDocs[0]?.getDescription()?.trim();

    // Extract public methods
    const methods = classDecl
      .getMethods()
      .filter((m) => !m.hasModifier("private") && !m.getName().startsWith("_"))
      .map((m) => m.getName());

    return {
      name,
      filePath,
      providedIn: decoratorArgs.providedIn || "root",
      description,
      methods,
    };
  }

  // ============================================================================
  // Input/Output Extraction
  // ============================================================================

  private extractInputs(classDecl: ClassDeclaration): AngularInputInfo[] {
    const inputs: AngularInputInfo[] = [];

    // Check for @Input() decorated properties
    classDecl.getProperties().forEach((prop) => {
      const inputDecorator = prop.getDecorator("Input");
      if (inputDecorator) {
        inputs.push(this.extractInputFromProperty(prop, inputDecorator));
      }
    });

    // Check for signal inputs (Angular 17+)
    classDecl.getProperties().forEach((prop) => {
      const initializer = prop.getInitializer()?.getText() || "";
      if (initializer.includes("input(") || initializer.includes("input.required(")) {
        inputs.push(this.extractSignalInput(prop));
      }
    });

    return inputs;
  }

  private extractInputFromProperty(
    prop: PropertyDeclaration,
    decorator: Decorator
  ): AngularInputInfo {
    const name = prop.getName();
    const type = prop.getType().getText();
    const hasQuestionToken = prop.hasQuestionToken();
    const initializer = prop.getInitializer();

    // Get alias from decorator
    const decoratorArgs = decorator.getArguments();
    let alias: string | undefined;
    let required = !hasQuestionToken && !initializer;
    let transform: string | undefined;

    if (decoratorArgs.length > 0) {
      const arg = decoratorArgs[0];
      if (arg) {
        const argText = arg.getText();
        // Check if it's a string (alias) or object (options)
        if (argText.startsWith("'") || argText.startsWith('"')) {
          alias = argText.replace(/['"]/g, "");
        } else if (argText.startsWith("{")) {
          // Parse options object
          const aliasMatch = argText.match(/alias:\s*['"]([^'"]+)['"]/);
          if (aliasMatch) alias = aliasMatch[1];
          
          const requiredMatch = argText.match(/required:\s*(true|false)/);
          if (requiredMatch) required = requiredMatch[1] === "true";

          const transformMatch = argText.match(/transform:\s*([^,}]+)/);
          if (transformMatch) transform = transformMatch[1]?.trim();
        }
      }
    }

    const jsDocs = prop.getJsDocs();
    const description = jsDocs[0]?.getDescription()?.trim();

    return {
      name,
      alias,
      type,
      required,
      defaultValue: initializer?.getText(),
      description,
      transform,
    };
  }

  private extractSignalInput(prop: PropertyDeclaration): AngularInputInfo {
    const name = prop.getName();
    const initializer = prop.getInitializer()?.getText() || "";
    
    // Determine if required
    const required = initializer.includes("input.required");

    // Extract type from generic parameter
    const typeMatch = initializer.match(/input(?:\.required)?<([^>]+)>/);
    const type = typeMatch ? typeMatch[1] || "unknown" : "unknown";

    // Extract default value if present
    const defaultMatch = initializer.match(/input\(([^,)]+)/);
    const defaultValue = defaultMatch ? defaultMatch[1]?.trim() : undefined;

    const jsDocs = prop.getJsDocs();
    const description = jsDocs[0]?.getDescription()?.trim();

    return {
      name,
      type,
      required,
      defaultValue,
      description,
    };
  }

  private extractOutputs(classDecl: ClassDeclaration): AngularOutputInfo[] {
    const outputs: AngularOutputInfo[] = [];

    // Check for @Output() decorated properties
    classDecl.getProperties().forEach((prop) => {
      const outputDecorator = prop.getDecorator("Output");
      if (outputDecorator) {
        const name = prop.getName();
        
        // Try to get type from type annotation first
        let type = prop.getTypeNode()?.getText();
        
        // If no type annotation, infer from initializer (e.g., new EventEmitter<string>())
        if (!type) {
          const initializer = prop.getInitializer()?.getText() || "";
          if (initializer.includes("EventEmitter")) {
            // Extract the type from EventEmitter<Type>
            const match = initializer.match(/new\s+EventEmitter<([^>]+)>/);
            if (match) {
              type = `EventEmitter<${match[1]}>`;
            } else {
              type = "EventEmitter<void>";
            }
          } else {
            type = prop.getType().getText();
          }
        }
        
        // Get alias from decorator
        const decoratorArgs = outputDecorator.getArguments();
        let alias: string | undefined;
        if (decoratorArgs.length > 0) {
          const arg = decoratorArgs[0];
          if (arg) {
            alias = arg.getText().replace(/['"]/g, "");
          }
        }

        const jsDocs = prop.getJsDocs();
        const description = jsDocs[0]?.getDescription()?.trim();

        outputs.push({ name, alias, type, description });
      }
    });

    // Check for signal outputs (Angular 17+)
    classDecl.getProperties().forEach((prop) => {
      const initializer = prop.getInitializer()?.getText() || "";
      if (initializer.includes("output(")) {
        const name = prop.getName();
        const typeMatch = initializer.match(/output<([^>]+)>/);
        const type = typeMatch ? `OutputEmitterRef<${typeMatch[1]}>` : "OutputEmitterRef<void>";

        const jsDocs = prop.getJsDocs();
        const description = jsDocs[0]?.getDescription()?.trim();

        outputs.push({ name, type, description });
      }
    });

    return outputs;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private getDecoratorArguments(decorator: Decorator): Record<string, any> {
    const args = decorator.getArguments();
    if (args.length === 0) return {};

    try {
      const argText = args[0]?.getText() || "{}";
      // Simple parsing of object literal
      const result: Record<string, any> = {};
      
      // Extract selector
      const selectorMatch = argText.match(/selector:\s*['"`]([^'"`]+)['"`]/);
      if (selectorMatch) result.selector = selectorMatch[1];

      // Extract templateUrl
      const templateUrlMatch = argText.match(/templateUrl:\s*['"`]([^'"`]+)['"`]/);
      if (templateUrlMatch) result.templateUrl = templateUrlMatch[1];

      // Extract template (handle multiline with backticks or single-quoted)
      const templateMatch = argText.match(/template:\s*`([^`]*)`/) || 
                            argText.match(/template:\s*'([^']*)'/);
      if (templateMatch) result.template = templateMatch[1];

      // Extract standalone
      const standaloneMatch = argText.match(/standalone:\s*(true|false)/);
      if (standaloneMatch) result.standalone = standaloneMatch[1] === "true";

      // Extract styleUrls
      const styleUrlsMatch = argText.match(/styleUrls:\s*\[([^\]]+)\]/);
      if (styleUrlsMatch) {
        result.styleUrls = styleUrlsMatch[1]
          ?.match(/['"`][^'"`]+['"`]/g)
          ?.map((s) => s.replace(/['"`]/g, ""));
      }

      // Extract imports array
      const importsMatch = argText.match(/imports:\s*\[([^\]]+)\]/);
      if (importsMatch) {
        result.imports = importsMatch[1]
          ?.split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }

      // Extract providers array
      const providersMatch = argText.match(/providers:\s*\[([^\]]+)\]/);
      if (providersMatch) {
        result.providers = providersMatch[1]
          ?.split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }

      // Extract changeDetection
      const cdMatch = argText.match(/changeDetection:\s*ChangeDetectionStrategy\.(\w+)/);
      if (cdMatch) result.changeDetection = cdMatch[1];

      // Extract providedIn
      const providedInMatch = argText.match(/providedIn:\s*['"`]([^'"`]+)['"`]/);
      if (providedInMatch) result.providedIn = providedInMatch[1];

      return result;
    } catch {
      return {};
    }
  }

  private extractTodos(text: string): string[] {
    const todos: string[] = [];
    const pattern = /\/\/\s*TODO:?\s*(.+)/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      todos.push(match[1]?.trim() || "");
    }
    return todos;
  }

  private extractFixmes(text: string): string[] {
    const fixmes: string[] = [];
    const pattern = /\/\/\s*FIXME:?\s*(.+)/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      fixmes.push(match[1]?.trim() || "");
    }
    return fixmes;
  }
}

// ============================================================================
// Export
// ============================================================================

export const angularParser = new AngularParser();
