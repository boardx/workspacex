import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const PROJECT = 'workspacex-home';
const ACCOUNT = 'cc39c0447db8c730182cfd075fe91bf7';
const ORIGIN = 'https://www.boardx.us';
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}`;

export async function cutover({ env = process.env, fetchImpl = fetch, run = spawnSync, pause = delay, now = Date.now, output, record = () => {} }) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') throw new Error('production requires a push to main');
  if (env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT || !env.CLOUDFLARE_API_TOKEN) throw new Error('configured Cloudflare identity missing or wrong account');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('exact commit SHA required');
  // 420s forward work + at most 90s rollback leaves headroom in the 600s job.
  const deadline = now() + 420000;
  const remaining = cap => {
    const budget = Math.min(cap, deadline - now());
    if (budget <= 0) throw new Error('production verification deadline exhausted');
    return budget;
  };
  const request = async (path = '', method = 'GET', rollback = false) => {
    const response = await fetchImpl(API + path, { method, headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(rollback ? 30000 : remaining(30000)) });
    const body = await response.json();
    if (!response.ok || body.success !== true) throw new Error(`Cloudflare ${method} failed (HTTP ${response.status})`);
    return body.result;
  };
  const before = await request();
  if (before.name !== PROJECT || before.production_branch !== 'main' || !before.domains?.includes('www.boardx.us')) throw new Error('Pages project, production branch or domain mismatch');
  const previous = before.canonical_deployment;
  if (!previous?.id || previous.latest_stage?.status !== 'success') throw new Error('no successful production deployment to retain for rollback');
  const evidence = { commit: env.GITHUB_SHA, project: PROJECT, previous_deployment: previous.id, started_at: new Date().toISOString() };
  record(evidence);
  // Wrangler 4.40.0 writes the actual response ID as a pages-deploy NDJSON entry.
  // A fresh file belongs only to this invocation; do not infer ownership from SHA.
  const temporary = mkdtempSync(join(tmpdir(), 'home-pages-'));
  const wranglerOutput = join(temporary, 'output.ndjson');
  let ownId;
  try {
    const result = run('npm', ['exec', '--yes', '--package=wrangler@4.40.0', '--', 'wrangler', 'pages', 'deploy', output, '--project-name', PROJECT, '--branch', 'main', '--commit-hash', env.GITHUB_SHA, '--commit-dirty=false'], { env: { ...env, WRANGLER_OUTPUT_FILE_PATH: wranglerOutput }, stdio: 'inherit', timeout: remaining(300000), killSignal: 'SIGKILL' });
    let entries;
    try { entries = readFileSync(wranglerOutput, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'pages-deploy'); }
    catch { throw new Error('own deployment ID unavailable; refusing automatic rollback'); }
    const entry = entries.length === 1 ? entries[0] : null;
    if (entry?.version !== 1 || entry.pages_project !== PROJECT || !/^[a-f0-9-]{36}$/.test(entry.deployment_id ?? '')) throw new Error('own deployment ID unavailable; refusing automatic rollback');
    ownId = entry.deployment_id;
    Object.assign(evidence, { deployment_id: ownId, deployment_url: entry.url });
    record(evidence);
    if (result.error || result.status !== 0) throw new Error('Wrangler deploy failed');
    const current = (await request()).canonical_deployment;
    if (current?.id !== ownId || current.deployment_trigger?.metadata?.commit_hash !== env.GITHUB_SHA || current.latest_stage?.status !== 'success' || current.id === previous.id) throw new Error('own successful production deployment not confirmed');
    Object.assign(evidence, { deployment_id: current.id, deployment_url: current.url, created_on: current.created_on });
    record(evidence);
    const smoke = run(process.execPath, ['apps/home/scripts/live-check.mjs'], { env, stdio: 'inherit', timeout: remaining(120000), killSignal: 'SIGKILL' });
    if (smoke.error || smoke.status !== 0) throw new Error('production route/header smoke failed');
    for (const origin of [current.url, ORIGIN]) {
      let verified = false;
      // Pages cutover can precede custom-domain propagation. Bound the wait;
      // recheck ownership before every retry so another publisher is not hidden.
      for (let attempt = 0; attempt < 12; attempt++) {
        const active = (await request()).canonical_deployment;
        if (active?.id !== ownId) throw new Error('production deployment changed during public verification');
        try {
          const response = await fetchImpl(`${origin}/.well-known/workspacex-release.json?commit=${env.GITHUB_SHA}&attempt=${attempt}`, { signal: AbortSignal.timeout(remaining(10000)), cache: 'no-store' });
          verified = response.ok && (await response.json()).commit === env.GITHUB_SHA;
        } catch { /* transient propagation/network failure; retry within budget */ }
        if (verified) break;
        if (attempt < 11) await pause(remaining(5000));
      }
      if (!verified) throw new Error('public release SHA differs from deployed commit after bounded propagation wait');
    }
    const final = (await request()).canonical_deployment;
    if (final?.id !== ownId || final.deployment_trigger?.metadata?.commit_hash !== env.GITHUB_SHA || final.latest_stage?.status !== 'success') throw new Error('production deployment changed after public verification');
    remaining(1);
    Object.assign(evidence, { status: 'verified', verified_at: new Date().toISOString() });
    record(evidence);
    return evidence;
  } catch (error) {
    evidence.status = 'failed';
    record(evidence);
    // Only roll back our own cutover. Never reverse another publisher's deployment.
    const current = ownId ? (await request('', 'GET', true)).canonical_deployment : null;
    if (ownId && current?.id === ownId && current.id !== previous.id && current.deployment_trigger?.metadata?.commit_hash === env.GITHUB_SHA) {
      await request(`/deployments/${encodeURIComponent(previous.id)}/rollback`, 'POST', true);
      if ((await request('', 'GET', true)).canonical_deployment?.id !== previous.id) throw new Error('rollback was not confirmed');
      evidence.rollback = previous.id;
    }
    record(evidence);
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = resolve(process.argv[2] ?? '');
  const release = JSON.parse(readFileSync(resolve(output, '.well-known/workspacex-release.json'), 'utf8'));
  if (release.commit !== process.env.GITHUB_SHA || release.project !== PROJECT) throw new Error('release artifact identity mismatch');
  mkdirSync('pages-deploy-evidence', { recursive: true });
  await cutover({ output, record: evidence => {
    writeFileSync('pages-deploy-evidence/deployment.json', JSON.stringify(evidence, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nHome deployment: ${JSON.stringify(evidence)}\n`);
  } });
}
