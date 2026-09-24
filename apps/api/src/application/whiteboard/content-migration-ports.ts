export type BoardContentMigrationState = 'enrolled' | 'candidate_ready' | 'verified' | 'cutover' | 'cleaning' | 'completed';

export interface LegacyBoardUpdate {
  seq: number;
  update: Uint8Array;
}

export interface LegacyBoardWatermark {
  epoch: number;
  headSeq: number;
  fencingToken: number;
  storageKind: 'legacy_pg' | 'blob_primary';
}

export interface LegacyBoardInventory extends LegacyBoardWatermark {
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
  cutoverAt: string | null;
  retirementNotBefore: string | null;
  retirementProofDigest: string | null;
  retirementEpoch: number | null;
  retirementHeadSeq: number | null;
  retirementManifestDigest: string | null;
  retirementCheckpointDigest: string | null;
  attempts: number;
  lastErrorCode: string | null;
}

export interface BoardRetirementHead extends LegacyBoardWatermark {
  manifestKey: string;
  manifestDigest: string;
  manifestPlainDigest: string;
  manifestSizeBytes: number;
  tenantKeyVersion: number;
}

export interface BoardContentMigrationRepository {
  loadOrEnroll(tenantId: string, boardId: string, jobId: string): Promise<BoardContentMigrationRecord>;
  captureWatermark(tenantId: string, boardId: string): Promise<LegacyBoardWatermark>;
  readInventory(tenantId: string, boardId: string, watermark: LegacyBoardWatermark): Promise<LegacyBoardInventory>;
  saveCandidate(tenantId: string, boardId: string, record: BoardContentMigrationRecord, candidate: BoardMigrationCandidate): Promise<BoardContentMigrationRecord>;
  markVerified(tenantId: string, boardId: string, record: BoardContentMigrationRecord): Promise<BoardContentMigrationRecord>;
  cutover(tenantId: string, boardId: string, record: BoardContentMigrationRecord, retirementNotBefore: Date): Promise<BoardContentMigrationRecord>;
  captureRetirementHead(tenantId: string, boardId: string): Promise<BoardRetirementHead>;
  beginRetirement(tenantId: string, boardId: string, record: BoardContentMigrationRecord, head: BoardRetirementHead, checkpointDigest: string, proofDigest: string, now: Date): Promise<BoardContentMigrationRecord>;
  cleanupBatch(tenantId: string, boardId: string, record: BoardContentMigrationRecord, batchSize: number): Promise<BoardContentMigrationRecord>;
  resetForChangedSource(tenantId: string, boardId: string, record: BoardContentMigrationRecord, watermark: LegacyBoardWatermark): Promise<BoardContentMigrationRecord>;
  recordFailure(tenantId: string, boardId: string, jobId: string, errorCode: string): Promise<void>;
}

export const BOARD_CONTENT_MIGRATION_REPOSITORY = Symbol('BoardContentMigrationRepository');
