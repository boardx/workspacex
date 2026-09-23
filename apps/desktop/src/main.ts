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
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkWebBuild, dataDirAdvice, dataDirAdviceBody, diagnoseStartupFailure, localSessionUrl,
  resolveLocalConfig, restoreIntoDataDir, runDoctor, signInLocal, stopListenerOnPort, up,
  verifyBackup, type RunningStack,
} from "@repo/local-runtime";
import { SHUTDOWN_TIMEOUT_MS, shutdownNoticeDataUrl } from "./shutdown-notice";
import { welcomeDataUrl } from "./welcome";
import { progressState, STARTUP_STEPS } from "./startup-progress";

let stack: RunningStack | null = null;
/**
 * 模块级的日志：`boot()` 里那个 `log` 闭在它自己的作用域里，而备份/恢复这类菜单动作
 * 发生在 `boot()` 之外。写的是同一个文件——**一件事只有一份日志**，不要为了省事
 * 在别处另起一个。
 */
function appendLog(line: string): void {
  try {
    appendFileSync(join(app.getPath("userData"), "local", "desktop.log"), `${new Date().toISOString()} ${line}\n`);
  } catch { /* best effort：日志写不了也不能挡住恢复本身 */ }
}

/** 同一个服务一次会话只打断用户一次——重复弹框会让人直接忽略所有弹框。 */
const reportedFailures = new Set<string>();
let win: BrowserWindow | null = null;
/** 首启那一屏的内容；「帮助 → 显示本地账号」再打开它时读的是同一份。 */
let welcomeUrl: string | null = null;

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
  // ⚠ 「产物存在」不等于「产物能用」：NEXT_PUBLIC_* 是构建期内联的，按另一个端口烘焙的
  //   产物会让页面正常打开、每个 API 请求打向旧地址、一个报错也没有。所以判据是
  //   checkWebBuild，不是 BUILD_ID 是否存在；退回 dev 时把原因写进启动日志，不静默。
  const webCheck = checkWebBuild(join(repoRoot, "apps", "web"), `http://127.0.0.1:${config.ports.api}`);
  if (!webCheck.usable) log(`[web] 不使用已构建产物：${webCheck.reason ?? ""}`);
  try {
    stack = await up({
      config, log, webMode: webCheck.usable ? "start" : "dev",
      bundleBinDir: bundleBinDir(), bundlePythonDir: bundlePythonDir(),
      bundleModelsDir: bundleModelsDir(), bundleAsrModelsDir: bundleAsrModelsDir(),
      /*
        起来之后再崩的服务，用户遇到它的形式是「聊天框卡住」「转写没反应」。

        改之前这里说的是「deep-agent 已退出（code 1）」——内部名字加一个退出码，
        对用户不构成信息，只会让人觉得自己没资格用这个软件；而且当时还没有自动重启，
        唯一的出路是「重启应用」。现在文案由 `supervisor-policy.ts` 给出（说人话、三段式），
        服务也会被按策略拉起。

        只在**停手了**的时候打断用户：还在重试的那几秒弹个框，比不说更烦。
      */
      onServiceHealth: (h) => {
        if (h.state !== "failed" || h.message === null) return;
        if (reportedFailures.has(h.name)) return;    // 同一个服务一次会话只说一遍
        reportedFailures.add(h.name);
        void dialog.showMessageBox({
          type: "warning",
          title: h.message.title,
          message: h.message.body,
          detail: `技术细节在日志里：${join(dataDir, "logs", `${h.name}.log`)}`,
        });
      },
    });
  } catch (e) {
    progress.failed = true;
    const raw = e instanceof Error ? e.message : String(e);
    log(`启动失败: ${raw}`);
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    render();
    /*
      启动失败不再是死路。

      这台机器上安装版自己的 desktop.log 里累计 14 次启动失败，出路分别是
      「去敲 lsof | xargs kill」和「把数据目录挪走，它会由迁移+种子重建」——
      对独立发布的应用这两句都不成立（见 `startup-failure.ts` 的表）。
      分诊判据在 local-runtime 里（可测），这里只负责把按钮接到动作上。
    */
    const d = diagnoseStartupFailure(e, { hasBackup: lastBackupDir() !== null });
    const r = await dialog.showMessageBox({
      type: "error",
      title: d.title,
      message: d.body,
      detail: d.unknown ? `${raw}\n\n${lines.slice(-30).join("\n")}` : `原始信息：${raw}`,
      buttons: [...d.remedies.map((x) => x.label), "退出"],
      defaultId: 0,
      cancelId: d.remedies.length,
    });
    const chosen = d.remedies[r.response];
    if (chosen === undefined) { app.quit(); return; }
    if (chosen.kind === "reclaim-port") {
      // 只收回我们自己独占的 loopback 端口；占用者一定是上一次没退干净的我们自己。
      for (const port of chosen.ports) {
        const freed = await stopListenerOnPort(port);
        log(`[recover] 收回端口 ${port}: ${freed ? "已释放" : "没找到占用者"}`);
      }
      app.relaunch();
    } else if (chosen.kind === "restore-backup") {
      const dir = lastBackupDir();
      if (dir !== null) { await runRestore(dir); return; }   // runRestore 自己会重启
      app.relaunch();
    } else {
      // move-aside：**挪走，不删**。挪走之后重启，下一次启动会重新建一个空库。
      const pg = join(dataDir, "pgdata");
      if (existsSync(pg)) {
        const aside = `${pg}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        renameSync(pg, aside);
        log(`[recover] 旧数据目录挪到 ${aside}（没有删除）`);
      }
      app.relaunch();
    }
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
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });

  // ⚠ 本地账号的密码是首启随机生成、只落在数据目录里的（0600 的 secrets.json）；CLI 把它
  //   打印在终端，双击安装包的人没有终端。自动登录让首启不必用到它，但「哪天要用」这件事
  //   仍然得有一条人能走的路——那就是下面这一屏 + 「帮助 → 显示本地账号」。
  welcomeUrl = welcomeDataUrl({
    webUrl: stack.urls.web,
    email: stack.login.email,
    password: stack.login.password,
    warnings: stack.warnings,
    dataDir,
  });
  installMenu();
  // 自动登录失败时 target 退回登录页；那种情况下先给用户看账号密码屏，否则他无从登录。
  await win.loadURL(target === stack.urls.web ? welcomeUrl : target);
}

/**
 * 菜单只加一条：把首启那一屏重新调出来。密码是随机的，人第一次多半没记住，
 * 而唯一的另一条路是去数据目录读一个 0600 的 JSON——那不是一条可以要求用户走的路。
 */
/**
 * 「备份我的数据…」。
 *
 * 为什么放在菜单而不是设置页：本地版把用户的全部数据放在他自己的机器上，
 * 「换一台电脑怎么办 / 硬盘坏了怎么办」是这类应用最高严重度的问题之一
 * （Apple Notes 没有真正的导出，用户被锁死；Bear 的笔记是不透明 SQLite 里的行，
 * 备份工具碰不到）。这条路必须在用户第一次想到它的时候就能找到，而不是藏在某个页里。
 *
 * 三段式回话：发生了什么、对你意味着什么、你现在能做什么。成功时给出收据
 * （备份里有多少条对话、多少个项目），因为一个只说「完成」的备份不会有人信。
 */
async function runBackup(): Promise<void> {
  if (stack === null) {
    await dialog.showMessageBox({
      type: "info", title: "还不能备份",
      message: "本地服务还没启动完。",
      detail: "等启动完成后再试一次即可；这期间你的数据没有任何改动。",
    });
    return;
  }
  const picked = await dialog.showOpenDialog({
    title: "选择备份保存到哪里",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "备份到这里",
  });
  if (picked.canceled || picked.filePaths[0] === undefined) return;
  const r = await stack.backup(picked.filePaths[0], app.getVersion());
  if (!r.ok) {
    await dialog.showMessageBox({
      type: "error", title: "备份没有完成",
      message: r.reason,
      detail: "你的数据没有被改动。可以换一个磁盘空间更充裕的位置再试一次。",
    });
    return;
  }
  const counts = Object.entries(r.manifest.rowCounts)
    .map(([t, n]) => `${TABLE_LABELS[t] ?? t} ${n}`).join("　");
  const ans = await dialog.showMessageBox({
    type: "info", title: "备份完成，并已逐个文件校验",
    message: `备份里有：${counts}`,
    detail: `位置：${r.dir}\n大小：约 ${Math.round(r.totalBytes / 1024 / 1024)} MB\n\n`
      + `没有包含本机下载的模型（可重新获取）和运行日志。\n`
      + `换一台电脑时，装好应用后用同一个菜单里的恢复功能读这个目录。`,
    buttons: ["好", "打开所在位置"],
    defaultId: 0,
  });
  rememberBackup(r.dir);
  if (ans.response === 1) void shell.openPath(r.dir);
}

/**
 * 记住最后一次备份放在哪。
 *
 * 备份的位置是用户选的，所以「有没有备份」这件事**没法从磁盘上推**——不记下来的话，
 * 启动失败时就只能假设没有备份，于是那条本来存在的出路对用户不存在。这是本仓
 * 「静态痕迹 ≠ 动态事实」的反面：这里要的恰恰是一条会随状况变化的记录。
 * 目录可能已经被用户挪走或删掉，所以读的时候要重新确认它还在。
 */
function backupPointerPath(): string { return join(app.getPath("userData"), "local", "last-backup.json"); }

function rememberBackup(dir: string): void {
  try { writeFileSync(backupPointerPath(), JSON.stringify({ dir, at: new Date().toISOString() })); }
  catch { /* 记不住不该让备份本身失败 */ }
}

function lastBackupDir(): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(backupPointerPath(), "utf8"));
    const dir = typeof raw === "object" && raw !== null ? (raw as { dir?: unknown }).dir : undefined;
    if (typeof dir !== "string") return null;
    return existsSync(join(dir, "manifest.json")) ? dir : null;   // 挪走/删掉了就当没有
  } catch { return null; }
}

/**
 * 「从备份恢复…」。
 *
 * 顺序是刻意的：**先验、再说清代价、最后才动数据。**
 * 1. 先校验那份备份（这一步不动任何东西），把收据读给用户听——他要知道自己要读回什么。
 * 2. 说清代价：现在的数据会被**挪走**（不是删掉），而且恢复后要重启应用。
 * 3. 停栈。PGlite 是单会话所有权，在活着的实例脚下换目录是本仓记过的那一类事故。
 * 4. 恢复并逐张表核对行数，对不上就如实说，并告诉用户原数据在哪。
 * 5. 重启应用——不能在一个已经把数据库停掉的进程里继续跑。
 */
async function runRestore(preset?: string): Promise<void> {
  let backupDir = preset ?? "";
  if (preset === undefined) {
    const picked = await dialog.showOpenDialog({
      title: "选择要恢复的备份目录",
      properties: ["openDirectory"],
      buttonLabel: "读这一份",
    });
    if (picked.canceled || picked.filePaths[0] === undefined) return;
    backupDir = picked.filePaths[0];
  }

  const v = await verifyBackup(backupDir);
  if (!v.ok) {
    await dialog.showMessageBox({
      type: "error", title: "这份备份读不了",
      message: v.reason,
      detail: "你现在的数据没有被改动。请确认选的是备份目录本身（里面应该有一个 manifest.json）。",
    });
    return;
  }
  const counts = Object.entries(v.manifest.rowCounts)
    .map(([t, n]) => `${TABLE_LABELS[t] ?? t} ${n}`).join("　");
  const ok = await dialog.showMessageBox({
    type: "warning", title: "确认要用这份备份覆盖现在的数据吗",
    message: `这份备份里有：${counts}`,
    detail: `备份时间：${v.manifest.createdAt}\n\n`
      + `你现在的数据不会被删除，会被挪到同一目录下带时间戳的文件夹里。\n`
      + `恢复完成后应用会重启。`,
    buttons: ["取消", "恢复"],
    defaultId: 0,
    cancelId: 0,
  });
  if (ok.response !== 1) return;

  // 停栈：PGlite 单会话，不能在活着的实例脚下换目录。
  const running = stack;
  stack = null;
  if (running !== null) await running.stop();

  const r = await restoreIntoDataDir({
    backupDir,
    dataDir: join(app.getPath("userData"), "local"),
    postgresPort: 55432,
    log: (l) => appendLog(l),
  });
  if (!r.ok) {
    await dialog.showMessageBox({
      type: "error", title: "恢复没有完成", message: r.reason,
      detail: "应用会重启。如果重启后数据不对，被挪走的那份原始数据仍在数据目录里。",
    });
  } else {
    await dialog.showMessageBox({
      type: "info", title: "恢复完成，行数与清单一致",
      message: `已读回：${Object.entries(r.verified).map(([t, x]) => `${TABLE_LABELS[t] ?? t} ${x.actual}`).join("　")}`,
      detail: r.movedAsideTo === null ? "应用即将重启。" : `原来的数据已挪到 ${r.movedAsideTo}（没有删除）。\n应用即将重启。`,
    });
  }
  app.relaunch();
  app.quit();
}

/**
 * 打开数据目录——**先说一句再开**。
 *
 * 这个菜单项等于在邀请用户「把这个文件夹拷走当备份」，而实测证明那样拷出来的副本
 * 打不开（见 `data-dir-advice.ts` 的头注：硬杀可恢复，活拷贝不可）。
 * 一次会话只说一遍：重复弹框会让人直接忽略所有弹框。
 */
let dataDirAdviceShown = false;
async function openDataDir(): Promise<void> {
  const dir = join(app.getPath("userData"), "local");
  if (!dataDirAdviceShown) {
    dataDirAdviceShown = true;
    const a = dataDirAdvice();
    const r = await dialog.showMessageBox({
      type: "info", title: a.title, message: dataDirAdviceBody(a),
      buttons: [...a.actions], defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) { void runBackup(); return; }
  }
  void shell.openPath(dir);
}

/** 备份收据上的表名要说人话，用户不认得 `chat_threads`。 */
const TABLE_LABELS: Readonly<Record<string, string>> = {
  organizations: "工作区", projects: "项目", chat_threads: "对话",
  chat_messages: "消息", artifacts: "产物", agents: "智能体",
  skills: "技能", canvas_templates: "画布模板", agent_runs: "运行记录",
};

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
        label: "备份我的数据…",
        click: () => { void runBackup(); },
      },
      {
        label: "从备份恢复…",
        click: () => { void runRestore(); },
      },
      {
        label: "打开数据目录",
        click: () => { void openDataDir(); },
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
  // 见 shutdown-notice.ts：这几秒是 PGlite 在收尾，看不见它的用户会去强制退出
  // （这台机器上已因此损坏 6 次）。所以先把一页「正在安全关闭」摆出来，再停栈。
  let notice: BrowserWindow | null = null;
  try {
    notice = new BrowserWindow({
      width: 380, height: 210, show: true, frame: false, resizable: false,
      alwaysOnTop: true, title: "正在安全关闭",
      webPreferences: { contextIsolation: true },
    });
    void notice.loadURL(shutdownNoticeDataUrl());
  } catch { notice = null; }   // 窗口起不来不该拦住关机
  const done = (why: string): void => {
    appendLog(`[shutdown] ${why}`);
    if (notice !== null && !notice.isDestroyed()) notice.destroy();
    app.exit(0);   // 已经 preventDefault 过一次；再 quit() 会再走一遍这个钩子
  };
  // 上限之内等它收尾，超时如实说并放行——挂住不退会教会用户下次直接硬杀。
  const cap = setTimeout(() => done(`收尾超过 ${SHUTDOWN_TIMEOUT_MS}ms，放行退出`), SHUTDOWN_TIMEOUT_MS);
  const startedAt = Date.now();
  void s.stop().then(
    () => { clearTimeout(cap); done(`收尾完成，用了 ${Date.now() - startedAt}ms`); },
    (err: unknown) => { clearTimeout(cap); done(`收尾报错：${String(err)}`); },
  );
});
