import { request } from 'node:http';
import { schemas,limits } from '@repo/contracts/sandbox-session';
import type { NativeSessionTransport } from '../../application/agent-run/native-session-owner';
export function createNativeSessionTransport(socketPath:string):NativeSessionTransport {
 if(!socketPath.startsWith('/')||socketPath.includes('\0'))throw new Error('native_session_socket_invalid');
 const call=(method:string,path:string,body?:unknown,token?:string):Promise<unknown>=>new Promise((resolve,reject)=>{
  const fail=()=>reject(new Error('native_session_transport_failed'));
  const data=body===undefined?undefined:JSON.stringify(body);
  if(data&&Buffer.byteLength(data)>limits.maxRequestBytes){fail();return;}
  const req=request({socketPath,method,path,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}},res=>{
   if(res.statusCode!==200&&res.statusCode!==201){res.destroy();fail();return;}
   const chunks:Buffer[]=[];let size=0;
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>64*1024){res.destroy();fail();return;}chunks.push(chunk);});
   res.on('error',fail);res.on('aborted',fail);res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{fail();}});
  });
  const timer=setTimeout(()=>{req.destroy();fail();},limits.defaultTimeoutMs);req.on('close',()=>clearTimeout(timer));req.on('error',fail);req.end(data);
 });
 return {create:async (files,inputs=[])=>schemas.created.parse(await call('POST','/sessions',schemas.create.parse({skills:files,inputs}))),
  destroy:async(sessionId,token)=>{schemas.created.parse({sessionId,token,expiresAt:0});schemas.deleted.parse(await call('DELETE',`/sessions/${sessionId}`,undefined,token));}};
}
