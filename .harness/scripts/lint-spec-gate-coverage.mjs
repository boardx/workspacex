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
 * ## 「跑到」还要分两档：无条件 vs 条件（#523）
 *
 * 上面那条链路只回答「有没有人跑」，不回答「**那个人什么时候来**」。#523 点出的洞：
 * devportal 的 6 条 spec 唯一来源是 `deploy-devportal.yml`，而它带
 * `paths: apps/devportal/**` 触发过滤 ⇒ **共享包（`packages/*`）的改动打红它们时，
 * 那条 workflow 根本不会被触发**。门控按旧定义判 `covered` —— 报绿，而覆盖是假的。
 *
 * 所以链路的**起点**也要判：起点 job 是「每次 push/PR 都跑」还是「只在某些条件下跑」
 * （path 过滤 / 只有 `workflow_dispatch` / 只有 `schedule` / job 的 `if:` 把它挡在
 * 日常事件之外）。判据与求值细节在 `lib/ci-job-conditions.mjs`，本文件不复述。
 *
 *   · 至少有一条**无条件** job 能到它  ⇒ `covered`（真覆盖）
 *   · 只有**条件** job 能到它          ⇒ `conditionally-covered`（红）
 *                                        —— 要么归进某个无条件 job，要么进
 *                                        `CONDITIONAL_COVERAGE_EXEMPTIONS` 署名写理由
 *
 * 最后一跳刻意**不自己解析** `testDir` / `testMatch` / `projects`：
 * `playwright.fullstack-smoke.config.ts` 有三个 project 且各带显式 `testMatch`，
 * **「文件在 testDir 下」并不蕴含「它会被跑」**。手写的匹配器迟早与 Playwright 的
 * 实现漂移，而漂移的方向恰好是「误判为已覆盖」——即本门控要挡的那种错觉。
 * `--list` 不起 webServer、不需要浏览器，是这里唯一可信的事实源。
 *
 * ## 判定口径的四条边界（写清楚，免得下一个人以为是 bug）
 *
 * 1. **只认 CI**。`feature_list.json` 的 `verification` 命令不算数：`pnpm harness verify`
 *    只在本地跑、且只跑未 passing 的 feature ⇒ 一条 spec 一旦随 feature 转 passing
 *    就再也不会被执行。`responsive.spec.ts` 正是这个状态（见下方豁免清单）。
 * 2. **只认 `.spec.ts` 后缀**。本仓 vitest 的 include 都写死在 tests 目录下的
 *    `.test.ts`（apps/web/vitest.config.ts:23、apps/devportal/vitest.config.ts:13），
 *    所以 `.spec.ts` 在本仓是 Playwright 专属地盘，不会与 vitest 重叠。
 * 3. **`*.setup.ts` 不入总体**。它没有独立价值，只能经由某个 config 的 project 被拉起。
 * 4. **粒度到 config，不到 project**（已知边界，别以为已经解决）。`--list` 报的是
 *    整份 config 的文件集，而 CI 里常常只跑其中一个 `--project`。举例：
 *    `chat-task-workbench` 那批 spec 由 `playwright.chat-read.config.ts` 接住，
 *    该 config 同时被无条件的 `chat-read` job 调用 ⇒ 本门控判它们 `covered`，
 *    但真正跑它们的那个 project 只在手动 `workflow_dispatch` 下开火。
 *    收紧到 project 粒度要把 `--project` 参数也接进可达性闭包，不在 #523 范围内。
 *
 * ## 豁免的代价
 *
 * 清单每加一项，门控就松一分。所以每条**必须在同一处写明理由**（先例：F86
 * `interview_consent_snapshots`、#465 条件 ②）。两条反向检查让清单不会烂掉：
 * 豁免指向不存在的文件 → 红；豁免的 spec 其实已被跑到（陈旧豁免）→ 也红。
 *
 * 两份清单**语义不同，不要合并**：`EXEMPTIONS` 说「压根没人跑，我认」；
 * `CONDITIONAL_COVERAGE_EXEMPTIONS` 说「有人跑，但那个人只在某些条件下来，我认」。
 * 各自带自己的陈旧检查（见 `classifySpecs`）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ciJobCommands } from "./lib/ci-job-conditions.mjs";

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

