#!/usr/bin/env node
/**
 * 门控：**不存在「写了但没人跑」的 e2e spec**（#512）。
 *
 * ## 它要挡的失效
 *
 * `apps/web/e2e/chat-read.spec.ts` 在 main 上红了很久无人发现——因为**没有任何 npm
 * script 或 CI job 跑它**。有一个 `playwright.chat-read.config.ts`，但 config 存在
 * ≠ 有人调它。这正是 `AGENTS.md` 自己那条：**「没有脚本的规范条目视为未落地」**。
 * 更糟的是它**制造了"有覆盖"的错觉**：phase-01 的四份 ui-preview/README 里都写着
 * 「`e2e/responsive.spec.ts` 有断言」，而那条 spec 同样不在任何 CI 门控里。
 *
 * ## 「被门控跑到」的定义（读到这里的人请按这个理解，别按直觉）
 *
 * 一条 spec 算被跑到 ⟺ 存在一条从 **CI 工作流** 出发、可机械追踪到它的链路：
 *
 *     .github/workflows/*.yml 的 `run:`
 *        └─(pnpm run X / pnpm --filter P run X，逐层展开 package.json scripts)
 *            └─ `playwright test [--config C]`      ← C 缺省时取该包的 playwright.config.ts
 *                └─ `playwright test --config C --list`（**Playwright 自己**报的文件集）
 *
 * 最后一跳刻意**不自己解析** `testDir` / `testMatch` / `projects`：
 * `playwright.fullstack-smoke.config.ts` 有三个 project 且各带显式 `testMatch`，
 * **「文件在 testDir 下」并不蕴含「它会被跑」**。手写的匹配器迟早与 Playwright 的
 * 实现漂移，而漂移的方向恰好是「误判为已覆盖」——即本门控要挡的那种错觉。
 * `--list` 不起 webServer、不需要浏览器，是这里唯一可信的事实源。
 *
 * ## 判定口径的三条边界（写清楚，免得下一个人以为是 bug）
 *
 * 1. **只认 CI**。`feature_list.json` 的 `verification` 命令不算数：`pnpm harness verify`
 *    只在本地跑、且只跑未 passing 的 feature ⇒ 一条 spec 一旦随 feature 转 passing
 *    就再也不会被执行。`responsive.spec.ts` 正是这个状态（见下方豁免清单）。
 * 2. **只认 `.spec.ts` 后缀**。本仓 vitest 的 include 都写死在 tests 目录下的
 *    `.test.ts`（apps/web/vitest.config.ts:23、apps/devportal/vitest.config.ts:13），
 *    所以 `.spec.ts` 在本仓是 Playwright 专属地盘，不会与 vitest 重叠。
 * 3. **`*.setup.ts` 不入总体**。它没有独立价值，只能经由某个 config 的 project 被拉起。
 *
 * ## 豁免的代价
 *
 * 清单每加一项，门控就松一分。所以每条**必须在同一处写明理由**（先例：F86
 * `interview_consent_snapshots`、#465 条件 ②）。两条反向检查让清单不会烂掉：
 * 豁免指向不存在的文件 → 红；豁免的 spec 其实已被跑到（陈旧豁免）→ 也红。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 显式豁免：**允许存在，但必须有名有姓有理由**。
 *
 * 加一条之前先自问：这条 spec 接进门控真的做不到，还是只是麻烦？只是麻烦的话，
 * 正确动作是接进去，不是写进这里。
 */
