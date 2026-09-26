/**
 * @coreflow/scanner
 * Code scanner and manifest generator for CoreFlow
 */

export const VERSION = "0.1.0";

// Parsers
export {
  TypeScriptParser,
  type ComponentInfo as TSComponentInfo,
  type PropInfo as TSPropInfo,
  type InterfaceInfo,
  type TypeInfo,
  type ParseResult as TSParseResult,
} from "./parsers/typescript-parser";

export {
  AngularParser,
  type AngularComponentInfo,
  type AngularInputInfo,
  type AngularOutputInfo,
  type AngularDirectiveInfo,
  type AngularServiceInfo,
  type AngularParseResult,
} from "./parsers/angular-parser";

export {
  PythonParser,
  type PydanticModelInfo,
  type PydanticFieldInfo,
  type FastAPIRouteInfo,
  type FastAPIParameterInfo,
  type PythonParseResult,
} from "./parsers/python-parser";

// Manifest Schema
export {
  ManifestSchema,
  ComponentSchema,
  PropSchema,
  LimitationSchema,
  APIRouteSchema,
  DataModelSchema,
  validateManifest,
  safeValidateManifest,
  type Manifest,
  type ComponentInfo,
  type PropInfo,
  type LimitationInfo,
  type APIRouteInfo,
  type DataModelInfo,
} from "./schemas/manifest.schema";

// Services
export {
  RepoClonerService,
  repoCloner,
  type CloneOptions,
  type CloneResult,
  type FileInfo,
} from "./services/repo-cloner.service";

export {
  FileWatcherService,
  fileWatcher,
  createLocalWatcher,
  createComponentWatcher,
  createPythonWatcher,
  type WatchOptions,
  type FileChangeEvent,
  type WatcherStats,
  type FileChangeHandler,
} from "./services/file-watcher.service";

export {
  ManifestGenerator,
  type ManifestGeneratorOptions,
  type GeneratorResult,
} from "./services/manifest-generator.service";

export {
  ManifestDiffer,
  type ManifestDiff,
  type ComponentChange,
  type RouteChange,
  type ModelChange,
  type ChangeType,
} from "./services/manifest-differ.service";

export {
  ManifestStorage,
  DatabaseManifestStorage,
  type StoredManifest,
  type ManifestStorageOptions,
} from "./services/manifest-storage.service";

