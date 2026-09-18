#!/usr/bin/env node
'use strict';
/**
 * calc.cjs — AI 原生递归资产与估值预测 · 确定性 Calculator（Requirement V0.5）。
 *
 * 规则的人类可读版本在 ../references/model.md；本文件是它的唯一可执行实现。LLM 只做语义
 * 抽取 / 分类 / Comparable 解释；**所有数字**由本文件生成（V0.5 §13.2 边界）。
 *
 * 用法：node calc.cjs <canvas-evidence.json> [valuation.json]
 * 也可 require：const { calculate } = require('./calc.cjs')
 *
 * 不变量：
 *  - 纯函数：相同输入 → 相同输出（无随机、无时间；benchmark_date 来自输入）。
 *  - Preflight：Workflow / Context / Validation 任一为空 → 只出结构缺口报告，不出金额。
 *  - V_now 只认 observed 证据；target / planned / assumption 永远不进 EI_observed。
 *  - γ > 1 只由 L3/L4 闭环证据触发；γ ≤ 1 时 Mcrit = null。
 *  - Comparable 的价值只用于 V_seed；evidence_grade D 不进金额；少于 2 个可用样本不出美元，退回 Value Index。
 *  - M / γ / μ 绝不被 Benchmark 反向修改；M / γ / μ 绝不直接相乘成美元。
 */
const fs = require('node:fs');

const VALUATION_MODEL_VERSION = '0.5.0';
const CALCULATION_VERSION = 'calc-0.5.1';
const FORECAST_HEURISTIC_VERSION = 'BoardX Forecast Heuristic v0.1';

// ---------- 配置（全部版本化；改这里 = 改 CALCULATION_VERSION）----------
const CONFIG = {
  ei: { E1: 0.10, E2: 0.20, E3: 0.35, E4: 0.40, E5: 0.50, E6: 0.65 },
  eiLabel: { E1: '问题证据', E2: '使用证据', E3: '付费证据', E4: '价值交付', E5: '留存证据', E6: '可扩展性证据' },
  loops: { L1: 0.15, L2: 0.15, L3: 0.25, L4: 0.25, L5: 0.20 },
  loopLabel: { L1: 'Validation → Workflow', L2: 'Validation → Context', L3: 'Output → Asset', L4: 'Asset → New Asset', L5: 'Human Feedback → Agent' },
  gammaMax: 1.4, gammaTaskAgentMax: 0.2,
  dissipation: { H: 0.25, D: 0.15, K: 0.20, B: 0.20, F: 0.20 },
  dissipationLabel: { H: '人工依赖', D: '数据依赖', K: '知识过期', B: '流程脆弱', F: '反馈薄弱' },
  alpha: 1, beta: 1,                       // C^α · H^β 的敏感度，V0.5 取 1（版本化）
  scenario: { conservative: 0.60, base: 1.00, upside: 1.25 },
  pExecution: { base: 0.40, maturity: 0.20, g: 0.25, d: 0.15, min: 0.25, max: 0.95 },
  quadrant: { mHigh: 5.0, eiHigh: 0.35 },   // M ≥ 5 个有效资产单位 / EI ≥ 付费级证据
  indexSeed: 100,
  minComparables: 2,
  usableGrades: ['A', 'B', 'C'],
};

const ASSET_TYPES = ['Agent', 'Workflow', 'Knowledge', 'Eval', 'Pattern'];
const ASSET_DIMS = ['E', 'R', 'I', 'V'];
const REQUIRED_REGIONS = ['workflow', 'context', 'validation'];
const ALL_REGIONS = ['intent', 'user', 'humanAgent', 'workflow', 'context', 'validation'];
const ARCHETYPES = ['Tool', 'AI SaaS', 'Service as Software', 'Autonomous Service'];
const STAGES = ['Idea', 'Prototype', 'Validation', 'Revenue', 'Scale'];
const EVIDENCE_TYPES = ['observed', 'target', 'planned', 'assumption'];
const LEVELS = Object.keys(CONFIG.ei);
const HORIZONS = ['90d', '12m'];
const GRADES = ['A', 'B', 'C', 'D'];

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const isTernary = (x) => x === 0 || x === 0.5 || x === 1;
const isUnit = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const hasQuote = (o) => o && o.evidence && nonEmpty(o.evidence.quote);

