"use client";
import * as React from 'react';
import {notifyCreditFailure} from '@/lib/credit-guidance';
import {publishCreditAttempt,type CreditNoticeContext} from '@/lib/chat-credit-attempt';
type Attempt=CreditNoticeContext&{external:boolean;closed:boolean;afterGeneration?:number};
/** UI ownership only. Never admits, retries or changes a billed operation. */
export function useChatAttemptErrors(scope:string,reset:(reason:"begin"|"scope"|"settled")=>void){
 const resetRef=React.useRef(reset);resetRef.current=reset;
 const current=React.useRef<Attempt>({scope,attempt:crypto.randomUUID(),external:false,closed:false});
 const retired=React.useRef(new Set<string>());
 const [,render]=React.useReducer(n=>n+1,0);
 if(current.current.scope!==scope){current.current={scope,attempt:crypto.randomUUID(),external:false,closed:false};retired.current.clear();}
 const identity=current.current;
 const lastScope=React.useRef(scope);
 const mounted=React.useRef(false);
 React.useLayoutEffect(()=>{if(lastScope.current!==identity.scope){lastScope.current=identity.scope;resetRef.current("scope");}},[identity]);
 React.useEffect(()=>{
  mounted.current=true;publishCreditAttempt({...identity,type:'activate'});
  return()=>{mounted.current=false;queueMicrotask(()=>{if(!mounted.current)publishCreditAttempt({...identity,type:'deactivate'});});};
 },[identity]);
 const owns=React.useCallback((token:Attempt)=>token===current.current&&!token.closed,[]);
 const begin=React.useCallback((external=false,afterGeneration?:number)=>{
  const old=current.current;if(old.runId)retired.current.add(old.runId);
  if(retired.current.size>64)retired.current.delete(retired.current.values().next().value!);
  const next:Attempt={scope:old.scope,attempt:crypto.randomUUID(),external,closed:false,afterGeneration};current.current=next;
  resetRef.current("begin");publishCreditAttempt({...next,type:'begin'});render();return next;
 },[]);
 const bind=React.useCallback((token:Attempt,runId:string)=>{if(!owns(token))return false;token.runId=runId;retired.current.delete(runId);return true;},[owns]);
 const accepts=React.useCallback((token:Attempt,runId?:string|null)=>owns(token)&&(!runId||(!retired.current.has(runId)&&(!token.runId||token.runId===runId))),[owns]);
 const fail=React.useCallback((token:Attempt,raw:unknown,runId?:string|null)=>{
  if(!accepts(token,runId))return false;if(runId)token.runId=runId;
  publishCreditAttempt({...token,type:'activate'});
  if(raw&&typeof raw==='object')notifyCreditFailure({...raw,noticeContext:{scope:token.scope,attempt:token.attempt,runId:token.runId}});
  return true;
 },[accepts]);
 const settle=React.useCallback((token:Attempt,runId:string)=>{if(!accepts(token,runId)||token.runId!==runId)return false;resetRef.current("settled");token.closed=true;publishCreditAttempt({...token,type:'settled'});return true;},[accepts]);
 return React.useMemo(()=>({identity,current,begin,bind,owns,accepts,fail,settle}),[identity,begin,bind,owns,accepts,fail,settle]);
}
