/**
 * Two-way assertions for the three runtime gates. Driven by verify-runtime-gates.sh.
 *
 * The app is booted in-process so stdout can be intercepted: the error-boundary contract
 * has two halves -- what must NOT be in the response, and what MUST be in the log under
 * the same traceId. Checking only the first half would let an implementation that swallows
 * errors entirely pass, and that trades security for unoperability.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/main";
import { SENSITIVE_CANARY } from "../src/interface/controllers/kernel-probe.controller";

const PORT = 33210;
const PROD_PORT = 33211;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_PRINCIPAL = "u-1:org-a";
/** Resolve tsx ourselves: going through `pnpm exec` adds a wrapper process that survives kill. */
const TSX_BIN = createRequire(import.meta.url).resolve("tsx/cli");

let bad = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  process.stderr.write(`  ${cond ? "✓" : "✗"} ${label}${cond ? "" : ` -- ${detail}`}\n`);
  if (!cond) bad++;
};

/* Capture what the app writes to stdout so the log half of G6 can be asserted. */
const logLines: string[] = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
  logLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
  return (realWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const app = await createApp();
await app.listen(PORT);

const auth = { "x-kernel-test-principal": TEST_PRINCIPAL };

/* ── G1 / G2: the auth gate, both directions ─────────────────────────────── */

const g1 = await fetch(`${BASE}/kernel/probe/whoami`);
check("G1 no credentials -> 401 (not 200, not anonymous pass-through)", g1.status === 401, `got ${g1.status}`);
const g1body = (await g1.json()) as { error?: string; traceId?: string };
check("G1 rejection still carries a traceId", typeof g1body.traceId === "string" && g1body.traceId.length > 0);
check("G1 error code comes from the closed set", g1body.error === "unauthenticated", String(g1body.error));

const g2 = await fetch(`${BASE}/kernel/probe/whoami`, { headers: auth });
const g2body = (await g2.json()) as { userId?: string; orgId?: string };
check("G2 valid credentials -> 200", g2.status === 200, `got ${g2.status}`);
check("G2 the handler received a non-empty principal", g2body.userId === "u-1" && g2body.orgId === "org-a", JSON.stringify(g2body));

/* Public routes stay reachable -- otherwise "everything is 401" would pass G1 trivially. */
const pub = await fetch(`${BASE}/healthz`);
check("public route is reachable without credentials (guard is selective, not blanket-deny)", pub.status === 200, `got ${pub.status}`);

/* ── G3 / G4: the validation gate, both directions ───────────────────────── */

const g3 = await fetch(`${BASE}/kernel/probe/validate`, {
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify({ orgId: 123, object: { kind: "nope", id: "x" } }),
});
const g3body = (await g3.json()) as { error?: string; fields?: { path: string; code: string }[] };
check("G3 body violating the contract -> 400", g3.status === 400, `got ${g3.status}`);
check("G3 errors are FIELD-LEVEL, not a blanket 400", (g3body.fields?.length ?? 0) > 0, JSON.stringify(g3body));
check(
  "G3 field paths name the offending fields",
  (g3body.fields ?? []).some((f) => f.path === "orgId") && (g3body.fields ?? []).some((f) => f.path.startsWith("object")),
  JSON.stringify(g3body.fields),
);
// ⚠ 比对时剔除 traceId：它是随机 UUID，撞上 "123" 这种三位数字子串的概率不低
//   （CI 真实出现过 traceId=540dede6-...-bfb0-123b9c394ac4 把这条判红），而 traceId
//   本来就不是"提交的值"。只看除 traceId 以外的响应体。
const { traceId: _g3TraceId, ...g3bodySansTrace } = g3body as { traceId?: string } & typeof g3body;
check(
  "G3 the response does not echo the submitted values back",
  !JSON.stringify(g3bodySansTrace).includes("123") && !JSON.stringify(g3bodySansTrace).includes("nope"),
  JSON.stringify(g3body),
);

const g4 = await fetch(`${BASE}/kernel/probe/validate`, {
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify({ orgId: "org-a", object: { kind: "project", id: "p-1" }, action: "read" }),
});
check("G4 contract-conforming body passes", g4.status === 201 || g4.status === 200, `got ${g4.status}`);

/* ── G5 / G6: the error boundary ─────────────────────────────────────────── */

const before = logLines.length;
const g5 = await fetch(`${BASE}/kernel/probe/boom`, { headers: auth });
const g5text = await g5.text();
const g5body = JSON.parse(g5text) as { error?: string; traceId?: string };
check("G5 unhandled exception -> 500", g5.status === 500, `got ${g5.status}`);
check("G5 response body says only internal_error", g5body.error === "internal_error", g5text);
check("G5 response does NOT contain the sensitive canary", !g5text.includes(SENSITIVE_CANARY), g5text);
check("G5 response contains no table name", !g5text.includes("acl_bindings"), g5text);
check("G5 response contains no stack trace", !/\bat\s+\w+.*\(/.test(g5text), g5text);
check("G5 response carries a traceId", typeof g5body.traceId === "string" && g5body.traceId.length > 0);

const since = logLines.slice(before).join("");
check("G6 the log DOES contain the detail (kept out of the response, not swallowed)", since.includes(SENSITIVE_CANARY));
check("G6 the log line carries the same traceId as the response", since.includes(g5body.traceId ?? "\x00"));

await app.close();

/* ── G7: the test-injection channel is unreachable in production ─────────── */

/**
 * This assertion was VACUOUS on its first version, and only the counter-proof exposed it.
 *
 * The child was spawned as `pnpm exec tsx src/main.ts` and torn down with
 * `child.kill("SIGKILL")` -- which kills the pnpm wrapper and orphans the actual node
 * server. The orphan kept holding the port, so every later run's child died with
 * EADDRINUSE while the ORPHAN answered the request. The orphan had been built from
 * correct code, so the check stayed green even after the production guard was deleted.
 *
 * Two changes make it real:
 *   * refuse to run if the port is already taken (an answer from something we did not
 *     start proves nothing);
 *   * spawn detached and kill the whole process group, so nothing is left behind.
 */
async function portIsFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) });
    return false;
  } catch {
    return true;
  }
}

