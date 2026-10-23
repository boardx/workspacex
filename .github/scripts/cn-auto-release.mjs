#!/usr/bin/env node
// Dispatch only: successful queuing is explicitly not production acceptance.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sha = value => { if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw new Error('CN_AUTO_EXACT_SHA_REQUIRED'); return value; };
try {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('CN_AUTO_REPOSITORY_REQUIRED');
  const revision = sha(process.env.RELEASE_SHA);
  const current = () => sha(gh('api', `repos/${repository}/git/ref/heads/main-cn`, '--jq', '.object.sha'));
  if (current() !== revision) throw new Error('CN_AUTO_STALE_MAIN_CN');
  const mode = process.argv[2];
  let workflow, ref, fields;
  if (mode === 'prepare') {
    if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main-cn') throw new Error('CN_AUTO_PUSH_REQUIRED');
    const main = sha(gh('api', `repos/${repository}/git/ref/heads/main`, '--jq', '.object.sha'));
    const status = gh('api', `repos/${repository}/compare/${revision}...${main}`, '--jq', '.status');
    if (!['ahead', 'identical'].includes(status)) throw new Error('CN_AUTO_SOURCE_NOT_ON_MAIN');
    const run = process.env.GITHUB_RUN_ID;
    if (!/^\d+$/.test(run ?? '')) throw new Error('CN_AUTO_RUN_REQUIRED');
    workflow = 'prepare-cn-release.yml'; ref = 'main';
    fields = { release_sha: revision, release: `v0.0.0-cn-${run}`, auto_promote: 'true', source_run_id: run };
  } else if (mode === 'promote') {
    if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('CN_AUTO_TRUSTED_PREPARE_REQUIRED');
    ref = process.env.RELEASE_TAG;
    if (!/^cn-prepared-[a-zA-Z0-9._-]+$/.test(ref ?? '')) throw new Error('CN_AUTO_FROZEN_TAG_REQUIRED');
    const attempt = process.env.RELEASE_ATTEMPT_ID;
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(attempt ?? '')) throw new Error('CN_AUTO_ATTEMPT_REQUIRED');
    workflow = 'promote-cn-production.yml';
    fields = { release_sha: revision, expected_main_cn_sha: current(), release_attempt_id: attempt, promotion_mode: 'branch-push' };
  } else throw new Error('CN_AUTO_MODE_REQUIRED');
  const args = ['workflow', 'run', workflow, '--repo', repository, '--ref', ref];
  for (const [key, value] of Object.entries(fields)) args.push('-f', `${key}=${value}`);
  gh(...args);
  const message = `CN release queued: ${workflow} for ${revision}. NOT production accepted; inspect preparation and promotion runs for terminal acceptance.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
} catch (error) {
  // Child stderr can contain credentials/provider errors; expose only our own stage codes.
  console.error(error.message?.startsWith('CN_AUTO_') ? error.message : 'CN_AUTO_DISPATCH_OR_API_FAILED');
  process.exitCode = 1;
}
