#!/usr/bin/env node
'use strict';
/**
 * render-report.cjs — diagnosis.json（compute.cjs 输出）→ 固定 5 页 A4 PDF。
 *
 * 用法：node render-report.cjs <diagnosis.json> <out.pdf> [--font /path/to/cjk.otf|.ttf]
 *
 * 字体解析顺序：--font → $MAAU_REPORT_FONT → $SKILL_SANDBOX_CJK_FONT →
 *   /usr/share/fonts/workspacex/NotoSansSC-Common.otf（沙箱镜像预装）。
 * 找不到单面 CJK 字体就明确失败（不用拉丁内置字体硬画中文成方框）。
 * ⚠ 不要给 embedFont 传 { subset: true }：pdf-lib 对这份字体子集化会产出损坏的内嵌字体。
 *
 * 页面：P1 项目定位 / P2 动力学与临界点 / P3 当前实证卡片 / P4 退化压力测试 / P5 共性图谱。
 * 依赖：pdf-lib + @pdf-lib/fontkit（沙箱与 apps/api 均预装）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const PAGE = { w: 595.28, h: 841.89 }; // A4
const MARGIN = 42;
const CONTENT_W = PAGE.w - MARGIN * 2;

const C = {
  ink: rgb(0.12, 0.14, 0.2),
  muted: rgb(0.42, 0.45, 0.52),
  faint: rgb(0.85, 0.87, 0.9),
  panel: rgb(0.955, 0.962, 0.975),
  navy: rgb(0.12, 0.2, 0.42),
  blue: rgb(0.16, 0.42, 0.78),
  blueSoft: rgb(0.82, 0.88, 0.97),
  gold: rgb(0.82, 0.6, 0.12),
  goldSoft: rgb(0.98, 0.93, 0.8),
  green: rgb(0.16, 0.55, 0.36),
  red: rgb(0.78, 0.25, 0.22),
  white: rgb(1, 1, 1),
};
const STATE_COLOR = { 'task-agent': C.muted, 'ordinary-maau': C.gold, 'strong-recursive': C.blue };
const FOOTER_NOTE = '所有数值均为 Canvas-derived estimate（基于静态 MAAU Canvas 的结构估计），不代表生产系统实测参数。';

function resolveFont(explicit) {
  const candidates = [
    explicit,
    process.env.MAAU_REPORT_FONT,
    process.env.SKILL_SANDBOX_CJK_FONT,
    '/usr/share/fonts/workspacex/NotoSansSC-Common.otf',
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error(
    `No CJK font found. Tried: ${candidates.join(', ') || '(none)'}. ` +
      'Pass --font <single-face .otf/.ttf> or set MAAU_REPORT_FONT / SKILL_SANDBOX_CJK_FONT.',
  );
}

function fmt(x, d = 2) {
  return x === null || x === undefined ? '—' : Number(x).toFixed(d);
}

class Canvas {
  constructor(page, font) {
    this.page = page;
    this.font = font;
  }
  width(text, size) {
    return this.font.widthOfTextAtSize(text, size);
  }
  text(x, y, text, opt = {}) {
    const size = opt.size || 10;
    let tx = x;
    if (opt.align === 'center') tx = x - this.width(text, size) / 2;
    if (opt.align === 'right') tx = x - this.width(text, size);
    this.page.drawText(text, { x: tx, y, size, font: this.font, color: opt.color || C.ink });
    return size;
  }
  /** 中文无空格：按字符宽度断行；拉丁词尽量整词。 */
  wrap(text, size, maxW) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      let word = '';
      const flushWord = () => {
        if (!word) return;
        if (this.width(line + word, size) > maxW && line) {
          lines.push(line);
          line = '';
        }
        // 超长拉丁词：逐字符切
        while (this.width(word, size) > maxW) {
          let cut = word.length;
          while (cut > 1 && this.width(word.slice(0, cut), size) > maxW) cut--;
          lines.push(line + word.slice(0, cut));
          line = '';
          word = word.slice(cut);
        }
        line += word;
        word = '';
      };
      for (const ch of para) {
        if (/[A-Za-z0-9_./%+-]/.test(ch)) {
          word += ch;
          continue;
        }
        flushWord();
        if (this.width(line + ch, size) > maxW && line) {
          lines.push(line);
          line = ch === ' ' ? '' : ch;
        } else line += ch;
      }
      flushWord();
      lines.push(line);
    }
    return lines;
  }
  paragraph(x, y, text, opt = {}) {
    const size = opt.size || 9.5;
    const lh = opt.lineHeight || size * 1.45;
    const lines = this.wrap(text, size, opt.maxWidth || CONTENT_W);
    const max = opt.maxLines || Infinity;
    let yy = y;
    lines.slice(0, max).forEach((l, i) => {
      const t = i === max - 1 && lines.length > max ? l.replace(/.{2}$/, '…') : l;
      this.text(x, yy, t, { size, color: opt.color });
      yy -= lh;
    });
    return y - yy;
  }
  rect(x, y, w, h, opt = {}) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: opt.fill, borderColor: opt.stroke, borderWidth: opt.stroke ? opt.strokeWidth || 0.6 : 0 });
  }
  line(x1, y1, x2, y2, opt = {}) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: opt.width || 0.6, color: opt.color || C.faint, dashArray: opt.dash });
  }
  polyline(points, opt = {}) {
    for (let i = 1; i < points.length; i++) this.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], opt);
  }
  circle(x, y, r, fill) {
    this.page.drawCircle({ x, y, size: r, color: fill });
  }
}