const EXEMPTIONS = [
  {
    spec: "apps/web/e2e/responsive.spec.ts",
    reason:
      "唯一引用它的是 phases/phase-00-shared-kernel/feature_list.json:374 的 verification " +
      "命令 `pnpm --filter web run e2e`（apps/web/package.json:15 → apps/web/playwright.config.ts）。" +
      "该命令不在任何 CI job 里，且它所属的 F14 已 passing ⇒ `pnpm harness verify` 也不会再跑它。" +
      "接进 fullstack-smoke 做不到：它的 webServer 是 `next dev -p 3197`（无种子库、无登录态），" +
      "而 fullstack-smoke 的 webServer 是 config 级的 `next build && next start` + 种子库，" +
      "两者不能共存于同一 config。接它需要单独一轮 next dev —— 属新增 CI 时间预算，" +
      "单自建 runner 是硬瓶颈，须由 coord 决定，不在 #512 范围内。" +
      "⚠ 现状后果已实际发生：phase-01 的四份 ui-preview/README（chat/tpl/org-admin/files）" +
      "都以「`responsive.spec.ts` 有断言」为由省略了响应式截图，而那条断言其实不会再跑。" +
      "跟踪：#512 的 PR 正文已把此项上报 coord-chat-e2e，待其开 follow-up issue。",
  },
  {
    spec: "apps/web/e2e/chat-behavior-shots.spec.ts",
    reason:
      "#814 track B —— 同 chat-main-shots：**不是规格，是取证工具**，零 expect，只为 CLR 的 " +
      "行为体验 track 抓证据（截图 + MANIFEST），由 `pnpm run shots:chat-behavior` 显式调用，" +
      "复用 playwright.chat-read.config.ts 的整栈。判定由 rev-e2e 看证据做——脚本自己断言 " +
      "『行为达标』等于实现者自评，正是 CLR 的 G3 要挡的。它存在的原因：评分员在 devapp 被登录 " +
      "卡死六小时（agent 不代输密码），而判据允许本地预览环境，本地有零人工输入的种子账号登录链路。" +
      "⚠ 已知边界写在文件头：本地栈无真实模型 provider，十项里 1/2/3/4/6 五项在本地取证不到，" +
      "那五项仍需 devapp——不要因为这个脚本存在就以为 track B 全部可本地化。",
  },
  {
    spec: "apps/web/e2e/chat-main-shots.spec.ts",
    reason:
      "#728 —— 它**不是规格，是取证工具**：整个文件里没有一条 expect，只把 `/chat` 主屏抓成 png " +
      "供 rev-uiux 按 .harness/rubrics/chat-main-fidelity-rubric.md 逐张比对原型参照图。" +
      "接进门控没有意义：没有断言的 spec 在 CI 里永远绿，等于给流水线加一条不会红的耗时步骤 —— " +
      "而本仓的纪律正好相反（『没有脚本的规范条目视为未落地』的反面是『不会红的门控不是门控』）。" +
      "它由 `pnpm run shots:chat-main`（package.json）显式调用，复用 " +
      "playwright.chat-read.config.ts 的整栈，所以不存在『第二份栈定义』。" +
      "⚠ 保真度本身**有**门控，只是门在人和 rev-uiux 那边：10/10 是 #728 推 main 的放行条件。" +
      "若哪天把保真度做成机械比对（像素/结构 diff），那条新 spec 要接进 CI，" +
      "并把本条豁免删掉。",
  },
  {
    spec: "apps/web/e2e/vz-fabric-shots.spec.ts",
    reason:
      "VZ-fabric（chat 内 mermaid 图改 fabric.js 渲染 · 最大化/编辑/保存）—— 同 chat-main-shots：" +
      "**不是规格，是取证工具**，零 expect，只把 chat-diagram-fabric 原型的每个界面态截图落到 " +
      "phases/phase-02-visible-outcomes/ui-preview/chat-diagram-fabric/，供人类签核第 ① 件 UI " +
      "（SIGNOFF-INCREMENT-fabric-canvas.md）核对用。走独立 dev server（playwright.config.ts " +
      "的 3197 端口，纯前端预览页，不接后端），不存在『第二份栈定义』。接进门控没有意义：" +
      "没有断言的 spec 在 CI 里永远绿，等于加一条不会红的耗时步骤——与 chat-main-shots 同一理由。",
  },
  {
    spec: "apps/web/e2e/canvas-tpl-shots.spec.ts",
    reason:
      "新建画布→选模板 入口 UI 原型（21 起点 + 真实 CanvasStage 起手）—— 同 vz-fabric-shots：" +
      "**取证工具，不是规格**。它确实带 `expect(...).toBeVisible()`，但那些只是「等这一态的锚点" +
      "出现了再截图」的时序门，不是行为/契约断言——没有一条比对 POST 请求体、服务端响应字段或" +
      "状态转移这类真正的产品行为。目的是把七态（default/loading/empty/invalid/dep-failed/" +
      "denied/success）+ R5 四角色视角落成 phases/phase-02-visible-outcomes/ui-preview/" +
      "canvas-template-gallery/ 下的截图，供人类签核第 ① 件 UI" +
      "（SIGNOFF-INCREMENT-canvas-template-gallery.md，status: pending）核对用。" +
      "由 `playwright.tplgallery.config.ts` 单独调用，对**已预热**的 dev server（默认 3221）" +
      "截图、不自带 webServer，接进 fullstack-smoke 那套栈做不到（同一理由见 chat-main-shots 那条：" +
      "两个 config 不能共存）。接进门控没有意义：这些 toBeVisible 门在 CI 里只会绿，" +
      "真正的验收在人类签核，不在这个脚本自己判定「像不像」。",
  },
  {
    spec: "apps/web/e2e/live-collab-orchestration-shots.spec.ts",
    reason:
      "Phase 10「现场协作编排」UI 先行原型（9 屏 + 七态 + 4 视角）—— 同 canvas-tpl-shots：" +
      "**取证工具，不是规格**。它带 `expect(...).toBeVisible()`，但那些只是「等这一态的锚点" +
      "出现了再截图」的时序门，不比对任何 POST 请求体、服务端响应字段或状态转移这类产品行为。" +
      "目的是把 phases/phase-10-live-collaboration-orchestration/ui-preview/README.md 里列的" +
      "18 张截图落地，供人类在束级 design-signoff.md 第 ① 件签核时逐条核对（README 已列出 3 处" +
      "重点，其中「观察者可见范围」是安全边界决策，须人类拍板）。由" +
      "`playwright.live-collab-shots.config.ts` 单独调用，对**已预热**的 dev server（默认 3242）" +
      "截图、不自带 webServer，接进 fullstack-smoke 那套栈做不到（同一理由见 chat-main-shots/" +
      "canvas-tpl-shots：两个 config 不能共存）。接进门控没有意义：这些 toBeVisible 门在 CI 里" +
      "只会绿，真正的验收在人类签核，不在这个脚本自己判定「像不像」。",
  },
];

