/**
 * Counterproof for #620 (P0): the deploy gate must list EVERY missing/invalid required env
 * var in one probe, and the message must name the specific variable -- not "deploy failed".
 *
 * This exercises `probeRequiredEnv` directly, the same way
 * `tests/capability/model/kernel-boot-fails-loudly.test.ts` exercises `createApp()` --
 * in-process, no subprocess, no real VM, no DB connection (see that file's own note: the
 * kernel's instantiation phase never opens one).
 *
 * Fixture strategy: mutate `process.env` the way a `deploy.env` missing a key would leave
 * it, call the probe, then restore in `afterEach` -- `probeRequiredEnv` itself restores
 * whatever IT touched, but the test's own setup (deleting a var vitest.config injected) has
 * to be undone by the test, same pattern `kernel-boot-fails-loudly.test.ts` already uses.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MODEL_CREDENTIAL_KEY_ENV } from "../../src/infrastructure/model/aes-credential-cipher";
import { probeRequiredEnv } from "../../scripts/verify-required-env";

process.env.KERNEL_QUIET = "1";

const ORIGINAL_MODEL_KEY = process.env[MODEL_CREDENTIAL_KEY_ENV];
const ORIGINAL_EMAIL_SECRET = process.env.EMAIL_VERIFICATION_SECRET;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const BOARD_ENV = [
  "WORKSPACEX_BOARD_BLOB_PROVIDER",
  "WORKSPACEX_BOARD_SINGLE_REPLICA",
  "WORKSPACEX_BOARD_BLOB_ROOT",
  "WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS",
  "WORKSPACEX_BOARD_HOSTED_PROVIDER",
  "WORKSPACEX_BOARD_KEY_PROVIDER",
  "WORKSPACEX_BOARD_KEY_DIRECTORY",
  "WORKSPACEX_BOARD_KMS_ENDPOINT",
  "WORKSPACEX_BOARD_KMS_TOKEN",
  "WORKSPACEX_BOARD_KMS_KEY_ID",
  "WORKSPACEX_BOARD_BLOB_BUCKET",
  "WORKSPACEX_BOARD_BLOB_PREFIX",
  "WORKSPACEX_BOARD_BLOB_OBJECT_LOCK",
  "WORKSPACEX_BOARD_S3_ENDPOINT",
  "WORKSPACEX_BOARD_S3_PROFILE",
  "WORKSPACEX_BOARD_S3_REGION",
  "WORKSPACEX_BOARD_S3_ACCESS_KEY_ID",
  "WORKSPACEX_BOARD_S3_SECRET_ACCESS_KEY",
  "WORKSPACEX_BOARD_S3_SESSION_TOKEN",
  "WORKSPACEX_BOARD_R2_MANAGEMENT_ENDPOINT",
  "WORKSPACEX_BOARD_R2_ACCOUNT_ID",
  "WORKSPACEX_BOARD_R2_MANAGEMENT_TOKEN",
  "WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_ENDPOINT",
  "WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_TOKEN",
  "WORKSPACEX_BOARD_OSS_ENDPOINT",
  "WORKSPACEX_BOARD_OSS_REGION",
  "WORKSPACEX_BOARD_OSS_AUTH_MODE",
  "WORKSPACEX_BOARD_OSS_ROLE_NAME",
  "WORKSPACEX_BOARD_OSS_ACCESS_KEY_ID",
  "WORKSPACEX_BOARD_OSS_ACCESS_KEY_SECRET",
  "WORKSPACEX_BOARD_OSS_SECURITY_TOKEN",
] as const;
const ORIGINAL_BOARD_ENV = new Map(BOARD_ENV.map(name => [name, process.env[name]]));

function restoreEnv(): void {
  if (ORIGINAL_MODEL_KEY === undefined) delete process.env[MODEL_CREDENTIAL_KEY_ENV];
  else process.env[MODEL_CREDENTIAL_KEY_ENV] = ORIGINAL_MODEL_KEY;

  if (ORIGINAL_EMAIL_SECRET === undefined) delete process.env.EMAIL_VERIFICATION_SECRET;
  else process.env.EMAIL_VERIFICATION_SECRET = ORIGINAL_EMAIL_SECRET;

  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;

  for (const name of BOARD_ENV) {
    const original = ORIGINAL_BOARD_ENV.get(name);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

function configureProductionBoardStorage(): void {
  process.env.WORKSPACEX_BOARD_SINGLE_REPLICA = "true";
  process.env.WORKSPACEX_BOARD_BLOB_ROOT = "/var/lib/workspacex-required-env-test";
  process.env.WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS = "604800000";
  process.env.WORKSPACEX_BOARD_KEY_PROVIDER = "versioned-kms";
  process.env.WORKSPACEX_BOARD_KEY_DIRECTORY = "/var/lib/workspacex-required-env-test/keys";
  delete process.env.WORKSPACEX_BOARD_KMS_ENDPOINT;
  delete process.env.WORKSPACEX_BOARD_KMS_TOKEN;
  delete process.env.WORKSPACEX_BOARD_KMS_KEY_ID;
}

function configureProductionHostedS3(profile: "aws-s3" | "r2" | "minio" = "aws-s3"): void {
  configureProductionBoardStorage();
  process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "hosted";
  process.env.WORKSPACEX_BOARD_HOSTED_PROVIDER = "s3-compatible";
  process.env.WORKSPACEX_BOARD_BLOB_BUCKET = "required-env-private-board";
  process.env.WORKSPACEX_BOARD_BLOB_PREFIX = "board-content";
  process.env.WORKSPACEX_BOARD_BLOB_OBJECT_LOCK = "disabled";
  process.env.WORKSPACEX_BOARD_S3_ENDPOINT = "https://127.0.0.1:9";
  process.env.WORKSPACEX_BOARD_S3_PROFILE = profile;
  process.env.WORKSPACEX_BOARD_S3_REGION = "us-test-1";
  process.env.WORKSPACEX_BOARD_S3_ACCESS_KEY_ID = "required-env-access";
  process.env.WORKSPACEX_BOARD_S3_SECRET_ACCESS_KEY = "required-env-secret";
}

function configureProductionHostedOss(authMode: "environment" | "ecs-role"): void {
  configureProductionBoardStorage();
  process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "hosted";
  process.env.WORKSPACEX_BOARD_HOSTED_PROVIDER = "aliyun-oss";
  process.env.WORKSPACEX_BOARD_BLOB_BUCKET = "required-env-private-board";
  process.env.WORKSPACEX_BOARD_BLOB_PREFIX = "board-content";
  process.env.WORKSPACEX_BOARD_BLOB_OBJECT_LOCK = "disabled";
  process.env.WORKSPACEX_BOARD_OSS_ENDPOINT = "https://127.0.0.1:9";
  process.env.WORKSPACEX_BOARD_OSS_REGION = "cn-test";
  process.env.WORKSPACEX_BOARD_OSS_AUTH_MODE = authMode;
}

describe("verify-required-env: fail-closed before the restart, missing var named", () => {
  afterEach(restoreEnv);

  it("control: with every required var present, the probe boots clean", async () => {
    // vitest.config.ts already injects MODEL_CREDENTIAL_KEY for every test file; NODE_ENV
    // here is vitest's own ("test"), so EMAIL_VERIFICATION_SECRET's production check does
    // not fire -- this is the "deploy.env is complete" case.
    const result = await probeRequiredEnv();

    expect(result.ok).toBe(true);
    expect(result.missingVars).toEqual([]);
    expect(result.invalidVars).toEqual([]);
  });

  it("① 反证：deploy.env 拿掉 MODEL_CREDENTIAL_KEY —— 探测在触碰服务之前失败，且点名该变量", async () => {
    delete process.env[MODEL_CREDENTIAL_KEY_ENV];

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).toContain(MODEL_CREDENTIAL_KEY_ENV);
    // Not a generic "deploy failed" -- the specific variable name is in the result.
    expect(result.missingVars.join(",")).not.toBe("");
  });

  it("值存在但不合法（太短）时归为 invalid，不是 missing，且仍点名变量与原因", async () => {
    // Present but violates HmacEmailVerificationTokenCodec's own length check --
    // unconditional on NODE_ENV, since `emailVerificationSecret()` returns any truthy
    // configured value regardless of environment.
    process.env.EMAIL_VERIFICATION_SECRET = "too-short";

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).not.toContain("EMAIL_VERIFICATION_SECRET");
    const found = result.invalidVars.find((v) => v.name === "EMAIL_VERIFICATION_SECRET");
    expect(found).toBeDefined();
    expect(found?.message).toContain("32 bytes");
  });

  it("②一次性列全：两个必需变量同时缺失时，单次探测把两个都列出来（不是一次一个）", async () => {
    delete process.env[MODEL_CREDENTIAL_KEY_ENV];
    delete process.env.EMAIL_VERIFICATION_SECRET;
    // Only in production does EMAIL_VERIFICATION_SECRET become required -- reproduces the
    // actual deploy-time condition, not just the unit-level function.
    process.env.NODE_ENV = "production";
    process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "filesystem";
    configureProductionBoardStorage();

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).toEqual(
      expect.arrayContaining([MODEL_CREDENTIAL_KEY_ENV, "EMAIL_VERIFICATION_SECRET"]),
    );
    // Discovered in ONE probeRequiredEnv() call -- not two separate restart cycles.
    expect(result.missingVars.length).toBeGreaterThanOrEqual(2);
  });

  it("③ 对照：把两个变量都补上之后，同一份探测正常起得来（证明①②不是「总是失败」骗过去的）", async () => {
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    process.env.NODE_ENV = "production";
    process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "filesystem";
    configureProductionBoardStorage();

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(true);
    expect(result.missingVars).toEqual([]);
    expect(result.invalidVars).toEqual([]);
  });

  it("Board provider 缺失时点名缺失变量，并用合法 fixture 继续完成探测", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionBoardStorage();
    delete process.env.WORKSPACEX_BOARD_BLOB_PROVIDER;

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).toContain("WORKSPACEX_BOARD_BLOB_PROVIDER");
    expect(result.invalidVars).not.toContainEqual(expect.objectContaining({ name: "WORKSPACEX_BOARD_BLOB_PROVIDER" }));
  });

  it("Board provider 非法时归为 invalid，且 runtime 的 fail-closed 原因保持可见", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionBoardStorage();
    process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "not-a-provider";

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).not.toContain("WORKSPACEX_BOARD_BLOB_PROVIDER");
    expect(result.invalidVars).toContainEqual({
      name: "WORKSPACEX_BOARD_BLOB_PROVIDER",
      message: "WORKSPACEX_BOARD_BLOB_PROVIDER must be filesystem or hosted",
    });
  });

  it("Board key provider 缺失时点名变量，用 versioned-kms sentinel 后继续完成探测", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "filesystem";
    configureProductionBoardStorage();
    delete process.env.WORKSPACEX_BOARD_KEY_PROVIDER;

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).toContain("WORKSPACEX_BOARD_KEY_PROVIDER");
    expect(result.invalidVars).not.toContainEqual(expect.objectContaining({ name: "WORKSPACEX_BOARD_KEY_PROVIDER" }));
    expect(process.env.WORKSPACEX_BOARD_KEY_PROVIDER).toBeUndefined();
  });

  it("Board key provider 非法时归为 invalid，且保留合法值集合的原因", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "filesystem";
    configureProductionBoardStorage();
    process.env.WORKSPACEX_BOARD_KEY_PROVIDER = "not-a-key-provider";

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).not.toContain("WORKSPACEX_BOARD_KEY_PROVIDER");
    expect(result.invalidVars).toContainEqual({
      name: "WORKSPACEX_BOARD_KEY_PROVIDER",
      message: "WORKSPACEX_BOARD_KEY_PROVIDER must be development-env or versioned-kms",
    });
    expect(process.env.WORKSPACEX_BOARD_KEY_PROVIDER).toBe("not-a-key-provider");
  });

  it("Board rollback window 缺失时点名变量，且探测后完整恢复缺失状态", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "filesystem";
    configureProductionBoardStorage();
    delete process.env.WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS;

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).toContain("WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS");
    expect(result.invalidVars).not.toContainEqual(expect.objectContaining({ name: "WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS" }));
    expect(process.env.WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS).toBeUndefined();
  });

  it("Board rollback window 非法时归为 invalid 并恢复原值", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "filesystem";
    configureProductionBoardStorage();
    process.env.WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS = "0";

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.invalidVars).toContainEqual({
      name: "WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS",
      message: "WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS must be a positive safe integer",
    });
    expect(process.env.WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS).toBe("0");
  });

  it("Board rollback window 合法时 production kernel 能正常启动", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    process.env.WORKSPACEX_BOARD_BLOB_PROVIDER = "filesystem";
    configureProductionBoardStorage();

    await expect(probeRequiredEnv()).resolves.toMatchObject({ ok: true, missingVars: [], invalidVars: [] });
  });

  it("Hosted provider 缺失时沿真实 production DI 汇总完整 AWS S3 配置并恢复环境", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionHostedS3();
    const missing = [
      "WORKSPACEX_BOARD_HOSTED_PROVIDER",
      "WORKSPACEX_BOARD_BLOB_BUCKET",
      "WORKSPACEX_BOARD_BLOB_PREFIX",
      "WORKSPACEX_BOARD_S3_ENDPOINT",
      "WORKSPACEX_BOARD_S3_PROFILE",
      "WORKSPACEX_BOARD_S3_REGION",
      "WORKSPACEX_BOARD_S3_ACCESS_KEY_ID",
      "WORKSPACEX_BOARD_S3_SECRET_ACCESS_KEY",
    ] as const;
    for (const name of missing) delete process.env[name];

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).toEqual(expect.arrayContaining([...missing]));
    expect(result.invalidVars).toEqual([]);
    for (const name of missing) expect(process.env[name]).toBeUndefined();
  });

  it("Hosted/S3 非法值逐项归因并恢复原值，不被 client unavailable 泛化", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionHostedS3();
    const invalid = new Map<string, string>([
      ["WORKSPACEX_BOARD_HOSTED_PROVIDER", "invalid-hosted"],
      ["WORKSPACEX_BOARD_BLOB_BUCKET", "   "],
      ["WORKSPACEX_BOARD_BLOB_PREFIX", "private/../escape"],
      ["WORKSPACEX_BOARD_BLOB_OBJECT_LOCK", "sometimes"],
      ["WORKSPACEX_BOARD_S3_ENDPOINT", "not-a-url"],
      ["WORKSPACEX_BOARD_S3_PROFILE", "generic"],
      ["WORKSPACEX_BOARD_S3_REGION", "   "],
      ["WORKSPACEX_BOARD_S3_ACCESS_KEY_ID", "   "],
      ["WORKSPACEX_BOARD_S3_SECRET_ACCESS_KEY", "   "],
    ]);
    for (const [name, value] of invalid) process.env[name] = value;

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).toEqual([]);
    expect(result.invalidVars.map(value => value.name)).toEqual(expect.arrayContaining([...invalid.keys()]));
    for (const [name, value] of invalid) expect(process.env[name]).toBe(value);
  });

  it.each([
    ["r2", ["WORKSPACEX_BOARD_R2_MANAGEMENT_ENDPOINT", "WORKSPACEX_BOARD_R2_ACCOUNT_ID", "WORKSPACEX_BOARD_R2_MANAGEMENT_TOKEN"]],
    ["minio", ["WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_ENDPOINT", "WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_TOKEN"]],
  ] as const)("所选 %s profile 的治理变量由完整 createApp 探测汇总", async (profile, conditional) => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionHostedS3(profile);
    for (const name of conditional) delete process.env[name];

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).toEqual(expect.arrayContaining([...conditional]));
    for (const name of conditional) expect(process.env[name]).toBeUndefined();
  });

  it.each([
    ["r2", new Map<string, string>([
      ["WORKSPACEX_BOARD_R2_MANAGEMENT_ENDPOINT", "not-a-url"],
      ["WORKSPACEX_BOARD_R2_ACCOUNT_ID", "   "],
      ["WORKSPACEX_BOARD_R2_MANAGEMENT_TOKEN", "   "],
    ])],
    ["minio", new Map<string, string>([
      ["WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_ENDPOINT", "not-a-url"],
      ["WORKSPACEX_BOARD_MINIO_POLICY_INSPECTOR_TOKEN", "   "],
    ])],
  ] as const)("所选 %s profile 的非法治理变量逐项归因并恢复", async (profile, invalid) => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionHostedS3(profile);
    for (const [name, value] of invalid) process.env[name] = value;

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.invalidVars.map(value => value.name)).toEqual(expect.arrayContaining([...invalid.keys()]));
    for (const [name, value] of invalid) expect(process.env[name]).toBe(value);
  });

  it("所选 Aliyun OSS provider 的 endpoint/auth/credential 配置由完整 createApp 汇总", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionHostedS3();
    process.env.WORKSPACEX_BOARD_HOSTED_PROVIDER = "aliyun-oss";
    const conditional = [
      "WORKSPACEX_BOARD_OSS_ENDPOINT",
      "WORKSPACEX_BOARD_OSS_REGION",
      "WORKSPACEX_BOARD_OSS_AUTH_MODE",
      "WORKSPACEX_BOARD_OSS_ACCESS_KEY_ID",
      "WORKSPACEX_BOARD_OSS_ACCESS_KEY_SECRET",
    ] as const;
    for (const name of conditional) delete process.env[name];

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    expect(result.missingVars).toEqual(expect.arrayContaining([...conditional]));
    for (const name of conditional) expect(process.env[name]).toBeUndefined();
  });

  it.each([
    [undefined, true],
    ["   ", false],
  ] as const)("OSS ecs-role 的 ROLE_NAME %s 时被归因并精确恢复", async (roleName, missing) => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionHostedOss("ecs-role");
    if (roleName === undefined) delete process.env.WORKSPACEX_BOARD_OSS_ROLE_NAME;
    else process.env.WORKSPACEX_BOARD_OSS_ROLE_NAME = roleName;

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(false);
    if (missing) expect(result.missingVars).toContain("WORKSPACEX_BOARD_OSS_ROLE_NAME");
    else expect(result.invalidVars.map(value => value.name)).toContain("WORKSPACEX_BOARD_OSS_ROLE_NAME");
    expect(process.env.WORKSPACEX_BOARD_OSS_ROLE_NAME).toBe(roleName);
  });

  it("OSS ecs-role 原始配置完整但凭据/readiness 失败时保持 fail closed", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionHostedOss("ecs-role");
    process.env.WORKSPACEX_BOARD_OSS_ROLE_NAME = "production-board-role";

    await expect(probeRequiredEnv()).rejects.toThrow(/cannot attribute.*hosted board storage is unavailable/);
    expect(process.env.WORKSPACEX_BOARD_OSS_ROLE_NAME).toBe("production-board-role");
  });

  it("Hosted 原始配置完整但 readiness 不可达时仍 fail closed，不把运行时故障伪装成 env 通过", async () => {
    process.env.NODE_ENV = "production";
    process.env[MODEL_CREDENTIAL_KEY_ENV] = "counterproof-key-not-a-production-secret";
    process.env.EMAIL_VERIFICATION_SECRET = "counterproof-email-secret-at-least-32-bytes-long";
    configureProductionHostedS3();

    await expect(probeRequiredEnv()).rejects.toThrow(/cannot attribute.*hosted board storage is unavailable/);
  });

  it("探测不到归因的失败会响亮地抛，而不是悄悄放行（机械门控，不猜）", async () => {
    // A message shape none of EXTRACTORS match must not be silently swallowed into "ok".
    // We cannot easily force such a message from real code without adding a fake provider,
    // so this asserts the documented contract at the unit level instead: probeRequiredEnv
    // exhausting maxAttempts without ever booting clean or discovering a var throws, rather
    // than returning a falsely-passing result.
    await expect(probeRequiredEnv(0)).rejects.toThrow(/never booted clean/);
  });
});

/**
 * #3033 —— native 准入开着却缺 API→Deep Agent 回调地址，此前不在必需清单里：
 * `subtaskCallbackBaseUrl?` 是可选的，DI 不抛，5c 放行，到运行时 `runControlConfig()`
 * 才 throw MODEL_CALL_FAILED——于是 DevApp 上每一条 chat 0 秒 0 工具地死在用户面前。
 * 这条钉住：DI 硬门存在，且措辞让 5c 能**点名**这个变量，而不是一句「启动失败」。
 */
