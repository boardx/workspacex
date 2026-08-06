/**
 * Pre-restart gate for #620 (P0): list EVERY missing/invalid required env var in one shot,
 * before `deploy.sh` touches `systemctl restart`.
 *
 * ## The incident this exists for
 *
 * 2026-08-06, twice: `v0.1.18-staging` deployed, `workspacex-api.service` crash-looped,
 * `/api/healthz` 502. Root cause both times was the same SHAPE: a provider factory in
 * `kernel.module.ts` throws `missing env var X` during Nest DI, `deploy.env` had never been
 * synced with `X`, and the only way anyone found out was "restart, watch it crash, read the
 * journal, add ONE var, restart again" -- discovering exactly one missing var per cycle
 * (first `MODEL_CREDENTIAL_KEY`, earlier the same day `EMAIL_VERIFICATION_SECRET` plus the
 * Cloudflare email keys via the #563 gate).
 *
 * ## Why this is a runtime probe and not a hand-written list
 *
 * A list of variable names living in this file would drift from what the code actually
 * requires the moment someone adds a new eager env check to a DI provider factory --
 * that drift is exactly how both incidents above happened. AGENTS.md already has a name for
 * this failure mode ("同一事实不得声明在两处") and the project has hit it five times.
 *
 * `createApp()` (`src/main.ts`) already IS the single source of truth for "what does the
 * kernel need to come up": `NestFactory.create(..., { abortOnError: false })` rejects with a
 * legible message naming the offending var --
 * `tests/capability/model/kernel-boot-fails-loudly.test.ts` locks that contract in -- and,
 * per that same test's own comment, instantiation never opens a live DB connection
 * (`PgDatabase`'s constructor only builds a pool). This script reuses exactly that entry
 * point instead of re-declaring which vars matter.
 *
 * ## Why a retry loop instead of one call
 *
 * Nest's DI stops at the FIRST provider factory that throws -- that IS the "one crash, one
 * variable, repeat" shape this script exists to kill. So: boot, and if it throws, extract the
 * variable name from the (single-source) error message, inject one generic placeholder for
 * THAT variable only, and boot again. Repeat until it boots clean or nothing new is
 * discovered. The placeholder is one fixed string, not a per-variable table -- it only needs
 * to be non-empty and long enough to clear the simple length checks this codebase has today
 * (e.g. `EMAIL_VERIFICATION_SECRET must contain at least 32 bytes`). It is never used to talk
 * to anything real.
 *
 * ## What this deliberately does NOT flag
 *
 * `cloudflareEmailConfig` is wired through `lazyCloudflareEmailConfig()` precisely so a
 * missing Cloudflare key does NOT crash boot (see that file's header) -- that was the fix for
 * the OTHER half of the 2026-08-06 incident, done by making the check lazy rather than by
 * pre-populating `deploy.env`. Reusing `createApp()` inherits that fix for free: Cloudflare
 * keys will not be reported missing here, because the kernel no longer requires them to
 * start. A misconfigured Cloudflare account still fails, just at first-send time via
 * `MailTransportError` -- a different, already-handled, failure surface.
 *
 * ## What "attribute to a var" means, and what happens when it fails
 *
 * `EXTRACTORS` matches the error-message SHAPES this codebase's env checks are already
 * written in (`pg-config.ts`'s `req()`, `aes-credential-cipher.ts`,
 * `email-verification-token-codec.ts`). These are message-format patterns, not a list of
 * variable names -- the names themselves come only from whatever message the single-source
 * code actually threw. If boot fails with a message none of them match, this script refuses
 * to guess: it throws loudly (see `probeRequiredEnv`) rather than silently passing a check it
 * cannot actually attribute -- a silent pass here is worse than no check at all.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/main";

/** Non-empty, 40 bytes: clears every "must contain at least N bytes" check seen in this codebase. */
const PLACEHOLDER = "verify-required-env-probe-placeholder-0";

/**
 * Message-format patterns for this codebase's env checks. Adding a new eager check with a
 * genuinely new message shape means adding a pattern HERE, once -- not a variable name
 * anywhere else.
 */
const EXTRACTORS: readonly RegExp[] = [
  /^missing env var (\w+)$/,
  /^(\w+) is required in production$/,
  /^(\w+) must contain at least \d+ bytes$/,
];

function extractVarName(message: string): string | null {
  for (const re of EXTRACTORS) {
    const m = re.exec(message);
    if (m) return m[1] ?? null;
  }
  return null;
}

