import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import type {RoomState} from './board-meeting-room-evidence';
// Read only, scoped to the freshly created board. Never starts, resets, or migrates a DB.
export async function persistedRoomState(orgId: string, boardId: string, roomId: string): Promise<RoomState> {
  if (!process.env.WORKSPACEX_ISOLATION_ID || !process.env.WORKSPACEX_DB || process.env.WORKSPACEX_DB === 'workspacex') throw new Error('ROOM_REQUIRES_ISOLATED_STACK');
  const fixture = await tsImport(pathToFileURL(resolve(__dirname, '../../../api/tests/support/db.ts')).href, {parentURL: pathToFileURL(__filename).href, tsconfig: resolve(__dirname, '../../../api/tsconfig.json')}) as {asApp<T>(orgId: string, fn: (db: {query<T>(sql: string, values: unknown[]): Promise<{rows: T[]}>}) => Promise<T>): Promise<T>};
  return fixture.asApp(orgId, async db => {
    const result = await db.query<{state: RoomState}>('SELECT state FROM whiteboard_presentation_sessions WHERE org_id=$1 AND board_id=$2 AND room_id=$3', [orgId, boardId, roomId]);
    if (result.rows.length !== 1) throw new Error('ROOM_PERSISTED_ROW_MISSING');
    return result.rows[0]!.state;
  });
}
