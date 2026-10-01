#!/usr/bin/env node
/**
 * execution-plan.mjs —— 执行计划可视化（Mermaid 流程图 + 颜色表进度）的机械落地
 *
 * 管的是什么：人类给 AI 布置目标后，AI 必须先把「我理解的目标 + 执行计划」画成
 * Mermaid 流程图，并用颜色表示每一步的进度（规范见
 * `.harness/instructions/execution-plan-visualization.md`）。本脚本是**状态调色板的
 * 单一事实源**，并提供三条子命令：
 *
 *   check [file ...]            校验计划文件；不带参数 ⇒ 扫描全部默认位置（见 DEFAULT_GLOBS）
 *   set <file> <node> <status> [--note "…"]
 *                               把某个节点改成某个状态（改的是 `class <node> <status>` 那一行）；
 *                               blocked 配 --note 写原因，tested 配 --note 写证据
 *   summary <file>              打印各状态计数 + 堵塞原因，便于贴到 issue / 交接文档
 *
 * ── 判定（check）─────────────────────────────────────────────────────
 *  ① 文件里必须有且只有一个 ```mermaid 块，且以 `flowchart` / `graph` 开头。
 *  ② 五个状态的 classDef 必须**全部在**且与 PLAN_STATUSES 逐字一致——颜色只许在本文件
 *     定义一次，任何副本（模板、规范里的通用提示词、计划文件）都由这里核对，不许漂移。
 *  ③ 每个声明过的节点必须**恰好一条** `class <节点> <状态>`；class 行不许指向未声明节点
 *     或未知状态（未着色的节点在图上看不出进度 = 计划失去意义）。
 *  ④ `blocked`（红）节点必须带 `%% blocked <节点>: <原因>`——只标红不说原因，人类没法接手。
 *  ⑤ `tested`（紫）节点必须带 `%% evidence <节点>: <命令或证据路径>`——本仓「没有证据 =
 *     没有完成」，紫色是「有证据」的意思，不是「感觉测过了」。
 *  ⑥ skill 入口 `.agents/skills/execution-plan/SKILL.md` 必须引用规范、不许带色值副本。
 *
 * ── 空集防线（本仓「全绿但空转」的教训）─────────────────────────────
 *  · 计划里一个节点都解析不出 ⇒ 红（否则判定③平凡为真）。
 *  · 默认扫描时模板文件必须存在 ⇒ 至少有一份被判过。
 *
 * 用法：node .harness/scripts/execution-plan.mjs check
 *       node .harness/scripts/execution-plan.mjs set phases/…/plans/F03.plan.md S2 doing
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * 状态调色板——唯一事实源。顺序即推进顺序（blocked 可从任何状态进入）。
 * 选色原则：浅底 + 深描边 + 深字，浅色/深色主题下文字都可读；色名与人类约定一一对应。
 */
export const PLAN_STATUSES = [
  { id: "todo", label: "未开始", color: "灰", def: "fill:#e5e7eb,stroke:#6b7280,color:#111827" },
  { id: "doing", label: "已开始", color: "黄", def: "fill:#fde68a,stroke:#d97706,color:#111827" },
  { id: "done", label: "已完成", color: "绿", def: "fill:#bbf7d0,stroke:#16a34a,color:#111827" },
  { id: "tested", label: "已测试", color: "紫", def: "fill:#ddd6fe,stroke:#7c3aed,color:#111827" },
  { id: "blocked", label: "被堵塞", color: "红", def: "fill:#fecaca,stroke:#dc2626,color:#111827" },
];
const STATUS_IDS = new Set(PLAN_STATUSES.map((s) => s.id));

export const TEMPLATE_FILE = ".harness/templates/execution-plan.template.md";
/** 默认扫描：模板 + 规范（其中的通用提示词带 classDef 副本）+ 各 sprint 的计划文件。 */
export const SPEC_FILE = ".harness/instructions/execution-plan-visualization.md";
/** skill 入口只许引用规范，不许带 classDef 副本（它不是能原样粘贴的提示词，没理由再抄一份）。 */
export const SKILL_FILE = ".agents/skills/execution-plan/SKILL.md";

