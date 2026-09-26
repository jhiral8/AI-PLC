/**
 * @file Manifest Storage Service
 * @module @coreflow/scanner/services/manifest-storage.service
 * @description
 * Stores and retrieves manifests from the database.
 * Per spec Phase 6: Scanner - Manifest Storage (T097)
 */

import * as fs from "fs";
import * as path from "path";
import type { Manifest } from "../schemas/manifest.schema";

// ============================================================================
// Types
// ============================================================================

export interface StoredManifest {
  id: string;
  projectId: string;
  version: number;
  manifest: Manifest;
  createdAt: Date;
  fileHash?: string;
}

export interface ManifestStorageOptions {
  storagePath?: string;
  maxVersions?: number;
}

// ============================================================================
// ManifestStorage Class
// ============================================================================

/**
 * Local file-based manifest storage
 * In production, this would be replaced with database storage
 */
export class ManifestStorage {
  private storagePath: string;
  private maxVersions: number;

  constructor(options: ManifestStorageOptions = {}) {
    this.storagePath = options.storagePath || ".coreflow/manifests";
    this.maxVersions = options.maxVersions || 10;
  }

  /**
   * Save a manifest for a project
   */
  async save(manifest: Manifest): Promise<StoredManifest> {
    const projectDir = this.getProjectDir(manifest.projectId);
    await this.ensureDir(projectDir);

    // Get next version number
    const versions = await this.listVersions(manifest.projectId);
    const nextVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : 1;

    const stored: StoredManifest = {
      id: `${manifest.projectId}-v${nextVersion}`,
      projectId: manifest.projectId,
      version: nextVersion,
      manifest,
      createdAt: new Date(),
    };

    // Save manifest
    const filePath = path.join(projectDir, `v${nextVersion}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(stored, null, 2), "utf-8");

    // Save latest pointer
    const latestPath = path.join(projectDir, "latest.json");
    await fs.promises.writeFile(latestPath, JSON.stringify(stored, null, 2), "utf-8");

    // Cleanup old versions
    await this.cleanupOldVersions(manifest.projectId);

    return stored;
  }

  /**
   * Get the latest manifest for a project
   */
  async getLatest(projectId: string): Promise<StoredManifest | null> {
    const latestPath = path.join(this.getProjectDir(projectId), "latest.json");
    
    try {
      const content = await fs.promises.readFile(latestPath, "utf-8");
      const stored = JSON.parse(content) as StoredManifest;
      stored.createdAt = new Date(stored.createdAt);
      return stored;
    } catch {
      return null;
    }
  }

  /**
   * Get a specific version of a manifest
   */
  async getVersion(projectId: string, version: number): Promise<StoredManifest | null> {
    const filePath = path.join(this.getProjectDir(projectId), `v${version}.json`);
    
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const stored = JSON.parse(content) as StoredManifest;
      stored.createdAt = new Date(stored.createdAt);
      return stored;
    } catch {
      return null;
    }
  }

  /**
   * List all versions for a project
   */
  async listVersions(projectId: string): Promise<StoredManifest[]> {
    const projectDir = this.getProjectDir(projectId);
    
    try {
      const files = await fs.promises.readdir(projectDir);
      const versionFiles = files.filter((f) => f.match(/^v\d+\.json$/));
      
      const versions: StoredManifest[] = [];
      for (const file of versionFiles) {
        const filePath = path.join(projectDir, file);
        const content = await fs.promises.readFile(filePath, "utf-8");
        const stored = JSON.parse(content) as StoredManifest;
        stored.createdAt = new Date(stored.createdAt);
        versions.push(stored);
      }
      
      return versions.sort((a, b) => b.version - a.version);
    } catch {
      return [];
    }
  }

  /**
   * Delete a project's manifests
   */
  async deleteProject(projectId: string): Promise<void> {
    const projectDir = this.getProjectDir(projectId);
    
    try {
      await fs.promises.rm(projectDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  }

  /**
   * List all projects with manifests
   */
  async listProjects(): Promise<string[]> {
    try {
      await this.ensureDir(this.storagePath);
      const entries = await fs.promises.readdir(this.storagePath, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private getProjectDir(projectId: string): string {
    // Sanitize project ID for filesystem
    const safeId = projectId.replace(/[^a-zA-Z0-9-_]/g, "_");
    return path.join(this.storagePath, safeId);
  }

  private async ensureDir(dir: string): Promise<void> {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch {
      // Ignore errors
    }
  }

  private async cleanupOldVersions(projectId: string): Promise<void> {
    const versions = await this.listVersions(projectId);
    
    if (versions.length > this.maxVersions) {
      const toDelete = versions.slice(this.maxVersions);
      const projectDir = this.getProjectDir(projectId);
      
      for (const version of toDelete) {
        const filePath = path.join(projectDir, `v${version.version}.json`);
        try {
          await fs.promises.unlink(filePath);
        } catch {
          // Ignore errors
        }
      }
    }
  }
}

// ============================================================================
// Database Storage (Placeholder)
// ============================================================================

/**
 * Database-backed manifest storage
 * Uses the Drizzle ORM to store manifests in PostgreSQL
 */
export class DatabaseManifestStorage {
  /**
   * Save a manifest to the database
   */
  async save(manifest: Manifest): Promise<StoredManifest> {
    // TODO: Implement database storage
    // This would use @coreflow/db to store the manifest
    // const db = getDb();
    // await db.insert(manifests).values({ ... });
    
    throw new Error("Database storage not yet implemented");
  }

  /**
   * Get the latest manifest from the database
   */
  async getLatest(projectId: string): Promise<StoredManifest | null> {
    // TODO: Implement database retrieval
    throw new Error("Database storage not yet implemented");
  }

  /**
   * Get a specific version from the database
   */
  async getVersion(projectId: string, version: number): Promise<StoredManifest | null> {
    // TODO: Implement database retrieval
    throw new Error("Database storage not yet implemented");
  }
}

export { ManifestStorage as default };
