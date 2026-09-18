#!/usr/bin/env node
'use strict';
/**
 * compute.cjs — MAAU Canvas 结构化证据 → 确定性 M_C / γ_C / μ_C / β_C / K_C / Mcrit。
 *
 * 规则的人类可读版本在 ../references/model.md；本文件是它的唯一可执行实现。
 * 两者若不一致，以本文件的数值为准并同步修 model.md（同一事实不得声明在两处却漂移）。
 *
 * 用法：node compute.cjs <canvas-evidence.json> [diagnosis.json]
 *   省略第二个参数时把结果打印到 stdout。
 *   也可 require：const { computeDiagnosis } = require('./compute.cjs')。
 *
 * 不变量：
 *  - 纯函数：相同输入 → 相同输出（无随机、无时间、无环境依赖）。
 *  - γ_C > 1 只可能在 L3(Output→Asset) 与 L4(Asset→New Asset) 两条闭环都为 1 时出现。
 *  - γ_C ≤ 1 时 Mcrit 为 null，报告不得显示"已越过强递归相变阈值"。
 *  - 所有数值都是 Canvas-derived estimate，不是生产实测。
 */
const fs = require('node:fs');

const MODEL_VERSION = '0.2.0';
const LOOP_KEYS = ['L1', 'L2', 'L3', 'L4', 'L5'];
const LOOP_LABELS = {
  L1: 'Validation → Workflow',
  L2: 'Validation → Context',
  L3: 'Output → Asset',
  L4: 'Asset → New Asset',
  L5: 'Human Feedback → Agent',
};
const LOOP_WEIGHTS = { L1: 0.15, L2: 0.15, L3: 0.25, L4: 0.25, L5: 0.2 };
const GAMMA_MAX = 1.4;
const GAMMA_TASK_AGENT_MAX = 0.2; // γ < 0.2 视为"γ ≈ 0"（任务 Agent）

const DISSIPATION_KEYS = ['H', 'D', 'K', 'B', 'F'];
const DISSIPATION_LABELS = {
  H: '人工依赖',
  D: '数据依赖',
  K: '知识过期',
  B: '流程脆弱',
  F: '反馈薄弱',
};
const DISSIPATION_WEIGHTS = { H: 0.25, D: 0.15, K: 0.2, B: 0.2, F: 0.2 };

const ASSET_TYPES = ['Agent', 'Workflow', 'Knowledge', 'Eval', 'Pattern'];
const ASSET_DIMS = ['E', 'R', 'I', 'V'];
const ASSET_DIM_LABELS = { E: '明确度', R: '可复用性', I: '独立调用', V: '可验证性' };

const REQUIRED_REGIONS = ['workflow', 'context', 'validation'];
const ALL_REGIONS = ['intent', 'user', 'humanAgent', 'workflow', 'context', 'validation'];

const TARGET = { gamma: '> 1.0', beta: '1.15–1.30', mu: '< 0.20', protection: '隔离边界 / 写回 / 版本化 / 抽检' };

function round(x, digits = 3) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}
function isTernary(x) {
  return x === 0 || x === 0.5 || x === 1;
}
function isUnit(x) {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
}
function nonEmpty(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

/** 输入校验 + Preflight。返回 { errors, missingRegions }。 */
function validateInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { errors: ['input must be an object'], missingRegions: [] };
  if (!input.project || !nonEmpty(input.project.name)) errors.push('project.name is required');
  const canvas = input.canvas || {};
  const missingRegions = REQUIRED_REGIONS.filter((r) => !nonEmpty(canvas[r]));

  if (!Array.isArray(input.assets)) errors.push('assets must be an array');
  else
    input.assets.forEach((a, i) => {
      if (!a || !nonEmpty(a.name)) errors.push(`assets[${i}].name is required`);
      if (!ASSET_TYPES.includes(a && a.type)) errors.push(`assets[${i}].type must be one of ${ASSET_TYPES.join('|')}`);
      for (const d of ASSET_DIMS) if (!isTernary(a && a[d])) errors.push(`assets[${i}].${d} must be 0 | 0.5 | 1`);
      if (!a || !a.evidence || !nonEmpty(a.evidence.quote)) errors.push(`assets[${i}].evidence.quote is required`);
    });

  const loops = input.loops || {};
  for (const k of LOOP_KEYS) {
    const l = loops[k];
    if (!l || !isTernary(l.score)) errors.push(`loops.${k}.score must be 0 | 0.5 | 1`);
    else if (l.score > 0 && !(l.evidence && nonEmpty(l.evidence.quote))) errors.push(`loops.${k}.evidence.quote is required when score > 0`);
  }
  const dis = input.dissipation || {};
  for (const k of DISSIPATION_KEYS) {
    const d = dis[k];
    if (!d || !isUnit(d.score)) errors.push(`dissipation.${k}.score must be a number in [0,1]`);
    else if (!(d.evidence && nonEmpty(d.evidence.quote))) errors.push(`dissipation.${k}.evidence.quote is required`);
  }
  const fr = input.friction || {};
  for (const k of ['coreStepHumanDependency', 'approvalGateDensity', 'agentAutonomy']) {
    if (!fr[k] || !isUnit(fr[k].score)) errors.push(`friction.${k}.score must be a number in [0,1]`);
  }
  const gr = input.growth || {};
  for (const k of ['contextSupply', 'agentWorkflowMaturity', 'outputToAssetConversion']) {
    if (!gr[k] || !isUnit(gr[k].score)) errors.push(`growth.${k}.score must be a number in [0,1]`);
  }
  return { errors, missingRegions };
}

