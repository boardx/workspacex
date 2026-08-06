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

function restoreEnv(): void {
  if (ORIGINAL_MODEL_KEY === undefined) delete process.env[MODEL_CREDENTIAL_KEY_ENV];
  else process.env[MODEL_CREDENTIAL_KEY_ENV] = ORIGINAL_MODEL_KEY;

  if (ORIGINAL_EMAIL_SECRET === undefined) delete process.env.EMAIL_VERIFICATION_SECRET;
  else process.env.EMAIL_VERIFICATION_SECRET = ORIGINAL_EMAIL_SECRET;

  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
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

    const result = await probeRequiredEnv();

    expect(result.ok).toBe(true);
    expect(result.missingVars).toEqual([]);
    expect(result.invalidVars).toEqual([]);
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