function header(cv, d, pageNo, title, subtitle) {
  const top = PAGE.h - MARGIN;
  cv.text(MARGIN, top - 4, `MAAU：${d.project.name}`, { size: 9, color: C.muted });
  cv.text(PAGE.w - MARGIN, top - 4, `AI 原生递归资产诊断报告 · P${pageNo}/5`, { size: 9, color: C.muted, align: 'right' });
  cv.text(MARGIN, top - 30, title, { size: 19, color: C.navy });
  if (subtitle) cv.text(MARGIN, top - 46, subtitle, { size: 9.5, color: C.muted });
  // footer
  cv.line(MARGIN, MARGIN + 14, PAGE.w - MARGIN, MARGIN + 14, { color: C.faint });
  cv.text(MARGIN, MARGIN + 2, FOOTER_NOTE, { size: 7, color: C.muted });
  cv.text(PAGE.w - MARGIN, MARGIN + 2, `model v${d.modelVersion}${d.project.date ? ' · ' + d.project.date : ''}`, { size: 7, color: C.muted, align: 'right' });
  return top - 64;
}

function sectionLabel(cv, x, y, text) {
  cv.text(x, y, text, { size: 10.5, color: C.navy });
  return y - 14;
}

function statTile(cv, x, y, w, h, label, value, opt = {}) {
  cv.rect(x, y - h, w, h, { fill: opt.fill || C.panel });
  cv.text(x + 10, y - 16, label, { size: 8.5, color: C.muted });
  cv.text(x + 10, y - h + 14, value, { size: opt.size || 20, color: opt.color || C.ink });
  if (opt.suffix) cv.text(x + 10 + cv.width(value, opt.size || 20) + 6, y - h + 14, opt.suffix, { size: 9, color: C.muted });
}

function scoreBar(cv, x, y, w, h, value, color) {
  cv.rect(x, y, w, h, { fill: C.faint });
  if (value > 0) cv.rect(x, y, w * Math.min(1, value), h, { fill: color });
}

