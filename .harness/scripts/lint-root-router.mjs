#!/usr/bin/env node
/**
 * lint-root-router.mjs —— 根 AGENTS.md（目录页）的机械门控
 *
 * 管的是什么：根 `AGENTS.md` 是每个 agent 开工读的第一个文件。它自己在开头写了两条
 * 规范——「说清楚这个项目是什么」和「硬上限 N 行」——而**从来没有脚本核对过**，于是：
 *   · 项目身份那一行一直停在模板占位符 `<一句话说明你的项目>`（#390）；
 *   · 声明的「~100 行」被无声突破到 167 行（还是个带 `~` 的、机器读不出来的数字）。
 * 这正是本仓 AGENTS.md 自己那条：**没有脚本的规范条目视为未落地**。
 *
 * ── 判定四条 ─────────────────────────────────────────────────────────
 *  ① 占位符门：目录页里不许留未解析占位符。判据**复用** `lib/placeholder-gate.ts`
 *     的 `findUnresolvedPlaceholders`（`{{机器替换}}` + `<含 CJK 的人工填写>`）——
 *     「占位符长什么样」这件事本仓已经有单一事实源，这里不另写一套正则。
 *     该 lib 刻意不报纯 ASCII 的 `<phase>` / `<issue>` 这类路径元变量（与 HTML/泛型
 *     字面上不可区分），目录页正当用到它们，所以这个取舍在这里也正好合用。
 *  ①b 模板残留门：上面那条按语法判，判不了「语法合法但内容还是模板原话」。
 *     这类逐字残留（scaffold 留下的 ASCII 句子）列在 TEMPLATE_RESIDUE 里。
 *  ② 身份门：正文必须出现真实项目名——从 `.harness/config/github-sync.yaml` 的
 *     `repo` 字段取（身份的单一事实源），而不是在本文件里再写一份项目名。
 *     有它才挡得住「把占位符那行整行删掉」这种把①糊弄过去的改法。
 *  ③ 预算门：行数 ≤ 目录页**自己声明**的硬上限。上限只许声明一次（出现两次 = 同一
 *     事实声明在两处，当场红）；声明缺失或解析不出数字也红——否则门控恒绿。
 *  ④ 可达门：正文引用的 `.harness/instructions/*.md` 必须真实存在。搬出去的硬规则
 *     只有「还能点得到」才算搬家，点不到就是规则消失了。
 *
 * ── 空集防线（本仓「全绿但空转」的教训）─────────────────────────────
 *  · 目录页 / 身份来源读不到 ⇒ 红，不是跳过。
 *  · 残留签名列表为空 ⇒ 红（判定①b 会平凡为真）。
 *  · 预算数字解析不出 ⇒ 红（判定③会平凡为真）。
 *
 * 用法：pnpm run lint:root-router
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findUnresolvedPlaceholders } from "./lib/placeholder-gate.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ROUTER_FILE = "AGENTS.md";
export const IDENTITY_SOURCE = ".harness/config/github-sync.yaml";

/**
 * 逐字模板残留：scaffold 留下的**纯 ASCII** 句子/记号，语法上不是占位符，
 * 判定①按定义看不见它们，所以在这里逐字列出。
 */
export const TEMPLATE_RESIDUE = ["agentic-harness-template 生成", "<owner>/<repo>", "TODO(fill)"];

const BUDGET_RE = /硬上限\s*\*{0,2}\s*(\d+)\s*行/g;
const INSTRUCTION_REF = /`(\.harness\/instructions\/[A-Za-z0-9._\/-]+\.md)`/g;

/** 从 github-sync.yaml 的 `repo: "owner/name"` 取项目名（身份单一事实源）。 */
export function projectNameFrom(yamlText) {
  const m = yamlText === null ? null : yamlText.match(/^\s*repo:\s*["']?([\w.-]+)\/([\w.-]+)["']?/m);
  return m ? m[2] : null;
}

/** 纯函数判定。exists(path) 只在判定④里用到。 */
export function checkRootRouter({ router, projectName, exists = () => true, residue = TEMPLATE_RESIDUE }) {
  const failures = [];
  if (residue.length === 0) failures.push("空集防线：模板残留签名列表为空，判定①b 会平凡为真");
  if (router === null) {
    failures.push(`${ROUTER_FILE} 读不到——目录页不存在时拒绝判绿`);
    return { ok: false, failures, lines: 0, budget: null };
  }

  // ① 占位符门（判据复用 lib/placeholder-gate.ts）
  for (const f of findUnresolvedPlaceholders(router)) {
    failures.push(`${ROUTER_FILE}:${f.line} 留着未解析占位符「${f.placeholder}」(${f.kind})——目录页第一句就得说清楚这个项目是什么`);
  }
  // ①b 模板残留门
  for (const sig of residue) {
    if (router.includes(sig)) failures.push(`${ROUTER_FILE} 仍留着模板原话「${sig}」——这是 scaffold 的残留，不是本项目的事实`);
  }

  // ② 身份门
  if (projectName === null) {
    failures.push(`身份来源 ${IDENTITY_SOURCE} 读不到 / 没有 repo 字段——无从核对项目身份，拒绝判绿`);
  } else if (!router.toLowerCase().includes(projectName.toLowerCase())) {
    failures.push(`${ROUTER_FILE} 通篇没出现项目名「${projectName}」（取自 ${IDENTITY_SOURCE} 的 repo）——删掉占位符不等于写上了身份`);
  }

  // ③ 预算门
  const budgets = [...router.matchAll(BUDGET_RE)].map((m) => Number(m[1]));
  const lines = router.replace(/\n$/, "").split("\n").length;
  let budget = null;
  if (budgets.length === 0) {
    failures.push(`${ROUTER_FILE} 没有声明「硬上限 N 行」——预算解析不出来时判定会平凡为真，拒绝判绿`);
  } else if (budgets.length > 1) {
    failures.push(`${ROUTER_FILE} 声明了 ${budgets.length} 次行数上限（${budgets.join(" / ")}）——同一事实不得声明在两处`);
  } else {
    budget = budgets[0];
    if (lines > budget) {
      failures.push(`${ROUTER_FILE} 有 ${lines} 行，超过它自己声明的硬上限 ${budget} 行——把细节搬进 .harness/instructions/，或显式改这个数字并说明理由`);
    }
  }

  // ④ 可达门
  for (const [, ref] of router.matchAll(INSTRUCTION_REF)) {
    if (!exists(ref)) failures.push(`${ROUTER_FILE} 指向 ${ref}，但该文件不存在——搬出去的规则点不到就是消失了`);
  }

  return { ok: failures.length === 0, failures, lines, budget };
}

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

export function run() {
  return checkRootRouter({
    router: read(ROUTER_FILE),
    projectName: projectNameFrom(read(IDENTITY_SOURCE)),
    exists: (rel) => existsSync(join(ROOT, rel)),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = run();
  if (result.ok) {
    console.log(`✅ [root-router] ${ROUTER_FILE} 无占位符、写明项目身份、${result.lines}/${result.budget} 行在预算内、引用的 instructions 均可达`);
    process.exit(0);
  }
  console.error("❌ [root-router]");
  for (const f of result.failures) console.error(`   · ${f}`);
  process.exit(1);
}