/**
 * **条件覆盖**的署名豁免（#523）：这些 spec 确实有人跑，但那个人只在某些条件下来
 * （path 过滤 / 手动 `workflow_dispatch` / 定时）。它们和 `EXEMPTIONS` 不是一回事，
 * 所以分开放：混在一起会让「陈旧豁免」那条反向检查判错方向。
 *
 * 加一条之前先自问：能不能把它归进某个**无条件** job？能就去归，别写这里。
 * 写这里的代价是：这条 spec 被共享包改动打红时，CI 不会告诉任何人。
 */
const CONDITIONAL_COVERAGE_EXEMPTIONS = [
  {
    spec: "apps/web/e2e/real-model-pdf-smoke.spec.ts",
    reason:
      "唯一来源是 `real-model-chat-evidence.yml#verify`（`on: workflow_dispatch` 独一条）——" +
      "设计如此，不是疏漏：它打**真实模型 provider**，每趟真金白银且有 15 分钟等待上限，" +
      "该 workflow 自己的 concurrency 注释写着「两个真实模型 run 抢同一台机器，既烧钱又让证据互相污染」。" +
      "把它接进每个 PR 都跑的无条件 job = 每个 PR 都付一次真实模型钱，且并发一上来证据就互相污染。" +
      "它的定位是**取证 lane**（`.harness/instructions/real-model-e2e.md`：86 个 spec 全跑回环模型，" +
      "真实模型链路另加一条手动 lane，issue #2802），验收由人看证据做，不由这条 spec 在 CI 里自己判绿。" +
      "⚠ 代价照直写：共享包改动打红这条 spec 时，没有任何自动信号——发版前手动触发那一趟是它唯一的把关点。",
  },
  {
    spec: "apps/devportal/e2e/p30/auth-gray.spec.ts",
    reason: devportalConditionalReason("auth-gray"),
  },
  {
    spec: "apps/devportal/e2e/p30/enroll.spec.ts",
    reason: devportalConditionalReason("enroll"),
  },
  {
    spec: "apps/devportal/e2e/p30/join-approve.spec.ts",
    reason: devportalConditionalReason("join-approve"),
  },
  {
    spec: "apps/devportal/e2e/p30/me-workbench.spec.ts",
    reason: devportalConditionalReason("me-workbench"),
  },
  {
    spec: "apps/devportal/e2e/p30/onboard.spec.ts",
    reason: devportalConditionalReason("onboard"),
  },
  {
    spec: "apps/devportal/e2e/p30/workspace-authz.spec.ts",
    reason: devportalConditionalReason("workspace-authz"),
  },
];

/**
 * 六条 devportal spec 是**同一个**缺口的六个面，理由只写一次
 * （`AGENTS.md`：同一事实不得声明在两处）。
 */
function devportalConditionalReason(which) {
  return (
    `devportal p30 的 ${which} —— 唯一来源是 \`deploy-devportal.yml#validate\` 的 ` +
    "`pnpm --filter @repo/devportal run e2e`，而那个 workflow 带 " +
    "`paths: apps/devportal/** | .github/workflows/deploy-devportal.yml | pnpm-lock.yaml` 触发过滤。" +
    "⇒ **只改共享包（`packages/contracts` 等）而打红 devportal spec 的 PR，这条 lane 不会开火**，" +
    "这正是 #523 立项的那个洞本身。" +
    "本 PR **不**顺手改它：两条出路都超出「门控该怎么判」的范围，须由 coord 拍板——" +
    "(a) 把 `packages/**` 加进 `paths:` ⇒ 任何包改动都触发一次 Cloudflare Pages 部署，是发布行为的改动；" +
    "(b) 把 devportal e2e 接进 `harness-verify` 的无条件 job ⇒ 新增每 PR 的 CI 时间预算，" +
    "与 `responsive.spec.ts` 那条豁免同一性质的决定（#517 先例：时间预算归 coord）。" +
    "本条豁免的作用是**把这个洞从「门控报绿」变成「清单上有名有姓的一条」**，不是宣布它没问题。" +
    "跟踪：#523 的 PR 正文已把 (a)/(b) 两条出路上报 coord-architecture。"
  );
}

