/**
 * @file File Watcher Service
 * @module @coreflow/scanner/services/file-watcher
 * @description
 * Watches local file system for changes during development.
 * Uses chokidar for efficient file system monitoring.
 * Per spec Phase 6: Scanner - Repository Connection (T090)
 */

import chokidar, { FSWatcher } from "chokidar";
import * as path from "node:path";
import { EventEmitter } from "node:events";

// ============================================================================
// Types
// ============================================================================

export interface WatchOptions {
  /** Directory to watch */
  directory: string;
  /** File patterns to include (glob) */
  patterns?: string[];
  /** Patterns to ignore */
  ignored?: string[];
  /** Debounce delay in ms */
  debounceMs?: number;
  /** Whether to emit initial add events */
  emitInitial?: boolean;
}

export interface FileChangeEvent {
  type: "add" | "change" | "unlink";
  path: string;
  relativePath: string;
  timestamp: Date;
}

export interface WatcherStats {
  watchedPaths: number;
  pendingChanges: number;
  lastChangeAt: Date | null;
  isReady: boolean;
}

export type FileChangeHandler = (events: FileChangeEvent[]) => void | Promise<void>;

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PATTERNS = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.interface.ts",
  "**/*.component.ts",
  "**/*.py",
];

const DEFAULT_IGNORED = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/venv/**",
  "**/.next/**",
  "**/*.d.ts",
  "**/*.map",
];

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * File Watcher Service
 * Monitors file system changes and batches notifications
 */
export class FileWatcherService extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private pendingChanges: Map<string, FileChangeEvent> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;
  private options: Required<WatchOptions>;
  private isReady = false;
  private lastChangeAt: Date | null = null;
  private handlers: Set<FileChangeHandler> = new Set();

  constructor(options: WatchOptions) {
    super();
    this.options = {
      directory: options.directory,
      patterns: options.patterns || DEFAULT_PATTERNS,
      ignored: options.ignored || DEFAULT_IGNORED,
      debounceMs: options.debounceMs || 300,
      emitInitial: options.emitInitial ?? false,
    };
  }

  /**
   * Start watching the directory
   */
  start(): void {
    if (this.watcher) {
      console.warn("[FileWatcher] Already watching");
      return;
    }

    const watchPaths = this.options.patterns.map((pattern) =>
      path.join(this.options.directory, pattern)
    );

    console.log(`[FileWatcher] Starting watch on ${this.options.directory}`);
    console.log(`[FileWatcher] Patterns: ${this.options.patterns.join(", ")}`);

    this.watcher = chokidar.watch(watchPaths, {
      ignored: this.options.ignored,
      persistent: true,
      ignoreInitial: !this.options.emitInitial,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher
      .on("add", (filePath) => this.handleChange("add", filePath))
      .on("change", (filePath) => this.handleChange("change", filePath))
      .on("unlink", (filePath) => this.handleChange("unlink", filePath))
      .on("ready", () => {
        this.isReady = true;
        console.log("[FileWatcher] Initial scan complete, watching for changes");
        this.emit("ready");
      })
      .on("error", (error) => {
        console.error("[FileWatcher] Error:", error);
        this.emit("error", error);
      });
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.isReady = false;
      console.log("[FileWatcher] Stopped watching");
    }
  }

  /**
   * Register a change handler
   */
  onChanges(handler: FileChangeHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Get current watcher statistics
   */
  getStats(): WatcherStats {
    return {
      watchedPaths: this.watcher?.getWatched()
        ? Object.values(this.watcher.getWatched()).flat().length
        : 0,
      pendingChanges: this.pendingChanges.size,
      lastChangeAt: this.lastChangeAt,
      isReady: this.isReady,
    };
  }

  /**
   * Force flush pending changes
   */
  flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.processPendingChanges();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private handleChange(type: FileChangeEvent["type"], filePath: string): void {
    const relativePath = path.relative(this.options.directory, filePath);
    
    const event: FileChangeEvent = {
      type,
      path: filePath,
      relativePath,
      timestamp: new Date(),
    };

    // Store in pending changes (overwrites previous for same path)
    this.pendingChanges.set(filePath, event);
    this.lastChangeAt = new Date();

    // Debounce processing
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processPendingChanges();
    }, this.options.debounceMs);
  }

  private async processPendingChanges(): Promise<void> {
    if (this.pendingChanges.size === 0) return;

    const events = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    console.log(`[FileWatcher] Processing ${events.length} changes`);

    // Emit event
    this.emit("changes", events);

    // Call handlers
    for (const handler of this.handlers) {
      try {
        await handler(events);
      } catch (error) {
        console.error("[FileWatcher] Handler error:", error);
      }
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a file watcher for a local development directory
 */
export function createLocalWatcher(
  directory: string,
  options?: Partial<WatchOptions>
): FileWatcherService {
  return new FileWatcherService({
    directory,
    ...options,
  });
}

/**
 * Create a watcher specifically for TypeScript/React components
 */
export function createComponentWatcher(
  directory: string,
  options?: Partial<WatchOptions>
): FileWatcherService {
  return new FileWatcherService({
    directory,
    patterns: [
      "**/*.tsx",
      "**/*.ts",
      "**/*.interface.ts",
      "**/components/**/*",
      "**/types/**/*",
    ],
    ...options,
  });
}

/**
 * Create a watcher for Python projects
 */
export function createPythonWatcher(
  directory: string,
  options?: Partial<WatchOptions>
): FileWatcherService {
  return new FileWatcherService({
    directory,
    patterns: ["**/*.py", "**/models/**/*", "**/schemas/**/*"],
    ignored: [
      ...DEFAULT_IGNORED,
      "**/__pycache__/**",
      "**/venv/**",
      "**/.venv/**",
    ],
    ...options,
  });
}

// ============================================================================
// Export
// ============================================================================

export const fileWatcher = {
  createLocalWatcher,
  createComponentWatcher,
  createPythonWatcher,
  FileWatcherService,
};
