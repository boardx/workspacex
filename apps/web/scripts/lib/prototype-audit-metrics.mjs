/**
 * 原型截图审计——**机器硬判**那一半（2026-09-09 人类指令：「你做完一次设计，界面出来
 * 以后，你要有一个机制，做截图 audit，迭代到 80 分才放行」）。
 *
 * ## 为什么要有这道门
 *
 * 迭代 14 把「设备镜头默认跟 template 走」做完，单测全绿、CI 全绿、22 条 check 全绿，
 * 而用户打开看到的是**移动端聊天内容被塞进 1280×800 的笔记本画板**，下面 600px 全空。
 * 没有任何一道既有门看过它长什么样——所有门看的都是「代码对不对」，没有一道看「它长得
 * 像不像个东西」。这个文件就是补这一道。
 *
 * ## 硬判与软判分开记（人类裁决）
 *
 * 本文件只算**能量化的**。主观的（「看起来专不专业」）交给视觉模型软判，两个分数分开
 * 报、分开卡——机器分不许被模型分抵消。本仓已经栽过「测试为了错误的理由通过」，让模型
 * 给自己的产出打分再用它盖掉机器分，就是把那个坑重挖一遍。
 *
 * ## 每条指标都必须能被「造坏」证伪
 *
 * 见 `prototype-audit-metrics.test.ts`：每条指标各有一组「好样本得高分 / 坏样本得低分」
 * 的断言。一条永远给高分的指标等于没有这条指标。
 */

/** 画板与其内容的度量，由浏览器里的 `measure()` 采集（纯数据，不含 DOM）。 */
/**
 * @typedef {{ w:number, h:number }} Box
 * @typedef {{ x:number, y:number, w:number, h:number, fontSize:number, clipped:boolean, tag:string }} Node
 * @typedef {{ frame: Box, nodes: Node[] }} Sample
 */

/** 内容外接盒占画板的面积比。 */
export function contentFillRatio(sample) {
  const { frame, nodes } = sample;
  if (frame.w <= 0 || frame.h <= 0 || nodes.length === 0) return null;
  const x0 = Math.min(...nodes.map((n) => n.x));
  const y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x + n.w));
  const y1 = Math.max(...nodes.map((n) => n.y + n.h));
  return Math.max(0, Math.min(1, ((x1 - x0) * (y1 - y0)) / (frame.w * frame.h)));
}

/**
 * M1 内容占比。这条专治用户截图里那个 600px 空白。
 * < 0.35 判重伤：内容只占三分之一画板，说明画板尺寸选错了，不是「留白设计」。
 */
export function scoreFill(sample) {
  const r = contentFillRatio(sample);
  if (r === null) return { score: 0, note: "画板或内容为空——拒绝下判断" };
  if (r >= 0.6) return { score: 100, note: `内容占画板 ${pct(r)}` };
  if (r >= 0.35) return { score: 60 + ((r - 0.35) / 0.25) * 40, note: `内容占画板 ${pct(r)}，偏空` };
  return { score: Math.max(0, (r / 0.35) * 60), note: `内容只占画板 ${pct(r)}——画板尺寸多半选错了` };
}

/**
 * M2 溢出裁切：内容被容器切掉且**不给省略号**才算缺陷。
 *
 * ⚠ `clipped` 的判据在采集侧（`prototype-audit.mjs` 的 `measureInPage`）就排除了
 * `text-overflow: ellipsis`。首跑时没排除，两条带省略号的图层名被判成缺陷、门红在一个
 * 不存在的问题上。省略号是**告知**不是缺陷；会误报的门迟早被调松或被无视。
 */
export function scoreClipping(sample) {
  const clipped = sample.nodes.filter((n) => n.clipped);
  if (sample.nodes.length === 0) return { score: 0, note: "没有节点——拒绝下判断" };
  if (clipped.length === 0) return { score: 100, note: "没有被裁切的内容" };
  return { score: Math.max(0, 100 - clipped.length * 25), note: `${clipped.length} 处内容被容器裁掉` };
}

/**
 * M3 字号层次。只有一档 ⇒ 没有层次，全是同一个字号（用户截图的问题之一）；
 * 超过 6 档 ⇒ 没有档位制，各写各的。
 */
export function scoreTypeScale(sample) {
  const sizes = [...new Set(sample.nodes.map((n) => Math.round(n.fontSize)).filter((s) => s > 0))];
  if (sizes.length === 0) return { score: 0, note: "量不到字号——拒绝下判断" };
  if (sizes.length === 1) return { score: 30, note: "只有 1 档字号，标题与正文一样大，没有层次" };
  if (sizes.length === 2) return { score: 70, note: "只有 2 档字号" };
  if (sizes.length <= 6) return { score: 100, note: `${sizes.length} 档字号` };
  return { score: Math.max(0, 100 - (sizes.length - 6) * 15), note: `${sizes.length} 档字号，太碎` };
}