/* ------------------------------------------------------------------ P1 */
function pageOverview(cv, d) {
  let y = header(cv, d, 1, '1 · 项目定位：现在属于哪一档', '一眼回答：任务 Agent、普通 MAAU，还是强递归 MAAU（判定只由 γ_C 触发）');

  // three-state band
  const states = [
    ['task-agent', '任务 Agent', 'γ ≈ 0', '无递归回灌；吞吐型'],
    ['ordinary-maau', '普通 MAAU', '0 < γ ≤ 1', '可积累，但不自我加速'],
    ['strong-recursive', '强递归 MAAU', 'γ > 1', '越过阈值后具备加速潜力'],
  ];
  const bw = (CONTENT_W - 16) / 3;
  states.forEach(([key, name, cond, desc], i) => {
    const x = MARGIN + i * (bw + 8);
    const active = key === d.current.state;
    cv.rect(x, y - 78, bw, 78, { fill: active ? STATE_COLOR[key] : C.panel });
    const tc = active ? C.white : C.ink;
    cv.text(x + 12, y - 24, name, { size: 14, color: tc });
    cv.text(x + 12, y - 42, cond, { size: 10, color: active ? C.white : C.muted });
    cv.text(x + 12, y - 62, desc, { size: 8.5, color: active ? C.white : C.muted });
    if (active) { cv.circle(x + bw - 40, y - 11, 2.5, C.white); cv.text(x + bw - 10, y - 14, '当前', { size: 8, color: C.white, align: 'right' }); }
  });
  y -= 96;

  // stat tiles
  const tw = (CONTENT_W - 24) / 4;
  const tiles = [
    ['γ_C 递归自反馈指数', fmt(d.current.gamma), STATE_COLOR[d.current.state]],
    ['M_C 递归资产存量', fmt(d.current.M, 1), C.navy],
    ['μ_C 结构性耗散率', fmt(d.current.mu, 3), C.gold, d.current.muBand],
    ['β_C 组织杠杆弹性', fmt(d.current.beta), C.muted],
  ];
  tiles.forEach(([l, v, c, suffix], i) => statTile(cv, MARGIN + i * (tw + 8), y, tw, 56, l, v, { color: c, size: 18, suffix }));
  y -= 72;

  y = sectionLabel(cv, MARGIN, y, '自动结论');
  cv.rect(MARGIN, y - 62, CONTENT_W, 66, { fill: C.panel });
  cv.paragraph(MARGIN + 10, y - 10, d.conclusion, { size: 9.5, maxWidth: CONTENT_W - 20, maxLines: 4 });
  y -= 80;

  // asset list
  y = sectionLabel(cv, MARGIN, y, `资产清单（${d.assets.count} 项 → M_C = ${fmt(d.assets.M, 1)} 有效递归资产等价单位）`);
  const colX = [MARGIN, MARGIN + 150, MARGIN + 220, MARGIN + 262, MARGIN + 304, MARGIN + 346, MARGIN + 388];
  ['资产', '类型', 'E', 'R', 'I', 'V', '有效值'].forEach((h, i) => cv.text(colX[i], y, h, { size: 8, color: C.muted }));
  y -= 6;
  cv.line(MARGIN, y, PAGE.w - MARGIN, y);
  y -= 14;
  const rowH = 15;
  const maxRows = Math.max(1, Math.floor((y - (MARGIN + 34)) / rowH));
  const shown = d.assets.items.slice(0, maxRows);
  shown.forEach((a) => {
    cv.text(colX[0], y, a.name.length > 14 ? a.name.slice(0, 13) + '…' : a.name, { size: 9 });
    cv.text(colX[1], y, a.type, { size: 8.5, color: C.muted });
    [a.E, a.R, a.I, a.V].forEach((v, i) => cv.text(colX[2 + i] + 6, y, fmt(v, 1), { size: 8.5 }));
    cv.text(colX[6], y, fmt(a.value, 2), { size: 9, color: C.navy });
    scoreBar(cv, colX[6] + 34, y + 1, CONTENT_W - (colX[6] + 34 - MARGIN), 7, a.value, C.blue);
    y -= rowH;
  });
  if (d.assets.items.length > shown.length) cv.text(MARGIN, y, `……另有 ${d.assets.items.length - shown.length} 项资产，见 diagnosis.json`, { size: 8, color: C.muted });
  cv.text(MARGIN, MARGIN + 24, '单资产有效值 = (E 明确度 + R 可复用性 + I 独立调用 + V 可验证性) / 4；一次性交付物不进入 M。', { size: 7.5, color: C.muted });
}

/* ------------------------------------------------------------------ P2 */
function drawDynamicsChart(cv, x0, y0, w, h, d) {
  const cur = d.current;
  const gamma = cur.gamma;
  const K = cur.Keff;
  const mu = cur.mu;
  const M = cur.M;
  const Mcrit = cur.Mcrit;
  const Mmax = Math.max(M * 1.6, Mcrit ? Mcrit * 1.6 : 0, 1);
  const growth = (m) => K * Math.pow(m, gamma);
  const dis = (m) => mu * m;
  let ymax = 0;
  for (let i = 0; i <= 60; i++) {
    const m = (Mmax * i) / 60;
    ymax = Math.max(ymax, growth(m), dis(m));
  }
  ymax = ymax * 1.12 || 1;
  const px = (m) => x0 + (m / Mmax) * w;
  const py = (v) => y0 + (v / ymax) * h;

  cv.rect(x0, y0, w, h, { fill: C.white, stroke: C.faint });
  // shaded regions (only when Mcrit exists)
  if (Mcrit !== null && Mcrit > 0 && Mcrit < Mmax) {
    cv.rect(x0, y0, px(Mcrit) - x0, h, { fill: C.goldSoft });
    cv.rect(px(Mcrit), y0, x0 + w - px(Mcrit), h, { fill: C.blueSoft });
    cv.text(x0 + (px(Mcrit) - x0) / 2, y0 + h - 14, '萎缩区 M < Mcrit', { size: 8, color: C.gold, align: 'center' });
    cv.text(px(Mcrit) + (x0 + w - px(Mcrit)) / 2, y0 + h - 14, '超线性增长区 M > Mcrit', { size: 8, color: C.blue, align: 'center' });
  }
  // axes
  cv.line(x0, y0, x0 + w, y0, { color: C.muted, width: 0.8 });
  cv.line(x0, y0, x0, y0 + h, { color: C.muted, width: 0.8 });
  cv.text(x0 + w, y0 - 12, 'M（递归资产存量）', { size: 8, color: C.muted, align: 'right' });
  cv.text(x0 + 4, y0 + h + 4, 'dM/dt 分量', { size: 8, color: C.muted });
  // curves
  const gPts = [];
  const dPts = [];
  for (let i = 0; i <= 80; i++) {
    const m = (Mmax * i) / 80;
    gPts.push([px(m), py(Math.min(growth(m), ymax))]);
    dPts.push([px(m), py(Math.min(dis(m), ymax))]);
  }
  cv.polyline(dPts, { color: C.gold, width: 2 });
  cv.polyline(gPts, { color: C.blue, width: 2 });
  // legend
  cv.line(x0 + 10, y0 + h - 30, x0 + 30, y0 + h - 30, { color: C.blue, width: 2 });
  cv.text(x0 + 34, y0 + h - 33, `增长项 K_C·β_C·M^γ = ${fmt(K, 3)}·M^${fmt(gamma)}`, { size: 8 });
  cv.line(x0 + 10, y0 + h - 44, x0 + 30, y0 + h - 44, { color: C.gold, width: 2 });
  cv.text(x0 + 34, y0 + h - 47, `耗散项 μ_C·M = ${fmt(mu, 3)}·M`, { size: 8 });
  // markers
  if (Mcrit !== null && Mcrit > 0 && Mcrit < Mmax) {
    cv.line(px(Mcrit), y0, px(Mcrit), y0 + h, { color: C.navy, width: 0.8, dash: [3, 3] });
    cv.text(px(Mcrit), y0 - 22, `Mcrit ≈ ${fmt(Mcrit, 1)}`, { size: 8.5, color: C.navy, align: 'center' });
  }
  if (M > 0 && M < Mmax) {
    cv.line(px(M), y0, px(M), y0 + h, { color: C.green, width: 0.8, dash: [2, 2] });
    cv.text(px(M), y0 - 12, `M_C = ${fmt(M, 1)}`, { size: 8.5, color: C.green, align: 'center' });
    cv.circle(px(M), py(Math.min(growth(M), ymax)), 3, C.blue);
    cv.circle(px(M), py(Math.min(dis(M), ymax)), 3, C.gold);
  }
}

