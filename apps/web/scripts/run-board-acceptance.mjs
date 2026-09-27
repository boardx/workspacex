import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {boardAcceptanceMatrix} from './board-acceptance-matrix.mjs';
import {boardPerformancePolicy, validateBoardPerformanceArtifact} from './board-performance-policy.mjs';

const root = resolve(import.meta.dirname, '../../..');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const sha = process.env.BOARD_ACCEPTANCE_SHA;
if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('INVALID_ACCEPTANCE_SHA');
if (process.argv.includes('--list')) {
  console.log(JSON.stringify({sha, approved: false, score: null, lanes: boardAcceptanceMatrix}, null, 2));
} else {
  if (git('rev-parse', 'HEAD') !== sha) throw new Error('HEAD_SHA_MISMATCH');
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('DIRTY_WORKTREE');
  const output = resolve(root, 'apps/web/test-results/board-acceptance', sha);
  mkdirSync(output, {recursive: true});
  const requested = process.argv.find(value => value.startsWith('--lane='))?.slice(7);
  if (requested && !boardAcceptanceMatrix.some(entry => entry.lane === requested)) throw new Error('UNKNOWN_LANE');
  const rows = [];
  for (const entry of boardAcceptanceMatrix) {
    if (!entry.command || !process.argv.includes('--run') || (requested && requested !== entry.lane)) {
      rows.push({lane: entry.lane, sha, dirty: false, buildSha: null, status: 'not-run', reason: entry.reason, requirement: entry.requirement}); continue;
    }
    if (git('rev-parse', 'HEAD') !== sha || git('status', '--porcelain', '--untracked-files=all')) throw new Error('SOURCE_CHANGED_DURING_ACCEPTANCE');
    const startedAt = new Date().toISOString(), artifactPath = resolve(output, `${entry.lane}.json`);
    rmSync(artifactPath, {force: true}); // A prior successful report must not survive this attempt.
    const result = spawnSync(entry.command[0], entry.command.slice(1), {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: {...process.env, BOARD_ACCEPTANCE_SHA: sha, BOARD_PERFORMANCE_LANE: entry.lane,
        BOARD_ACCEPTANCE_RUNTIME_MARKER: randomUUID(), BOARD_ACCEPTANCE_RUNTIME_STARTED_AT: startedAt,
        BOARD_PERFORMANCE_REPORT_PATH: artifactPath}});
    writeFileSync(resolve(output, `${entry.lane}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
    const row = {lane: entry.lane, sha, buildSha: null, dirty: false, status: 'failed', command: entry.command.join(' '),
      startedAt, endedAt: new Date().toISOString(), exitCode: result.status ?? 1, environment: process.env.BOARD_ACCEPTANCE_ENVIRONMENT ?? 'local-isolated-fullstack',
      artifactPath, artifactSha256: null, counterproof: false, failures: []};
    try {
      const bytes = readFileSync(artifactPath), report = JSON.parse(bytes.toString());
      row.artifactSha256 = createHash('sha256').update(bytes).digest('hex');
      const validation = validateBoardPerformanceArtifact(report, boardPerformancePolicy(root), sha, Number(entry.lane.match(/(\d+)k$/)[1]) * 1000);
      row.buildSha = report.runtimeIdentity?.buildSha ?? null; row.failures = validation.failures;
      if (result.status === 0 && validation.valid) row.status = validation.budgetStatus === 'engineering-targets' ? 'passed' : 'measured-unbudgeted';
    } catch {row.failures.push('MISSING_OR_INVALID_REAL_REPORT');}
    rows.push(row);
  }
  writeFileSync(resolve(output, 'run.json'), `${JSON.stringify(rows, null, 2)}\n`);
  console.error('BOARD_ACCEPTANCE_INCOMPLETE: unrun lanes, unbudgeted scales and independent counterproofs still require acceptance');
  process.exitCode = 1;
}
