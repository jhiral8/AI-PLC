/**
 * @file Repository Cloner Service
 * @module @coreflow/scanner/services/repo-cloner
 * @description
 * Clones repositories using sparse checkout for efficient scanning.
 * Per spec Phase 6: Scanner - Repository Connection (T088)
 */

import { simpleGit, SimpleGit, CleanOptions } from "simple-git";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

export interface CloneOptions {
  /** Repository URL (HTTPS or SSH) */
  repoUrl: string;
  /** Branch to clone */
  branch?: string;
  /** Sparse checkout paths (e.g., ["src/components", "src/types"]) */
  sparsePaths?: string[];
  /** Authentication token (for private repos) */
  token?: string;
  /** Clone depth (default: 1 for shallow clone) */
  depth?: number;
  /** Custom clone directory */
  targetDir?: string;
}

export interface CloneResult {
  /** Path to cloned repository */
  localPath: string;
  /** Actual branch checked out */
  branch: string;
  /** Latest commit hash */
  commitHash: string;
  /** Clone timestamp */
  clonedAt: Date;
  /** Files found in sparse paths */
  fileCount: number;
}

export interface FileInfo {
  path: string;
  relativePath: string;
  size: number;
  isDirectory: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const CLONE_BASE_DIR = path.join(os.tmpdir(), "coreflow-scanner");
const DEFAULT_SPARSE_PATHS = [
  "src/components",
  "src/lib",
  "src/types",
  "components",
  "lib",
  "types",
  "packages/*/src",
  "app",
];

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Repository Cloner Service
 * Handles cloning repositories with sparse checkout for efficient scanning
 */
export class RepoClonerService {
  private git: SimpleGit;
  private baseDir: string;