// ---------- 校验 + Preflight ----------
function validate(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { errors: ['input must be an object'], missingRegions: [] };
  const maau = input.maau || {};
  if (!nonEmpty(maau.name)) errors.push('maau.name is required');
  if (maau.archetype !== undefined && !ARCHETYPES.includes(maau.archetype)) errors.push(`maau.archetype must be one of ${ARCHETYPES.join('|')}`);
  if (maau.stage !== undefined && !STAGES.includes(maau.stage)) errors.push(`maau.stage must be one of ${STAGES.join('|')}`);
  const canvas = input.canvas || {};
  const missingRegions = REQUIRED_REGIONS.filter((r) => !nonEmpty(canvas[r]));

  if (!Array.isArray(input.assets)) errors.push('assets must be an array');
  else input.assets.forEach((a, i) => {
    if (!a || !nonEmpty(a.name)) errors.push(`assets[${i}].name is required`);
    if (!ASSET_TYPES.includes(a && a.type)) errors.push(`assets[${i}].type must be one of ${ASSET_TYPES.join('|')}`);
    for (const d of ASSET_DIMS) if (!isTernary(a && a[d])) errors.push(`assets[${i}].${d} must be 0 | 0.5 | 1`);
    if (!hasQuote(a)) errors.push(`assets[${i}].evidence.quote is required`);
  });
  const loops = input.loops || {};
  for (const k of Object.keys(CONFIG.loops)) {
    const l = loops[k];
    if (!l || !isTernary(l.score)) errors.push(`loops.${k}.score must be 0 | 0.5 | 1`);
    else if (l.score > 0 && !hasQuote(l)) errors.push(`loops.${k}.evidence.quote is required when score > 0`);
  }
  const dis = input.dissipation || {};
  for (const k of Object.keys(CONFIG.dissipation)) {
    const d = dis[k];
    if (!d || !isUnit(d.score)) errors.push(`dissipation.${k}.score must be a number in [0,1]`);
    else if (!hasQuote(d)) errors.push(`dissipation.${k}.evidence.quote is required`);
  }
  const eng = input.engine || {};
  for (const k of ['lambda', 'rho', 'C', 'H']) {
    if (!eng[k] || !isUnit(eng[k].score)) errors.push(`engine.${k}.score must be a number in [0,1]`);
    else if (!hasQuote(eng[k])) errors.push(`engine.${k}.evidence.quote is required`);
  }
  if (!Array.isArray(input.evidence)) errors.push('evidence must be an array');
  else input.evidence.forEach((e, i) => {
    if (!e || !nonEmpty(e.id)) errors.push(`evidence[${i}].id is required`);
    if (!EVIDENCE_TYPES.includes(e && e.type)) errors.push(`evidence[${i}].type must be one of ${EVIDENCE_TYPES.join('|')}`);
    if (!e || !nonEmpty(e.statement)) errors.push(`evidence[${i}].statement (Canvas 原文) is required`);
    if (e && (e.type === 'observed' || e.type === 'planned') && !LEVELS.includes(e.level)) errors.push(`evidence[${i}].level must be one of ${LEVELS.join('|')} for observed/planned`);
    if (e && e.type === 'planned' && !HORIZONS.includes(e.horizon)) errors.push(`evidence[${i}].horizon must be 90d | 12m for planned`);
    if (e && e.probability !== undefined && !isUnit(e.probability)) errors.push(`evidence[${i}].probability must be in [0,1]`);
  });
  const bm = input.benchmark || {};
  if (bm.comparables !== undefined) {
    if (!Array.isArray(bm.comparables)) errors.push('benchmark.comparables must be an array');
    else bm.comparables.forEach((c, i) => {
      if (!c || !nonEmpty(c.name)) errors.push(`benchmark.comparables[${i}].name is required`);
      if (!GRADES.includes(c && c.evidenceGrade)) errors.push(`benchmark.comparables[${i}].evidenceGrade must be A|B|C|D`);
      if (c && c.valueUsd !== null && c.valueUsd !== undefined && !(typeof c.valueUsd === 'number' && c.valueUsd > 0)) errors.push(`benchmark.comparables[${i}].valueUsd must be a positive number or null`);
      if (c && c.valueUsd && !nonEmpty(c.sourceDate)) errors.push(`benchmark.comparables[${i}].sourceDate is required when valueUsd is given`);
      if (c && c.valueUsd && !nonEmpty(c.source)) errors.push(`benchmark.comparables[${i}].source is required when valueUsd is given`);
    });
  }
  return { errors, missingRegions };
}