check(
  `G7 port ${PROD_PORT} is free before we start (otherwise a stranger answers and the check proves nothing)`,
  await portIsFree(PROD_PORT),
  "something is already listening -- kill it and re-run",
);

const child = spawn(process.execPath, [TSX_BIN, "src/main.ts"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...process.env,
    NODE_ENV: "production",
    // Even with the flag explicitly ON, NODE_ENV=production must win. A switch that lets
    // you claim to be someone else is test tooling only while it is unreachable in prod.
    KERNEL_ALLOW_TEST_PRINCIPAL: "1",
    // ⚠ 刻意**不设** `KERNEL_QUIET`：它会连 Nest 的启动异常一起吞掉，
    //   而子进程起不来时那正是唯一有用的输出。本门控只跑几秒，日志噪音不是问题；
    //   「查不出为什么」才是。
    PORT: String(PROD_PORT),
    // ⚠ 生产模式**硬性要求**它（`email-verification-token-codec.ts:46`，#427 引入）。
    //   缺了它 Nest 在 DI 阶段就抛，子进程 3 秒内 exit 1 —— 而本门控此前把 stdio
    //   丢掉，于是只能报「child exited with 1」，谁也查不出为什么。
    //   这里给一个**显然是测试用**的值：本门控要验的是「生产模式下测试注入通道
    //   不可达」，不是密钥强度；用真值反而会把一个密钥带进 CI 日志的风险面。
    EMAIL_VERIFICATION_SECRET:
      // ⚠ 长度也有硬性下限（≥32 字节，同一个 codec 里的第二道校验）。写死一个
      //   够长且**一眼看得出是测试用**的常量，比 `openssl rand` 更好：门控要可重放，
      //   而随机值会让「这次为什么过/不过」变得不可复现。
      process.env.EMAIL_VERIFICATION_SECRET ??
      "runtime-gate-not-a-real-secret-0000000000000000",
    // #427 让生产启动还硬性依赖整套邮件投递配置（`cloudflare-email-transport.ts:24`）。
    // 本门控**从不真发信**，它验的是「生产模式下测试注入通道不可达」——
    // 所以这里全给一眼可辨的假值。⚠ 少任何一个，Nest 都在 DI 阶段抛，
    // 表现成「child exited with 1」，与本门控要验的东西毫无关系。
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "runtime-gate-fake-account",
    CLOUDFLARE_EMAIL_API_TOKEN:
      process.env.CLOUDFLARE_EMAIL_API_TOKEN ?? "runtime-gate-fake-token",
    MAIL_FROM: process.env.MAIL_FROM ?? "runtime-gate@example.invalid",
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL ?? "https://runtime-gate.example.invalid",
    CLOUDFLARE_EMAIL_PREVIEW_DISABLED: "true",
    // Blob-primary Board storage has its own production topology gate. G7 is about
    // proving the test-principal channel is closed, so give this child a complete,
    // explicit single-node filesystem fixture instead of letting an unrelated
    // missing-storage error make the assertion vacuous. The path need not be created:
    // G7 never opens a Board, but it is deliberately absolute, durable-looking, and
    // outside the OS temp tree so the real production checks remain exercised.
    WORKSPACEX_BOARD_BLOB_PROVIDER: "filesystem",
    WORKSPACEX_BOARD_SINGLE_REPLICA: "true",
    WORKSPACEX_BOARD_BLOB_ROOT: "/var/lib/workspacex-runtime-gate/board-content",
    // Online migration cutover remains rollback-capable until this explicit production
    // window elapses. G7 must exercise the same fail-closed startup contract as deployment.
    WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS: "604800000",
    WORKSPACEX_BOARD_CONTENT_KEYS:
      process.env.WORKSPACEX_BOARD_CONTENT_KEYS ??
      '{"1":"HR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0="}',
  },
  // ⚠ 曾经是 `"ignore"`。那让这道门在失败时**只能说「exited with 1」**——
  //   2026-08-05 main 因此红了一整轮，而真实原因（缺一个环境变量）一行就能看出来。
  //   一道说不出失败原因的门，等于把排查成本转嫁给下一个人。
  stdio: ["ignore", "ignore", "pipe"],
  detached: true,
});
let childStderr = "";
child.stderr?.on("data", (c: Buffer) => { childStderr += c.toString(); });
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (child.exitCode !== null) break; // died on startup -- do not wait out the loop
    up = !(await portIsFree(PROD_PORT));
  }
  check(
    "G7 the production child actually started",
    up,
    // 把子进程真正说了什么带出来：`exited with 1` 不是诊断，是一句谜语。
    `child exited with ${child.exitCode}${childStderr ? `\n      ↳ ${childStderr.trim().split("\n").slice(0, 6).join("\n      ↳ ")}` : ""}`,
  );
  if (up) {
    const g7 = await fetch(`http://127.0.0.1:${PROD_PORT}/kernel/probe/whoami`, { headers: auth });
    check("G7 the test-principal header is ignored in production -> 401", g7.status === 401, `got ${g7.status}`);
  }
} finally {
  // Negative pid = the whole process group. Killing the pid alone leaves the server behind.
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

process.stdout.write = realWrite;
process.stderr.write(
  bad === 0
    ? "\n✅ verify-runtime-gates: auth / validation / error boundary all assert in both directions, and the test-injection channel is closed in production\n"
    : `\n❌ verify-runtime-gates: ${bad} assertion(s) failed.\n`,
);
process.exit(bad === 0 ? 0 : 1);
