/**
 * @file Manifest Compiler Unit Tests
 * @module @coreflow/core/services/constraints/manifest-compiler.test
 * @description
 * Unit tests for the manifest-to-constraints compiler.
 * Per spec Phase 5: US2 - Task T083
 */

import { describe, it, expect } from "vitest";
import {
  compileManifest,
  compileComponent,
  manifestCompiler,
  type ProjectManifest,
  type ComponentManifest,
} from "./manifest-compiler";

// ============================================================================
// Test Data
// ============================================================================

const mockComponent: ComponentManifest = {
  id: "data-table",
  name: "DataTable",
  displayName: "Data Table",
  description: "A data table component",
  filePath: "src/components/ui/DataTable.tsx",
  category: "ui",
  props: [
    {
      name: "data",
      type: "T[]",
      required: true,
      description: "The data to display",
      deprecated: false,
    },
  ],
  limitations: [
    {
      type: "performance",
      description: "Performance degrades with >10,000 rows without virtualization",
      keywords: ["large dataset", "many rows", "10000 rows"],
      severity: "warning",
      workaround: "Enable virtualization or use pagination",
    },
    {
      type: "not_supported",
      description: "Infinite scroll is not supported",
      keywords: ["infinite scroll", "endless scroll"],
      severity: "error",
    },
  ],
  todos: ["Add column resize support"],
  fixmes: ["Memory leak when unmounting with pending requests"],
  supportsInfiniteScroll: false,
  supportsPagination: true,
  supportsVirtualization: true,
  supportsOffline: false,
  supportsRealTime: false,
  hasAriaLabels: true,
  keyboardNavigable: true,
  dependencies: ["react"],
  peerDependencies: [],
};

const mockManifest: ProjectManifest = {
  projectId: "test-project",
  components: [mockComponent],
  generatedAt: new Date(),
  scannerVersion: "1.0.0",
};

// ============================================================================
// Tests
// ============================================================================

