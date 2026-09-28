#!/usr/bin/env node
/**
 * lint-work-stack-graph.mjs —— Work Stack v2 组合图与作者化进度的机械门控（#4534）
 *
 * 管的是什么：`requirements/work-stack-v2/` 是 Work Stack 的唯一需求权威（ADR-116）。
 * 它的「图先于正文」规则（AUTHORING-PROTOCOL.md）只有落成脚本才算落地：
 *
 * ── 判定 ─────────────────────────────────────────────────────────────
 *  ① 清单门：AUTHORING-TASK-MANIFEST.json 的实体集合 = S001–S200 / W001–W060 / D001–D060，
 *     且与 `counts` 一致、无重复。
 *  ② 覆盖门：每个 W 在 WORKFLOW-SKILL-MATRIX.md 恰有一行；每个 D 在
 *     DIGITALHUMAN-COMPOSITION-MATRIX.md 恰有一行；每行至少引用一个 Skill。
 *  ③ 闭合门：矩阵里引用的每个 S/W 都存在于清单。
 *  ④ 作者化门：`skills/ workflows/ digital-humans/` 下的实体文档文件名以清单 ID 开头；
 *     已作者化的 Skill 必须在图上有消费者（协议：没有 workflow/role 消费者的 Skill 判失败）；
 *     `reviews/<ID>.review.md` 必须有合法 verdict，且对应实体文档存在。
 *
 * 只报告、不判红：图上没有消费者、也还没作者化的 Skill（孤儿）——这是待人类/作者决定的
 * 目录修订输入（新增消费者 / 合并 / 删除），列出来，不阻塞。
 *
 * 进度（`--summary`）从 reviews/ 目录派生，不另存状态（同一事实不得声明在两处）。
 *
 * ── 空集防线 ─────────────────────────────────────────────────────────
 *  清单或任一矩阵读不到 / 解析出 0 行 ⇒ 红，不是跳过。
 *
 * 用法：pnpm run lint:work-stack-graph            # 门控
 *       pnpm run lint:work-stack-graph -- --summary # 另打印作者化进度
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PACKAGE_DIR = join("requirements", "work-stack-v2");
export const ENTITY_DIRS = { S: "skills", W: "workflows", D: "digital-humans" };
export const EXPECTED = { S: 200, W: 60, D: 60 };
export const VERDICTS = ["PASS", "REWRITE", "SPLIT", "MERGE", "DELETE"];

const ID_RE = /\b([SWD])(\d{3})\b/g;

/** 解析 markdown 表格：返回 { id, cells } 行，id 取第一列。 */
export function parseMatrix(text, prefix) {
  const rows = [];
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    if (new RegExp(`^${prefix}\\d{3}$`).test(cells[1])) rows.push({ id: cells[1], cells });
  }
  return rows;
}

export function refs(cell, prefix) {
  return [...cell.matchAll(ID_RE)].filter((m) => m[1] === prefix).map((m) => m[0]);
}

export function parseVerdict(text) {
  const m = text.match(/^\s*(?:\*\*)?verdict(?:\*\*)?\s*[:：]\s*(?:\*\*)?([A-Z]+)/im);
  return m && VERDICTS.includes(m[1]) ? m[1] : null;
}

