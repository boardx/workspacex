#!/usr/bin/env -S pnpm exec tsx
/**
 * `pnpm local-runtime <cmd>` -- the same orchestration the desktop shell uses, without Electron.
 *
 *   up       start the whole stack; Ctrl-C stops it
 *   doctor   hardware / toolchain self-check, exit 1 when below minimum
 *   env      print the env the API would receive (secrets redacted)
 *
 * Flags: --data-dir <path> (default ~/.workspacex-local) --repo-root <path> --web dev|start|none --no-pull
 *        --ports api=3200,web=3100,deepAgent=2024,...   override any port from DEFAULT_PORTS
 *        --models-bundle <dir>   Ollama models shipped with the app (imported before the pull step)
 *        --asr-bundle <dir>      streaming ASR model shipped with the app (used in place when the data dir has none)
 *        --bundle-bin <dir>      directory holding the bundled ollama binary (apps/desktop/bin)
 *   export-models [--source <ollama store>] [--dest <dir>] [--models a,b]   build-machine: copy models into the bundle
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiEnv, resolveLocalConfig, type LocalPorts } from "./config";
import { runDoctor } from "./doctor";
import { up } from "./up";
import { exportModels } from "./model-bundle";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2] ?? "help";
const repoRoot = resolve(flag("repo-root") ?? join(fileURLToPath(new URL("../../..", import.meta.url))));
const dataDir = resolve(flag("data-dir") ?? join(homedir(), ".workspacex-local"));
const ports: Partial<LocalPorts> = {};
for (const pair of (flag("ports") ?? "").split(",").filter(Boolean)) {
  const [k, v] = pair.split("=");
  const n = Number(v);
  if (!k || !Number.isInteger(n) || n <= 0) { console.error(`bad --ports entry: ${pair}`); process.exit(2); }
  (ports as Record<string, number>)[k] = n;
}

if (cmd === "doctor") {
  const r = runDoctor({ dataDir, repoRoot });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
} else if (cmd === "env") {
  const c = resolveLocalConfig({ repoRoot, dataDir, ports });
  const env = apiEnv(c);
  for (const k of Object.keys(env).sort()) {
    const secret = /SECRET|KEY|PASSWORD/.test(k);
    console.log(`${k}=${secret ? "<redacted>" : env[k]}`);
  }
} else if (cmd === "up") {
  const c = resolveLocalConfig({ repoRoot, dataDir, ports });
  const webMode = (flag("web") ?? "dev") as "dev" | "start" | "none";
  const bundleModelsDir = flag("models-bundle");
  const bundleAsrModelsDir = flag("asr-bundle");
  const bundleBinDir = flag("bundle-bin");
  const stack = await up({ config: c, webMode, pullModel: !process.argv.includes("--no-pull"), ...(bundleModelsDir ? { bundleModelsDir: resolve(bundleModelsDir) } : {}), ...(bundleAsrModelsDir ? { bundleAsrModelsDir: resolve(bundleAsrModelsDir) } : {}), ...(bundleBinDir ? { bundleBinDir: resolve(bundleBinDir) } : {}) });
  console.log("\n✅ WorkspaceX Local 已启动");
  console.log(`   打开：${stack.urls.web}`);
  console.log(`   登录：${stack.login.email} / ${stack.login.password}`);
  console.log(`   API：${stack.urls.api}   Ollama：${stack.urls.ollama ?? "未运行"}   deep-agent：${stack.urls.deepAgent ?? "未运行"}   ASR：${stack.urls.asr ?? "未运行"}`);
  for (const w of stack.warnings) console.log(`   ⚠ ${w}`);
  const shutdown = async (): Promise<void> => {
    console.log("\n停止中……");
    await stack.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("uncaughtException", (e) => { console.error(e); void shutdown(); });
  process.on("unhandledRejection", (e) => { console.error(e); void shutdown(); });
} else if (cmd === "export-models") {
  // Build-machine step (scripts/local-bundle/fetch-models.sh): copy the configured models out
  // of an Ollama store into the bundle dir that electron-builder ships as resources/models.
  const source = resolve(flag("source") ?? process.env.OLLAMA_MODELS ?? join(homedir(), ".ollama", "models"));
  const dest = resolve(flag("dest") ?? join(repoRoot, "apps", "desktop", "models"));
  const c = resolveLocalConfig({ repoRoot, dataDir, ports });
  const models = (flag("models") ?? `${c.chatModel},${c.embeddingModel}`).split(",").filter(Boolean);
  for (const r of exportModels(source, dest, models)) console.log(`exported ${r.model}: ${r.blobs} blob(s), ${(r.bytes / 1024 / 1024).toFixed(0)} MB -> ${dest}`);
} else {
  console.log("usage: local-runtime up|doctor|env|export-models [--data-dir <path>] [--repo-root <path>] [--web dev|start|none] [--no-pull] [--models-bundle <dir>] [--source <store>] [--dest <dir>] [--models a,b]");
  process.exit(cmd === "help" ? 0 : 2);
}
