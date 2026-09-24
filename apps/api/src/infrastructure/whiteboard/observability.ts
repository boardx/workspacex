import type { LoggerPort } from '../../application/ports/logger.port';
import type { WhiteboardMetricOutcome, WhiteboardObservability, WhiteboardRejectReason, WhiteboardTraceEvent } from '../../application/whiteboard/observability';

type Bucket = { readonly ceilingMs: number; count: number };
type Histogram = { count: number; sumMs: number; readonly buckets: Bucket[] };

const histogram = (): Histogram => ({
  count: 0,
  sumMs: 0,
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
    .map(ceilingMs => ({ ceilingMs, count: 0 })),
});

/** Process-local low-cardinality metrics. Never accepts board, org or user identifiers. */
export class ProcessWhiteboardObservability implements WhiteboardObservability {
  private activeConnections = 0;
  private validatorActive = 0;
  private validatorQueued = 0;
  private readonly rejects = new Map<WhiteboardRejectReason, number>();
  private reconnects = 0;
  private readonly compactions = new Map<WhiteboardMetricOutcome, number>();
  private readonly updates = new Map<WhiteboardMetricOutcome, Histogram>();
  private readonly validations = new Map<WhiteboardMetricOutcome, Histogram>();
  private readonly persistence = new Map<WhiteboardMetricOutcome, Histogram>();

  connection(delta: 1 | -1): void { this.activeConnections = Math.max(0, this.activeConnections + delta); }
  reconnect(): void { this.reconnects++; }
  reject(reason: WhiteboardRejectReason): void { this.rejects.set(reason, (this.rejects.get(reason) ?? 0) + 1); }
  validatorState(active: number, queued: number): void {
    this.validatorActive = Math.max(0, active); this.validatorQueued = Math.max(0, queued);
  }
  validatorReady(maxQueued: number): boolean { return this.validatorQueued < maxQueued; }
  update(outcome: WhiteboardMetricOutcome, elapsedMs: number): void { this.observe(this.updates, outcome, elapsedMs); }
  validation(outcome: WhiteboardMetricOutcome, elapsedMs: number): void { this.observe(this.validations, outcome, elapsedMs); }
  persisted(outcome: WhiteboardMetricOutcome, elapsedMs: number): void { this.observe(this.persistence, outcome, elapsedMs); }
  compaction(outcome: WhiteboardMetricOutcome): void { this.compactions.set(outcome, (this.compactions.get(outcome) ?? 0) + 1); }

  trace(logger: LoggerPort | undefined, traceId: string, event: WhiteboardTraceEvent,
    fields: { readonly outcome: WhiteboardMetricOutcome; readonly reason?: WhiteboardRejectReason; readonly elapsedMs?: number }): void {
    logger?.info('whiteboard_sync', { traceId, event, ...fields });
  }

  prometheus(): string {
    const lines = [
      '# HELP workspacex_whiteboard_active_connections Current accepted WebSocket connections.',
      '# TYPE workspacex_whiteboard_active_connections gauge',
      `workspacex_whiteboard_active_connections ${this.activeConnections}`,
      '# HELP workspacex_whiteboard_validator_active Current validator worker jobs.',
      '# TYPE workspacex_whiteboard_validator_active gauge',
      `workspacex_whiteboard_validator_active ${this.validatorActive}`,
      '# HELP workspacex_whiteboard_validator_queued Current validator jobs waiting in the bounded queue.',
      '# TYPE workspacex_whiteboard_validator_queued gauge',
      `workspacex_whiteboard_validator_queued ${this.validatorQueued}`,
      '# HELP workspacex_whiteboard_reconnect_total Sync hellos carrying prior state.',
      '# TYPE workspacex_whiteboard_reconnect_total counter',
      `workspacex_whiteboard_reconnect_total ${this.reconnects}`,
      '# HELP workspacex_whiteboard_compaction_total Durable update-log compaction attempts.',
      '# TYPE workspacex_whiteboard_compaction_total counter',
      ...(['accepted', 'rejected', 'error'] as const).map(outcome => `workspacex_whiteboard_compaction_total{outcome="${outcome}"} ${this.compactions.get(outcome) ?? 0}`),
      '# HELP workspacex_whiteboard_reject_total Rejected operations by bounded reason.',
      '# TYPE workspacex_whiteboard_reject_total counter',
      ...(['access', 'archive', 'dependency', 'limit', 'protocol', 'stale', 'validation'] as const)
        .map(reason => `workspacex_whiteboard_reject_total{reason="${reason}"} ${this.rejects.get(reason) ?? 0}`),
      ...this.renderHistogram('workspacex_whiteboard_update_duration_ms', this.updates),
      ...this.renderHistogram('workspacex_whiteboard_validator_duration_ms', this.validations),
      ...this.renderHistogram('workspacex_whiteboard_persistence_duration_ms', this.persistence),
    ];
    return `${lines.join('\n')}\n`;
  }

  private observe(target: Map<WhiteboardMetricOutcome, Histogram>, outcome: WhiteboardMetricOutcome, elapsedMs: number): void {
    const value = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    const item = target.get(outcome) ?? histogram();
    item.count++; item.sumMs += value;
    for (const bucket of item.buckets) if (value <= bucket.ceilingMs) bucket.count++;
    target.set(outcome, item);
  }

  private renderHistogram(name: string, values: Map<WhiteboardMetricOutcome, Histogram>): string[] {
    const lines = [`# TYPE ${name} histogram`];
    for (const outcome of ['accepted', 'rejected', 'error'] as const) {
      const item = values.get(outcome) ?? histogram();
      for (const bucket of item.buckets) lines.push(`${name}_bucket{outcome="${outcome}",le="${bucket.ceilingMs}"} ${bucket.count}`);
      lines.push(`${name}_bucket{outcome="${outcome}",le="+Inf"} ${item.count}`);
      lines.push(`${name}_sum{outcome="${outcome}"} ${item.sumMs}`);
      lines.push(`${name}_count{outcome="${outcome}"} ${item.count}`);
    }
    return lines;
  }
}
