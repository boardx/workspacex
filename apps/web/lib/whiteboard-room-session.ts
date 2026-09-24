import { ApiError } from './api-client';
import type { RoomGrant, RoomViewport } from './live-whiteboard-room';

const ACTIVE_ROOM_KEY = 'wsx.board.room.active';
const PRESENTER_KEY = 'wsx.board.presenter.';

export type StoredRoomSession = { grant: RoomGrant; follow: boolean };

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
function remove(key:string){try{storage()?.removeItem(key);}catch{/* storage denial must not terminate a live room */}}
function write(key:string,value:string){try{storage()?.setItem(key,value);}catch{/* the in-memory session remains usable */}}

export function restoreRoomSession(): StoredRoomSession | null {
  const raw=storage()?.getItem(ACTIVE_ROOM_KEY); if(!raw)return null;
  try {
    const value=JSON.parse(raw) as StoredRoomSession;
    if(!value?.grant?.sessionId || !/^[0-9a-f-]{36}$/i.test(value.grant.sessionId) || !value.grant.token)return null;
    return {grant:value.grant,follow:value.follow!==false};
  } catch { remove(ACTIVE_ROOM_KEY); return null; }
}

export function persistRoomSession(value: StoredRoomSession) {
  write(ACTIVE_ROOM_KEY,JSON.stringify(value));
}

export function clearRoomSession(sessionId?: string) {
  remove(ACTIVE_ROOM_KEY);
  if(sessionId)remove(`wsx.board.room.${sessionId}`);
}

export function restorePresenterSession(boardId:string) {
  const value=storage()?.getItem(`${PRESENTER_KEY}${boardId}`) || null;
  return value&&/^[0-9a-f-]{36}$/i.test(value)?value:null;
}

export function persistPresenterSession(boardId:string,sessionId:string|null) {
  const key=`${PRESENTER_KEY}${boardId}`;
  if(sessionId)write(key,sessionId);else remove(key);
}

export function isAuthoritativeRoomEnd(error:unknown) {
  return error instanceof ApiError && [400,401,403,404,410,422].includes(error.status);
}

export function newerViewport(current:RoomViewport|null,next:RoomViewport|null) {
  if(!next)return current;
  return !current || next.revision>current.revision ? next : current;
}
