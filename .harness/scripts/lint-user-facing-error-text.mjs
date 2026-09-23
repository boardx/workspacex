#!/usr/bin/env node
/**
 * 机械门：**内部错误码不许上屏**。
 *
 * ## 为什么要有这一条
 *
 * 2026-09-22 的一轮 UIUX 迭代（迭代 27）把设计详情页的
 * 那句「reasonCode 取不到就拼 HTTP 状态」换成了一张「码 → 人话」的穷举表。
 * 三轮之后才发现：同一段代码在 `workbench-screen` / `drafts-screen` /
 * `inbox-shared` 里**各抄了一份**，而那三处正是用户第一眼看到的屏。也就是说，
 * 规范早就有了（「错误要说人话」），落地却只在改过的那一个文件里成立。
 *
 * 这正是本仓 AGENTS.md 自己那条：**没有脚本的规范条目视为未落地**。
 * 所以这条门不看文档、只看代码：任何 UI 源文件里出现
 *   · reasonCode 当兜底文案
 *   · 把 HTTP 状态拼成给人看的字符串
 *   · return String(err)（把异常对象直接转成屏上文字，多半是一段英文栈）
 * 一律判失败，并指向单源 `apps/web/lib/design-failure.ts`。
 *
 * 只扫会上屏的目录（apps/web 下的 components 与 app）。`lib/design-failure.ts`
 * 自己是那张表的所在地，豁免。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const ROOTS = ["apps/web/components", "apps/web/app"];
/** 单源本身；以及把码写进 console/日志（不上屏）的地方由规则自身区分。 */
const EXEMPT = new Set(["apps/web/lib/design-failure.ts"]);

/**
 * ⚠ 存量基线（棘轮，**只准变小**）。
 *
 * 这条门是在收敛 design-loop 那一屏时立的，而同一段代码在整个 apps/web 里还有
 * 一大批存量（立门时 59 个文件 / 89 处；每还掉一处就把基线改小一次，见下）。一次性改完别人的屏不是这一轮该做的事，但**不登记就等于不存在**——
 * 所以这里把它们逐个记下来，带上各自的处数：
 *   · 处数比基线多 ⇒ 失败（不许再长）。
 *   · 处数比基线少 ⇒ 失败，并要求把基线改小（修好了就把债销掉，不留虚账）。
 *   · 不在表里的文件 ⇒ 必须是 0。
 * `components/design-loop` 不进这张表：那一屏已经清零，再出现就是回潮。
 */
const LEGACY = new Map([
  ["apps/web/app/chat/live/page.tsx", 1],
  ["apps/web/app/itv/live/page.tsx", 1],
  ["apps/web/app/project/live/page.tsx", 1],
  ["apps/web/components/admin/admin-boundary-live.tsx", 1],
  ["apps/web/components/admin/admin-header.tsx", 1],
  ["apps/web/components/admin/agent-capability-graph.tsx", 1],
  ["apps/web/components/admin/agent-definition-create-panel.tsx", 1],
  ["apps/web/components/admin/agent-definition-list-panel.tsx", 1],
  ["apps/web/components/admin/agent-url-import-panel.tsx", 1],
  ["apps/web/components/admin/canvas-template-screen.tsx", 1],
  ["apps/web/components/admin/capability-catalog-screen.tsx", 1],
  ["apps/web/components/admin/capability-edit-page.tsx", 1],
  ["apps/web/components/admin/capability-mutate.tsx", 1],
  ["apps/web/components/admin/limit-rules-live.tsx", 1],
  ["apps/web/components/admin/local-org-live.tsx", 1],
  ["apps/web/components/admin/mcp-remote-discover-panel.tsx", 1],
  ["apps/web/components/admin/mcp-screen.tsx", 2],
  ["apps/web/components/admin/member-quota-tab.tsx", 1],
  ["apps/web/components/admin/model-screen.tsx", 2],
  ["apps/web/components/admin/ops-status-screen.tsx", 2],
  ["apps/web/components/admin/overview-live.tsx", 2],
  ["apps/web/components/admin/platform-members-screen.tsx", 3],
  ["apps/web/components/admin/skill-starter-import-panel.tsx", 2],
  ["apps/web/components/admin/skill-url-import-panel.tsx", 1],
  ["apps/web/components/admin/usage-monitor-tab.tsx", 1],
  ["apps/web/components/asset-governance/ag-screens.tsx", 1],
  ["apps/web/components/canvas/template-admin.tsx", 1],
  ["apps/web/components/canvas/template-apply-dialog.tsx", 1],
  ["apps/web/components/canvas/template-editor-panel.tsx", 1],
  ["apps/web/components/canvas/template-prompt-drawer.tsx", 1],
  ["apps/web/components/canvas/template-trial-dialog.tsx", 1],
  // 2026-09-23（#3749 R2）：这一处**换了文件，没有换性质**。取源与渲染从
  // `chat-artifact-preview-dialog.tsx` 搬进了 `chat-artifact-view.tsx`（右栏与模态共用
  // 同一遍渲染），那行 `reasonCode ?? …` 跟着搬过去了。所以这里是同一笔债改个门牌：
  // 文件数与处数都没变（仍是 1 处），不是新增存量。
  // ⚠ 这一处不能照本门的建议改成 `describeFailure`：它的契约闭集是
  //   `["NOT_VISIBLE", "STORAGE_UNAVAILABLE"]`（chat.ts getThreadArtifactSource），
  //   两码用户的处置完全不同，而 `design-failure.ts` 两张表都不含这两个码，走过去会
  //   落到 `httpText()` 把它们糊成同一句。现行「原样回显」是有测试钉住的决定
  //   （chat-artifact-preview-dialog.test.tsx:103 断言 textContent === "NOT_VISIBLE"）。
  //   要销这笔债得先给这两个码各写一句人话并改那条断言——那是独立的一次决定，不在本 PR 内。
  ["apps/web/components/chat/chat-artifact-view.tsx", 1],
  ["apps/web/components/chat/chat-read-screen.tsx", 1],
  ["apps/web/components/chat/chat-recording-panel.tsx", 2],
  ["apps/web/components/chat/message-rating.tsx", 1],
  ["apps/web/components/chat/personal-chat-screen.tsx", 1],
  ["apps/web/components/entry/invite-activation.tsx", 1],
  ["apps/web/components/entry/link-activation.tsx", 1],
  ["apps/web/components/entry/reset-password.tsx", 1],
  ["apps/web/components/files/live-files-browser.tsx", 1],
  ["apps/web/components/itv/digital-interview-create-modal.tsx", 1],
  ["apps/web/components/itv/digital-interview-create.tsx", 1],
  ["apps/web/components/itv/digital-interview-setup.tsx", 1],
  ["apps/web/components/itv/interview-studio-home.tsx", 1],
  ["apps/web/components/itv/quick-digital-interview.tsx", 1],
  ["apps/web/components/org-admin/org-admin-screen.tsx", 5],
  ["apps/web/components/org-admin/shared-invite-links.tsx", 1],
  ["apps/web/components/profile/profile-screen.tsx", 5],
  ["apps/web/components/project/new-project-flow.tsx", 1],
  ["apps/web/components/project/project-workbench.tsx", 7],
  ["apps/web/components/project/tab-live.tsx", 1],
  ["apps/web/components/project/tab-prep.tsx", 3],
  ["apps/web/components/projects/projects-screen.tsx", 3],
  ["apps/web/components/skill/skill-catalog-live.tsx", 1],
  ["apps/web/components/tasks/today-board-live.tsx", 4],
  ["apps/web/components/tpl-designer/blueprint-designer-page-live.tsx", 1],
  ["apps/web/components/tpl/blueprint-list-screen-live.tsx", 1],
  ["apps/web/components/tpl/workflow-screen.tsx", 1],
]);