function pageDynamics(cv, d) {
  let y = header(cv, d, 2, '2 · 动力学与临界点', '增长项 vs 耗散项；M、γ、μ 是主角，其他参数只服务于临界点解释');

  // equation panel
  cv.rect(MARGIN, y - 54, CONTENT_W, 54, { fill: C.panel });
  cv.text(MARGIN + 12, y - 20, '概念方程：dM/dt = K · M^γ - μ · M', { size: 12, color: C.navy });
  cv.text(MARGIN + 12, y - 40, `Canvas-derived 计算版：dM/dt = K_C·β_C · M^γ_C - μ_C · M，其中 K_C = ${fmt(d.current.K, 3)}，β_C = ${fmt(d.current.beta)}，γ_C = ${fmt(d.current.gamma)}，μ_C = ${fmt(d.current.mu, 3)}`, { size: 8.5, color: C.muted });
  y -= 70;

  drawDynamicsChart(cv, MARGIN + 30, y - 250, CONTENT_W - 40, 230, d);
  y -= 280;

  // verdict
  const cur = d.current;
  let verdict;
  if (cur.Mcrit === null) verdict = `γ_C = ${fmt(cur.gamma)} ≤ 1：无超线性临界点。增长项随 M 至多线性增长，Mcrit 不成立；报告不显示“已越过强递归相变阈值”。`;
  else if (cur.position === 'below') verdict = `γ_C = ${fmt(cur.gamma)} > 1，Mcrit ≈ ${fmt(cur.Mcrit, 1)}；M_C = ${fmt(cur.M, 1)} < Mcrit：飞轮尚未站稳，处于萎缩区。`;
  else if (cur.position === 'near') verdict = `γ_C = ${fmt(cur.gamma)} > 1，Mcrit ≈ ${fmt(cur.Mcrit, 1)}；M_C = ${fmt(cur.M, 1)} ≈ Mcrit：临界状态。`;
  else verdict = `γ_C = ${fmt(cur.gamma)} > 1，Mcrit ≈ ${fmt(cur.Mcrit, 1)}；M_C = ${fmt(cur.M, 1)} > Mcrit：已越过阈值，具备强递归自加速潜力。`;
  cv.rect(MARGIN, y - 40, CONTENT_W, 44, { fill: cur.Mcrit === null ? C.goldSoft : C.blueSoft });
  cv.paragraph(MARGIN + 10, y - 10, verdict, { size: 9.5, maxWidth: CONTENT_W - 20, maxLines: 2 });
  y -= 60;

  y = sectionLabel(cv, MARGIN, y, '战略启示');
  const hints = [
    ['相变不会因为“上线”自动出现。', '静态 Canvas 只能给结构估计；临界点要靠闭环证据支撑。'],
    ['越过阈值前，优先养资产、补闭环、压低耗散。', `当前 μ_C = ${fmt(cur.mu, 3)}（${cur.muBand}）；Top 耗散源：${cur.muTop3.map((t) => t.label).join(' / ')}。`],
    ['越过阈值后，才讨论强递归自加速。', 'γ_C > 1 且 M_C > Mcrit 同时成立才显示“强递归潜力”。'],
  ];
  const hw = (CONTENT_W - 16) / 3;
  hints.forEach(([t, s], i) => {
    const x = MARGIN + i * (hw + 8);
    cv.rect(x, y - 78, hw, 78, { fill: C.panel });
    cv.text(x + 10, y - 18, `0${i + 1}`, { size: 14, color: C.navy });
    cv.paragraph(x + 10, y - 36, t, { size: 8.5, maxWidth: hw - 20, maxLines: 2 });
    cv.paragraph(x + 10, y - 60, s, { size: 7.5, maxWidth: hw - 20, maxLines: 2, color: C.muted });
  });
  y -= 92;
  cv.paragraph(MARGIN, y, 'Mcrit 是基于静态 Canvas 的结构估计（K_C·β_C·M^γ = μ_C·M 的非零解），不代表生产系统真实相变阈值。γ 越接近 1，Mcrit 对 μ/K 的比值越敏感。', { size: 7.5, color: C.muted, maxWidth: CONTENT_W, maxLines: 2 });
}