function computeAssets(assets) {
  const items = assets.map((a) => {
    const value = round((a.E + a.R + a.I + a.V) / 4, 3);
    return { name: a.name, type: a.type, E: a.E, R: a.R, I: a.I, V: a.V, value, evidence: a.evidence };
  });
  const M = round(items.reduce((s, a) => s + a.value, 0), 2);
  const byType = {};
  for (const t of ASSET_TYPES) byType[t] = round(items.filter((a) => a.type === t).reduce((s, a) => s + a.value, 0), 2);
  return { M, count: items.length, items, byType };
}

function computeGamma(loops) {
  const weighted = LOOP_KEYS.reduce((s, k) => s + LOOP_WEIGHTS[k] * loops[k], 0);
  const raw = GAMMA_MAX * weighted;
  const closedDerivation = loops.L3 === 1 && loops.L4 === 1;
  const gamma = round(closedDerivation ? raw : Math.min(raw, 1), 3);
  const capped = !closedDerivation && raw > 1;
  const state = gamma < GAMMA_TASK_AGENT_MAX ? 'task-agent' : gamma > 1 ? 'strong-recursive' : 'ordinary-maau';
  return { gamma, weighted: round(weighted, 3), capped, closedDerivation, state };
}

function computeMu(dis) {
  const contributions = DISSIPATION_KEYS.map((k) => ({
    key: k,
    label: DISSIPATION_LABELS[k],
    score: dis[k],
    weight: DISSIPATION_WEIGHTS[k],
    contribution: round(DISSIPATION_WEIGHTS[k] * dis[k], 4),
  }));
  const mu = round(contributions.reduce((s, c) => s + c.contribution, 0), 3);
  const band = mu <= 0.25 ? 'Low' : mu <= 0.5 ? 'Moderate' : 'High';
  const top3 = [...contributions]
    .sort((a, b) => b.contribution - a.contribution || a.key.localeCompare(b.key))
    .slice(0, 3);
  return { mu, band, contributions, top3 };
}

function computeBeta(fr) {
  const beta = 0.85 + 0.25 * fr.agentAutonomy + 0.15 * (1 - fr.coreStepHumanDependency) + 0.15 * (1 - fr.approvalGateDensity);
  return round(beta, 3);
}

function computeK(gr) {
  const mean = (gr.contextSupply + gr.agentWorkflowMaturity + gr.outputToAssetConversion) / 3;
  return round(0.05 + 0.2 * mean, 4);
}

/** Mcrit：K_eff·M^γ = μ·M ⇒ M^(γ−1) = μ/K_eff。仅 γ>1 有超线性临界点。 */
function computeMcrit(gamma, mu, K, beta, M) {
  const Keff = round(K * beta, 4);
  if (!(gamma > 1)) return { Keff, Mcrit: null, position: 'no-superlinear-threshold', ratio: null };
  if (mu <= 0) return { Keff, Mcrit: 0, position: 'above', ratio: null };
  const Mcrit = round(Math.pow(mu / Keff, 1 / (gamma - 1)), 2);
  const ratio = Mcrit > 0 ? round(M / Mcrit, 3) : null;
  let position;
  if (Mcrit === 0) position = 'above';
  else if (Math.abs(M - Mcrit) / Mcrit < 0.1) position = 'near';
  else position = M > Mcrit ? 'above' : 'below';
  return { Keff, Mcrit, position, ratio };
}

