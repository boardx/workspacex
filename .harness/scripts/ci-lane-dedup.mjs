/** Same immutable commit, workflow, hosted environment and lane; retain the original verdict. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LANES = {
  'fullstack-smoke': {
    execute: ['Execute trusted full-stack smoke', 'Execute trace disclosure geometry'],
    upload: 'Upload runtime evidence (success or failure)',
    artifact: 'phase-01-fullstack-smoke-evidence-',
  },
  'full-regression-core': {
    fullRegression: true,
    execute: ['Execute uncached trusted full gate'],
    upload: 'Upload E2E evidence (success or failure)',
    artifact: 'phase-01-e2e-full-evidence-',
  },
  'chat-read': {
    fullRegression: true,
    execute: ['Execute Chat read/write journey (own isolation scope)'],
    upload: 'Upload chat-read evidence (success or failure)',
    artifact: 'phase-01-chat-read-evidence-',
  },
  'self-service-profile': {
    fullRegression: true,
    execute: ['Execute self-service profile journey (own isolation scope)'],
    upload: 'Upload self-service-profile evidence (success or failure)',
    artifact: 'phase-01-self-service-profile-evidence-',
  },
  'chat-path-coverage': {
    execute: ['Execute chat path coverage lane (own isolation scope)'],
    upload: 'Upload chat-path-coverage evidence (success or failure)',
    artifact: 'phase-01-chat-path-coverage-evidence-',
  },
  'chat-task-workbench': {
    execute: ['Execute Chat task workbench scorecard (own isolation scope)'],
    upload: 'Upload chat-task-workbench evidence (success or failure)',
    artifact: 'phase-01-chat-task-workbench-evidence-',
  },
};

async function pages(api, path, key) {
  const result = [];
  for (let page = 1; page <= 10; page++) {
    const data = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(data[key]) || !Number.isInteger(data.total_count)) throw new Error('Invalid GitHub API response');
    result.push(...data[key]);
    if (result.length >= data.total_count) return result;
    if (data[key].length === 0) throw new Error('Incomplete GitHub API pagination');
  }
  throw new Error('Verification history exceeds safe pagination limit; request a fresh run');
}

export async function findReusableLane({ api, sha, runId, lane, now = Date.now() }) {
  const spec = LANES[lane];
  if (!spec) throw new Error(`Unknown lane: ${lane}`);
  const own = await api(`/actions/runs/${runId}`);
  if (!Number.isInteger(own.workflow_id)) throw new Error('Missing workflow identity');
  const runs = await pages(api, `/actions/workflows/${own.workflow_id}/runs?head_sha=${encodeURIComponent(sha)}`, 'workflow_runs');
  const started = run => Date.parse(run.run_started_at ?? run.created_at);
  for (const run of runs.sort((a, b) => started(b) - started(a))) {
    const age = now - started(run);
    // PR head_sha identifies the source branch, while checkout tests its synthetic merge.
    if (!['push', 'workflow_dispatch'].includes(run.event)) continue;
    if (run.id === Number(runId) || run.head_sha !== sha || run.workflow_id !== own.workflow_id || !(age >= 0 && age < 86_400_000)) continue;
    const jobs = await pages(api, `/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
    const job = jobs.find(j => j.name === lane);
    if (!job || job.conclusion === 'skipped') continue;
    // A pending request canceled before receiving a runner did not make a new measurement.
    if (job.conclusion === 'cancelled' && job.runner_id === 0 && Array.isArray(job.steps) && job.steps.length === 0) continue;
    if (job.status !== 'completed' || !['success', 'failure'].includes(job.conclusion)) return null;
    // A reused verdict points back to an actual producer. A new failed attempt invalidates old success.
    if (job.steps?.some(s => s.name === 'Preserve reused verification verdict' && ['success', 'failure'].includes(s.conclusion))) continue;
    const executed = spec.execute.map(name => job.steps?.find(s => s.name === name));
    if (!executed.every(s => s?.status === 'completed' && ['success', 'failure'].includes(s.conclusion))) return null;
    if (!job.steps?.some(s => s.name === spec.upload && s.conclusion === 'success')) return null;
    const artifacts = await pages(api, `/actions/runs/${run.id}/artifacts`, 'artifacts');
    if (!artifacts.some(a => a.name === `${spec.artifact}${run.id}` && a.expired === false)) return null;
    return { source: run.html_url, result: executed.some(s => s.conclusion === 'failure') || job.conclusion === 'failure' ? 'failure' : 'success' };
  }
  return null;
}

async function main() {
  if (process.argv[2] === 'verdict') {
    // No shell interpolation of API content; invalid/missing conclusions fail closed.
    if (process.env.CI_SOURCE_RESULT !== 'success') process.exitCode = 1;
    return;
  }
  const write = values => appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  if (process.env.GITHUB_EVENT_NAME === 'pull_request' || process.env.CI_FRESH_RUN === 'true' || Number(process.env.GITHUB_RUN_ATTEMPT) > 1) {
    write({ run: 'true' });
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !process.env.GH_TOKEN) throw new Error('Missing repository or read-only Actions token');
  const api = async path => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub verification lookup failed: HTTP ${response.status}`);
    return response.json();
  };
  const reuse = await findReusableLane({ api, sha: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID), lane: process.env.GITHUB_JOB });
  write({ run: reuse ? 'false' : 'true', result: reuse?.result ?? '' });
  if (reuse) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Verification reused\n\nSame commit and lane; retained evidence: [source run](${reuse.source}). Original result: **${reuse.result}**.\n\nUse fresh_run or Re-run jobs for an independent new measurement.\n`);
    console.log(`Reusing ${reuse.source}: ${reuse.result}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