export interface EnvProbeResult {
  /** True once the kernel boots clean with every discovered var holding SOME value. */
  readonly ok: boolean;
  /** Vars whose value was empty/undefined when the probe started. */
  readonly missingVars: readonly string[];
  /** Vars that HAD a value but failed validation (e.g. too short) -- a config bug, not an absence. */
  readonly invalidVars: readonly { readonly name: string; readonly message: string }[];
}

/**
 * Boot the kernel repeatedly, discovering every required var by observing every DISTINCT
 * failure -- not just the first. Mutates `process.env` for the duration and restores it
 * exactly (original values, not just "set again") before returning or throwing. Never opens
 * a DB connection or talks to any external service -- see the module header.
 */
export async function probeRequiredEnv(maxAttempts = 25): Promise<EnvProbeResult> {
  const missingVars = new Set<string>();
  const invalidVars = new Map<string, string>();
  /** Original value per touched var, so restoration is exact even across repeated touches. */
  const saved = new Map<string, string | undefined>();

  const touch = (name: string) => {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    process.env[name] = PLACEHOLDER;
  };

  /**
   * Whether the loop eventually reached a clean boot -- via placeholders for whatever it
   * found missing/invalid along the way. This is NOT "the original env was already
   * sufficient" (that is `missingVars.length === 0 && invalidVars.length === 0`, computed
   * below): it is a sanity signal that discovery actually converged rather than looping
   * forever on an unattributable-but-persistent failure.
   */
  let bootedClean = false;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const app = await createApp();
        await app.close();
        bootedClean = true;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const name = extractVarName(message);
        if (name === null) {
          throw new Error(
            "verify-required-env: kernel boot failed with a message this probe cannot " +
              "attribute to an env var (add an EXTRACTORS pattern for the new message shape " +
              `-- do not hand-list the variable name instead): ${message}`,
          );
        }
        const priorValue = saved.has(name) ? saved.get(name) : process.env[name];
        if (priorValue === undefined || priorValue === "") missingVars.add(name);
        else invalidVars.set(name, message);
        touch(name);
      }
    }
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  if (!bootedClean && missingVars.size === 0 && invalidVars.size === 0) {
    throw new Error(
      "verify-required-env: kernel never booted clean and never surfaced an attributable " +
        "var within maxAttempts -- raise maxAttempts or check for a non-env boot failure",
    );
  }
  if (!bootedClean) {
    throw new Error(
      "verify-required-env: even after placeholdering every discovered var " +
        `(${[...missingVars, ...invalidVars.keys()].sort().join(", ")}), the kernel still ` +
        "would not boot within maxAttempts -- there is a boot failure this probe cannot " +
        "resolve by itself; raise maxAttempts or investigate directly with createApp()",
    );
  }

  return {
    // "ok" answers the question this script exists to answer: was the ORIGINAL env (before
    // any placeholder was injected) sufficient? Not "did the loop eventually converge".
    ok: missingVars.size === 0 && invalidVars.size === 0,
    missingVars: [...missingVars].sort(),
    invalidVars: [...invalidVars.entries()]
      .map(([name, message]) => ({ name, message }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Load `KEY=VALUE` lines from a deploy-env-shaped file into `process.env`, mirroring
 * `deploy.sh`'s own `grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs` + `export` -- so running
 * this script against a real (or fixture) `deploy.env` sees exactly what the shell would
 * have exported.
 */
export function loadEnvFile(path: string): void {
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "") continue;
    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  // Every attempted boot below is throwaway (torn down immediately after). Nest's own
  // per-attempt exception dump would otherwise interleave with -- and drown out -- this
  // script's own summary, which is the one meant to be read.
  process.env.KERNEL_QUIET ??= "1";

  const envFile = process.argv[2];
  if (envFile) loadEnvFile(envFile);

  const result = await probeRequiredEnv();

  if (result.ok) {
    console.log("✓ 必需 env var 全部就绪（探测自 createApp() 实际 DI 路径，不是手写清单）");
    return;
  }

  console.error("✗ 缺失/无效的必需 env var —— 一次性列全（不重启服务）：");
  for (const name of result.missingVars) console.error(`  - ${name}：缺失`);
  for (const { name, message } of result.invalidVars) console.error(`  - ${name}：值无效 -- ${message}`);
  process.exitCode = 1;
}

/**
 * Only run when invoked directly (`tsx verify-required-env.ts ...`), not when imported by
 * the test file -- mirrors `main.ts`'s own `isProcessEntry` reasoning: ESM imports are
 * hoisted, so gating on an env var would run too late.
 */
function isProcessEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isProcessEntry()) {
  await main();
}
