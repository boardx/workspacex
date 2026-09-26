export * from "./config";
export * from "./parity";
export * from "./capabilities";
export * from "./web-build";
export * from "./model-preflight";
export { runDoctor, findOllama, MIN_MEMORY_GB, MIN_FREE_DISK_GB, type DoctorReport } from "./doctor";
export { startPgliteServer, ensureDatabaseExists, assertPostgresPortFree, type PgliteHandle } from "./pglite-server";
export { up, type UpOptions, type RunningStack } from "./up";
export { runMigrations, runOwnerSeeds, readSeedState } from "./seeds";
export { signInLocal, localSessionUrl } from "./local-session";

export {
  BACKUP_FORMAT_VERSION, backupDirName, createBackup, humanBytes, verifyBackup,
  type BackupManifest, type CreateBackupResult,
} from "./backup";

export {
  decideRestart, describeServiceFailure, DEFAULT_RESTART_WINDOW,
  SERVICE_IMPACT, SERVICE_LABELS,
} from "./supervisor-policy";
export { superviseManaged, type ServiceHealth } from "./supervisor";

export {
  decideUnload, explainBudget, idleMsFromExpiry, memoryBudgetBytes, parsePs, RECENTLY_USED_MS,
} from "./model-memory-budget";

export {
  replacedDirName, restoreBackup, restoreIntoDataDir, type RestoreResult,
} from "./restore";

export { etaSeconds, humanBytes as humanImportBytes, humanEta, digestFromBlobPath, copyBlobVerified, sha256File, type ImportProgress } from "./model-import";
export { planImport, importModels, type ImportPlan } from "./model-bundle";
export {
  UPDATE_MANIFEST, BUNDLE_VERSION_FILE, compareVersions, inspectUpdate, verifyUpdatePayload,
  rollbackTargetOf, readBundleVersion, bundleVersionMarker,
  type UpdateManifest, type UpdateVerdict, type VerifyResult, type AppliedRecord,
  type BundleVersionMarker,
} from "./update-package";
export { diagnoseStartupFailure, type StartupDiagnosis, type StartupRemedy } from "./startup-failure";
export { stopListenerOnPort } from "./processes";
export { dataDirAdvice, dataDirAdviceBody, type DataDirAdvice } from "./data-dir-advice";

export { gatekeeperAccepted, isAdhoc, releaseVerdict, type ReleaseVerdict, type SigningFacts } from "./releasable";
