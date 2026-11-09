import { listBoards } from './live-whiteboard';
import { listProjectResources } from './live-project-resources';

/** Reuse each scope's authorized listing, never filter a single organization page by project. */
export async function listChatBoardTargets(projectId?: string): Promise<{ id: string; name: string }[]> {
  if (projectId) {
    const resources = await listProjectResources(projectId);
    return resources.items.filter(item => item.kind === 'whiteboard').map(item => ({ id: item.id, name: item.title }));
  }
  const boards = new Map<string, { id: string; name: string }>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await listBoards({ ...(cursor ? { cursor } : {}) });
    page.items.forEach(board => boards.set(board.id, { id: board.id, name: board.name }));
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error('BOARD_LIST_CURSOR_REPEATED');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...boards.values()];
}
