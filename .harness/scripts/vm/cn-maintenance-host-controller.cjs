// Generated from packages/cloud-deploy/src/cn-maintenance-host/entry.ts. Source-bound tool artifact; READY=false.
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/cloud-deploy/src/cn-maintenance-host/entry.ts
var entry_exports = {};
__export(entry_exports, {
  consumerImplementations: () => consumerImplementations,
  executeBoundEntry: () => executeBoundEntry,
  main: () => main,
  parseEntryPlan: () => parseEntryPlan
});
module.exports = __toCommonJS(entry_exports);
var import_node_crypto6 = require("node:crypto");
var import_node_fs3 = require("node:fs");

// packages/cloud-deploy/src/cn-maintenance-host/fixed_transport.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var fail = (code) => {
  throw new Error(code);
};
function protectedPrivateJson(path, expectedSha256) {
  if (!path.startsWith("/") || path.split("/").includes("..")) fail("PRIVATE_PATH_INVALID");
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const st = (0, import_node_fs.lstatSync)("/" + parts.slice(0, i).join("/"));
    if (!st.isDirectory() || st.uid !== 0 || st.gid !== 0 || st.mode & 18) fail("PRIVATE_PARENT_UNTRUSTED");
  }
  const before = (0, import_node_fs.lstatSync)(path), fd = (0, import_node_fs.openSync)(path, import_node_fs.constants.O_RDONLY | import_node_fs.constants.O_NOFOLLOW);
  try {
    const st = (0, import_node_fs.fstatSync)(fd);
    if (!st.isFile() || st.uid !== 0 || st.gid !== 0 || st.nlink !== 1 || (st.mode & 511) !== 384 || st.dev !== before.dev || st.ino !== before.ino || st.size > 1048576) fail("PRIVATE_FILE_UNTRUSTED");
    const bytes = (0, import_node_fs.readFileSync)(fd), after = (0, import_node_fs.fstatSync)(fd);
    if (expectedSha256 !== void 0 && (!/^[a-f0-9]{64}$/.test(expectedSha256) || (0, import_node_crypto.createHash)("sha256").update(bytes).digest("hex") !== expectedSha256)) fail("PRIVATE_FILE_HASH_MISMATCH");
    if (st.size !== after.size || st.mtimeMs !== after.mtimeMs || st.ctimeMs !== after.ctimeMs) fail("PRIVATE_FILE_CHANGED");
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("PRIVATE_JSON_INVALID");
    }
  } finally {
    (0, import_node_fs.closeSync)(fd);
  }
}
function protectedExecutable(command) {
  if (!command.path.startsWith("/") || command.path.includes("..") || !/^[a-f0-9]{64}$/.test(command.sha256)) fail("COMMAND_BINDING_INVALID");
  const parts = command.path.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const st = (0, import_node_fs.lstatSync)("/" + parts.slice(0, i).join("/"));
    if (!st.isDirectory() || st.uid !== 0 || st.gid !== 0 || st.mode & 18) fail("COMMAND_PARENT_UNTRUSTED");
  }
  const before = (0, import_node_fs.lstatSync)(command.path);
  if (!before.isFile() || before.uid !== 0 || before.gid !== 0 || before.nlink !== 1 || (before.mode & 511) !== 448) fail("COMMAND_METADATA_UNTRUSTED");
  const fd = (0, import_node_fs.openSync)(command.path, import_node_fs.constants.O_RDONLY | import_node_fs.constants.O_NOFOLLOW);
  try {
    const after = (0, import_node_fs.fstatSync)(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail("COMMAND_CHANGED");
    if ((0, import_node_crypto.createHash)("sha256").update((0, import_node_fs.readFileSync)(fd)).digest("hex") !== command.sha256) fail("COMMAND_HASH_MISMATCH");
    return fd;
  } catch (error) {
    (0, import_node_fs.closeSync)(fd);
    throw error;
  }
}
async function runFixed(command, args, input, interpreter) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("ROOT_LINUX_REQUIRED");
  try {
    (0, import_node_fs.fstatSync)(9);
  } catch {
    fail("INHERITED_FD9_REQUIRED");
  }
  const fd = protectedExecutable(command);
  let dependency;
  try {
    if (command.writerFenceModule) dependency = protectedExecutable(command.writerFenceModule);
    return await new Promise((resolve2, reject3) => {
      const bootstrap = "import sys,runpy,importlib.util,importlib.machinery; " + (dependency === void 0 ? "" : "s=importlib.util.spec_from_loader('writer_fence',importlib.machinery.SourceFileLoader('writer_fence','/proc/self/fd/11')); m=importlib.util.module_from_spec(s);sys.modules['writer_fence']=m;s.loader.exec_module(m); ") + "sys.argv=['/proc/self/fd/10']+sys.argv[1:];runpy.run_path('/proc/self/fd/10',run_name='__main__')";
      const child = (0, import_node_child_process.spawn)(interpreter === "python" ? "/usr/bin/python3" : "/usr/bin/bash", interpreter === "python" ? ["-I", "-c", bootstrap, ...args] : ["/proc/self/fd/10", ...args], {
        shell: false,
        detached: true,
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", PYTHONNOUSERSITE: "1" },
        stdio: ["pipe", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", 9, fd, dependency === void 0 ? "ignore" : dependency]
      });
      let stdout = "", size = 0;
      const killGroup = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
          }
        }
      };
      const timer = setTimeout(killGroup, 3e5);
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1048576) killGroup();
        else stdout += chunk;
      });
      child.stderr.resume();
      child.on("error", () => {
        clearTimeout(timer);
        reject3(new Error("FIXED_COMMAND_SPAWN_FAILED"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 && size <= 1048576 ? resolve2({ stdout }) : reject3(new Error("FIXED_COMMAND_FAILED"));
      });
      child.stdin.end(input === void 0 ? "" : JSON.stringify(input) + "\n");
    });
  } finally {
    if (dependency !== void 0) (0, import_node_fs.closeSync)(dependency);
    (0, import_node_fs.closeSync)(fd);
  }
}
var runFixedPython = (command, args, input) => runFixed(command, args, input, "python");
async function inheritedFd9Lock() {
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("ROOT_LINUX_REQUIRED");
  const parent = (0, import_node_fs.lstatSync)("/var/lib/workspacex-cn/runtime");
  if (!parent.isDirectory() || parent.uid !== 0 || parent.gid !== 0 || (parent.mode & 511) !== 448) fail("LOCK_PARENT_UNTRUSTED");
  const actual = (0, import_node_fs.lstatSync)("/var/lib/workspacex-cn/runtime/release.lock");
  const inherited = (0, import_node_fs.fstatSync)(9);
  if (!actual.isFile() || actual.uid !== 0 || actual.gid !== 0 || actual.nlink !== 1 || (actual.mode & 511) !== 384 || actual.dev !== inherited.dev || actual.ino !== inherited.ino) fail("CANONICAL_FD9_REQUIRED");
  const fdinfo = (0, import_node_fs.readFileSync)("/proc/self/fdinfo/9", "utf8");
  if (!/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+/m.test(fdinfo)) fail("CANONICAL_FD9_LOCK_NOT_HELD");
  let released = false;
  return async () => {
    if (released) fail("CANONICAL_FD9_ALREADY_RELEASED");
    released = true;
    (0, import_node_fs.closeSync)(9);
  };
}

// packages/cloud-deploy/src/cn-maintenance-release.ts
var MaintenanceRecoveryRequired = class extends Error {
  constructor() {
    super("MAINTENANCE_DATABASE_RECOVERY_REQUIRED_WRITES_HELD");
  }
};
var MaintenanceWriteStateUnknown = class extends Error {
  constructor() {
    super("MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED");
  }
};
async function runMaintenanceRelease(request, ops) {
  if (request.maintenanceOptIn !== "stop-all-writes-and-require-database-recovery") throw new Error("MAINTENANCE_OPT_IN_REQUIRED");
  if (!/^[a-f0-9]{40}$/.test(request.sourceRevision) || !/^[a-f0-9]{40}$/.test(request.baselineRevision) || !/^[a-f0-9]{64}$/.test(request.migrationPlanSha256) || !/^[a-zA-Z0-9-]{1,128}$/.test(request.attemptId)) throw new Error("MAINTENANCE_IDENTITY_INVALID");
  const required = ["verifyThreeDatabaseRecovery", "persistMaintenanceHold", "verifyMaintenanceHoldPresent", "verifyMaintenanceHoldCleared", "blockAllWrites", "verifyAllWritersDrained", "migrateExactPlan", "verifyProductionDynamic", "verifyPreactivate", "activate", "verifyAcceptance", "resumeWrites", "verifyWritesResumed", "clearMaintenanceHold", "verifyWritesBlocked", "recordWriteStateReconciliationRequired", "recordDatabaseRecoveryRequired"];
  for (const name of required) if (typeof ops[name] !== "function") throw new Error(`MAINTENANCE_CAPABILITY_MISSING:${name}`);
  const identity = Object.freeze({ sourceRevision: request.sourceRevision, baselineRevision: request.baselineRevision, migrationPlanSha256: request.migrationPlanSha256, attemptId: request.attemptId });
  const releaseLock = await ops.acquireReleaseLock(identity);
  let holdAttempted = false;
  let retainLock = false;
  try {
    await ops.prepareOffline(identity);
    await ops.verifyThreeDatabaseRecovery(identity);
    holdAttempted = true;
    await ops.persistMaintenanceHold(identity);
    await ops.verifyMaintenanceHoldPresent(identity);
    await ops.blockAllWrites(identity);
    await ops.verifyAllWritersDrained(identity);
    await ops.migrateExactPlan(identity);
    await ops.verifyProductionDynamic(identity);
    await ops.verifyPreactivate(identity);
    await ops.activate(identity);
    await ops.verifyAcceptance(identity);
    await ops.resumeWrites(identity);
    await ops.verifyWritesResumed(identity);
    await ops.clearMaintenanceHold(identity);
    await ops.verifyMaintenanceHoldCleared(identity);
    holdAttempted = false;
  } catch (error) {
    if (holdAttempted) {
      try {
        await ops.verifyMaintenanceHoldPresent(identity);
        await ops.verifyWritesBlocked(identity);
      } catch {
        retainLock = true;
        try {
          await ops.recordWriteStateReconciliationRequired(identity);
        } catch {
        }
        throw new MaintenanceWriteStateUnknown();
      }
      try {
        await ops.recordDatabaseRecoveryRequired(identity);
      } catch {
      }
      throw new MaintenanceRecoveryRequired();
    }
    throw error;
  } finally {
    try {
      if (!retainLock) await releaseLock();
    } catch {
      if (holdAttempted) throw new MaintenanceRecoveryRequired();
      throw new Error("MAINTENANCE_RELEASE_LOCK_CLEANUP_FAILED");
    }
  }
}