// ---------- 内部发动机 ----------
function recursiveState(input) {
  const items = input.assets.map((a) => ({ name: a.name, type: a.type, E: a.E, R: a.R, I: a.I, V: a.V, value: round((a.E + a.R + a.I + a.V) / 4), evidence: a.evidence }));
  const M = round(items.reduce((s, a) => s + a.value, 0), 2);
  const N = items.length;
  const maturity = N ? round(M / N) : 0;
  const scores = Object.fromEntries(Object.keys(CONFIG.loops).map((k) => [k, input.loops[k].score]));
  const weighted = Object.keys(CONFIG.loops).reduce((s, k) => s + CONFIG.loops[k] * scores[k], 0);
  const closedDerivation = scores.L3 === 1 && scores.L4 === 1;
  const gammaRaw = CONFIG.gammaMax * weighted;
  const gamma = round(closedDerivation ? gammaRaw : Math.min(gammaRaw, 1));
  const state = gamma < CONFIG.gammaTaskAgentMax ? 'task-agent' : gamma > 1 ? 'strong-recursive' : 'ordinary-maau';
  const dscores = Object.fromEntries(Object.keys(CONFIG.dissipation).map((k) => [k, input.dissipation[k].score]));
  const contributions = Object.keys(CONFIG.dissipation).map((k) => ({ key: k, label: CONFIG.dissipationLabel[k], score: dscores[k], weight: CONFIG.dissipation[k], contribution: round(CONFIG.dissipation[k] * dscores[k], 4), evidence: input.dissipation[k].evidence }));
  const mu = round(contributions.reduce((s, c) => s + c.contribution, 0));
  const muBand = mu <= 0.25 ? 'Low' : mu <= 0.5 ? 'Moderate' : 'High';
  const eng = { lambda: input.engine.lambda.score, rho: input.engine.rho.score, C: input.engine.C.score, H: input.engine.H.score };
  const Lambda = round(eng.lambda * eng.rho * Math.pow(eng.C, CONFIG.alpha) * Math.pow(eng.H, CONFIG.beta), 4);
  const growthTerm = round(Lambda * Math.pow(M, gamma), 3);
  const decayTerm = round(mu * M, 3);
  let Mcrit = null, position = 'no-superlinear-threshold';
  if (gamma > 1 && Lambda > 0) {
    Mcrit = mu <= 0 ? 0 : round(Math.pow(mu / Lambda, 1 / (gamma - 1)), 2);
    position = Mcrit === 0 ? 'above' : Math.abs(M - Mcrit) / Mcrit < 0.1 ? 'near' : M > Mcrit ? 'above' : 'below';
  }
  return {
    M, N, maturity, gamma, gammaWeighted: round(weighted), gammaCapped: !closedDerivation && gammaRaw > 1, state,
    stateLabel: { 'task-agent': 'Task Agent', 'ordinary-maau': '普通 MAAU', 'strong-recursive': '强递归 MAAU' }[state],
    mu, muBand, muTop3: [...contributions].sort((a, b) => b.contribution - a.contribution || a.key.localeCompare(b.key)).slice(0, 3),
    lambda: eng.lambda, rho: eng.rho, C: eng.C, H: eng.H, alpha: CONFIG.alpha, beta: CONFIG.beta, Lambda,
    growthTerm, decayTerm, netGrowth: round(growthTerm - decayTerm, 3), growthCoversDecay: growthTerm > decayTerm,
    Mcrit, position,
    assets: items,
    loops: Object.keys(CONFIG.loops).map((k) => ({ key: k, label: CONFIG.loopLabel[k], score: scores[k], weight: CONFIG.loops[k], evidence: input.loops[k].evidence || null })),
    dissipation: contributions,
  };
}

