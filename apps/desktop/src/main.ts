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
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveLocalConfig, runDoctor, up, type RunningStack } from "@repo/local-runtime";
import { welcomeDataUrl } from "./welcome";

let stack: RunningStack | null = null;
let win: BrowserWindow | null = null;
/** 首启那一屏的内容；「帮助 → 显示本地账号」再打开它时读的是同一份。 */
let welcomeUrl: string | null = null;

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
    stack = await up({
      config, log, webMode: built ? "start" : "dev", bundleBinDir: bundleBinDir(),
      // 起来之后再崩的服务，用户遇到它的形式是「聊天框卡住」「转写没反应」——
      // 原因在日志里，而没人会去翻。说出来，并指向那一份日志。
      onServiceExit: ({ name, code }) => {
        void dialog.showMessageBox({
          type: "warning",
          title: "一个后台服务已停止",
          message: `${name} 已退出（code ${String(code)}），依赖它的能力现在不可用。`,
          detail: `日志：${join(dataDir, "logs", `${name}.log`)}\n重启应用可以重新拉起它。`,
        });
      },
    });
  } catch (e) {
    await dialog.showMessageBox({ type: "error", title: "启动失败", message: e instanceof Error ? e.message : String(e), detail: lines.slice(-30).join("\n") });
    app.quit();
    return;
  }
  for (const w of stack.warnings) log(`⚠ ${w}`);
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });

  // ⚠ 这里**不能**直接 loadURL(web)。本地账号的密码是首启随机生成、只落在数据目录里的；
  //   CLI 把它打印在终端，双击安装包的人没有终端。直接进登录页 = 装完了登不进去。
  welcomeUrl = welcomeDataUrl({
    webUrl: stack.urls.web,
    email: stack.login.email,
    password: stack.login.password,
    warnings: stack.warnings,
    dataDir,
  });
  installMenu();
  await win.loadURL(welcomeUrl);
}

/**
 * 菜单只加一条：把首启那一屏重新调出来。密码是随机的，人第一次多半没记住，
 * 而唯一的另一条路是去数据目录读一个 0600 的 JSON——那不是一条可以要求用户走的路。
 */
function installMenu(): void {
  const template = Menu.getApplicationMenu()?.items.map((item) => item) ?? [];
  const help = {
    label: "帮助",
    submenu: [
      {
        label: "显示本地账号",
        click: () => { if (welcomeUrl !== null) void win?.loadURL(welcomeUrl); },
      },
      { type: "separator" as const },
      {
        label: "打开数据目录",
        click: () => { void shell.openPath(join(app.getPath("userData"), "local")); },
      },
    ],
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([...template, help]));
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
