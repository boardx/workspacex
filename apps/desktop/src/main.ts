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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveLocalConfig, runDoctor, up, type RunningStack } from "@repo/local-runtime";

let stack: RunningStack | null = null;
let win: BrowserWindow | null = null;

/** Packaged: resources/bundle is the monorepo subset electron-builder copied (see electron-builder.yml). Dev: the repo itself. */
function bundleRoot(): string {
  const packaged = join(process.resourcesPath ?? "", "bundle");
  if (app.isPackaged && existsSync(packaged)) return packaged;
  return join(__dirname, "..", "..", "..");
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

async function boot(): Promise<void> {
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
  const log = (line: string): void => {
    lines.push(line);
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 300);
  };
  render();

  const config = resolveLocalConfig({ repoRoot, dataDir });
  const built = existsSync(join(repoRoot, "apps", "web", ".next", "BUILD_ID"));
  try {
    stack = await up({ config, log, webMode: built ? "start" : "dev", bundleBinDir: bundleBinDir() });
  } catch (e) {
    await dialog.showMessageBox({ type: "error", title: "启动失败", message: e instanceof Error ? e.message : String(e), detail: lines.slice(-30).join("\n") });
    app.quit();
    return;
  }
  for (const w of stack.warnings) log(`⚠ ${w}`);
  await win.loadURL(stack.urls.web);
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