/* ------------------------------------------------------------------ P3 */
function pageEvidence(cv, d) {
  let y = header(cv, d, 3, '3 · 当前实证卡片', '只把同一个 MAAU Canvas 转成“当前结构证据”；不引用外部案例');
  const colW = (CONTENT_W - 12) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + 12;
  const topY = y;

  // left: facts
  let ly = sectionLabel(cv, leftX, y, '事实（从 Canvas 提取）');
  const regions = [
    ['Human / Agent', d.canvas.humanAgent],
    ['Workflow', d.canvas.workflow],
    ['Context', d.canvas.context],
    ['Validation', d.canvas.validation],
  ];
  regions.forEach(([name, txt]) => {
    cv.text(leftX, ly, name, { size: 8.5, color: C.navy });
    ly -= 12;
    const used = cv.paragraph(leftX, ly, txt || '（未提供）', { size: 8, maxWidth: colW, maxLines: 4, color: C.ink });
    ly -= used + 6;
  });

  // right: params
  let ry = sectionLabel(cv, rightX, y, '估算参数（Canvas-derived）');
  const params = [
    ['γ_C', fmt(d.current.gamma), STATE_COLOR[d.current.state]],
    ['β_C', fmt(d.current.beta), C.muted],
    ['μ_C', fmt(d.current.mu, 3), C.gold],
    ['M_C', fmt(d.current.M, 1), C.navy],
    ['Mcrit', d.current.Mcrit === null ? '不成立（γ≤1）' : `${fmt(d.current.Mcrit, 1)} → ${{ below: '未越过', near: '临界', above: '已越过' }[d.current.position]}`, C.navy],
  ];
  params.forEach(([k, v, c]) => {
    cv.rect(rightX, ry - 20, colW, 22, { fill: C.panel });
    cv.text(rightX + 8, ry - 14, k, { size: 9, color: C.muted });
    cv.text(rightX + 60, ry - 14, v, { size: 10.5, color: c });
    ry -= 26;
  });
  ry -= 16;
  ry = sectionLabel(cv, rightX, ry, '闭环保护方式');
  cv.rect(rightX, ry - 44, colW, 48, { fill: C.blueSoft });
  cv.paragraph(rightX + 8, ry - 10, d.current.protection || '（Canvas 未说明；建议补充：隔离边界 / 写回 / 版本化 / 抽检）', { size: 8.5, maxWidth: colW - 16, maxLines: 3 });
  ry -= 60;

  y = Math.min(ly, ry) - 6;

  // loops table
  y = sectionLabel(cv, MARGIN, y, '五条闭环证据（γ_C 只由这些闭环触发）');
  cv.text(MARGIN, y, '闭环', { size: 8, color: C.muted });
  cv.text(MARGIN + 150, y, '分', { size: 8, color: C.muted });
  cv.text(MARGIN + 175, y, '权重', { size: 8, color: C.muted });
  cv.text(MARGIN + 215, y, 'Canvas 原文证据', { size: 8, color: C.muted });
  y -= 6;
  cv.line(MARGIN, y, PAGE.w - MARGIN, y);
  y -= 13;
  d.loops.forEach((l) => {
    const color = l.score === 1 ? C.green : l.score === 0.5 ? C.gold : C.red;
    cv.text(MARGIN, y, `${l.key} ${l.label}`, { size: 8.5 });
    cv.circle(MARGIN + 154, y + 3, 3.5, color);
    cv.text(MARGIN + 160, y, fmt(l.score, 1), { size: 8.5 });
    cv.text(MARGIN + 178, y, fmt(l.weight, 2), { size: 8.5, color: C.muted });
    const q = l.evidence && l.evidence.quote ? `「${l.evidence.quote}」${l.evidence.region ? '（' + l.evidence.region + '）' : ''}` : '（无证据 → 0 分）';
    const used = cv.paragraph(MARGIN + 215, y, q, { size: 8, maxWidth: CONTENT_W - 215, maxLines: 2, color: C.muted });
    y -= Math.max(14, used + 4);
  });
  y -= 6;

  // dissipation top3
  y = sectionLabel(cv, MARGIN, y, `Top 3 耗散源（μ_C = ${fmt(d.current.mu, 3)}，${d.current.muBand}）`);
  const tw = (CONTENT_W - 16) / 3;
  d.current.muTop3.forEach((t, i) => {
    const x = MARGIN + i * (tw + 8);
    const full = d.dissipation.find((k) => k.key === t.key);
    cv.rect(x, y - 64, tw, 64, { fill: C.goldSoft });
    cv.text(x + 8, y - 16, `${t.key} ${t.label}`, { size: 9.5, color: C.ink });
    cv.text(x + tw - 8, y - 16, `${fmt(t.score, 2)} × ${fmt(t.weight, 2)}`, { size: 8, color: C.muted, align: 'right' });
    scoreBar(cv, x + 8, y - 26, tw - 16, 5, t.score, C.gold);
    cv.paragraph(x + 8, y - 40, full && full.evidence ? `「${full.evidence.quote}」` : '', { size: 7.5, maxWidth: tw - 16, maxLines: 2, color: C.muted });
  });
}