/** 纯函数：skill 入口必须引用规范、不许复述调色板。 */
export function checkSkillEntry(content) {
  if (content === null) return [`skill 入口 ${SKILL_FILE} 不存在`];
  const failures = [];
  if (!content.includes(SPEC_FILE)) failures.push(`${SKILL_FILE} 没有引用规范 ${SPEC_FILE}`);
  if (/^\s*classDef\s/m.test(content) || PLAN_STATUSES.some((s) => content.includes(s.def.split(",")[0]))) {
    failures.push(`${SKILL_FILE} 复述了调色板——色值只许在 execution-plan.mjs / 模板 / 规范的通用提示词里（均受本 lint 核对）`);
  }
  return failures;
}

/** 规范写法：`classDef <id> <def>`（行尾分号可有可无）。 */
export function classDefLine(s) {
  return `classDef ${s.id} ${s.def}`;
}

/** 取出 ```mermaid 代码块。 */
export function extractMermaidBlocks(markdown) {
  const blocks = [];
  const re = /```mermaid[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown)) !== null) blocks.push({ body: m[1], start: m.index + m[0].indexOf("\n") + 1 });
  return blocks;
}

const OPENERS = [
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["((", "))"],
  ["{{", "}}"],
  ["[/", "/]"],
  ["[\\", "\\]"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
];
const DIRECTIVE = /^\s*(%%|classDef\b|class\b|style\b|linkStyle\b|click\b|subgraph\b|end\s*$|direction\b|flowchart\b|graph\b)/;

/**
 * 解析一个流程图块：声明的节点、class 赋值、%% 注释。
 * 节点 = 「标识符紧跟形状括号」（`S1[…]`、`G([…])`、`D{…}`……）；只在边里出现、从未带括号
 * 声明的标识符不算节点——计划约定每一步都要有文字标签，裸标识符说不清这一步是什么。
 */
export function parseFlowchart(body) {
  const nodes = new Map(); // id -> label
  const classes = []; // {ids, status, line}
  const blockedNotes = new Map();
  const evidenceNotes = new Map();
  const classDefs = new Map(); // id -> def string
  const lines = body.split("\n");
  const header = lines.find((l) => l.trim() !== "" && !l.trim().startsWith("%%")) ?? "";

  lines.forEach((raw, i) => {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^%%\s*blocked\s+([A-Za-z_][\w]*)\s*[:：]\s*(\S.*)$/))) blockedNotes.set(m[1], m[2]);
    if ((m = line.match(/^%%\s*evidence\s+([A-Za-z_][\w]*)\s*[:：]\s*(\S.*)$/))) evidenceNotes.set(m[1], m[2]);
    if ((m = line.match(/^classDef\s+([\w,]+)\s+(.+?);?\s*$/))) {
      for (const id of m[1].split(",")) classDefs.set(id, m[2].replace(/\s+/g, ""));
      return;
    }
    if ((m = line.match(/^class\s+([\w,\s]+?)\s+([\w-]+);?\s*$/))) {
      classes.push({ ids: m[1].split(",").map((s) => s.trim()).filter(Boolean), status: m[2], line: i });
      return;
    }
    if (DIRECTIVE.test(raw)) {
      // subgraph 的标题形如 `subgraph X[标题]`——X 是分组，不是计划步骤，跳过。
      return;
    }
    scanNodes(line, nodes);
  });
  // `A:::status` 简写也是 class 赋值，但它和 `class` 行并存会让「改一处」变成「改两处」。
  const inlineClass = /:::/.test(body);
  return { header, nodes, classes, blockedNotes, evidenceNotes, classDefs, inlineClass };
}

function scanNodes(line, nodes) {
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const idm = rest.match(/^[A-Za-z_][\w]*/);
    const prev = i === 0 ? " " : line[i - 1];
    if (idm && !/[\w]/.test(prev)) {
      const id = idm[0];
      const after = i + id.length;
      const pair = OPENERS.find(([o]) => line.startsWith(o, after));
      if (pair) {
        const [open, close] = pair;
        const end = line.indexOf(close, after + open.length);
        const labelEnd = end === -1 ? line.length : end;
        const label = line.slice(after + open.length, labelEnd).replace(/^"|"$/g, "").trim();
        if (!nodes.has(id)) nodes.set(id, label);
        i = end === -1 ? line.length : end + close.length;
        continue;
      }
      // 边上的文字标签 `-->|文字|` 会被当成普通字符跳过
      i = after;
      continue;
    }
    if (line[i] === "|") {
      const end = line.indexOf("|", i + 1);
      i = end === -1 ? line.length : end + 1;
      continue;
    }
    i += 1;
  }
}

/** 校验 classDef 副本：出现了哪个状态的 classDef，就必须与调色板逐字一致。 */
export function checkClassDefs(classDefs, { requireAll }) {
  const failures = [];
  for (const s of PLAN_STATUSES) {
    const got = classDefs.get(s.id);
    if (got === undefined) {
      if (requireAll) failures.push(`缺少状态 ${s.id}（${s.color}·${s.label}）的 classDef——应为「${classDefLine(s)}」`);
      continue;
    }
    if (got !== s.def.replace(/\s+/g, "")) {
      failures.push(`状态 ${s.id} 的颜色与调色板不一致：写的是「${got}」，应为「${s.def}」（颜色只许在 execution-plan.mjs 定义一次）`);
    }
  }
  return failures;
}

/** 纯函数：校验一份计划 markdown。 */
export function checkPlan(markdown) {
  const failures = [];
  const blocks = extractMermaidBlocks(markdown);
  if (blocks.length !== 1) {
    failures.push(`计划文件必须有且只有一个 \`\`\`mermaid 块，实际 ${blocks.length} 个`);
    return { ok: false, failures, counts: null };
  }
  const p = parseFlowchart(blocks[0].body);
  if (!/^\s*(flowchart|graph)\b/.test(p.header)) failures.push(`mermaid 块必须是流程图（以 flowchart / graph 开头），实际首行「${p.header.trim()}」`);
  if (p.inlineClass) failures.push("不许用 `节点:::状态` 简写——状态只写在 `class <节点> <状态>` 行里，`set` 子命令才能只改一处");
  failures.push(...checkClassDefs(p.classDefs, { requireAll: true }));
  if (p.nodes.size === 0) failures.push("空集防线：一个节点都没解析出来（节点要写成 `S1[这一步做什么]` 形式）");

  const statusOf = new Map();
  for (const c of p.classes) {
    if (!STATUS_IDS.has(c.status)) {
      failures.push(`class 行用了未知状态「${c.status}」——只许 ${[...STATUS_IDS].join(" / ")}`);
      continue;
    }
    for (const id of c.ids) {
      if (!p.nodes.has(id)) failures.push(`class 行指向未声明的节点「${id}」`);
      else if (statusOf.has(id)) failures.push(`节点「${id}」有多条状态（${statusOf.get(id)} 与 ${c.status}）——每个节点恰好一条`);
      else statusOf.set(id, c.status);
    }
  }
  for (const id of p.nodes.keys()) {
    if (!statusOf.has(id)) failures.push(`节点「${id}」（${p.nodes.get(id)}）没有状态——补一行 \`class ${id} todo\``);
  }
  for (const [id, st] of statusOf) {
    if (st === "blocked" && !p.blockedNotes.has(id)) failures.push(`节点「${id}」标了 blocked（红）却没写原因——补 \`%% blocked ${id}: <卡在哪 / 需要谁做什么>\``);
    if (st === "tested" && !p.evidenceNotes.has(id)) failures.push(`节点「${id}」标了 tested（紫）却没有证据——补 \`%% evidence ${id}: <验证命令或 evidence 路径>\``);
  }

  const counts = Object.fromEntries(PLAN_STATUSES.map((s) => [s.id, 0]));
  for (const st of statusOf.values()) counts[st] += 1;
  return { ok: failures.length === 0, failures, counts, parsed: p, statusOf };
}

