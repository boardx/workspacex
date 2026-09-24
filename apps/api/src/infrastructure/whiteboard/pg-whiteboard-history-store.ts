import type { whiteboardHistory as H } from '@repo/contracts';
import type { z } from 'zod';
import type { Principal } from '../../domain/principal';
import type { CompareCheckpointInput, CreateCheckpointInput, RestoreCheckpointInput, WhiteboardHistoryStore } from '../../application/whiteboard/history-ports';
import { PgWhiteboardCollaborationStore } from './pg-collaboration-store';

/** Thin port adapter: all tenant SQL and authorization stay in the collaboration aggregate. */
export class PgWhiteboardHistoryStore implements WhiteboardHistoryStore {
  constructor(private readonly collaboration: PgWhiteboardCollaborationStore) {}
  head(p: Principal, boardId: string): Promise<H.HistoryHead> { return this.collaboration.historyHead(p,boardId); }
  list(p: Principal, boardId: string): Promise<H.Checkpoint[]> { return this.collaboration.listHistoryCheckpoints(p,boardId); }
  create(p: Principal, boardId: string, input: CreateCheckpointInput): Promise<H.Checkpoint> { return this.collaboration.createHistoryCheckpoint(p,boardId,input); }
  preview(p: Principal, boardId: string, checkpointId: string): Promise<z.infer<typeof H.CheckpointPreview>> { return this.collaboration.previewHistoryCheckpoint(p,boardId,checkpointId); }
  compare(p: Principal, boardId: string, input: CompareCheckpointInput): Promise<z.infer<typeof H.CheckpointComparison>> { return this.collaboration.compareHistoryCheckpoints(p,boardId,input); }
  restore(p: Principal, boardId: string, checkpointId: string, input: RestoreCheckpointInput): Promise<H.RestoreReceipt> { return this.collaboration.restoreHistoryCheckpoint(p,boardId,checkpointId,input); }
}
