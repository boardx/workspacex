#!/usr/bin/env node
'use strict';
/**
 * render.cjs — valuation.json（calc.cjs 输出）→ 固定 8 页 A4 PDF（Requirement V0.5 §11）。
 *
 * 用法：node render.cjs <valuation.json> <out.pdf> [--font /path/to/cjk.otf|.ttf]
 * 字体解析：--font → $MAAU_REPORT_FONT → $SKILL_SANDBOX_CJK_FONT → /usr/share/fonts/workspacex/NotoSansSC-Common.otf
 * ⚠ 不要给 embedFont 传 { subset: true }（pdf-lib 对这份字体子集化会产出损坏的内嵌字体）。
 * 颜色语义（§12.3）：青绿 = 资产 M / 递归能力；橙 = Evidence / Value；深蓝 = Benchmark / 当前状态。
 * 所有金额措辞：Reference Value / Scenario Forecast / Benchmark Range。
 */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { formatValue } = require('./calc.cjs');

const PAGE = { w: 595.28, h: 841.89 };
const MARGIN = 40;
const CW = PAGE.w - MARGIN * 2;
const C = {
  ink: rgb(0.12, 0.14, 0.2), muted: rgb(0.42, 0.45, 0.52), faint: rgb(0.86, 0.88, 0.91), panel: rgb(0.955, 0.962, 0.972), white: rgb(1, 1, 1),
  teal: rgb(0.05, 0.55, 0.53), tealSoft: rgb(0.85, 0.95, 0.94),
  orange: rgb(0.9, 0.5, 0.12), orangeSoft: rgb(0.99, 0.93, 0.85),
  navy: rgb(0.12, 0.2, 0.42), navySoft: rgb(0.86, 0.9, 0.97),
  grey: rgb(0.6, 0.62, 0.66), red: rgb(0.75, 0.25, 0.22),
};
const FOOT = 'Reference Value / Scenario Forecast：基于静态 MAAU Canvas 与已披露 Benchmark 的可追溯估计，不是审计、公允价值或融资定价意见。';

function resolveFont(explicit) {
  const c = [explicit, process.env.MAAU_REPORT_FONT, process.env.SKILL_SANDBOX_CJK_FONT, '/usr/share/fonts/workspacex/NotoSansSC-Common.otf'].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  throw new Error(`No CJK font found. Tried: ${c.join(', ') || '(none)'}. Pass --font <single-face .otf/.ttf> or set MAAU_REPORT_FONT.`);
}
const f2 = (x, d = 2) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));

class Cv {
  constructor(page, font) { this.page = page; this.font = font; }
  w(t, s) { return this.font.widthOfTextAtSize(t, s); }
  text(x, y, t, o = {}) { const s = o.size || 9.5; let tx = x; if (o.align === 'center') tx = x - this.w(t, s) / 2; if (o.align === 'right') tx = x - this.w(t, s); this.page.drawText(String(t), { x: tx, y, size: s, font: this.font, color: o.color || C.ink }); }
  wrap(text, s, maxW) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '', word = '';
      const flush = () => { if (!word) return; if (this.w(line + word, s) > maxW && line) { lines.push(line); line = ''; } while (this.w(word, s) > maxW) { let cut = word.length; while (cut > 1 && this.w(word.slice(0, cut), s) > maxW) cut--; lines.push(line + word.slice(0, cut)); line = ''; word = word.slice(cut); } line += word; word = ''; };
      for (const ch of para) { if (/[A-Za-z0-9_./%+$,-]/.test(ch)) { word += ch; continue; } flush(); if (this.w(line + ch, s) > maxW && line) { lines.push(line); line = ch === ' ' ? '' : ch; } else line += ch; }
      flush(); lines.push(line);
    }
    return lines;
  }
  para(x, y, text, o = {}) { const s = o.size || 9; const lh = o.lh || s * 1.45; const lines = this.wrap(text, s, o.maxW || CW); const max = o.maxLines || Infinity; let yy = y; lines.slice(0, max).forEach((l, i) => { this.text(x, yy, i === max - 1 && lines.length > max ? l.replace(/.{2}$/, '…') : l, { size: s, color: o.color }); yy -= lh; }); return y - yy; }
  rect(x, y, w, h, o = {}) { this.page.drawRectangle({ x, y, width: w, height: h, color: o.fill, borderColor: o.stroke, borderWidth: o.stroke ? o.sw || 0.6 : 0 }); }
  line(x1, y1, x2, y2, o = {}) { this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: o.width || 0.6, color: o.color || C.faint, dashArray: o.dash }); }
  poly(pts, o) { for (let i = 1; i < pts.length; i++) this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], o); }
  dot(x, y, r, fill) { this.page.drawCircle({ x, y, size: r, color: fill }); }
}

