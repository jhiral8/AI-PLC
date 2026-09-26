/**
 * @file Manifest Differ Service
 * @module @coreflow/scanner/services/manifest-differ.service
 * @description
 * Detects changes between manifest versions to enable incremental scanning.
 * Per spec Phase 6: Scanner - Manifest Diffing (T096)
 */

import type {
  Manifest,
  ComponentInfo,
  APIRouteInfo,
  DataModelInfo,
} from "../schemas/manifest.schema";

// ============================================================================
// Types
// ============================================================================

export type ChangeType = "added" | "removed" | "modified";

export interface ComponentChange {
  type: ChangeType;
  componentId: string;
  componentName: string;
  filePath: string;
  framework: string;
  details?: string[];
}

export interface RouteChange {
  type: ChangeType;
  routeId: string;
  path: string;
  method: string;
  details?: string[];
}

export interface ModelChange {
  type: ChangeType;
  modelId: string;
  modelName: string;
  details?: string[];
}

export interface ManifestDiff {
  hasChanges: boolean;
  
  // Summary
  summary: {
    componentsAdded: number;
    componentsRemoved: number;
    componentsModified: number;
    routesAdded: number;
    routesRemoved: number;
    routesModified: number;
    modelsAdded: number;
    modelsRemoved: number;
    modelsModified: number;
  };
  
  // Detailed changes
  components: ComponentChange[];
  routes: RouteChange[];
  models: ModelChange[];
  
  // Metadata changes
  metadataChanges: string[];
  
  // Timestamps
  oldManifestDate: Date;
  newManifestDate: Date;
}

// ============================================================================
// ManifestDiffer Class
// ============================================================================

export class ManifestDiffer {
  /**
   * Compare two manifests and generate a diff
   */
  diff(oldManifest: Manifest, newManifest: Manifest): ManifestDiff {
    const componentChanges = this.diffComponents(
      oldManifest.components,
      newManifest.components
    );
    
    const routeChanges = this.diffRoutes(
      oldManifest.routes || [],
      newManifest.routes || []
    );
    
    const modelChanges = this.diffModels(
      oldManifest.models || [],
      newManifest.models || []
    );
    
    const metadataChanges = this.diffMetadata(oldManifest, newManifest);
    
    const summary = {
      componentsAdded: componentChanges.filter((c) => c.type === "added").length,
      componentsRemoved: componentChanges.filter((c) => c.type === "removed").length,
      componentsModified: componentChanges.filter((c) => c.type === "modified").length,
      routesAdded: routeChanges.filter((r) => r.type === "added").length,
      routesRemoved: routeChanges.filter((r) => r.type === "removed").length,
      routesModified: routeChanges.filter((r) => r.type === "modified").length,
      modelsAdded: modelChanges.filter((m) => m.type === "added").length,
      modelsRemoved: modelChanges.filter((m) => m.type === "removed").length,
      modelsModified: modelChanges.filter((m) => m.type === "modified").length,
    };
    
    const hasChanges = 
      componentChanges.length > 0 ||
      routeChanges.length > 0 ||
      modelChanges.length > 0 ||
      metadataChanges.length > 0;
    
    return {
      hasChanges,
      summary,
      components: componentChanges,
      routes: routeChanges,
      models: modelChanges,
      metadataChanges,
      oldManifestDate: new Date(oldManifest.generatedAt),
      newManifestDate: new Date(newManifest.generatedAt),
    };
  }
  
  // ==========================================================================
  // Component Diffing
  // ==========================================================================
  
  private diffComponents(
    oldComponents: ComponentInfo[],
    newComponents: ComponentInfo[]
  ): ComponentChange[] {
    const changes: ComponentChange[] = [];
    const oldMap = new Map(oldComponents.map((c) => [c.id, c]));
    const newMap = new Map(newComponents.map((c) => [c.id, c]));
    
    // Find added components
    for (const [id, comp] of newMap) {
      if (!oldMap.has(id)) {
        changes.push({
          type: "added",
          componentId: id,
          componentName: comp.name,
          filePath: comp.filePath,
          framework: comp.framework,
        });
      }
    }
    
    // Find removed components
    for (const [id, comp] of oldMap) {
      if (!newMap.has(id)) {
        changes.push({
          type: "removed",
          componentId: id,
          componentName: comp.name,
          filePath: comp.filePath,
          framework: comp.framework,
        });
      }
    }
    
    // Find modified components
    for (const [id, newComp] of newMap) {
      const oldComp = oldMap.get(id);
      if (oldComp) {
        const details = this.getComponentDifferences(oldComp, newComp);
        if (details.length > 0) {
          changes.push({
            type: "modified",
            componentId: id,
            componentName: newComp.name,
            filePath: newComp.filePath,
            framework: newComp.framework,
            details,
          });
        }
      }
    }
    
    return changes;
  }
  
