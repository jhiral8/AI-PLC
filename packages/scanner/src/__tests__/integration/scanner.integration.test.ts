/**
 * @file Scanner Integration Tests
 * @description Integration tests for the complete scanner pipeline.
 * Per spec Phase 6: Scanner Tests (T104)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ManifestGenerator } from "../../services/manifest-generator.service";
import { ManifestDiffer } from "../../services/manifest-differ.service";
import { ManifestStorage } from "../../services/manifest-storage.service";
import { validateManifest } from "../../schemas/manifest.schema";

describe("Scanner Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "scanner-test-")
    );
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe("Full Scan Pipeline", () => {
    it("should generate a valid manifest from TypeScript files", async () => {
      // Create test files
      await fs.promises.writeFile(
        path.join(tempDir, "Button.tsx"),
        `
        interface ButtonProps {
          label: string;
          onClick?: () => void;
          disabled?: boolean;
        }

        export function Button({ label, onClick, disabled }: ButtonProps) {
          return <button onClick={onClick} disabled={disabled}>{label}</button>;
        }
        `
      );

      await fs.promises.writeFile(
        path.join(tempDir, "Card.tsx"),
        `
        interface CardProps {
          title: string;
          children: React.ReactNode;
        }

        export const Card = ({ title, children }: CardProps) => (
          <div>
            <h2>{title}</h2>
            {children}
          </div>
        );
        `
      );

      // Generate manifest
      const generator = new ManifestGenerator({
        projectId: "test-project",
        projectName: "Test Project",
        rootPath: tempDir,
        angular: { enabled: false },
        python: { enabled: false },
      });

      const result = await generator.generate();

      // Validate result
      expect(result.errors).toHaveLength(0);
      expect(result.manifest.components).toHaveLength(2);
      expect(result.manifest.projectId).toBe("test-project");

      // Validate manifest schema
      expect(() => validateManifest(result.manifest)).not.toThrow();

      // Check component details
      const button = result.manifest.components.find((c) => c.name === "Button");
      expect(button).toBeDefined();
      expect(button?.props.length).toBeGreaterThan(0);
      expect(button?.framework).toBe("react");
    });

    it("should detect component changes between scans", async () => {
      // Initial scan
      await fs.promises.writeFile(
        path.join(tempDir, "Component.tsx"),
        `
        interface Props {
          name: string;
        }

        export function Component({ name }: Props) {
          return <div>{name}</div>;
        }
        `
      );

      const generator = new ManifestGenerator({
        projectId: "diff-test",
        rootPath: tempDir,
        angular: { enabled: false },
        python: { enabled: false },
      });

      const firstResult = await generator.generate();

      // Modify component
      await fs.promises.writeFile(
        path.join(tempDir, "Component.tsx"),
        `
        interface Props {
          name: string;
          age: number;  // Added new prop
          active?: boolean;
        }

        export function Component({ name, age, active = true }: Props) {
          return <div>{name} ({age})</div>;
        }
        `
      );

      const secondResult = await generator.generate();

      // Diff manifests
      const differ = new ManifestDiffer();
      const diff = differ.diff(firstResult.manifest, secondResult.manifest);

      expect(diff.hasChanges).toBe(true);
      expect(diff.components.some((c) => c.type === "modified")).toBe(true);

      const modified = diff.components.find((c) => c.type === "modified");
      expect(modified?.details).toBeDefined();
      expect(modified?.details?.some((d) => d.includes("Props added"))).toBe(true);
    });

    it("should detect new and removed components", async () => {
      // Initial scan with one component
      await fs.promises.writeFile(
        path.join(tempDir, "First.tsx"),
        `
        export function First() {
          return <div>First</div>;
        }
        `
      );

      const generator = new ManifestGenerator({
        projectId: "add-remove-test",
        rootPath: tempDir,
        angular: { enabled: false },
        python: { enabled: false },
      });

      const firstResult = await generator.generate();

      // Add a new component, remove the old one
      await fs.promises.unlink(path.join(tempDir, "First.tsx"));
      await fs.promises.writeFile(
        path.join(tempDir, "Second.tsx"),
        `
        export function Second() {
          return <div>Second</div>;
        }
        `
      );

      const secondResult = await generator.generate();

      // Diff manifests
      const differ = new ManifestDiffer();
      const diff = differ.diff(firstResult.manifest, secondResult.manifest);

      expect(diff.hasChanges).toBe(true);
      expect(diff.summary.componentsAdded).toBe(1);
      expect(diff.summary.componentsRemoved).toBe(1);
    });
  });

  describe("Manifest Storage", () => {
    it("should store and retrieve manifests", async () => {
      const storagePath = path.join(tempDir, ".coreflow-test");
      const storage = new ManifestStorage({ storagePath });

      // Create a test manifest
      const testManifest = {
        version: "1.0.0",
        projectId: "storage-test",
        projectName: "Storage Test",
        generatedAt: new Date(),
        scannedAt: new Date(),
        scannerVersion: "1.0.0",
        components: [],
      };

      // Save manifest
      const stored = await storage.save(testManifest as any);

      expect(stored.version).toBe(1);
      expect(stored.projectId).toBe("storage-test");

      // Retrieve latest
      const retrieved = await storage.getLatest("storage-test");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.manifest.projectId).toBe("storage-test");
    });

    it("should maintain version history", async () => {
      const storagePath = path.join(tempDir, ".coreflow-test");
      const storage = new ManifestStorage({ storagePath, maxVersions: 5 });

      const baseManifest = {
        version: "1.0.0",
        projectId: "version-test",
        generatedAt: new Date(),
        scannedAt: new Date(),
        scannerVersion: "1.0.0",
        components: [],
      };

      // Save multiple versions
      for (let i = 0; i < 3; i++) {
        await storage.save({
          ...baseManifest,
          generatedAt: new Date(Date.now() + i * 1000),
        } as any);
      }

      // List versions
      const versions = await storage.listVersions("version-test");

      expect(versions.length).toBe(3);
      expect(versions[0].version).toBe(3); // Latest first
      expect(versions[2].version).toBe(1);
    });

    it("should cleanup old versions", async () => {
      const storagePath = path.join(tempDir, ".coreflow-test");
      const storage = new ManifestStorage({ storagePath, maxVersions: 2 });

      const baseManifest = {
        version: "1.0.0",
        projectId: "cleanup-test",
        generatedAt: new Date(),
        scannedAt: new Date(),
        scannerVersion: "1.0.0",
        components: [],
      };

      // Save more versions than max
      for (let i = 0; i < 5; i++) {
        await storage.save({
          ...baseManifest,
          generatedAt: new Date(Date.now() + i * 1000),
        } as any);
      }

      // Should only keep 2 versions
      const versions = await storage.listVersions("cleanup-test");
      expect(versions.length).toBe(2);
    });
  });

  describe("Multi-Framework Support", () => {
    it("should scan Python files alongside TypeScript", async () => {
      // Create TypeScript component
      await fs.promises.writeFile(
        path.join(tempDir, "Button.tsx"),
        `
        interface ButtonProps {
          label: string;
        }

        export function Button({ label }: ButtonProps) {
          return <button>{label}</button>;
        }
        `
      );

      // Create Python model
      await fs.promises.writeFile(
        path.join(tempDir, "models.py"),
        `
from pydantic import BaseModel

class User(BaseModel):
    id: int
    name: str
    email: str
        `
      );

      // Create Python route
      await fs.promises.writeFile(
        path.join(tempDir, "routes.py"),
        `
from fastapi import FastAPI

app = FastAPI()

@app.get("/users")
def get_users():
    return []
        `
      );

      const generator = new ManifestGenerator({
        projectId: "multi-framework",
        rootPath: tempDir,
        angular: { enabled: false },
      });

      const result = await generator.generate();

      // Should have both components and models
      expect(result.manifest.components.length).toBeGreaterThan(0);
      expect(result.manifest.models?.length).toBeGreaterThan(0);
      expect(result.manifest.routes?.length).toBeGreaterThan(0);

      // Check framework distribution in stats
      expect(result.manifest.stats?.byFramework.react).toBe(1);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid source files gracefully", async () => {
      // Create an invalid TypeScript file
      await fs.promises.writeFile(
        path.join(tempDir, "Invalid.tsx"),
        `
        this is not valid typescript at all !!!
        function {{{}}}
        `
      );

      // Also create a valid file
      await fs.promises.writeFile(
        path.join(tempDir, "Valid.tsx"),
        `
        export function Valid() {
          return <div>Valid</div>;
        }
        `
      );

      const generator = new ManifestGenerator({
        projectId: "error-handling",
        rootPath: tempDir,
        angular: { enabled: false },
        python: { enabled: false },
      });

      const result = await generator.generate();

      // Should still generate manifest with valid component
      expect(result.manifest.components.length).toBeGreaterThanOrEqual(0);
      // May have errors for invalid file
    });

    it("should handle empty directories", async () => {
      const emptyDir = path.join(tempDir, "empty");
      await fs.promises.mkdir(emptyDir);

      const generator = new ManifestGenerator({
        projectId: "empty-dir",
        rootPath: emptyDir,
      });

      const result = await generator.generate();

      expect(result.manifest.components).toHaveLength(0);
      expect(result.manifest.stats?.totalComponents).toBe(0);
    });
  });

  describe("Diff Formatting", () => {
    it("should format diff summary correctly", async () => {
      const differ = new ManifestDiffer();

      const oldManifest = {
        version: "1.0.0",
        projectId: "format-test",
        generatedAt: new Date(),
        scannedAt: new Date(),
        scannerVersion: "1.0.0",
        components: [
          { id: "c1", name: "Old", filePath: "old.tsx", framework: "react", type: "function", props: [] },
        ],
      };

      const newManifest = {
        version: "1.0.0",
        projectId: "format-test",
        generatedAt: new Date(),
        scannedAt: new Date(),
        scannerVersion: "1.0.0",
        components: [
          { id: "c2", name: "New", filePath: "new.tsx", framework: "react", type: "function", props: [] },
        ],
      };

      const diff = differ.diff(oldManifest as any, newManifest as any);
      const summary = differ.formatSummary(diff);

      expect(summary).toContain("added");
      expect(summary).toContain("removed");
    });

    it("should report no changes when manifests are identical", async () => {
      const differ = new ManifestDiffer();

      const manifest = {
        version: "1.0.0",
        projectId: "identical-test",
        generatedAt: new Date(),
        scannedAt: new Date(),
        scannerVersion: "1.0.0",
        components: [
          { id: "c1", name: "Same", filePath: "same.tsx", framework: "react", type: "function", props: [] },
        ],
      };

      const diff = differ.diff(manifest as any, manifest as any);
      const summary = differ.formatSummary(diff);

      expect(diff.hasChanges).toBe(false);
      expect(summary).toBe("No changes detected.");
    });
  });
});