/* ------------------------------------------------------------------ P4 */
function pageStress(cv, d) {
  let y = header(cv, d, 4, '4 · 退化压力测试', '如果破坏闭环会怎样：同一 Canvas 在固定假设下重新计算，解释“为什么退化”');
  cv.rect(MARGIN, y - 40, CONTENT_W, 40, { fill: C.panel });
  cv.text(MARGIN + 10, y - 16, d.stress.assumption, { size: 10.5, color: C.navy });
  cv.text(MARGIN + 10, y - 31, '变换规则固定、与 Canvas 无关：审批闸门密度=1、核心步骤人工依赖=1、Agent 自主性=0；L1/L2/L5 减半，L3/L4 ≤ 0.5；H ≥ 0.8，F ≥ 0.6。', { size: 7.5, color: C.muted });
  y -= 56;

  // before/after bars
  const rows = [
    ['γ 递归自反馈指数', d.current.gamma, d.stress.gamma, 1.4],
    ['β 组织杠杆弹性', d.current.beta, d.stress.beta, 1.4],
    ['μ 结构性耗散率', d.current.mu, d.stress.mu, 1.0],
  ];
  const labelW = 120;
  const barW = CONTENT_W - labelW - 70;
  rows.forEach(([label, a, b, max]) => {
    cv.text(MARGIN, y - 4, label, { size: 9 });
    scoreBar(cv, MARGIN + labelW, y - 2, barW, 8, a / max, C.blue);
    cv.text(MARGIN + labelW + barW + 6, y - 4, fmt(a, label.startsWith('μ') ? 3 : 2), { size: 8.5, color: C.blue });
    scoreBar(cv, MARGIN + labelW, y - 14, barW, 8, b / max, C.gold);
    cv.text(MARGIN + labelW + barW + 6, y - 16, fmt(b, label.startsWith('μ') ? 3 : 2), { size: 8.5, color: C.gold });
    if (label.startsWith('γ')) {
      const xs = MARGIN + labelW + (1 / max) * barW;
      cv.line(xs, y + 2, xs, y - 16, { color: C.red, width: 0.8, dash: [2, 2] });
      cv.text(xs + 3, y - 24, 'γ = 1', { size: 7, color: C.red });
    }
    y -= 34;
  });
  cv.rect(MARGIN + labelW, y + 4, 10, 6, { fill: C.blue });
  cv.text(MARGIN + labelW + 14, y + 3, '当前 Canvas', { size: 7.5, color: C.muted });
  cv.rect(MARGIN + labelW + 80, y + 4, 10, 6, { fill: C.gold });
  cv.text(MARGIN + labelW + 94, y + 3, '退化压力测试', { size: 7.5, color: C.muted });
  y -= 20;

  // state transition
  const half = (CONTENT_W - 12) / 2;
  const box = (x, title, s, fill) => {
    cv.rect(x, y - 96, half, 96, { fill });
    cv.text(x + 10, y - 16, title, { size: 9, color: C.muted });
    cv.text(x + 10, y - 36, s.stateLabel, { size: 15, color: STATE_COLOR[s.state] });
    cv.text(x + 10, y - 54, `γ = ${fmt(s.gamma)}   β = ${fmt(s.beta)}   μ = ${fmt(s.mu, 3)}（${s.muBand}）`, { size: 8.5 });
    cv.text(x + 10, y - 70, s.Mcrit === null ? 'Mcrit：不成立（γ ≤ 1）' : `M = ${fmt(d.current.M, 1)} / Mcrit = ${fmt(s.Mcrit, 1)} → ${{ below: '未越过', near: '临界', above: '已越过' }[s.position]}`, { size: 8.5 });
    cv.text(x + 10, y - 86, `K_C·β_C = ${fmt(s.Keff, 3)}`, { size: 8, color: C.muted });
  };
  box(MARGIN, '当前结构诊断', d.current, C.blueSoft);
  box(MARGIN + half + 12, '退化压力测试', d.stress, C.goldSoft);
  cv.text(MARGIN + half + 6, y - 52, '→', { size: 14, color: C.muted, align: 'center' });
  y -= 112;

  y = sectionLabel(cv, MARGIN, y, `原因：γ ${fmt(d.current.gamma)} → ${fmt(d.stress.gamma)}，μ ${fmt(d.current.mu, 3)} → ${fmt(d.stress.mu, 3)}`);
  cv.paragraph(MARGIN, y, d.stress.reason, { size: 9, maxWidth: CONTENT_W, maxLines: 3 });
  y -= 44;

  // loop-by-loop change table
  y = sectionLabel(cv, MARGIN, y, '闭环逐条变化');
  const cw = (CONTENT_W - 32) / 5;
  d.loops.forEach((l, i) => {
    const x = MARGIN + i * (cw + 8);
    cv.rect(x, y - 58, cw, 58, { fill: C.panel });
    cv.text(x + 6, y - 14, l.key, { size: 9, color: C.navy });
    cv.paragraph(x + 6, y - 26, l.label, { size: 6.8, maxWidth: cw - 12, maxLines: 1, color: C.muted });
    cv.text(x + 6, y - 46, `${fmt(l.score, 1)} → ${fmt(l.stressScore, 2)}`, { size: 10, color: l.stressScore < l.score ? C.red : C.ink });
  });
  y -= 74;

  y = sectionLabel(cv, MARGIN, y, '闭环保护方式');
  cv.rect(MARGIN, y - 40, CONTENT_W, 44, { fill: C.blueSoft });
  cv.paragraph(MARGIN + 10, y - 10, d.current.protection || '（Canvas 未说明；建议：专家只抽检异常，主流程允许 Agent 自主执行与写回。）', { size: 9, maxWidth: CONTENT_W - 20, maxLines: 2 });
  y -= 56;
  cv.text(MARGIN, y, '核心教训：报告要能解释“为什么退化”，而不是只输出一个分数。', { size: 9, color: C.navy });
}

