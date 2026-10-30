import {beforeAll,afterAll,expect,it} from "vitest";
import {createServer,type Server} from "node:http";
import {WebSocket,WebSocketServer} from "ws";
import {mkdtemp,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DurableCreditUsageMeter} from "../../src/infrastructure/billing/durable-credit-usage";
import type {TokenUsageMeterPort} from "../../src/application/agent-run/ports";
import {randomUUID,createHash} from "node:crypto";
import {asOwner,asApp,ensureDatabase,migrateOnce,seedOrg,addOrgMember} from "../support/db";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {appConfig} from "../../src/infrastructure/db/pg-config";
import {PgTokenUsageRepository} from "../../src/infrastructure/auth/pg-token-usage-repository";
import {attachRealtimeDigitalHumanGateway} from "../../src/interface/ws/realtime-digital-human.gateway";
import {toOrgId} from "../../src/domain/org-id";
const prefix="voicebill-"+randomUUID().slice(0,8),user=prefix+"-user",personal=toOrgId(prefix+"-personal"),team=toOrgId(prefix+"-team");
let db:PgDatabase,server:Server,upstream:WebSocketServer,gateway:WebSocketServer,url:string;
let meter:DurableCreditUsageMeter;
let directory:string,holdStart:Promise<void>|null=null,entered=false,heldRequest="";
const providers:WebSocket[]=[],clients:WebSocket[]=[];
// @global-scope-fixture table:credit_wallets: only exact random personal/team fixture wallets and their request/period/ledger rows are removed in teardown.
beforeAll(async()=>{
 ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());
 await seedOrg({orgId:personal,kind:"personal-local",ownerUserId:user,projectId:personal+"-p"});await addOrgMember(personal,user,"admin",null);
 await seedOrg({orgId:team,projectId:team+"-p"});await addOrgMember(team,user,"admin",null);
 await asApp(personal,c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('user',$1,-0.01)",[user]));
 await asApp(team,c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id,balance) VALUES('team',$1,-1)",[team]));
 upstream=new WebSocketServer({port:0,host:"127.0.0.1"});await new Promise<void>(resolve=>upstream.on("listening",resolve));const addr=upstream.address();if(typeof addr==="string"||!addr)throw Error("listener");
 upstream.on("connection",socket=>{providers.push(socket);socket.on("message",raw=>{const event=JSON.parse(String(raw));if(event.type==="session.update")socket.send(JSON.stringify({type:"session.updated"}));});});
 directory=await mkdtemp(join(tmpdir(),"voice-credit-spool-"));meter=new DurableCreditUsageMeter(new PgTokenUsageRepository(db),{directory});
 const usage:TokenUsageMeterPort={startRequest:async(context,input)=>{await meter.startRequest(context,input);if(holdStart){heldRequest=input.requestId;entered=true;await holdStart;}},record:(context,input)=>meter.record(context,input)};
 server=createServer();gateway=attachRealtimeDigitalHumanGateway(server,{principals:{resolve:async (h:{authorization?:string})=>({userId:user,orgId:h.authorization==="Bearer team"?team:personal})},usage,config:()=>({baseUrl:`ws://127.0.0.1:${addr.port}/realtime`,apiKey:"test-key",model:"voice-model",defaultVoice:"Tina",voiceMap:{}})} as never);
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const a=server.address();if(typeof a==="string"||!a)throw Error("listener");url=`ws://127.0.0.1:${a.port}/chat/realtime-digital-human`;
});
afterAll(async()=>{for(const c of clients)c.terminate();for(const p of providers)p.terminate();await new Promise<void>(r=>gateway.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));await new Promise<void>(r=>upstream.close(()=>r()));await asOwner(async c=>{await c.query("DELETE FROM credit_consumption_requests WHERE org_id=ANY($1::text[])",[[personal,team]]);await c.query("DELETE FROM organizations WHERE id=ANY($1::text[])",[[personal,team]]);await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id=ANY($1::text[]))",[[user,team]]);await c.query("DELETE FROM credit_wallets WHERE owner_id=ANY($1::text[])",[[user,team]]);});await db.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function connect(token="personal"){
 const client=new WebSocket(url,["bearer."+token]),frames:Record<string,unknown>[]=[];clients.push(client);client.on("message",raw=>frames.push(JSON.parse(String(raw))));
 await new Promise<void>((resolve,reject)=>{client.once("open",resolve);client.once("error",reject);});client.send(JSON.stringify({type:"session.start",boardId:"fixture-board"}));return {client,frames};
}
const balance=async(orgId:typeof personal,owner:string)=>(await asApp(orgId,c=>c.query("SELECT balance::text FROM credit_wallets WHERE owner_id=$1",[owner]))).rows[0].balance;
const done=(socket:WebSocket,id:string,tokens:number)=>socket.send(JSON.stringify({type:"response.done",response:{id,status:"completed",usage:{total_tokens:tokens,input_tokens:tokens,output_tokens:0}}}));
it("rejects personal debt before opening any provider WebSocket",async()=>{
 const {frames}=await connect();await expect.poll(()=>frames.some(x=>x.type==="session.error")).toBe(true);
 expect(frames.find(x=>x.type==="session.error")).toMatchObject({reason:"CREDIT_REQUIRED",credit:{code:"credit_required",ownerType:"user",ownerId:user}});expect(providers).toHaveLength(0);
});
it("bills cumulative provider response usage once, completes into debt and blocks a new connection",async()=>{
 await asApp(personal,c=>c.query("UPDATE credit_wallets SET balance=0 WHERE owner_id=$1",[user]));const {client,frames}=await connect();await expect.poll(()=>frames.some(x=>x.type==="session.ready")).toBe(true);const socket=providers.at(-1)!;
 done(socket,"response-1",1);await expect.poll(()=>balance(personal,user)).toBe("-0.01");done(socket,"response-1",1);done(socket,"response-2",9);done(socket,"response-3",1);
 await expect.poll(()=>balance(personal,user)).toBe("-0.02");const count=providers.length;const next=await connect();await expect.poll(()=>next.frames.some(x=>x.reason==="CREDIT_REQUIRED")).toBe(true);expect(providers).toHaveLength(count);
 client.send(JSON.stringify({type:"session.stop"}));await expect.poll(()=>client.readyState).toBe(WebSocket.CLOSED);
 await expect.poll(async()=>(await asApp(personal,c=>c.query("SELECT count(*)::int AS count,sum(tokens_total)::text AS tokens FROM token_usage_events WHERE org_id=$1",[personal]))).rows[0]).toEqual({count:1,tokens:"11"});
 expect((await asApp(personal,c=>c.query("SELECT state,debited_hundredths::text AS debit FROM credit_consumption_requests WHERE org_id=$1",[personal]))).rows).toEqual([{state:"settled",debit:"2"}]);
});
it("allows enterprise debt and retains confirmed charges as pending when another response lacks usage",async()=>{
 const {client,frames}=await connect("team");await expect.poll(()=>frames.some(x=>x.type==="session.ready")).toBe(true);const socket=providers.at(-1)!;
 done(socket,"enterprise-known",1000);await expect.poll(()=>balance(team,team)).toBe("-2.00");socket.send(JSON.stringify({type:"response.done",response:{id:"enterprise-unknown",status:"cancelled"}}));client.send(JSON.stringify({type:"session.stop"}));await expect.poll(()=>client.readyState).toBe(WebSocket.CLOSED);
 await expect.poll(async()=>(await asApp(team,c=>c.query("SELECT state,debited_hundredths::text AS debit FROM credit_consumption_requests WHERE org_id=$1",[team]))).rows).toEqual([{state:"pending",debit:"100"}]);
 expect((await asApp(team,c=>c.query("SELECT total_source FROM token_usage_events WHERE org_id=$1",[team]))).rows).toEqual([{total_source:"unknown"}]);
});
it("keeps confirmed usage pending after an abrupt drop while a response is still active",async()=>{
 const {client,frames}=await connect("team");await expect.poll(()=>frames.some(x=>x.type==="session.ready")).toBe(true);const socket=providers.at(-1)!;
 socket.send(JSON.stringify({type:"response.created",response:{id:"still-active"}}));done(socket,"before-drop",10);
 await expect.poll(()=>balance(team,team)).toBe("-2.01");client.terminate();
 await expect.poll(async()=>(await asApp(team,c=>c.query("SELECT state,debited_hundredths::text AS debit FROM credit_consumption_requests WHERE org_id=$1 ORDER BY created_at DESC LIMIT 1",[team]))).rows[0]).toEqual({state:"pending",debit:"1"});
});
it("rejects conflicting provider response replay without another debit",async()=>{
 const {frames}=await connect("team");await expect.poll(()=>frames.some(x=>x.type==="session.ready")).toBe(true);const socket=providers.at(-1)!;
 done(socket,"conflict",1);await expect.poll(()=>balance(team,team)).toBe("-2.02");done(socket,"conflict",2);
 await expect.poll(()=>frames.some(x=>x.reason==="CREDIT_ACCOUNTING_UNAVAILABLE")).toBe(true);
 expect(await balance(team,team)).toBe("-2.02");
});
it("settles a confirmed nondispatch and releases its durable slot when the client disconnects during admission",async()=>{
 let release!:()=>void;holdStart=new Promise<void>(r=>{release=r;});entered=false;const before=providers.length;
 try{
  const {client}=await connect("team");await expect.poll(()=>entered).toBe(true);
  const slot=createHash("sha256").update(heldRequest).digest("hex")+".reserved";
  expect(await readdir(directory)).toContain(slot);
  client.terminate();await expect.poll(()=>gateway.clients.size).toBe(0);release();
  await expect.poll(async()=>(await asApp(team,c=>c.query("SELECT state,debited_hundredths::text AS debit FROM credit_consumption_requests WHERE request_id=$1",[heldRequest]))).rows[0]).toEqual({state:"settled",debit:"0"});
  // Production intentionally retains ACK until an independently committed replay.
  await meter.replayPending();
  await expect.poll(async()=>(await readdir(directory)).includes(slot)).toBe(false);
  expect(providers).toHaveLength(before);
 }finally{release();holdStart=null;}
});