describe("ManifestCompiler", () => {
  describe("compileManifest", () => {
    it("should compile a project manifest into constraint rules", () => {
      const result = compileManifest(mockManifest);

      expect(result).toBeDefined();
      expect(result.projectId).toBe("test-project");
      expect(result.rules.length).toBeGreaterThan(0);
      expect(result.version).toBe("1.0.0");
    });

    it("should generate rules from component limitations", () => {
      const result = compileManifest(mockManifest, { includeBuiltIn: false });

      // Check for limitation-derived rule
      const infiniteScrollRule = result.rules.find(
        (r) => r.description.includes("Infinite scroll is not supported")
      );

      expect(infiniteScrollRule).toBeDefined();
      expect(infiniteScrollRule?.severity).toBe("error");
    });

    it("should generate rules for unsupported features", () => {
      const result = compileManifest(mockManifest, { includeBuiltIn: false });

      // Should have rule for no infinite scroll
      const noInfiniteRule = result.rules.find(
        (r) => r.id.includes("no-infinite-scroll")
      );

      expect(noInfiniteRule).toBeDefined();
    });

    it("should include tech debt rules when enabled", () => {
      const result = compileManifest(mockManifest, {
        includeBuiltIn: false,
        includeTechDebt: true,
      });

      // Should have rules from TODOs and FIXMEs
      const techDebtRule = result.rules.find(
        (r) => r.category === "technical_debt" && r.tags?.includes("tech-debt")
      );

      expect(techDebtRule).toBeDefined();
    });

    it("should exclude tech debt rules when disabled", () => {
      const result = compileManifest(mockManifest, {
        includeBuiltIn: false,
        includeTechDebt: false,
      });

      const techDebtRule = result.rules.find(
        (r) => r.tags?.includes("todo") || r.tags?.includes("fixme")
      );

      expect(techDebtRule).toBeUndefined();
    });

    it("should filter by severity", () => {
      const result = compileManifest(mockManifest, {
        includeBuiltIn: false,
        minSeverity: "error",
      });

      // All rules should be error severity
      result.rules.forEach((rule) => {
        expect(rule.severity).toBe("error");
      });
    });

    it("should handle empty manifest", () => {
      const emptyManifest: ProjectManifest = {
        projectId: "empty-project",
        components: [],
        generatedAt: new Date(),
      };

      const result = compileManifest(emptyManifest, { includeBuiltIn: false });

      expect(result.rules).toHaveLength(0);
    });

    it("should include built-in rules by default", () => {
      const result = compileManifest(mockManifest);

      // Built-in rules should be included
      expect(result.rules.length).toBeGreaterThan(0);
    });

    it("should include metadata in constraint manifest", () => {
      const result = compileManifest(mockManifest);

      expect(result.generatedAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("compileComponent", () => {
    it("should compile a single component into rules", () => {
      const rules = compileComponent(mockComponent, "test-project", {
        includeBuiltIn: false,
      });

      expect(rules.length).toBeGreaterThan(0);
    });

    it("should include limitation rules", () => {
      const rules = compileComponent(mockComponent, "test-project");

      const limitationRule = rules.find(
        (r) => r.source?.type === "manifest" && r.source?.componentId === "data-table"
      );

      expect(limitationRule).toBeDefined();
    });

    it("should include feature constraint rules", () => {
      const rules = compileComponent(mockComponent, "test-project");

      const featureRule = rules.find((r) => r.tags?.includes("feature"));

      expect(featureRule).toBeDefined();
    });

    it("should include component metadata in rule source", () => {
      const rules = compileComponent(mockComponent, "test-project");
      const rule = rules[0];

      expect(rule?.source?.componentId).toBe("data-table");
      expect(rule?.source?.componentName).toBe("Data Table");
      expect(rule?.source?.filePath).toBe("src/components/ui/DataTable.tsx");
    });
  });

  describe("manifestCompiler.extractKeywords", () => {
    it("should extract meaningful keywords from text", () => {
      const keywords = manifestCompiler.extractKeywords(
        "performance optimization for large datasets"
      );

      expect(keywords).toContain("performance");
      expect(keywords).toContain("optimization");
      expect(keywords).toContain("large");
      expect(keywords).toContain("datasets");
    });

    it("should filter out stop words", () => {
      const keywords = manifestCompiler.extractKeywords(
        "the component is not working properly"
      );

      expect(keywords).not.toContain("the");
      expect(keywords).not.toContain("is");
      expect(keywords).not.toContain("not");
    });

    it("should return max 5 keywords", () => {
      const keywords = manifestCompiler.extractKeywords(
        "performance optimization database cache storage memory buffer allocation heap stack"
      );

      expect(keywords.length).toBeLessThanOrEqual(5);
    });

    it("should return unique keywords", () => {
      const keywords = manifestCompiler.extractKeywords(
        "performance performance performance optimization optimization"
      );

      const unique = new Set(keywords);
      expect(keywords.length).toBe(unique.size);
    });
  });

  describe("Rule generation", () => {
    it("should generate rules with triggers", () => {
      const rules = compileComponent(mockComponent, "test-project");

      rules.forEach((rule) => {
        expect(rule.triggers).toBeDefined();
        expect(Array.isArray(rule.triggers)).toBe(true);
      });
    });

    it("should generate rules with suggestions when available", () => {
      const result = compileManifest(mockManifest, { includeBuiltIn: false });

      const rulesWithSuggestions = result.rules.filter(
        (r) => r.suggestions && r.suggestions.length > 0
      );

      expect(rulesWithSuggestions.length).toBeGreaterThan(0);
    });

    it("should categorize rules correctly", () => {
      const result = compileManifest(mockManifest, { includeBuiltIn: false });

      const categories = new Set(result.rules.map((r) => r.category));

      // Should have multiple categories
      expect(categories.size).toBeGreaterThan(0);
    });
  });
});