/* ------------------------------------------------------------------ P5 */
function pageMap(cv, d) {
  let y = header(cv, d, 5, '5 · 共性图谱与输出规范', '贴近参考图的参数表；不扩展到 TAM / ARR / CAC / 估值等商业指标');

  const cols = [MARGIN, MARGIN + 110, MARGIN + 170, MARGIN + 240, MARGIN + 310];
  const heads = ['诊断对象', 'γ', 'β', 'μ', '闭环保护方式'];
  cv.rect(MARGIN, y - 18, CONTENT_W, 20, { fill: C.navy });
  heads.forEach((h, i) => cv.text(cols[i] + 6, y - 12, h, { size: 8.5, color: C.white }));
  y -= 18;
  const rows = [
    ['当前 Canvas', fmt(d.current.gamma), fmt(d.current.beta), fmt(d.current.mu, 3), d.current.protection || '—', C.blueSoft],
    ['退化压力测试', fmt(d.stress.gamma), fmt(d.stress.beta), fmt(d.stress.mu, 3), d.stress.protection, C.goldSoft],
    ['目标结构', d.target.gamma, d.target.beta, d.target.mu, d.target.protection, C.panel],
  ];
  rows.forEach(([n, g, b, m, p, fill]) => {
    const lines = cv.wrap(p, 8, CONTENT_W - 316);
    const h = Math.max(24, 12 + lines.length * 11);
    cv.rect(MARGIN, y - h, CONTENT_W, h, { fill });
    cv.text(cols[0] + 6, y - 15, n, { size: 9 });
    cv.text(cols[1] + 6, y - 15, g, { size: 9.5 });
    cv.text(cols[2] + 6, y - 15, b, { size: 9.5 });
    cv.text(cols[3] + 6, y - 15, m, { size: 9.5 });
    cv.paragraph(cols[4] + 6, y - 15, p, { size: 8, maxWidth: CONTENT_W - 316, maxLines: 3 });
    y -= h;
  });
  y -= 22;

  // dissipation profile
  y = sectionLabel(cv, MARGIN, y, '耗散画像（H/D/K/B/F，当前 vs 退化）');
  const dw = (CONTENT_W - 32) / 5;
  d.dissipation.forEach((k, i) => {
    const x = MARGIN + i * (dw + 8);
    cv.rect(x, y - 70, dw, 70, { fill: C.panel });
    cv.text(x + 6, y - 14, `${k.key} ${k.label}`, { size: 8.5 });
    scoreBar(cv, x + 6, y - 28, dw - 12, 6, k.score, C.blue);
    scoreBar(cv, x + 6, y - 40, dw - 12, 6, k.stressScore, C.gold);
    cv.text(x + 6, y - 56, `${fmt(k.score, 2)} → ${fmt(k.stressScore, 2)}`, { size: 8.5, color: k.stressScore > k.score ? C.red : C.ink });
    cv.text(x + dw - 6, y - 56, `w ${fmt(k.weight, 2)}`, { size: 7, color: C.muted, align: 'right' });
  });
  y -= 88;

  // fixed 5-page spec
  y = sectionLabel(cv, MARGIN, y, '固定 5 页报告');
  const pages = [
    ['P1', '三档状态', 'Task / 普通 / 强递归'],
    ['P2', '动力学', '增长项 vs 耗散项 + Mcrit'],
    ['P3', '当前实证', '事实 / 参数 / 保护机制'],
    ['P4', '退化测试', '闭环被破坏时 γ / μ 如何变化'],
    ['P5', '共性图谱', 'γ / β / μ / 闭环保护方式'],
  ];
  const pw = (CONTENT_W - 32) / 5;
  pages.forEach(([p, t, s], i) => {
    const x = MARGIN + i * (pw + 8);
    cv.rect(x, y - 56, pw, 56, { fill: C.blueSoft });
    cv.text(x + 6, y - 16, p, { size: 11, color: C.navy });
    cv.text(x + 6, y - 30, t, { size: 8.5 });
    cv.paragraph(x + 6, y - 44, s, { size: 6.8, maxWidth: pw - 12, maxLines: 2, color: C.muted });
  });
  y -= 74;

  // traceability
  y = sectionLabel(cv, MARGIN, y, '可追溯性（每个参数 → Canvas 区块 → 规则）');
  d.evidenceIndex.forEach((e) => {
    cv.text(MARGIN, y, e.parameter, { size: 8.5, color: C.navy });
    cv.text(MARGIN + 44, y, e.from, { size: 8, color: C.muted });
    cv.text(MARGIN + 210, y, e.regions.join(' + '), { size: 8 });
    y -= 12;
  });
  y -= 6;
  y = sectionLabel(cv, MARGIN, y, '工程验收底线');
  const rules = [
    '所有 M / γ / μ / β 都能回溯到 Canvas 原文证据与规则（见 P3 与 diagnosis.json）。',
    '相同结构化输入必须得到相同确定性数值（compute.cjs 为纯函数）。',
    'γ ≤ 1 时不得显示“已越过强递归相变阈值”；γ > 1 只由 L3 与 L4 闭环证据触发。',
    '所有示意 / 估算值标记 Canvas-derived，不冒充生产实测。',
  ];
  rules.forEach((r) => {
    cv.circle(MARGIN + 2, y + 3, 1.8, C.navy);
    y -= cv.paragraph(MARGIN + 10, y, r, { size: 8, maxWidth: CONTENT_W - 10, maxLines: 2, color: C.ink }) + 2;
  });
}

