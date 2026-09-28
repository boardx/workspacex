import {expect,it} from 'vitest';
import type {Page} from '@playwright/test';
import {ROOM_REQUIREMENTS,validateRoomReceiptIdentity,type RoomReceipt} from '../../e2e/support/board-meeting-room-evidence';
import {observeRoomResponses} from '../../e2e/support/board-meeting-room-observer';
const identities=[{userId:'owner',actorId:'owner'},{userId:'device-user',actorId:'room:test:display'},{userId:'follower',actorId:'follower'}];
const receipt=(toActorId:string):RoomReceipt=>({id:'response',clientId:'owner',method:'POST',status:201,at:new Date().toISOString(),monotonicMs:1,command:{type:'handoff',actorId:'owner',toActorId,expectedRevision:1},state:{boardId:'board',roomId:'test',revision:2,presenterId:toActorId,followers:[],viewport:{x:0,y:0,zoom:1},updatedAt:new Date().toISOString()}});
it('keeps the real duration and sample requirements fixed',()=>{expect(ROOM_REQUIREMENTS.durationMs).toBe(30*60_000);expect(ROOM_REQUIREMENTS.minSamples).toBe(360);});
it('rejects self-handoff and forged authenticated actor mappings',()=>{
 expect(validateRoomReceiptIdentity(receipt('owner'),identities)).toContain('HANDOFF_IDENTITY');
 expect(validateRoomReceiptIdentity({...receipt('follower'),clientId:'device-user'},identities)).toContain('RECEIPT_ACTOR');
 const wrong=receipt('follower');wrong.state!.presenterId='room:test:display';expect(validateRoomReceiptIdentity(wrong,identities)).toContain('HANDOFF_IDENTITY');
 expect(validateRoomReceiptIdentity(receipt('room:test:display'),identities)).toEqual([]);
});
for(const prefix of ['','/__fullstack_api'])it(`records real response fields through ${prefix||'direct API'} without credentials`,async()=>{
 let listener!: (value:unknown)=>void;const rows:RoomReceipt[]=[],errors:string[]=[];
 const finish=observeRoomResponses({on:(_event:string,fn:typeof listener)=>{listener=fn;}} as unknown as Page,'board','owner',rows,errors);
 listener({url:()=>`http://localhost${prefix}/v1/whiteboards/board/presentation`,request:()=>({method:()=> 'POST',postDataJSON:()=>({reconnectToken:'must-not-be-recorded',command:receipt('follower').command})}),status:()=>201,json:async()=>receipt('follower').state});
 await finish();expect(errors).toEqual([]);expect(rows).toHaveLength(1);expect(rows[0]?.command?.toActorId).toBe('follower');expect(JSON.stringify(rows)).not.toContain('must-not-be-recorded');
});
