#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
// Serial evidence gate only. Services and authentication must already be available.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const storageState = arg('storage-state'), viewerState = arg('viewer-storage-state');
const expectedLocalOrgId = arg('expected-local-org-id');
const pgPort = Number(arg('pg-port'));
const base = arg('base', 'http://127.0.0.1:3317'), apiOrigin = arg('api', 'http://127.0.0.1:3320');
const out = resolve(arg('out', `/private/tmp/wsx-board-suite-${Date.now()}`));
assert(storageState && existsSync(resolve(storageState)), 'Pass an existing explicitly authorized --storage-state.');
assert(Number.isInteger(pgPort) && pgPort > 0 && pgPort < 65536, 'Pass the owned local stack --pg-port explicitly.');
assert(!existsSync(out), 'Suite output must be a fresh directory; old evidence cannot satisfy this run.');
mkdirSync(out, {recursive: true});
const tokens = [storageState, viewerState].filter(Boolean).flatMap(path => JSON.parse(readFileSync(resolve(path), 'utf8')).origins.flatMap(origin => origin.localStorage.filter(value => value.name === 'wsx.sessionToken').map(value => value.value)));
const redact = value => tokens.reduce((text, token) => text.replaceAll(token, '[token]'), String(value));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const scenarios = [
  {id: 'primary', file: 'board-input-ux-acceptance.mjs', shots: ['sticky-circle-picker.png', 'live-drag.png', 'live-drawing.png', 'draw-pen-live.png', 'draw-marker-live.png', 'draw-pencil-live.png', 'draw-highlighter-live.png', 'desktop.png', 'narrow-initial.png', 'narrow.png', 'file-tile-reloaded.png']},
  {id: 'tools', file: 'board-tools-visual-acceptance.mjs', shots: ['text-presets.png', 'shape-outlines.png', 'sticky-placed.png', 'zoomed-tool-drag.png', 'narrow-draw-menu.png']},
  {id: 'upload', file: 'board-upload-failure-acceptance.mjs', shots: ['upload-failed.png', 'replacement-retry-saved.png', 'reloaded-desktop.png', 'reloaded-narrow.png']},
  {id: 'canvas', file: 'canvas-transform-acceptance.mjs', shots: ['rotation-live.png', 'multi-live.png', 'cancel-restored.png', 'two-drawings-erased.png', 'two-drawings-redone.png']},
  {id: 'product-highlighter', file: 'board-highlighter-pixel-acceptance.mjs', shots: ['horizontal-live.png', 'horizontal-saved.png', 'fold-live.png', 'fold-saved.png', 'independent-crossing.png', 'reloaded.png', 'eraser-preserves-sticky.png']},
  {id: 'sync', file: 'board-sync-acceptance.mjs', shots: ['pending-real-ack.png', 'offline.png', 'reconnected-saved.png']},
  {id: 'file-security', file: 'board-file-security-acceptance.mjs', shots: []},
  {id: 'file-freeze', file: 'board-file-freeze-acceptance.mjs', shots: []},
];
const suite = {ok: false, executedMatrixComplete: false, coverageComplete: false, startedAt: new Date().toISOString(), base, apiOrigin, pgPort, orchestrationSha256: sha(fileURLToPath(import.meta.url)), scenarios: [], gaps: [], scopeExclusions: [
  {name: 'Physical Trackpad gestures', reason: 'Browser wheel events do not prove physical hardware input.'},
  {name: 'Native operating-system clipboard', reason: 'Browser ClipboardEvent does not prove native clipboard integration.'},
  {name: 'Successful remote HTTPS image URL', reason: 'URL rejection is tested; remote HTTPS success is not exercised by this suite.'},
  {name: 'Native tablet pressure', reason: 'Real mouse strokes use browser mouse pressure, not physical tablet pressure.'},
]};
const initialHashes = Object.fromEntries(scenarios.map(scenario => {const path = join(root, 'scripts/local-session', scenario.file); return [scenario.id, existsSync(path) ? sha(path) : null];}));
const run = (file, args, target) => new Promise(resolveRun => {
  const child = spawn(process.execPath, [file, ...args], {cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '', timedOut = false;
  child.stdout.on('data', data => {output += redact(data.toString());}); child.stderr.on('data', data => {output += redact(data.toString());});
  const timer = setTimeout(() => {timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref();}, 10 * 60 * 1000);
  child.once('error', error => {clearTimeout(timer); resolveRun({exitCode: null, error: redact(error.message)});});
  child.once('close', (exitCode, signal) => {clearTimeout(timer); writeFileSync(join(target, 'process.log'), output); resolveRun({exitCode, signal, timedOut});});
});
try {
  for (const scenario of scenarios) {
    const entry = {id: scenario.id, script: scenario.file, sourceSha256: initialHashes[scenario.id], ok: false, startedAt: new Date().toISOString()};
    const target = join(out, scenario.id); mkdirSync(target);
    try {
      const path = join(root, 'scripts/local-session', scenario.file); assert(entry.sourceSha256, `Missing script ${scenario.file}`);
      assert.equal(sha(path), entry.sourceSha256, 'Script changed after suite began');
      const args = scenario.id === 'file-freeze' ? ['--pg-port', String(pgPort), '--out', target] : ['--base', base, '--api', apiOrigin, '--storage-state', resolve(storageState), '--out', target];
      if (scenario.id === 'file-security' && viewerState) args.push('--viewer-storage-state', resolve(viewerState));
      if (scenario.id === 'upload' && expectedLocalOrgId) args.push('--expected-local-org-id', expectedLocalOrgId);
      console.log('RUN', scenario.id); Object.assign(entry, await run(path, args, target));
      assert.equal(sha(path), entry.sourceSha256, 'Script changed while running; evidence revision is ambiguous');
      const reportPath = join(target, 'results.json'); assert(existsSync(reportPath), 'Missing fresh results.json');
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      assert(Array.isArray(report.results), 'Child results must be an array');
      entry.checks = report.results.length;
      entry.passedChecks = report.results.filter(result => result.ok === true).length;
      entry.failedChecks = report.results.filter(result => result.ok === false).length;
      entry.checkNames = report.results.map(result => result.name);
      entry.reportSha256 = sha(reportPath);
      assert.equal(entry.exitCode, 0, `Child exited ${entry.exitCode}${entry.timedOut ? ' after timeout' : ''}`);
      assert.equal(report.ok, true, 'Child report did not pass'); assert(Array.isArray(report.results) && report.results.length > 0, 'No executed checks');
      assert(report.results.every(result => result.ok === true), 'Child has failed or unclassified check');
      assert(report.results.every(result => typeof result.name === 'string' && result.name.trim().length > 0), 'Every check must have a nonempty actual name');
      assert.equal(new Set(report.results.map(result => result.name)).size, report.results.length, 'Child has duplicate check names');
      if (scenario.id === 'upload' && expectedLocalOrgId) {
        assert.equal(report.viewerGateExercised, true, 'Explicit temporary viewer acceptance was not exercised');
        assert(report.results.some(result => result.name === 'real temporary viewer reads assets and files but cannot upload or mutate through image entries'), 'Missing real viewer check');
      }
      if (['primary', 'tools', 'upload', 'canvas', 'product-highlighter', 'sync'].includes(scenario.id)) {
        const errorFields = ['browserErrors', 'errors'].filter(field => Object.hasOwn(report, field));
        assert(errorFields.length > 0, 'Browser child must explicitly report browserErrors or errors');
        for (const field of errorFields) {
          assert(Array.isArray(report[field]), `Browser error field ${field} must be an array`);
          assert.equal(report[field].length, 0, `Child reports unexpected ${field}`);
        }
      }
      const errorFile = join(target, 'browser-errors.json'); if (existsSync(errorFile)) assert.deepEqual(JSON.parse(readFileSync(errorFile, 'utf8')), [], 'Browser error artifact is nonempty');
      const screenshots = readdirSync(target).filter(name => name.endsWith('.png'));
      const requiredShots = [...scenario.shots, ...(scenario.id === 'upload' && expectedLocalOrgId ? ['real-viewer-upload-gate.png'] : [])];
      for (const shot of requiredShots) assert(existsSync(join(target, shot)) && statSync(join(target, shot)).size > 0, `Missing screenshot ${shot}`);
      assert(screenshots.length >= (scenario.minShots ?? scenario.shots.length), 'Missing screenshot evidence');
      entry.screenshotArtifacts = screenshots.map(name => {
        const path = join(target, name), bytes = readFileSync(path);
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Invalid PNG evidence ${name}`);
        return {name, bytes: bytes.length, sha256: sha(path)};
      });
      if (scenario.id === 'file-freeze') {
        assert.equal(report.transactionRolledBack, true, 'Freeze fixture cleanup must be independently verified');
        assert.equal(report.rollbackAcknowledged, true, 'Freeze fixture transaction must acknowledge rollback');
      }
      entry.checks = report.results.length; entry.checkNames = report.results.map(result => result.name); entry.screenshots = screenshots;
      entry.reportSha256 = sha(reportPath); entry.gaps = report.gaps ?? [];
      suite.gaps.push(...entry.gaps.map(gap => ({scenario: scenario.id, ...gap}))); entry.ok = true;
    } catch (error) {entry.failure = redact(error.message); console.log('FAIL', scenario.id, entry.failure);}
    entry.finishedAt = new Date().toISOString(); suite.scenarios.push(entry);
    writeFileSync(join(out, 'results.json'), JSON.stringify(suite, null, 2));
  }
  for (const scenario of scenarios) {
    const path = join(root, 'scripts/local-session', scenario.file);
    if (!existsSync(path) || sha(path) !== initialHashes[scenario.id]) {
      const entry = suite.scenarios.find(value => value.id === scenario.id); entry.ok = false; entry.failure = 'Source revision changed during suite';
    }
  }
  suite.ok = suite.scenarios.length === scenarios.length && suite.scenarios.every(scenario => scenario.ok);
  suite.executedMatrixComplete = suite.ok;
  suite.coverageComplete = suite.ok && suite.gaps.length === 0 && suite.scopeExclusions.length === 0;
} finally {
  suite.finishedAt = new Date().toISOString(); suite.executedChecks = suite.scenarios.reduce((count, scenario) => count + (scenario.checks ?? 0), 0);
  suite.passedChecks = suite.scenarios.reduce((count, scenario) => count + (scenario.passedChecks ?? 0), 0);
  suite.failedChecks = suite.scenarios.reduce((count, scenario) => count + (scenario.failedChecks ?? 0), 0);
  writeFileSync(join(out, 'results.json'), JSON.stringify(suite, null, 2));
  writeFileSync(join(out, 'report.md'), `# Board Acceptance Suite\n\nResult: ${suite.ok ? 'PASS for executed paths' : 'FAIL'}\n\n${suite.scenarios.map(scenario => `- ${scenario.ok ? 'PASS' : 'FAIL'} ${scenario.id}: ${scenario.checks ?? 0} checks${scenario.failure ? `; ${scenario.failure}` : ''}`).join('\n')}\n\nReported coverage gaps: ${suite.gaps.length}. Fixed untested scope: ${suite.scopeExclusions.map(item => item.name).join('; ')}. Source hashes, actual check names and fresh screenshot lists are in results.json.\n`);
  console.log(suite.ok ? 'PASS suite executed paths' : 'FAIL suite', out); process.exitCode = suite.ok ? 0 : 1;
}
