import { expect, it } from 'vitest';
import { whiteboardRejectReason } from '../../src/application/whiteboard/observability';
import { ProcessWhiteboardObservability } from '../../src/infrastructure/whiteboard/observability';

it('exports bounded labels and aggregate gauges without tenant identifiers', () => {
  const metrics = new ProcessWhiteboardObservability();
  metrics.connection(1); metrics.connection(1); metrics.connection(-1);
  metrics.validatorState(3, 7); metrics.reconnect(); metrics.reject('limit');
  metrics.update('accepted', 42); metrics.validation('rejected', 12); metrics.persisted('error', 80); metrics.compaction('accepted');
  const output = metrics.prometheus();
  expect(output).toContain('workspacex_whiteboard_active_connections 1');
  expect(output).toContain('workspacex_whiteboard_validator_active 3');
  expect(output).toContain('workspacex_whiteboard_validator_queued 7');
  expect(output).toContain('workspacex_whiteboard_reject_total{reason="limit"} 1');
  expect(output).toContain('workspacex_whiteboard_update_duration_ms_count{outcome="accepted"} 1');
  expect(output).toContain('workspacex_whiteboard_compaction_total{outcome="accepted"} 1');
  expect(output).not.toMatch(/boardId|orgId|userId|text|content/);
  expect(output.length).toBeLessThan(20_000);
});

it('maps arbitrary failures into a fixed rejection vocabulary', () => {
  expect(whiteboardRejectReason('FORBIDDEN')).toBe('access');
  expect(whiteboardRejectReason('ARCHIVED')).toBe('archive');
  expect(whiteboardRejectReason('STALE_EPOCH')).toBe('stale');
  expect(whiteboardRejectReason('PROTOCOL_LIMIT')).toBe('protocol');
  expect(whiteboardRejectReason('unexpected secret-bearing message')).toBe('dependency');
});

it('emits structured trace fields without accepting identifiers', () => {
  const entries: unknown[] = [];
  const metrics = new ProcessWhiteboardObservability();
  metrics.trace({ info: (msg, fields) => entries.push({ msg, fields }), error: () => undefined },
    'trace-1', 'update', { outcome: 'accepted', elapsedMs: 12 });
  expect(entries).toEqual([{ msg: 'whiteboard_sync', fields: {
    traceId: 'trace-1', event: 'update', outcome: 'accepted', elapsedMs: 12,
  } }]);
});
