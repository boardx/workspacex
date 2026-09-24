export type BoardContentMigrationState = 'enrolled' | 'candidate_ready' | 'verified' | 'cutover' | 'cleaning' | 'completed';

export interface LegacyBoardUpdate {
  seq: number;
  update: Uint8Array;
}

export interface LegacyBoardInventory {
  epoch: number;
  headSeq: number;
  fencingToken: number;
  storageKind: 'legacy_pg' | 'blob_primary';
  snapshot: Uint8Array | null;
  updates: LegacyBoardUpdate[];
}

export interface BoardMigrationCandidate {
  manifestKey: string;
  manifestDigest: string;
  manifestPlainDigest: string;
  manifestSizeBytes: number;
  tenantKeyVersion: number;
}

export interface BoardContentMigrationRecord {
  jobId: string;
  state: BoardContentMigrationState;
  sourceEpoch: number;
  sourceHeadSeq: number;
  sourceFencingToken: number;
  candidate: BoardMigrationCandidate | null;
  cleanupThroughSeq: number;
  attempts: number;
  lastErrorCode: string | null;
}

export interface BoardContentMigrationRepository {
  loadOrEnroll(tenantId: string, boardId: string, jobId: string): Promise<BoardContentMigrationRecord>;
  captureInventory(tenantId: string, boardId: string): Promise<LegacyBoardInventory>;
  saveCandidate(tenantId: string, boardId: string, record: BoardContentMigrationRecord, candidate: BoardMigrationCandidate): Promise<BoardContentMigrationRecord>;
  markVerified(tenantId: string, boardId: string, record: BoardContentMigrationRecord): Promise<BoardContentMigrationRecord>;
  cutover(tenantId: string, boardId: string, record: BoardContentMigrationRecord): Promise<BoardContentMigrationRecord>;
  cleanupBatch(tenantId: string, boardId: string, record: BoardContentMigrationRecord, batchSize: number): Promise<BoardContentMigrationRecord>;
  resetForChangedSource(tenantId: string, boardId: string, record: BoardContentMigrationRecord, inventory: LegacyBoardInventory): Promise<BoardContentMigrationRecord>;
  recordFailure(tenantId: string, boardId: string, jobId: string, errorCode: string): Promise<void>;
}

export const BOARD_CONTENT_MIGRATION_REPOSITORY = Symbol('BoardContentMigrationRepository');
