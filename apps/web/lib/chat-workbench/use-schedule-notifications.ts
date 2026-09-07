"use client";
import * as React from 'react';
import type {z} from 'zod';
import {ScheduleNotificationListOutput,ScheduleNotificationReadOutput,type ScheduleNotification} from '@repo/contracts/schedule-notifications';
import {apiRequest} from '@/lib/api-client';
type Notice=z.infer<typeof ScheduleNotification>;
type State={key:string;notices:Notice[];cursor?:string;failed:boolean;busy:boolean};
/** Server receipts are authoritative. A scope switch immediately hides old facts. */
export function useScheduleNotifications(scopeKey:string,sessionToken?:string){
 const [state,setState]=React.useState<State|null>(null);
 const current=React.useRef({scopeKey,sessionToken,generation:0});
 if(current.current.scopeKey!==scopeKey||current.current.sessionToken!==sessionToken)current.current={scopeKey,sessionToken,generation:current.current.generation+1};
 const controller=React.useRef<AbortController|null>(null);
 const acknowledging=React.useRef(false);
 const request=React.useCallback(async(cursor?:string)=>{
  if(!sessionToken||acknowledging.current)return;
  const generation=++current.current.generation;
  const active=()=>current.current.generation===generation;
  try{
   const result=ScheduleNotificationListOutput.parse(await apiRequest<unknown>(`/schedule-notifications${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{sessionToken,signal:AbortSignal.any([controller.current?.signal??new AbortController().signal,AbortSignal.timeout(10000)])}));
   if(active())setState({key:scopeKey,notices:result.notifications,cursor:result.cursor,failed:false,busy:false});
  }catch{if(active())setState(previous=>({key:scopeKey,notices:previous?.key===scopeKey?previous.notices:[],cursor:previous?.key===scopeKey?previous.cursor:undefined,failed:true,busy:false}));}
 },[scopeKey,sessionToken]);
 React.useEffect(()=>{
  const abort=new AbortController();controller.current=abort;acknowledging.current=false;
  void request();
  return()=>{abort.abort();current.current.generation++;};
 },[request]);
 const markRead=React.useCallback(async(factId:string)=>{
  if(!sessionToken||acknowledging.current)return;
  acknowledging.current=true;
  const generation=++current.current.generation;
  setState(previous=>previous?.key===scopeKey?{...previous,busy:true}:previous);
  try{
   ScheduleNotificationReadOutput.parse(await apiRequest<unknown>('/schedule-notifications/read',{method:'POST',body:{factId},sessionToken,signal:AbortSignal.any([controller.current?.signal??new AbortController().signal,AbortSignal.timeout(10000)])}));
   if(current.current.generation===generation)setState(previous=>previous?.key===scopeKey?{...previous,notices:previous.notices.filter(n=>n.factId!==factId),failed:false,busy:false}:previous);
  }catch{if(current.current.generation===generation)setState(previous=>previous?.key===scopeKey?{...previous,failed:true,busy:false}:previous);}
  finally{if(current.current.generation===generation)acknowledging.current=false;}
 },[scopeKey,sessionToken]);
 const visible=state?.key===scopeKey&&sessionToken?state:null;
 return {notices:visible?.notices??[],failed:visible?.failed??false,busy:visible?.busy??false,cursor:visible?.cursor,refresh:request,markRead};
}
