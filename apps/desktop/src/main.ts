/**
 * WorkspaceX (desktop) -- Electron main process.
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
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localSessionUrl, resolveLocalConfig, runDoctor, signInLocal, up, type RunningStack } from "@repo/local-runtime";
import { progressState, STARTUP_STEPS } from "./startup-progress";

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

/** Packaged: resources/python (bundle-python.sh: cpython/ + site/). Dev: apps/desktop/python if present. */
function bundlePythonDir(): string | undefined {
  const dir = join(process.resourcesPath ?? "", "python");
  if (app.isPackaged && existsSync(dir)) return dir;
  const dev = join(bundleRoot(), "apps", "desktop", "python");
  return existsSync(dev) ? dev : undefined;
}

function bundleBinDir(): string | undefined {
  const dir = join(process.resourcesPath ?? "", "bin");
  return app.isPackaged && existsSync(dir) ? dir : undefined;
}

const SLOGAN_EN = "A New Way to Create Together.";
const SLOGAN_ZH = "一种全新的共同创造方式。";
/** The wordmark from apps/web/public (resized copy in build/logo.png), inlined so the splash needs no server. */
const LOGO_DATA_URL = (() => {
  for (const candidate of [join(__dirname, "..", "build", "logo.png"), join(process.resourcesPath ?? "", "logo.png")]) {
    if (existsSync(candidate)) return `data:image/png;base64,${readFileSync(candidate).toString("base64")}`;
  }
  return null;
})();

