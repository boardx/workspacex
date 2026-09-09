import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
for (const [file, job, event] of [
  ['backend-gates', 'backend-required', 'pull_request'],
  ['harness-verify', 'e2e-full', 'push'],
]) {
  describe(`${job} cancellation boundary`, () => {
    const workflow = parse(readFileSync(resolve(root, `.github/workflows/${file}.yml`), 'utf8'));
    const condition = workflow.jobs[job].if;
    // Evaluate the actual checked-in boolean expression; not a GitHub runner simulation.
    const evaluate = (cancelled: boolean, eventName = event, full = true) =>
      new Function('always', 'cancelled', 'github', 'inputs', `return (${condition});`)(
        () => true, () => cancelled, { event_name: eventName }, { run_e2e_full: full },
      );
    it('does not schedule a final runner after whole-workflow cancellation', () => {
      expect(evaluate(true)).toBe(false);
    });
    it('still runs after an ordinary dependency failure when workflow is not cancelled', () => {
      // An explicit status function avoids GitHub implicit success() suppressing failed dependencies.
      expect(condition).toContain('always()');
      expect(evaluate(false)).toBe(true);
    });
    if (job === 'e2e-full') {
      it('preserves explicit manual full-verification selection', () => {
        expect(evaluate(false, 'workflow_dispatch', true)).toBe(true);
        expect(evaluate(false, 'workflow_dispatch', false)).toBe(false);
        expect(evaluate(true, 'workflow_dispatch', true)).toBe(false);
        expect(evaluate(false, 'pull_request')).toBe(false);
      });
    } else {
      it('does not add a backend merge aggregate to deployment events', () => {
        expect(evaluate(false, 'push')).toBe(false);
        expect(evaluate(false, 'workflow_dispatch')).toBe(false);
      });
    }
  });
}
