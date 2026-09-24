import type { whiteboard as W, whiteboardTransfer as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';

export const WHITEBOARD_TRANSFER_STORE = Symbol('WhiteboardTransferStore');
export type TransferErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'ARCHIVED' | 'VALIDATION_FAILED' | 'IDEMPOTENCY_CONFLICT';
export class WhiteboardTransferError extends Error {
  constructor(readonly code: TransferErrorCode) { super(code); this.name = 'WhiteboardTransferError'; }
}
export interface WhiteboardTransferStore {
  exportBoard(principal: Principal, boardId: string): Promise<C.PortableBoardPackage>;
  previewImport(principal: Principal, input: C.ImportBoardInput): Promise<C.ImportBoardPreview>;
  importBoard(principal: Principal, input: C.ImportBoardInput): Promise<{ board: W.Board; importedObjects: number; remappedObjects: number; replayed: boolean }>;
}