/** 纯函数：把节点 node 的状态改成 status，返回新 markdown。
 *  note：blocked 时写成 `%% blocked <node>: note`，tested 时写成 `%% evidence <node>: note`
 *  （同节点同类注释已存在则替换，保证一处）。 */
export function setNodeStatus(markdown, node, status, note) {
  if (!STATUS_IDS.has(status)) throw new Error(`未知状态「${status}」——只许 ${[...STATUS_IDS].join(" / ")}`);
  const blocks = extractMermaidBlocks(markdown);
  if (blocks.length !== 1) throw new Error(`计划文件必须有且只有一个 mermaid 块，实际 ${blocks.length} 个`);
  const { body, start } = blocks[0];
  const p = parseFlowchart(body);
  if (!p.nodes.has(node)) throw new Error(`节点「${node}」不存在；已声明：${[...p.nodes.keys()].join(", ")}`);

  const lines = body.split("\n");
  let replaced = false;
  const out = [];
  for (const raw of lines) {
    const m = raw.match(/^(\s*)class\s+([\w,\s]+?)\s+([\w-]+);?\s*$/);
    if (!m) {
      out.push(raw);
      continue;
    }
    const ids = m[2].split(",").map((s) => s.trim());
    if (!ids.includes(node)) {
      out.push(raw);
      continue;
    }
    // 从合并写法里拆出来，保证「一个节点一行」
    const others = ids.filter((id) => id !== node);
    if (others.length > 0) out.push(`${m[1]}class ${others.join(",")} ${m[3]}`);
    if (!replaced) out.push(`${m[1]}class ${node} ${status}`);
    replaced = true;
  }
  const indent = (lines.find((l) => /^\s*classDef\b/.test(l)) ?? "  ").match(/^\s*/)[0];
  if (!replaced) {
    let lastIdx = out.length - 1;
    while (lastIdx >= 0 && out[lastIdx].trim() === "") lastIdx -= 1;
    out.splice(lastIdx + 1, 0, `${indent}class ${node} ${status}`);
  }
  const noteKind = { blocked: "blocked", tested: "evidence" }[status];
  // 离开 blocked / tested 时删掉对应注释——图上只留「现在」的原因与证据，历史写进度日志
  for (const kind of ["blocked", "evidence"]) {
    if (kind === noteKind) continue;
    const staleRe = new RegExp(`^\\s*%%\\s*${kind}\\s+${node}\\s*[:：]`);
    for (let k = out.length - 1; k >= 0; k -= 1) if (staleRe.test(out[k])) out.splice(k, 1);
  }
  if (note !== undefined && noteKind === undefined) throw new Error(`--note 只用于 blocked（写原因）或 tested（写证据），不适用于 ${status}`);
  if (noteKind !== undefined && note !== undefined) {
    const noteRe = new RegExp(`^\\s*%%\\s*${noteKind}\\s+${node}\\s*[:：]`);
    const existing = out.findIndex((l) => noteRe.test(l));
    const noteLine = `${indent}%% ${noteKind} ${node}: ${note}`;
    if (existing !== -1) out[existing] = noteLine;
    else out.splice(out.findIndex((l) => new RegExp(`^\\s*class\\s+${node}\\s`).test(l)) + 1, 0, noteLine);
  }
  const newBody = out.join("\n");
  return markdown.slice(0, start) + newBody + markdown.slice(start + body.length);
}