  private getComponentDifferences(
    oldComp: ComponentInfo,
    newComp: ComponentInfo
  ): string[] {
    const differences: string[] = [];
    
    // Check description
    if (oldComp.description !== newComp.description) {
      differences.push("Description changed");
    }
    
    // Check props
    const oldPropNames = new Set(oldComp.props.map((p) => p.name));
    const newPropNames = new Set(newComp.props.map((p) => p.name));
    
    const addedProps = [...newPropNames].filter((n) => !oldPropNames.has(n));
    const removedProps = [...oldPropNames].filter((n) => !newPropNames.has(n));
    
    if (addedProps.length > 0) {
      differences.push(`Props added: ${addedProps.join(", ")}`);
    }
    if (removedProps.length > 0) {
      differences.push(`Props removed: ${removedProps.join(", ")}`);
    }
    
    // Check for prop type changes
    for (const newProp of newComp.props) {
      const oldProp = oldComp.props.find((p) => p.name === newProp.name);
      if (oldProp) {
        if (oldProp.type !== newProp.type) {
          differences.push(`Prop '${newProp.name}' type changed: ${oldProp.type} → ${newProp.type}`);
        }
        if (oldProp.required !== newProp.required) {
          differences.push(`Prop '${newProp.name}' ${newProp.required ? "now required" : "now optional"}`);
        }
      }
    }
    
    // Check category
    if (oldComp.category !== newComp.category) {
      differences.push(`Category changed: ${oldComp.category} → ${newComp.category}`);
    }
    
    // Check export type
    if (oldComp.exportType !== newComp.exportType) {
      differences.push(`Export type changed: ${oldComp.exportType} → ${newComp.exportType}`);
    }
    
    // Check limitations
    const oldLimitCount = oldComp.limitations?.length || 0;
    const newLimitCount = newComp.limitations?.length || 0;
    if (oldLimitCount !== newLimitCount) {
      differences.push(`Limitations count changed: ${oldLimitCount} → ${newLimitCount}`);
    }
    
    return differences;
  }
  
  // ==========================================================================
  // Route Diffing
  // ==========================================================================
  
  private diffRoutes(
    oldRoutes: APIRouteInfo[],
    newRoutes: APIRouteInfo[]
  ): RouteChange[] {
    const changes: RouteChange[] = [];
    const oldMap = new Map(oldRoutes.map((r) => [r.id, r]));
    const newMap = new Map(newRoutes.map((r) => [r.id, r]));
    
    // Find added routes
    for (const [id, route] of newMap) {
      if (!oldMap.has(id)) {
        changes.push({
          type: "added",
          routeId: id,
          path: route.path,
          method: route.method,
        });
      }
    }
    
    // Find removed routes
    for (const [id, route] of oldMap) {
      if (!newMap.has(id)) {
        changes.push({
          type: "removed",
          routeId: id,
          path: route.path,
          method: route.method,
        });
      }
    }
    
    // Find modified routes
    for (const [id, newRoute] of newMap) {
      const oldRoute = oldMap.get(id);
      if (oldRoute) {
        const details = this.getRouteDifferences(oldRoute, newRoute);
        if (details.length > 0) {
          changes.push({
            type: "modified",
            routeId: id,
            path: newRoute.path,
            method: newRoute.method,
            details,
          });
        }
      }
    }
    
    return changes;
  }
  
  private getRouteDifferences(
    oldRoute: APIRouteInfo,
    newRoute: APIRouteInfo
  ): string[] {
    const differences: string[] = [];
    
    if (oldRoute.path !== newRoute.path) {
      differences.push(`Path changed: ${oldRoute.path} → ${newRoute.path}`);
    }
    
    if (oldRoute.method !== newRoute.method) {
      differences.push(`Method changed: ${oldRoute.method} → ${newRoute.method}`);
    }
    
    if (oldRoute.description !== newRoute.description) {
      differences.push("Description changed");
    }
    
    if (oldRoute.responseModel !== newRoute.responseModel) {
      differences.push(`Response model changed: ${oldRoute.responseModel || "none"} → ${newRoute.responseModel || "none"}`);
    }
    
    if (oldRoute.deprecated !== newRoute.deprecated) {
      differences.push(newRoute.deprecated ? "Now deprecated" : "No longer deprecated");
    }
    
    // Check parameters
    const oldParamCount = oldRoute.parameters?.length || 0;
    const newParamCount = newRoute.parameters?.length || 0;
    if (oldParamCount !== newParamCount) {
      differences.push(`Parameter count changed: ${oldParamCount} → ${newParamCount}`);
    }
    
    return differences;
  }
  
  // ==========================================================================
  // Model Diffing
  // ==========================================================================
  
