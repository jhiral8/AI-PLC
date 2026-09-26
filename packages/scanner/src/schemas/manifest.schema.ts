/**
 * @file Manifest Schema
 * @module @coreflow/scanner/schemas/manifest.schema
 * @description
 * Defines the library-manifest.json schema for component manifests.
 * Per spec Phase 6: Scanner - AST Parsers (T094)
 */

import { z } from "zod";

// ============================================================================
// Prop Schema
// ============================================================================

export const PropSchema = z.object({
  name: z.string().describe("Property name"),
  type: z.string().describe("TypeScript/Python type"),
  required: z.boolean().describe("Whether the prop is required"),
  defaultValue: z.string().optional().describe("Default value if any"),
  description: z.string().optional().describe("JSDoc/docstring description"),
  deprecated: z.boolean().optional().describe("Whether the prop is deprecated"),
  deprecationReason: z.string().optional().describe("Reason for deprecation"),
  alias: z.string().optional().describe("Alternative name (e.g., Angular input alias)"),
  validation: z.array(z.string()).optional().describe("Validation rules"),
});

export type PropInfo = z.infer<typeof PropSchema>;

// ============================================================================
// Limitation Schema
// ============================================================================

export const LimitationSchema = z.object({
  type: z.enum([
    "performance",
    "not_supported",
    "requires",
    "browser",
    "accessibility",
    "other",
  ]).describe("Type of limitation"),
  description: z.string().describe("Human-readable description"),
  keywords: z.array(z.string()).describe("Keywords for matching in PRDs"),
  severity: z.enum(["error", "warning", "info"]).describe("How severe is this limitation"),
  workaround: z.string().optional().describe("Suggested workaround"),
});

export type LimitationInfo = z.infer<typeof LimitationSchema>;

// ============================================================================
// Component Schema
// ============================================================================

export const ComponentSchema = z.object({
  // Identity
  id: z.string().describe("Unique component ID"),
  name: z.string().describe("Component class/function name"),
  displayName: z.string().optional().describe("Human-friendly display name"),
  description: z.string().optional().describe("Component description"),
  filePath: z.string().describe("Relative path to component file"),
  
  // Classification
  category: z.enum([
    "ui",
    "layout",
    "form",
    "navigation",
    "data-display",
    "feedback",
    "utility",
    "other",
  ]).optional().describe("Component category"),
  
  // Framework-specific
  framework: z.enum(["react", "angular", "python", "vue", "other"]).describe("Source framework"),
  type: z.enum([
    "function",
    "class", 
    "arrow",
    "forwardRef",
    "directive",
    "service",
    "model",
    "route",
  ]).describe("Component type"),
  
  // Props/Inputs
  props: z.array(PropSchema).describe("Component props/inputs"),
  
  // Outputs (Angular/Events)
  outputs: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string().optional(),
  })).optional().describe("Component outputs/events"),
  
  // Capabilities
  supportsInfiniteScroll: z.boolean().optional(),
  supportsPagination: z.boolean().optional(),
  supportsVirtualization: z.boolean().optional(),
  supportsOffline: z.boolean().optional(),
  supportsRealTime: z.boolean().optional(),
  
  // Accessibility
  hasAriaLabels: z.boolean().optional(),
  keyboardNavigable: z.boolean().optional(),
  
  // Limitations
  limitations: z.array(LimitationSchema).optional().describe("Known limitations"),
  
  // Technical Debt
  todos: z.array(z.string()).optional().describe("TODO comments"),
  fixmes: z.array(z.string()).optional().describe("FIXME comments"),
  
  // Dependencies
  dependencies: z.array(z.string()).optional().describe("Direct dependencies"),
  peerDependencies: z.array(z.string()).optional().describe("Peer dependencies"),
  
  // Metadata
  exportType: z.enum(["default", "named", "both"]).optional(),
  tags: z.array(z.string()).optional().describe("Custom tags"),
});

export type ComponentInfo = z.infer<typeof ComponentSchema>;

// ============================================================================
// API Route Schema (for Python/FastAPI)
// ============================================================================

export const APIRouteSchema = z.object({
  id: z.string().describe("Unique route ID"),
  path: z.string().describe("Route path"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]),
  functionName: z.string().describe("Handler function name"),
  filePath: z.string().describe("Relative path to route file"),
  description: z.string().optional(),
  parameters: z.array(z.object({
    name: z.string(),
    type: z.string(),
    location: z.enum(["path", "query", "body", "header", "cookie"]),
    required: z.boolean(),
    default: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
  responseModel: z.string().optional(),
  tags: z.array(z.string()).optional(),
  deprecated: z.boolean().optional(),
});

export type APIRouteInfo = z.infer<typeof APIRouteSchema>;

// ============================================================================
// Data Model Schema (for Pydantic)
// ============================================================================

export const DataModelSchema = z.object({
  id: z.string().describe("Unique model ID"),
  name: z.string().describe("Model class name"),
  filePath: z.string().describe("Relative path to model file"),
  baseClass: z.string().describe("Base class (e.g., BaseModel)"),
  description: z.string().optional(),
  fields: z.array(PropSchema),
  validators: z.array(z.string()).optional(),
  configOptions: z.record(z.string()).optional(),
});

export type DataModelInfo = z.infer<typeof DataModelSchema>;

// ============================================================================
// Full Manifest Schema
// ============================================================================

export const ManifestSchema = z.object({
  // Metadata
  version: z.string().describe("Manifest schema version"),
  projectId: z.string().describe("Project identifier"),
  projectName: z.string().optional().describe("Human-friendly project name"),
  
  // Source info
  repository: z.object({
    url: z.string().optional(),
    branch: z.string().optional(),
    commitHash: z.string().optional(),
  }).optional(),
  
  // Timestamps
  generatedAt: z.coerce.date().describe("When manifest was generated"),
  scannedAt: z.coerce.date().describe("When source was last scanned"),
  
  // Scanner info
  scannerVersion: z.string().describe("Scanner version used"),
  scanDurationMs: z.number().optional().describe("How long the scan took"),
  
  // Content
  components: z.array(ComponentSchema).describe("UI components"),
  routes: z.array(APIRouteSchema).optional().describe("API routes"),
  models: z.array(DataModelSchema).optional().describe("Data models"),
  
  // Statistics
  stats: z.object({
    totalComponents: z.number(),
    totalRoutes: z.number().optional(),
    totalModels: z.number().optional(),
    byFramework: z.record(z.number()),
    byCategory: z.record(z.number()).optional(),
    withLimitations: z.number(),
    withTechDebt: z.number(),
  }).optional(),
  
  // Errors during scanning
  errors: z.array(z.string()).optional().describe("Errors encountered during scanning"),
});

export type Manifest = z.infer<typeof ManifestSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a manifest object
 */
export function validateManifest(data: unknown): Manifest {
  return ManifestSchema.parse(data);
}

/**
 * Safe validation that returns errors instead of throwing
 */
export function safeValidateManifest(data: unknown): {
  success: boolean;
  data?: Manifest;
  errors?: string[];
} {
  const result = ManifestSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
  };
}

// ============================================================================
// Export
// ============================================================================

export const manifestSchema = {
  ManifestSchema,
  ComponentSchema,
  PropSchema,
  LimitationSchema,
  APIRouteSchema,
  DataModelSchema,
  validateManifest,
  safeValidateManifest,
};
