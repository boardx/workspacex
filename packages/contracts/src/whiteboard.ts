/** Whiteboard resource contract. Content updates use a separate collaboration protocol. */
import { z } from 'zod';
export const BoardId = z.string().uuid();
export const BoardRole = z.enum(['owner', 'editor', 'viewer']);
export const Board = z.object({
  id: BoardId, name: z.string().trim().min(1).max(200),
  ownerId: z.string().min(1), role: BoardRole, archived: z.boolean(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type Board = z.infer<typeof Board>;
export const CreateBoard = z.object({ requestId: z.string().uuid(), name: Board.shape.name }).strict();
export const UpdateBoard = z.object({ name: Board.shape.name.optional(), archived: z.boolean().optional() }).strict()
  .refine(v => v.name !== undefined || v.archived !== undefined, 'At least one change is required');
export const Member = z.object({ userId: z.string().min(1).max(200), role: z.enum(['editor', 'viewer']) }).strict();
export const operations = {
  listBoards: { method: 'GET', path: '/whiteboards', in: z.object({}).strict(), out: z.object({ items: z.array(Board) }).strict() },
  createBoard: { method: 'POST', path: '/whiteboards', in: CreateBoard, out: Board },
  getBoard: { method: 'GET', path: '/whiteboards/:boardId', in: z.object({ boardId: BoardId }).strict(), out: Board },
  updateBoard: { method: 'PATCH', path: '/whiteboards/:boardId', in: UpdateBoard, out: Board },
  listMembers: { method: 'GET', path: '/whiteboards/:boardId/members', in: z.object({ boardId: BoardId }).strict(), out: z.object({ items: z.array(Member) }).strict() },
  putMember: { method: 'PUT', path: '/whiteboards/:boardId/members', in: Member, out: z.object({ ok: z.literal(true) }).strict() },
  removeMember: { method: 'DELETE', path: '/whiteboards/:boardId/members/:userId', in: z.object({ userId: z.string().min(1) }).strict(), out: z.object({ ok: z.literal(true) }).strict() },
} as const;
