import {randomUUID} from 'node:crypto';
import type {Page} from '@playwright/test';
import {roomClock, type RoomReceipt, type RoomState} from './board-meeting-room-evidence';
/** Passive observation only. Never records auth headers or room reconnect tokens. */
export function observeRoomResponses(page: Page, boardId: string, clientId: string, receipts: RoomReceipt[], errors: string[]) {
  const pending: Promise<void>[] = [];
  page.on('response', response => {
    if (![`/v1/whiteboards/${boardId}/presentation`,`/__fullstack_api/v1/whiteboards/${boardId}/presentation`].includes(new URL(response.url()).pathname) || response.request().method() !== 'POST') return;
    pending.push((async () => {
      try {
        const input = response.request().postDataJSON() as {command?: {type: string; actorId: string; expectedRevision: number; toActorId?:string}};
        const command = input.command;
        const status = response.status(), body = status >= 200 && status < 300 ? await response.json() as RoomState : undefined;
        receipts.push({...roomClock(), id: randomUUID(), clientId, status, method: 'POST',
          ...(command ? {command: {type: command.type, actorId: command.actorId, expectedRevision: command.expectedRevision,...(command.toActorId?{toActorId:command.toActorId}:{})}} : {}), ...(body ? {state: body} : {})});
      } catch {errors.push('ROOM_RESPONSE_OBSERVATION_FAILED');}
    })());
  });
  return async () => {await Promise.all(pending);};
}
