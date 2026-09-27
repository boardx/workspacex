/** Run only against an already running isolated fullstack database/API.
 * node --import tsx apps/api/tests/whiteboard/support/comment-recovery-acl-race.mjs
 * Requires BOARD_ACL_RACE_ISOLATED=1, BOARD_ACL_API_URL, BOARD_ACL_OWNER_TOKEN,
 * BOARD_ACL_MEMBER_TOKEN, BOARD_ACL_ORG_ID, BOARD_ACL_MEMBER_ID and normal PG*.
 * No services are started. All created boards are archived in finally.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { PgWhiteboardRecoveryAdapter } from '../../../src/infrastructure/whiteboard/pg-whiteboard-recovery.ts';
const require=createRequire(new URL('../../../package.json',import.meta.url));
const {Pool}=require('pg');
const required=name=>{const value=process.env[name];assert(value,`Missing ${name}`);return value;};
assert.equal(required('BOARD_ACL_RACE_ISOLATED'),'1');
const api=required('BOARD_ACL_API_URL').replace(/\/$/,''),owner=required('BOARD_ACL_OWNER_TOKEN'),member=required('BOARD_ACL_MEMBER_TOKEN');
const orgId=required('BOARD_ACL_ORG_ID'),memberId=required('BOARD_ACL_MEMBER_ID');
const pool=new Pool({max:5});let boardId;
const call=async(token,method,path,body)=>{
 const response=await fetch(`${api}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const text=await response.text();return{status:response.status,text,json:()=>JSON.parse(text)};
};
const ok=async(...args)=>{const result=await call(...args);assert(result.status>=200&&result.status<300,`API setup failed ${result.status}`);return result;};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const withTenant=async(tenant,work)=>{const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('app.current_org',$1,true)",[tenant]);const value=await work(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
const evidence=[];
async function lockedRace(name,mutation,operation,verify){
 await ok(owner,'PUT',`/whiteboards/${boardId}/members`,{userId:memberId,role:'editor'});
 const blocker=await pool.connect();let pending,committed=false;
 try{
  await blocker.query('BEGIN');await blocker.query("SELECT set_config('app.current_org',$1,true)",[orgId]);
  const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await blocker.query('SELECT id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE',[orgId,boardId]);
  await mutation(blocker);
  pending=operation().then(value=>({value}),error=>({error}));
  let observed=false;
  for(let i=0;i<100;i++){
   const waiting=await pool.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[pid]);
   if(waiting.rows[0].count>0){observed=true;break;}await sleep(20);
  }
  assert(observed,`${name}: did not prove request was waiting behind revocation lock`);
  await blocker.query('COMMIT');committed=true;
  const outcome=await pending;verify(outcome);evidence.push({name,lockWaitObserved:true,denied:true});
 }finally{if(!committed)await blocker.query('ROLLBACK');if(pending)await pending;blocker.release();}
}
try{
 boardId=(await ok(owner,'POST','/whiteboards',{requestId:randomUUID(),name:`ACL race ${randomUUID()}`})).json().id;
 await ok(owner,'PUT',`/whiteboards/${boardId}/members`,{userId:memberId,role:'commenter'});
 const command={type:'create-comment',requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:null,worldPosition:{x:10,y:10},body:`secret-${randomUUID()}`,mentions:[],expectedRevision:0};
 await ok(member,'POST',`/whiteboards/${boardId}/comments/commands`,command);
 const remove=client=>client.query('DELETE FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3',[orgId,boardId,memberId]);
 for(const mode of ['list','new','replay']){
  const payload=mode==='new'?{...command,requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID()}:command;
  await lockedRace(`comments-${mode}-removed`,remove,()=>call(member,mode==='list'?'GET':'POST',`/whiteboards/${boardId}/comments${mode==='list'?'':'/commands'}`,mode==='list'?undefined:payload),outcome=>{assert.equal(outcome.value?.status,404);assert(!outcome.value.text.includes(command.body));});
 }
 const adapter=new PgWhiteboardRecoveryAdapter({withTenant},{load(){throw new Error('unused');}});
 const principal={orgId,userId:memberId};
 await lockedRace('recovery-head-removed',remove,()=>adapter.head(principal,boardId),outcome=>assert.equal(outcome.error?.code,'NOT_FOUND'));
 for(const action of ['downgrade','archive']){
  const checkpointId=randomUUID(),manifest={version:1,boardId,checkpointId,epoch:1,seq:0,objectKey:`whiteboards/${boardId}/checkpoints/${checkpointId}.yjs`,contentHash:`sha256:${'0'.repeat(64)}`,byteSize:2,createdBy:memberId,createdAt:new Date().toISOString()};
  const event={type:'CheckpointCreated',eventId:checkpointId,operationId:checkpointId,boardId,checkpointId,epoch:1,seq:0,actorId:memberId,occurredAt:manifest.createdAt};
  await lockedRace(`checkpoint-publish-${action}`,client=>action==='downgrade'?client.query("UPDATE whiteboard_members SET role='viewer' WHERE org_id=$1 AND board_id=$2 AND user_id=$3",[orgId,boardId,memberId]):client.query('UPDATE whiteboards SET archived=true WHERE org_id=$1 AND id=$2',[orgId,boardId]),()=>adapter.saveCheckpoint(principal,manifest,checkpointId,event),outcome=>assert.equal(outcome.error?.code,'FORBIDDEN'));
  const count=await withTenant(orgId,client=>client.query('SELECT count(*)::int AS count FROM whiteboard_checkpoints WHERE org_id=$1 AND board_id=$2 AND checkpoint_id=$3',[orgId,boardId,checkpointId]));assert.equal(count.rows[0].count,0);
 }
 console.log(JSON.stringify({boardId,evidence},null,2));
}finally{
 if(boardId)await withTenant(orgId,client=>client.query('UPDATE whiteboards SET archived=true WHERE org_id=$1 AND id=$2',[orgId,boardId]));
 await pool.end();
}
