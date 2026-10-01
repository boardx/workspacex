import {validateSecurityArtifact} from './board-security-policy.mjs';
import {validateJourneyArtifact} from './board-journey-policy.mjs';
import {validateBoardObservationArtifact, validateRuntimeBinding} from './board-observation-policy.mjs';
import {validateBoardSoakArtifact} from './board-soak-policy.mjs';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {boardAcceptanceMatrix} from './board-acceptance-matrix.mjs';
import {boardPerformancePolicy, validateBoardPerformanceArtifact} from './board-performance-policy.mjs';
import {validateIntegratedLaneArtifact} from './board-integrated-ci-policy.mjs';

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
    if (['collaboration-50','meeting-room'].includes(entry.lane) && (process.env.BOARD_ACCEPTANCE_LEDGER_KEY?.length ?? 0) < 32) throw new Error('LEDGER_KEY_REQUIRED');
    const runtimeMarker=randomUUID(), startedAt = new Date().toISOString(), artifactPath = resolve(output, `${entry.lane}.json`);
    rmSync(artifactPath, {force: true}); // A prior successful report must not survive this attempt.
    const result = spawnSync(entry.command[0], entry.command.slice(1), {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: {...process.env, BOARD_ACCEPTANCE_SHA: sha, BOARD_PERFORMANCE_LANE: entry.lane,
        BOARD_ACCEPTANCE_RUNTIME_MARKER: runtimeMarker, BOARD_ACCEPTANCE_RUNTIME_STARTED_AT: startedAt,
        BOARD_OBSERVATION_REPORT_PATH: artifactPath, BOARD_SOAK_REPORT_PATH: artifactPath, BOARD_PERFORMANCE_REPORT_PATH: artifactPath, BOARD_INTEGRATED_REPORT_PATH: artifactPath}});
    writeFileSync(resolve(output, `${entry.lane}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
    const row = {lane: entry.lane, sha, buildSha: null, dirty: false, status: 'failed', command: entry.command.join(' '),
      runtimeMarker, startedAt, endedAt: new Date().toISOString(), exitCode: result.status ?? 1, environment: process.env.BOARD_ACCEPTANCE_ENVIRONMENT ?? 'local-isolated-fullstack',
      artifactPath, artifactSha256: null, counterproof: false, failures: []};
    try {
      const bytes = readFileSync(artifactPath), report = JSON.parse(bytes.toString());
      row.artifactSha256 = createHash('sha256').update(bytes).digest('hex');
      const observation=['security','journeys','meeting-room','visual','accessibility'].includes(entry.lane);
      const integrated=['storage','import','api-ws-objectstore'].includes(entry.lane);
      const validation = entry.lane==='security' ? validateSecurityArtifact(report,sha,row) : entry.lane==='journeys' ? await validateJourneyArtifact(report,sha,row) : observation ? await validateBoardObservationArtifact(report,entry.lane,sha,row) : entry.lane === 'collaboration-50' ? await validateBoardSoakArtifact(report, sha) : integrated ? validateIntegratedLaneArtifact(report,entry.lane,sha,row) : validateBoardPerformanceArtifact(report, boardPerformancePolicy(root), sha, Number(entry.lane.match(/(\d+)k$/)[1]) * 1000);
      row.buildSha = (report.runtimeIdentity ?? report.runtimeAfter ?? report.reports?.[0]?.runtimeIdentity)?.buildSha ?? null; row.failures = validation.failures;
      if(!observation)row.failures.push(...validateRuntimeBinding(report.runtimeIdentity,sha,row));
      row.pending=validation.pending??[];
      row.counterproof=report.counterproof===true;
      if (result.status === 0 && validation.valid && !row.failures.length) row.status = validation.budgetStatus === 'engineering-targets' ? 'passed' : observation ? 'pending-independent-acceptance' : 'measured-unbudgeted';
    } catch {row.failures.push('MISSING_OR_INVALID_REAL_REPORT');}
    if (git('rev-parse', 'HEAD') !== sha || git('status', '--porcelain', '--untracked-files=all')) {row.status = 'failed'; row.dirty = true; row.failures.push('SOURCE_CHANGED_DURING_ACCEPTANCE');}
    rows.push(row);
  }
  writeFileSync(resolve(output, 'run.json'), `${JSON.stringify(rows, null, 2)}\n`);
  console.error('BOARD_ACCEPTANCE_INCOMPLETE: unrun lanes, unbudgeted scales and independent counterproofs still require acceptance');
  process.exitCode = 1;
}
