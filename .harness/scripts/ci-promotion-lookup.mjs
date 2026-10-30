/** Execute from the trusted base checkout; candidate git objects are read explicitly. */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promotionIdentity, workflowEvidence } from './ci-promotion-evidence.mjs';
import { LANES } from './ci-lane-dedup.mjs';
import { INTEGRATION_CHECKS } from './ci-devapp-integration-gate.mjs';
const SHA = /^[a-f0-9]{40}$/;
const shardCount = JSON.parse(readFileSync(new URL('../api-test-shards.json', import.meta.url), 'utf8')).count;
const protectedPaths = ['.harness/api-test-shards.json', '.harness/scripts/ci-api-shards.mjs', '.harness/scripts/ci-lane-dedup.mjs', '.harness/scripts/ci-promotion*', '.harness/scripts/ci-devapp-integration-gate.mjs', '.github/workflows/harness-verify.yml', '.github/workflows/backend-gates.yml'];
const backend = ['gates-fast', 'gates-test', 'native-document-chain', 'native-runtime-lane', 'gates-runtime', 'e2e-core-loop', 'prototype-audit', 'design-loop-e2e'];
export async function lookup({ api, git, eventName, event, repository, sha, now = Date.now() }) {
  let pure = false;
  const declared = event?.pull_request;
  const declaredPromotion = eventName === 'pull_request' && declared?.head?.repo?.full_name === repository && declared?.base?.repo?.full_name === repository && declared?.head?.ref === 'develop' && ['main', 'main-us'].includes(declared?.base?.ref);
  const denied = () => ({ reuse: false, ...(pure ? { blocked: true } : {}) });
  try {
    if (!SHA.test(sha) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return { reuse: false };
    let pr;
    if (eventName === 'pull_request' && Number.isSafeInteger(event.number)) {
      try { pr = await api(`/pulls/${event.number}`); } catch (error) { if (declaredPromotion) pure = true; throw error; }
    }
    else if (eventName === 'push') {
      const prs = await api(`/commits/${sha}/pulls?per_page=100`);
      const matches = prs.filter(p => p.merged_at && p.head?.ref === 'develop' && p.merge_commit_sha === sha && p.base?.ref === event.ref?.replace('refs/heads/', ''));
      if (prs.length >= 100 || matches.length !== 1) return { reuse: false };
      pr = await api(`/pulls/${matches[0].number}`);
    }
    if (eventName === 'pull_request' && (event.pull_request?.head?.sha !== pr?.head?.sha || event.pull_request?.base?.sha !== pr?.base?.sha)) return { reuse: false };
    if (!pr || !SHA.test(pr.head?.sha)) return { reuse: false };
    const base = eventName === 'push' ? event.before : pr.base?.sha;
    if (!SHA.test(base) || /^0+$/.test(base)) return { reuse: false };
    const source = pr.head.sha;
    const sourceTree = git(['rev-parse', `${source}^{tree}`]);
    const candidateTree = git(['rev-parse', `${sha}^{tree}`]);
    if (git(['rev-parse', 'HEAD^{tree}']) !== candidateTree) return { reuse: false };
    const policyUnchanged = git(['diff', '--name-only', base, source, '--', ...protectedPaths]) === '';
    const identity = promotionIdentity({ eventName, repository, sha, event: { ...event, pull_request: pr }, candidateTree, sourceTree, mergeTree: candidateTree, policyUnchanged });
    if (!identity) return { reuse: false };
    pure = true;
    const links = [], snapshots = [];
    for (const [file, required] of [['harness-verify.yml', INTEGRATION_CHECKS], ['backend-gates.yml', backend]]) {
      const workflow = await api(`/actions/workflows/${file}`);
      if (workflow.path !== `.github/workflows/${file}` || workflow.state !== 'active') return denied();
      const list = await api(`/actions/workflows/${file}/runs?branch=develop&event=push&head_sha=${source}&per_page=1`);
      const run = list.workflow_runs?.[0];
      if (!run) return denied();
      const jobs = [];
      for (let page = 1; page <= 5; page++) {
        const data = await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
        if (!Array.isArray(data.jobs) || !Number.isSafeInteger(data.total_count) || data.total_count < 1 || data.total_count > 500) return denied();
        jobs.push(...data.jobs);
        if (jobs.length > data.total_count || new Set(jobs.map(j => j.id)).size !== jobs.length) return denied();
        if (jobs.length >= data.total_count) break;
        if (page === 5) return denied();
      }
      if (!jobs.length || jobs.some(j => j.run_id !== run.id || j.run_attempt !== run.run_attempt || j.head_sha !== source)) return denied();
      const normalized = jobs;
      const names = file === 'backend-gates.yml' ? [...required.filter(n => n !== 'gates-test'), ...Array.from({ length: shardCount }, (_, i) => `gates-test (${i + 1})`)] : required;
      if (file === 'backend-gates.yml' && jobs.filter(j => j.name.startsWith('gates-test')).length !== shardCount) return denied();
      const currentRun = await api(`/actions/runs/${run.id}`);
      if (!workflowEvidence({ run, currentRun, jobs: normalized, required: names, workflowId: workflow.id, path: `.github/workflows/${file}`, sourceSha: source, now })) return denied();
      const artifacts = await api(`/actions/runs/${run.id}/artifacts?per_page=100`);
      if (!Array.isArray(artifacts.artifacts) || !Number.isSafeInteger(artifacts.total_count) || artifacts.total_count !== artifacts.artifacts.length || artifacts.total_count > 100) return denied();
      const prefixes = file === 'harness-verify.yml' ? Object.values(LANES).filter(l => l.fullRegression).map(l => l.artifact) : ['backend-gates-core-loop-evidence-', 'prototype-audit-', 'design-loop-e2e-'];
      for (const prefix of prefixes) {
        const matches = artifacts.artifacts.filter(a => a.name === `${prefix}${run.id}`);
        if (matches.length !== 1 || matches[0].expired !== false || !(Date.parse(matches[0].expires_at) > now)) return denied();
      }
      snapshots.push({ file, run, jobs: normalized, required: names, workflowId: workflow.id });
      links.push(`https://github.com/${repository}/actions/runs/${run.id}`);
    }
    // Revalidate together after all evidence I/O: neither a rerun nor a newer push run may supersede evidence.
    for (const snapshot of snapshots) {
      const { file, run, jobs, required, workflowId } = snapshot;
      const latest = await api(`/actions/workflows/${file}/runs?branch=develop&event=push&head_sha=${source}&per_page=1`);
      const currentRun = await api(`/actions/runs/${run.id}`);
      if (latest.workflow_runs?.[0]?.id !== run.id || latest.workflow_runs[0].run_attempt !== run.run_attempt || !workflowEvidence({ run, currentRun, jobs, required, workflowId, path: `.github/workflows/${file}`, sourceSha: source, now })) return denied();
    }
    return { reuse: true, sourceSha: source, links };
  } catch { return denied(); }
}
export function githubApi(repository, token) {
  let requests = 0; const deadline = Date.now() + 60000;
  return async path => {
    if (++requests > 24 || Date.now() > deadline || !/^\/(?:pulls\/\d+|commits\/[a-f0-9]{40}\/pulls\?per_page=100|actions\/workflows\/(?:harness-verify|backend-gates)\.yml(?:\/runs\?branch=develop&event=push&head_sha=[a-f0-9]{40}&per_page=1)?|actions\/runs\/\d+(?:\/attempts\/\d+\/jobs\?per_page=100&page=[1-5]|\/artifacts\?per_page=100)?)$/.test(path)) throw Error('Lookup budget or path rejected');
    if (!path.startsWith('/') || path.includes('..') || path.includes('#')) throw Error('Invalid API path');
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) throw Error('GitHub lookup failed');
    const reader = response.body.getReader(); let body = ''; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw Error('Response too large'); } body += new TextDecoder().decode(value); }
    return JSON.parse(body);
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result = { reuse: false };
  try {
    const cwd = process.argv[2] || process.env.CANDIDATE_DIR;
    if (!cwd) throw Error('Explicit candidate checkout required');
    result = await lookup({ api: githubApi(process.env.GITHUB_REPOSITORY, (process.env.GITHUB_TOKEN || process.env.GH_TOKEN)), git: args => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(), eventName: process.env.GITHUB_EVENT_NAME, event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA });
  } catch { /* Lookup failure falls back to the original verification. */ }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `reuse=${result.reuse}\nblocked=${result.blocked === true}\nsource=${result.reuse ? JSON.stringify({ sourceSha: result.sourceSha, runs: result.links }) : ""}\n`);
  if (result.blocked) process.exitCode = 1;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.reuse ? `Promotion verification reused for ${result.sourceSha}\n${result.links.join('\n')}\n` : result.blocked ? 'Promotion blocked: source integration not verified.\n' : 'Promotion evidence unavailable; running original verification.\n');
}