function header(cv, d, n, title, sub) {
  const top = PAGE.h - MARGIN;
  cv.text(MARGIN, top - 4, `MAAU：${d.maau.name}`, { size: 8.5, color: C.muted });
  cv.text(PAGE.w - MARGIN, top - 4, `AI 原生递归资产与估值预测 · P${n}/8`, { size: 8.5, color: C.muted, align: 'right' });
  cv.text(MARGIN, top - 30, title, { size: 18, color: C.navy });
  if (sub) cv.text(MARGIN, top - 45, sub, { size: 9, color: C.muted });
  cv.line(MARGIN, MARGIN + 14, PAGE.w - MARGIN, MARGIN + 14);
  cv.text(MARGIN, MARGIN + 3, FOOT, { size: 6.5, color: C.muted });
  cv.text(PAGE.w - MARGIN, MARGIN - 6, `model ${d.valuationModelVersion} · ${d.calculationVersion} · benchmark_date ${d.disclosures.benchmark_date} · sources ${d.disclosures.source_count}`, { size: 6.5, color: C.muted, align: 'right' });
  return top - 62;
}
const label = (cv, x, y, t, color = C.navy) => { cv.text(x, y, t, { size: 10.5, color }); return y - 14; };
function tile(cv, x, y, w, h, l, v, o = {}) { cv.rect(x, y - h, w, h, { fill: o.fill || C.panel }); cv.text(x + 8, y - 14, l, { size: 7.5, color: C.muted }); cv.text(x + 8, y - h + 12, v, { size: o.size || 15, color: o.color || C.ink }); if (o.sub) cv.text(x + w - 6, y - h + 12, o.sub, { size: 6.5, color: C.muted, align: 'right' }); }
function bar(cv, x, y, w, h, v, color) { cv.rect(x, y, w, h, { fill: C.faint }); if (v > 0) cv.rect(x, y, w * Math.min(1, v), h, { fill: color }); }
const fmtV = (d, v) => formatValue(v, d.benchmark.mode);

/* P1 Venture Value Snapshot */
function p1(cv, d) {
  let y = header(cv, d, 1, '1 · Venture Value Snapshot', `${d.maau.archetype || '—'} · ${d.maau.stage || '—'} · ${d.maau.domain || '—'}  ·  Forecast Confidence：${d.confidence.level}`);
  const s = d.snapshot, tw = (CW - 24) / 4;
  [['M 递归资产（内部积累）', f2(s.M, 1), C.teal], ['γ 递归反馈（飞轮强度）', f2(s.gamma), C.teal], ['μ 耗散（资产风险）', `${f2(s.mu, 3)} ${d.recursive.muBand}`, C.teal], ['EI 证据（外部验证）', f2(s.EI), C.orange]].forEach(([l, v, c], i) => tile(cv, MARGIN + i * (tw + 8), y, tw, 52, l, v, { color: c, size: 14 }));
  y -= 62;
  [['V_seed 起点锚（Benchmark）', s.V_seedText, C.navy], ['V_now 当前（Observed）', s.V_nowText, C.orange], ['V_90d（Scenario · Base）', s.V_90dText, C.orange], ['V_12m（Scenario · Base）', s.V_12mText, C.orange]].forEach(([l, v, c], i) => tile(cv, MARGIN + i * (tw + 8), y, tw, 52, l, v, { color: c, size: 14, sub: d.benchmark.mode === 'index' ? 'Value Index' : 'USD' }));
  y -= 70;
  cv.rect(MARGIN, y - 58, CW, 62, { fill: C.orangeSoft });
  const wording = d.benchmark.mode === 'usd'
    ? `Base Reference Value ≈ ${s.V_nowText}；参考范围约 ${s.rangeNowText}。12 个月 Base 情景 ≈ ${s.V_12mText}（Conservative ${fmtV(d, d.forecast.horizons['12m'].conservative.value.base)} / Upside ${fmtV(d, d.forecast.horizons['12m'].upside.value.base)}）。`
    : `没有 ≥${d.config.minComparables} 个 A/B/C 级公开价值信号，本报告输出 Value Index（起点 100）而不硬造美元估值：当前 ${s.V_nowText}（= 100 × e^${f2(s.EI)}），12 个月 Base 情景 ${s.V_12mText}。补齐可用 Comparable 后同一份 JSON 会自动切换为美元区间。`;
  cv.para(MARGIN + 10, y - 12, wording, { size: 9.5, maxW: CW - 20, maxLines: 3 });
  y -= 76;
  y = label(cv, MARGIN, y, `结构判定：${d.recursive.stateLabel}（γ = ${f2(s.gamma)}）· 四象限：${d.quadrant.name}`);
  cv.para(MARGIN, y, `${d.vNow.note}｜置信度 ${d.confidence.level}：${d.confidence.reason}`, { size: 8.5, maxW: CW, maxLines: 3, color: C.muted });
  y -= 46;
  y = label(cv, MARGIN, y, '证据账本摘要');
  const cnt = d.ledger.counts, cw = (CW - 24) / 4;
  [['Observed（进 V_now）', cnt.observed, C.orange], ['Target（门槛）', cnt.target, C.grey], ['Planned（进 Forecast）', cnt.planned, C.navy], ['Assumption（风险）', cnt.assumption, C.grey]].forEach(([l, v, c], i) => tile(cv, MARGIN + i * (cw + 8), y, cw, 44, l, String(v), { color: c, size: 14 }));
  y -= 60;
  y = label(cv, MARGIN, y, '接下来必须成真的事实（Top 3）');
  d.milestones.list.slice(0, 3).forEach((m) => { cv.dot(MARGIN + 3, y + 3, 2, C.navy); y -= cv.para(MARGIN + 10, y, `${m.horizon} · ${m.level} ${m.levelLabel}（EI ${f2(m.ei)} × P ${f2(m.probability)}）：${m.statement}`, { size: 8.5, maxW: CW - 10, maxLines: 2 }) + 2; });
  if (!d.milestones.list.length) cv.text(MARGIN, y, 'Canvas 里没有 Planned Validation：无法给出预测里程碑。', { size: 8.5, color: C.muted });
}

