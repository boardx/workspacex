import {describe, expect, it} from 'vitest';
import {primaryFailure,acceptanceFailureSecrets} from '../../e2e/support/board-primary-failure';

describe('acceptance failure receipts', () => {
  it('records no primary failure when acceptance succeeded', () => {
    expect(primaryFailure(undefined)).toBeNull();
    expect(primaryFailure(null)).toBeNull();
  });

  it('preserves a nested upstream failure before login and cleanup errors', () => {
    const upstream = new Error('upstream response unavailable');
    const login = new Error('login navigation failed');
    const routeCleanup = new Error('route cleanup failed');
    const proxyCleanup = new Error('proxy cleanup failed');
    const original = new AggregateError([upstream, login, routeCleanup], 'BOARD_LOGIN_CAPTURE_FAILED');
    const final = new AggregateError([original, proxyCleanup], 'Origin-close acceptance or cleanup failed');

    const receipt = JSON.parse(JSON.stringify(primaryFailure(final)));
    expect(receipt.errors[0].message).toBe('BOARD_LOGIN_CAPTURE_FAILED');
    expect(receipt.errors[0].errors.map((error: {message: string}) => error.message)).toEqual([
      upstream.message, login.message, routeCleanup.message,
    ]);
    expect(receipt.errors[0].errors[0].stack).toBe(upstream.stack);
    expect(receipt.errors[1].message).toBe(proxyCleanup.message);
    expect([...original.errors]).toEqual([upstream, login, routeCleanup]);
  });

  it('keeps the primary receipt unchanged when secondary cleanup fails', () => {
    const original = new Error('initial peer synchronization failed');
    const before = primaryFailure(original);
    const receipt = JSON.parse(JSON.stringify({
      primaryFailure: primaryFailure(original),
      secondaryErrors: [new Error('screenshot failed'), new Error('proxy restore failed')].map(error=>primaryFailure(error)),
    }));
    expect(receipt.primaryFailure).toEqual(before);
    expect(receipt.primaryFailure.message).toBe(original.message);
    expect(receipt.secondaryErrors.map((error: {message: string}) => error.message)).toEqual([
      'screenshot failed', 'proxy restore failed',
    ]);
  });
});

it('redacts login fill secrets and tokens throughout nested errors and stacks', () => {
  const secrets = acceptanceFailureSecrets({password:'private-password',adminPassword:'private-admin'},'private-token'); // Synthetic test fixture.
  const error = new AggregateError([new Error('fill(\"private-password\") timed out; Bearer private-token'),new Error('private-admin cleanup')], 'private-token wrapper');
  const receipt = JSON.stringify(primaryFailure(error,secrets));
  for (const secret of secrets) expect(receipt).not.toContain(secret);
  expect(receipt).toContain('[REDACTED]');
});

it('redacts the owned fault proxy control header in a network failure diagnostic', () => {
  const secret = 'private-fault-control-secret'; // Synthetic test fixture.
  const error = new AggregateError([new Error(`apiRequestContext.post failed\n x-board-fault-control: ${secret}`)], 'proxy restore failed');
  const receipt = JSON.stringify(primaryFailure(error,[secret]));
  expect(receipt).not.toContain(secret);
  expect(receipt).toContain('x-board-fault-control: [REDACTED]');
});
