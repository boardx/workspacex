import {afterAll,beforeAll,expect,it} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {InputOnlyRuntimeModelRequestAdmission,RuntimeModelRequestAdmission} from '@repo/contracts/runtime-model-usage';
import {registerRuntimeAdmissionBodyParser,RUNTIME_ADMISSION_BODY_MAX_BYTES} from '../../src/interface/middleware/runtime-admission-body-parser';
let server:Server,base:string;
const path='/internal/agent-runs/probe/model-requests/admit';
const input=(serializedBody:string)=>({orgId:'org-probe',attemptId:'attempt-probe',leaseEpoch:1,requestId:'11111111-1111-4111-8111-111111111111',startedAt:'2026-11-05T00:00:00Z',modelId:'model-probe',callPurpose:'primary',logicalCallId:'probe',serializedBody,outputTokenLimit:100});
beforeAll(async()=>{
 const app=express();registerRuntimeAdmissionBodyParser(app);app.use(express.json());
 app.post(path,(req,res)=>res.status(RuntimeModelRequestAdmission.safeParse(req.body).success?200:400).json({accepted:true}));
 app.all('*',(_req,res)=>res.json({accepted:true}));
 app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(typeof err==='object'&&err!==null&&'status' in err?Number(err.status):500).json({accepted:false}));
 server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
const send=(route:string,body:unknown)=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
it('accepts a real skill/history request above the default 100 KiB',async()=>expect((await send(path,input(JSON.stringify({messages:[{content:'技能正文'.repeat(30000)}]})))).status).toBe(200));
it('accepts worst-case escaped content at the schema character boundary',async()=>{
 const max=InputOnlyRuntimeModelRequestAdmission.shape.serializedBody.maxLength!;
 expect((await send(path,input('\u0000'.repeat(max)))).status).toBe(200);
});
it('keeps schema rejection above the character bound',async()=>expect((await send(path,input('x'.repeat(InputOnlyRuntimeModelRequestAdmission.shape.serializedBody.maxLength!+1)))).status).toBe(400));
it('retains a bounded transport envelope',async()=>expect((await send(path,{padding:'x'.repeat(RUNTIME_ADMISSION_BODY_MAX_BYTES)})).status).toBe(413));
it.each(['/unrelated','/internal/agent-runs/probe/model-requests/start','/internal/agent-runs/probe/model-requests/terminal'])('keeps default limits on %s',async route=>expect((await send(route,input('x'.repeat(110000)))).status).toBe(413));
