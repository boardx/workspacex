import { ApiError } from './api-client';
import {whiteboardRoom as C} from '@repo/contracts';
import type { RoomGrant, RoomViewport } from './live-whiteboard-room';

const ACTIVE_ROOM_KEY = 'wsx.board.room.active';
const PRESENTER_KEY = 'wsx.board.presenter.active';

export type StoredRoomSession = { grant: RoomGrant; boardId:string; follow: boolean };
export type PresenterScope = {boardId:string;orgId:string;userId:string};

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
function remove(key:string){try{storage()?.removeItem(key);}catch{/* storage denial must not terminate a live room */}}
function write(key:string,value:string){try{storage()?.setItem(key,value);}catch{/* the in-memory session remains usable */}}

export function restoreRoomSession(): StoredRoomSession | null {
  try {
    const raw=storage()?.getItem(ACTIVE_ROOM_KEY); if(!raw)return null;
    const value=JSON.parse(raw) as {grant?:unknown;boardId?:unknown;follow?:unknown};
    const grant=C.RoomGrant.safeParse(value.grant);
    if(!grant.success || value.boardId!==grant.data.boardId || typeof value.follow!=='boolean' || Date.parse(grant.data.expiresAt)<=Date.now()){remove(ACTIVE_ROOM_KEY);return null;}
    return {grant:grant.data,boardId:grant.data.boardId,follow:value.follow};
  } catch { remove(ACTIVE_ROOM_KEY); return null; }
}

export function persistRoomSession(value: Omit<StoredRoomSession,'boardId'>) {
  write(ACTIVE_ROOM_KEY,JSON.stringify({...value,boardId:value.grant.boardId}));
}

export function clearRoomSession(sessionId?: string) {
  remove(ACTIVE_ROOM_KEY);
  if(sessionId)remove(`wsx.board.room.${sessionId}`);
}

export function restorePresenterSession(scope:PresenterScope) {
  try{
    const raw=storage()?.getItem(PRESENTER_KEY);if(!raw)return null;
    const value=JSON.parse(raw) as Partial<PresenterScope>&{sessionId?:unknown};
    if(value.boardId!==scope.boardId||value.orgId!==scope.orgId||value.userId!==scope.userId||typeof value.sessionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.sessionId)){remove(PRESENTER_KEY);return null;}
    return value.sessionId;
  }catch{remove(PRESENTER_KEY);return null;}
}

export function persistPresenterSession(scope:PresenterScope,sessionId:string|null) {
  if(sessionId)write(PRESENTER_KEY,JSON.stringify({...scope,sessionId}));else remove(PRESENTER_KEY);
}

export function isAuthoritativeRoomEnd(error:unknown) {
  return error instanceof ApiError && [400,401,403,404,410,422].includes(error.status);
}

export function newerViewport(current:RoomViewport|null,next:RoomViewport|null) {
  if(!next)return current;
  return !current || next.revision>current.revision ? next : current;
}
