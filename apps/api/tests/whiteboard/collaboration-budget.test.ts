import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WHITEBOARD_SYNC } from '@repo/contracts/whiteboard-sync';

it('keeps runtime document and update budgets within persisted bytea checks', () => {
  const sql = readFileSync(new URL('../../migrations/20260924000200_whiteboard_collaboration.sql', import.meta.url), 'utf8');
  const snapshot = /snapshot bytea[^\n]+octet_length\(snapshot\) <= (\d+)/.exec(sql);
  const update = /update bytea[^\n]+octet_length\(update\) <= (\d+)/.exec(sql);
  expect(Number(snapshot?.[1])).toBeGreaterThanOrEqual(WHITEBOARD_SYNC.documentBytes);
  expect(Number(update?.[1])).toBeGreaterThanOrEqual(WHITEBOARD_SYNC.persistedUpdateBytes);
});

it('wires the small inbound frame to transport and keeps slow-client backpressure fail-closed', () => {
  const source = readFileSync(new URL('../../src/interface/ws/whiteboard.gateway.ts', import.meta.url), 'utf8');
  expect(source).toContain('maxPayload: WHITEBOARD_SYNC.inboundFrameBytes');
  expect(source).toContain("if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'slow client'); return; }");
  expect(source).not.toMatch(/bufferedAmount[^\n]+message\.type/);
});
