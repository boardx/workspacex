/** Protected default-branch entry point. Phase one only observes; never authorizes a skip. */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGitHubApi, observeCandidateRun } from './lib/ci-candidate-github.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const safeFallback = (mode, reason) => ({ schemaVersion: 1, mode, skip: false, runFull: true, suites: [{ skip: false, runFull: true, wouldReuse: false, reasons: [reason] }] });

export async function runObserver(env = process.env) {
  const mode = env.CI_CANDIDATE_MODE ?? 'shadow';
  const outputDir = resolve(env.CI_CANDIDATE_OUTPUT_DIR || join(env.RUNNER_TEMP || '/tmp', 'ci-candidate-shadow'));
  mkdirSync(outputDir, { recursive: true });
  let report;
  try {
    // off/unknown modes perform no GitHub lookup. Even reuse is not an approved mode.
    if (mode !== 'shadow') report = safeFallback(mode, mode === 'off' ? 'reuse_disabled' : 'reuse_not_approved');
    else {
      const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
      const sourceRunId = Number(env.CI_CANDIDATE_SOURCE_RUN_ID || event.inputs?.source_run_id || event.workflow_run?.id);
      const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const actualCheckout = { sha: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), parents: git(['show', '-s', '--format=%P', 'HEAD']).split(' ').filter(Boolean) };
      report = await observeCandidateRun({ api: createGitHubApi({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }), repositoryName: env.GITHUB_REPOSITORY, sourceRunId, observerRunId: Number(env.GITHUB_RUN_ID), actualCheckout, expectedObserverSha: env.GITHUB_SHA, config: JSON.parse(readFileSync(join(root, '.harness/config/ci-suite-ownership.json'), 'utf8')), mode, freshRun: env.CI_FRESH_RUN === 'true' });
    }
  } catch {
    report = safeFallback(mode, 'observer_bootstrap_or_lookup_failed');
  }
  // Always leave a receipt for the independent upload step, including API 403 or malformed input.
  writeFileSync(join(outputDir, 'shadow-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const manifests = report.suites.filter(suite => suite.manifest).map(suite => suite.manifest);
  writeFileSync(join(outputDir, 'candidate-manifests.json'), `${JSON.stringify(manifests, null, 2)}\n`);
  const lines = [
    '### CI candidate shadow observation', '',
    `Mode: \`${mode.replace(/[^\w.-]/g, '?')}\`. Complete validation continues: **runFull=true, skip=false**.`, '',
    '| Suite | Observation | Fallback reasons |', '| --- | --- | --- |',
    ...report.suites.map(suite => `| ${suite.suite ?? 'observer'} | ${suite.candidateEvidenceGenerated ? 'candidate recorded; awaiting main' : suite.wouldReuse ? 'identity comparison matches' : 'complete execution retained'} | ${suite.reasons.join(', ')} |`), '',
    'The pre-install marker observes host versions only. Actual later-installed tools and container digests are not yet independently attested; a real reuse decision requires those additional facts. No validation, deployment or production check is skipped.', '',
  ];
  const summary = lines.join('\n');
  writeFileSync(join(outputDir, 'summary.md'), summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'run_full=true\nskip=false\n');
  console.log(JSON.stringify({ mode: report.mode, runFull: true, skip: false, suites: report.suites.map(({ suite, wouldReuse, candidateEvidenceGenerated, reasons }) => ({ suite, wouldReuse, candidateEvidenceGenerated, reasons })) }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runObserver().catch(() => { console.error('Observer receipt output failed; complete validation must continue.'); process.exitCode = 1; });
}
