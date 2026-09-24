import type { BoardContentMigrationReport } from './migrate-board-content';

export type BoardContentRolloutStatus = 'running' | 'paused' | 'cancelled' | 'completed';
export type BoardContentRolloutItemState = 'queued' | 'running' | 'retry' | 'succeeded' | 'failed' | 'cancelled';

export interface BoardContentRolloutLimits {
  pageSize: number;
  maxPagesPerRun: number;
  maxBoardsPerRun: number;
  globalConcurrency: number;
  tenantConcurrency: number;
  ratePerSecond: number;
  phaseBudget: number;
  retryBudget: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  leaseMs: number;
}

export interface BoardContentRolloutJob {
  tenantId: string;
  rolloutId: string;
  status: BoardContentRolloutStatus;
  cursor: string | null;
  exhausted: boolean;
  limits: BoardContentRolloutLimits;
}

export interface BoardContentRolloutLease {
  tenantId: string;
  rolloutId: string;
  boardId: string;
  migrationJobId: string;
  attempt: number;
}

export interface BoardContentRolloutMetrics {
  discovered: number;
  scanned: number;
  migrated: number;
  failed: number;
  retried: number;
  bytesRead: number;
  bytesWritten: number;
  casResets: number;
  orphanCandidates: number;
  phaseCalls: number;
  latencyMs: number;
  remaining: number;
}

export interface BoardContentRolloutSnapshot extends BoardContentRolloutJob {
  metrics: BoardContentRolloutMetrics;
  errors: ReadonlyArray<{ boardId: string; errorCode: string; attempt: number }>;
}

export interface BoardContentRolloutItemOutcome {
  state: 'succeeded' | 'retry' | 'failed';
  errorCode: string | null;
  retryAt: Date | null;
  report: BoardContentMigrationReport | null;
  phaseCalls: number;
  latencyMs: number;
}

/**
 * Durable orchestration seam. Hosted storage/KMS and orphan reclamation stay behind
 * their own injected providers; the rollout never constructs either implementation.
 */
export interface BoardContentRolloutRepository {
  preview(tenantId: string, cursor: string | null, limit: number): Promise<{ boardIds: string[]; remaining: number }>;
  loadOrCreate(tenantId: string, rolloutId: string, limits: BoardContentRolloutLimits): Promise<BoardContentRolloutJob>;
  load(tenantId: string, rolloutId: string): Promise<BoardContentRolloutJob>;
  setControl(tenantId: string, rolloutId: string, status: 'running' | 'paused' | 'cancelled'): Promise<BoardContentRolloutJob>;
  preparePage(tenantId: string, rolloutId: string): Promise<number>;
  claim(tenantId: string, rolloutId: string, workerId: string, limit: number, leaseUntil: Date): Promise<BoardContentRolloutLease[]>;
  release(lease: BoardContentRolloutLease): Promise<void>;
  finish(lease: BoardContentRolloutLease, outcome: BoardContentRolloutItemOutcome): Promise<void>;
  snapshot(tenantId: string, rolloutId: string): Promise<BoardContentRolloutSnapshot>;
}

export const BOARD_CONTENT_ROLLOUT_REPOSITORY = Symbol('BoardContentRolloutRepository');
