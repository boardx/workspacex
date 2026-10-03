import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT = 'workspacex-home';
const ACCOUNT = 'cc39c0447db8c730182cfd075fe91bf7';
const ORIGIN = 'https://www.boardx.us';
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}`;

export async function cutover({ env = process.env, fetchImpl = fetch, run = spawnSync, output, record = () => {} }) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') throw new Error('production requires a push to main');
  if (env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT || !env.CLOUDFLARE_API_TOKEN) throw new Error('configured Cloudflare identity missing or wrong account');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('exact commit SHA required');
  const request = async (path = '', method = 'GET') => {
    const response = await fetchImpl(API + path, { method, headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(30000) });
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
  try {
    const result = run('npm', ['exec', '--yes', '--package=wrangler@4.40.0', '--', 'wrangler', 'pages', 'deploy', output, '--project-name', PROJECT, '--branch', 'main', '--commit-hash', env.GITHUB_SHA, '--commit-dirty=false'], { env, stdio: 'inherit', timeout: 300000 });
    if (result.error || result.status !== 0) throw new Error('Wrangler deploy failed');
    const current = (await request()).canonical_deployment;
    if (current?.deployment_trigger?.metadata?.commit_hash !== env.GITHUB_SHA || current.latest_stage?.status !== 'success' || current.id === previous.id) throw new Error('new successful production deployment not confirmed');
    Object.assign(evidence, { deployment_id: current.id, deployment_url: current.url, created_on: current.created_on });
    record(evidence);
    const smoke = run(process.execPath, ['apps/home/scripts/live-check.mjs'], { env, stdio: 'inherit', timeout: 120000 });
    if (smoke.error || smoke.status !== 0) throw new Error('production route/header smoke failed');
    for (const origin of [current.url, ORIGIN]) {
      const response = await fetchImpl(`${origin}/.well-known/workspacex-release.json`, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      if (!response.ok || (await response.json()).commit !== env.GITHUB_SHA) throw new Error('public release SHA differs from deployed commit');
    }
    Object.assign(evidence, { status: 'verified', verified_at: new Date().toISOString() });
    record(evidence);
    return evidence;
  } catch (error) {
    evidence.status = 'failed';
    record(evidence);
    // Only roll back our own cutover. Never reverse another publisher's deployment.
    const current = (await request()).canonical_deployment;
    if (current?.id !== previous.id && current?.deployment_trigger?.metadata?.commit_hash === env.GITHUB_SHA) {
      await request(`/deployments/${encodeURIComponent(previous.id)}/rollback`, 'POST');
      if ((await request()).canonical_deployment?.id !== previous.id) throw new Error('rollback was not confirmed');
      evidence.rollback = previous.id;
    }
    record(evidence);
    throw error;
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