/** 拿 workspace 包名 → 目录 的映射，用于解析 `pnpm --filter <name>`。 */
function workspacePackages() {
  const map = new Map();
  for (const group of ["apps", "packages"]) {
    const dir = path.join(REPO_ROOT, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(dir, entry.name, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      const rel = path.posix.join(group, entry.name);
      if (pkg.name) map.set(pkg.name, rel);
      // `pnpm --filter web` 在本仓用的是短名；短名与包名不同的包（@repo/devportal）
      // 两个键都登记，免得漏掉一种写法。
      map.set(entry.name, rel);
    }
  }
  return map;
}

function readScripts(pkgDir) {
  const manifest = path.join(REPO_ROOT, pkgDir, "package.json");
  if (!existsSync(manifest)) return {};
  return JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};
}

/**
 * 从 CI 工作流里抽出所有 `run:` 的命令文本。
 *
 * 刻意用正则而不是 YAML parser：`run:` 的值有 `|`/`>` 块标量、有内嵌 `${{ }}`，
 * 而我们只需要**文本**（后面还是靠正则找 `pnpm run` / `playwright test`）。
 * 解析成结构反而要处理更多形态。宁可多收一些无关文本，也不要漏掉一条命令——
 * 本门控的失败模式必须偏向「误判为未覆盖」（吵）而不是「误判为已覆盖」（哑）。
 */
