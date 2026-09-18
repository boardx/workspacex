#!/usr/bin/env node
'use strict';
/**
 * cli.cjs — 本地一条命令：MAAU Canvas 结构化证据 JSON → 5 页 PDF 报告（+ diagnosis.json）。
 *
 *   node scripts/cli.cjs <canvas-evidence.json> <out.pdf> [--font cjk.otf] [--json diagnosis.json]
 *   仓库根：pnpm maau:report examples/sample-canvas.json /tmp/maau-report.pdf --font ...
 *
 * 在 chat（原生沙箱）里同样可用：node /skills/maau-recursive-asset-report/scripts/cli.cjs ...
 */
const fs = require('node:fs');
const path = require('node:path');
const { computeDiagnosis } = require('./compute.cjs');
const { renderReport, resolveFont } = require('./render-report.cjs');

const args = process.argv.slice(2);
const takeOpt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const explicitFont = takeOpt('--font');
const jsonOut = takeOpt('--json');
const [inputPath, outputPath] = args;
if (!inputPath || !outputPath) {
  console.error('usage: node cli.cjs <canvas-evidence.json> <out.pdf> [--font cjk.otf] [--json diagnosis.json]');
  process.exit(2);
}
(async () => {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const diagnosis = computeDiagnosis(input);
  const jsonPath = jsonOut || outputPath.replace(/\.pdf$/i, '') + '.diagnosis.json';
  fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(diagnosis, null, 2) + '\n');
  if (!diagnosis.preflight.ok) {
    console.error(`PREFLIGHT_FAILED: ${diagnosis.preflight.message}`);
    process.exit(3);
  }
  if (diagnosis.errors.length) {
    console.error('INPUT_INVALID:\n  ' + diagnosis.errors.join('\n  '));
    process.exit(4);
  }
  const fontPath = resolveFont(explicitFont);
  const bytes = await renderReport(diagnosis, fontPath);
  fs.writeFileSync(outputPath, bytes);
  console.log(JSON.stringify({ ok: true, pdf: outputPath, diagnosis: jsonPath, bytes: bytes.length, pages: 5, state: diagnosis.current.stateLabel, gamma: diagnosis.current.gamma, M: diagnosis.current.M, mu: diagnosis.current.mu, Mcrit: diagnosis.current.Mcrit, font: fontPath }));
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