/* P2 Two Engines */
function p2(cv, d) {
  let y = header(cv, d, 2, '2 · Two Engines：内部资产 × 外部价值', '左：dM/dt 内部递归资产；右：V(t) 外部验证价值；中间：Asset → Better Validation');
  const r = d.recursive, half = (CW - 40) / 2, lx = MARGIN, rx = MARGIN + half + 40;
  cv.rect(lx, y - 300, half, 300, { fill: C.tealSoft }); cv.rect(rx, y - 300, half, 300, { fill: C.orangeSoft });
  cv.text(lx + 10, y - 18, '内部发动机 M', { size: 12, color: C.teal }); cv.text(rx + 10, y - 18, '外部发动机 V', { size: 12, color: C.orange });
  cv.text(lx + 10, y - 36, 'dM/dt = λρ · C^α · H^β · M^γ - μM', { size: 9.5 }); cv.text(rx + 10, y - 36, 'V(t) = V_seed · e^(∫ EI(s) ds)', { size: 9.5 });
  const rows = [['λ 沉淀率', r.lambda], ['ρ 复用/生态率', r.rho], ['C 系统能力', r.C], ['H 人机协作', r.H], ['γ 递归反馈', r.gamma / 1.5], ['μ 衰减率', r.mu]];
  let ly = y - 58;
  rows.forEach(([l, v], i) => { const val = i === 4 ? r.gamma : v; cv.text(lx + 10, ly, l, { size: 8 }); bar(cv, lx + 90, ly - 1, half - 140, 7, v, C.teal); cv.text(lx + half - 8, ly, f2(val, i === 4 ? 2 : 2), { size: 8, align: 'right' }); ly -= 18; });
  ly -= 4;
  cv.text(lx + 10, ly, `Λ = λρ·C^α·H^β = ${f2(r.Lambda, 3)}（α=${r.alpha}，β=${r.beta}）`, { size: 8 }); ly -= 14;
  cv.text(lx + 10, ly, `增长项 Λ·M^γ = ${f2(r.growthTerm, 3)}   耗散项 μ·M = ${f2(r.decayTerm, 3)}`, { size: 8 }); ly -= 14;
  cv.text(lx + 10, ly, r.growthCoversDecay ? '增长项 > 耗散项：资产净增长为正' : '增长项 < 耗散项：资产净增长为负，先压 μ、补沉淀', { size: 8, color: r.growthCoversDecay ? C.teal : C.red }); ly -= 14;
  cv.text(lx + 10, ly, r.Mcrit === null ? 'Mcrit：不成立（γ ≤ 1，无超线性阈值）' : `Mcrit ≈ ${f2(r.Mcrit, 1)} → ${{ below: '未越过', near: '临界', above: '已越过' }[r.position]}`, { size: 8 }); ly -= 18;
  cv.para(lx + 10, ly, `判定：${r.stateLabel}。纪律：M 大 ≠ 飞轮强；分界是 γ 是否显著大于 0，以及增长项能否覆盖 μM。`, { size: 7.5, maxW: half - 20, maxLines: 3, color: C.muted });
  // right
  let ry = y - 58;
  const ob = d.ledger.ledger.filter((e) => e.type === 'observed' && e.countedInEI);
  cv.text(rx + 10, ry, `EI_observed = ${f2(d.ledger.EI_observed)}（同级证据只计一次）`, { size: 8.5 }); ry -= 16;
  ob.forEach((e) => { cv.text(rx + 10, ry, `${e.level} ${e.levelLabel}`, { size: 8 }); bar(cv, rx + 90, ry - 1, half - 140, 7, e.ei / 0.65, C.orange); cv.text(rx + half - 8, ry, f2(e.ei), { size: 8, align: 'right' }); ry -= 16; });
  if (!ob.length) { cv.text(rx + 10, ry, '没有 Observed 证据：EI_observed = 0', { size: 8, color: C.muted }); ry -= 16; }
  ry -= 6;
  cv.text(rx + 10, ry, `V_seed（${d.benchmark.mode === 'usd' ? 'Benchmark' : 'Value Index'}）：${fmtV(d, d.benchmark.base)}`, { size: 8.5 }); ry -= 14;
  cv.text(rx + 10, ry, `V_now = V_seed × e^${f2(d.ledger.EI_observed)} = ${fmtV(d, d.vNow.base)}`, { size: 8.5, color: C.orange }); ry -= 14;
  cv.text(rx + 10, ry, `P_execution = ${f2(d.executionProbability.pExecution)}（由 M / γ / μ 决定未来证据兑现概率）`, { size: 8.5 }); ry -= 18;
  cv.para(rx + 10, ry, '外部价值只认已发生的证据；目标与计划进 Forecast，不进 V_now。', { size: 7.5, maxW: half - 20, maxLines: 2, color: C.muted });
  // middle connector
  const mx = MARGIN + half + 20;
  cv.line(mx, y - 120, mx, y - 200, { color: C.navy, width: 1 });
  cv.text(mx, y - 100, '↑', { size: 12, color: C.navy, align: 'center' }); cv.text(mx, y - 212, '↓', { size: 12, color: C.navy, align: 'center' });
  y -= 320;
  y = label(cv, MARGIN, y, '双飞轮如何互相喂养');
  cv.para(MARGIN, y, `资产 M 让验证更快更强（P_execution = ${f2(d.executionProbability.pExecution)} 由 Maturity ${f2(d.executionProbability.inputs.maturity)} / G ${f2(d.executionProbability.inputs.G)} / D ${f2(d.executionProbability.inputs.D)} 决定）；外部验证带来资源、客户与机会，再反过来增强 M。报告把二者分开呈现，不混成一个总分。Action → Evidence → Asset → Better Action → Stronger Evidence → Value：每一轮都不从零开始。`, { size: 9, maxW: CW, maxLines: 4 });
}

