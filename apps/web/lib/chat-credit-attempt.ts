import {creditGuidance,type CreditGuidance} from './credit-guidance';
export const CHAT_CREDIT_ATTEMPT_EVENT='workspacex:chat-credit-attempt';
export type CreditNoticeContext={scope:string;attempt:string;runId?:string};
export type CreditAttemptEvent=CreditNoticeContext&{type:'activate'|'begin'|'settled'|'deactivate'};
export type CreditNoticeState={active:CreditNoticeContext|null;settled:boolean;notice:CreditGuidance|null;context:CreditNoticeContext|null};
export const emptyCreditNotice:CreditNoticeState={active:null,settled:false,notice:null,context:null};
export function readCreditNoticeContext(raw:unknown):CreditNoticeContext|null{
 if(!raw||typeof raw!=='object')return null;
 const c=(raw as {noticeContext?:Partial<CreditNoticeContext>}).noticeContext;
 return c&&typeof c.scope==='string'&&typeof c.attempt==='string'?{scope:c.scope,attempt:c.attempt,...(typeof c.runId==='string'?{runId:c.runId}:{})}:null;
}
export function reduceCreditNotice(s:CreditNoticeState,event:{type:'failure';raw:unknown}|{type:'lifecycle';detail:CreditAttemptEvent}|{type:'dismiss'}):CreditNoticeState{
 if(event.type==='dismiss')return {...s,notice:null,context:null};
 if(event.type==='failure'){
  const notice=creditGuidance(event.raw),context=readCreditNoticeContext(event.raw);
  if(!notice)return s;
  if(context&&(!s.active||s.active.scope!==context.scope||s.active.attempt!==context.attempt||s.settled))return s;
  return {...s,notice,context};
 }
 const e=event.detail;
 if(e.type==='activate'&&s.active?.scope===e.scope&&s.active.attempt===e.attempt)return s;
 if(e.type==='activate'||e.type==='begin')return {active:e,settled:false,notice:s.context?null:s.notice,context:null};
 if(!s.active||s.active.scope!==e.scope||s.active.attempt!==e.attempt)return s;
 if(e.type==='deactivate')return {...s,active:null,notice:s.context?null:s.notice,context:null};
 if(s.context?.runId&&e.runId!==s.context.runId)return s;
 return {...s,settled:true,notice:s.context?null:s.notice,context:null};
}
export function publishCreditAttempt(detail:CreditAttemptEvent){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(CHAT_CREDIT_ATTEMPT_EVENT,{detail}));}
