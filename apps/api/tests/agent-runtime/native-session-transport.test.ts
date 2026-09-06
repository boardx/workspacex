import { createServer } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { it,expect } from 'vitest';
import { createNativeSessionTransport } from '../../src/infrastructure/agent-run/native-session-transport';
import { NativeSessionController } from '../../src/interface/controllers/native-session.controller';
it('real UDS create/delete carries server-bound token and requires deletion confirmation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-transport-')),socket=join(dir,'s'),sessionId=randomUUID(),token='a'.repeat(64);let count=0;
 const server=createServer((req,res)=>{count++;if(req.method==='POST'){expect(req.url).toBe('/sessions');res.end(JSON.stringify({sessionId,token,expiresAt:Date.now()+60000}));}else{expect(req.url).toBe('/sessions/'+sessionId);expect(req.headers.authorization).toBe('Bearer '+token);res.end(JSON.stringify({deleted:true}));}});
 await new Promise<void>(r=>server.listen(socket,r));try{const t=createNativeSessionTransport(socket);expect((await t.create([])).sessionId).toBe(sessionId);await t.destroy(sessionId,token);expect(count).toBe(2);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
it('controller refuses missing auth and secret fields, forwards only validated identity',async()=>{
 const old=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='internal';let calls=0;
 const controller=new NativeSessionController({resolve:async(_id,ctx)=>{calls++;expect(ctx).toEqual({orgId:'org',parentRunId:'run',attemptId:'a',leaseEpoch:1});throw new Error('secret');},provision:async()=>{throw new Error();},releaseForRun:async()=>{},release:async()=>{}});
 const id=randomUUID(),body={orgId:'org',runId:'run',attemptId:'a',leaseEpoch:1};
 try{await expect(controller.resolve(undefined,id,body)).rejects.toThrow();expect(calls).toBe(0);await expect(controller.resolve('internal',id,{...body,token:'forged'})).rejects.toThrow();expect(calls).toBe(0);await expect(controller.resolve('internal',id,body)).rejects.toThrow('native_session_unavailable');expect(calls).toBe(1);}finally{if(old===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=old;}
});
it('actual SessionManager authenticates duplicate DELETE after a dropped response',async()=>{
 const { SessionManager }=await import('../../../skill-sandbox/src/session/manager');
 const { handleSessionRequest }=await import('../../../skill-sandbox/src/session/http');
 const dir=await mkdtemp(join(tmpdir(),'native-delete-')),socket=join(dir,'s');
 const manager=new SessionManager({probe:async()=>true} as never,dir);
 const created=await manager.create([]);let dropped=false;
 const server=createServer(async(req,res)=>{
  if(!dropped&&req.method==='DELETE'){dropped=true;await manager.destroy(created.sessionId,created.token);req.socket.destroy();return;}
  await handleSessionRequest(req,res,manager);
 });
 await new Promise<void>(r=>server.listen(socket,r));
 try{const t=createNativeSessionTransport(socket);
  await expect(t.destroy(created.sessionId,created.token)).rejects.toThrow();
  await Promise.all([t.destroy(created.sessionId,created.token),t.destroy(created.sessionId,created.token)]);
  await expect(t.destroy(created.sessionId,'b'.repeat(64))).rejects.toThrow();
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
