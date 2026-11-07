import { describe, expect, it } from 'vitest';
import { smokeVerdict, SMOKE_STEPS } from './ci-smoke-verdict.mjs';

const success = () => Object.fromEntries(SMOKE_STEPS.map((name: string) => [name, { outcome: 'success' }]));

describe('nonblocking PR smoke still provides a strict release verdict', () => {
  it('accepts only actual successful execution and retained evidence', () => {
    expect(smokeVerdict({ run: 'true', steps: success() })).toBe('success');
  });
  it.each(['failure', 'cancelled', 'skipped', undefined, 'unknown'])(
    'rejects %s for every required smoke step', outcome => {
      for (const name of SMOKE_STEPS) {
        expect(smokeVerdict({ run: 'true', steps: { ...success(), [name]: { outcome } } })).toBe('failure');
      }
    },
  );
  it('does not accept missing execution or a job conclusion instead of steps', () => {
    expect(smokeVerdict({ run: 'true', steps: null })).toBe('failure');
    expect(smokeVerdict({ run: '', steps: success() })).toBe('failure');
    expect(smokeVerdict({ run: 'true', steps: { conclusion: 'success' } })).toBe('failure');
  });
  it('reused verdicts require successful lookup and the original true verdict', () => {
    expect(smokeVerdict({ run: 'false', sourceResult: 'success', steps: { dedup: { outcome: 'success' } } })).toBe('success');
    for (const sourceResult of ['failure', '', 'unknown']) {
      expect(smokeVerdict({ run: 'false', sourceResult, steps: { dedup: { outcome: 'success' } } })).toBe('failure');
    }
    expect(smokeVerdict({ run: 'false', sourceResult: 'success', steps: {} })).toBe('failure');
  });
});
