import { describe, expect, it } from 'vitest';
import { CURRENT_POLICY, LEGACY_POLICY, policyAtCommit } from './ci-check-policy.mjs';
import { classifyChecks } from './pr-queue';

const sha = 'a'.repeat(40);
const green = LEGACY_POLICY.requiredChecks.map(name => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' }));
describe('versioned merge policy', () => {
  it('keeps historical green valid, but current policy waits for backend aggregate', () => {
    expect(classifyChecks(green, LEGACY_POLICY).waitingCi).toEqual([]);
    expect(classifyChecks(green, CURRENT_POLICY).waitingCi.join(' ')).toContain('backend-required');
  });
  it('uses legacy only when a verified commit has no policy file', () => {
    expect(policyAtCommit(sha, cmd => ({code: 0, stdout: cmd.includes('--is-shallow-repository') ? 'false' : ''}))).toEqual(LEGACY_POLICY);
    expect(() => policyAtCommit(sha, () => ({code: 1, stdout: ''}))).toThrow();
  });
  it('rejects deleted policies and incomplete history instead of restoring legacy', () => {
    const read = cmd => ({code: 0, stdout: cmd.includes('--is-shallow-repository') ? 'false' : cmd.startsWith('git log') ? 'b'.repeat(40) : ''});
    expect(() => policyAtCommit(sha, read)).toThrow('deleted');
    expect(() => policyAtCommit(sha, cmd => ({code: 0, stdout: cmd.includes('--is-shallow-repository') ? 'true' : ''}))).toThrow('incomplete');
  });
  it('does not treat malformed or unreadable policy as legacy', () => {
    expect(() => policyAtCommit(sha, cmd => ({code: 0, stdout: cmd.startsWith('git ls-tree') ? 'policy.json' : cmd.startsWith('git show') ? '{}' : ''}))).toThrow();
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { aggregateFailures, parsePolicy } from './ci-check-policy.mjs';
import { rulesetPlan } from '../ci-ruleset-plan.mjs';

describe('backend aggregate and ruleset use the same policy', () => {
  const dependencies = CURRENT_POLICY.aggregates['backend-required'];
  const results = Object.fromEntries(dependencies.map(name => [name, { result: 'success' }]));
  it('checks every backend job including the matrix result, with no browser release gate', () => {
    const workflow = parse(readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/backend-gates.yml'), 'utf8'));
    expect(workflow.jobs['backend-required'].needs).toEqual(dependencies);
    expect(dependencies).not.toContain('e2e-core-loop');
    expect(aggregateFailures('backend-required', results)).toEqual([]);
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      for (const name of dependencies) expect(aggregateFailures('backend-required', { ...results, [name]: {result} })).toEqual([name]);
    }
  });
  it('rejects missing/malformed policy or aggregate instead of silently passing', () => {
    expect(() => parsePolicy({version: 2, requiredChecks: [], aggregates: {}})).toThrow();
    expect(() => aggregateFailures('unknown', results)).toThrow();
  });
  it('renders required checks bound to Actions and preserves existing protection/bypass settings', () => {
    const existing = {name: 'main', conditions: {ref_name: {include: ['~DEFAULT_BRANCH'], exclude: []}}, rules: [{type: 'deletion'}, {type: 'non_fast_forward'}], bypass_actors: []};
    const plan = rulesetPlan(existing, 15368);
    expect(plan.rules.slice(0, 2)).toEqual(existing.rules);
    expect(plan.bypass_actors).toEqual([]);
    expect(plan.rules.find(rule => rule.type === 'pull_request').parameters.allowed_merge_methods).toEqual(CURRENT_POLICY.allowedMergeMethods);
    expect(CURRENT_POLICY.allowedMergeMethods).not.toContain('rebase');
    expect(plan.rules.at(-1).parameters.required_status_checks.map(c => c.context)).toEqual(CURRENT_POLICY.requiredChecks);
    expect(plan.rules.at(-1).parameters.strict_required_status_checks_policy).toBe(true);
    expect(() => rulesetPlan({...existing, rules: [{type: 'required_status_checks'}]}, 15368)).toThrow();
  });
});