/**
 * 退化压力测试（固定假设：所有关键步骤改成"全量人工审批"）。
 * 变换是确定性的、与 Canvas 无关的规则：
 *  - friction：approvalGateDensity=1, coreStepHumanDependency=1, agentAutonomy=0
 *  - loops：L1/L2/L5 减半（审批闸门切断回灌），L3/L4 上限 0.5（派生链被人工重写打断）
 *  - dissipation：H = max(H, 0.8)，F = max(F, 0.6)，其余不变
 *  - growth：outputToAssetConversion 减半
 */
function stressTransform(scores) {
  const loops = {
    L1: scores.loops.L1 / 2,
    L2: scores.loops.L2 / 2,
    L3: Math.min(scores.loops.L3, 0.5),
    L4: Math.min(scores.loops.L4, 0.5),
    L5: scores.loops.L5 / 2,
  };
  const dissipation = { ...scores.dissipation, H: Math.max(scores.dissipation.H, 0.8), F: Math.max(scores.dissipation.F, 0.6) };
  const friction = { coreStepHumanDependency: 1, approvalGateDensity: 1, agentAutonomy: 0 };
  const growth = { ...scores.growth, outputToAssetConversion: scores.growth.outputToAssetConversion / 2 };
  return { loops, dissipation, friction, growth };
}

function evaluate(scores, M) {
  const g = computeGamma(scores.loops);
  const m = computeMu(scores.dissipation);
  const beta = computeBeta(scores.friction);
  const K = computeK(scores.growth);
  const crit = computeMcrit(g.gamma, m.mu, K, beta, M);
  return { gamma: g, mu: m, beta, K, ...crit };
}

function extractScores(input) {
  const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k].score]));
  return {
    loops: pick(input.loops, LOOP_KEYS),
    dissipation: pick(input.dissipation, DISSIPATION_KEYS),
    friction: pick(input.friction, ['coreStepHumanDependency', 'approvalGateDensity', 'agentAutonomy']),
    growth: pick(input.growth, ['contextSupply', 'agentWorkflowMaturity', 'outputToAssetConversion']),
  };
}

function stateLabel(state) {
  return { 'task-agent': '任务 Agent', 'ordinary-maau': '普通 MAAU', 'strong-recursive': '强递归 MAAU' }[state];
}

function buildConclusion(assets, cur, loops) {
  const open = LOOP_KEYS.filter((k) => loops[k] < 1).map((k) => `${k} ${LOOP_LABELS[k]}`);
  const parts = [`当前 Canvas 的 γ_C = ${cur.gamma.gamma.toFixed(2)} → 判定为“${stateLabel(cur.gamma.state)}”。`];
  if (cur.gamma.capped) parts.push('闭环加权分本可高于 1，但 Output→Asset 或 Asset→New Asset 未完全闭合，γ_C 按规则封顶为 1.00。');
  if (open.length) parts.push(`主要短板：${open.join('、')} 未闭合。`);
  else parts.push('五条闭环均已闭合。');
  parts.push(`M_C = ${assets.M.toFixed(1)}（${assets.count} 个资产的有效递归资产等价单位）；μ_C = ${cur.mu.mu.toFixed(3)}（${cur.mu.band}）。`);
  if (cur.Mcrit === null) parts.push('γ_C ≤ 1，无超线性临界点；优先补闭环与压低耗散。');
  else if (cur.position === 'below') parts.push(`Mcrit ≈ ${cur.Mcrit}，M_C 尚未越过：飞轮尚未站稳，优先补资产与回灌。`);
  else if (cur.position === 'near') parts.push(`Mcrit ≈ ${cur.Mcrit}，M_C 处于临界状态：保护闭环，避免引入强审批摩擦。`);
  else parts.push(`Mcrit ≈ ${cur.Mcrit}，M_C 已越过且 γ_C > 1：具备强递归自加速潜力（Canvas-derived 结构估计）。`);
  return parts.join('');
}