  private diffModels(
    oldModels: DataModelInfo[],
    newModels: DataModelInfo[]
  ): ModelChange[] {
    const changes: ModelChange[] = [];
    const oldMap = new Map(oldModels.map((m) => [m.id, m]));
    const newMap = new Map(newModels.map((m) => [m.id, m]));
    
    // Find added models
    for (const [id, model] of newMap) {
      if (!oldMap.has(id)) {
        changes.push({
          type: "added",
          modelId: id,
          modelName: model.name,
        });
      }
    }
    
    // Find removed models
    for (const [id, model] of oldMap) {
      if (!newMap.has(id)) {
        changes.push({
          type: "removed",
          modelId: id,
          modelName: model.name,
        });
      }
    }
    
    // Find modified models
    for (const [id, newModel] of newMap) {
      const oldModel = oldMap.get(id);
      if (oldModel) {
        const details = this.getModelDifferences(oldModel, newModel);
        if (details.length > 0) {
          changes.push({
            type: "modified",
            modelId: id,
            modelName: newModel.name,
            details,
          });
        }
      }
    }
    
    return changes;
  }
  
  private getModelDifferences(
    oldModel: DataModelInfo,
    newModel: DataModelInfo
  ): string[] {
    const differences: string[] = [];
    
    if (oldModel.description !== newModel.description) {
      differences.push("Description changed");
    }
    
    if (oldModel.baseClass !== newModel.baseClass) {
      differences.push(`Base class changed: ${oldModel.baseClass} → ${newModel.baseClass}`);
    }
    
    // Check fields
    const oldFieldNames = new Set(oldModel.fields.map((f) => f.name));
    const newFieldNames = new Set(newModel.fields.map((f) => f.name));
    
    const addedFields = [...newFieldNames].filter((n) => !oldFieldNames.has(n));
    const removedFields = [...oldFieldNames].filter((n) => !newFieldNames.has(n));
    
    if (addedFields.length > 0) {
      differences.push(`Fields added: ${addedFields.join(", ")}`);
    }
    if (removedFields.length > 0) {
      differences.push(`Fields removed: ${removedFields.join(", ")}`);
    }
    
    // Check field type changes
    for (const newField of newModel.fields) {
      const oldField = oldModel.fields.find((f) => f.name === newField.name);
      if (oldField && oldField.type !== newField.type) {
        differences.push(`Field '${newField.name}' type changed: ${oldField.type} → ${newField.type}`);
      }
    }
    
    return differences;
  }
  
  // ==========================================================================
  // Metadata Diffing
  // ==========================================================================
  
  private diffMetadata(
    oldManifest: Manifest,
    newManifest: Manifest
  ): string[] {
    const changes: string[] = [];
    
    if (oldManifest.version !== newManifest.version) {
      changes.push(`Manifest version changed: ${oldManifest.version} → ${newManifest.version}`);
    }
    
    if (oldManifest.scannerVersion !== newManifest.scannerVersion) {
      changes.push(`Scanner version changed: ${oldManifest.scannerVersion} → ${newManifest.scannerVersion}`);
    }
    
    if (oldManifest.projectName !== newManifest.projectName) {
      changes.push(`Project name changed: ${oldManifest.projectName} → ${newManifest.projectName}`);
    }
    
    const oldRepo = oldManifest.repository;
    const newRepo = newManifest.repository;
    
    if (oldRepo?.branch !== newRepo?.branch) {
      changes.push(`Branch changed: ${oldRepo?.branch || "none"} → ${newRepo?.branch || "none"}`);
    }
    
    if (oldRepo?.commitHash !== newRepo?.commitHash) {
      changes.push(`Commit changed: ${oldRepo?.commitHash?.slice(0, 8) || "none"} → ${newRepo?.commitHash?.slice(0, 8) || "none"}`);
    }
    
    return changes;
  }
  
  // ==========================================================================
  // Utility Methods
  // ==========================================================================
  
  /**
   * Generate a human-readable summary of the diff
   */
  formatSummary(diff: ManifestDiff): string {
    if (!diff.hasChanges) {
      return "No changes detected.";
    }
    
    const lines: string[] = [];
    const { summary } = diff;
    
    if (summary.componentsAdded > 0) {
      lines.push(`+ ${summary.componentsAdded} component(s) added`);
    }
    if (summary.componentsRemoved > 0) {
      lines.push(`- ${summary.componentsRemoved} component(s) removed`);
    }
    if (summary.componentsModified > 0) {
      lines.push(`~ ${summary.componentsModified} component(s) modified`);
    }
    
    if (summary.routesAdded > 0) {
      lines.push(`+ ${summary.routesAdded} route(s) added`);
    }
    if (summary.routesRemoved > 0) {
      lines.push(`- ${summary.routesRemoved} route(s) removed`);
    }
    if (summary.routesModified > 0) {
      lines.push(`~ ${summary.routesModified} route(s) modified`);
    }
    
    if (summary.modelsAdded > 0) {
      lines.push(`+ ${summary.modelsAdded} model(s) added`);
    }
    if (summary.modelsRemoved > 0) {
      lines.push(`- ${summary.modelsRemoved} model(s) removed`);
    }
    if (summary.modelsModified > 0) {
      lines.push(`~ ${summary.modelsModified} model(s) modified`);
    }
    
    if (diff.metadataChanges.length > 0) {
      lines.push(`Metadata: ${diff.metadataChanges.length} change(s)`);
    }
    
    return lines.join("\n");
  }
}

export { ManifestDiffer as default };