/* P3 Evidence Ledger */
function p3(cv, d) {
  let y = header(cv, d, 3, '3 · Evidence Ledger：事实与目标分离', 'Observed 进 EI_observed；Target / Planned / Assumption 不得提前进入 V_now');
  const cols = [MARGIN, MARGIN + 44, MARGIN + 116, MARGIN + 156, MARGIN + 196];
  cv.rect(MARGIN, y - 16, CW, 18, { fill: C.navy });
  ['ID', '分类', '等级', 'EI', 'Canvas 语句 / 去向'].forEach((h, i) => cv.text(cols[i] + 4, y - 11, h, { size: 8, color: C.white }));
  y -= 18;
  const typeColor = { observed: C.orange, target: C.grey, planned: C.navy, assumption: C.grey };
  const typeLabel = { observed: 'Observed', target: 'Target', planned: 'Planned', assumption: 'Assumption' };
  const bottom = MARGIN + 60;
  for (const e of d.ledger.ledger) {
    const lines = cv.wrap(e.statement, 8, CW - 200);
    const h = Math.max(24, 10 + lines.length * 10 + 10);
    if (y - h < bottom) { cv.text(MARGIN, y - 10, `……其余 ${d.ledger.ledger.length - d.ledger.ledger.indexOf(e)} 条见 valuation.json`, { size: 7.5, color: C.muted }); y -= 14; break; }
    cv.rect(MARGIN, y - h, CW, h, { fill: e.type === 'observed' ? C.orangeSoft : e.type === 'planned' ? C.navySoft : C.panel });
    cv.text(cols[0] + 4, y - 13, e.id, { size: 7.5, color: C.muted });
    cv.text(cols[1] + 4, y - 13, typeLabel[e.type], { size: 8, color: typeColor[e.type] });
    cv.text(cols[2] + 4, y - 13, e.level ? `${e.level}` : '—', { size: 8 });
    cv.text(cols[3] + 4, y - 13, e.type === 'observed' ? (e.countedInEI ? f2(e.ei) : `(${f2(d.config.ei[e.level])} 同级重复)`) : e.type === 'planned' ? `${f2(e.ei)}×${f2(e.probability)}` : '0', { size: 7.5, color: e.type === 'observed' ? C.orange : C.ink });
    cv.para(cols[4] + 4, y - 13, e.statement, { size: 8, maxW: CW - 200, maxLines: 6 });
    cv.text(cols[4] + 4, y - h + 7, `→ ${e.role}${e.horizon ? ' · ' + e.horizon : ''}`, { size: 6.8, color: C.muted });
    y -= h;
  }
  y -= 12;
  cv.rect(MARGIN, y - 36, CW, 40, { fill: C.orangeSoft });
  cv.text(MARGIN + 10, y - 14, `V_now = V_seed × e^(EI_observed) = ${fmtV(d, d.benchmark.base)} × ${f2(d.vNow.multiplier)} = ${fmtV(d, d.vNow.base)}`, { size: 9.5, color: C.orange });
  cv.text(MARGIN + 10, y - 28, `EI_future = Σ(EI_i × P_i)：90d ${f2(d.forecast.horizons['90d'].base.EI_future)} · 12m ${f2(d.forecast.horizons['12m'].base.EI_future)}（Base 情景，P 默认 = P_execution ${f2(d.executionProbability.pExecution)}）`, { size: 8.5 });
}

