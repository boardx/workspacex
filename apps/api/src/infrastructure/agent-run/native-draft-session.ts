import {request} from 'node:http';
import {schemas} from '@repo/contracts/sandbox-session';
import type {DraftSessionFiles} from '../../application/agent-run/skill-draft';
import {createNativeSessionFiles} from './native-session-files';
export function createNativeDraftSession(config:{socketPath:string;sessionId:string;token:string}):DraftSessionFiles{
 const files=createNativeSessionFiles(config);
 return {read:files.read,async write(raw){const body=schemas.write.parse(raw);return new Promise((resolve,reject)=>{
  const fail=()=>reject(new Error('skill_draft_write_unconfirmed'));
  const req=request({socketPath:config.socketPath,method:'POST',path:`/sessions/${config.sessionId}/files`,headers:{'content-type':'application/json',authorization:`Bearer ${config.token}`}},res=>{
   if(res.statusCode!==200){res.destroy();fail();return;}let data='';res.setEncoding('utf8');res.on('data',part=>{data+=part;if(data.length>4096){res.destroy();fail();}});res.on('error',fail);res.on('aborted',fail);res.on('end',()=>{try{const value=JSON.parse(data);if(value.path!==body.path||value.sizeBytes!==Buffer.from(body.contentBase64,'base64').length)throw new Error();resolve(value);}catch{fail();}});
  });const timer=setTimeout(()=>{req.destroy();fail();},10000);req.on('close',()=>clearTimeout(timer));req.on('error',fail);req.end(JSON.stringify(body));
 });}};
}
