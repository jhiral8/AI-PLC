/**
 * @file Manifest Generator Service
 * @module @coreflow/scanner/services/manifest-generator.service
 * @description
 * Generates library-manifest.json by aggregating parser outputs.
 * Per spec Phase 6: Scanner - AST Parsers (T095)
 */

import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import type {
  Manifest,
  ComponentInfo,
  APIRouteInfo,
  DataModelInfo,
  PropInfo,
} from "../schemas/manifest.schema";
import {
  TypeScriptParser,
  type ComponentInfo as TSComponentInfo,
  type PropInfo as TSPropInfo,
} from "../parsers/typescript-parser";
import {
  AngularParser,
  type AngularComponentInfo,
  type AngularInputInfo,
} from "../parsers/angular-parser";
import {
  PythonParser,
  type PydanticModelInfo,
  type FastAPIRouteInfo,
  type PydanticFieldInfo,
} from "../parsers/python-parser";

// ============================================================================
// Types
// ============================================================================

export interface ManifestGeneratorOptions {
  projectId: string;
  projectName?: string;
  rootPath: string;
  repository?: {
    url?: string;
    branch?: string;
    commitHash?: string;
  };
  scannerVersion?: string;
  
  typescript?: {
    enabled?: boolean;
    include?: string[];
    exclude?: string[];
  };
  angular?: {
    enabled?: boolean;
    include?: string[];
    exclude?: string[];
  };
  python?: {
    enabled?: boolean;
    include?: string[];
    exclude?: string[];
  };
}

interface ResolvedOptions {
  projectId: string;
  projectName: string;
  rootPath: string;
  repository: {
    url?: string;
    branch?: string;
    commitHash?: string;
  };
  scannerVersion: string;
  typescript: {
    enabled: boolean;
    include: string[];
    exclude: string[];
  };
  angular: {
    enabled: boolean;
    include: string[];
    exclude: string[];
  };
  python: {
    enabled: boolean;
    include: string[];
    exclude: string[];
  };
}

export interface GeneratorResult {
  manifest: Manifest;
  errors: string[];
  duration: number;
}

// ============================================================================
// ManifestGenerator Class
// ============================================================================

export class ManifestGenerator {
  private options: ResolvedOptions;
  private tsParser: TypeScriptParser;
  private angularParser: AngularParser;
  private pythonParser: PythonParser;

  constructor(options: ManifestGeneratorOptions) {
    this.options = {
      projectId: options.projectId,
      projectName: options.projectName ?? "Unnamed Project",
      rootPath: options.rootPath,
      repository: options.repository ?? {},
      scannerVersion: options.scannerVersion ?? "1.0.0",
      typescript: {
        enabled: options.typescript?.enabled ?? true,
        include: options.typescript?.include ?? ["**/*.ts", "**/*.tsx"],
        exclude: options.typescript?.exclude ?? ["**/*.test.*", "**/*.spec.*", "**/node_modules/**"],
      },
      angular: {
        enabled: options.angular?.enabled ?? true,
        include: options.angular?.include ?? ["**/*.component.ts"],
        exclude: options.angular?.exclude ?? ["**/*.spec.ts", "**/node_modules/**"],
      },
      python: {
        enabled: options.python?.enabled ?? true,
        include: options.python?.include ?? ["**/*.py"],
        exclude: options.python?.exclude ?? ["**/*test*.py", "**/venv/**", "**/__pycache__/**"],
      },
    };

    this.tsParser = new TypeScriptParser();
    this.angularParser = new AngularParser();
    this.pythonParser = new PythonParser();
  }

  /**
   * Generate manifest from source files
   */
  async generate(): Promise<GeneratorResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const components: ComponentInfo[] = [];
    const routes: APIRouteInfo[] = [];
    const models: DataModelInfo[] = [];