async function renderReport(diagnosis, fontPath) {
  if (!diagnosis.preflight || !diagnosis.preflight.ok) throw new Error(`Preflight failed: ${diagnosis.preflight && diagnosis.preflight.message}`);
  if (diagnosis.errors && diagnosis.errors.length) throw new Error(`Input errors: ${diagnosis.errors.join('; ')}`);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(fontPath)); // no subset (see header comment)
  doc.setTitle(`AI 原生递归资产诊断报告 · ${diagnosis.project.name}`);
  doc.setSubject('MAAU Canvas-derived estimate');
  doc.setProducer('maau-recursive-asset-report');
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const pages = [pageOverview, pageDynamics, pageEvidence, pageStress, pageMap];
  for (const draw of pages) {
    const page = doc.addPage([PAGE.w, PAGE.h]);
    draw(new Canvas(page, font), diagnosis);
  }
  return doc.save({ useObjectStreams: false });
}

module.exports = { renderReport, resolveFont };

if (require.main === module) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--font');
  const explicitFont = fi >= 0 ? args.splice(fi, 2)[1] : undefined;
  const [inputPath, outputPath] = args;
  if (!inputPath || !outputPath) {
    console.error('usage: node render-report.cjs <diagnosis.json> <out.pdf> [--font cjk.otf]');
    process.exit(2);
  }
  (async () => {
    const fontPath = resolveFont(explicitFont);
    const diagnosis = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const bytes = await renderReport(diagnosis, fontPath);
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, bytes);
    console.log(`wrote ${outputPath} (${bytes.length} bytes, 5 pages, font ${fontPath})`);
  })().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}