// packages/cloud-deploy/src/cn-maintenance-host/controller.ts
var writerCallbacks = ["blockAllWrites", "verifyAllWritersDrained", "verifyWritesBlocked", "resumeWrites", "verifyWritesResumed", "recordWriteStateReconciliationRequired", "recordDatabaseRecoveryRequired"];
function requireValue(ok, code) {
  if (!ok) throw new Error(code);
}
function sameIdentity(a, b) {
  if (!a || typeof a !== "object") return false;
  const value = a;
  return Object.keys(value).sort().join(",") === Object.keys(b).sort().join(",") && Object.entries(b).every(([key, v]) => value[key] === v);
}
function parseOne(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("COMMAND_RESPONSE_INVALID");
  }
}
function holdRecord(value, identity, state) {
  requireValue(value && value.schemaVersion === 1 && value.state === state && sameIdentity(value.identity, identity) && /^[a-f0-9]{32}$/.test(value.generation) && /^[a-f0-9]{64}$/.test(value.sha256) && Number.isSafeInteger(value.device) && Number.isSafeInteger(value.inode), "HOLD_READBACK_INVALID");
}
async function runHostMaintenance(request, binding, primitives, run) {
  requireValue(request.maintenanceOptIn === "stop-all-writes-and-require-database-recovery", "MAINTENANCE_OPT_IN_REQUIRED");
  requireValue(/^[a-f0-9]{40}$/.test(request.sourceRevision) && /^[a-f0-9]{40}$/.test(request.baselineRevision) && /^[a-f0-9]{64}$/.test(request.migrationPlanSha256) && /^[a-zA-Z0-9-]{1,128}$/.test(request.attemptId), "MAINTENANCE_IDENTITY_INVALID");
  requireValue(sameIdentity(binding.identity, { sourceRevision: request.sourceRevision, baselineRevision: request.baselineRevision, migrationPlanSha256: request.migrationPlanSha256, attemptId: request.attemptId }), "HOST_IDENTITY_MISMATCH");
  requireValue(binding.writerPlanPath.startsWith("/") && /^[a-f0-9]{64}$/.test(binding.writerPlanSha256) && /^[a-f0-9]{64}$/.test(binding.writerPlanCanonicalSha256), "WRITER_PLAN_BINDING_INVALID");
  await primitives.assertTrustedBinding(binding);
  await primitives.verifyRecoveryExecutorCapability(binding.identity);
  let originalHold;
  let clearedHold;
  const hold = async (action, input) => parseOne((await run(binding.hold, [action, "/var/lib/workspacex-cn/runtime"], input)).stdout);
  const ops = {
    acquireReleaseLock: primitives.acquireReleaseLock.bind(primitives),
    prepareOffline: primitives.prepareOffline.bind(primitives),
    verifyThreeDatabaseRecovery: primitives.verifyThreeDatabaseRecovery.bind(primitives),
    migrateExactPlan: primitives.migrateExactPlan.bind(primitives),
    verifyProductionDynamic: primitives.verifyProductionDynamic.bind(primitives),
    verifyPreactivate: primitives.verifyPreactivate.bind(primitives),
    activate: primitives.activate.bind(primitives),
    verifyAcceptance: primitives.verifyAcceptance.bind(primitives),
    persistMaintenanceHold: async (identity) => {
      const value = await hold("create", identity);
      holdRecord(value, identity, "held");
      originalHold = value;
    },
    verifyMaintenanceHoldPresent: async (identity) => {
      const value = await hold("read");
      holdRecord(value, identity, "held");
      if (originalHold) requireValue(JSON.stringify(value) === JSON.stringify(originalHold), "HOLD_GENERATION_CHANGED");
      else originalHold = value;
    },
    clearMaintenanceHold: async (identity) => {
      requireValue(originalHold, "HOLD_CAS_INPUT_MISSING");
      const value = await hold("clear", originalHold);
      holdRecord(value, identity, "cleared");
      clearedHold = value;
    },
    verifyMaintenanceHoldCleared: async (identity) => {
      const value = await hold("read");
      holdRecord(value, identity, "cleared");
      requireValue(clearedHold && JSON.stringify(value) === JSON.stringify(clearedHold), "HOLD_CLEAR_READBACK_CHANGED");
    }
  };
  for (const callback of writerCallbacks) ops[callback] = async (identity) => {
    const value = parseOne((await run(binding.writerFence, ["--apply-reviewed-fence", binding.writerPlanPath, binding.writerPlanSha256, callback])).stdout);
    if (callback === "verifyAllWritersDrained" || callback === "verifyWritesBlocked") {
      requireValue(value && value.schemaVersion === 1 && value.kind === "maintenance-writers-held" && value.ready === false && sameIdentity(value.identity, identity) && originalHold && value.holdGeneration === originalHold.generation && value.holdSha256 === originalHold.sha256 && value.planSha256 === binding.writerPlanCanonicalSha256 && typeof value.observedAt === "number" && Number.isFinite(value.observedAt) && Date.now() / 1e3 - value.observedAt >= 0 && Date.now() / 1e3 - value.observedAt <= 30 && value.host && typeof value.host.instanceId === "string" && typeof value.host.bootId === "string" && value.databasePeers && Object.keys(value.databasePeers).sort().join(",") === "workspacex,workspacex_agent,workspacex_memory" && ["holdSha256", "planSha256", "observationSha256", "databaseSessionsSha256"].every((key) => /^[a-f0-9]{64}$/.test(value[key])) && Array.isArray(value.families) && value.families.join(",") === "http,socket,queue,background,agent,checkpoint,memory,privileged", "WRITER_GUARD_RESPONSE_INVALID");
    } else {
      requireValue(value && value.callback === callback && sameIdentity(value.identity, identity) && value.ready === false && value.productionAvailabilityProven === false && typeof value.state === "string", "WRITER_RESPONSE_INVALID");
    }
    requireValue(sameIdentity(identity, binding.identity), "WRITER_IDENTITY_CHANGED");
  };
  await runMaintenanceRelease(request, ops);
}
async function runHostMaintenanceRetainingFd9(request, binding, primitives, run) {
  try {
    await runHostMaintenance(request, binding, primitives, run);
  } catch (error) {
    if (!(error instanceof MaintenanceWriteStateUnknown)) throw error;
    process.stderr.write("MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED\n");
    await new Promise(() => {
      setInterval(() => {
      }, 6e4);
    });
  }
}

