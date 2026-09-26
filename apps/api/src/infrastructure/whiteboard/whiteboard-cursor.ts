import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Principal } from '../../domain/principal';
import type { ListBoards } from '../../application/whiteboard/ports';
import { WhiteboardResourceError } from '../../application/whiteboard/ports';

type CursorPayload = {
  v: 1; orgId: string; userId: string; query: string | null; tagIds: string[]; archived: string; limit: number;
  updatedAt: string; id: string;
};
const canonicalFilter = (p: Principal, input: ListBoards) => ({
  orgId: p.orgId, userId: p.userId, query: input.query ?? null, tagIds: input.tagIds ?? [], archived: input.archived, limit: input.limit,
});
export class WhiteboardCursorCodec {
  constructor(private readonly secret: string = whiteboardCursorSecret()) {
    if (Buffer.byteLength(secret) < 32) throw new Error('WHITEBOARD_CURSOR_SECRET must contain at least 32 bytes');
  }
  encode(p: Principal, input: ListBoards, row: { updatedAt: string; id: string }): string {
    const body = Buffer.from(JSON.stringify({ v: 1, ...canonicalFilter(p, input), ...row } satisfies CursorPayload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }
  decode(p: Principal, input: ListBoards): { updatedAt: string; id: string } | null {
    if (!input.cursor) return null;
    const [body, signature, extra] = input.cursor.split('.');
    if (!body || !signature || extra !== undefined) throw new WhiteboardResourceError('CURSOR_INVALID');
    const expected = this.sign(body);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new WhiteboardResourceError('CURSOR_INVALID');
    let payload: CursorPayload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload; }
    catch { throw new WhiteboardResourceError('CURSOR_INVALID'); }
    const filter = canonicalFilter(p, input);
    if (payload.v !== 1 || payload.orgId !== filter.orgId || payload.userId !== filter.userId || payload.query !== filter.query
      || payload.archived !== filter.archived || payload.limit !== filter.limit || JSON.stringify(payload.tagIds) !== JSON.stringify(filter.tagIds)) {
      throw new WhiteboardResourceError('CURSOR_FILTER_MISMATCH');
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(payload.updatedAt) || !/^[0-9a-f-]{36}$/i.test(payload.id)) throw new WhiteboardResourceError('CURSOR_INVALID');
    return { updatedAt: payload.updatedAt, id: payload.id };
  }
  private sign(body: string): string { return createHmac('sha256', this.secret).update(`whiteboard-list:${body}`).digest('base64url'); }
}
export function whiteboardCursorSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WHITEBOARD_CURSOR_SECRET) return env.WHITEBOARD_CURSOR_SECRET;
  if (env.NODE_ENV === 'production') throw new Error('WHITEBOARD_CURSOR_SECRET is required in production');
  return 'workspacex-development-whiteboard-cursor-secret-change-me';
}
