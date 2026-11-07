"use client";
import * as React from "react";
import { apiRequest } from "@/lib/api-client";
export type PricingReadState<T> = {status:"loading"} | {status:"error"} | {status:"ready";data:T;refreshError?:boolean};
export function usePersonalPricingRead<T>(path:string,parse:(value:unknown,userId:string)=>T,userId:string,sessionToken:string,query?:Record<string,string>) {
 const scope=`${userId}\0${sessionToken}`, [revision,retry]=React.useReducer(n=>n+1,0);
 const [snapshot,setSnapshot]=React.useState<{scope:string;state:PricingReadState<T>}>({scope,state:{status:"loading"}});
 React.useEffect(()=>{
  const controller=new AbortController();
  setSnapshot(previous=>({scope,state:previous.scope===scope&&previous.state.status==="ready"?{...previous.state,refreshError:undefined}:{status:"loading"}}));
  void apiRequest<unknown>(path,{query,sessionToken,signal:controller.signal}).then(raw=>{
   const data=parse(raw,userId);if(!controller.signal.aborted)setSnapshot({scope,state:{status:"ready",data}});
  }).catch(()=>{if(!controller.signal.aborted)setSnapshot(previous=>({scope,state:previous.scope===scope&&previous.state.status==="ready"?{...previous.state,refreshError:true}:{status:"error"}}));});
  return()=>controller.abort();
 },[path,parse,userId,sessionToken,scope,query,revision]);
 // Never flash the previous payer's data while the new effect is starting.
 return {state:snapshot.scope===scope?snapshot.state:{status:"loading"} as PricingReadState<T>,retry};
}