function computeDiagnosis(input) {
  const { errors, missingRegions } = validateInput(input);
  if (missingRegions.length) {
    return {
      modelVersion: MODEL_VERSION,
      preflight: { ok: false, missingRegions, message: `缺少关键画布区块：${missingRegions.join(' / ')}。不生成正式 M / γ / μ；请先补充这些画布信息。` },
      errors,
    };
  }
  if (errors.length) return { modelVersion: MODEL_VERSION, preflight: { ok: true, missingRegions: [] }, errors };

  const scores = extractScores(input);
  const assets = computeAssets(input.assets);
  const current = evaluate(scores, assets.M);
  const stressScores = stressTransform(scores);
  const stress = evaluate(stressScores, assets.M);

  const loops = LOOP_KEYS.map((k) => ({
    key: k,
    label: LOOP_LABELS[k],
    score: scores.loops[k],
    weight: LOOP_WEIGHTS[k],
    evidence: input.loops[k].evidence || null,
    stressScore: stressScores.loops[k],
  }));
  const dissipation = DISSIPATION_KEYS.map((k) => ({
    key: k,
    label: DISSIPATION_LABELS[k],
    score: scores.dissipation[k],
    weight: DISSIPATION_WEIGHTS[k],
    evidence: input.dissipation[k].evidence,
    stressScore: stressScores.dissipation[k],
  }));
  const evidenceIndex = [
    { parameter: 'M_C', from: 'assets[*].E/R/I/V', regions: ['workflow', 'context', 'validation'] },
    { parameter: 'γ_C', from: 'loops.L1..L5', regions: ['workflow', 'validation', 'context'] },
    { parameter: 'μ_C', from: 'dissipation.H/D/K/B/F', regions: ['humanAgent', 'context', 'workflow', 'validation'] },
    { parameter: 'β_C', from: 'friction.*', regions: ['humanAgent', 'workflow'] },
    { parameter: 'K_C', from: 'growth.*', regions: ['context', 'workflow', 'validation'] },
  ];

  return {
    modelVersion: MODEL_VERSION,
    estimateLabel: 'Canvas-derived estimate',
    preflight: { ok: true, missingRegions: [] },
    errors: [],
    project: { name: input.project.name, canvasVersion: input.project.canvasVersion || null, author: input.project.author || null, date: input.project.date || null },
    canvas: Object.fromEntries(ALL_REGIONS.map((r) => [r, (input.canvas && input.canvas[r]) || ''])),
    assets,
    loops,
    dissipation,
    friction: Object.fromEntries(Object.entries(input.friction).map(([k, v]) => [k, { score: v.score, evidence: v.evidence || null }])),
    growth: Object.fromEntries(Object.entries(input.growth).map(([k, v]) => [k, { score: v.score, evidence: v.evidence || null }])),
    current: {
      state: current.gamma.state,
      stateLabel: stateLabel(current.gamma.state),
      gamma: current.gamma.gamma,
      gammaWeighted: current.gamma.weighted,
      gammaCapped: current.gamma.capped,
      beta: current.beta,
      mu: current.mu.mu,
      muBand: current.mu.band,
      muTop3: current.mu.top3,
      K: current.K,
      Keff: current.Keff,
      M: assets.M,
      Mcrit: current.Mcrit,
      position: current.position,
      ratio: current.ratio,
      protection: input.protection || null,
    },
    stress: {
      assumption: '假设变化：把所有关键步骤改成“全量人工审批”。',
      state: stress.gamma.state,
      stateLabel: stateLabel(stress.gamma.state),
      gamma: stress.gamma.gamma,
      beta: stress.beta,
      mu: stress.mu.mu,
      muBand: stress.mu.band,
      K: stress.K,
      Keff: stress.Keff,
      Mcrit: stress.Mcrit,
      position: stress.position,
      reason: '反馈回路被审批闸门切断；人工从“抽检异常”变成“每轮核心节点”，Output→Asset 与 Asset→New Asset 派生链被人工重写打断。',
      protection: '全量审批导致闭环中断',
    },
    target: TARGET,
    conclusion: buildConclusion(assets, current, scores.loops),
    evidenceIndex,
  };
}

module.exports = {
  computeDiagnosis,
  validateInput,
  MODEL_VERSION,
  LOOP_KEYS,
  LOOP_LABELS,
  LOOP_WEIGHTS,
  DISSIPATION_KEYS,
  DISSIPATION_LABELS,
  DISSIPATION_WEIGHTS,
  ASSET_TYPES,
  ASSET_DIM_LABELS,
  GAMMA_MAX,
};

if (require.main === module) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath) {
    console.error('usage: node compute.cjs <canvas-evidence.json> [diagnosis.json]');
    process.exit(2);
  }
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const result = computeDiagnosis(input);
  const text = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) fs.writeFileSync(outputPath, text);
  else process.stdout.write(text);
  if (!result.preflight.ok || result.errors.length) {
    console.error(result.preflight.ok ? result.errors.join('\n') : result.preflight.message);
    process.exit(1);
  }
}
