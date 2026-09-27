#!/usr/bin/env node
/**
 * #4366（S9）记忆体验评测的启动器：先起确定性嵌入提供方（apps/api/scripts/loopback-kg-eval-embedding-provider.ts），
 * 把 API 连上它所需的四个环境变量交给 playwright（playwright config 的 API webServer 继承 `process.env`），再跑评测。
 *
 * 不改评测本身（检查、语料、回环模型、种子、playwright config 都在 rubric-lock.json 的指纹里）：这里只是**环境**——
 * 与调用方给 Postgres / Redis 端口是同一层。端口由 `WORKSPACEX_EMBEDDING_PROVIDER_PORT` 给，缺了就抛，不猜默认值。
 *
 *   PW_EXECUTABLE=… WORKSPACEX_EMBEDDING_PROVIDER_PORT=… pnpm run e2e:kg-experience [playwright 参数]
 */
import { spawn } from "node:child_process";

const port = process.env.WORKSPACEX_EMBEDDING_PROVIDER_PORT;
if (!port) throw new Error("WORKSPACEX_EMBEDDING_PROVIDER_PORT is required; see evidence/kg-experience-eval/README.md");

const embeddingEnv = {
  KERNEL_EMBEDDING_MODEL_ID: "kg-eval-loopback-embedding",
  KERNEL_EMBEDDING_MODEL_VERSION: "v1",
  KERNEL_DEEP_AGENT_BASE_URL: `http://127.0.0.1:${port}`,
  DEEP_AGENT_SERVICE_INTERNAL_KEY: "kg-eval-embedding-key-not-a-secret",
};
const env = { ...process.env, ...embeddingEnv };

const provider = spawn("pnpm", ["--filter", "@repo/api", "exec", "tsx", "scripts/loopback-kg-eval-embedding-provider.ts"], {
  env: { ...env, LOOPBACK_KG_EVAL_EMBEDDING_PORT: port }, stdio: "inherit",
});

async function waitHealthy() {
  for (let i = 0; i < 120; i += 1) {
    if (provider.exitCode !== null) throw new Error("loopback embedding provider exited before becoming healthy");
    const ok = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("loopback embedding provider did not become healthy");
}

let code = 1;
try {
  await waitHealthy();
  const pw = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.kg-experience-eval.config.ts", ...process.argv.slice(2)], {
    env, stdio: "inherit",
  });
  // 嵌入提供方中途退出（例如登记模型失败）⇒ 评测环境不完整：停掉评测，如实失败。
  provider.on("exit", (c) => { if (pw.exitCode === null) { console.error(`loopback embedding provider exited (${c}); stopping the evaluation`); pw.kill("SIGTERM"); } });
  code = await new Promise((resolve) => pw.on("exit", (c) => resolve(c ?? 1)));
} finally {
  provider.kill("SIGTERM");
}
process.exit(code);