/* P4 Value Compounding staircase */
function p4(cv, d) {
  let y = header(cv, d, 4, '4 · Value Compounding：证据阶梯', 'Seed → Problem → Usage → Payment → Value → Retention → Scalability：已发生的等级实色复利，计划中的等级淡色（只进 Forecast）');
  const levels = Object.keys(d.config.ei);
  const observed = new Set(d.ledger.ledger.filter((e) => e.type === 'observed' && e.countedInEI).map((e) => e.level));
  const planned = new Set(d.ledger.ledger.filter((e) => e.type === 'planned').map((e) => e.level));
  const steps = [{ key: 'Seed', cumObs: 0, cumAll: 0, kind: 'seed' }];
  let cumObs = 0, cumAll = 0;
  for (const l of levels) {
    const kind = observed.has(l) ? 'observed' : planned.has(l) ? 'planned' : 'none';
    if (kind === 'observed') cumObs += d.config.ei[l];
    if (kind !== 'none') cumAll += d.config.ei[l];
    steps.push({ key: l, kind, ei: d.config.ei[l], cumObs, cumAll, value: d.benchmark.base * Math.exp(kind === 'observed' ? cumObs : cumAll) });
  }
  const vmin = d.benchmark.base * 0.9, vmax = d.benchmark.base * Math.exp(cumAll) * 1.12;
  const x0 = MARGIN + 40, w = CW - 60, h = 230, y0 = y - 260;
  cv.rect(x0, y0, w, h, { fill: C.white, stroke: C.faint });
  const sw = w / steps.length, py = (v) => y0 + ((v - vmin) / (vmax - vmin)) * (h - 30) + 6;
  steps.forEach((s, i) => {
    const x = x0 + i * sw + 6, bw = sw - 12;
    const v = s.kind === 'seed' ? d.benchmark.base : s.value;
    const top = py(v);
    const fill = s.kind === 'seed' ? C.navy : s.kind === 'observed' ? C.orange : s.kind === 'planned' ? C.navySoft : C.faint;
    cv.rect(x, y0 + 2, bw, Math.max(3, top - y0 - 2), { fill });
    if (s.kind !== 'none') cv.text(x + bw / 2, top + 4, fmtV(d, v), { size: 6.8, align: 'center', color: s.kind === 'planned' ? C.muted : C.ink });
    cv.text(x + bw / 2, y0 - 10, s.key, { size: 7, align: 'center' });
    cv.text(x + bw / 2, y0 - 19, s.kind === 'seed' ? '锚点' : s.kind === 'observed' ? `+${f2(s.ei)} 已发生` : s.kind === 'planned' ? `+${f2(s.ei)} 计划` : '未触及', { size: 6, align: 'center', color: s.kind === 'observed' ? C.orange : C.muted });
  });
  cv.line(x0, py(d.vNow.base), x0 + w, py(d.vNow.base), { color: C.orange, width: 0.8, dash: [3, 3] });
  cv.text(x0 + w - 4, py(d.vNow.base) + 3, `V_now ${fmtV(d, d.vNow.base)}`, { size: 7, color: C.orange, align: 'right' });
  cv.text(x0 + 4, y0 + h - 12, `Reference Value（${d.benchmark.mode === 'usd' ? 'USD' : 'Value Index'}，按 e^EI 复利）`, { size: 7, color: C.muted });
  y = y0 - 34;
  [[C.navy, 'Benchmark / 锚点'], [C.orange, 'Observed 证据（已复利进 V_now）'], [C.navySoft, 'Planned 证据（只进 Forecast）'], [C.faint, '未触及等级']].forEach(([c, t], i) => { cv.rect(MARGIN + i * 128, y - 2, 10, 7, { fill: c }); cv.text(MARGIN + 14 + i * 128, y - 2, t, { size: 7.5, color: C.muted }); });
  y -= 26;
  y = label(cv, MARGIN, y, '阶梯说明');
  cv.para(MARGIN, y, `当前已复利到 ${observed.size ? [...observed].sort().join(' / ') : '（无）'}，EI_observed = ${f2(d.ledger.EI_observed)}，倍率 ${f2(d.vNow.multiplier)}×。计划中的 ${[...planned].sort().join(' / ') || '（无）'} 只有在成为 Observed 之后才进入 V_now；淡色台阶表示"全部计划都成真"时的上限，不是预测（预测见 P6，按 EI × P 折算）。每一级默认 EI：${levels.map((l) => `${l} ${d.config.ei[l]}`).join('，')}（${d.calculationVersion}，可配置）。`, { size: 8.5, maxW: CW, maxLines: 5 });
}

