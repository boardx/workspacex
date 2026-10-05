/** Phase-one ownership is a coverage inventory, never permission to skip. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

export const BASELINE_SHA = 'd4f15668ace9883fc6ce3a20ab87032a18ec4a9d';
export const SOURCE_WORKFLOWS = [
  '.github/workflows/harness-verify.yml',
  '.github/workflows/backend-gates.yml',
  '.github/workflows/board-acceptance.yml',
  '.github/workflows/board-native-acceptance.yml',
];
export const IDENTITY_ACTION = './.github/actions/ci-candidate-identity';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = '.harness/config/ci-suite-ownership.json';
const REQUIRED_IDENTITY_PATHS = ['pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', '.nvmrc', 'turbo.json',
  'apps/deep-agent-service/uv.lock', 'apps/deep-agent-service/pyproject.toml', '.harness/playwright-runtime-images.json', CONFIG_PATH];
const safePath = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/')
  && !value.includes('\\') && value.split('/').every(part => part !== '.' && part !== '..');

// These expressions are numeric GitHub runtime values, not values supplied by a
// PR. Matching two different examples catches accidentally fixed run IDs.
export function materializeNumericName(value, sample = '12345') {
  if (typeof value !== 'string') return '';
  return value.replace(/\$\{\{\s*(github\.run_id|github\.run_attempt|matrix\.shard|needs\.api-test-plan\.outputs\.count)\s*\}\}/g, sample);
}

export function inspectSuiteOwnership({ config, loadWorkflow, pathExists, baselinePathExists }) {
  const errors = [];
  const retainedCoverageGaps = [];
  const issue = (code, suite, message, path) => errors.push({ code, suite, message, ...(path ? { path } : {}) });
  const workflows = new Map();
  function workflow(path) {
    if (workflows.has(path)) return workflows.get(path);
    try {
      const value = loadWorkflow(path);
      if (!value || typeof value.jobs !== 'object') throw new Error('missing jobs');
      workflows.set(path, value);
      return value;
    } catch (error) {
      issue('workflow-unreadable', null, String(error.message), path);
      workflows.set(path, null);
      return null;
    }
  }
  if (config?.version !== 1 || config?.mode !== 'shadow' || config?.baselineSha !== BASELINE_SHA) {
    issue('phase-one-policy', null, 'version 1, pinned baseline and shadow mode are required');
  }
  const expectedPolicy = {
    requiresTrustedGithubRunAndLogs: true, acceptPrSelfReportedJson: false,
    requiresActualCheckoutMarkerBeforeInstall: true, requiresCandidateBaseHeadAndFullTree: true,
    requiresDefinitionsUnchangedFromTrustedBase: true, requiresLockedDependenciesAndEnvironment: true,
    requiresEveryExecutionStepSuccess: true, requiresArtifactDigest: true,
    newerFailureInvalidatesOlderSuccess: true, unavailableOrMalformedEvidence: 'run-full',
    freshRun: 'run-full', squashShaEqualityIsEvidence: false, requiresSameRepositorySource: true,
  };
  for (const [key, value] of Object.entries(expectedPolicy)) {
    if (config?.sourcePolicy?.[key] !== value) issue('unsafe-source-policy', null, `${key} must be ${JSON.stringify(value)}`);
  }
  for (const path of config?.identityPaths ?? []) {
    if (!safePath(path) || !pathExists(path)) issue('identity-path-missing', null, 'identity input must exist in the checkout', path);
  }
  if (!Array.isArray(config?.identityPaths) || config.identityPaths.length === 0) {
    issue('identity-paths-empty', null, 'lock and environment identity inputs are required');
  }
  for (const path of REQUIRED_IDENTITY_PATHS) {
    if (!config?.identityPaths?.includes(path)) issue('identity-input-unbound', null, 'required dependency/toolchain input must be bound', path);
  }
  const expectedJobs = new Set();
  for (const path of SOURCE_WORKFLOWS) {
    for (const job of Object.keys(workflow(path)?.jobs ?? {})) expectedJobs.add(`${path}:${job}`);
  }
  if (expectedJobs.size !== 36) issue('source-job-count', null, `phase-one inventory expects all 36 existing jobs; found ${expectedJobs.size}`);
  const suites = config?.suites;
  if (!Array.isArray(suites)) {
    issue('suites-missing', null, 'suites must be an array');
    return { errors, retainedCoverageGaps, suiteCount: 0, jobCount: expectedJobs.size };
  }
  const seenIds = new Set();
  const seenOwners = new Set();
  const allArtifactNames = [];
  for (const path of SOURCE_WORKFLOWS) {
    for (const [job, value] of Object.entries(workflow(path)?.jobs ?? {})) {
      for (const step of value.steps ?? []) {
        if (step.uses?.startsWith('actions/upload-artifact@') && typeof step.with?.name === 'string') {
          allArtifactNames.push({ owner: `${path}:${job}`, name: step.with.name });
        }
      }
    }
  }
  for (const suite of suites) {
    const id = suite?.id;
    if (typeof id !== 'string' || !id || seenIds.has(id)) issue('suite-id', id, 'suite IDs must be nonempty and unique');
    seenIds.add(id);
    const owner = suite?.owner;
    const ownerKey = `${owner?.workflow}:${owner?.job}`;
    if (!safePath(owner?.workflow) || !SOURCE_WORKFLOWS.includes(owner.workflow) || typeof owner?.job !== 'string') {
      issue('invalid-owner', id, 'owner must identify a source workflow job');
      continue;
    }
    if (seenOwners.has(ownerKey)) issue('duplicate-owner', id, `job ${ownerKey} has more than one logical owner`);
    seenOwners.add(ownerKey);
    const definition = workflow(owner.workflow);
    const job = definition?.jobs?.[owner.job];
    if (!job) { issue('owner-job-missing', id, 'owner job does not exist', owner.workflow); continue; }
    if (!['retain', 'observe-and-run'].includes(suite.phase1)) issue('phase-one-skip', id, 'phase one permits only retain or observe-and-run');
    const events = suite.eligibleSourceEvents;
    if (!Array.isArray(events) || events.some(event => !['pull_request', 'merge_group'].includes(event))) {
      issue('source-events', id, 'only PR or merge-group candidate sources can be observed');
    }
    const eligible = Array.isArray(events) && events.length > 0;
    if (eligible && (suite.phase1 !== 'observe-and-run' || suite.role !== 'validation')) {
      issue('eligible-suite-kind', id, 'eligible suites must observe-and-run actual validation');
    }
    if (!eligible && suite.phase1 !== 'retain') issue('unobservable-suite', id, 'unobservable suites must retain full execution');
    for (const event of events ?? []) {
      if (!Object.hasOwn(definition.on ?? {}, event)) issue('source-event-not-triggered', id, `owner workflow does not trigger ${event}`);
    }
    if (['main-only', 'manual-only', 'deployment', 'aggregate', 'event-dependent'].includes(suite.coverageKind) && eligible) {
      issue('coverage-not-equivalent', id, `${suite.coverageKind} coverage cannot be claimed as reusable candidate execution`);
    }
    const execution = suite.execution;
    const listKeys = ['actualStepNames', 'actualStepNamePatterns', 'artifactNamePatterns'];
    for (const key of listKeys) {
      if (!Array.isArray(execution?.[key]) || execution[key].some(value => typeof value !== 'string' || !value)
        || new Set(execution?.[key]).size !== execution?.[key]?.length) {
        issue('execution-list', id, `${key} must contain unique nonempty strings`);
      }
    }
    if (execution?.scopeOrReusedVerdictIsExecution !== false) issue('reused-is-not-execution', id, 'scope/reuse output must never count as execution');
    if (job.strategy?.matrix && execution?.allMatrixChildrenMustExecute !== true) issue('matrix-coverage', id, 'every matrix child must execute successfully');
    const steps = job.steps ?? [];
    for (const name of execution?.actualStepNames ?? []) {
      if (!steps.some(step => step.name === name && typeof step.run === 'string')) issue('execution-step-missing', id, `actual execution step does not exist: ${name}`);
      if (eligible && /^(Find existing|Preserve .*verdict|Require |Freeze admitted)/i.test(name)) issue('non-execution-step', id, `${name} is a verdict or planning step`);
    }
    function checkedPattern(pattern, code) {
      try {
        if (!pattern.startsWith('^') || !pattern.endsWith('$')) throw new Error('must be anchored');
        return new RegExp(pattern);
      } catch (error) { issue(code, id, `${pattern}: ${error.message}`); return null; }
    }
    for (const pattern of execution?.actualStepNamePatterns ?? []) {
      const regex = checkedPattern(pattern, 'execution-pattern-invalid');
      if (regex && !steps.some(step => typeof step.run === 'string' && ['12345', '901'].every(sample => regex.test(materializeNumericName(step.name, sample))))) {
        issue('execution-pattern-missing', id, `pattern matches no real runtime execution step: ${pattern}`);
      }
    }
    for (const pattern of execution?.artifactNamePatterns ?? []) {
      const regex = checkedPattern(pattern, 'artifact-pattern-invalid');
      if (!regex) continue;
      const matching = allArtifactNames.filter(entry => ['12345', '901'].every(sample => regex.test(materializeNumericName(entry.name, sample))));
      if (!matching.some(entry => entry.owner === ownerKey)) issue('artifact-pattern-missing', id, `pattern matches no owner artifact upload: ${pattern}`);
      if (matching.some(entry => entry.owner !== ownerKey)) issue('artifact-pattern-ambiguous', id, `pattern also matches another suite's artifact: ${pattern}`);
    }
    if (eligible) {
      if (!execution?.actualStepNames?.length && !execution?.actualStepNamePatterns?.length) issue('execution-empty', id, 'eligible suite requires actual execution steps');
      if (!execution?.artifactNamePatterns?.length) issue('artifact-empty', id, 'eligible suite requires GitHub artifact digest evidence');
      const markerIndex = steps.findIndex(step => step.uses === IDENTITY_ACTION);
      const installIndex = steps.findIndex(step => /\bpnpm install\b/.test(step.run ?? ''));
      if (markerIndex < 0 || installIndex < 0 || markerIndex >= installIndex) issue('identity-after-execution', id, 'identity marker must precede first package installation');
      const checkoutIndex = steps.findIndex(step => step.uses?.startsWith('actions/checkout@'));
      if (markerIndex !== checkoutIndex + 1 || steps.slice(0, markerIndex).some(step => step.run || step.uses?.startsWith('./'))) {
        issue('identity-preceded-by-candidate-execution', id, 'identity must immediately follow checkout, before any candidate code can alter the action or runner environment');
      }
    }
    for (const duplicate of suite.duplicates ?? []) {
      if (!safePath(duplicate.workflow) || !workflow(duplicate.workflow)?.jobs?.[duplicate.job] || !duplicate.relation || !duplicate.reason) {
        issue('duplicate-reference-invalid', id, 'overlap references need a real job, relation and reason');
      }
    }
    for (const path of suite.definitionPaths ?? []) {
      if (!safePath(path) || !pathExists(path)) issue('definition-path-missing', id, 'test/workflow definition input must exist', path);
    }
    if (!suite.definitionPaths?.includes(owner.workflow)) issue('workflow-definition-unbound', id, 'owner workflow must be bound in definitionPaths');
    for (const path of suite.requiredCoveragePaths ?? []) {
      if (!safePath(path)) { issue('coverage-path-invalid', id, 'required coverage must be a safe repository path', path); continue; }
      let baselinePresent = false;
      try { baselinePresent = baselinePathExists(path); }
      catch (error) { issue('baseline-unreadable', id, String(error.message), path); continue; }
      const checkoutPresent = pathExists(path);
      if (!baselinePresent || !checkoutPresent) {
        const gap = { suite: id, path, baselinePresent, checkoutPresent, decision: 'retain-full', reason: 'required coverage input is absent; full equivalence has not been proved' };
        retainedCoverageGaps.push(gap);
        if (eligible || suite.phase1 !== 'retain') issue('coverage-gap-reuse', id, 'missing required coverage forbids candidate reuse', path);
      }
    }
  }
  for (const key of expectedJobs) if (!seenOwners.has(key)) issue('unowned-job', null, `existing job ${key} has no suite owner`);
  for (const key of seenOwners) if (!expectedJobs.has(key)) issue('unexpected-owned-job', null, `inventory owner ${key} is not an existing source job`);
  return { errors, retainedCoverageGaps, suiteCount: suites.length, jobCount: expectedJobs.size };
}

export function inspectCheckoutOwnership(root = ROOT) {
  const config = JSON.parse(readFileSync(resolve(root, CONFIG_PATH), 'utf8'));
  // Failure to read Git history is different from a path known to be absent.
  execFileSync('git', ['cat-file', '-e', `${BASELINE_SHA}^{commit}`], { cwd: root, stdio: 'pipe' });
  const requiredPaths = [...new Set((config.suites ?? []).flatMap(suite => suite.requiredCoveragePaths ?? []))];
  const baselinePaths = new Set(requiredPaths.length ? execFileSync('git', ['ls-tree', '-r', '--name-only', BASELINE_SHA, '--', ...requiredPaths], { cwd: root, encoding: 'utf8' }).trim().split('\n') : []);
  return inspectSuiteOwnership({
    config,
    loadWorkflow: path => parse(readFileSync(resolve(root, path), 'utf8')),
    pathExists: path => existsSync(resolve(root, path)),
    baselinePathExists: path => baselinePaths.has(path),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = inspectCheckoutOwnership();
    if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`CI suite ownership: ${result.suiteCount} suites, ${result.jobCount} existing jobs; shadow-only inventory.`);
      for (const gap of result.retainedCoverageGaps) console.log(`RETAIN FULL ${gap.suite}: ${gap.path} (baseline=${gap.baselinePresent}, checkout=${gap.checkoutPresent}); no equivalence claim.`);
      for (const error of result.errors) console.error(`ERROR ${error.code} ${error.suite ?? ''}: ${error.message}`);
    }
    if (result.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(`CI suite ownership cannot be verified: ${error.message}`);
    process.exitCode = 1;
  }
}
