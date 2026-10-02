#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
// Inventory is never passing evidence. Pointer subset dispatches the shared strict browser harness.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const standard = fileURLToPath(new URL('../../docs/design/board-acceptance-history/connector-figjam-acceptance.md', import.meta.url));
const rows = readFileSync(standard, 'utf8').split('\n').filter(line => /^\| C\d{2} /.test(line));
const cases = rows.map(line => {
  const [heading, given, when, then] = line.split('|').slice(1, 5).map(value => value.trim());
  const [, id, name] = /^(C\d{2}) (.+)$/.exec(heading);
  return {id, name, given, when, then, status: 'not-run', implementation: ['C01','C04','C07','C09','C10','C11','C16'].includes(id)?'partial pointer subset candidate':'pending'};
});
assert.equal(cases.length, 21, 'Candidate must retain all required C01-C21 cases');
assert.equal(new Set(cases.map(item => item.id)).size, 21);
const report = {
  status: 'not-run', coverageComplete: false, executedChecks: 0, passedChecks: 0,
  standard, cases,
  gates: ['enabled real UI entry', 'explicit authorized storage state', 'local runtime readiness',
    'coordinated application source freeze', 'real pointer creation; API-seeded edge cannot prove C01',
    'independent coordinate/pixel/API oracles', 'strict page/console/network errors with exact CDP cancellation attribution',
    'owned fixture archive/delete/fresh404 cleanup', 'two actual browser processes for C18'],
};
if(process.argv.includes('--pointer-subset')&&!process.argv.includes('--plan')){
  const args=process.argv.slice(2).filter(value=>value!=='--pointer-subset');
  const child=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('./board-sticky-acceptance.mjs',import.meta.url)),...args,'--connectors','--m0-only'],{stdio:'inherit'});
  if(child.error)throw child.error;
  process.exitCode=child.status??1;
}else console.log(JSON.stringify(report, null, 2));
// --plan is a successful inventory validation, never an acceptance result.
if(process.argv.includes('--plan')||!process.argv.includes('--pointer-subset'))process.exitCode = process.argv.includes('--plan') ? 0 : 2;
