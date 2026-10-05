/** Admission snapshot for the existing Board heavy workflow; no cross-SHA verdicts. */
import { appendFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativeReceiptVerdict, NATIVE_RECEIPTS } from './lib/board-native-receipts.mjs';

export const HEAVY_LANES = {
  'native-board': {
    execute: ['Run complete native connector acceptance', 'Run complete native ordinary-file acceptance', 'Run complete native sync lifecycle acceptance'],
    upload: 'Retain bounded statistics and screenshots without private runtime credentials',
    artifact: 'board-native-acceptance-',
  },
  'meeting-room': {
    execute: ['Run real isolated meeting-room and verify its evidence'],
    upload: 'Retain evidence without signing credentials',
    artifact: 'board-meeting-room-',
  },
};
const shaPattern = /^[a-f0-9]{40}$/;
export function coverageFromLog(log) {
  return log.trim().split('\n').filter(Boolean).map(line => {
    const sha = line.slice(0, 40), subject = line.slice(41);
    if (!shaPattern.test(sha)) throw new Error('Invalid coverage commit');
    const pr = /(?:\(#(\d+)\)$|^Merge pull request #(\d+)\b)/.exec(subject);
    return { sha, pullRequest: pr ? Number(pr[1] ?? pr[2]) : null };
  });
}
export function completeBatchVerdicts(jobs, artifacts, run) {
  const verdicts = {};
  for (const [lane, spec] of Object.entries(HEAVY_LANES)) {
    const matches = jobs.filter(job => job.name === lane);
    if (matches.length !== 1) return null;
    const job = matches[0];
    if (job.status !== 'completed' || !['success', 'failure'].includes(job.conclusion)) return null;
    const steps = spec.execute.map(name => job.steps?.find(step => step.name === name));
    if (!steps.every(step => step?.status === 'completed' && ['success', 'failure'].includes(step.conclusion))) return null;
    if (!job.steps?.some(step => step.name === spec.upload && step.conclusion === 'success')) return null;
    if (!artifacts.some(artifact => artifact.name === `${spec.artifact}${run.id}-${run.run_attempt}` && artifact.expired === false)) return null;
    verdicts[lane] = job.conclusion === 'failure' || steps.some(step => step.conclusion === 'failure') ? 'failure' : 'success';
  }
  return verdicts;
}
async function pages(api, path, key) {
  const result = [];
  for (let page = 1; page <= 10; page++) {
    const data = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(data[key]) || !Number.isInteger(data.total_count)) throw new Error('Invalid batch history');
    result.push(...data[key]);
    if (result.length >= data.total_count) return result;
    if (!data[key].length) break;
  }
  throw new Error('Incomplete batch history; request a fresh run');
}
export async function findExactBatch({ api, readManifest, readNativeEvidence, sha, runId }) {
  const own = await api(`/actions/runs/${runId}`);
  if (!Number.isInteger(own.workflow_id)) throw new Error('Missing workflow identity');
  const runs = await pages(api, `/actions/workflows/${own.workflow_id}/runs?head_sha=${sha}`, 'workflow_runs');
  const candidates = [];
  for (const run of runs) {
    if (run.id === runId || run.workflow_id !== own.workflow_id || run.head_branch !== 'main' || run.head_sha !== sha || !['push', 'workflow_dispatch'].includes(run.event)) continue;
    if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw new Error('Invalid attempt identity');
    // The run list is ordered by creation, which can hide a late rerun of an old ID.
    // Query explicit latest-attempt metadata before deciding which observation is newest.
    const attempt = run.run_attempt > 1 ? await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}`) : run;
    if (attempt.id !== run.id || attempt.run_attempt !== run.run_attempt || attempt.head_sha !== sha || attempt.workflow_id !== own.workflow_id) throw new Error('Invalid attempt metadata');
    const started = Date.parse(attempt.run_started_at);
    if (!Number.isFinite(started)) throw new Error('Missing actual attempt start time');
    candidates.push({run, started});
  }
  candidates.sort((a, b) => b.started - a.started || b.run.id - a.run.id);
  // Equal-resolution timestamps do not prove which actual attempt is newest.
  if (candidates.length > 1 && candidates[0].started === candidates[1].started) return null;
  for (const {run} of candidates) {
    const artifacts = await pages(api, `/actions/runs/${run.id}/artifacts`, 'artifacts');
    const artifact = artifacts.find(item => item.name === `board-heavy-batch-${run.id}-${run.run_attempt}` && item.expired === false);
    // Missing or expired newest evidence cannot justify falling back to older green.
    if (!artifact) return null;
    const manifest = await readManifest(artifact);
    if (manifest.schemaVersion !== 1 || !shaPattern.test(manifest.sha) || manifest.runId !== run.id || manifest.runAttempt !== run.run_attempt || manifest.sha !== run.head_sha) throw new Error('Invalid batch manifest identity');
    // A reused observation is not another measurement; retain the original producer.
    if (manifest.source) continue;
    const jobs = await pages(api, `/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
    const verdicts = completeBatchVerdicts(jobs, artifacts, run);
    // The newest actual attempt invalidates older green results, even if incomplete.
    if (!verdicts) return null;
    const nativeArtifact = artifacts.find(item => item.name === `${HEAVY_LANES['native-board'].artifact}${run.id}-${run.run_attempt}` && item.expired === false);
    // Artifact existence and green steps do not prove actual suite execution.
    try {
      if (nativeReceiptVerdict(await readNativeEvidence(nativeArtifact), sha) === 'failure') verdicts['native-board'] = 'failure';
    }
    catch { return null; } // Never fall back to an older green observation.
    return { url: run.html_url, runId: run.id, verdicts };
  }
  return null;
}
async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Heavy batches only admit main; choose main when dispatching');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !process.env.GH_TOKEN) throw new Error('Missing read-only Actions access');
  // Freeze the admitted main event: workflow YAML and lane code must share this SHA.
  // A newer main is the next pending candidate, never a new label for old commands.
  const sha = process.env.GITHUB_SHA;
  if (!shaPattern.test(sha ?? '')) throw new Error('Invalid main event SHA');
  const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (checkedOut !== sha) throw new Error('Workflow checkout does not match admitted main SHA');
  const coverage = coverageFromLog(execFileSync('git', ['log', '--first-parent', '--format=%H %s', sha], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' };
  const request = async path => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Batch history HTTP ${response.status}`);
    return response;
  };
  const api = async path => (await request(path)).json();
  const readArtifact = async (artifact, names) => {
    const dir = mkdtempSync(join(tmpdir(), 'board-heavy-'));
    try {
      const file = join(dir, 'manifest.zip');
      writeFileSync(file, Buffer.from(await (await request(`/actions/artifacts/${artifact.id}/zip`)).arrayBuffer()));
      return Object.fromEntries(names.map(name => [name, JSON.parse(execFileSync('unzip', ['-p', file, name], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))]));
    } finally { rmSync(dir, { recursive: true }); }
  };
  const readManifest = async artifact => (await readArtifact(artifact, ['board-heavy-batch.json']))['board-heavy-batch.json'];
  const readNativeEvidence = async artifact => {
    const files = await readArtifact(artifact, Object.keys(NATIVE_RECEIPTS).map(lane => `${lane}/receipt.json`));
    return Object.fromEntries(Object.keys(NATIVE_RECEIPTS).map(lane => [lane, files[`${lane}/receipt.json`]]));
  };
  const runId = Number(process.env.GITHUB_RUN_ID), runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error('Missing run identity');
  const source = process.env.CI_FRESH_RUN === 'true' || runAttempt > 1 ? null : await findExactBatch({ api, readManifest, readNativeEvidence, sha, runId });
  const manifest = { schemaVersion: 1, sha, runId, runAttempt, coverageBasis: 'all first-parent main commits; PR numbers from merge/squash commit subjects; null denotes an unassociated commit', coverage, source };
  writeFileSync('board-heavy-batch.json', JSON.stringify(manifest, null, 2) + '\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\nrun=${source ? 'false' : 'true'}\nnative=${source?.verdicts['native-board'] ?? ''}\nmeeting=${source?.verdicts['meeting-room'] ?? ''}\n`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Independent Board batch\n\nFrozen admitted main event: \`${sha}\`. Coverage: ${coverage.length} first-parent commits, ${coverage.filter(item => item.pullRequest !== null).length} merge/squash PR references (full list and unassociated commits in manifest).\n\n${source ? `Not rerun: [original complete batch](${source.url}); native-board **${source.verdicts['native-board']}**, meeting-room **${source.verdicts['meeting-room']}**. Original failures remain failures.` : 'New measurement of both heavy lanes; evidence retained on success or failure.'}\n\nThis batch is independent of PR acceptance. A different SHA always requires its own measurement.\n`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