/* P5 quadrant */
function p5(cv, d) {
  let y = header(cv, d, 5, '5 · M × EI 四象限', '横轴：外部证据 EI；纵轴：递归资产 M。颜色只表示轴，不表示好坏；每个象限都有文字定义');
  const q = d.quadrant, size = 250, x0 = MARGIN + 60, y0 = y - 280;
  const mMax = Math.max(d.recursive.M * 1.4, q.thresholds.mHigh * 2), eMax = Math.max(d.ledger.EI_observed * 1.4, q.thresholds.eiHigh * 2);
  const px = (e) => x0 + (e / eMax) * size, py = (m) => y0 + (m / mMax) * size;
  const defs = [['q3', '③ 技术自嗨风险', x0, py(q.thresholds.mHigh), px(q.thresholds.eiHigh) - x0, y0 + size - py(q.thresholds.mHigh)], ['q4', '④ 递归增长状态', px(q.thresholds.eiHigh), py(q.thresholds.mHigh), x0 + size - px(q.thresholds.eiHigh), y0 + size - py(q.thresholds.mHigh)], ['q1', '① 忙碌但没学习', x0, y0, px(q.thresholds.eiHigh) - x0, py(q.thresholds.mHigh) - y0], ['q2', '② 项目公司风险', px(q.thresholds.eiHigh), y0, x0 + size - px(q.thresholds.eiHigh), py(q.thresholds.mHigh) - y0]];
  for (const [k, t, x, yy, w, h] of defs) { cv.rect(x, yy, w, h, { fill: k === q.key ? C.tealSoft : C.panel, stroke: C.faint }); cv.text(x + 6, yy + h - 12, t, { size: 8, color: k === q.key ? C.teal : C.muted }); }
  cv.line(x0, y0, x0 + size, y0, { color: C.muted, width: 0.8 }); cv.line(x0, y0, x0, y0 + size, { color: C.muted, width: 0.8 });
  cv.text(x0 + size, y0 - 12, `EI（阈值 ${q.thresholds.eiHigh}）`, { size: 7.5, color: C.orange, align: 'right' });
  cv.text(x0 - 6, y0 + size + 4, `M（阈值 ${q.thresholds.mHigh}）`, { size: 7.5, color: C.teal });
  cv.dot(px(Math.min(d.ledger.EI_observed, eMax)), py(Math.min(d.recursive.M, mMax)), 5, C.navy);
  cv.text(px(Math.min(d.ledger.EI_observed, eMax)) + 8, py(Math.min(d.recursive.M, mMax)) - 3, `当前：M ${f2(d.recursive.M, 1)} / EI ${f2(d.ledger.EI_observed)}`, { size: 7.5, color: C.navy });
  const rx = x0 + size + 24, rw = PAGE.w - MARGIN - rx;
  cv.rect(rx, y0, rw, size, { fill: C.panel });
  cv.text(rx + 10, y0 + size - 18, q.name, { size: 13, color: C.teal });
  cv.para(rx + 10, y0 + size - 38, q.explain, { size: 8.5, maxW: rw - 20, maxLines: 5 });
  cv.para(rx + 10, y0 + size - 110, q.key === 'q3' ? '导师建议：暂停堆系统，把最近一次交付变成可核验的市场证据（E2/E3）。' : q.key === 'q2' ? '导师建议：把每次交付沉淀为 Workflow / Eval / 模板，让下一单不从零开始。' : q.key === 'q1' ? '导师建议：先选一个真实用户问题做 E1/E2 验证，同时把过程结构化为资产。' : '导师建议：保护闭环，用 Comparable 校验现实锚点，持续把交付写回资产。', { size: 8, maxW: rw - 20, maxLines: 5, color: C.muted });
  y = y0 - 30;
  y = label(cv, MARGIN, y, '四象限定义（§12.1）');
  [['① 低 M / 低 EI', '忙碌但没学习：做了很多事，但既没有市场证据，也没有留下组织资产。'], ['② 低 M / 高 EI', '项目公司风险：客户认可，但经验没沉淀；下一单仍从头开始。'], ['③ 高 M / 低 EI', '技术自嗨风险：系统越来越复杂，但关键市场假设没有被验证。'], ['④ 高 M / 高 EI', '递归增长状态：市场持续验证；每次交付又增强系统。']].forEach(([a, b]) => { cv.text(MARGIN, y, a, { size: 8.5, color: C.navy }); cv.para(MARGIN + 90, y, b, { size: 8.5, maxW: CW - 90, maxLines: 2 }); y -= 16; });
}