// ---------- Evidence Ledger + EI ----------
function evidenceLedger(input, pExecution) {
  const ledger = input.evidence.map((e) => {
    const ei = e.type === 'observed' || e.type === 'planned' ? CONFIG.ei[e.level] : 0;
    return {
      id: e.id, type: e.type, level: e.level || null, levelLabel: e.level ? CONFIG.eiLabel[e.level] : null,
      statement: e.statement, region: e.region || null, ei,
      horizon: e.type === 'planned' ? e.horizon : null,
      probability: e.type === 'planned' ? round(e.probability !== undefined ? e.probability : pExecution) : null,
      probabilitySource: e.type === 'planned' ? (e.probability !== undefined ? 'canvas' : 'P_execution') : null,
      entersVnow: e.type === 'observed', entersForecast: e.type === 'planned',
      role: { observed: '进入 EI_observed', target: '不进 V_now；作为里程碑 / 成功门槛', planned: '不进 V_now；进入 Forecast', assumption: '不进 V_now；进入风险 / 里程碑' }[e.type],
    };
  });
  // 同一证据等级只计一次（取该等级里第一条为代表，其余标 duplicate），避免同级多条重复复利。
  const seen = new Set();
  for (const e of ledger) {
    if (e.type !== 'observed') continue;
    if (seen.has(e.level)) { e.countedInEI = false; e.duplicateOfLevel = true; e.ei = 0; }
    else { seen.add(e.level); e.countedInEI = true; }
  }
  const observed = ledger.filter((e) => e.type === 'observed' && e.countedInEI);
  const EI_observed = round(observed.reduce((s, e) => s + e.ei, 0));
  const highestObservedLevel = observed.length ? observed.map((e) => e.level).sort().at(-1) : null;
  return { ledger, EI_observed, highestObservedLevel, counts: Object.fromEntries(EVIDENCE_TYPES.map((t) => [t, ledger.filter((e) => e.type === t).length])) };
}

function executionProbability(r) {
  const p = CONFIG.pExecution;
  const G = Math.min(r.gamma, 1.5) / 1.5, D = 1 - r.mu;
  const raw = p.base + p.maturity * r.maturity + p.g * G + p.d * D;
  return { pExecution: round(clamp(raw, p.min, p.max)), inputs: { maturity: r.maturity, G: round(G), D: round(D) }, formula: 'clamp(0.40 + 0.20·Maturity + 0.25·G + 0.15·D, 0.25, 0.95)', version: FORECAST_HEURISTIC_VERSION };
}

