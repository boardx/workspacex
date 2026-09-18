#!/usr/bin/env node
'use strict';
/**
 * cli.cjs — 一条命令：MAAU Canvas 结构化证据 JSON → valuation.json + 8 页 PDF。
 *   node scripts/cli.cjs <canvas-evidence.json> <out.pdf> [--font cjk.otf] [--json valuation.json]
 * chat 原生沙箱：node /skills/maau-venture-valuation/scripts/cli.cjs /workspace/canvas-evidence.json /workspace/venture-valuation.pdf
 * 仓库根：pnpm maau:report <in.json> <out.pdf> --font <单面 CJK 字体>
 * 退出码：3 = Preflight 失败（结构缺口，不出金额）；4 = 输入不合规（stderr 逐条列出）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { calculate } = require('./calc.cjs');
const { renderReport, resolveFont } = require('./render.cjs');
const args = process.argv.slice(2);
const take = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const explicitFont = take('--font'), jsonOut = take('--json');
const [inputPath, outputPath] = args;
if (!inputPath || !outputPath) { console.error('usage: node cli.cjs <canvas-evidence.json> <out.pdf> [--font cjk.otf] [--json valuation.json]'); process.exit(2); }
(async () => {
  const result = calculate(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  const jsonPath = jsonOut || outputPath.replace(/\.pdf$/i, '') + '.valuation.json';
  fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2) + '\n');
  if (!result.preflight.ok) { console.error(`PREFLIGHT_FAILED: ${result.preflight.message}`); process.exit(3); }
  if (result.errors.length) { console.error('INPUT_INVALID:\n  ' + result.errors.join('\n  ')); process.exit(4); }
  const fontPath = resolveFont(explicitFont);
  const bytes = await renderReport(result, fontPath);
  fs.writeFileSync(outputPath, bytes);
  const s = result.snapshot;
  console.log(JSON.stringify({ ok: true, pdf: outputPath, json: jsonPath, bytes: bytes.length, pages: 8, state: result.recursive.stateLabel, quadrant: result.quadrant.name, confidence: result.confidence.level, valueMode: result.benchmark.mode, M: s.M, gamma: s.gamma, mu: s.mu, EI: s.EI, V_seed: s.V_seedText, V_now: s.V_nowText, V_90d: s.V_90dText, V_12m: s.V_12mText, font: fontPath }));
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