/* P6 forecast curves */
function p6(cv, d) {
  let y = header(cv, d, 6, '6 · Valuation Forecast：Current / 90d / 12m', 'Conservative / Base / Upside 三条曲线；每个拐点标注导致变化的 Evidence Milestone');
  const H = d.forecast.horizons, xs = ['Now', '90d', '12m'];
  const series = { conservative: [d.vNow.base, H['90d'].conservative.value.base, H['12m'].conservative.value.base], base: [d.vNow.base, H['90d'].base.value.base, H['12m'].base.value.base], upside: [d.vNow.base, H['90d'].upside.value.base, H['12m'].upside.value.base] };
  const vmax = Math.max(...Object.values(series).flat()) * 1.15, vmin = Math.min(d.benchmark.base, d.vNow.base) * 0.85;
  const x0 = MARGIN + 60, w = CW - 80, h = 230, y0 = y - 260;
  cv.rect(x0, y0, w, h, { fill: C.white, stroke: C.faint });
  const px = (i) => x0 + 30 + i * ((w - 60) / 2), py = (v) => y0 + ((v - vmin) / (vmax - vmin)) * (h - 20) + 10;
  for (let i = 0; i < 3; i++) { cv.line(px(i), y0, px(i), y0 + h, { color: C.faint, dash: [2, 3] }); cv.text(px(i), y0 - 12, xs[i], { size: 8, align: 'center' }); }
  const styles = { conservative: [C.grey, [3, 3]], base: [C.orange, undefined], upside: [C.navy, [6, 3]] };
  for (const [k, vals] of Object.entries(series)) { cv.poly(vals.map((v, i) => [px(i), py(v)]), { color: styles[k][0], width: k === 'base' ? 2 : 1.4, dash: styles[k][1] }); vals.forEach((v, i) => { cv.dot(px(i), py(v), 2.5, styles[k][0]); const show = (k === 'base') || (i === 2); if (!show) return; const dy = k === 'upside' ? -13 : k === 'conservative' ? -13 : i === 0 ? 5 : 7; cv.text(px(i) + (i === 2 ? -7 : i === 1 ? 0 : 7), py(v) + dy, fmtV(d, v), { size: 7, color: styles[k][0], align: i === 2 ? 'right' : i === 1 ? 'center' : 'left' }); }); }
  cv.text(x0 + 6, y0 + h - 12, `Reference Value（${d.benchmark.mode === 'usd' ? 'USD' : 'Value Index'}）`, { size: 7, color: C.muted });
  [[C.grey, `Conservative（P × ${d.forecast.scenarioFactors.conservative}）`], [C.orange, 'Base（P × 1.00）'], [C.navy, `Upside（min(P × ${d.forecast.scenarioFactors.upside}, 1)）`]].forEach(([c, t], i) => { cv.line(x0 + 10 + i * 160, y0 - 27, x0 + 30 + i * 160, y0 - 27, { color: c, width: 2 }); cv.text(x0 + 34 + i * 160, y0 - 30, t, { size: 7.5 }); });
  // milestone markers
  const ms90 = H['90d'].base.items, ms12 = H['12m'].base.items.filter((m) => !ms90.some((a) => a.id === m.id));
  cv.text(px(1), y0 + 4, ms90.length ? `拐点：${ms90.map((m) => m.id + ' ' + m.level).join('，')}` : '拐点：无 90d 里程碑', { size: 6.5, align: 'center', color: C.navy });
  cv.text(px(2) - 4, y0 + 4, ms12.length ? `拐点：${ms12.map((m) => m.id + ' ' + m.level).join('，')}` : '拐点：无 12m 新里程碑', { size: 6.5, align: 'right', color: C.navy });
  y = y0 - 46;
  cv.rect(MARGIN, y - 18, CW, 20, { fill: C.navy });
  ['时间点', 'Conservative', 'Base', 'Upside', 'EI_future(Base)'].forEach((t, i) => cv.text(MARGIN + 6 + i * (CW / 5), y - 13, t, { size: 8, color: C.white }));
  y -= 18;
  [['Current（Observed）', d.vNow.base, d.vNow.base, d.vNow.base, d.ledger.EI_observed], ['90 Days', H['90d'].conservative.value.base, H['90d'].base.value.base, H['90d'].upside.value.base, H['90d'].base.EI_future], ['12 Months', H['12m'].conservative.value.base, H['12m'].base.value.base, H['12m'].upside.value.base, H['12m'].base.EI_future]].forEach((r, ri) => { cv.rect(MARGIN, y - 18, CW, 18, { fill: ri % 2 ? C.panel : C.white }); r.forEach((c, i) => cv.text(MARGIN + 6 + i * (CW / 5), y - 12, i === 0 ? c : i === 4 ? f2(c) : fmtV(d, c), { size: 8.5, color: i === 2 ? C.orange : C.ink })); y -= 18; });
  y -= 14;
  y = label(cv, MARGIN, y, `P_execution = ${f2(d.executionProbability.pExecution)}（${d.executionProbability.version}）`);
  cv.para(MARGIN, y, `${d.executionProbability.formula}；Maturity = M/N = ${f2(d.executionProbability.inputs.maturity)}，G = min(γ,1.5)/1.5 = ${f2(d.executionProbability.inputs.G)}，D = 1 - μ = ${f2(d.executionProbability.inputs.D)}。这是产品启发式，不是理论定律；获得真实项目结果后用校准数据替换。Upside 不是"最可能结果"。`, { size: 8.5, maxW: CW, maxLines: 4, color: C.muted });
}

/* P7 What must become true */
function p7(cv, d) {
  let y = header(cv, d, 7, '7 · What Must Become True', '3–5 个价值解锁里程碑；每条绑定 EI 与判定条件；哪条失败，哪段曲线回撤');
  const list = d.milestones.list;
  if (!list.length) { cv.para(MARGIN, y, 'Canvas 的 Validation 区没有任何 Planned Validation，无法生成里程碑。请在画布里写明计划中的试点 / 回测 / 客户验证及其时间窗。', { size: 9.5, maxW: CW }); }
  list.forEach((m) => {
    const h = 78;
    cv.rect(MARGIN, y - h, CW, h, { fill: m.horizon === '90d' ? C.navySoft : C.panel });
    cv.text(MARGIN + 10, y - 16, `${m.rank}. ${m.level} ${m.levelLabel} · ${m.horizon}`, { size: 10.5, color: C.navy });
    cv.text(PAGE.w - MARGIN - 10, y - 16, `EI ${f2(m.ei)} × P ${f2(m.probability)} = ${f2(m.ei * m.probability, 3)}`, { size: 9, color: C.orange, align: 'right' });
    cv.para(MARGIN + 10, y - 32, m.statement, { size: 8.5, maxW: CW - 20, maxLines: 2 });
    cv.para(MARGIN + 10, y - 56, `判定：${m.successCriterion}`, { size: 7.5, maxW: CW - 20, maxLines: 1, color: C.muted });
    cv.para(MARGIN + 10, y - 68, `回撤：${m.ifFails}`, { size: 7.5, maxW: CW - 20, maxLines: 1, color: C.red });
    y -= h + 8;
  });
  y -= 4;
  y = label(cv, MARGIN, y, '敏感性：预测金额对哪些关键假设最敏感');
  d.sensitivity.forEach((s) => { cv.dot(MARGIN + 3, y + 3, 2, C.orange); y -= cv.para(MARGIN + 10, y, `${s.milestone} → 若失败，12m Base 约回撤 ${s.effectOn12mBase}（ΔEI ${f2(s.deltaEI, 3)}）`, { size: 8.5, maxW: CW - 10, maxLines: 2 }) + 2; });
  y -= 6;
  y = label(cv, MARGIN, y, 'Target 作为成功门槛 / Assumption 作为风险');
  cv.para(MARGIN, y, `门槛：${d.milestones.targetsAsGates.join('；') || '（无）'}`, { size: 8, maxW: CW, maxLines: 3, color: C.muted });
  cv.para(MARGIN, y - 36, `风险：${d.milestones.assumptionsAsRisks.join('；') || '（无）'}`, { size: 8, maxW: CW, maxLines: 3, color: C.muted });
}

