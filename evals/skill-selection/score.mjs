#!/usr/bin/env node
/**
 * score.mjs —— 技能入选标准的计分、校验与报告生成。
 *
 * 标准的含义与锚点：docs/proposals/PROP-EXPERT-COMMUNITY-001-skill-selection-standard.md
 * 数值（权重、阈值、枚举）：rubric.json —— 本脚本不硬编码任何权重或阈值。
 *
 * 用法：
 *   node evals/skill-selection/score.mjs            # 校验 + 生成 REPORT.md 与 ranking.csv
 *   node evals/skill-selection/score.mjs --check    # 只校验，有错误则非零退出
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const CHECK_ONLY = process.argv.includes("--check");
const rubric = JSON.parse(readFileSync(join(DIR, "rubric.json"), "utf8"));
const packages = JSON.parse(readFileSync(join(DIR, "packages.json"), "utf8"));

const VALUE_DIMS = Object.keys(rubric.value_dims);
const RATED_VALUE_DIMS = VALUE_DIMS.filter((d) => rubric.value_dims[d].source !== "packages.json");
const READY_DIMS = Object.keys(rubric.readiness_dims);
const RATED_DIMS = [...RATED_VALUE_DIMS, ...READY_DIMS];
const CAPS = rubric.capabilities;
const EXPERTS = ["product", "legal", "finance", "marketing", "seo", "sales", "hr", "support", "data", "ops", "exec", "research", "engineering", "other"];

// ---------- 读取 ----------
function readJsonl(file) {
  const rows = [];
  const errors = [];
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try { rows.push({ ...JSON.parse(line), _file: file.split("/").pop(), _line: i + 1 }); }
    catch (e) { errors.push(`${file.split("/").pop()}:${i + 1} 不是合法 JSON`); }
  });
  return { rows, errors };
}
function loadDir(sub) {
  const d = join(DIR, sub);
  if (!existsSync(d)) return { rows: [], errors: [] };
  const out = { rows: [], errors: [] };
  for (const f of readdirSync(d).filter((f) => f.endsWith(".jsonl")).sort()) {
    const r = readJsonl(join(d, f));
    out.rows.push(...r.rows);
    out.errors.push(...r.errors);
  }
  return out;
}

// ---------- 校验 ----------
function validate(rows, label) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  for (const r of rows) {
    const at = `${label} ${r._file}:${r._line} ${r.id ?? "(无 id)"}`;
    if (!r.id) { errors.push(`${at} 缺 id`); continue; }
    if (seen.has(r.id)) errors.push(`${at} id 重复（先出现于 ${seen.get(r.id)}）`);
    seen.set(r.id, `${r._file}:${r._line}`);
    if (!packages[r.package]) errors.push(`${at} package 不在 packages.json：${r.package}`);
    for (const g of rubric.gates) {
      if (!rubric.gate_values.includes(r.gates?.[g])) errors.push(`${at} 门 ${g} 取值非法：${r.gates?.[g]}`);
    }
    for (const d of RATED_DIMS) {
      const s = r.scores?.[d];
      if (!Number.isInteger(s) || s < 0 || s > 5) errors.push(`${at} 分数 ${d} 非 0–5 整数：${s}`);
      if (!r.evidence?.[d] || !String(r.evidence[d]).trim()) errors.push(`${at} 缺证据 ${d}`);
    }
    for (const c of r.capabilities ?? []) if (!CAPS[c]) errors.push(`${at} 能力取值非法：${c}`);
    for (const e of r.experts ?? []) if (!EXPERTS.includes(e)) warnings.push(`${at} experts 取值不在枚举：${e}`);
    if (!rubric.recommendations.includes(r.recommendation)) errors.push(`${at} recommendation 非法：${r.recommendation}`);
    if (!rubric.evidence_levels.includes(r.evidence_level)) errors.push(`${at} evidence_level 非法：${r.evidence_level}`);
    if (!rubric.confidence.includes(r.confidence)) errors.push(`${at} confidence 非法：${r.confidence}`);
    if (!r.job_family) warnings.push(`${at} 缺 job_family`);
    const lic = packages[r.package]?.license;
    if (lic && !rubric.license_allowlist.includes(lic) && r.gates?.G1 === "pass") {
      errors.push(`${at} 包许可 ${lic} 不在白名单，但 G1 标为 pass`);
    }
  }
  return { errors, warnings };
}

// ---------- 计分 ----------
function weights(overrides = {}) {
  const w = {};
  for (const d of VALUE_DIMS) w[d] = rubric.value_dims[d].weight * (overrides[rubric.value_dims[d].group] ?? 1);
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  for (const d of VALUE_DIMS) w[d] = (w[d] / sum) * 100;
  return w;
}
const BASE_W = weights();
function scoreOf(r, w = BASE_W) {
  const pkg = packages[r.package] ?? {};
  const s = { ...r.scores, H1: pkg.H1 ?? 0, H2: pkg.H2 ?? 0 };
  const V = VALUE_DIMS.reduce((a, d) => a + (w[d] * (s[d] ?? 0)) / 5, 0);
  const R = READY_DIMS.reduce((a, d) => a + (rubric.readiness_dims[d].weight * (s[d] ?? 0)) / 5, 0);
  return { V, R };
}
function gateFail(r) { return rubric.gates.some((g) => r.gates?.[g] === "fail"); }
const TIER_ORDER = ["A", "B", "C", "D"];
function tierOf(r, V) {
  if (gateFail(r)) return "D";
  let t = V >= rubric.tiers.A ? "A" : V >= rubric.tiers.B ? "B" : V >= rubric.tiers.C ? "C" : "D";
  for (const cap of rubric.tier_caps ?? []) {
    if ((r.scores?.[cap.dim] ?? 99) <= cap.max_score && TIER_ORDER.indexOf(t) < TIER_ORDER.indexOf(cap.max_tier)) t = cap.max_tier;
  }
  return t;
}
function nearBoundary(V) {
  return [rubric.tiers.A, rubric.tiers.B, rubric.tiers.C].some((t) => Math.abs(V - t) <= (rubric.boundary_band ?? 0));
}
function capped(r, V) {
  return !gateFail(r) && tierOf(r, V) !== (V >= rubric.tiers.A ? "A" : V >= rubric.tiers.B ? "B" : V >= rubric.tiers.C ? "C" : "D");
}
function waveOf(r, tier, R) {
  if (tier !== "A" && tier !== "B") return "—";
  const r1 = r.scores.R1;
  const w = rubric.waves;
  if (r1 >= w.W1_min_R1) return R >= w.W1_min_R ? "W1" : "W2";
  if (r1 >= w.W2_min_R1) return "W2";
  return "W3";
}
function capWave(r) {
  const order = { W1: 1, W2: 2, W3: 3 };
  let m = 1;
  for (const c of r.capabilities ?? []) m = Math.max(m, order[CAPS[c]?.wave] ?? 1);
  return ["", "W1", "W2", "W3"][m];
}

// ---------- 主流程 ----------
const main = loadDir("scores");
const cal = loadDir("calibration");   // 随机分层抽样的盲评：用于一致性检验，也参与共识分
const cons = loadDir("consensus");    // 边界带补评：只用于共识定层，不混进随机样本的一致性统计
const v1 = validate(main.rows, "scores");
const v2 = validate(cal.rows, "calibration");
const v3 = validate(cons.rows, "consensus");
const errors = [...main.errors, ...cal.errors, ...cons.errors, ...v1.errors, ...v2.errors, ...v3.errors];
const warnings = [...v1.warnings, ...v2.warnings, ...v3.warnings];

if (CHECK_ONLY) {
  for (const e of errors) console.error("✗ " + e);
  for (const w of warnings) console.warn("⚠ " + w);
  console.log(`scores ${main.rows.length} 行，calibration ${cal.rows.length} 行，consensus ${cons.rows.length} 行；错误 ${errors.length}，警告 ${warnings.length}`);
  process.exit(errors.length ? 1 : 0);
}

const valid0 = main.rows.filter((r) => RATED_DIMS.every((d) => Number.isInteger(r.scores?.[d])));
// 共识分：calibration/ 里有第二评审的 skill，逐维取两人平均；门取更严者。
// 一致性检验用的是原始的独立打分（见 pairs），不受这里影响。
const second = new Map([...cal.rows, ...cons.rows].filter((c) => RATED_DIMS.every((d) => Number.isInteger(c.scores?.[d]))).map((c) => [c.id, c]));
const GATE_RANK = { pass: 0, fixable: 1, fail: 2 };
const valid = valid0.map((r) => {
  const b = second.get(r.id);
  if (!b) return { ...r, _raters: 1 };
  const scores = Object.fromEntries(RATED_DIMS.map((d) => [d, (r.scores[d] + b.scores[d]) / 2]));
  const gates = { ...r.gates };
  for (const g of rubric.gates) if ((GATE_RANK[b.gates?.[g]] ?? 0) > (GATE_RANK[r.gates?.[g]] ?? 0)) gates[g] = b.gates[g];
  return { ...r, scores, gates, _raters: 2, _first: r };
});
const ranked = valid.map((r) => {
  const { V, R } = scoreOf(r);
  const tier = tierOf(r, V);
  return { r, V, R, tier, wave: waveOf(r, tier, R), capWave: capWave(r) };
}).sort((a, b) => b.V - a.V);

// 敏感性：每组权重 ±20%
const groups = [...new Set(VALUE_DIMS.map((d) => rubric.value_dims[d].group))];
const sens = [];
for (const g of groups) for (const sign of [1, -1]) {
  const w = weights({ [g]: 1 + sign * rubric.sensitivity.perturb });
  const changed = ranked.filter((x) => tierOf(x.r, scoreOf(x.r, w).V) !== x.tier).length;
  sens.push({ g, sign, changed, ratio: ranked.length ? changed / ranked.length : 0 });
}
const maxSens = Math.max(0, ...sens.map((s) => s.ratio));

// 一致性：第二评审员 vs 主评审员
const byId = new Map(valid0.map((r) => [r.id, r]));
const pairs = cal.rows.filter((c) => byId.has(c.id) && RATED_DIMS.every((d) => Number.isInteger(c.scores?.[d])))
  .map((c) => ({ a: byId.get(c.id), b: c }));
const dimDiff = Object.fromEntries(RATED_DIMS.map((d) => [d, pairs.length ? pairs.reduce((s, p) => s + Math.abs(p.a.scores[d] - p.b.scores[d]), 0) / pairs.length : NaN]));
const tierAgree = pairs.length ? pairs.filter((p) => tierOf(p.a, scoreOf(p.a).V) === tierOf(p.b, scoreOf(p.b).V)).length / pairs.length : NaN;
const outside = pairs.filter((p) => !nearBoundary(scoreOf(p.a).V) && !nearBoundary(scoreOf(p.b).V));
const tierAgreeOut = outside.length ? outside.filter((p) => tierOf(p.a, scoreOf(p.a).V) === tierOf(p.b, scoreOf(p.b).V)).length / outside.length : NaN;
const adjAgree = pairs.length ? pairs.filter((p) => Math.abs(TIER_ORDER.indexOf(tierOf(p.a, scoreOf(p.a).V)) - TIER_ORDER.indexOf(tierOf(p.b, scoreOf(p.b).V))) <= 1).length / pairs.length : NaN;
const disagreements = pairs.filter((p) => tierOf(p.a, scoreOf(p.a).V) !== tierOf(p.b, scoreOf(p.b).V));
const consPairs = cons.rows.filter((c) => byId.has(c.id) && RATED_DIMS.every((d) => Number.isInteger(c.scores?.[d]))).map((c) => ({ a: byId.get(c.id), b: c }));
const consDiff = consPairs.length ? RATED_DIMS.reduce((s, d) => s + consPairs.reduce((t, p) => t + Math.abs(p.a.scores[d] - p.b.scores[d]), 0) / consPairs.length, 0) / RATED_DIMS.length : NaN;
const consVDiff = consPairs.length ? consPairs.reduce((s, p) => s + Math.abs(scoreOf(p.a).V - scoreOf(p.b).V), 0) / consPairs.length : NaN;
const recAgree = pairs.length ? pairs.filter((p) => p.a.recommendation === p.b.recommendation).length / pairs.length : NaN;
const vDiff = pairs.length ? pairs.reduce((s, p) => s + Math.abs(scoreOf(p.a).V - scoreOf(p.b).V), 0) / pairs.length : NaN;
const overallDiff = pairs.length ? RATED_DIMS.reduce((s, d) => s + dimDiff[d], 0) / RATED_DIMS.length : NaN;

// 能力拉动：非 W1 能力挡住的 A/B 层价值
const pull = {};
for (const x of ranked.filter((x) => x.tier === "A" || x.tier === "B")) {
  for (const c of x.r.capabilities ?? []) {
    if (CAPS[c]?.wave === "W1") continue;
    pull[c] ??= { V: 0, n: 0, A: 0 };
    pull[c].V += x.V; pull[c].n += 1; if (x.tier === "A") pull[c].A += 1;
  }
}

// 同职能族候选合并组（跨来源包的才列）
const fam = {};
for (const x of ranked.filter((x) => x.tier === "A" || x.tier === "B")) {
  const f = x.r.job_family || "（未标）";
  (fam[f] ??= []).push(x);
}
const mergeGroups = Object.entries(fam)
  .filter(([, xs]) => new Set(xs.map((x) => x.r.package.split("#")[0])).size > 1)
  .sort((a, b) => b[1].length - a[1].length);

// ---------- 输出 ----------
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "—");
const pct = (n) => (Number.isFinite(n) ? (n * 100).toFixed(0) + "%" : "—");
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const count = (xs, k) => xs.reduce((m, x) => ((m[k(x)] = (m[k(x)] ?? 0) + 1), m), {});
const L = [];
L.push("# 技能入选评审报告（自动生成）", "");
L.push(`> 由 \`evals/skill-selection/score.mjs\` 生成，**不要手改**。标准：\`docs/proposals/PROP-EXPERT-COMMUNITY-001-skill-selection-standard.md\`；权重与阈值：\`rubric.json\` v${rubric.version}。`, "");
L.push(`评审 ${ranked.length} 个 skill（校验错误 ${errors.length}，警告 ${warnings.length}）。`, "");

L.push("## 1. 权重与阈值（来自 rubric.json）", "");
L.push("| 组 | 维度 | 权重 |", "|---|---|---|");
for (const d of VALUE_DIMS) L.push(`| ${rubric.value_dims[d].group} | ${d} ${rubric.value_dims[d].name} | ${rubric.value_dims[d].weight} |`);
L.push("", `就绪分 R：${READY_DIMS.map((d) => `${d} ${rubric.readiness_dims[d].name} ${rubric.readiness_dims[d].weight}`).join("，")}。`);
L.push(`层级阈值：A ≥ ${rubric.tiers.A}，B ≥ ${rubric.tiers.B}，C ≥ ${rubric.tiers.C}；边界带 ±${rubric.boundary_band}；客群上限：${(rubric.tier_caps ?? []).map((c) => `${c.dim} ≤ ${c.max_score} 时最高 ${c.max_tier} 层`).join("；")}。`, `波次：R1 ≥ ${rubric.waves.W1_min_R1} 且 R ≥ ${rubric.waves.W1_min_R} → W1；R1 ≥ ${rubric.waves.W2_min_R1} → W2；其余 W3。`, "");

L.push("## 2. 总览", "");
const tiers = count(ranked, (x) => x.tier);
L.push(`层级：A ${tiers.A ?? 0} · B ${tiers.B ?? 0} · C ${tiers.C ?? 0} · D ${tiers.D ?? 0}`, "");
const bandAB = ranked.filter((x) => !gateFail(x.r) && x.r._raters < 2 && Math.abs(x.V - rubric.tiers.A) <= rubric.boundary_band);
const consensusN = ranked.filter((x) => x.r._raters === 2).length;
const cappedN = ranked.filter((x) => capped(x.r, x.V)).length;
L.push(`双人共识定层 ${consensusN} 个；仍待定（单人评分且 V 在 A 阈值 ±${rubric.boundary_band} 分内，需第二评审或实测评测）${bandAB.length} 个；客群上限压层 ${cappedN} 个。`, "");
const waves = count(ranked.filter((x) => x.tier === "A"), (x) => x.wave);
L.push(`A 层波次：W1 ${waves.W1 ?? 0} · W2 ${waves.W2 ?? 0} · W3 ${waves.W3 ?? 0}`, "");
L.push("| 来源包 | 评审数 | A | B | C | D | V 中位数 |", "|---|---|---|---|---|---|---|");
const byPkg = {};
for (const x of ranked) (byPkg[x.r.package] ??= []).push(x);
for (const [p, xs] of Object.entries(byPkg).sort((a, b) => b[1].length - a[1].length)) {
  const t = count(xs, (x) => x.tier);
  const vs = xs.map((x) => x.V).sort((a, b) => a - b);
  L.push(`| ${p} | ${xs.length} | ${t.A ?? 0} | ${t.B ?? 0} | ${t.C ?? 0} | ${t.D ?? 0} | ${f1(vs[Math.floor(vs.length / 2)])} |`);
}
L.push("");

L.push("## 3. 标准自检", "");
L.push("### 3.1 评审员一致性（独立盲评）", "");
if (!pairs.length) L.push("尚无第二评审员数据。", "");
else {
  const c = rubric.calibration;
  const ok = (b) => (b ? "✅" : "❌");
  L.push(`配对样本 ${pairs.length} 个。`, "");
  L.push(`- 每维平均绝对差（均值）${overallDiff.toFixed(2)}（合格线 ≤ ${c.max_mean_abs_diff}）${ok(overallDiff <= c.max_mean_abs_diff)}`);
  L.push(`- 边界带（阈值 ±${rubric.boundary_band}）外的层级一致率 ${pct(tierAgreeOut)}，样本 ${outside.length} 个（合格线 ≥ ${pct(c.min_tier_agreement_outside_band)}）${ok(tierAgreeOut >= c.min_tier_agreement_outside_band)}`);
  L.push(`- 相邻层级一致率（相差不超过一层）${pct(adjAgree)}（合格线 ≥ ${pct(c.min_adjacent_tier_agreement)}）${ok(adjAgree >= c.min_adjacent_tier_agreement)}`);
  L.push(`- 参考：全体层级一致率 ${pct(tierAgree)}；V 平均差 ${f1(vDiff)} 分；建议一致率 ${pct(recAgree)}`, "");
  if (disagreements.length) {
    L.push("层级不一致的配对（第一评审 / 第二评审）：", "", "| id | 第一评审 | 第二评审 | 在边界带内 |", "|---|---|---|---|");
    for (const p of disagreements) { const va = scoreOf(p.a).V, vb = scoreOf(p.b).V; L.push(`| ${esc(p.a.id)} | ${tierOf(p.a, va)} ${f1(va)} | ${tierOf(p.b, vb)} ${f1(vb)} | ${nearBoundary(va) || nearBoundary(vb) ? "是" : "否"} |`); }
    L.push("");
  }
  L.push("| 维度 | 平均绝对差 |", "|---|---|");
  for (const d of RATED_DIMS.slice().sort((a, b) => dimDiff[b] - dimDiff[a])) L.push(`| ${d} | ${dimDiff[d].toFixed(2)}${dimDiff[d] > rubric.calibration.max_mean_abs_diff ? " ⚠" : ""} |`);
  L.push("");
}
if (consPairs.length) {
  L.push("### 3.1b 边界带补评（不计入上面的随机样本统计）", "");
  L.push(`补评 ${consPairs.length} 个（第一评审 V 在 A 阈值 ±${rubric.boundary_band} 内）。每维平均绝对差 ${consDiff.toFixed(2)}；V 平均差 ${f1(consVDiff)} 分。这些 skill 的层级以两人逐维平均的共识分为准。`, "");
}
L.push("### 3.2 权重敏感性（各组权重 ±20%）", "");
L.push("| 组 | 扰动 | 层级改变的 skill | 比例 |", "|---|---|---|---|");
for (const s of sens) L.push(`| ${s.g} | ${s.sign > 0 ? "+" : "−"}${rubric.sensitivity.perturb * 100}% | ${s.changed} | ${pct(s.ratio)} |`);
L.push("", `最大比例 ${pct(maxSens)}（合格线 ≤ ${pct(rubric.sensitivity.max_tier_change_ratio)}）${maxSens <= rubric.sensitivity.max_tier_change_ratio ? "✅ 结论对权重不敏感" : "❌ 结论依赖权重拍板，需人类确认权重"}。`, "");

L.push("## 4. 能力拉动（按被挡住的 A/B 层价值排序）", "");
L.push("| 能力 | 计划波次 | 依赖它的 A/B 层 skill 数（其中 A 层） | 拉动值（V 之和） |", "|---|---|---|---|");
for (const [c, p] of Object.entries(pull).sort((a, b) => b[1].V - a[1].V)) L.push(`| ${c} ${CAPS[c].name} | ${CAPS[c].wave} | ${p.n}（${p.A}） | ${p.V.toFixed(0)} |`);
L.push("");

const row = (x) => `| ${esc(x.r.id)}${x.r._raters === 2 ? " ●" : Math.abs(x.V - rubric.tiers.A) <= rubric.boundary_band ? " ◐" : ""} | ${f1(x.V)} | ${f1(x.R)} | ${x.wave} | ${esc(x.r.job_family)} | ${esc(x.r.recommendation)} | ${esc(x.r.one_liner)} |`;
const head = ["| id | V | R | 波次 | 职能族 | 建议 | 一句话 |", "|---|---|---|---|---|---|---|"];
L.push(`● = 双人共识分；◐ = 单人评分且 V 在 A 阈值 ±${rubric.boundary_band} 分的边界带内，层级待第二评审或评测确认。`, "");
L.push("## 5. A 层：核心入选", "", ...head, ...ranked.filter((x) => x.tier === "A").map(row), "");
L.push("## 6. B 层：候选（以实验身份进社区，评测证明后升级）", "", ...head, ...ranked.filter((x) => x.tier === "B").map(row), "");

L.push("## 7. 按专家智能体的 A 层构成", "");
const byExpert = {};
for (const x of ranked.filter((x) => x.tier === "A")) for (const e of x.r.experts ?? []) (byExpert[e] ??= []).push(x);
for (const [e, xs] of Object.entries(byExpert).sort((a, b) => b[1].length - a[1].length)) {
  L.push(`- **${e}**（${xs.length}）：${xs.slice(0, 12).map((x) => `${x.r.id}（${f1(x.V)}）`).join("、")}${xs.length > 12 ? " …" : ""}`);
}
L.push("");

L.push("## 8. 同职能族候选合并组（跨来源包，需人工确认是否真重复）", "");
if (!mergeGroups.length) L.push("无。", "");
for (const [f, xs] of mergeGroups) L.push(`- **${esc(f)}**：${xs.map((x, i) => `${i === 0 ? "★" : ""}${x.r.id}（${x.tier} ${f1(x.V)}）`).join("、")}`);
L.push("", "★ = 该族 V 最高者，建议作为规范版本。", "");

L.push("## 9. 硬门未通过", "");
const failed = ranked.filter((x) => gateFail(x.r));
if (!failed.length) L.push("无。", "");
else {
  L.push("| id | 未过的门 | 说明 |", "|---|---|---|");
  for (const x of failed) L.push(`| ${esc(x.r.id)} | ${rubric.gates.filter((g) => x.r.gates[g] === "fail").join("、")} | ${esc(x.r.gates.note)} |`);
  L.push("");
}
const fixable = ranked.filter((x) => !gateFail(x.r) && rubric.gates.some((g) => x.r.gates[g] === "fixable"));
L.push(`可修复（fixable）${fixable.length} 个，改写时处理。`, "");

L.push("## 10. 数据质量", "");
const lowConf = ranked.filter((x) => x.r.confidence === "low").length;
const e1 = ranked.filter((x) => x.r.evidence_level === "E1").length;
const waveMismatch = ranked.filter((x) => x.wave !== "—" && x.wave !== x.capWave).length;
L.push(`- 低置信度 ${lowConf} 个；仅 E1 证据 ${e1} 个（A 层要求 ≥ E2）。`);
L.push(`- R1 推出的波次与 capabilities 推出的波次不一致：${waveMismatch} 个（说明连接器"可选有降级"，按降级后能力判了更早的波次）。`);
L.push(`- 校验错误 ${errors.length}，警告 ${warnings.length}。`, "");
for (const e of errors.slice(0, 50)) L.push(`  - ✗ ${esc(e)}`);

writeFileSync(join(DIR, "REPORT.md"), L.join("\n") + "\n");
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const cols = ["id", "package", "domain", "job_family", "tier", "V", "R", "wave", "raters", "recommendation", ...RATED_DIMS, "H1", "H2", "G1", "G2", "G3", "G4", "capabilities", "experts", "evidence_level", "confidence", "one_liner"];
const csv = [cols.join(",")];
for (const x of ranked) {
  const p = packages[x.r.package] ?? {};
  csv.push([x.r.id, x.r.package, x.r.domain, x.r.job_family, x.tier, x.V.toFixed(1), x.R.toFixed(1), x.wave, x.r._raters, x.r.recommendation,
    ...RATED_DIMS.map((d) => x.r.scores[d]), p.H1, p.H2, ...rubric.gates.map((g) => x.r.gates[g]),
    (x.r.capabilities ?? []).join(" "), (x.r.experts ?? []).join(" "), x.r.evidence_level, x.r.confidence, x.r.one_liner].map(csvCell).join(","));
}
writeFileSync(join(DIR, "ranking.csv"), "﻿" + csv.join("\n") + "\n");
console.log(`评审 ${ranked.length}：A ${tiers.A ?? 0} / B ${tiers.B ?? 0} / C ${tiers.C ?? 0} / D ${tiers.D ?? 0}；错误 ${errors.length}；一致性样本 ${pairs.length}；敏感性最大 ${pct(maxSens)}`);
if (errors.length) process.exitCode = 1;