// ---------- Benchmark Anchor ----------
function seedRange(input) {
  const bm = input.benchmark || {};
  const comparables = (bm.comparables || []).map((c) => ({
    name: c.name, archetype: c.archetype || null, stage: c.stage || null, domain: c.domain || null,
    similarities: c.similarities || '', differences: c.differences || '',
    valueUsd: c.valueUsd ?? null, disclosure: c.valueUsd ? 'disclosed' : 'Not publicly disclosed',
    source: c.source || null, sourceDate: c.sourceDate || null, evidenceGrade: c.evidenceGrade,
    usable: Boolean(c.valueUsd) && CONFIG.usableGrades.includes(c.evidenceGrade),
    gradeNote: { A: '可直接作为锚点', B: 'company-reported', C: 'estimate（仅参考）', D: '不得进入金额计算' }[c.evidenceGrade],
  }));
  const usable = comparables.filter((c) => c.usable).map((c) => c.valueUsd).sort((a, b) => a - b);
  const sourceCount = usable.length;
  if (sourceCount >= CONFIG.minComparables) {
    const mid = sourceCount % 2 ? usable[(sourceCount - 1) / 2] : Math.sqrt(usable[sourceCount / 2 - 1] * usable[sourceCount / 2]);
    return { mode: 'usd', currency: 'USD', low: usable[0], base: round(mid, 0), high: usable[sourceCount - 1], sourceCount, comparables, benchmarkDate: bm.benchmarkDate || null, note: `V_seed 取 ${sourceCount} 个 A/B/C 级公开价值信号的 [min, median, max]；D 级与未披露的不计。` };
  }
  return { mode: 'index', currency: 'INDEX', low: CONFIG.indexSeed, base: CONFIG.indexSeed, high: CONFIG.indexSeed, sourceCount, comparables, benchmarkDate: bm.benchmarkDate || null, note: sourceCount === 0 ? '没有 A/B/C 级公开价值信号：输出 Value Index（起点 = 100），不硬造美元估值。' : `只有 ${sourceCount} 个可用价值信号（< ${CONFIG.minComparables}）：不用单一 Comparable 决定 V_seed，退回 Value Index。` };
}

// ---------- 当前价值 + 预测 ----------
function scale(seed, factor) { return { low: round(seed.low * factor, seed.mode === 'usd' ? 0 : 1), base: round(seed.base * factor, seed.mode === 'usd' ? 0 : 1), high: round(seed.high * factor, seed.mode === 'usd' ? 0 : 1) }; }

function forecast(ledger, seed, vNow, pExecution) {
  const planned = ledger.filter((e) => e.type === 'planned');
  const horizons = { '90d': planned.filter((e) => e.horizon === '90d'), '12m': planned };
  const out = {};
  for (const h of HORIZONS) {
    out[h] = {};
    for (const s of Object.keys(CONFIG.scenario)) {
      const items = horizons[h].map((e) => {
        const p = s === 'upside' ? Math.min(CONFIG.scenario.upside * e.probability, 1) : round(CONFIG.scenario[s] * e.probability);
        return { id: e.id, level: e.level, ei: e.ei, probability: round(p), contribution: round(e.ei * p, 4) };
      });
      const EI_future = round(items.reduce((a, b) => a + b.contribution, 0));
      out[h][s] = { EI_future, multiplier: round(Math.exp(EI_future)), value: scale({ ...seed, low: vNow.low, base: vNow.base, high: vNow.high }, Math.exp(EI_future)), items };
    }
  }
  return { horizons: out, pExecution, scenarioFactors: CONFIG.scenario };
}

function confidence(ledgerInfo, seed, missingRegions) {
  const lvl = ledgerInfo.highestObservedLevel;
  const hasPaymentOrUse = lvl && ['E3', 'E4', 'E5', 'E6'].includes(lvl);
  const hasProblemOrUsage = lvl && ['E1', 'E2'].includes(lvl);
  if (missingRegions.length === 0 && hasPaymentOrUse && seed.mode === 'usd' && seed.sourceCount >= 3) return { level: 'High', reason: 'Observed 证据已覆盖付费/持续使用；Benchmark ≥ 3 个可用公开样本；Canvas 完整。' };
  if ((hasProblemOrUsage || hasPaymentOrUse) && seed.sourceCount >= CONFIG.minComparables) return { level: 'Medium', reason: '有问题/使用证据，但收入或留存尚未完整验证；Comparable 基本可用。' };
  return { level: 'Low', reason: seed.mode === 'index' ? '主要是 Target/Assumption 或缺少可用 Benchmark：关键参数来自默认先验，输出 Value Index。' : '主要是 Target/Assumption；Benchmark 跨领域或跨阶段；关键参数来自默认先验。' };
}

