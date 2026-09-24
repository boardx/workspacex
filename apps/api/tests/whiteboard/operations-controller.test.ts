import { expect, it } from 'vitest';
import { WhiteboardOperationsController } from '../../src/interface/controllers/whiteboard-operations.controller';
import { ProcessWhiteboardObservability } from '../../src/infrastructure/whiteboard/observability';
import type { DatabasePort } from '../../src/application/ports/database.port';
import type { SessionTokenStore } from '../../src/application/auth/ports';

const db = (healthy: boolean): DatabasePort => ({
  withTenant: async () => { throw new Error('not used'); },
  withoutTenant: async fn => {
    if (!healthy) throw new Error('down');
    return fn({ query: async <R>() => ({ rows: [{ '?column?': 1 } as R] }) });
  },
  close: async () => undefined,
});
const sessions = (healthy: boolean): SessionTokenStore => ({
  health: async () => healthy,
  issue: async () => '', findByToken: async () => null, revokeAllForUser: async () => 0,
  revokeAllForUserExcept: async () => 0, listForUser: async () => [], revokeSession: async () => null,
  touch: async () => undefined, setCurrentOrg: async () => false,
});
const response = () => {
  const state = { status: 0, type: '' };
  const value = { status: (code: number) => { state.status = code; return value; }, type: (kind: string) => { state.type = kind; return value; } };
  return { state, value };
};

it('readiness fails closed and exposes dependency booleans only', async () => {
  const res = response();
  const controller = new WhiteboardOperationsController(db(true), sessions(false), new ProcessWhiteboardObservability());
  await expect(controller.readiness(res.value as never)).resolves.toEqual({
    status: 'unavailable', dependencies: { database: true, sessionStore: false, validator: true },
  });
  expect(res.state.status).toBe(503);
});

it('metrics endpoint uses Prometheus text format', () => {
  const res = response();
  const text = new WhiteboardOperationsController(db(true), sessions(true), new ProcessWhiteboardObservability()).metricsText(res.value as never);
  expect(res.state.type).toContain('text/plain'); expect(text).toContain('workspacex_whiteboard_active_connections');
});