// packages/cloud-deploy/src/cn-maintenance-host/production_factory.ts
var productionActions = ["prepareOffline", "verifyThreeDatabaseRecovery", "migrateExactPlan", "verifyProductionDynamic", "verifyPreactivate", "activate", "verifyAcceptance"];
function productionPrimitives(binding, run, verifyInstalledProfile, inheritedLock) {
  const identityEqual = (value) => !!value && typeof value === "object" && Object.keys(value).sort().join(",") === Object.keys(binding.identity).sort().join(",") && Object.entries(binding.identity).every(([key, expected]) => value[key] === expected);
  const validate = () => {
    if (!/^[a-f0-9]{40}$/.test(binding.toolRevision) || !identityEqual(binding.identity)) throw new Error("PRODUCTION_BINDING_INVALID");
    if (Object.keys(binding.operations).sort().join(",") !== [...productionActions].sort().join(",")) throw new Error("PRODUCTION_OPERATION_SET_INVALID");
    for (const op of [binding.recoveryPreflight, ...productionActions.map((k) => binding.operations[k])]) {
      if (!op || !op.planPath.startsWith("/etc/workspacex-cn/") || op.planPath.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(op.planSha256) || !op.command.path.startsWith("/usr/local/lib/workspacex-cn/") || !/^[a-f0-9]{64}$/.test(op.command.sha256)) throw new Error("PRODUCTION_OPERATION_BINDING_INVALID");
    }
  };
  const invoke = async (name, op, identity) => {
    if (!identityEqual(identity)) throw new Error("PRODUCTION_IDENTITY_CHANGED");
    const response = await run(op.command, ["--maintenance-operation", name, op.planPath, op.planSha256]);
    let value;
    try {
      value = JSON.parse(response.stdout);
    } catch {
      throw new Error("PRODUCTION_OPERATION_RESPONSE_INVALID");
    }
    if (!value || value.schemaVersion !== 1 || value.kind !== "maintenance-operation-completed" || value.operation !== name || !identityEqual(value.identity) || value.toolRevision !== binding.toolRevision || value.planSha256 !== op.planSha256 || value.ready !== false) throw new Error("PRODUCTION_OPERATION_RESPONSE_INVALID");
  };
  const result = {
    assertTrustedBinding: async (host) => {
      validate();
      if (!identityEqual(host.identity)) throw new Error("PRODUCTION_IDENTITY_CHANGED");
      await verifyInstalledProfile(host, binding);
    },
    verifyRecoveryExecutorCapability: async (identity) => {
      if (!identityEqual(identity)) throw new Error("PRODUCTION_IDENTITY_CHANGED");
      const op = binding.recoveryPreflight;
      const response = await run(op.command, ["--preflight-capability", op.planPath]);
      let value;
      try {
        value = JSON.parse(response.stdout);
      } catch {
        throw new Error("RECOVERY_PREFLIGHT_INVALID");
      }
      if (!value || value.schemaVersion !== 1 || value.kind !== "production-recovery-preflight" || !identityEqual(value.identity) || value.toolRevision !== binding.toolRevision || value.planSha256 !== op.planSha256 || value.liveWritesHeldProven !== false || value.ready !== false) throw new Error("RECOVERY_PREFLIGHT_INVALID");
    },
    acquireReleaseLock: inheritedLock,
    ...Object.fromEntries(productionActions.map((name) => [name, (identity) => invoke(name, binding.operations[name], identity)]))
  };
  return result;
}

// ../../../Users/shenyanbin/Documents/workspacex/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../../Users/shenyanbin/Documents/workspacex/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object2) => {
    const keys = [];
    for (const key in object2) {
      if (Object.prototype.hasOwnProperty.call(object2, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../../Users/shenyanbin/Documents/workspacex/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json2 = JSON.stringify(obj, null, 2);
  return json2.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../../Users/shenyanbin/Documents/workspacex/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../../Users/shenyanbin/Documents/workspacex/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../../Users/shenyanbin/Documents/workspacex/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../../Users/shenyanbin/Documents/workspacex/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../../Users/shenyanbin/Documents/workspacex/node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// packages/cloud-deploy/src/cn-fast-safe-release.ts
var import_node_crypto2 = require("node:crypto");

// packages/cloud-deploy/src/release.ts
var digestImage = external_exports.string().max(512).regex(/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/);
var artifact = external_exports.object({ image: digestImage }).strict();
var releaseManifestSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  release: external_exports.string().regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
  sourceRevision: external_exports.string().regex(/^[a-f0-9]{40}$/),
  platform: external_exports.enum(["linux/amd64", "linux/arm64"]),
  images: external_exports.object({ web: artifact, api: artifact, agent: artifact, sandbox: artifact, postgres: artifact, redis: artifact }).strict()
}).strict();
function validateReleaseManifest(input) {
  const result = releaseManifestSchema.safeParse(input);
  if (!result.success) throw new Error(`INVALID_RELEASE_MANIFEST: ${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`);
  return result.data;
}

// packages/cloud-deploy/src/cn-fast-safe-release.ts
var sha = external_exports.string().regex(/^[a-f0-9]{40}$/);
var sha256 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var digest = external_exports.string().regex(/^sha256:[a-f0-9]{64}$/);
var terminalCheck = external_exports.object({ status: external_exports.literal("passed"), evidenceSha256: sha256 }).strict();
var failureClass = external_exports.enum(["stale-test", "infrastructure", "product", "unknown"]);
var waiverSchema = external_exports.object({
  issueUrl: external_exports.string().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/[1-9][0-9]*$/),
  evidenceSha256: sha256,
  owner: external_exports.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
  expiresAt: external_exports.string().datetime()
}).strict();
var releaseFailureSchema = external_exports.object({
  check: external_exports.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
  classification: failureClass,
  waiver: waiverSchema.optional()
}).strict();
var durableConfigSchema = external_exports.object({
  asrProfile: external_exports.literal(true),
  platformSuperuserEmails: external_exports.literal(true),
  githubIssueProfile: external_exports.literal(true),
  copilotkitExactTimeoutSeconds: external_exports.number().int().min(3600).max(3600),
  copilotkitPrefixTimeoutSeconds: external_exports.number().int().min(3600).max(3600)
}).strict();
var diffSchema = external_exports.object({
  migrationRisk: external_exports.enum(["none", "compatible", "destructive"]),
  pendingMigrationCount: external_exports.number().int().nonnegative(),
  changedServices: external_exports.array(external_exports.enum(["web", "api", "agent", "sandbox"])).max(4)
}).strict();
var migrationCompatibilitySchema = external_exports.object({
  baselineSourceRevision: sha,
  sourceRevision: sha,
  baselineSha256: sha256,
  planSha256: sha256,
  pendingSha256: sha256,
  scope: external_exports.literal("restored-baseline-runtime"),
  sqlExecuted: external_exports.literal(true),
  cleanupPassed: external_exports.literal(true),
  oldRead: terminalCheck,
  oldWrite: terminalCheck,
  candidateRead: terminalCheck,
  candidateWrite: terminalCheck
}).strict();
var imageSetSchema = external_exports.object({ web: digest, api: digest, agent: digest, sandbox: digest }).strict();
var preparedCnReleaseSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  status: external_exports.literal("prepared").default("prepared"),
  sourceRevision: sha,
  baselineSha256: sha256,
  baselineSourceRevision: sha.optional(),
  migrationPlanSha256: sha256.optional(),
  pendingMigrationSha256: sha256.optional(),
  migrationCompatibility: migrationCompatibilitySchema.optional(),
  release: external_exports.string().regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
  manifestSha256: sha256,
  images: imageSetSchema,
  diff: diffSchema,
  durableConfig: durableConfigSchema,
  checks: external_exports.object({
    sourceFrozen: terminalCheck,
    imagesImmutable: terminalCheck,
    canonicalConfigRendered: terminalCheck,
    migrationAssessed: terminalCheck,
    databaseBackup: terminalCheck,
    shadowReadiness: terminalCheck,
    shadowBusiness: terminalCheck
  }).strict(),
  failures: external_exports.array(releaseFailureSchema).max(128),
  preparedAt: external_exports.string().datetime(),
  expiresAt: external_exports.string().datetime()
}).strict().superRefine((value, context) => {
  const prepared = Date.parse(value.preparedAt), expires = Date.parse(value.expiresAt);
  if (expires <= prepared || expires - prepared > 7 * 864e5) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["expiresAt"], message: "INVALID_PREPARATION_WINDOW" });
  }
  if (value.diff.migrationRisk === "destructive") {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["diff", "migrationRisk"], message: "DESTRUCTIVE_MIGRATION_REQUIRES_MAINTENANCE_LANE" });
  }
  if (value.diff.migrationRisk === "none" && value.diff.pendingMigrationCount !== 0) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["diff", "migrationRisk"], message: "NONEMPTY_PENDING_MIGRATIONS_REQUIRE_ASSESSMENT" });
  }
  if (value.diff.migrationRisk === "compatible") {
    const proof = value.migrationCompatibility;
    if (!proof || !value.baselineSourceRevision || !value.migrationPlanSha256 || !value.pendingMigrationSha256 || proof.sourceRevision !== value.sourceRevision || proof.baselineSourceRevision !== value.baselineSourceRevision || proof.baselineSha256 !== value.baselineSha256 || proof.planSha256 !== value.migrationPlanSha256 || proof.pendingSha256 !== value.pendingMigrationSha256 || value.checks.migrationAssessed.evidenceSha256 !== value.migrationPlanSha256) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["migrationCompatibility"], message: "EXACT_OLD_NEW_MIGRATION_PROOF_REQUIRED" });
    }
  }
  for (const [index, failure] of value.failures.entries()) {
    if (failure.waiver && Date.parse(failure.waiver.expiresAt) > expires) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["failures", index, "waiver", "expiresAt"], message: "WAIVER_OUTLIVES_PREPARATION" });
    }
  }
});
function validatePreparedCnRelease(input) {
  const result = preparedCnReleaseSchema.safeParse(input);
  if (!result.success) throw new Error("INVALID_PREPARED_CN_RELEASE");
  return result.data;
}
function verifyPreparedReleaseManifest(receiptInput, manifestBytes) {
  const receipt = validatePreparedCnRelease(receiptInput);
  let manifest;
  try {
    manifest = validateReleaseManifest(JSON.parse(manifestBytes.toString("utf8")));
  } catch {
    throw new Error("PREPARED_MANIFEST_INVALID");
  }
  if (manifest.sourceRevision !== receipt.sourceRevision || (0, import_node_crypto2.createHash)("sha256").update(manifestBytes).digest("hex") !== receipt.manifestSha256) throw new Error("PREPARED_MANIFEST_MISMATCH");
  for (const service of ["web", "api", "agent", "sandbox"]) {
    if (manifest.images[service].image.split("@").at(-1) !== receipt.images[service]) throw new Error("PREPARED_IMAGE_MISMATCH");
  }
  return manifest;
}
function classifyReleaseFailures(failures, now = /* @__PURE__ */ new Date()) {
  const blocked = [], waived = [];
  for (const failure of failures) {
    const eligible = failure.classification === "stale-test" || failure.classification === "infrastructure";
    const validWaiver = eligible && failure.waiver && Date.parse(failure.waiver.expiresAt) > now.getTime();
    (validWaiver ? waived : blocked).push(failure.check);
  }
  return { blocked, waived };
}
async function activatePreparedCnRelease(input, actions, options = {}) {
  const receipt = validatePreparedCnRelease(input), now = options.now ?? /* @__PURE__ */ new Date(), deadlineMs = options.deadlineMs ?? 3e5;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 3e5) throw new Error("INVALID_ACTIVATION_DEADLINE");
  const started = performance.now();
  const report = (status, code) => ({ status, code, durationMs: Math.round(performance.now() - started) });
  if (Date.parse(receipt.expiresAt) <= now.getTime()) return report("blocked", "PREPARATION_EXPIRED");
  if (classifyReleaseFailures(receipt.failures, now).blocked.length) return report("blocked", "PREPARATION_GATES_BLOCKED");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), deadlineMs);
  let promoted = false;
  const active = () => {
    if (controller.signal.aborted || performance.now() - started >= deadlineMs) throw new Error("ACTIVATION_DEADLINE_EXCEEDED");
  };
  try {
    if (await actions.readBaselineFingerprint() !== receipt.baselineSha256) return report("blocked", "BASELINE_CAS_MISMATCH");
    const drain = await actions.drainRuns();
    active();
    if ([drain.queued, drain.running, drain.writebackPending].some((value) => !Number.isSafeInteger(value) || value !== 0)) return report("blocked", "RUN_DRAIN_INCOMPLETE");
    await actions.promotePreparedPointer();
    promoted = true;
    active();
    await actions.activateTraffic();
    active();
    const canonical2 = await actions.verifyCanonical();
    active();
    if (canonical2.status !== "passed" || canonical2.lockRetained || canonical2.passedStages !== 8) throw new Error("CANONICAL_GATE_FAILED");
    const browser = await actions.runBrowserSmoke();
    active();
    if (!Object.values(browser).every((value) => value === true)) throw new Error("BROWSER_SMOKE_FAILED");
    return report("passed", "ACTIVATED");
  } catch (error) {
    if (!promoted) return report("blocked", "ACTIVATION_PRECONDITION_FAILED");
    const code = error instanceof Error && ["CANONICAL_GATE_FAILED", "BROWSER_SMOKE_FAILED"].includes(error.message) ? error.message : "ACTIVATION_FAILED";
    try {
      await actions.restoreBaseline();
      await actions.restorePointer();
      return report("rolled-back", code);
    } catch {
      return report("rollback-unproven", code);
    }
  } finally {
    clearTimeout(timer);
  }
}