/**
 * M4 对齐轴。同一层的元素左边缘应该落在少数几条轴上；轴数接近元素数 ⇒ 每个都自己一个
 * 位置，就是「看起来乱」。容差 2px（子像素与边框）。
 */
export function scoreAlignment(sample) {
  const xs = sample.nodes.map((n) => Math.round(n.x));
  if (xs.length < 3) return { score: 100, note: "元素太少，不判对齐" };
  const axes = [];
  for (const x of xs.sort((a, b) => a - b)) {
    if (axes.length === 0 || x - axes[axes.length - 1] > 2) axes.push(x);
  }
  const ratio = axes.length / xs.length;
  if (ratio <= 0.35) return { score: 100, note: `${xs.length} 个元素对齐到 ${axes.length} 条轴` };
  if (ratio <= 0.6) return { score: 100 - ((ratio - 0.35) / 0.25) * 40, note: `${axes.length} 条对齐轴，偏散` };
  return { score: Math.max(0, 60 - ((ratio - 0.6) / 0.4) * 60), note: `${xs.length} 个元素散在 ${axes.length} 条轴上` };
}

/**
 * M5 墨水密度：**叶子**元素面积之和 ÷ 画板面积。
 *
 * ⚠ 这条是首跑实测逼出来的，记下来因为它正是「指标会因为错误的理由判绿」的活例子：
 * M1 量的是内容**外接盒**，而人类那张截图里输入框贴在画板底部、导航贴在顶部，外接盒
 * 是满的 —— M1 给 90 分放行，可中间大片是空的，人一眼就看出不专业。
 * 外接盒答的是「内容摊到哪」，答不了「这块画板上到底有多少东西」。
 *
 * 只数**叶子**（没有同样带 `data-proto` 的后代），否则父容器会把孩子的面积重复计一遍，
 * 密度轻松超过 1，又变成一条恒绿的指标。
 */
export function inkRatio(sample) {
  const { frame, nodes } = sample;
  if (frame.w <= 0 || frame.h <= 0 || nodes.length === 0) return null;
  const leaves = nodes.filter((n) => !nodes.some((o) => o !== n && contains(n, o)));
  const ink = leaves.reduce((sum, n) => sum + n.w * n.h, 0);
  return Math.max(0, Math.min(1, ink / (frame.w * frame.h)));
}

function contains(outer, inner) {
  return inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5
    && inner.x + inner.w <= outer.x + outer.w + 0.5
    && inner.y + inner.h <= outer.y + outer.h + 0.5
    && (inner.w * inner.h) < (outer.w * outer.h);
}

/** M5 密度打分。阈值按实测标定：手机画板的正常稿在 0.25 以上。 */
export function scoreDensity(sample) {
  const r = inkRatio(sample);
  if (r === null) return { score: 0, note: "画板或内容为空——拒绝下判断" };
  if (r >= 0.25) return { score: 100, note: `内容密度 ${pct(r)}` };
  if (r >= 0.12) return { score: 55 + ((r - 0.12) / 0.13) * 45, note: `内容密度 ${pct(r)}，偏稀` };
  return { score: Math.max(0, (r / 0.12) * 55), note: `内容密度只有 ${pct(r)}——画板太大或内容太少，看起来是空的` };
}

const WEIGHTS = { fill: 0.2, density: 0.25, clipping: 0.2, typeScale: 0.175, alignment: 0.175 };

/**
 * 机器总分 = 各条加权。权重写死在这里，是唯一事实源。
 *
 * `only` 限定这次只判哪几条（权重按所选项**重新归一**，不是把没判的当 0 分）。
 * 用途：画布量程只问「画板在画布上占多大」，问它「字号有几档」没有意义——
 * 硬塞一个 0 分会让这条量程永远红，而一条永远红的门等于没有门（本仓 #3151 的教训）。
 */
export function machineScore(sample, only = null) {
  const all = {
    fill: scoreFill(sample),
    density: scoreDensity(sample),
    clipping: scoreClipping(sample),
    typeScale: scoreTypeScale(sample),
    alignment: scoreAlignment(sample),
  };
  const keys = only === null ? Object.keys(WEIGHTS) : only.filter((k) => k in WEIGHTS);
  if (keys.length === 0) return { total: 0, parts: {}, weights: {} };
  const sumW = keys.reduce((s, k) => s + WEIGHTS[k], 0);
  const parts = Object.fromEntries(keys.map((k) => [k, all[k]]));
  const total = keys.reduce((sum, k) => sum + all[k].score * (WEIGHTS[k] / sumW), 0);
  return { total: Math.round(total), parts, weights: Object.fromEntries(keys.map((k) => [k, WEIGHTS[k] / sumW])) };
}

function pct(r) { return `${String(Math.round(r * 100))}%`; }

/** Clipping is a hard defect; other metrics cannot compensate for it. */
export function assertNoClipping(sample) {
  if (sample.nodes.length === 0) throw new Error("没有节点——拒绝下判断");
  const count = sample.nodes.filter((node) => node.clipped).length;
  if (count > 0) throw new Error(`零裁切门失败：${count} 处内容被容器裁掉`);
}