describe("#3033 verify-required-env 必须点名 KERNEL_SUBTASK_CALLBACK_BASE_URL（native 准入开着时）", () => {
  const NATIVE_VARS = ["KERNEL_NATIVE_RUNTIME", "NATIVE_SESSION_SOCKET", "NATIVE_SESSION_BINDING_KEY", "KERNEL_SUBTASK_CALLBACK_BASE_URL"] as const;
  const saved = new Map<string, string | undefined>();
  afterEach(() => {
    for (const name of NATIVE_VARS) {
      const prior = saved.get(name);
      if (prior === undefined) delete process.env[name]; else process.env[name] = prior;
    }
    saved.clear();
  });
  function armNativeRuntimeWithoutCallback(): void {
    for (const name of NATIVE_VARS) saved.set(name, process.env[name]);
    process.env.KERNEL_NATIVE_RUNTIME = "1";
    process.env.NATIVE_SESSION_SOCKET = "/run/workspacex-native-sessions/skill-sandbox.sock";
    process.env.NATIVE_SESSION_BINDING_KEY = "a".repeat(64);
    delete process.env.KERNEL_SUBTASK_CALLBACK_BASE_URL;
  }

  it("准入=1 且缺回调地址 ⇒ 探测失败并点名 KERNEL_SUBTASK_CALLBACK_BASE_URL", async () => {
    armNativeRuntimeWithoutCallback();
    const result = await probeRequiredEnv();
    expect(result.ok).toBe(false);
    expect(result.missingVars).toContain("KERNEL_SUBTASK_CALLBACK_BASE_URL");
  });

  it("对照：准入=1 且回调地址在 ⇒ 不再因它失败", async () => {
    armNativeRuntimeWithoutCallback();
    process.env.KERNEL_SUBTASK_CALLBACK_BASE_URL = "http://workspacex-api-host:3200";
    const result = await probeRequiredEnv();
    expect(result.missingVars).not.toContain("KERNEL_SUBTASK_CALLBACK_BASE_URL");
  });
});