// packages/cloud-deploy/src/cn-migration-plan.ts
var import_node_crypto3 = require("node:crypto");
var import_node_child_process2 = require("node:child_process");
var import_node_fs2 = require("node:fs");
var import_node_path = require("node:path");
var import_node_url = require("node:url");
var sha2 = /^[a-f0-9]{40}$/;
var hash = /^[a-f0-9]{64}$/;
var migrationHash = (value) => (0, import_node_crypto3.createHash)("sha256").update(value).digest("hex");
var canonicalHash = (value) => migrationHash(JSON.stringify(value));
var compare = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
function classifyMigration(sql) {
  const text2 = sql.replace(/--[^\n]*(?:\n|$)/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (/\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i.test(text2) || /\bALTER\b[\s\S]*\bRENAME\b/i.test(text2)) return "destructive";
  if (/\$|['"]|\/\*|\*\//.test(text2)) return "unknown";
  const statements = text2.split(";").map((part) => part.trim()).filter(Boolean);
  if (!statements.length) return "unknown";
  const identifier2 = "[A-Za-z_][A-Za-z0-9_]*";
  const type = "(?:smallint|integer|bigint|text|boolean|uuid|date|timestamp|timestamptz|jsonb|real|double precision)";
  const column = `${identifier2}\\s+${type}(?:\\s+(?:NOT NULL|NULL|PRIMARY KEY|UNIQUE))*`;
  const table = new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier2}\\s*\\(\\s*${column}(?:\\s*,\\s*${column})*\\s*\\)$`, "i");
  const index = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier2}\\s+ON\\s+${identifier2}\\s*\\(\\s*${identifier2}(?:\\s*,\\s*${identifier2})*\\s*\\)$`, "i");
  if (statements.every((statement) => table.test(statement) || index.test(statement))) return "additive";
  if (statements.every((statement) => /^ALTER\s+TABLE\s+/i.test(statement))) return "contract";
  return "unknown";
}
function compareMigrationInventory(input, files) {
  const blockers = [];
  if (!sha2.test(input.targetSha) || !sha2.test(input.baselineSha)) blockers.push("invalid_exact_sha");
  const ledger = input.ledger.map(({ name, checksum }) => ({ name, checksum })).sort(compare);
  const names = /* @__PURE__ */ new Set();
  for (const entry of ledger) {
    if (!entry.name.endsWith(".sql") || entry.name.includes("/") || entry.name.includes("\\") || !hash.test(entry.checksum)) blockers.push("invalid_ledger_entry");
    if (names.has(entry.name)) blockers.push(`duplicate_ledger:${entry.name}`);
    names.add(entry.name);
  }
  const sourceNames = /* @__PURE__ */ new Set();
  let previous;
  for (const file of files) {
    if (sourceNames.has(file.name) || previous !== void 0 && previous >= file.name) blockers.push(`invalid_source_order:${file.name}`);
    if (!hash.test(file.checksum) || migrationHash(file.sql) !== file.checksum) blockers.push(`source_checksum_mismatch:${file.name}`);
    sourceNames.add(file.name);
    previous = file.name;
  }
  const drift = [];
  for (const applied of ledger) {
    const source2 = files.find((file) => file.name === applied.name);
    if (!source2) {
      blockers.push(`applied_source_missing:${applied.name}`);
      continue;
    }
    if (source2.checksum !== applied.checksum) {
      const supplied = input.legacyDriftEvidence?.find((item) => item.name === applied.name);
      const evidence = supplied && supplied.ledgerChecksum === applied.checksum && supplied.sourceChecksum === source2.checksum && supplied.baselineSourceChecksum === source2.checksum && supplied.runningImageSourceChecksum === source2.checksum && hash.test(supplied.evidenceSha256) ? {
        name: supplied.name,
        ledgerChecksum: supplied.ledgerChecksum,
        sourceChecksum: supplied.sourceChecksum,
        baselineSourceChecksum: supplied.baselineSourceChecksum,
        runningImageSourceChecksum: supplied.runningImageSourceChecksum,
        evidenceSha256: supplied.evidenceSha256
      } : null;
      drift.push({ name: applied.name, ledgerChecksum: applied.checksum, sourceChecksum: source2.checksum, evidence });
      blockers.push(`applied_checksum_drift:${applied.name}`);
      if (!evidence) blockers.push(`legacy_drift_evidence_missing:${applied.name}`);
    }
  }
  const pending = files.filter((file) => !names.has(file.name)).map((file) => ({ name: file.name, checksum: file.checksum, risk: classifyMigration(file.sql) }));
  for (const file of pending) if (file.risk !== "additive") blockers.push(`pending_${file.risk}:${file.name}`);
  const lastApplied = ledger.at(-1)?.name;
  for (const file of pending) if (lastApplied && file.name < lastApplied) blockers.push(`out_of_order_pending:${file.name}`);
  if (input.snapshotEvidence && (input.snapshotEvidence.ledgerSha256 !== canonicalHash(ledger) || input.snapshotEvidence.independentSqlCount !== ledger.length)) blockers.push("snapshot_inventory_binding_mismatch");
  const body = {
    schemaVersion: 1,
    targetSha: input.targetSha,
    baselineSha: input.baselineSha,
    baselineLedgerSha256: canonicalHash(ledger),
    sourceInventorySha256: canonicalHash(files.map(({ name, checksum }) => ({ name, checksum }))),
    pendingSha256: canonicalHash(pending.map(({ name, checksum }) => ({ name, checksum }))),
    ...input.snapshotEvidence ? { snapshotEvidence: input.snapshotEvidence } : {},
    ledger,
    pending,
    drift,
    blockers: [...new Set(blockers)].sort(),
    ready: blockers.length === 0,
    scope: "read-only-plan",
    productionMigrationAuthorized: false
  };
  return { ...body, planSha256: canonicalHash(body) };
}
async function generateMigrationPlan(checkout, input) {
  const root = (0, import_node_fs2.realpathSync)((0, import_node_path.resolve)(checkout));
  const git = (...args) => (0, import_node_child_process2.execFileSync)("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  if (!sha2.test(input.targetSha) || git("rev-parse", "HEAD") !== input.targetSha) throw new Error("target checkout SHA mismatch");
  const migratorPath = "apps/api/src/infrastructure/db/migrator.ts";
  const migrationPath = "apps/api/migrations";
  if (git("status", "--porcelain", "--untracked-files=all", "--", migratorPath, migrationPath)) throw new Error("migration source is not frozen");
  const authority = await import((0, import_node_url.pathToFileURL)((0, import_node_path.join)(root, migratorPath)).href);
  if (typeof authority.migrationFiles !== "function") throw new Error("canonical migrationFiles authority missing");
  const dir = (0, import_node_path.join)(root, migrationPath);
  const files = authority.migrationFiles(dir).map((name) => {
    const path = (0, import_node_path.join)(dir, name);
    if (!(0, import_node_fs2.lstatSync)(path).isFile() || (0, import_node_fs2.realpathSync)(path) !== path) throw new Error(`migration must be a regular tracked file: ${name}`);
    const sql = (0, import_node_fs2.readFileSync)(path, "utf8");
    if (git("ls-files", "--error-unmatch", "--", `${migrationPath}/${name}`) !== `${migrationPath}/${name}` || migrationHash((0, import_node_child_process2.execFileSync)("git", ["-C", root, "show", `${input.targetSha}:${migrationPath}/${name}`])) !== migrationHash(sql)) throw new Error(`migration differs from target: ${name}`);
    return { name, checksum: migrationHash(sql), sql };
  });
  return compareMigrationInventory(input, files);
}

// packages/cloud-deploy/src/cn-migration-snapshot.ts
var import_node_crypto5 = require("node:crypto");
var import_node_zlib = require("node:zlib");
var import_node_util = require("node:util");

// packages/cloud-deploy/src/cn-migration-source-identity.ts
var import_node_crypto4 = require("node:crypto");
var import_node_net = require("node:net");

// packages/cloud-deploy/src/config.ts
var RDS_TLS_EXCEPTION_KIND = "aliyun-postgresql-serverless-no-tls";
var text = external_exports.string().min(1).max(512).regex(/^(?!.*REPLACE_WITH_)[^\s\u0000-\u001f]+$/);
var identifier = text.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
var region = text.regex(/^[a-z]{2}-[a-z]+-\d+$|^[a-z]{2}-[a-z]+$/);
var secretRef = text.regex(/^(env:[A-Z][A-Z0-9_]*|file:\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*)$/);
var absoluteDirectory = text.regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/);
var ipv4Cidr = external_exports.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/).refine((value) => {
  const [address, prefix] = value.split("/");
  return address.split(".").every((octet) => Number(octet) <= 255) && Number(prefix) <= 32 && value !== "0.0.0.0/0";
});
var ipv4 = external_exports.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}$/).refine((value) => value.split(".").every((octet) => Number(octet) <= 255));
var origin = text.regex(/^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[1-9][0-9]{0,4})?\/?$/).url();
var modelUrl = text.regex(/^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[1-9][0-9]{0,4})?(?:\/[a-zA-Z0-9._~-]+)*\/?$/).url();
var email = external_exports.string().max(254).email();
var hostname = external_exports.string().min(1).max(253).regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/);
var githubRepositoryPart = external_exports.string().min(1).max(100).regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/);
var websocketUrl = text.regex(/^wss:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[1-9][0-9]{0,4})?(?:\/[a-zA-Z0-9._~-]+)*\/?$/).url();
var commonEnvironment = {
  regionId: region,
  ecsInstanceId: text.regex(/^i-[a-zA-Z0-9]+$/),
  runtimeRole: identifier,
  ossBucket: text.regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  ossEndpoint: text.regex(/^https:\/\/oss-[a-z0-9-]+(?:-internal)?\.aliyuncs\.com$/),
  ossPrefix: text.regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/),
  publicUrl: origin,
  tlsSecretRef: secretRef
};
var starter = external_exports.object({
  ...commonEnvironment,
  profile: external_exports.literal("starter"),
  dataVolumePath: absoluteDirectory,
  backupTargetRef: secretRef
}).strict();
var production = external_exports.object({
  ...commonEnvironment,
  profile: external_exports.literal("production"),
  preflightTargetIp: ipv4.optional(),
  rdsInstanceId: text.regex(/^pgm-[a-zA-Z0-9]+$/),
  redisInstanceId: text.regex(/^r-[a-zA-Z0-9]+$/),
  databaseSecretRef: secretRef,
  migrationSecretRef: secretRef,
  redisSecretRef: secretRef,
  backupRetentionDays: external_exports.number().int().min(1).max(3650),
  rdsTlsException: external_exports.object({
    kind: external_exports.literal(RDS_TLS_EXCEPTION_KIND),
    allowedCidrs: external_exports.array(ipv4Cidr).min(1).max(32)
  }).strict().optional()
}).strict();
var deploymentInputSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  environment: external_exports.discriminatedUnion("profile", [starter, production]),
  provision: external_exports.object({
    release: text.regex(/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/),
    adminEmail: email,
    platformSuperuserEmails: external_exports.array(email).min(1).max(32).optional(),
    modelProfile: external_exports.object({
      baseUrl: modelUrl,
      modelId: identifier,
      apiKeySecretRef: secretRef
    }).strict(),
    asrProfile: external_exports.object({
      recordingTurnSilenceMs: external_exports.number().int().min(200).max(2e3).optional(),
      provider: identifier,
      baseUrl: websocketUrl,
      modelId: identifier,
      apiKeySecretRef: secretRef
    }).strict().optional(),
    githubIssueProfile: external_exports.object({
      tokenSecretRef: secretRef,
      repoOwner: githubRepositoryPart,
      repoName: githubRepositoryPart,
      attachmentsBranch: identifier
    }).strict().optional(),
    // Cloudflare Email Sending for verification, password-reset, feedback and test emails.
    // Omitted = the API starts but every send is refused as MAIL_NOT_CONFIGURED.
    mailProfile: external_exports.object({
      cloudflareAccountId: identifier,
      apiTokenSecretRef: secretRef,
      mailFrom: email,
      // The domain onboarded in Cloudflare Email Sending; mailFrom must be on it.
      sendingDomain: hostname
    }).strict().optional()
  }).strict()
}).strict();
var deploymentConfigSchema = deploymentInputSchema.superRefine((config, ctx) => {
  const env = config.environment;
  const endpoints = [
    `https://oss-${env.regionId}.aliyuncs.com`,
    `https://oss-${env.regionId}-internal.aliyuncs.com`
  ];
  if (!endpoints.includes(env.ossEndpoint)) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["environment", "ossEndpoint"], message: "REGION_MISMATCH" });
  }
  if (env.profile === "production" && env.databaseSecretRef === env.migrationSecretRef) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["environment", "migrationSecretRef"], message: "SEPARATE_ROLES_REQUIRED" });
  }
  const mail = config.provision.mailProfile;
  if (mail && mail.mailFrom.slice(mail.mailFrom.lastIndexOf("@") + 1).toLowerCase() !== mail.sendingDomain) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["provision", "mailProfile", "mailFrom"], message: "MAIL_FROM_NOT_ON_SENDING_DOMAIN" });
  }
  const superusers = config.provision.platformSuperuserEmails;
  if (superusers && new Set(superusers.map((value) => value.trim().toLowerCase())).size !== superusers.length) {
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["provision", "platformSuperuserEmails"], message: "DUPLICATE_PLATFORM_SUPERUSER" });
  }
});

