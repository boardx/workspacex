import type { whiteboardHistory as H } from '@repo/contracts';
import type { z } from 'zod';
import type { Principal } from '../../domain/principal';

export const WHITEBOARD_HISTORY_STORE = Symbol('WhiteboardHistoryStore');
export type CreateCheckpointInput = z.infer<typeof H.CreateCheckpoint>;
export type CompareCheckpointInput = z.infer<typeof H.CompareCheckpoint>;
export type RestoreCheckpointInput = z.infer<typeof H.RestoreCheckpoint>;

export interface WhiteboardHistoryStore {
  head(principal: Principal, boardId: string): Promise<H.HistoryHead>;
  list(principal: Principal, boardId: string): Promise<H.Checkpoint[]>;
  create(principal: Principal, boardId: string, input: CreateCheckpointInput): Promise<H.Checkpoint>;
  preview(principal: Principal, boardId: string, checkpointId: string): Promise<z.infer<typeof H.CheckpointPreview>>;
  compare(principal: Principal, boardId: string, input: CompareCheckpointInput): Promise<z.infer<typeof H.CheckpointComparison>>;
  restore(principal: Principal, boardId: string, checkpointId: string, input: RestoreCheckpointInput): Promise<H.RestoreReceipt>;
  copy(principal: Principal, boardId: string, checkpointId: string, input: RestoreCheckpointInput): Promise<H.RestoreReceipt>;
}