/* P8 Comparable & Reality Check */
function p8(cv, d) {
  let y = header(cv, d, 8, '8 · Comparable & Reality Check', `${d.benchmark.mode === 'usd' ? `V_seed = [${fmtV(d, d.benchmark.low)}, ${fmtV(d, d.benchmark.base)}, ${fmtV(d, d.benchmark.high)}]` : 'Value Index 模式'} · benchmark_date ${d.disclosures.benchmark_date} · 可用样本 ${d.benchmark.sourceCount}`);
  const cs = d.benchmark.comparables;
  if (!cs.length) { cv.para(MARGIN, y, '没有提供 Comparable。请按同业务模式 + 同阶段 + 同领域优先，补充 3–5 个可解释的同类公司（含 source、source_date、evidence_grade）。', { size: 9.5, maxW: CW }); y -= 40; }
  cs.slice(0, 5).forEach((c) => {
    const h = 74;
    cv.rect(MARGIN, y - h, CW, h, { fill: c.usable ? C.navySoft : C.panel });
    cv.text(MARGIN + 10, y - 15, c.name, { size: 10, color: C.navy });
    cv.text(PAGE.w - MARGIN - 10, y - 15, c.valueUsd ? `${formatValue(c.valueUsd, 'usd')} · 等级 ${c.evidenceGrade}` : `Not publicly disclosed · 等级 ${c.evidenceGrade}`, { size: 8.5, color: c.usable ? C.navy : C.muted, align: 'right' });
    cv.text(MARGIN + 10, y - 29, `${c.archetype || '—'} · ${c.stage || '—'} · ${c.domain || '—'}`, { size: 7.5, color: C.muted });
    cv.para(MARGIN + 10, y - 43, `相似：${c.similarities || '—'}`, { size: 7.5, maxW: CW - 20, maxLines: 1 });
    cv.para(MARGIN + 10, y - 55, `不同：${c.differences || '—'}`, { size: 7.5, maxW: CW - 20, maxLines: 1 });
    cv.text(MARGIN + 10, y - 67, `来源：${c.source || '—'}${c.sourceDate ? ' · ' + c.sourceDate : ''} · ${c.gradeNote}${c.usable ? '' : '（不进入金额计算）'}`, { size: 6.8, color: C.muted });
    y -= h + 6;
  });
  y -= 6;
  y = label(cv, MARGIN, y, 'Reality Check');
  cv.para(MARGIN, y, d.benchmark.note + ' Comparable 的价值只用于设置 V_seed 与现实校验，绝不反向修改 M / γ / μ；不用单一 Comparable 决定 V_seed；不从公开融资额推断未公开估值。', { size: 8.5, maxW: CW, maxLines: 4 });
  y -= 56;
  y = label(cv, MARGIN, y, '披露与可追溯性');
  d.provenance.forEach((p) => { cv.text(MARGIN, y, p.parameter, { size: 7.5, color: C.navy }); cv.text(MARGIN + 150, y, p.origin, { size: 7.5, color: C.muted }); cv.para(MARGIN + 290, y, `${p.rule}`, { size: 7.5, maxW: CW - 290, maxLines: 1 }); y -= 11; });
  y -= 6;
  cv.para(MARGIN, y, `valuation_model_version ${d.disclosures.valuation_model_version} · calculation_version ${d.disclosures.calculation_version} · benchmark_date ${d.disclosures.benchmark_date} · source_count ${d.disclosures.source_count} · Forecast Confidence ${d.confidence.level}（${d.confidence.reason}）`, { size: 7.5, maxW: CW, maxLines: 3, color: C.muted });
}

async function renderReport(d, fontPath) {
  if (!d.preflight || !d.preflight.ok) throw new Error(`Preflight failed: ${d.preflight && d.preflight.message}`);
  if (d.errors && d.errors.length) throw new Error(`Input errors: ${d.errors.join('; ')}`);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(fontPath));
  doc.setTitle(`AI 原生递归资产与估值预测 · ${d.maau.name}`); doc.setSubject('Reference Value / Scenario Forecast'); doc.setProducer('maau-venture-valuation');
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z')); doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  for (const draw of [p1, p2, p3, p4, p5, p6, p7, p8]) draw(new Cv(doc.addPage([PAGE.w, PAGE.h]), font), d);
  return doc.save({ useObjectStreams: false });
}
module.exports = { renderReport, resolveFont };

if (require.main === module) {
  const args = process.argv.slice(2); const fi = args.indexOf('--font'); const explicitFont = fi >= 0 ? args.splice(fi, 2)[1] : undefined;
  const [inputPath, outputPath] = args;
  if (!inputPath || !outputPath) { console.error('usage: node render.cjs <valuation.json> <out.pdf> [--font cjk.otf]'); process.exit(2); }
  (async () => { const fontPath = resolveFont(explicitFont); const bytes = await renderReport(JSON.parse(fs.readFileSync(inputPath, 'utf8')), fontPath); fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true }); fs.writeFileSync(outputPath, bytes); console.log(`wrote ${outputPath} (${bytes.length} bytes, 8 pages, font ${fontPath})`); })().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