    try {
      if (this.options.typescript.enabled) {
        const tsResult = await this.parseTypeScript();
        components.push(...tsResult.components);
        errors.push(...tsResult.errors);
      }

      if (this.options.angular.enabled) {
        const ngResult = await this.parseAngular();
        components.push(...ngResult.components);
        errors.push(...ngResult.errors);
      }

      if (this.options.python.enabled) {
        const pyResult = await this.parsePython();
        models.push(...pyResult.models);
        routes.push(...pyResult.routes);
        errors.push(...pyResult.errors);
      }
    } catch (error) {
      errors.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    }

    const duration = Date.now() - startTime;
    const now = new Date();
    const stats = this.calculateStats(components, routes, models);

    const manifest: Manifest = {
      version: "1.0.0",
      projectId: this.options.projectId,
      projectName: this.options.projectName,
      repository: this.options.repository,
      generatedAt: now,
      scannedAt: now,
      scannerVersion: this.options.scannerVersion,
      scanDurationMs: duration,
      components,
      routes: routes.length > 0 ? routes : undefined,
      models: models.length > 0 ? models : undefined,
      stats,
      errors: errors.length > 0 ? errors : undefined,
    };

    return { manifest, errors, duration };
  }

  // ==========================================================================
  // File Discovery
  // ==========================================================================

  private async findFiles(patterns: string[], excludePatterns: string[]): Promise<string[]> {
    const files: string[] = [];
    
    const walkDir = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(this.options.rootPath, fullPath);
          
          // Skip excluded directories
          if (excludePatterns.some(p => this.matchPattern(relativePath, p))) {
            continue;
          }
          
          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else if (entry.isFile()) {
            // Check if file matches any include pattern
            if (patterns.some(p => this.matchPattern(relativePath, p))) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Ignore errors (permission denied, etc.)
      }
    };
    
    await walkDir(this.options.rootPath);
    return files;
  }
  
  private matchPattern(filePath: string, pattern: string): boolean {
    // Simple glob pattern matching
    // ** matches any number of directories (including zero)
    // * matches any characters except /
    // Handle special case: **/*.ext should match both root files and files in subdirs
    
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, "/");
    
    // Build regex pattern - order matters!
    let regexPattern = pattern
      // First, replace ** with a placeholder
      .replace(/\*\*/g, "{{GLOBSTAR}}")
      // Then replace single * with [^/]*
      .replace(/\*/g, "[^/]*")
      // Replace ? with [^/]
      .replace(/\?/g, "[^/]")
      // Escape dots
      .replace(/\./g, "\\.")
      // Replace **/ placeholder with optional directory match
      .replace(/{{GLOBSTAR}}\//g, "(?:.*\\/)?")
      // Replace remaining ** (without /) with .*
      .replace(/{{GLOBSTAR}}/g, ".*");
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  }

  // ==========================================================================
  // TypeScript Parsing
  // ==========================================================================

  private async parseTypeScript(): Promise<{ components: ComponentInfo[]; errors: string[] }> {
    const components: ComponentInfo[] = [];
    const errors: string[] = [];

    try {
      const files = await this.findFiles(
        this.options.typescript.include,
        this.options.typescript.exclude
      );
      if (files.length === 0) return { components, errors };

      const parsed = this.tsParser.parseFiles(files);
      errors.push(...parsed.errors);

      for (const comp of parsed.components) {
        try {
          components.push(this.transformTSComponent(comp));
        } catch (error) {
          errors.push(`TS transform error ${comp.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      errors.push(`TypeScript parsing failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { components, errors };
  }

  private transformTSComponent(comp: TSComponentInfo): ComponentInfo {
    const relativePath = path.relative(this.options.rootPath, comp.filePath);
    return {
      id: this.generateId("ts", comp.name, relativePath),
      name: comp.name,
      displayName: this.toDisplayName(comp.name),
      description: comp.description,
      filePath: relativePath,
      framework: "react",
      type: comp.type,
      props: comp.props.map((p: TSPropInfo) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        defaultValue: p.defaultValue,
        description: p.description,
        deprecated: p.deprecated,
        deprecationReason: p.deprecationReason,
      })),
      exportType: comp.exportType,
      supportsInfiniteScroll: this.detectCapability(comp.props, ["infiniteScroll", "loadMore"]),
      supportsPagination: this.detectCapability(comp.props, ["page", "pagination", "pageSize"]),
      supportsVirtualization: this.detectCapability(comp.props, ["virtual", "virtualized"]),
      hasAriaLabels: this.detectCapability(comp.props, ["aria-label", "ariaLabel"]),
      todos: comp.todos?.length > 0 ? comp.todos : undefined,
      fixmes: comp.fixmes?.length > 0 ? comp.fixmes : undefined,
      category: this.inferCategory(comp.name, relativePath),
      tags: comp.tags?.length > 0 ? comp.tags : undefined,
    };
  }

  // ==========================================================================
  // Angular Parsing
  // ==========================================================================

  private async parseAngular(): Promise<{ components: ComponentInfo[]; errors: string[] }> {
    const components: ComponentInfo[] = [];
    const errors: string[] = [];

    try {
      const files = await this.findFiles(
        this.options.angular.include,
        this.options.angular.exclude
      );
      if (files.length === 0) return { components, errors };

      const parsed = this.angularParser.parseFiles(files);
      errors.push(...parsed.errors);

      for (const comp of parsed.components) {
        try {
          components.push(this.transformAngularComponent(comp));
        } catch (error) {
          errors.push(`Angular transform error ${comp.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      errors.push(`Angular parsing failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { components, errors };
  }

  private transformAngularComponent(comp: AngularComponentInfo): ComponentInfo {
    const relativePath = path.relative(this.options.rootPath, comp.filePath);
    return {
      id: this.generateId("ng", comp.name, relativePath),
      name: comp.name,
      displayName: this.toDisplayName(comp.name),
      description: comp.description,
      filePath: relativePath,
      framework: "angular",
      type: "class",
      props: comp.inputs.map((i: AngularInputInfo) => ({
        name: i.name,
        type: i.type,
        required: i.required,
        defaultValue: i.defaultValue,
        alias: i.alias,
        description: i.description,
      })),
      outputs: comp.outputs.map((o) => ({
        name: o.name,
        type: o.type,
        description: o.description,
      })),
      exportType: "named",
      supportsInfiniteScroll: this.detectAngularCapability(comp.inputs, ["infiniteScroll"]),
      supportsPagination: this.detectAngularCapability(comp.inputs, ["page", "pageSize"]),
      category: this.inferCategory(comp.name, relativePath),
      tags: comp.selector ? [comp.selector] : undefined,
      todos: comp.todos?.length > 0 ? comp.todos : undefined,
      fixmes: comp.fixmes?.length > 0 ? comp.fixmes : undefined,
    };
  }

  // ==========================================================================
  // Python Parsing
  // ==========================================================================

  private async parsePython(): Promise<{ models: DataModelInfo[]; routes: APIRouteInfo[]; errors: string[] }> {
    const models: DataModelInfo[] = [];
    const routes: APIRouteInfo[] = [];
    const errors: string[] = [];

    try {
      const files = await this.findFiles(
        this.options.python.include,
        this.options.python.exclude
      );
      if (files.length === 0) return { models, routes, errors };

      const parsed = this.pythonParser.parseFiles(files);
      errors.push(...parsed.errors);

      for (const model of parsed.models) {
        try {
          models.push(this.transformPydanticModel(model));
        } catch (error) {
          errors.push(`Pydantic transform error ${model.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      for (const route of parsed.routes) {
        try {
          routes.push(this.transformFastAPIRoute(route));
        } catch (error) {
          errors.push(`FastAPI transform error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      errors.push(`Python parsing failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { models, routes, errors };
  }

  private transformPydanticModel(model: PydanticModelInfo): DataModelInfo {
    const relativePath = path.relative(this.options.rootPath, model.filePath);
    return {
      id: this.generateId("py-model", model.name, relativePath),
      name: model.name,
      filePath: relativePath,
      baseClass: model.baseClass,
      description: model.description,
      fields: model.fields.map((f: PydanticFieldInfo) => ({
        name: f.name,
        type: f.type,
        required: f.required,
        defaultValue: f.default,
        description: f.description,
        alias: f.alias,
        validation: f.validation?.length ? f.validation : undefined,
      })),
      validators: model.validators?.length ? model.validators : undefined,
      configOptions: model.configOptions && Object.keys(model.configOptions).length > 0
        ? model.configOptions
        : undefined,
    };
  }

  private transformFastAPIRoute(route: FastAPIRouteInfo): APIRouteInfo {
    const relativePath = path.relative(this.options.rootPath, route.filePath);
    return {
      id: this.generateId("py-route", route.functionName, relativePath),
      path: route.path,
      method: route.method,
      functionName: route.functionName,
      filePath: relativePath,
      description: route.description,
      parameters: route.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        location: p.location,
        required: p.required,
        default: p.default,
        description: p.description,
      })),
      responseModel: route.responseModel,
      tags: route.tags?.length ? route.tags : undefined,
      deprecated: route.deprecated,
    };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private generateId(prefix: string, name: string, filePath: string): string {
    const hash = crypto
      .createHash("md5")
      .update(`${prefix}:${filePath}:${name}`)
      .digest("hex")
      .substring(0, 8);
    return `${prefix}-${name.toLowerCase()}-${hash}`;
  }

  private toDisplayName(name: string): string {
    return name.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
  }

  private detectCapability(props: TSPropInfo[], keywords: string[]): boolean {
    return props.some((p) => keywords.some((k) => p.name.toLowerCase().includes(k.toLowerCase())));
  }

  private detectAngularCapability(inputs: AngularInputInfo[], keywords: string[]): boolean {
    return inputs.some((i) => keywords.some((k) => i.name.toLowerCase().includes(k.toLowerCase())));
  }

  private inferCategory(name: string, filePath: string): ComponentInfo["category"] {
    const lowerName = name.toLowerCase();
    const lowerPath = filePath.toLowerCase();

    if (lowerPath.includes("/form")) return "form";
    if (lowerPath.includes("/layout")) return "layout";
    if (lowerPath.includes("/nav")) return "navigation";
    if (lowerPath.includes("/feedback")) return "feedback";
    if (lowerPath.includes("/data") || lowerPath.includes("/display")) return "data-display";
    if (lowerPath.includes("/util")) return "utility";

    if (/button|btn|link/i.test(lowerName)) return "ui";
    if (/input|select|checkbox|radio|form|field/i.test(lowerName)) return "form";
    if (/header|footer|sidebar|container|grid/i.test(lowerName)) return "layout";
    if (/nav|menu|breadcrumb|tab/i.test(lowerName)) return "navigation";
    if (/table|list|card|avatar|badge/i.test(lowerName)) return "data-display";
    if (/alert|toast|modal|dialog/i.test(lowerName)) return "feedback";

    return "ui";
  }

  private calculateStats(
    components: ComponentInfo[],
    routes: APIRouteInfo[],
    models: DataModelInfo[]
  ): Manifest["stats"] {
    const byFramework: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let withLimitations = 0;
    let withTechDebt = 0;

    for (const comp of components) {
      byFramework[comp.framework] = (byFramework[comp.framework] || 0) + 1;
      if (comp.category) {
        byCategory[comp.category] = (byCategory[comp.category] || 0) + 1;
      }
      if (comp.limitations?.length) withLimitations++;
      if (comp.todos?.length || comp.fixmes?.length) withTechDebt++;
    }

    return {
      totalComponents: components.length,
      totalRoutes: routes.length,
      totalModels: models.length,
      byFramework,
      byCategory: Object.keys(byCategory).length > 0 ? byCategory : undefined,
      withLimitations,
      withTechDebt,
    };
  }
}

export { ManifestGenerator as default };