/** 拿 workspace 包名 → 目录 的映射，用于解析 `pnpm --filter <name>`。 */
function workspacePackages(root) {
  const map = new Map();
  for (const group of ["apps", "packages"]) {
    const dir = path.join(root, group);
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

function readScripts(root, pkgDir) {
  const manifest = path.join(root, pkgDir, "package.json");
  if (!existsSync(manifest)) return {};
  return JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};
}

const SCRIPT_REF = /pnpm\s+(?:-w\s+|--filter\s+(\S+)\s+)?run\s+([A-Za-z0-9:_.-]+)/g;
const PLAYWRIGHT_RUN = /pnpm\s+(?:--filter\s+(\S+)\s+)?exec\s+playwright\s+test([^\n&|;]*)|(?<![\w-])playwright\s+test([^\n&|;]*)/g;

/**
 * 从 CI 出发做可达性闭包，返回**被真正调用的** playwright config 集合。
 * 每个元素 `{ pkgDir, configPath, unconditional, via }`：
 *   · `unconditional` —— 是否**至少有一条无条件 job** 能走到这份 config；
 *   · `via`           —— 走到它的全部 job 标签（`workflow.yml#job`），按字典序。
 *
 * 条件性沿着 `pnpm run` 展开链**继承**：条件 job 调到的脚本仍是条件的；
 * 同一份 config 被两条链走到时，只要有一条是无条件的，它就是无条件覆盖。
 *
 * ⚠ 起点从「整份 yml 的文本」换成「逐个 job 的 `run:`」是 #523 的一部分，代价照直写：
 * 结构化读取会**丢掉注释里的命令**。旧版把注释中提到的 `pnpm run verify:x` 也算成覆盖
 * ——那本来就是错的（注释不会执行），但它让判定偏「松」。收紧后若某条 spec 的唯一来源
 * 其实只存在于注释里，它会翻成 `unrun` 并报出来，这是对的方向。
 */
export function resolveInvokedConfigs(root = REPO_ROOT) {
  const packages = workspacePackages(root);
  const queue = [];
  for (const job of ciJobCommands(root)) {
    for (const text of job.commands) {
      queue.push({ text, pkgDir: "", unconditional: job.unconditional, via: job.label });
    }
  }
  // 同一个脚本在「无条件」与「条件」两种身份下都要各展开一次：先来的条件访问
  // 不能把后来的无条件链路挡在门外（挡掉就是把真覆盖误判成条件覆盖）。
  const seenScripts = new Set();
  const configs = new Map();

  const note = (configPath, pkgDir, unconditional, via) => {
    const existing = configs.get(configPath) ?? { pkgDir, configPath, unconditional: false, via: [] };
    existing.unconditional = existing.unconditional || unconditional;
    if (!existing.via.includes(via)) existing.via.push(via);
    configs.set(configPath, existing);
  };

  while (queue.length > 0) {
    const { text, pkgDir, unconditional, via } = queue.pop();

    for (const match of text.matchAll(SCRIPT_REF)) {
      const filter = match[1];
      const scriptName = match[2];
      const targetDir = filter ? packages.get(filter) : pkgDir;
      if (targetDir === undefined) continue; // 未知 --filter 目标：不猜
      const key = `${targetDir}::${scriptName}::${unconditional}::${via}`;
      if (seenScripts.has(key)) continue;
      seenScripts.add(key);
      const body = readScripts(root, targetDir)[scriptName];
      if (body) queue.push({ text: body, pkgDir: targetDir, unconditional, via });
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
      if (!existsSync(path.join(root, configPath))) continue;
      note(configPath, targetDir, unconditional, via);
    }
  }
  for (const config of configs.values()) {
    config.via.sort();
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
        // 五个确定性替身端口自 2026-09-10 起也由隔离外壳分配（`lib/test-isolation.ts`
        // 的 `PORT_BASE`，唯一一份声明），config 里 `required()` 会点名要它们。
        // 这里同样只给占位值：`--list` 不起任何 webServer。
        WORKSPACEX_MODEL_PROVIDER_PORT: process.env.WORKSPACEX_MODEL_PROVIDER_PORT ?? "39004",
        WORKSPACEX_DEEP_AGENT_PROVIDER_PORT: process.env.WORKSPACEX_DEEP_AGENT_PROVIDER_PORT ?? "39005",
        WORKSPACEX_ASR_PROVIDER_PORT: process.env.WORKSPACEX_ASR_PROVIDER_PORT ?? "39006",
        WORKSPACEX_VISION_PROVIDER_PORT: process.env.WORKSPACEX_VISION_PROVIDER_PORT ?? "39007",
        WORKSPACEX_LOOPBACK_SANDBOX_PORT: process.env.WORKSPACEX_LOOPBACK_SANDBOX_PORT ?? "39008",
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
 * 判定逻辑本体，**纯函数**：给定总体、覆盖关系与两份豁免清单，出每条 spec 的判决。
 *
 * `coveredBy` 的值是 `{ configPath, unconditional }[]` —— **不是**配置路径字符串数组。
 * 2026-09-21（#523）特意换成对象：字符串数组表达不了「谁跑它」之外的
 * 「什么时候跑」，而 #523 的病恰恰全在后半句上。
 *
 * 之所以从 IO 里剥出来，是为了让反证套件能对**构造出来的**输入断言每一种判决都成立——
 * 尤其是 `covered-but-exempt` 与两种陈旧豁免，它们在真实仓库里（希望）永远不出现，
 * 而「永远不出现的分支」正是最容易写错又永远测不到的那种。
 */
export function classifySpecs({ population, coveredBy, exemptions, conditionalExemptions = [] }) {
  const exemptBySpec = new Map(exemptions.map((e) => [e.spec, e]));
  const conditionalBySpec = new Map(conditionalExemptions.map((e) => [e.spec, e]));

  const rows = population.map((spec) => {
    const coverage = coveredBy.get(spec) ?? [];
    const unconditionalBy = coverage.filter((c) => c.unconditional).map((c) => c.configPath);
    const conditionalBy = coverage.filter((c) => !c.unconditional).map((c) => c.configPath);
    const by = coverage.map((c) => c.configPath);
    const exemption = exemptBySpec.get(spec);
    const conditionalExemption = conditionalBySpec.get(spec);

    let verdict;
    let reason;
    if (unconditionalBy.length > 0) {
      // 真覆盖。此时**两种**豁免都过期了：说「没人跑」的过期，说「只有条件覆盖」的也过期。
      verdict = exemption || conditionalExemption ? "covered-but-exempt" : "covered";
      reason = (exemption ?? conditionalExemption)?.reason;
    } else if (conditionalBy.length > 0) {
      verdict = conditionalExemption ? "conditional-exempt" : "conditionally-covered";
      reason = conditionalExemption?.reason;
    } else {
      verdict = exemption ? "exempt" : "unrun";
      reason = exemption?.reason;
    }
    return { spec, by, unconditionalBy, conditionalBy, verdict, reason };
  });

  const byVerdict = new Map(rows.map((row) => [row.spec, row.verdict]));
  const staleExemptions = exemptions.filter((e) => !population.includes(e.spec)).map((e) => e.spec);
  // 条件豁免的三种烂法，各自报清楚：文件没了 / 其实已是真覆盖 / 其实压根没人跑。
  // 第三种最要紧——豁免写的理由是「有人跑，只是有条件」，那个前提已经不成立了。
  const staleConditionalExemptions = conditionalExemptions.flatMap((e) => {
    if (!population.includes(e.spec)) return [{ spec: e.spec, why: "文件不存在（改名或删除后忘了同步）" }];
    const verdict = byVerdict.get(e.spec);
    if (verdict === "covered-but-exempt") {
      return [{ spec: e.spec, why: "已经被无条件 job 跑到了，条件豁免的前提不再成立" }];
    }
    if (verdict === "unrun" || verdict === "exempt") {
      return [{ spec: e.spec, why: "已经没有任何 job 跑它（连条件覆盖都没了），该按 unrun 处理" }];
    }
    return [];
  });
  return { rows, staleExemptions, staleConditionalExemptions };
}

export function auditSpecGateCoverage() {
  const population = allSpecFiles();
  const invoked = resolveInvokedConfigs();
  const coveredBy = new Map(population.map((spec) => [spec, []]));
  for (const config of invoked) {
    for (const spec of specsMatchedBy(config)) {
      if (coveredBy.has(spec)) {
        coveredBy.get(spec).push({ configPath: config.configPath, unconditional: config.unconditional });
      }
    }
  }
  return {
    ...classifySpecs({
      population,
      coveredBy,
      exemptions: EXEMPTIONS,
      conditionalExemptions: CONDITIONAL_COVERAGE_EXEMPTIONS,
    }),
    invoked,
  };
}

export { EXEMPTIONS, CONDITIONAL_COVERAGE_EXEMPTIONS };

function main() {
  const { rows, invoked, staleExemptions, staleConditionalExemptions } = auditSpecGateCoverage();
  console.log("被 CI 真正调用的 playwright config（无条件 = 每个 PR 或每次合入 main 都跑）：");
  for (const c of invoked) {
    const tag = c.unconditional ? "无条件" : "条件";
    console.log(`  · [${tag}] ${c.configPath}  ← ${c.via.join(", ")}`);
  }
  // #3094：这是**静态注册审计**，不是执行结果。旧版对 covered 打 `✅`，
  // 而 2026-09-08 那趟 e2e-full 里这几条 spec 一条都没执行（前置 lane 红把它们
  // 短路掉了），只读这行的人会得出「跑了且绿」的相反结论。这里改成中性符号
  // 并逐字写明语义，避免同一行被两种方式读。
  console.log("\nspec 门控注册判定（静态：只看有没有被某条 config 接住，不代表本趟已执行）：");
  for (const row of rows) {
    const mark = {
      covered: "🧾",
      exempt: "🟡",
      "conditional-exempt": "🟠",
      unrun: "❌",
      "conditionally-covered": "❌",
      "covered-but-exempt": "❌",
    }[row.verdict];
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
    if (row.verdict === "conditionally-covered") {
      failures.push(
        `${row.spec} 只被**条件** job 跑到（${row.conditionalBy.join(", ")}）：` +
        `path 过滤 / 手动触发 / 定时的 job 不会在共享包改动打红它时开火，门控会替它报绿。` +
        `把它归进某个无条件 job，或加进 CONDITIONAL_COVERAGE_EXEMPTIONS 并写明理由。`,
      );
    }
    if (row.verdict === "covered-but-exempt") {
      failures.push(
        `${row.spec} 已被 ${row.unconditionalBy.join(", ")} 无条件跑到，豁免条目已陈旧：` +
        `从 EXEMPTIONS / CONDITIONAL_COVERAGE_EXEMPTIONS 里删掉它。`,
      );
    }
  }
  for (const spec of staleExemptions) {
    failures.push(`EXEMPTIONS 里的 ${spec} 不存在（改名或删除后忘了同步）：清理该条目。`);
  }
  for (const { spec, why } of staleConditionalExemptions) {
    failures.push(`CONDITIONAL_COVERAGE_EXEMPTIONS 里的 ${spec} ${why}：清理该条目。`);
  }

  if (failures.length > 0) {
    console.error("\n✗ spec 门控覆盖有洞：");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    "\n✅ 每一条 spec 都已被某个**无条件** CI job 跑到（或有署名豁免）——" +
      "注册 ≠ 本趟执行，执行结果看 verify:full 的 lane 汇总",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
