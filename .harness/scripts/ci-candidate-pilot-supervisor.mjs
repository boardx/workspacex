/** Manual main-only protected bootstrap. This file never imports/checks out candidate code on host. */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fingerprint } from './lib/ci-candidate-evidence.mjs';
import { createGitHubApi } from './lib/ci-candidate-github.mjs';
import { verifyPilotBootstrap } from './lib/ci-candidate-pilot-authority.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const POLICY_PATH = '.harness/config/ci-candidate-pilot.json';
const SHA = /^[a-f0-9]{40}$/;
const positiveId = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
const requireFact = (value, reason) => { if (!value) { const error = new Error(reason); error.reason = reason; throw error; } };

function builtinGit(repositoryRoot, env) {
  // Do not inherit GH_TOKEN, alternate Git config, preload variables or credential helpers.
  const gitEnv = { PATH: env.PATH || process.env.PATH, HOME: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: 'https' };
  const exactUrl = `https://github.com/${env.GITHUB_REPOSITORY}.git`;
  const prefix = ['--no-replace-objects', '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'credential.helper=', '-c', `credential.${exactUrl}.helper=`, '-c', 'http.extraHeader=', '-c', `http.${exactUrl}.extraHeader=`, '-c', 'http.cookieFile=', '-c', `http.${exactUrl}.cookieFile=`];
  return args => execFileSync('git', [...prefix, ...args], { cwd: repositoryRoot, env: gitEnv, encoding: 'utf8', timeout: args.includes('fetch') ? 180_000 : 15_000, maxBuffer: 8_388_608, stdio: ['ignore', 'pipe', 'pipe'] });
}

function candidateBinding(resolved, sourceRunId) {
  const candidate = resolved?.candidate;
  const producer = resolved?.producer;
  requireFact(resolved?.skip === false && resolved.runFull === true && resolved.protectedVerified === false && resolved.historyObservation?.stableDuringRead === true && resolved.historyObservation.measurementBound === true && resolved.historyObservation.skipAuthorization === false, 'pilot_candidate_history_not_consistent');
  requireFact(producer?.runId === sourceRunId && Number.isSafeInteger(producer.runAttempt) && producer.runAttempt > 0 && Number.isSafeInteger(producer.workflowId) && producer.workflowId > 0 && producer.path === '.github/workflows/harness-verify.yml' && ['pull_request', 'merge_group'].includes(producer.event) && candidate?.prNumber > 0 && Number.isSafeInteger(candidate.prNumber), 'pilot_candidate_source_identity_invalid');
  requireFact([candidate.baseSha, candidate.headSha, candidate.mergeSha, candidate.sourceTree].every(sha => SHA.test(sha ?? '')) && Array.isArray(candidate.parents) && JSON.stringify(candidate.parents) === JSON.stringify([candidate.baseSha, candidate.headSha]) && candidate.mergeable === true && candidate.headCurrent === true, 'pilot_candidate_checkout_invalid');
  requireFact(producer.headSha === (producer.event === 'pull_request' ? candidate.headSha : candidate.mergeSha), 'pilot_candidate_producer_sha_mismatch');
  return { sourceRunId: producer.runId, sourceRunAttempt: producer.runAttempt, workflowId: producer.workflowId, workflowPath: producer.path, event: producer.event, prNumber: candidate.prNumber, baseSha: candidate.baseSha, headSha: candidate.headSha, mergeSha: candidate.mergeSha, fullTree: candidate.sourceTree, parents: candidate.parents };
}

/** dependencies is a trusted in-process test seam; no workflow input selects modules, files or commands. */
export async function runPilotSupervisor(env = process.env, dependencies = {}) {
  const repositoryRoot = dependencies.repositoryRoot ?? ROOT;
  const outputDirectory = resolve(env.CI_CANDIDATE_OUTPUT_DIR || join(env.RUNNER_TEMP || '/tmp', 'ci-candidate-runtime-pilot'));
  mkdirSync(outputDirectory, { recursive: true });
  const report = { schemaVersion: 1, mode: 'shadow-manual-pilot', skip: false, runFull: true, apiVerified: false, protectedVerified: false, pilotStarted: false, pilotCompleted: false, reasons: [], bootstrap: null, candidate: null, controller: null, policyFingerprint: null, pilot: null };
  try {
    requireFact(positiveId(env.GITHUB_RUN_ID) && positiveId(env.GITHUB_RUN_ATTEMPT) && positiveId(env.CI_CANDIDATE_SOURCE_RUN_ID) && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? ''), 'pilot_cli_inputs_invalid');
    requireFact(env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && SHA.test(env.GITHUB_SHA ?? ''), 'pilot_cli_main_dispatch_required');
    const sourceRunId = Number(env.CI_CANDIDATE_SOURCE_RUN_ID);
    const git = dependencies.git ?? builtinGit(repositoryRoot, env);
    // Only Git/Node builtins have executed before these independent API gates.
    const actualCheckout = { sha: git(['rev-parse', '--verify', 'HEAD^{commit}']).trim(), tree: git(['rev-parse', '--verify', 'HEAD^{tree}']).trim(), parents: git(['show', '-s', '--format=%P', 'HEAD']).trim().split(' ').filter(Boolean) };
    const api = dependencies.api ?? createGitHubApi({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN });
    const bootstrap = await verifyPilotBootstrap({ api, repositoryName: env.GITHUB_REPOSITORY, runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT), sourceRunId, actualCheckout, expectedSha: env.GITHUB_SHA, ref: env.GITHUB_REF, event: env.GITHUB_EVENT_NAME, runnerName: env.RUNNER_NAME, runnerEnvironment: env.RUNNER_ENVIRONMENT });
    report.bootstrap = bootstrap;
    requireFact(bootstrap.bootstrapVerified === true, bootstrap.reasons[0] || 'pilot_bootstrap_rejected');
    report.controller = { sha: actualCheckout.sha, tree: actualCheckout.tree, parents: actualCheckout.parents, workflowDefinitionBlob: bootstrap.authority.definitionBlob };
    // Main policy and controller code must still match the immutable checkout.
    git(['diff', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD', '--', '.harness', '.github', 'package.json', '.npmrc', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.nvmrc']);
    const policyText = readFileSync(join(repositoryRoot, POLICY_PATH), 'utf8');
    requireFact(git(['show', `${actualCheckout.sha}:${POLICY_PATH}`]) === policyText, 'pilot_protected_policy_bytes_changed');
    const policy = JSON.parse(policyText);
    requireFact(policy?.schemaVersion === 1, 'pilot_fixed_policy_schema_invalid');
    report.policyFingerprint = fingerprint(policy);
    const ownership = JSON.parse(readFileSync(join(repositoryRoot, '.harness/config/ci-suite-ownership.json'), 'utf8'));
    const resolveCandidate = dependencies.resolveCandidate ?? (await import('./lib/ci-candidate-github.mjs')).resolvePilotCandidate;
    requireFact(typeof resolveCandidate === 'function', 'pilot_candidate_resolver_unavailable');
    const resolved = await resolveCandidate({ api, repositoryName: env.GITHUB_REPOSITORY, sourceRunId, authority: bootstrap.authority, config: ownership });
    const candidate = candidateBinding(resolved, sourceRunId);
    report.candidate = candidate;
    requireFact(bootstrap.repository.public === true, 'pilot_anonymous_repository_required');
    // Command-line header/helper resets are supplemented by rejecting local
    // URL rewrites or credential-bearing configuration, without ever logging values.
    const localConfig = git(['config', '--local', '--null', '--list']);
    const localKeys = localConfig.split('\0').filter(Boolean).map(entry => entry.split('\n')[0].toLowerCase());
    requireFact(!localKeys.some(key => /^url\..*\.insteadof$/.test(key) || /^http\.(?:.*\.)?(?:extraheader|cookiefile)$/.test(key) || /^credential\./.test(key)), 'pilot_git_local_credentials_or_url_rewrite');
    // Fixed anonymous URL, exact SHA, no checkout, credentials or FETCH_HEAD mutation.
    git(['fetch', '--no-tags', '--no-write-fetch-head', `https://github.com/${env.GITHUB_REPOSITORY}.git`, candidate.mergeSha]);
    requireFact(git(['rev-parse', '--verify', `${candidate.mergeSha}^{tree}`]).trim() === candidate.fullTree && JSON.stringify(git(['show', '-s', '--format=%P', candidate.mergeSha]).trim().split(' ').filter(Boolean)) === JSON.stringify(candidate.parents), 'pilot_fetched_candidate_identity_changed');
    const runPilot = dependencies.runPilot ?? (await import('./lib/ci-candidate-pilot.mjs')).runCandidatePilot;
    requireFact(typeof runPilot === 'function', 'pilot_executor_unavailable');
    // Receipt lives outside the candidate mount and contains no token or candidate-selected command.
    writeFileSync(join(outputDirectory, 'protected-bootstrap.json'), `${JSON.stringify({ schemaVersion: 1, protectedVerified: false, apiVerified: false, authority: bootstrap.authority, controller: report.controller, candidate, policyFingerprint: report.policyFingerprint }, null, 2)}\n`);
    report.pilotStarted = true;
    const pilot = await runPilot({ repositoryRoot, candidateSha: candidate.mergeSha, outputDirectory: join(outputDirectory, 'execution'), policy });
    report.pilot = pilot;
    requireFact(pilot?.skip === false && pilot.runFull === true && pilot.verified === false && pilot.reuseAuthorized === false && pilot.protectedVerified !== true && pilot.apiVerified !== true, 'pilot_executor_returned_unsupported_authority');
    report.pilotCompleted = true;
    requireFact(pilot.executionSuccessful === true && pilot.proofComplete === true, 'pilot_execution_or_proof_incomplete');
  } catch (error) {
    report.reasons.push(typeof error?.reason === 'string' && /^[a-z0-9_:-]{1,120}$/.test(error.reason) ? error.reason : 'pilot_bootstrap_resolver_or_execution_failed');
  }
  writeFileSync(join(outputDirectory, 'pilot-supervisor-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const summary = [
    '### Manual isolated CI candidate pilot', '',
    `Complete validation continues: **runFull=true, skip=false**. Protected final authority: **false**.`, '',
    `Bootstrap verified: **${report.bootstrap?.bootstrapVerified === true}**. Pilot started: **${report.pilotStarted}**. Pilot completed: **${report.pilotCompleted}**.`, '',
    `Reasons: ${report.reasons.length ? report.reasons.join(', ') : 'none at bootstrap; external completed-run/receipt verification remains required'}.`, '',
    'This is an in-progress bootstrap/execution receipt. An independent observer must authenticate the completed main workflow/job and artifact digest before treating a scoped proof as protected. It does not authorize skipping full validation or deployment checks.', '',
  ].join('\n');
  writeFileSync(join(outputDirectory, 'pilot-supervisor-summary.md'), summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  console.log(JSON.stringify({ mode: report.mode, runFull: true, skip: false, protectedVerified: false, bootstrapVerified: report.bootstrap?.bootstrapVerified === true, pilotStarted: report.pilotStarted, pilotCompleted: report.pilotCompleted, reasons: report.reasons }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPilotSupervisor().then(report => { if (report.reasons.length > 0) process.exitCode = 1; }).catch(() => { console.error('Pilot receipt output failed; full validation remains required.'); process.exitCode = 1; });
}
