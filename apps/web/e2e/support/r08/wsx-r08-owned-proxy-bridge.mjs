import {createFaultProxy,loadPrivateProxyConfig} from './wsx-r08-fault-proxy.mjs';
import {sha256,validateScope} from './wsx-r08-proxy-policy.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

export async function prepareOwnedProxy({templatePath,...binding}){
 const template=await loadPrivateProxyConfig(templatePath);
 const directory=await mkdtemp(join(tmpdir(),'wsx-r08-owned-run-'));
 let started;
 try{
  const configPath=join(directory,'config.json');
  await writeFile(configPath,JSON.stringify({...template,scope:{boardId:binding.boardId,sessionHashes:binding.tokens.map(sha256)}}),{mode:0o600,flag:'wx'});
  started=await startOwnedProxy({...binding,configPath});
  return {...started,dispose:async()=>{
   const errors=[];try{await started.proxy.dispose();}catch(error){errors.push(error);}
   try{await rm(directory,{recursive:true});}catch(error){errors.push(error);}
   if(errors.length)throw new AggregateError(errors,'OWNED_PROXY_DISPOSE_FAILED');
  }};
 }catch(error){const errors=[error];if(started)try{await started.proxy.dispose();}catch(cleanupError){errors.push(cleanupError);}try{await rm(directory,{recursive:true});}catch(cleanupError){errors.push(cleanupError);}throw new AggregateError(errors,'OWNED_PROXY_PREPARE_FAILED');}
}

// API authority is established before any transport listener is created.
export async function startOwnedProxy({configPath,boardId,userId,title,tokens,participantUserIds}){
 const config=await loadPrivateProxyConfig(configPath);
 validateScope(config.scope);
 if(typeof title!=='string'||!title.startsWith('R08 closed origin ')||typeof userId!=='string'||!userId||!Array.isArray(tokens)||tokens.length!==2||tokens.some(token=>typeof token!=='string'||!token))throw new Error('INVALID_OWNED_PROXY_BINDING');
 if(config.scope.boardId!==boardId||JSON.stringify([...config.scope.sessionHashes].sort())!==JSON.stringify(tokens.map(sha256).sort()))throw new Error('PROXY_SCOPE_BINDING_MISMATCH');
 if(participantUserIds!==undefined&&(!Array.isArray(participantUserIds)||participantUserIds.length!==2||participantUserIds[0]!==userId||participantUserIds.some(id=>typeof id!=='string'||!id)||new Set(participantUserIds).size!==2))throw new Error('INVALID_PROXY_PARTICIPANTS');
 const read=async(path,token)=>{
  const response=await fetch(`${config.upstream}${path}`,{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(response.status!==200)throw new Error('PROXY_AUTHORITY_HTTP_REJECTED');
  return response.json();
 };
 const members=participantUserIds?await read(`/whiteboards/${boardId}/members`,tokens[0]):null;
 for(const [index,token] of tokens.entries()){
  const identity=await read('/kernel/probe/whoami',token),board=await read(`/whiteboards/${boardId}`,token);
  const expectedUser=participantUserIds?.[index]??userId;
  if(identity.userId!==expectedUser||board.id!==boardId||board.ownerId!==userId||board.name!==title||board.archived!==false)throw new Error('PROXY_OWNERSHIP_NOT_PROVEN');
  if(participantUserIds&&(board.role!==(index===0?'owner':'editor')||(index===1&&(!Array.isArray(members?.items)||members.items.filter(member=>member.userId===expectedUser&&member.role==='editor').length!==1))))throw new Error('PROXY_EDITOR_MEMBERSHIP_NOT_PROVEN');
 }
 const proxy=createFaultProxy(config);
 try{const proof=await proxy.start();return {proxy,proof};}
 catch(error){try{await proxy.dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'OWNED_PROXY_START_AND_CLEANUP_FAILED');}throw error;}
}