/** `0.2.0 (8c11c8d)`: version from package.json, SHA from build-info.json (dev: git). */
function buildLabel(): string {
  let sha = "";
  for (const candidate of [join(process.resourcesPath ?? "", "build-info.json"), join(__dirname, "..", "build", "build-info.json")]) {
    try { sha = (JSON.parse(readFileSync(candidate, "utf8")) as { sha?: string }).sha ?? ""; if (sha) break; } catch { /* next */ }
  }
  if (!sha) { try { sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: bundleRoot(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* dev without git */ } }
  return sha ? `${app.getVersion()} (${sha})` : app.getVersion();
}

function progressHtml(lines: string[], state: { startedAt: number; failed: boolean }): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] ?? ch));
  // 首屏 HTML 与后续每秒推送的更新必须说同一句话——这段计算此前在本文件里抄了两份
  // （`progressState` 一份、这里一份），于是给「拉模型进度」加的那一支只改到了其中一份，
  // 首屏会显示旧文案、一秒后又跳成新文案。同一件事实不许声明在两处。
  const { step, pct, elapsed, current, hint } = progressState(lines, state);
  const total = STARTUP_STEPS.length;
  const logo = LOGO_DATA_URL ? `<img class="logo" src="${LOGO_DATA_URL}" alt="WorkspaceX">` : `<div class="wordmark">WorkspaceX</div>`;
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><title>WorkspaceX</title>
<style>
  body{font:14px -apple-system,system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:#111827}
  .card{width:min(520px,90vw)}
  .brand{display:flex;flex-direction:column;align-items:flex-start;gap:10px;margin-bottom:30px}
  .ver{font-size:11px;color:#8a8f98;letter-spacing:.02em}
  .logo{width:220px;height:auto}.wordmark{font-size:28px;font-weight:700;color:#ff1f7a}
  .slogan{color:#374151;font-size:15px;letter-spacing:.01em;line-height:1.6}.slogan .zh{color:#9ca3af;font-size:13px}
  .bar{height:6px;border-radius:3px;background:#f1f3f6;overflow:hidden}
  .fill{height:100%;width:${pct}%;background:${state.failed ? "#ef4444" : "linear-gradient(90deg,#ff9a3d,#ff1f7a)"};transition:width .4s}
  .row{display:flex;justify-content:space-between;margin-top:10px;color:#374151}
  .row .t{color:#9ca3af;font-variant-numeric:tabular-nums}
  .steps{display:flex;gap:6px;margin-top:14px}.steps i{flex:1;height:3px;border-radius:2px;background:#f1f3f6}
  .steps i.done{background:#ff5c8a}.steps i.now{background:#ff1f7a}
  .hint{color:#9ca3af;font-size:12px;margin-top:14px}
  details{margin-top:18px}summary{cursor:pointer;color:#9ca3af;font-size:12px}
  pre{white-space:pre-wrap;font:11px ui-monospace,monospace;color:#4b5563;max-height:40vh;overflow:auto;margin:8px 0 0;background:#f6f7f9;padding:10px;border-radius:8px}
  .err{color:#dc2626}
</style>
<body><div class="card">
  <div class="brand">${logo}<div class="slogan">${esc(SLOGAN_EN)}<br><span class="zh">${esc(SLOGAN_ZH)}</span></div><div class="ver">${esc(buildLabel())}</div></div>
  <div class="bar"><div class="fill"></div></div>
  <div class="row"><span class="${state.failed ? "err" : ""}">${esc(current)}</span><span class="t">${elapsed}s</span></div>
  <div class="steps">${STARTUP_STEPS.map((_, i) => `<i class="${i < step ? "done" : i === step && !state.failed ? "now" : ""}"></i>`).join("")}</div>
  <div class="hint">${esc(hint)}</div>
  <details id="log"${state.failed ? " open" : ""}><summary>启动日志</summary><pre id="pre">${esc(lines.slice(-200).join("\n"))}</pre></details>
</div>
<script>
  // In-place updates: the main process calls window.__wsxUpdate(state) instead of reloading the
  // page (a reload per log line flickered visibly, 人类反馈 2026-09-17).
  window.__wsxUpdate = function (u) {
    var fill = document.querySelector(".fill"); if (fill) { fill.style.width = u.pct + "%"; if (u.failed) fill.style.background = "#ef4444"; }
    var row = document.querySelector(".row span"); if (row) { row.textContent = u.current; row.className = u.failed ? "err" : ""; }
    var t = document.querySelector(".row .t"); if (t) t.textContent = u.elapsed + "s";
    document.querySelectorAll(".steps i").forEach(function (el, i) { el.className = i < u.step ? "done" : (i === u.step && !u.failed ? "now" : ""); });
    var hint = document.querySelector(".hint"); if (hint) hint.textContent = u.hint;
    var pre = document.getElementById("pre"); if (pre) pre.textContent = u.log;
    if (u.failed) { var d = document.getElementById("log"); if (d) d.open = true; }
  };
  setInterval(function () { var t = document.querySelector(".row .t"); if (t) t.textContent = (parseInt(t.textContent, 10) + 1) + "s"; }, 1000);
</script>
</body></html>`;
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

/** The alpha DMGs were named "WorkspaceX Local"; keep those users' data when the product name changed (2026-09-17). */
function migrateLegacyDataDir(dataDir: string): void {
  if (existsSync(dataDir)) return;
  const legacy = join(app.getPath("userData"), "..", "WorkspaceX Local", "local");
  if (!existsSync(legacy)) return;
  try { mkdirSync(join(dataDir, ".."), { recursive: true }); renameSync(legacy, dataDir); } catch { /* fall back to a fresh data dir */ }
}

async function boot(): Promise<void> {
  ensureNodeOnPath();
  const repoRoot = bundleRoot();
  const dataDir = join(app.getPath("userData"), "local");
  migrateLegacyDataDir(dataDir);
  const doctor = runDoctor({ dataDir, repoRoot, bundleBinDir: bundleBinDir(), bundlePythonDir: bundlePythonDir() });
  if (!doctor.ok) {
    await dialog.showMessageBox({ type: "error", title: "这台电脑不满足运行要求", message: doctor.findings.join("\n") });
    app.quit();
    return;
  }

  win = new BrowserWindow({ width: 1280, height: 860, show: true, title: "WorkspaceX", webPreferences: { contextIsolation: true } });
  const lines: string[] = [];
  const progress = { startedAt: Date.now(), failed: false };
  let pageLoaded = false;
  const render = (): void => {
    if (!win) return;
    if (!pageLoaded) {
      pageLoaded = true;
      void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(progressHtml(lines, progress))}`);
      return;
    }
    // Same state, pushed into the page -- no reload, no flicker.
    void win.webContents.executeJavaScript(`window.__wsxUpdate && window.__wsxUpdate(${JSON.stringify(progressState(lines, progress))})`, true).catch(() => undefined);
  };
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
    stack = await up({ config, log, webMode: built ? "start" : "dev", bundleBinDir: bundleBinDir(), bundlePythonDir: bundlePythonDir(), bundleModelsDir: bundleModelsDir(), bundleAsrModelsDir: bundleAsrModelsDir() });
  } catch (e) {
    progress.failed = true;
    log(`启动失败: ${e instanceof Error ? e.message : String(e)}`);
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    render();
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