function ciCommandTexts() {
  const dir = path.join(REPO_ROOT, ".github", "workflows");
  const texts = [];
  if (!existsSync(dir)) return texts;
  for (const file of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(file)) continue;
    texts.push(readFileSync(path.join(dir, file), "utf8"));
  }
  return texts;
}

const SCRIPT_REF = /pnpm\s+(?:-w\s+|--filter\s+(\S+)\s+)?run\s+([A-Za-z0-9:_.-]+)/g;
const PLAYWRIGHT_RUN = /pnpm\s+(?:--filter\s+(\S+)\s+)?exec\s+playwright\s+test([^\n&|;]*)|(?<![\w-])playwright\s+test([^\n&|;]*)/g;

/**
 * 从 CI 出发做可达性闭包，返回**被真正调用的** playwright config 集合。
 * 每个元素 `{ pkgDir, configPath }`，configPath 相对仓库根。
 */
export function resolveInvokedConfigs() {
  const packages = workspacePackages();
  // 队列元素 = 一段命令文本 + 它执行时的所在包目录（"" 表示仓库根）
  const queue = ciCommandTexts().map((text) => ({ text, pkgDir: "" }));
  const seenScripts = new Set();
  const configs = new Map();

  while (queue.length > 0) {
    const { text, pkgDir } = queue.pop();

    for (const match of text.matchAll(SCRIPT_REF)) {
      const filter = match[1];
      const scriptName = match[2];
      const targetDir = filter ? packages.get(filter) : pkgDir;
      if (targetDir === undefined) continue; // 未知 --filter 目标：不猜
      const key = `${targetDir}::${scriptName}`;
      if (seenScripts.has(key)) continue;
      seenScripts.add(key);
      const body = readScripts(targetDir)[scriptName];
      if (body) queue.push({ text: body, pkgDir: targetDir });
    }

    for (const match of text.matchAll(PLAYWRIGHT_RUN)) {
      const filter = match[1];
      const args = match[2] ?? match[3] ?? "";
      const targetDir = filter ? packages.get(filter) : pkgDir;
      if (targetDir === undefined) continue;
      const configArg = /--config[=\s]+(\S+)/.exec(args);
      // 无 --config 时 Playwright 取该包的 playwright.config.ts —— 这是本门控
      // 最容易被读者忽略的一跳：`"e2e": "playwright test"` 也是一条真实入口。
      const configFile = configArg ? configArg[1] : "playwright.config.ts";
      const configPath = path.posix.join(targetDir, configFile);
      if (!existsSync(path.join(REPO_ROOT, configPath))) continue;
      configs.set(configPath, { pkgDir: targetDir, configPath });
    }
  }
  return [...configs.values()].sort((a, b) => a.configPath.localeCompare(b.configPath));
}

/** 总体：全部 git 追踪的 `*.spec.ts`（口径边界 2、3 见文件头）。 */
export function allSpecFiles() {
  const out = execFileSync("git", ["ls-files", "*.spec.ts", "*.spec.tsx"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean).sort();
}

/**
 * 问 Playwright 自己：这份 config 到底会跑哪些文件。
 * `--list` 不起 webServer、不需要浏览器；env 给的是占位值，只为让 `required()` 不抛。
 */
export function specsMatchedBy({ pkgDir, configPath }) {
  const configFile = path.posix.relative(pkgDir, configPath);
  const raw = execFileSync(
    "pnpm",
    ["exec", "playwright", "test", "--config", configFile, "--list", "--reporter=json"],
    {
      cwd: path.join(REPO_ROOT, pkgDir),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        WORKSPACEX_API_PORT: process.env.WORKSPACEX_API_PORT ?? "39001",
        WORKSPACEX_WEB_PORT: process.env.WORKSPACEX_WEB_PORT ?? "39002",
        PGPORT: process.env.PGPORT ?? "39003",
        COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME ?? "spec-gate-coverage-probe",
        WORKSPACEX_DB: process.env.WORKSPACEX_DB ?? "spec_gate_coverage_probe",
      },
    },
  );
  const report = JSON.parse(raw.slice(raw.indexOf("{")));
  const rootDir = report.config.rootDir;
  return (report.suites ?? []).map((suite) =>
    path.posix.relative(REPO_ROOT, path.resolve(rootDir, suite.file)),
  );
}