const RULES = [
  { re: /\.reasonCode\s*\?\?/, why: "把内部错误码当兜底文案（reasonCode ?? …）" },
  { re: /`http_\$\{/, why: "把 HTTP 状态拼成给人看的字符串（`http_${…}`）" },
  { re: /return\s+String\(err\w*\)\s*;/, why: "把异常对象直接转成屏上文字（return String(err)）" },
];

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { yield* walk(p); continue; }
    if (/\.(tsx?|jsx?)$/.test(p)) yield p;
  }
}

const hits = [];
const perFile = new Map();
for (const r of ROOTS) {
  for (const file of walk(join(ROOT, r))) {
    const rel = relative(ROOT, file);
    if (EXEMPT.has(rel)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // 注释行不算——本门要挡的是真的会跑到屏上的代码，不是讲这件事的文字。
      const code = line.trim();
      if (code.startsWith("*") || code.startsWith("//")) return;
      // 一行算一处：同一行可能同时命中两条规则（`reasonCode ?? \`http_${…}\``），
      // 那仍然是一处要改的地方，不是两处——基线要数得稳。
      const rule = RULES.find((r) => r.re.test(line));
      if (rule === undefined) return;
      perFile.set(rel, (perFile.get(rel) ?? 0) + 1);
      if ((LEGACY.get(rel) ?? 0) === 0) hits.push({ rel, n: i + 1, why: rule.why, line: code.slice(0, 120) });
    });
  }
}

/** 棘轮：存量文件的处数只准变小；变小了也要失败一次，逼人把基线跟着改小。 */
const drift = [];
for (const [rel, base] of LEGACY) {
  const now = perFile.get(rel) ?? 0;
  if (now > base) drift.push(`${rel}: ${now} 处（基线 ${base}）——不许再长`);
  if (now < base) drift.push(`${rel}: ${now} 处（基线 ${base}）——修好了，请把基线改成 ${now}`);
}
if (drift.length > 0) {
  console.error("❌ [user-facing-error-text] 存量基线对不上：");
  for (const d of drift) console.error(`  ${d}`);
  process.exit(1);
}

if (hits.length > 0) {
  console.error("❌ [user-facing-error-text] 内部错误码上屏了：");
  for (const h of hits) console.error(`  ${h.rel}:${h.n}  ${h.why}\n      ${h.line}`);
  console.error("\n  改法：用 apps/web/lib/design-failure.ts 的 describeFailure(err)——那里有一张按契约闭集穷举的「码 → 人话」表。");
  console.error("  需要保留某处的特判（比如 404 的专门说法），在 describeFailure 之外先判、再退回它兜底。");
  process.exit(1);
}
const legacyTotal = [...LEGACY.values()].reduce((a, b) => a + b, 0);
console.log(`✅ [user-facing-error-text] 新代码没有内部错误码上屏；存量基线 ${LEGACY.size} 个文件 / ${legacyTotal} 处（只准变小）`);
