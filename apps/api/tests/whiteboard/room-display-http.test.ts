/** Real HTTP/PostgreSQL acceptance for meeting-room pairing and read-only display sessions. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { whiteboard as W, whiteboardRoom as R } from '@repo/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = '1'; process.env.KERNEL_QUIET = '1';
process.env.WHITEBOARD_ROOM_SECRET = 'room-http-acceptance-secret-3979-at-least-32-chars';
const ORG='wb-room-http-3979', OTHER='wb-room-http-other', OWNER='wb-room-owner', EDITOR='wb-room-editor';
let app:NestExpressApplication, base:string, boardId:string;
const auth=(userId=OWNER,orgId=ORG)=>({'content-type':'application/json','x-kernel-test-principal':`${userId}:${orgId}`});
const json=(method:string,path:string,body?:unknown,headers:Record<string,string>={'content-type':'application/json'})=>fetch(`${base}${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
async function pairing(userId=OWNER){const response=await json('POST',`/whiteboards/${boardId}/room-pairings`,{requestId:randomUUID()},auth(userId));expect(response.status).toBe(201);return R.Pairing.parse(await response.json());}

beforeAll(async()=>{
  ensureDatabase();await migrateOnce();await resetOrgs(ORG,OTHER);await seedOrg({orgId:ORG,projectId:`${ORG}-project`});await seedOrg({orgId:OTHER,projectId:`${OTHER}-project`});
  await addOrgMember(ORG,OWNER,'consultant',null);await addOrgMember(ORG,EDITOR,'consultant',null);
  const {createApp}=await import('../../src/main');app=await createApp();await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address();if(!address||typeof address==='string')throw new Error('missing address');base=`http://127.0.0.1:${address.port}`;
  const created=await json('POST','/whiteboards',{requestId:randomUUID(),name:'会议室 Board'},auth());boardId=W.Board.parse(await created.json()).id;
  expect((await json('PUT',`/whiteboards/${boardId}/members`,{userId:EDITOR,role:'editor'},auth())).status).toBe(200);
});
afterAll(async()=>{await app?.close();await resetOrgs(ORG,OTHER);});

describe('meeting-room display real boundary',()=>{
  it('consumes a pairing once, follows viewport, and stops immediately after revoke',async()=>{
    const p=await pairing();const joined=await json('POST','/whiteboard-room/join',{orgId:ORG,pairingId:p.id,code:p.code});expect(joined.status).toBe(200);const grant=R.RoomGrant.parse(await joined.json());
    expect((await json('POST','/whiteboard-room/join',{orgId:ORG,pairingId:p.id,code:p.code})).status).toBe(404);
    const initial=await json('POST',`/whiteboard-room/${grant.sessionId}/state`,{orgId:ORG,token:grant.token});expect(initial.status).toBe(200);expect(R.RoomState.parse(await initial.json())).toMatchObject({boardId,viewport:null});
    const viewport=await json('PUT',`/whiteboards/${boardId}/room-sessions/${grant.sessionId}/viewport`,{x:120,y:-30,zoom:1.5},auth());expect(viewport.status).toBe(200);
    const followed=R.RoomState.parse(await (await json('POST',`/whiteboard-room/${grant.sessionId}/state`,{orgId:ORG,token:grant.token})).json());expect(followed.viewport).toMatchObject({x:120,y:-30,zoom:1.5,revision:1});
    expect((await json('DELETE',`/whiteboards/${boardId}/room-sessions/${grant.sessionId}`,undefined,auth())).status).toBe(200);
    expect((await json('POST',`/whiteboard-room/${grant.sessionId}/state`,{orgId:ORG,token:grant.token})).status).toBe(404);
  });

  it('rate-limits brute force, hides tenants, and rechecks presenter membership before join',async()=>{
    const attacked=await pairing();let status=0;for(let i=0;i<9;i++)status=(await json('POST','/whiteboard-room/join',{orgId:ORG,pairingId:attacked.id,code:'BAD-CODE'})).status;expect(status).toBe(429);
    const cross=await pairing();expect((await json('POST','/whiteboard-room/join',{orgId:OTHER,pairingId:cross.id,code:cross.code})).status).toBe(404);
    const editorPairing=await pairing(EDITOR);expect((await json('DELETE',`/whiteboards/${boardId}/members/${EDITOR}`,undefined,auth())).status).toBe(200);
    expect((await json('POST','/whiteboard-room/join',{orgId:ORG,pairingId:editorPairing.id,code:editorPairing.code})).status).toBe(404);
  });
});