  constructor(baseDir: string = CLONE_BASE_DIR) {
    this.baseDir = baseDir;
    this.git = simpleGit();
    
    // Ensure base directory exists
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Clone a repository with sparse checkout
   */
  async clone(options: CloneOptions): Promise<CloneResult> {
    const {
      repoUrl,
      branch = "main",
      sparsePaths = DEFAULT_SPARSE_PATHS,
      token,
      depth = 1,
      targetDir,
    } = options;

    // Generate unique directory name
    const repoName = this.extractRepoName(repoUrl);
    const uniqueId = Date.now().toString(36);
    const localPath = targetDir || path.join(this.baseDir, `${repoName}-${uniqueId}`);

    // Ensure target doesn't exist
    if (fs.existsSync(localPath)) {
      await this.cleanup(localPath);
    }

    // Prepare authenticated URL if token provided
    const authUrl = token ? this.injectToken(repoUrl, token) : repoUrl;

    try {
      // Initialize sparse checkout
      fs.mkdirSync(localPath, { recursive: true });
      const repoGit = simpleGit(localPath);

      // Initialize git repo
      await repoGit.init();

      // Configure sparse checkout
      await repoGit.raw(["config", "core.sparseCheckout", "true"]);

      // Add remote
      await repoGit.addRemote("origin", authUrl);

      // Write sparse checkout patterns
      const sparseCheckoutPath = path.join(localPath, ".git", "info", "sparse-checkout");
      fs.mkdirSync(path.dirname(sparseCheckoutPath), { recursive: true });
      fs.writeFileSync(sparseCheckoutPath, sparsePaths.join("\n") + "\n");

      // Fetch with depth
      await repoGit.fetch(["origin", branch, `--depth=${depth}`]);

      // Checkout branch
      await repoGit.checkout([`origin/${branch}`, "-b", branch]);

      // Get commit info
      const log = await repoGit.log({ maxCount: 1 });
      const commitHash = log.latest?.hash || "unknown";

      // Count files
      const fileCount = await this.countFiles(localPath);

      return {
        localPath,
        branch,
        commitHash,
        clonedAt: new Date(),
        fileCount,
      };

    } catch (error) {
      // Cleanup on failure
      await this.cleanup(localPath);
      throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Full clone (for small repos or when sparse checkout isn't sufficient)
   */
  async fullClone(options: Omit<CloneOptions, "sparsePaths">): Promise<CloneResult> {
    const {
      repoUrl,
      branch = "main",
      token,
      depth = 1,
      targetDir,
    } = options;

    const repoName = this.extractRepoName(repoUrl);
    const uniqueId = Date.now().toString(36);
    const localPath = targetDir || path.join(this.baseDir, `${repoName}-${uniqueId}`);

    // Prepare authenticated URL
    const authUrl = token ? this.injectToken(repoUrl, token) : repoUrl;

    try {
      // Simple shallow clone
      await this.git.clone(authUrl, localPath, [
        "--branch", branch,
        "--depth", String(depth),
        "--single-branch",
      ]);

      const repoGit = simpleGit(localPath);
      const log = await repoGit.log({ maxCount: 1 });
      const commitHash = log.latest?.hash || "unknown";
      const fileCount = await this.countFiles(localPath);

      return {
        localPath,
        branch,
        commitHash,
        clonedAt: new Date(),
        fileCount,
      };

    } catch (error) {
      await this.cleanup(localPath);
      throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Pull latest changes for an existing clone
   */
  async pull(localPath: string): Promise<{ commitHash: string; changed: boolean }> {
    const repoGit = simpleGit(localPath);

    // Get current commit
    const beforeLog = await repoGit.log({ maxCount: 1 });
    const beforeHash = beforeLog.latest?.hash;

    // Pull changes
    await repoGit.pull();

    // Get new commit
    const afterLog = await repoGit.log({ maxCount: 1 });
    const afterHash = afterLog.latest?.hash || "unknown";

    return {
      commitHash: afterHash,
      changed: beforeHash !== afterHash,
    };
  }

  /**
   * List files in the cloned repository
   */
  async listFiles(localPath: string, patterns: string[] = ["**/*"]): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    const walkDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        // Skip .git directory
        if (entry.name === ".git") continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(localPath, fullPath);
        const stats = fs.statSync(fullPath);

        files.push({
          path: fullPath,
          relativePath,
          size: stats.size,
          isDirectory: entry.isDirectory(),
        });

        if (entry.isDirectory()) {
          walkDir(fullPath);
        }
      }
    };

    walkDir(localPath);
    return files;
  }

  /**
   * Get files matching specific extensions
   */
  async getFilesByExtension(
    localPath: string,
    extensions: string[]
  ): Promise<FileInfo[]> {
    const allFiles = await this.listFiles(localPath);
    return allFiles.filter((f) => {
      if (f.isDirectory) return false;
      const ext = path.extname(f.path).toLowerCase();
      return extensions.includes(ext);
    });
  }

  /**
   * Clean up a cloned repository
   */
  async cleanup(localPath: string): Promise<void> {
    if (fs.existsSync(localPath)) {
      fs.rmSync(localPath, { recursive: true, force: true });
    }
  }

  /**
   * Clean up all cloned repositories
   */
  async cleanupAll(): Promise<void> {
    if (fs.existsSync(this.baseDir)) {
      fs.rmSync(this.baseDir, { recursive: true, force: true });
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private extractRepoName(repoUrl: string): string {
    // Handle both HTTPS and SSH URLs
    const match = repoUrl.match(/[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (match) {
      return `${match[1]}-${match[2]}`;
    }
    return "unknown-repo";
  }

  private injectToken(repoUrl: string, token: string): string {
    // Only for HTTPS URLs
    if (repoUrl.startsWith("https://github.com")) {
      return repoUrl.replace("https://", `https://${token}@`);
    }
    return repoUrl;
  }

  private async countFiles(localPath: string): Promise<number> {
    let count = 0;
    const walkDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else {
          count++;
        }
      }
    };
    walkDir(localPath);
    return count;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const repoCloner = new RepoClonerService();
