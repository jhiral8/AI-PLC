/**
 * @file Feature Matcher Unit Tests
 * @module @coreflow/core/services/constraints/feature-matcher.test
 * @description
 * Unit tests for the LLM-based feature-to-component matcher.
 * Per spec Phase 5: US2 - Task T084
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  matchFeature,
  quickMatch,
  featureMatcher,
  type FeatureMatch,
  type FeatureMatchResult,
  type FeatureMatchInput,
} from "./feature-matcher";
import type { ComponentManifest } from "./manifest-compiler";

// ============================================================================
// Mocks
// ============================================================================

// Mock the LLM gateway
vi.mock("./lib/llm", () => ({
  generateJSON: vi.fn().mockResolvedValue({
    featureType: "data_display",
    keywords: ["table", "data", "list"],
    impliedCapabilities: ["pagination"],
    potentialComponents: [
      {
        componentName: "DataTable",
        confidence: 0.9,
        reasoning: "Best fit for data display",
      },
    ],
  }),
  complete: vi.fn().mockResolvedValue("Mock response"),
}));

// ============================================================================
// Test Data
// ============================================================================

const mockComponents: ComponentManifest[] = [
  {
    id: "data-table",
    name: "DataTable",
    displayName: "Data Table",
    description: "A high-performance data table component",
    filePath: "src/components/ui/DataTable.tsx",
    category: "ui",
    props: [],
    limitations: [
      {
        type: "performance",
        description: "Performance degrades with >10,000 rows",
        keywords: ["large dataset", "many rows"],
        severity: "warning",
      },
    ],
    todos: [],
    fixmes: [],
    supportsInfiniteScroll: false,
    supportsPagination: true,
    supportsVirtualization: true,
    supportsOffline: false,
    supportsRealTime: false,
    hasAriaLabels: true,
    keyboardNavigable: true,
    dependencies: [],
    peerDependencies: [],
  },
  {
    id: "list-view",
    name: "ListView",
    displayName: "List View",
    description: "A list component with infinite scroll support",
    filePath: "src/components/ui/ListView.tsx",
    category: "ui",
    props: [],
    limitations: [],
    todos: [],
    fixmes: [],
    supportsInfiniteScroll: true,
    supportsPagination: false,
    supportsVirtualization: true,
    supportsOffline: false,
    supportsRealTime: true,
    hasAriaLabels: true,
    keyboardNavigable: true,
    dependencies: [],
    peerDependencies: [],
  },
];

// ============================================================================
// Tests
// ============================================================================

describe("FeatureMatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("quickMatch", () => {
    it("should match features using keyword-based matching", () => {
      const result = quickMatch("infinite scroll for user list", mockComponents);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should find matching components that lack required feature", () => {
      const result = quickMatch("infinite scroll loading", mockComponents);

      // DataTable doesn't support infinite scroll, should be flagged
      const dataTableMatch = result.find((m) => m.componentId === "data-table");
      expect(dataTableMatch).toBeDefined();
      expect(dataTableMatch?.potentialIssues.length).toBeGreaterThan(0);
    });

    it("should not flag components that support the feature", () => {
      const result = quickMatch("infinite scroll loading", mockComponents);

      // ListView supports infinite scroll, shouldn't be flagged
      const listViewMatch = result.find((m) => m.componentId === "list-view");
      expect(listViewMatch).toBeUndefined();
    });

    it("should detect real-time feature requirements", () => {
      const result = quickMatch("real-time updates", mockComponents);

      // DataTable doesn't support real-time
      const dataTableMatch = result.find((m) => m.componentId === "data-table");
      expect(dataTableMatch).toBeDefined();
      expect(dataTableMatch?.reasoning).toContain("real-time");
    });

    it("should handle no matches", () => {
      const result = quickMatch("basic text input", mockComponents);

      // No specific feature conflicts
      expect(result).toHaveLength(0);
    });

    it("should be case insensitive", () => {
      const result1 = quickMatch("INFINITE SCROLL", mockComponents);
      const result2 = quickMatch("infinite scroll", mockComponents);

      expect(result1.length).toBe(result2.length);
    });

    it("should return results with proper structure", () => {
      const result = quickMatch("infinite scroll", mockComponents);

      if (result.length > 0) {
        const match = result[0]!;
        expect(match).toHaveProperty("componentId");
        expect(match).toHaveProperty("componentName");
        expect(match).toHaveProperty("confidence");
        expect(match).toHaveProperty("reasoning");
        expect(match).toHaveProperty("potentialIssues");
        expect(Array.isArray(match.potentialIssues)).toBe(true);
      }
    });

    it("should include issue details", () => {
      const result = quickMatch("infinite scroll", mockComponents);

      if (result.length > 0 && result[0]!.potentialIssues.length > 0) {
        const issue = result[0]!.potentialIssues[0]!;
        expect(issue).toHaveProperty("issue");
        expect(issue).toHaveProperty("severity");
        expect(issue).toHaveProperty("suggestion");
      }
    });
  });

  describe("featureMatcher.quickMatch", () => {
    it("should be accessible via the exported object", () => {
      expect(typeof featureMatcher.quickMatch).toBe("function");

      const result = featureMatcher.quickMatch("pagination", mockComponents);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Match confidence", () => {
    it("should return confidence scores between 0 and 1", () => {
      const result = quickMatch("infinite scroll with live updates", mockComponents);

      result.forEach((match) => {
        expect(match.confidence).toBeGreaterThanOrEqual(0);
        expect(match.confidence).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("Edge cases", () => {
    it("should handle empty components array", () => {
      const result = quickMatch("pagination", []);

      expect(result).toHaveLength(0);
    });

    it("should handle empty query", () => {
      const result = quickMatch("", mockComponents);

      expect(result).toHaveLength(0);
    });

    it("should handle special characters in query", () => {
      // Should not throw
      const result = quickMatch("real-time & live updates!", mockComponents);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Performance", () => {
    it("should complete quick match in under 10ms", () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        quickMatch("infinite scroll", mockComponents);
      }

      const duration = performance.now() - start;
      const avgTime = duration / 100;

      // Average should be well under 10ms for quick match
      expect(avgTime).toBeLessThan(10);
    });

    it("should handle large component lists efficiently", () => {
      // Create a large list of components
      const largeComponents: ComponentManifest[] = Array.from(
        { length: 100 },
        (_, i) => ({
          id: `component-${i}`,
          name: `Component${i}`,
          filePath: `src/components/Component${i}.tsx`,
          props: [],
          limitations: [],
          todos: [],
          fixmes: [],
          supportsInfiniteScroll: i % 2 === 0, // Half support infinite scroll
          supportsPagination: true,
          supportsVirtualization: false,
          supportsOffline: false,
          supportsRealTime: i % 3 === 0, // Third support real-time
          hasAriaLabels: true,
          keyboardNavigable: true,
          dependencies: [],
          peerDependencies: [],
        })
      );

      const start = performance.now();
      const result = quickMatch("infinite scroll", largeComponents);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50); // Should complete in under 50ms
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("Feature detection", () => {
    it("should detect infinite scroll keywords", () => {
      const keywords = ["infinite scroll", "endless scroll", "infinite loading", "load more"];

      keywords.forEach((keyword) => {
        const result = quickMatch(keyword, mockComponents);
        expect(result.length).toBeGreaterThan(0);
      });
    });

    it("should detect real-time keywords", () => {
      const keywords = ["real-time", "realtime", "live updates", "instant"];

      keywords.forEach((keyword) => {
        const result = quickMatch(keyword, mockComponents);
        // DataTable doesn't support real-time
        const dataTableMatch = result.find((m) => m.componentId === "data-table");
        expect(dataTableMatch).toBeDefined();
      });
    });

    it("should detect offline keywords", () => {
      const result = quickMatch("works offline mode", mockComponents);

      // Both components don't support offline
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