/** 纯函数：一行摘要 + 堵塞清单。 */
export function summarize(markdown) {
  const r = checkPlan(markdown);
  if (!r.counts) return { ok: false, text: r.failures.join("\n") };
  const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
  const parts = PLAN_STATUSES.map((s) => `${s.color}·${s.label} ${r.counts[s.id]}`);
  const lines = [`共 ${total} 步：${parts.join(" / ")}`];
  for (const [id, note] of r.parsed.blockedNotes) {
    if (r.statusOf.get(id) === "blocked") lines.push(`  🔴 ${id}（${r.parsed.nodes.get(id)}）：${note}`);
  }
  return { ok: r.ok, text: lines.join("\n"), failures: r.failures };
}

function walkPlans(dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkPlans(p, acc);
    else if (entry.endsWith(".plan.md")) acc.push(p);
  }
  return acc;
}

/** 默认扫描集合：skill 入口（不许复述）+ 模板（完整校验）+ 规范（classDef 副本齐全且一致）+ phases 下的 *.plan.md。 */
export function defaultTargets(root = ROOT) {
  return {
    template: join(root, TEMPLATE_FILE),
    spec: join(root, SPEC_FILE),
    skill: join(root, SKILL_FILE),
    plans: walkPlans(join(root, "phases"), []),
  };
}

