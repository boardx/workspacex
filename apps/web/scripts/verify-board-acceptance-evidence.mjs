import {validateSecurityArtifact} from './board-security-policy.mjs';
import {validateJourneyArtifact} from './board-journey-policy.mjs';
import {validateBoardObservationArtifact,validateRuntimeBinding} from './board-observation-policy.mjs';
import {validateBoardSoakArtifact} from './board-soak-policy.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {boardPerformancePolicy, validateBoardPerformanceArtifact} from './board-performance-policy.mjs';
import {boardAcceptanceMatrix, requiredBoardAcceptanceLanes} from './board-acceptance-matrix.mjs';

export async function verifyBoardAcceptanceEvidence(manifest, sha) {
  const failures = [];
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !Array.isArray(manifest)) return {approved: false, score: null, failures: ['INVALID_MANIFEST']};
  for (const lane of requiredBoardAcceptanceLanes) {
    const matches = manifest.filter(row => row?.lane === lane);
    if (matches.length !== 1) { failures.push(`${matches.length ? 'DUPLICATE' : 'MISSING'}:${lane}`); continue; }
    const row = matches[0];
    const expectedCommand=boardAcceptanceMatrix.find(entry=>entry.lane===lane)?.command;
    if(expectedCommand&&row.command!==expectedCommand.join(' '))failures.push(`COMMAND_MISMATCH:${lane}`);
    if (row.sha !== sha || row.buildSha !== sha || row.dirty !== false) failures.push(`IDENTITY_MISMATCH:${lane}`);
    if (row.status !== 'passed' || row.exitCode !== 0) failures.push(`NOT_PASSED:${lane}`);
    if (row.counterproof !== true) failures.push(`NO_COUNTERPROOF:${lane}`);
    if (typeof row.command !== 'string' || !row.command.trim() || typeof row.environment !== 'string' || !row.environment.trim()) failures.push(`MISSING_CONTEXT:${lane}`);
    const start = Date.parse(row.startedAt), end = Date.parse(row.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) failures.push(`INVALID_TIME:${lane}`);
    if (typeof row.artifactPath !== 'string' || !/^[a-f0-9]{64}$/.test(row.artifactSha256 ?? '')) failures.push(`MISSING_ARTIFACT:${lane}`);
    else {
      try {
        const bytes = await readFile(row.artifactPath);
        if (createHash('sha256').update(bytes).digest('hex') !== row.artifactSha256) failures.push(`ARTIFACT_HASH_MISMATCH:${lane}`);
        const report=JSON.parse(bytes.toString());
        if(lane==='security'){const validation=validateSecurityArtifact(report,sha,row);failures.push(...validation.failures.map(f=>`${f}:${lane}`));}
        else if(lane==='journeys'){const validation=await validateJourneyArtifact(report,sha,row);failures.push(...[...validation.failures,...validation.pending].map(f=>`${f}:${lane}`));}
        else if(['meeting-room','visual','accessibility'].includes(lane)){const validation=await validateBoardObservationArtifact(report,lane,sha,row);failures.push(...[...validation.failures,...validation.pending].map(f=>`${f}:${lane}`));}
        else if(boardAcceptanceMatrix.find(e=>e.lane===lane)?.command)failures.push(...validateRuntimeBinding(report.runtimeIdentity,sha,row).map(f=>`${f}:${lane}`));
        if (lane === 'collaboration-50') {
          const validation = await validateBoardSoakArtifact(JSON.parse(bytes.toString()), sha);
          failures.push(...validation.failures.map(failure => `${failure}:${lane}`));
        }
        if (lane.startsWith('performance-')) {
          const report = JSON.parse(bytes.toString());
          const validation = validateBoardPerformanceArtifact(report, boardPerformancePolicy(resolve(import.meta.dirname, '../../..')), sha, Number(lane.match(/(\d+)k$/)[1]) * 1000);
          failures.push(...validation.failures.map(failure => `${failure}:${lane}`));
          if (validation.budgetStatus !== 'engineering-targets') failures.push(`UNBUDGETED_SCALE:${lane}`);
          for (const entry of [report.trace, ...report.loadTraces]) {
            const trace = await readFile(entry.path);
            if (createHash('sha256').update(trace).digest('hex') !== entry.sha256 || !JSON.parse(trace.toString()).traceEvents?.length) failures.push(`INVALID_BROWSER_TRACE:${lane}`);
          }
        }
      }
      catch { failures.push(`ARTIFACT_UNREADABLE:${lane}`); }
    }
  }
  for (const row of manifest) if (!requiredBoardAcceptanceLanes.includes(row?.lane)) failures.push(`UNKNOWN:${row?.lane}`);
  // Hashing arbitrary text is not validation of its claims. Stay closed until the
  // per-lane runtime/build attestation and artifact result validators are integrated.
  for (const entry of boardAcceptanceMatrix) if (!entry.command) failures.push(`PRODUCER_NOT_INTEGRATED:${entry.lane}`);
  return {approved: false, score: null, sha, failures};
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [manifestPath, sha] = process.argv.slice(2);
  if (!manifestPath) throw new Error('usage: verify-board-acceptance-evidence.mjs <manifest.json> <exact-sha>');
  const result = await verifyBoardAcceptanceEvidence(JSON.parse(await readFile(manifestPath, 'utf8')), sha);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