/**
 * 判定逻辑本体，**纯函数**：给定总体、覆盖关系与豁免清单，出每条 spec 的判决。
 *
 * 之所以从 IO 里剥出来，是为了让反证套件能对**构造出来的**输入断言四种判决都成立——
 * 尤其是 `covered-but-exempt` 与 `stale` 这两种，它们在真实仓库里（希望）永远不出现，
 * 而「永远不出现的分支」正是最容易写错又永远测不到的那种。
 */
export function classifySpecs({ population, coveredBy, exemptions }) {
  const exemptBySpec = new Map(exemptions.map((e) => [e.spec, e]));
  const rows = population.map((spec) => {
    const by = coveredBy.get(spec) ?? [];
    const exemption = exemptBySpec.get(spec);
    let verdict;
    if (by.length > 0) verdict = exemption ? "covered-but-exempt" : "covered";
    else verdict = exemption ? "exempt" : "unrun";
    return { spec, by, verdict, reason: exemption?.reason };
  });
  const staleExemptions = exemptions.filter((e) => !population.includes(e.spec)).map((e) => e.spec);
  return { rows, staleExemptions };
}

export function auditSpecGateCoverage() {
  const population = allSpecFiles();
  const invoked = resolveInvokedConfigs();
  const coveredBy = new Map(population.map((spec) => [spec, []]));
  for (const config of invoked) {
    for (const spec of specsMatchedBy(config)) {
      if (coveredBy.has(spec)) coveredBy.get(spec).push(config.configPath);
    }
  }
  return { ...classifySpecs({ population, coveredBy, exemptions: EXEMPTIONS }), invoked };
}

export { EXEMPTIONS };

function main() {
  const { rows, invoked, staleExemptions } = auditSpecGateCoverage();
  console.log("被 CI 真正调用的 playwright config：");
  for (const c of invoked) console.log(`  · ${c.configPath}`);
  console.log("\nspec 覆盖判定：");
  for (const row of rows) {
    const mark = { covered: "✅", exempt: "🟡", unrun: "❌", "covered-but-exempt": "❌" }[row.verdict];
    console.log(`  ${mark} ${row.spec}  [${row.verdict}]${row.by.length ? ` ← ${row.by.join(", ")}` : ""}`);
  }

  const failures = [];
  for (const row of rows) {
    if (row.verdict === "unrun") {
      failures.push(
        `${row.spec} 不被任何门控跑到：它红了没人会发现。把它接进某条 CI 可达的 ` +
        `playwright config，或加进 lint-spec-gate-coverage.mjs 的 EXEMPTIONS 并写明理由。`,
      );
    }
    if (row.verdict === "covered-but-exempt") {
      failures.push(
        `${row.spec} 已被 ${row.by.join(", ")} 跑到，豁免条目已陈旧：从 EXEMPTIONS 里删掉它。`,
      );
    }
  }
  for (const spec of staleExemptions) {
    failures.push(`EXEMPTIONS 里的 ${spec} 不存在（改名或删除后忘了同步）：清理该条目。`);
  }

  if (failures.length > 0) {
    console.error("\n✗ 存在未被任何门控跑到的 spec：");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n✅ 每一条 spec 都被某条 CI 门控跑到（或有署名豁免）");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
