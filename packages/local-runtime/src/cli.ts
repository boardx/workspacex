#!/usr/bin/env -S pnpm exec tsx
/**
 * `pnpm local-runtime <cmd>` -- the same orchestration the desktop shell uses, without Electron.
 *
 *   up       start the whole stack; Ctrl-C stops it
 *   doctor   hardware / toolchain self-check, exit 1 when below minimum
 *   env      print the env the API would receive (secrets redacted)
 *
 * Flags: --data-dir <path> (default ~/.workspacex-local) --repo-root <path> --web dev|start|none --no-pull
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiEnv, resolveLocalConfig } from "./config";
import { runDoctor } from "./doctor";
import { up } from "./up";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2] ?? "help";
const repoRoot = resolve(flag("repo-root") ?? join(fileURLToPath(new URL("../../..", import.meta.url))));
const dataDir = resolve(flag("data-dir") ?? join(homedir(), ".workspacex-local"));

if (cmd === "doctor") {
  const r = runDoctor({ dataDir, repoRoot });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
} else if (cmd === "env") {
  const c = resolveLocalConfig({ repoRoot, dataDir });
  const env = apiEnv(c);
  for (const k of Object.keys(env).sort()) {
    const secret = /SECRET|KEY|PASSWORD/.test(k);
    console.log(`${k}=${secret ? "<redacted>" : env[k]}`);
  }
} else if (cmd === "up") {
  const c = resolveLocalConfig({ repoRoot, dataDir });
  const webMode = (flag("web") ?? "dev") as "dev" | "start" | "none";
  const stack = await up({ config: c, webMode, pullModel: !process.argv.includes("--no-pull") });
  console.log("\n✅ WorkspaceX Local 已启动");
  console.log(`   打开：${stack.urls.web}`);
  console.log(`   登录：${stack.login.email} / ${stack.login.password}`);
  console.log(`   API：${stack.urls.api}   Ollama：${stack.urls.ollama ?? "未运行"}   deep-agent：${stack.urls.deepAgent ?? "未运行"}`);
  for (const w of stack.warnings) console.log(`   ⚠ ${w}`);
  const shutdown = async (): Promise<void> => {
    console.log("\n停止中……");
    await stack.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
} else {
  console.log("usage: local-runtime up|doctor|env [--data-dir <path>] [--repo-root <path>] [--web dev|start|none] [--no-pull]");
  process.exit(cmd === "help" ? 0 : 2);
}
