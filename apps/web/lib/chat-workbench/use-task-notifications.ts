"use client";
import * as React from "react";
import {emptyTaskNotices,readTaskNotices,reconcileTaskNotices,type NotificationThread,type TaskNoticeState} from "./task-notifications";
export function useTaskNotifications(scopeKey:string,cards:readonly NotificationThread[]|null,activeThreadId:string|null){
  const key=`workspacex.task-notices.v1:${scopeKey}`;
  const [stored,setStored]=React.useState<{key:string;value:TaskNoticeState}|null>(null);
  React.useEffect(()=>{setStored({key,value:readTaskNotices(key)});},[key]);
  React.useEffect(()=>{
    if(cards===null)return;
    setStored(previous=>{
      if(previous?.key!==key)return previous;
      const value=reconcileTaskNotices(previous.value,cards,activeThreadId);
      if(JSON.stringify(value)===JSON.stringify(previous.value))return previous;
      return {key,value};
    });
  },[key,cards,activeThreadId,stored?.key]);
  React.useEffect(()=>{if(stored?.key===key){try{localStorage.setItem(key,JSON.stringify(stored.value));}catch{/* Navigation remains available when browser storage is full. */}}},[stored,key]);
  const state=stored?.key===key?stored.value:emptyTaskNotices();
  const notices=state.unread.filter(item=>cards?.some(card=>card.id===item.threadId)&&item.threadId!==activeThreadId);
  const markRead=React.useCallback((threadId?:string)=>setStored(previous=>previous?.key===key?{key,value:{...previous.value,unread:threadId?previous.value.unread.filter(item=>item.threadId!==threadId):[]}}:previous),[key]);
  return {notices,markRead};
}
