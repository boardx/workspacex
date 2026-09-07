import {request} from 'node:http';
import {schemas,limits} from '@repo/contracts/sandbox-session';
import type {DocumentSession} from '../../application/agent-run/standard-document-tools';
import {createNativeSessionFiles} from './native-session-files';
export function createNativeDocumentSession(config:{socketPath:string;sessionId:string;token:string}):DocumentSession {
 const files=createNativeSessionFiles({...config,timeoutMs:10000});
 return {read:files.read,execute(raw){
  const input=schemas.execute.parse(raw);
  return new Promise((resolve,reject)=>{
   const fail=()=>reject(new Error('document_execution_unconfirmed_no_replay'));
   const req=request({socketPath:config.socketPath,method:'POST',path:`/sessions/${config.sessionId}/executions`,headers:{'content-type':'application/json',authorization:`Bearer ${config.token}`}},res=>{
    if(res.statusCode!==200){res.destroy();fail();return;}
    const chunks:Buffer[]=[];let size=0;
    res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limits.maxOutputBytes*6+4096){res.destroy();req.destroy();fail();return;}chunks.push(chunk);});
    res.on('error',fail);res.on('aborted',fail);res.on('end',()=>{try{resolve(schemas.result.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))));}catch{fail();}});
   });
   // The sandbox kills/reaps at timeoutMs; this transport deadline allows that terminal response.
   const timer=setTimeout(()=>{req.destroy();fail();},(input.timeoutMs??limits.defaultTimeoutMs)+5000);
   req.on('close',()=>clearTimeout(timer));req.on('error',fail);req.end(JSON.stringify(input));
  });
 }};
}