function quadrant(r, EI) {
  const mHigh = r.M >= CONFIG.quadrant.mHigh, eHigh = EI >= CONFIG.quadrant.eiHigh;
  const key = !mHigh && !eHigh ? 'q1' : !mHigh && eHigh ? 'q2' : mHigh && !eHigh ? 'q3' : 'q4';
  const defs = {
    q1: { name: '忙碌但没学习', explain: '做了很多事，但既没有市场证据，也没有留下组织资产。' },
    q2: { name: '项目公司风险', explain: '客户认可，但经验没沉淀；下一单仍从头开始。' },
    q3: { name: '技术自嗨风险', explain: '系统越来越复杂，但关键市场假设没有被验证。' },
    q4: { name: '递归增长状态', explain: '市场持续验证；每次交付又增强系统，是最值得继续加码的区域。' },
  };
  return { key, mHigh, eiHigh: eHigh, thresholds: CONFIG.quadrant, ...defs[key] };
}

function milestones(ledger, pExecution) {
  const planned = ledger.filter((e) => e.type === 'planned').sort((a, b) => (a.horizon === b.horizon ? b.ei - a.ei : a.horizon === '90d' ? -1 : 1));
  const targets = ledger.filter((e) => e.type === 'target');
  const assumptions = ledger.filter((e) => e.type === 'assumption');
  const list = planned.slice(0, 5).map((e, i) => ({
    rank: i + 1, id: e.id, statement: e.statement, level: e.level, levelLabel: e.levelLabel, ei: e.ei, horizon: e.horizon, probability: e.probability,
    successCriterion: `${e.levelLabel}成为 Observed：${CONFIG.eiLabel[e.level]}被原文或外部证据支持`,
    ifFails: `该节点不成真 ⇒ ${e.horizon} 的 EI_future 少 ${round(e.ei * e.probability, 3)}，对应情景曲线在此回撤`,
  }));
  return { list, targetsAsGates: targets.map((t) => t.statement), assumptionsAsRisks: assumptions.map((a) => a.statement), pExecution };
}

