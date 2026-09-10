import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `chat-trace-*-{geometry,liveness}.spec.ts` 三条共用的夹具构建：
 * 真组件 SSR（`node --import tsx`）→ HTML，再用 tailwindcss CLI 按本应用的
 * config 编译真样式。三条各自有一份逐字相同的副本，收敛成这一份。
 *
 * ## 防复发：「夹具起不来」必须与「判据不成立」长得不一样（issue #3387 后续）
 *
 * 2026-09-11 实测事故：`run-trace-panel.tsx` 里 import 了 `MarkdownMessage`，
 * 它拖进 `@repo/fabric-markdown`，而那个包的 `exports` 只声明 `types` / `import`
 * 两个条件，SSR 夹具走的是 CJS require 解析 ⇒ `ERR_PACKAGE_PATH_NOT_EXPORTED`。
 * 三条 spec **启动即崩**：几何/活性断言一条都没有执行过。
 *
 * 原来的写法把这件事藏了两层：
 *   1. `stdio: "pipe"` 把子进程的 stderr 丢掉，报错只剩 `Command failed: node …`；
 *   2. Playwright 的失败列表里，它和「净空实测 2px < 4px」并排显示为同一种红。
 * 于是「三条门今天全都没在守」看起来就像「三条门跑了、判据红了」——本仓
 * 「红 ≠ 跑过」那一族。
 *
 * 现在：构建失败一律重抛为带 `FIXTURE_STARTUP_FAILURE_MARKER` 前缀、并原样附上
 * 子进程 stderr 的错误。**怎么证伪它**：把 `run-trace-panel.tsx` 的 import 换回
 * `MarkdownMessage`，三条 spec 的失败信息必须含这个标记与 `ERR_PACKAGE_PATH_NOT_EXPORTED`
 * 原文；改回来必须全绿。（该反证已在本次 PR 正文里贴了实测输出。）
 */
export const FIXTURE_STARTUP_FAILURE_MARKER =
  "【夹具启动失败 · 几何/活性判据一条都没有执行】";

function run(file: string, args: string[], cwd: string, what: string): void {
  try {
    execFileSync(file, args, { cwd, stdio: "pipe" });
  } catch (err) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    throw new Error(
      [
        FIXTURE_STARTUP_FAILURE_MARKER,
        `失败的步骤：${what}`,
        `命令：${file} ${args.join(" ")}`,
        "",
        "⚠ 这**不是**断言失败。被测组件的模块图在夹具的解析条件下就没能加载起来，",
        "  所以这条 spec 的判据今天并没有守着任何东西——不要把它读成「几何仍然合格/不合格」。",
        "  最常见的原因：被测组件新 import 了一个 `exports` 只声明 `import` 条件的包",
        "  （夹具走 `node --import tsx` 的 CJS require 解析 ⇒ ERR_PACKAGE_PATH_NOT_EXPORTED）。",
        "",
        "子进程 stderr（原样）：",
        (e.stderr?.toString() || e.stdout?.toString() || e.message || "(空)").trim(),
      ].join("\n"),
    );
  }
}

/**
 * @param fixtureFile 夹具 tsx 的绝对路径（调用方传 `join(__dirname, "fixtures", "…")`）
 * @param tmpPrefix   临时目录前缀，仅用于人读
 * @returns 可直接 `page.goto()` 的 file:// URL
 */
export function buildTraceFixture(fixtureFile: string, tmpPrefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), tmpPrefix));
  const page = join(dir, "page.html");
  const web = join(dirname(fixtureFile), "..", "..");
  run(process.execPath, ["--import", "tsx", fixtureFile, page], web, `真组件 SSR 渲出 ${fixtureFile}`);
  run(
    join(web, "node_modules", ".bin", "tailwindcss"),
    ["-c", "tailwind.config.ts", "-i", "app/globals.css", "-o", join(dir, "out.css"), "--content", page],
    web,
    "tailwindcss CLI 编译真样式",
  );
  return pathToFileURL(page).href;
}