// packages/cloud-deploy/src/cn-migration-source-identity.ts
var hash2 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var id = external_exports.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
var port = external_exports.number().int().min(1).max(65535);
var migrationSourceSchema = external_exports.object({
  accountId: id,
  regionId: id,
  dbInstanceId: id,
  database: id,
  user: id,
  endpointSha256: hash2,
  serverAddressSha256: hash2.nullable(),
  port: port.nullable(),
  identityLane: external_exports.enum(["sql-server-address", "aliyun-private-endpoint"]),
  clientPeerAddressSha256: hash2,
  clientPeerPort: port,
  configurationSha256: hash2,
  providerEvidenceSha256: hash2,
  sslMode: external_exports.enum(["disable", "verify-full"]),
  clientEncrypted: external_exports.boolean(),
  clientTlsAuthorized: external_exports.boolean()
}).strict();
var requestId = external_exports.string().min(1);
var exception = deploymentInputSchema.shape.environment.options[1].shape.rdsTlsException.unwrap();
var sourceEvidenceSchema = external_exports.object({
  request: external_exports.object({ regionId: id, dbInstanceId: id }).strict(),
  configuration: external_exports.object({
    sha256: hash2,
    endpointSha256: hash2,
    regionId: id,
    rdsInstanceId: id,
    host: external_exports.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/),
    port,
    database: id,
    user: id,
    sslMode: external_exports.enum(["disable", "verify-full"]),
    rdsTlsException: exception.optional()
  }).strict(),
  stsResponse: external_exports.object({ RequestId: requestId, AccountId: id }).passthrough(),
  attributeResponse: external_exports.object({ RequestId: requestId, Items: external_exports.object({ DBInstanceAttribute: external_exports.array(external_exports.object({
    DBInstanceId: id,
    RegionId: id,
    Engine: external_exports.literal("PostgreSQL"),
    InstanceNetworkType: external_exports.literal("VPC"),
    DBInstanceNetType: external_exports.literal("Intranet"),
    DBInstanceStatus: external_exports.literal("Running"),
    ConnectionString: external_exports.string().min(1),
    Port: external_exports.string().regex(/^[0-9]+$/),
    VpcId: id
  }).passthrough()).length(1) }).passthrough() }).passthrough(),
  netInfoResponse: external_exports.object({ RequestId: requestId, InstanceNetworkType: external_exports.literal("VPC"), DBInstanceNetInfos: external_exports.object({ DBInstanceNetInfo: external_exports.array(external_exports.object({
    IPType: external_exports.string(),
    VPCId: id,
    Port: external_exports.string().regex(/^[0-9]+$/),
    ConnectionString: external_exports.string(),
    IPAddress: external_exports.string()
  }).passthrough()).min(1).max(32) }).passthrough() }).passthrough()
}).strict();
var identityHash = (v) => (0, import_node_crypto4.createHash)("sha256").update(v).digest("hex");
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, value]) => [k, canonical(value)]));
  return v;
}
var providerIdentityDigest = (e) => identityHash(JSON.stringify(canonical({ request: e.request, stsResponse: e.stsResponse, attributeResponse: e.attributeResponse, netInfoResponse: e.netInfoResponse })));
function ipv42(s) {
  if ((0, import_node_net.isIP)(s) !== 4) return;
  return s.split(".").reduce((n, v) => n * 256 + Number(v) >>> 0, 0);
}
function inCidr(ip, cidr) {
  const [address, bits, ...extra] = cidr.split("/");
  const n = address === void 0 ? void 0 : ipv42(address), value = ipv42(ip), length = Number(bits);
  if (extra.length || n === void 0 || value === void 0 || !/^\d+$/.test(bits ?? "") || length < 1 || length > 32) return false;
  const mask = 4294967295 << 32 - length >>> 0;
  return (n & mask) === (value & mask);
}
function privateAddress(ip) {
  return ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].some((c) => inCidr(ip, c));
}
function verifyExternalSourceIdentity(source2, e) {
  const c = e.configuration, a = e.attributeResponse.Items.DBInstanceAttribute[0];
  if (c.regionId !== e.request.regionId || c.rdsInstanceId !== e.request.dbInstanceId || source2.accountId !== e.stsResponse.AccountId || source2.regionId !== e.request.regionId || source2.dbInstanceId !== e.request.dbInstanceId || a.DBInstanceId !== source2.dbInstanceId || a.RegionId !== source2.regionId || a.ConnectionString !== c.host || Number(a.Port) !== c.port || source2.database !== c.database || source2.user !== c.user || source2.configurationSha256 !== c.sha256 || source2.sslMode !== c.sslMode || source2.endpointSha256 !== c.endpointSha256 || source2.endpointSha256 !== identityHash(`${c.host}:${c.port}`) || source2.providerEvidenceSha256 !== providerIdentityDigest(e)) return false;
  const endpoints = e.netInfoResponse.DBInstanceNetInfos.DBInstanceNetInfo.filter((n2) => n2.IPType === "Private" && n2.ConnectionString === c.host && Number(n2.Port) === c.port && n2.VPCId === a.VpcId);
  if (endpoints.length !== 1) return false;
  const n = endpoints[0];
  if (!privateAddress(n.IPAddress) || source2.clientPeerAddressSha256 !== identityHash(n.IPAddress) || source2.clientPeerPort !== c.port) return false;
  if (c.sslMode === "disable") {
    if (source2.clientEncrypted || source2.clientTlsAuthorized || !c.rdsTlsException || !c.rdsTlsException.allowedCidrs.length) return false;
  } else if (!source2.clientEncrypted || !source2.clientTlsAuthorized) return false;
  if (source2.identityLane === "aliyun-private-endpoint") return source2.serverAddressSha256 === null && source2.port === null;
  return source2.serverAddressSha256 !== null && source2.port !== null;
}

