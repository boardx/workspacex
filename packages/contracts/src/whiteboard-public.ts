import { z } from 'zod';
import { BoardId, BoardRole, CreateBoard } from './whiteboard';
import { WhiteboardCommandBatch, WhiteboardObject, WHITEBOARD_LIMITS } from './whiteboard-document';
const epoch = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PublicWhiteboardCommands = z.object({ epoch, requestId: CreateBoard.shape.requestId, commands: WhiteboardCommandBatch }).strict();
export type PublicWhiteboardCommands = z.infer<typeof PublicWhiteboardCommands>;
export const PublicWhiteboardDocument = z.object({ boardId: BoardId, epoch, seq, role: BoardRole, archived: z.boolean(), objects: z.array(WhiteboardObject).max(WHITEBOARD_LIMITS.objects) }).strict();
export type PublicWhiteboardDocument = z.infer<typeof PublicWhiteboardDocument>;
export const PublicWhiteboardCommandResult = z.object({ boardId: BoardId, epoch, seq, requestId: CreateBoard.shape.requestId, replayed: z.boolean(), durable: z.literal(true) }).strict();
export type PublicWhiteboardCommandResult = z.infer<typeof PublicWhiteboardCommandResult>;
export const operations = {
  readDocument: { method: 'GET', path: '/whiteboards/:boardId/document', in: z.object({ boardId: BoardId }).strict(), out: PublicWhiteboardDocument },
  writeCommands: { method: 'POST', path: '/whiteboards/:boardId/commands', in: PublicWhiteboardCommands, out: PublicWhiteboardCommandResult },
} as const;
