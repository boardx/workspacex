import {describe,expect,it} from 'vitest';
import * as room from '../src/whiteboard-room';
describe('whiteboard room contract',()=>{
  it('keeps the grant read-only and rejects leaked or unbounded fields',()=>{
    expect(room.RoomGrant.parse({orgId:'org-1',sessionId:'11111111-1111-4111-8111-111111111111',token:'x'.repeat(40),boardId:'22222222-2222-4222-8222-222222222222',boardName:'B',expiresAt:'2030-01-01T00:00:00.000Z',role:'room-viewer'}).role).toBe('room-viewer');
    expect(room.RoomGrant.safeParse({orgId:'org-1',sessionId:'11111111-1111-4111-8111-111111111111',token:'x'.repeat(40),boardId:'22222222-2222-4222-8222-222222222222',boardName:'B',expiresAt:'2030-01-01T00:00:00.000Z',role:'editor'}).success).toBe(false);
    expect(room.JoinRoom.safeParse({orgId:'org-1',pairingId:'11111111-1111-4111-8111-111111111111',code:'ABCDEFGH',write:true}).success).toBe(false);
  });
  it('bounds presenter viewports',()=>{
    expect(room.PublishViewport.parse({x:0,y:0,zoom:1})).toEqual({x:0,y:0,zoom:1});
    expect(room.PublishViewport.safeParse({x:0,y:0,zoom:100}).success).toBe(false);
    expect(room.PublishViewport.safeParse({x:Number.NaN,y:0,zoom:1}).success).toBe(false);
  });
});