// packages/cloud-deploy/src/cn-migration-snapshot.ts
var hash3 = external_exports.string().regex(/^[a-f0-9]{64}$/);
var id2 = external_exports.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
var utc = external_exports.string().datetime({ offset: false });
var count = external_exports.number().int().nonnegative().max(1e5);
var source = migrationSourceSchema;
var migrationSnapshotBindingSchema = external_exports.object({
  schemaVersion: external_exports.literal(2),
  source,
  sourceEvidence: sourceEvidenceSchema,
  cloud: external_exports.object({ ecsInstanceId: id2, invokeId: id2, commandId: id2, querySha256: hash3 }).strict()
}).strict();
var envelope = external_exports.object({
  schemaVersion: external_exports.literal(2),
  kind: external_exports.literal("cn-readonly-migration-snapshot"),
  capturedAt: utc,
  source,
  fullResponseBase64: external_exports.string().min(1),
  fullResponseSha256: hash3
}).strict();
var row = external_exports.object({ name: external_exports.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/).max(255), checksum: hash3 }).strict();
var payload = external_exports.object({
  schemaVersion: external_exports.literal(2),
  kind: external_exports.literal("cn-migration-ledger-output"),
  querySha256: hash3,
  readOnly: external_exports.literal(true),
  transactionIsolation: external_exports.literal("repeatable read"),
  source,
  independentSqlCount: count,
  ledger: external_exports.array(row).max(1e5),
  ledgerSha256: hash3
}).strict();
var sha2562 = (input) => (0, import_node_crypto5.createHash)("sha256").update(input).digest("hex");
function migrationLedgerDigest(ledger) {
  return sha2562(JSON.stringify([...ledger].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}
var MigrationSnapshotError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "MigrationSnapshotError";
  }
  code;
};
function fail2(code) {
  throw new MigrationSnapshotError(code);
}
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) fail2("MIGRATION_SNAPSHOT_SCHEMA_INVALID");
  return result.data;
}
function decode64(value, max) {
  if (value.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail2("MIGRATION_SNAPSHOT_ENCODING_INVALID");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.length > max) fail2("MIGRATION_SNAPSHOT_ENCODING_INVALID");
  return bytes;
}
function json(bytes) {
  try {
    return JSON.parse(new import_node_util.TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail2("MIGRATION_SNAPSHOT_RESPONSE_INVALID");
  }
}
function object(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail2("MIGRATION_SNAPSHOT_RESPONSE_INVALID");
  return value;
}
function validateMigrationSnapshot(value, expectedValue) {
  const expected = parse(migrationSnapshotBindingSchema, expectedValue);
  const input = parse(envelope, value);
  if (!verifyExternalSourceIdentity(expected.source, expected.sourceEvidence)) fail2("MIGRATION_SNAPSHOT_EXTERNAL_IDENTITY_INVALID");
  if (JSON.stringify(input.source) !== JSON.stringify(expected.source)) fail2("MIGRATION_SNAPSHOT_SOURCE_MISMATCH");
  const bytes = decode64(input.fullResponseBase64, 2 * 1024 * 1024);
  if (sha2562(bytes) !== input.fullResponseSha256) fail2("MIGRATION_SNAPSHOT_RESPONSE_HASH_MISMATCH");
  const response = object(json(bytes));
  if (typeof response.RequestId !== "string" || !response.RequestId || response.NextToken !== void 0 && response.NextToken !== "") fail2("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const invocation = object(response.Invocation);
  if (invocation.TotalCount !== 1 || invocation.NextToken !== void 0 && invocation.NextToken !== "") fail2("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const results = object(invocation.InvocationResults).InvocationResult;
  if (!Array.isArray(results) || results.length !== 1) fail2("MIGRATION_SNAPSHOT_RESPONSE_PARTIAL");
  const result = object(results[0]);
  if (result.Dropped !== 0) fail2("MIGRATION_SNAPSHOT_OUTPUT_DROPPED");
  if (result.ExitCode !== 0 || result.InvocationStatus !== "Success" || result.ErrorCode !== void 0 && result.ErrorCode !== "") fail2("MIGRATION_SNAPSHOT_COMMAND_FAILED");
  if (result.InstanceId !== expected.cloud.ecsInstanceId || result.InvokeId !== expected.cloud.invokeId || result.CommandId !== expected.cloud.commandId) fail2("MIGRATION_SNAPSHOT_CLOUD_IDENTITY_MISMATCH");
  if (!utc.safeParse(result.FinishedTime).success || typeof result.Output !== "string") fail2("MIGRATION_SNAPSHOT_RESPONSE_INVALID");
  const finished = Date.parse(result.FinishedTime);
  if (Date.parse(input.capturedAt) < finished) fail2("MIGRATION_SNAPSHOT_TIME_INVALID");
  const prefix = "WSX_CN_MIGRATION_SNAPSHOT_V2=";
  let output;
  try {
    output = new import_node_util.TextDecoder("utf-8", { fatal: true }).decode(decode64(result.Output, 24 * 1024));
  } catch {
    return fail2("MIGRATION_SNAPSHOT_ENCODING_INVALID");
  }
  if (!output.startsWith(prefix) || !/^WSX_CN_MIGRATION_SNAPSHOT_V2=[A-Za-z0-9+/]+={0,2}\n?$/.test(output)) fail2("MIGRATION_SNAPSHOT_OUTPUT_INVALID");
  let decoded;
  try {
    decoded = json((0, import_node_zlib.gunzipSync)(decode64(output.slice(prefix.length).trimEnd(), 24 * 1024), { maxOutputLength: 8 * 1024 * 1024 }));
  } catch {
    return fail2("MIGRATION_SNAPSHOT_OUTPUT_INVALID");
  }
  const sql = parse(payload, decoded);
  if (JSON.stringify(sql.source) !== JSON.stringify(expected.source) || sql.querySha256 !== expected.cloud.querySha256) fail2("MIGRATION_SNAPSHOT_SQL_IDENTITY_MISMATCH");
  if (sql.independentSqlCount !== sql.ledger.length) fail2("MIGRATION_SNAPSHOT_COUNT_MISMATCH");
  if (new Set(sql.ledger.map((item) => item.name)).size !== sql.ledger.length) fail2("MIGRATION_SNAPSHOT_DUPLICATE_NAME");
  if (migrationLedgerDigest(sql.ledger) !== sql.ledgerSha256) fail2("MIGRATION_SNAPSHOT_LEDGER_HASH_MISMATCH");
  return {
    ledger: [...sql.ledger].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    sourceBindingSha256: sha2562(JSON.stringify(expected)),
    snapshotSha256: sha2562(JSON.stringify(input)),
    fullResponseSha256: input.fullResponseSha256,
    ledgerSha256: sql.ledgerSha256,
    independentSqlCount: sql.independentSqlCount,
    capturedAt: input.capturedAt,
    scope: "validated-private-read-only-snapshot"
  };
}

// packages/cloud-deploy/src/cn-migration-completion.ts
function reject(code) {
  throw new Error(`MIGRATION_COMPLETION_${code}`);
}
async function verifyMigrationCompletion(snapshotInput, bindingInput, checkout, expected, now = /* @__PURE__ */ new Date(), ttlMs = 36e5) {
  if (!releaseManifestSchema.shape.sourceRevision.safeParse(expected.sourceRevision).success || !releaseManifestSchema.shape.sourceRevision.safeParse(expected.baselineRevision).success || !releaseManifestSchema.shape.release.safeParse(expected.release).success || typeof expected.attemptId !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(expected.attemptId) || typeof expected.originalPlanSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expected.originalPlanSha256)) reject("RELEASE_BINDING_INVALID");
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 36e5) reject("FRESHNESS_WINDOW_INVALID");
  const binding = migrationSnapshotBindingSchema.parse(bindingInput);
  const productionSource = migrationSourceSchema.parse(expected.productionSource);
  if (JSON.stringify(binding.source) !== JSON.stringify(productionSource)) reject("PRODUCTION_TARGET_MISMATCH");
  const snapshot = validateMigrationSnapshot(snapshotInput, binding);
  const response = JSON.parse(Buffer.from(snapshotInput.fullResponseBase64, "base64").toString("utf8"));
  const finishedAt = response.Invocation.InvocationResults.InvocationResult[0].FinishedTime;
  for (const timestamp of [snapshot.capturedAt, finishedAt]) {
    const observed = Date.parse(timestamp);
    if (!Number.isFinite(observed) || observed > now.getTime() || now.getTime() - observed >= ttlMs) reject("SNAPSHOT_NOT_FRESH");
  }
  const original = expected.originalPlan;
  if (!original || original.targetSha !== expected.sourceRevision || original.baselineSha !== expected.baselineRevision || original.planSha256 !== expected.originalPlanSha256 || original.drift.length !== 0) reject("ORIGINAL_PLAN_BINDING_INVALID");
  const recomputed = await generateMigrationPlan(checkout, {
    targetSha: expected.sourceRevision,
    baselineSha: expected.baselineRevision,
    ledger: original.ledger,
    ...original.snapshotEvidence ? { snapshotEvidence: original.snapshotEvidence } : {}
  });
  if (recomputed.planSha256 !== expected.originalPlanSha256) reject("ORIGINAL_PLAN_CHANGED");
  const after = await generateMigrationPlan(checkout, {
    targetSha: expected.sourceRevision,
    baselineSha: expected.baselineRevision,
    ledger: snapshot.ledger,
    snapshotEvidence: {
      snapshotSha256: snapshot.snapshotSha256,
      sourceBindingSha256: snapshot.sourceBindingSha256,
      fullResponseSha256: snapshot.fullResponseSha256,
      ledgerSha256: snapshot.ledgerSha256,
      independentSqlCount: snapshot.independentSqlCount,
      capturedAt: snapshot.capturedAt
    }
  });
  if (after.sourceInventorySha256 !== recomputed.sourceInventorySha256 || after.pending.length !== 0 || after.drift.length !== 0 || after.blockers.length !== 0 || !after.ready) reject("LEDGER_INCOMPLETE_OR_DRIFTED");
  return {
    schemaVersion: 1,
    scope: "validated-production-migration-completion",
    sourceRevision: expected.sourceRevision,
    baselineRevision: expected.baselineRevision,
    attemptId: expected.attemptId,
    release: expected.release,
    originalPlanSha256: expected.originalPlanSha256,
    completionPlanSha256: after.planSha256,
    sourceInventorySha256: after.sourceInventorySha256,
    sourceBindingSha256: snapshot.sourceBindingSha256,
    snapshotSha256: snapshot.snapshotSha256,
    fullResponseSha256: snapshot.fullResponseSha256,
    ledgerSha256: snapshot.ledgerSha256,
    appliedSqlCount: snapshot.independentSqlCount,
    pendingCount: 0,
    driftCount: 0,
    unknownAppliedCount: 0,
    capturedAt: snapshot.capturedAt,
    providerFinishedAt: finishedAt,
    expiresAt: new Date(Math.min(Date.parse(snapshot.capturedAt), Date.parse(finishedAt)) + ttlMs).toISOString(),
    productionMutationAuthorized: false
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/reused_actions.ts
function offlinePreparedAction(receipt, manifestBytes, verifyOfflineArtifacts) {
  return async (identity) => {
    const prepared = validatePreparedCnRelease(receipt);
    const manifest = verifyPreparedReleaseManifest(receipt, manifestBytes);
    if (prepared.sourceRevision !== identity.sourceRevision || manifest.sourceRevision !== identity.sourceRevision) throw new Error("OFFLINE_APPLICATION_IDENTITY_MISMATCH");
    await verifyOfflineArtifacts();
  };
}
function exactMigrationAction(input, transport) {
  return async (identity) => {
    if (input.plan.targetSha !== identity.sourceRevision || input.plan.baselineSha !== identity.baselineRevision || input.expectedCompletion.originalPlanSha256 !== identity.migrationPlanSha256 || input.expectedCompletion.attemptId !== identity.attemptId || input.expectedCompletion.sourceRevision !== identity.sourceRevision || input.expectedCompletion.baselineRevision !== identity.baselineRevision) throw new Error("EXACT_MIGRATION_BINDING_MISMATCH");
    if (!migrationSourceSchema.safeParse(input.expectedCompletion.productionSource).success) throw new Error("EXACT_MIGRATION_PRODUCTION_SOURCE_INVALID");
    const recomputed = await generateMigrationPlan(input.checkout, input.plan);
    const permitted = /* @__PURE__ */ new Set(["pending_contract", "pending_destructive"]);
    if (recomputed.planSha256 !== identity.migrationPlanSha256 || recomputed.drift.length || recomputed.blockers.some((code) => !permitted.has(code))) throw new Error("EXACT_MIGRATION_PLAN_CHANGED_OR_UNSAFE");
    if (!input.expectedCompletion.originalPlan || JSON.stringify(input.expectedCompletion.originalPlan) !== JSON.stringify(recomputed)) throw new Error("EXACT_MIGRATION_ORIGINAL_PLAN_CHANGED");
    await transport.verifyLiveWriterBarrier();
    const result = await transport.migrate();
    if (JSON.stringify(result.applied) !== JSON.stringify(recomputed.pending.map((x) => x.name)) || JSON.stringify(result.skipped) !== JSON.stringify(recomputed.ledger.map((x) => x.name))) throw new Error("EXACT_MIGRATION_APPLIED_SET_MISMATCH");
    await transport.verifyLiveWriterBarrier();
    const after = await transport.readFreshCompletion();
    await verifyMigrationCompletion(after.snapshot, after.binding, input.checkout, input.expectedCompletion);
  };
}
function preparedActivationAction(receipt, actions) {
  return async (identity) => {
    const prepared = validatePreparedCnRelease(receipt);
    if (prepared.sourceRevision !== identity.sourceRevision) throw new Error("ACTIVATION_IDENTITY_MISMATCH");
    const report = await activatePreparedCnRelease(receipt, actions);
    if (report.status !== "passed") throw new Error("MAINTENANCE_ACTIVATION_NOT_ACCEPTED");
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/dynamic_gate.ts
var COLLECTOR = "/usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh";
var VERIFIER = "/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh";
function productionDynamicActions(collector, verifier, release, runBash, readValidatedReceipt) {
  if (collector.path !== COLLECTOR || verifier.path !== VERIFIER) throw new Error("PREFLIGHT_COMMAND_AUTHORITY");
  if (!/^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*)?$/.test(release)) throw new Error("RELEASE_INVALID");
  let collectedIdentity;
  return {
    verifyProductionDynamic: async (identity) => {
      if (!/^[a-f0-9]{40}$/.test(identity.sourceRevision) || !/^[a-zA-Z0-9-]{1,128}$/.test(identity.attemptId)) throw new Error("DYNAMIC_IDENTITY_INVALID");
      await runBash(collector, ["--maintenance", "preactivate", identity.sourceRevision, release, identity.attemptId]);
      collectedIdentity = { ...identity };
    },
    verifyPreactivate: async (identity) => {
      if (!collectedIdentity || JSON.stringify(collectedIdentity) !== JSON.stringify(identity)) throw new Error("DYNAMIC_GATE_NOT_COLLECTED");
      await runBash(verifier, ["--maintenance", "preactivate", identity.sourceRevision, release, identity.attemptId]);
      await readValidatedReceipt(identity, release);
    }
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/typed_operations.ts
var activationMethods = ["readBaselineFingerprint", "drainRuns", "promotePreparedPointer", "activateTraffic", "verifyCanonical", "runBrowserSmoke", "restoreBaseline", "restorePointer"];
async function bindTypedProductionOperations(value) {
  const missing = [];
  for (const key of ["verifyOfflineArtifacts", "replayPreholdRecovery", "verifyCandidateAcceptance", "readValidatedReceipt", "runBash", "assertProtectedInputs"]) if (typeof value[key] !== "function") missing.push(key);
  if (!Buffer.isBuffer(value.preparedManifest) || value.preparedReceipt === void 0) missing.push("preparedArtifacts");
  if (!value.migration) missing.push("migrationInputs");
  for (const key of ["migrate", "readFreshCompletion", "verifyLiveWriterBarrier"]) if (typeof value.migrationTransport?.[key] !== "function") missing.push("migrationTransport." + key);
  for (const key of activationMethods) if (typeof value.activation?.[key] !== "function") missing.push("activation." + key);
  if (!value.collector || !value.preactivateVerifier || !value.release) missing.push("dynamicInputs");
  if (missing.length) throw new Error("PROTECTED_OPERATIONS_MISSING:" + missing.sort().join(","));
  const input = value;
  await input.assertProtectedInputs();
  const dynamic = productionDynamicActions(input.collector, input.preactivateVerifier, input.release, input.runBash, input.readValidatedReceipt);
  return {
    prepareOffline: offlinePreparedAction(input.preparedReceipt, input.preparedManifest, input.verifyOfflineArtifacts),
    verifyThreeDatabaseRecovery: input.replayPreholdRecovery,
    migrateExactPlan: exactMigrationAction(input.migration, input.migrationTransport),
    ...dynamic,
    activate: preparedActivationAction(input.preparedReceipt, input.activation),
    verifyAcceptance: input.verifyCandidateAcceptance
  };
}

// packages/cloud-deploy/src/cn-maintenance-host/entry.ts
function reject2(message) {
  throw new Error(message);
}
function same(a, b) {
  return !!a && typeof a === "object" && Object.keys(a).sort().join(",") === Object.keys(b).sort().join(",") && Object.entries(b).every(([k, v]) => a[k] === v);
}
var consumerImplementations = {};
function parseEntryPlan(value) {
  if (!value || typeof value !== "object") reject2("HOST_PLAN_SCHEMA");
  const plan = value;
  if (Object.keys(plan).sort().join(",") !== ["schemaVersion", "productionActionsAuthorized", "identity", "host", "production", "recoveryPlanPath", "recoveryPlanSha256"].sort().join(",") || plan.schemaVersion !== 1 || plan.productionActionsAuthorized !== true) reject2("HOST_PLAN_SCHEMA");
  const id3 = plan.identity;
  if (!id3 || Object.keys(id3).sort().join(",") !== "attemptId,baselineRevision,migrationPlanSha256,sourceRevision" || !/^[a-f0-9]{40}$/.test(id3.sourceRevision) || !/^[a-f0-9]{40}$/.test(id3.baselineRevision) || !/^[a-f0-9]{64}$/.test(id3.migrationPlanSha256) || !/^[A-Za-z0-9-]{1,128}$/.test(id3.attemptId)) reject2("HOST_PLAN_IDENTITY");
  if (!plan.host || !plan.production || !same(plan.host.identity, id3) || !same(plan.production.identity, id3)) reject2("HOST_PLAN_IDENTITY");
  if (plan.recoveryPlanPath !== `/etc/workspacex-cn/maintenance-recovery/${id3.sourceRevision}/${id3.attemptId}/recovery-plan.json` || !/^[a-f0-9]{64}$/.test(plan.recoveryPlanSha256)) reject2("HOST_PLAN_RECOVERY_BINDING");
  if (plan.production.recoveryPreflight?.planPath !== plan.recoveryPlanPath || plan.production.recoveryPreflight?.planSha256 !== plan.recoveryPlanSha256 || plan.production.recoveryPreflight?.command.path !== "/usr/local/lib/workspacex-cn/cn-production-recovery-executor.py") reject2("HOST_PLAN_RECOVERY_BINDING");
  return plan;
}
async function executeBoundEntry(plan, inputs, verifyProfile) {
  const actions = await bindTypedProductionOperations(inputs);
  const primitives = productionPrimitives(plan.production, runFixedPython, verifyProfile, inheritedFd9Lock);
  Object.assign(primitives, actions);
  await runHostMaintenanceRetainingFd9({ ...plan.identity, maintenanceOptIn: "stop-all-writes-and-require-database-recovery" }, plan.host, primitives, runFixedPython);
}
async function main(args) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) reject2("ROOT_LINUX_REQUIRED");
  if (args.length !== 3 || args[0] !== "--run-reviewed-maintenance" || typeof args[1] !== "string" || typeof args[2] !== "string" || !/^\/etc\/workspacex-cn\//.test(args[1]) || !/^[a-f0-9]{64}$/.test(args[2])) reject2("HOST_ENTRY_USAGE");
  const plan = parseEntryPlan(protectedPrivateJson(args[1], args[2]));
  const profile = protectedPrivateJson("/etc/workspacex-cn/trusted-tool-binding.json");
  if (profile.toolRevision !== plan.production.toolRevision) reject2("HOST_PROFILE_TOOL_REVISION");
  const descriptor = profile.maintenanceHostController;
  if (!descriptor || descriptor.toolRevision !== profile.toolRevision || profile.filesSha256?.[descriptor.sourcePath] !== descriptor.sha256 || descriptor.path !== process.argv[1] || !descriptor.path.endsWith(".cjs")) reject2("HOST_ENTRY_PROFILE_BINDING");
  const fd = protectedExecutable(descriptor);
  try {
    if ((0, import_node_crypto6.createHash)("sha256").update((0, import_node_fs3.readFileSync)(fd)).digest("hex") !== descriptor.sha256) reject2("HOST_ENTRY_PROFILE_BINDING");
  } finally {
    (0, import_node_fs3.closeSync)(fd);
  }
  await inheritedFd9Lock();
  await executeBoundEntry(plan, consumerImplementations, async (host, binding) => {
    const commands = [host.hold, host.writerFence, binding.recoveryPreflight.command, ...Object.values(binding.operations).map((op) => op.command)];
    for (const command of commands) {
      const hash4 = profile.installedFilesSha256?.[command.path];
      if (hash4 !== command.sha256) reject2("HOST_COMMAND_PROFILE_BINDING");
      const fd2 = protectedExecutable(command);
      (0, import_node_fs3.closeSync)(fd2);
    }
  });
}
if (process.argv[1]?.endsWith("cn-maintenance-host-controller.cjs")) main(process.argv.slice(2)).catch((error) => {
  const code = error instanceof Error ? error.message : "";
  process.stderr.write(code.startsWith("PROTECTED_OPERATIONS_MISSING:") && /^[A-Za-z0-9_.,:]+$/.test(code) ? code + "\n" : "MAINTENANCE_HOST_ENTRY_REJECTED\n");
  process.exitCode = 1;
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  consumerImplementations,
  executeBoundEntry,
  main,
  parseEntryPlan
});
