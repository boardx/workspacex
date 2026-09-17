/**
 * WorkspaceX Local -- Electron main process.
 *
 * Responsibilities, and only these: decide where the bundle and the data dir are, run the
 * hardware doctor, drive `@repo/local-runtime`'s `up()`, show progress while it runs, open
 * the web UI in a BrowserWindow, and stop everything on quit. Everything about ports, env,
 * seeds and process order lives in local-runtime so the CLI and the desktop cannot drift.
 *
 * Night 0 scope (PROP §4): unsigned macOS build, web served by `next start` from a prior
 * `next build` inside the bundle. Auto-update, tray, Windows: R1.
 */
import { app, BrowserWindow, dialog, shell } from "electron";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localSessionUrl, resolveLocalConfig, runDoctor, signInLocal, up, type RunningStack } from "@repo/local-runtime";

let stack: RunningStack | null = null;
let win: BrowserWindow | null = null;

/** Packaged: resources/bundle is the monorepo subset electron-builder copied (see electron-builder.yml). Dev: the repo itself. */
function bundleRoot(): string {
  const packaged = join(process.resourcesPath ?? "", "bundle");
  if (app.isPackaged && existsSync(packaged)) return packaged;
  return join(__dirname, "..", "..", "..");
}

/** Packaged: resources/models holds the Ollama models fetch-models.sh exported (see electron-builder.yml). Dev: apps/desktop/models if present. */
function bundleModelsDir(): string | undefined {
  const dir = join(process.resourcesPath ?? "", "models");
  if (existsSync(dir)) return dir;
  const dev = join(bundleRoot(), "apps", "desktop", "models");
  return existsSync(dev) ? dev : undefined;
}

/** Packaged: resources/asr-models (bundle-asr-model.sh). Dev: apps/desktop/asr-models if present. */
function bundleAsrModelsDir(): string | undefined {
  const dir = join(process.resourcesPath ?? "", "asr-models");
  if (existsSync(dir)) return dir;
  const dev = join(bundleRoot(), "apps", "desktop", "asr-models");
  return existsSync(dev) ? dev : undefined;
}

function bundleBinDir(): string | undefined {
  const dir = join(process.resourcesPath ?? "", "bin");
  return app.isPackaged && existsSync(dir) ? dir : undefined;
}

function progressHtml(lines: string[]): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] ?? ch));
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><title>WorkspaceX Local</title>
<style>body{font:14px -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#0f1115;color:#e6e6e6}
h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;font:12px ui-monospace,monospace;color:#9aa4b2;max-height:70vh;overflow:auto}</style>
<h1>WorkspaceX Local 正在启动……</h1><p>首次启动会跑数据库迁移并下载模型，可能需要几分钟。</p><pre>${esc(lines.slice(-200).join("\n"))}</pre></html>`;
}

/**
 * A GUI app on macOS starts with PATH=/usr/bin:/bin:/usr/sbin:/sbin -- no `node`. Everything
 * local-runtime spawns from the bundle (`node_modules/.bin/tsx`, `next`) is a `#!/usr/bin/env
 * node` script, so on a machine without a system Node the first migration run died with
 * `exec: node: not found` and the window sat behind a modal error (Mac实测 2026-09-17, DMG
 * launched from Finder). Electron ships Node: expose it as `node` through a tiny shim and put
 * the shim first on PATH. Children inherit PATH (processes.ts baseEnv), so `tsx` -> `node`
 * -> this shim -> Electron-as-Node.
 */
function ensureNodeOnPath(): void {
  const shimDir = join(app.getPath("userData"), "bin");
  mkdirSync(shimDir, { recursive: true });
  const shim = join(shimDir, "node");
  writeFileSync(shim, `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 });
  process.env.PATH = `${shimDir}:${process.env.PATH ?? "/usr/bin:/bin"}`;
}

async function boot(): Promise<void> {
  ensureNodeOnPath();
  const repoRoot = bundleRoot();
  const dataDir = join(app.getPath("userData"), "local");
  const doctor = runDoctor({ dataDir, repoRoot, bundleBinDir: bundleBinDir() });
  if (!doctor.ok) {
    await dialog.showMessageBox({ type: "error", title: "这台电脑不满足运行要求", message: doctor.findings.join("\n") });
    app.quit();
    return;
  }

  win = new BrowserWindow({ width: 1280, height: 860, show: true, webPreferences: { contextIsolation: true } });
  const lines: string[] = [];
  const render = (): void => { void win?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(progressHtml(lines))}`); };
  let renderTimer: NodeJS.Timeout | null = null;
  let showingApp = false; // once the web UI is loaded, the progress page must never repaint over it
  // Same lines as the window, on disk: a failure behind a modal dialog is otherwise invisible
  // to anyone not sitting at the screen (Mac实测 2026-09-17, two silent "启动失败" in a row).
  mkdirSync(dataDir, { recursive: true });
  const desktopLog = join(dataDir, "desktop.log");
  const log = (line: string): void => {
    try { appendFileSync(desktopLog, `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ }
    lines.push(line);
    if (showingApp || renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; if (!showingApp) render(); }, 300);
  };
  render();

  const config = resolveLocalConfig({ repoRoot, dataDir });
  const built = existsSync(join(repoRoot, "apps", "web", ".next", "BUILD_ID"));
  try {
    stack = await up({ config, log, webMode: built ? "start" : "dev", bundleBinDir: bundleBinDir(), bundleModelsDir: bundleModelsDir(), bundleAsrModelsDir: bundleAsrModelsDir() });
  } catch (e) {
    log(`启动失败: ${e instanceof Error ? e.message : String(e)}`);
    await dialog.showMessageBox({ type: "error", title: "启动失败", message: e instanceof Error ? e.message : String(e), detail: lines.slice(-30).join("\n") });
    app.quit();
    return;
  }
  for (const w of stack.warnings) log(`⚠ ${w}`);
  // ⚠ Order matters: the warning lines above armed a 300 ms repaint of the progress page; if
  //   the web UI is loaded first, that repaint replaces it and the window looks stuck on the
  //   log forever (人类实测 2026-09-17: every start with a warning "hung" on this page).
  showingApp = true;
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  // Single-user desktop: sign in with the account the runtime generated and hand the session
  // to the login page (人类决策 2026-09-17: 本地版不该还要登录). If that fails for any
  // reason the plain login page is the fallback -- never a blank window.
  let target = stack.urls.web;
  try {
    target = localSessionUrl(stack.urls.web, await signInLocal(stack.urls.api, stack.login));
  } catch (e) {
    log(`自动登录失败，改为显示登录页: ${e instanceof Error ? e.message : String(e)}`);
  }
  await win.loadURL(target);
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
}

app.whenReady().then(() => void boot());
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (e) => {
  if (!stack) return;
  e.preventDefault();
  const s = stack;
  stack = null;
  void s.stop().finally(() => app.quit());
});