function formatValue(v, mode) {
  if (mode === 'index') return `指数 ${Number(v).toFixed(0)}`;
  const n = Number(v);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ---------- 总装 ----------
function calculate(input) {
  const { errors, missingRegions } = validate(input);
  const meta = { valuationModelVersion: VALUATION_MODEL_VERSION, calculationVersion: CALCULATION_VERSION, forecastHeuristicVersion: FORECAST_HEURISTIC_VERSION };
  if (missingRegions.length) return { ...meta, preflight: { ok: false, missingRegions, message: `结构缺口：缺少 ${missingRegions.join(' / ')}。可输出结构缺口报告，但不得给出正式估值金额；请先补充这些画布信息。` }, errors };
  if (errors.length) return { ...meta, preflight: { ok: true, missingRegions: [] }, errors };

  const recursive = recursiveState(input);
  const pe = executionProbability(recursive);
  const ledgerInfo = evidenceLedger(input, pe.pExecution);
  const seed = seedRange(input);
  const observedOnly = ledgerInfo.counts.observed === 0;
  const vNow = { ...scale(seed, Math.exp(ledgerInfo.EI_observed)), multiplier: round(Math.exp(ledgerInfo.EI_observed)), EI_observed: ledgerInfo.EI_observed, note: observedOnly ? '没有任何 Observed 证据：V_now = V_seed（EI_observed = 0），不获得增值；只输出 Seed Benchmark + Forecast。' : `V_now = V_seed × e^${ledgerInfo.EI_observed} = V_seed × ${round(Math.exp(ledgerInfo.EI_observed))}` };
  const fc = forecast(ledgerInfo.ledger, seed, vNow, pe.pExecution);
  const conf = confidence(ledgerInfo, seed, missingRegions);
  const quad = quadrant(recursive, ledgerInfo.EI_observed);
  const ms = milestones(ledgerInfo.ledger, pe.pExecution);
  const fmt = (v) => formatValue(v, seed.mode);
  const snapshot = {
    M: recursive.M, gamma: recursive.gamma, mu: recursive.mu, EI: ledgerInfo.EI_observed,
    V_seed: seed.base, V_now: vNow.base, V_90d: fc.horizons['90d'].base.value.base, V_12m: fc.horizons['12m'].base.value.base,
    V_seedText: fmt(seed.base), V_nowText: fmt(vNow.base), V_90dText: fmt(fc.horizons['90d'].base.value.base), V_12mText: fmt(fc.horizons['12m'].base.value.base),
    rangeNowText: `${fmt(vNow.low)} – ${fmt(vNow.high)}`,
  };
  const provenance = [
    { parameter: 'M / γ / μ / λ / ρ / C / H', origin: 'Canvas-derived', rule: 'model.md §3', source: 'assets / loops / dissipation / engine 的原文证据' },
    { parameter: 'EI_observed', origin: 'Canvas-derived', rule: 'Σ observed 证据默认 EI（同级只计一次）', source: 'evidence[type=observed]' },
    { parameter: 'V_seed', origin: seed.mode === 'usd' ? 'Benchmark-derived' : 'heuristic（Value Index 起点 100）', rule: seed.note, source: `comparables（${seed.sourceCount} 个可用，benchmark_date ${seed.benchmarkDate || '未提供'}）` },
    { parameter: 'V_now', origin: 'Benchmark-derived × Canvas-derived', rule: 'V_seed × e^(EI_observed)', source: 'V_seed + evidence[observed]' },
    { parameter: 'P_execution', origin: 'heuristic', rule: pe.formula, source: FORECAST_HEURISTIC_VERSION },
    { parameter: 'V_90d / V_12m', origin: 'heuristic × Canvas-derived', rule: 'V_now × e^(Σ EI_i × P_i × 情景系数)', source: 'evidence[planned] + P_execution' },
  ];
  const sensitivity = ms.list.slice(0, 3).map((m) => ({ milestone: m.statement, deltaEI: round(m.ei * m.probability, 3), effectOn12mBase: fmt(round(fc.horizons['12m'].base.value.base * (1 - Math.exp(-m.ei * m.probability)), seed.mode === 'usd' ? 0 : 1)) }));

  return {
    ...meta, estimateLabel: 'Reference Value / Scenario Forecast（非审计、非公允价值、非融资定价意见）',
    preflight: { ok: true, missingRegions: [] }, errors: [],
    maau: { name: input.maau.name, summary: input.maau.summary || '', archetype: input.maau.archetype || null, stage: input.maau.stage || null, domain: input.maau.domain || null, labelsEvidence: input.maau.labelsEvidence || null, date: input.maau.date || null },
    canvas: Object.fromEntries(ALL_REGIONS.map((r) => [r, (input.canvas && input.canvas[r]) || ''])),
    recursive, ledger: ledgerInfo, benchmark: seed, vNow, executionProbability: pe, forecast: fc, confidence: conf, quadrant: quad, milestones: ms,
    snapshot, provenance, sensitivity, config: CONFIG,
    disclosures: { valuation_model_version: VALUATION_MODEL_VERSION, calculation_version: CALCULATION_VERSION, benchmark_date: seed.benchmarkDate || 'not provided', source_count: seed.sourceCount, value_mode: seed.mode },
  };
}

module.exports = { calculate, validate, formatValue, CONFIG, VALUATION_MODEL_VERSION, CALCULATION_VERSION };

if (require.main === module) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath) { console.error('usage: node calc.cjs <canvas-evidence.json> [valuation.json]'); process.exit(2); }
  const result = calculate(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  const text = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) fs.writeFileSync(outputPath, text); else process.stdout.write(text);
  if (!result.preflight.ok || result.errors.length) { console.error(result.preflight.ok ? result.errors.join('\n') : result.preflight.message); process.exit(1); }
}
