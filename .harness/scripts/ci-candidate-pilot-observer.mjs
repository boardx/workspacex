/** Protected default-main entry point. Downloads data; never executes a candidate. */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGitHubApi } from './lib/ci-candidate-github.mjs';
import { observeProtectedPilotReceipt } from './lib/ci-candidate-pilot-receipt.mjs';
import { createObservationBudget, budgetedObservationApi } from './lib/ci-candidate-budget.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const positiveId = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
const requireFact = (value, reason) => { if (!value) { const error = new Error(reason); error.reason = reason; throw error; } };
const fallback = reason => ({ schemaVersion: 1, mode: 'protected-pilot-receipt-shadow', scopedProtectedReceiptVerified: false, apiVerified: false, protectedVerified: false, runFull: true, skip: false, reuseAuthorized: false, stableDuringRead: false, skipAuthorization: false, reasons: [reason] });

/** Test seams are in-process only; no workflow input selects code, command or policy. */
export async function runPilotReceiptObserver(env = process.env, dependencies = {}) {
  const repositoryRoot = dependencies.repositoryRoot ?? ROOT;
  const outputDirectory = resolve(env.CI_CANDIDATE_OUTPUT_DIR || join(env.RUNNER_TEMP || '/tmp', 'ci-candidate-pilot-observer'));
  mkdirSync(outputDirectory, { recursive: true });
  const budget = dependencies.budget ?? dependencies.api?.observationBudget ?? createObservationBudget();
  let report;
  try {
    const mode = env.CI_CANDIDATE_MODE ?? 'shadow';
    if (mode !== 'shadow') report = fallback(mode === 'off' ? 'pilot_receipt_observation_disabled' : 'pilot_receipt_reuse_not_approved');
    else {
      requireFact(positiveId(env.GITHUB_RUN_ID) && positiveId(env.GITHUB_RUN_ATTEMPT) && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? ''), 'pilot_receipt_cli_identity_invalid');
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
      const rawId = env.CI_CANDIDATE_SOURCE_RUN_ID || String(env.GITHUB_EVENT_NAME === 'workflow_run' ? event.workflow_run?.id ?? '' : event.inputs?.source_run_id ?? '');
      requireFact(positiveId(rawId) && (env.GITHUB_EVENT_NAME !== 'workflow_run' || Number(rawId) === event.workflow_run?.id), 'pilot_receipt_event_source_id_invalid');
      const gitEnv = { PATH: env.PATH || process.env.PATH, HOME: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' };
      const git = dependencies.git ?? (args => execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd: repositoryRoot, env: gitEnv, encoding: 'utf8', timeout: 15_000, maxBuffer: 8_388_608, stdio: ['ignore', 'pipe', 'pipe'] }));
      const actualCheckout = { sha: git(['rev-parse', '--verify', 'HEAD^{commit}']).trim(), tree: git(['rev-parse', '--verify', 'HEAD^{tree}']).trim(), parents: git(['show', '-s', '--format=%P', 'HEAD']).trim().split(' ').filter(Boolean) };
      git(['diff', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD', '--', '.harness', '.github', 'package.json', '.npmrc', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.nvmrc']);
      const policyText = readFileSync(join(repositoryRoot, '.harness/config/ci-candidate-pilot.json'), 'utf8');
      requireFact(git(['show', `${actualCheckout.sha}:.harness/config/ci-candidate-pilot.json`]) === policyText, 'pilot_receipt_policy_worktree_changed');
      const api = budgetedObservationApi(dependencies.api ?? createGitHubApi({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN, budget }), budget);
      report = await budget.measure('protected-pilot-receipt', () => observeProtectedPilotReceipt({ api, repositoryName: env.GITHUB_REPOSITORY,
        sourceRunId: Number(rawId), observerRunId: Number(env.GITHUB_RUN_ID), observerRunAttempt: Number(env.GITHUB_RUN_ATTEMPT), actualCheckout, expectedObserverSha: env.GITHUB_SHA,
        observerRef: env.GITHUB_REF, observerEvent: env.GITHUB_EVENT_NAME, policy: JSON.parse(policyText), now: dependencies.now ?? Date.now() }));
    }
  } catch (error) { report = fallback(typeof error?.reason === 'string' && /^[a-z0-9_:-]{1,120}$/.test(error.reason) ? error.reason : 'pilot_receipt_observer_bootstrap_failed'); }
  report.observationBudget = budget.snapshot();
  writeFileSync(join(outputDirectory, 'pilot-observer-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const summary = [
    '### Completed protected pilot receipt observation', '',
    `Scoped protected receipt verified: **${report.scopedProtectedReceiptVerified}**. Complete validation continues: **runFull=true, skip=false**.`, '',
    `Read budget: **${report.observationBudget.requests}/${report.observationBudget.limits.maxRequests} requests**, **${report.observationBudget.elapsedMs}/${report.observationBudget.limits.maxElapsedMs} ms**; exhausted=${report.observationBudget.exhausted}; reason=${report.observationBudget.reason ?? 'none'}.`, '',
    '| Route | Requests | Elapsed ms | Outcome |', '| --- | --- | --- | --- |',
    ...report.observationBudget.routes.map(route => `| ${route.route} | ${route.requests} | ${route.elapsedMs} | ${route.reason ?? route.outcome} |`), '',
    `Reasons: ${report.reasons.length ? report.reasons.join(', ') : 'completed API execution, archive bytes and scoped actual components independently match'}.`, '',
    'Scope: the fixed no-install Node evidence-core suite only. This read-only observation supplies no fullstack coverage, production authority, merge/deployment action or atomic lease. A new attempt/failure may start after the final read.', '',
  ].join('\n');
  writeFileSync(join(outputDirectory, 'summary.md'), summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'run_full=true\nskip=false\nreuse_authorized=false\n');
  console.log(JSON.stringify({ mode: report.mode, scopedProtectedReceiptVerified: report.scopedProtectedReceiptVerified, runFull: true, skip: false, reuseAuthorized: false, reasons: report.reasons, observationBudget: report.observationBudget }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPilotReceiptObserver().catch(() => { console.error('Pilot observer receipt could not be written; complete validation remains required.'); process.exitCode = 1; });
}