export function lint(root = ROOT) {
  const errors = [];
  const dir = join(root, PACKAGE_DIR);
  const read = (f) => {
    const p = join(dir, f);
    if (!existsSync(p)) { errors.push(`缺少 ${PACKAGE_DIR}/${f}`); return null; }
    return readFileSync(p, "utf8");
  };

  // ① 清单门
  const manifestText = read("AUTHORING-TASK-MANIFEST.json");
  const ids = new Set();
  if (manifestText) {
    const manifest = JSON.parse(manifestText);
    const tasks = manifest.authorTaskIds ?? [];
    if (tasks.length === 0) errors.push("清单 authorTaskIds 为空");
    for (const t of tasks) {
      if (ids.has(t.entity)) errors.push(`清单重复实体 ${t.entity}`);
      ids.add(t.entity);
    }
    const c = manifest.counts ?? {};
    const declared = { S: c.skills, W: c.workflows, D: c.digitalHumans };
    for (const [p, n] of Object.entries(EXPECTED)) {
      const actual = [...ids].filter((i) => i[0] === p).length;
      if (actual !== n || declared[p] !== n) errors.push(`${p} 实体数：清单 ${actual}，counts ${declared[p]}，应为 ${n}`);
      for (let i = 1; i <= n; i++) {
        const id = `${p}${String(i).padStart(3, "0")}`;
        if (!ids.has(id)) errors.push(`清单缺少 ${id}`);
      }
    }
  }

  // ② 覆盖门 + ③ 闭合门
  const consumers = new Map(); // S -> Set(W|D)
  const addConsumer = (s, by) => { if (!consumers.has(s)) consumers.set(s, new Set()); consumers.get(s).add(by); };
  const checkRows = (rows, prefix, file, skillCol, wfCol) => {
    if (rows.length === 0) { errors.push(`${file} 解析出 0 行`); return; }
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.id)) errors.push(`${file} 重复行 ${r.id}`);
      seen.add(r.id);
      const skills = refs(r.cells[skillCol] ?? "", "S");
      if (skills.length === 0) errors.push(`${file} ${r.id} 没有引用任何 Skill`);
      for (const s of skills) { if (!ids.has(s)) errors.push(`${file} ${r.id} 引用不存在的 ${s}`); addConsumer(s, r.id); }
      if (wfCol != null) for (const w of refs(r.cells[wfCol] ?? "", "W")) if (!ids.has(w)) errors.push(`${file} ${r.id} 引用不存在的 ${w}`);
    }
    for (let i = 1; i <= EXPECTED[prefix]; i++) {
      const id = `${prefix}${String(i).padStart(3, "0")}`;
      if (!seen.has(id)) errors.push(`${file} 缺少 ${id} 的行`);
    }
  };
  const wText = read("WORKFLOW-SKILL-MATRIX.md");
  if (wText) checkRows(parseMatrix(wText, "W"), "W", "WORKFLOW-SKILL-MATRIX.md", 4, null);
  const dText = read("DIGITALHUMAN-COMPOSITION-MATRIX.md");
  const gaps = [];
  if (dText) {
    const rows = parseMatrix(dText, "D");
    checkRows(rows, "D", "DIGITALHUMAN-COMPOSITION-MATRIX.md", 4, 3);
    for (const r of rows) if (r.cells[5] && !/^[—-]?$/.test(r.cells[5])) gaps.push(r.id);
  }

  // ④ 作者化门
  const authored = new Map(); // id -> relative path
  for (const [p, sub] of Object.entries(ENTITY_DIRS)) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith(".md")) continue;
      const id = f.slice(0, 4);
      if (id[0] !== p || !ids.has(id)) { errors.push(`${sub}/${f} 文件名不以本目录的清单 ID 开头`); continue; }
      if (authored.has(id)) errors.push(`${id} 有多份实体文档`);
      authored.set(id, `${sub}/${f}`);
      if (p === "S" && !consumers.has(id)) errors.push(`${sub}/${f}：Skill 在组合图上没有 workflow/role 消费者（协议判失败）`);
    }
  }
  const verdicts = new Map();
  const rDir = join(dir, "reviews");
  if (existsSync(rDir)) {
    for (const f of readdirSync(rDir)) {
      if (!f.endsWith(".review.md")) continue;
      const id = f.slice(0, 4);
      if (!ids.has(id)) { errors.push(`reviews/${f} 不对应清单实体`); continue; }
      if (!authored.has(id)) errors.push(`reviews/${f} 对应的实体文档不存在`);
      const v = parseVerdict(readFileSync(join(rDir, f), "utf8"));
      if (!v) errors.push(`reviews/${f} 缺少合法 verdict（${VERDICTS.join(" / ")}）`);
      else verdicts.set(id, v);
    }
  }

  const orphans = [...ids].filter((i) => i[0] === "S" && !consumers.has(i) && !authored.has(i)).sort();
  return { errors, ids, authored, verdicts, orphans, gaps };
}

function summary({ ids, authored, verdicts, orphans, gaps }) {
  const lines = [];
  for (const p of ["S", "W", "D"]) {
    const all = [...ids].filter((i) => i[0] === p);
    const a = all.filter((i) => authored.has(i)).length;
    const pass = all.filter((i) => verdicts.get(i) === "PASS").length;
    lines.push(`${p}: ${all.length} 个｜已作者化 ${a}｜评审 PASS ${pass}`);
  }
  const other = [...verdicts].filter(([, v]) => v !== "PASS");
  if (other.length) lines.push(`非 PASS 评审：${other.map(([i, v]) => `${i}=${v}`).join(", ")}`);
  lines.push(`DigitalHuman 有 skillGaps：${gaps.length} 个（${gaps.join(", ")}）`);
  lines.push(`组合图上无消费者的 Skill（待目录修订，不阻塞）：${orphans.length} 个（${orphans.join(", ")}）`);
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = lint();
  if (process.argv.includes("--summary")) console.log(summary(result));
  if (result.errors.length) {
    console.error(`✗ Work Stack 组合图 / 作者化门控失败（${result.errors.length}）：`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`✓ Work Stack v2 组合图闭合：${result.ids.size} 个实体，已作者化 ${result.authored.size}，已评审 ${result.verdicts.size}`);
}
