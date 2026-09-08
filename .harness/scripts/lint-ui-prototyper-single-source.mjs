#!/usr/bin/env node
/**
 * lint-ui-prototyper-single-source.mjs —— ui-prototyper 硬规则的单一事实源门控
 *
 * 管的是什么：ui-prototyper 的硬规则此前在**三处**手写——
 *   `.harness/agents/ui-prototyper.yaml`（subagent 系统提示）、
 *   `.agents/skills/ui-prototyper/SKILL.md`（skill 知识库）、
 *   根 `AGENTS.md`（「不许改 status」那条）。没有任何脚本比对过它们。
 * 2026-09-09 收敛：规则原文抽到 `.harness/instructions/ui-prototyper-hard-rules.md`，
 * 两个消费方只写「见 X」。本门控保证它不再漂回去。
 *
 * ⚠ 为什么不是「只留一侧」：这几条是签核门（ADR-023 第 ① 件）的核心。yaml 决定
 *   subagent 被派出去时带什么系统提示，SKILL.md 决定主线程按需加载时读到什么，
 *   任一侧读者丢掉它都不可接受 ⇒ 收敛方式是抽单源 + 两边引用。
 *
 * ── 判定三条 ─────────────────────────────────────────────────────────
 *  ① 单源文件必须存在，且每条**规则原文特征句**都在里面（否则判定②平凡为真）。
 *  ② 两个消费方**都不许出现规则原文特征句**——只许出现索引式短标签与「见 X」引用。
 *     索引（八条各一个短标签）是刻意保留的：根 AGENTS.md 自己就是「目录页」，
 *     读者需要知道有哪几条才知道要不要点进去；被禁的是**判据与理由的原文**
 *     （谁能改 status、为什么不接后端、七种状态具体是哪七种……），
 *     因为那才是会各自演化、各自漂移的部分。
 *  ③ 两个消费方都必须引用单源文件路径——只删不引 = 规则对该侧读者消失了。
 *
 * ── 空集防线（本仓九次「全绿但空转」的教训）─────────────────────────
 *  · 任一文件不存在 ⇒ 红。
 *  · 任一特征句在单源文件里找不到 ⇒ 红（特征句写错了会让判定②对任何内容都判绿，
 *    这正是「全绿但空转」的典型形态）。
 *
 * 用法：node .harness/scripts/lint-ui-prototyper-single-source.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SOURCE_FILE = ".harness/instructions/ui-prototyper-hard-rules.md";
export const CONSUMERS = [".harness/agents/ui-prototyper.yaml", ".agents/skills/ui-prototyper/SKILL.md"];

/**
 * 规则原文特征句：每条对应一条硬规则里**只有原文才会出现**的判据/理由片段。
 * 挑的是长句而不是关键词——关键词（如 `data-testid`）在两个消费方的索引与
 * 自检清单里正当出现，用它做判据会把正当引用误判成复述。
 */
export const RULE_SIGNATURES = [
  { rule: "①", text: "是**人类工程师**的动作，不是 agent 的" },
  { rule: "②", text: "人类要能点、能看到交互与状态，不是看一张图" },
  { rule: "③", text: "一屏三行假数据看不出信息密度问题" },
  { rule: "③", text: "防止契约在没有评审的地方被发明" },
  { rule: "④", text: "e2e 只认 `data-testid`，不锚文案/结构" },
  { rule: "⑤", text: "默认 / 加载 / 空 / 校验失败 / 依赖失败 / 无权限 / 成功" },
  { rule: "⑥", text: "三栏骨架、左侧五段语义导航" },
  { rule: "⑦", text: "不要做成一个孤零零的红按钮" },
  { rule: "⑧", text: '不写 `(page: any)`' },
];

/** 纯函数判定。files: 路径 → 内容（不存在时为 null）。 */
export function checkSingleSource(source, consumers, signatures) {
  const failures = [];
  if (signatures.length === 0) failures.push("空集防线：特征句列表为空，判定会平凡为真");
  if (source === null) {
    failures.push(`单源文件 ${SOURCE_FILE} 不存在——规则原文没有落点，拒绝判绿`);
    return { ok: false, failures, checked: 0 };
  }
  for (const sig of signatures) {
    if (!source.includes(sig.text)) {
      failures.push(`空集防线：规则 ${sig.rule} 的特征句在 ${SOURCE_FILE} 里找不到（「${sig.text}」）——特征句写错会让「消费方不含原文」对任何内容都判绿`);
    }
  }
  for (const [path, content] of consumers) {
    if (content === null) {
      failures.push(`消费方 ${path} 不存在`);
      continue;
    }
    if (!content.includes(SOURCE_FILE)) {
      failures.push(`${path} 没有引用单源文件 ${SOURCE_FILE}——只删不引等于规则对这一侧读者消失了`);
    }
    for (const sig of signatures) {
      if (content.includes(sig.text)) {
        failures.push(`${path} 复述了规则 ${sig.rule} 的原文（「${sig.text}」）——原文只许在 ${SOURCE_FILE} 里，这里写「见 X」`);
      }
    }
  }
  return { ok: failures.length === 0, failures, checked: consumers.length };
}

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

export function run() {
  return checkSingleSource(read(SOURCE_FILE), CONSUMERS.map((c) => [c, read(c)]), RULE_SIGNATURES);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = run();
  if (result.ok) {
    console.log(`✅ [ui-prototyper-single-source] ${RULE_SIGNATURES.length} 条规则原文只在 ${SOURCE_FILE}；${result.checked} 个消费方均只引用不复述`);
    process.exit(0);
  }
  console.error("❌ [ui-prototyper-single-source]");
  for (const f of result.failures) console.error(`   · ${f}`);
  process.exit(1);
}
