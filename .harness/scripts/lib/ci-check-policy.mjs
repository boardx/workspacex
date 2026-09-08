/** Versioned policy: the merge parent determines historical obligations. */
import { readFileSync } from 'node:fs';

export const POLICY_PATH = '.harness/config/ci-check-policy.json';
// Frozen pre-versioning contract, used only when the verified commit lacks a policy file.
export const LEGACY_POLICY = Object.freeze({ version: 1, requiredChecks: ['verify-control-plane', 'verify-affected', 'verify-full-compile'], aggregates: {}, allowedMergeMethods: ['merge', 'squash', 'rebase'] });
const names = value => Array.isArray(value) && value.length > 0 && value.every(x => typeof x === 'string' && /^[a-z][a-z0-9-]*$/.test(x)) && new Set(value).size === value.length;
export function parsePolicy(value) {
  if (value?.version !== 2 || !names(value.requiredChecks) || !value.aggregates || typeof value.aggregates !== 'object' || Array.isArray(value.aggregates)) throw new Error('Invalid CI check policy');
  for (const [name, dependencies] of Object.entries(value.aggregates)) {
    if (!value.requiredChecks.includes(name) || !names(dependencies) || dependencies.includes(name)) throw new Error('Invalid aggregate policy');
  }
  if (JSON.stringify(value.allowedMergeMethods) !== JSON.stringify(['merge', 'squash'])) throw new Error('Versioned policy requires unambiguous merge or squash history');
  return value;
}
export const CURRENT_POLICY = parsePolicy(JSON.parse(readFileSync(new URL('../../config/ci-check-policy.json', import.meta.url), 'utf8')));

export function policyAtCommit(sha, exec) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Missing immutable policy commit');
  if (exec(`git cat-file -e ${sha}^{commit}`).code !== 0) throw new Error(`Cannot read policy commit ${sha}`);
  const tree = exec(`git ls-tree --name-only ${sha} -- ${POLICY_PATH}`);
  if (tree.code !== 0) throw new Error('Cannot inspect policy tree');
  if (!tree.stdout.trim()) {
    const shallow = exec('git rev-parse --is-shallow-repository');
    if (shallow.code !== 0 || shallow.stdout.trim() !== 'false') throw new Error('Cannot prove legacy policy from incomplete history');
    const history = exec(`git log -1 --format=%H ${sha} -- ${POLICY_PATH}`);
    if (history.code !== 0 || history.stdout.trim()) throw new Error('Versioned policy is missing or deleted');
    return LEGACY_POLICY;
  }
  const file = exec(`git show ${sha}:${POLICY_PATH}`);
  if (file.code !== 0) throw new Error('Cannot read policy file');
  return parsePolicy(JSON.parse(file.stdout));
}

export function loadCommitPolicy(sha, exec) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Missing immutable policy commit');
  if (exec(`git cat-file -e ${sha}^{commit}`).code !== 0 && exec(`git fetch --no-tags origin ${sha}`).code !== 0) throw new Error('Cannot fetch policy commit');
  return policyAtCommit(sha, exec);
}

export function aggregateFailures(name, results, policy = CURRENT_POLICY) {
  const dependencies = policy.aggregates[name];
  if (!names(dependencies)) throw new Error('Missing aggregate definition');
  return dependencies.filter(dependency => results?.[dependency]?.result !== 'success');
}