export function run(argv, root = ROOT) {
  const [cmd, ...rest] = argv;
  const out = [];
  let ok = true;
  if (cmd === "check") {
    const files = rest.length > 0 ? rest.map((f) => resolve(root, f)) : null;
    const targets = files ? { template: null, spec: null, skill: null, plans: files } : defaultTargets(root);
    if (targets.skill !== null) {
      const f = checkSkillEntry(existsSync(targets.skill) ? readFileSync(targets.skill, "utf8") : null);
      if (f.length > 0) {
        ok = false;
        out.push(`✗ ${SKILL_FILE}`, ...f.map((x) => `    ${x}`));
      } else out.push(`✓ ${SKILL_FILE}（只引用规范，不复述调色板）`);
    }
    if (targets.template !== null) {
      if (!existsSync(targets.template)) {
        out.push(`✗ 空集防线：模板 ${TEMPLATE_FILE} 不存在`);
        ok = false;
      } else targets.plans.unshift(targets.template);
    }
    if (targets.spec !== null) {
      if (!existsSync(targets.spec)) {
        out.push(`✗ 规范 ${SPEC_FILE} 不存在`);
        ok = false;
      } else {
        const defs = new Map();
        for (const b of extractMermaidBlocks(readFileSync(targets.spec, "utf8"))) {
          for (const [k, v] of parseFlowchart(b.body).classDefs) defs.set(k, v);
        }
        // 规范正文里的通用提示词若带 classDef 副本，副本必须与调色板一致
        const promptDefs = [...readFileSync(targets.spec, "utf8").matchAll(/^\s*classDef\s+(\w+)\s+(.+?);?\s*$/gm)];
        for (const [, k, v] of promptDefs) defs.set(k, v.replace(/\s+/g, ""));
        // 规范里的通用提示词要能原样粘贴给任何 AI ⇒ 五个 classDef 必须齐全
        const f = checkClassDefs(defs, { requireAll: true });
        if (f.length > 0) {
          ok = false;
          out.push(`✗ ${SPEC_FILE}`, ...f.map((x) => `    ${x}`));
        } else out.push(`✓ ${SPEC_FILE}（classDef 副本与调色板一致）`);
      }
    }
    for (const file of targets.plans) {
      const rel = relative(root, file);
      if (!existsSync(file)) {
        out.push(`✗ ${rel} 不存在`);
        ok = false;
        continue;
      }
      const r = checkPlan(readFileSync(file, "utf8"));
      if (r.ok) out.push(`✓ ${rel}`);
      else {
        ok = false;
        out.push(`✗ ${rel}`, ...r.failures.map((x) => `    ${x}`));
      }
    }
    return { ok, out };
  }
  if (cmd === "set") {
    const noteAt = rest.indexOf("--note");
    const note = noteAt === -1 ? undefined : rest[noteAt + 1];
    const [file, node, status] = noteAt === -1 ? rest : rest.slice(0, noteAt);
    if (!file || !node || !status || (noteAt !== -1 && !note)) {
      return { ok: false, out: ['用法：set <file> <node> <status> [--note "<堵塞原因 / 证据>"]'] };
    }
    const path = resolve(root, file);
    const next = setNodeStatus(readFileSync(path, "utf8"), node, status, note);
    const r = checkPlan(next);
    writeFileSync(path, next);
    out.push(`${file}：${node} → ${status}`);
    if (!r.ok) out.push("⚠ 改完后计划仍未通过校验：", ...r.failures.map((x) => `    ${x}`));
    return { ok: r.ok, out };
  }
  if (cmd === "summary") {
    const [file] = rest;
    if (!file) return { ok: false, out: ["用法：summary <file>"] };
    const s = summarize(readFileSync(resolve(root, file), "utf8"));
    return { ok: s.ok, out: [s.text, ...(s.failures ?? []).map((x) => `  ⚠ ${x}`)] };
  }
  return {
    ok: false,
    out: [
      "用法：node .harness/scripts/execution-plan.mjs <check [file…] | set <file> <node> <status> [--note \"…\"] | summary <file>>",
      `状态：${PLAN_STATUSES.map((s) => `${s.id}=${s.color}·${s.label}`).join("  ")}`,
    ],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { ok, out } = run(process.argv.slice(2));
    console.log(out.join("\n"));
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}
