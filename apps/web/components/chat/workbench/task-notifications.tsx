"use client";
import * as React from "react";
import {Bell} from "lucide-react";
import {Button} from "@/components/ui/button";
import {useTaskNotifications} from "@/lib/chat-workbench/use-task-notifications";
import {useScheduleNotifications} from "@/lib/chat-workbench/use-schedule-notifications";
import type {NotificationThread} from "@/lib/chat-workbench/task-notifications";
export interface TaskNotificationsProps {
  /** Stable org + user + project identity, never a bearer token. */
  scopeKey:string; sessionToken?:string; cards:readonly NotificationThread[]|null; activeThreadId:string|null;
  onOpenThread:(threadId:string)=>void; onRefresh:()=>void|Promise<void>;
}
const labels:Record<string,string>={done:"已完成",failed:"执行失败","awaiting-approval":"等待确认",paused:"已暂停"};
export function TaskNotifications({scopeKey,sessionToken,cards,activeThreadId,onOpenThread,onRefresh}:TaskNotificationsProps){
  const {notices,markRead}=useTaskNotifications(scopeKey,cards,activeThreadId);
  const scheduled=useScheduleNotifications(scopeKey,sessionToken);
  const scheduledRefresh=React.useRef(scheduled.refresh);scheduledRefresh.current=scheduled.refresh;
  const refresh=React.useRef(onRefresh);refresh.current=onRefresh;
  const [refreshFailed,setRefreshFailed]=React.useState(false);
  React.useEffect(()=>{
    let live=true,busy=false;
    const poll=async()=>{if(busy)return;busy=true;try{await Promise.all([refresh.current(),scheduledRefresh.current()]);if(live)setRefreshFailed(false);}catch{if(live)setRefreshFailed(true);}finally{busy=false;}};
    const timer=setInterval(()=>void poll(),10000);
    const focus=()=>void poll();window.addEventListener("focus",focus);
    return()=>{live=false;clearInterval(timer);window.removeEventListener("focus",focus);};
  },[scopeKey]);
  return <details className="rounded-control border border-border" data-testid="task-notifications">
    <summary className="flex cursor-pointer items-center gap-2 p-2 text-13"><Bell className="h-4 w-4"/>任务提醒 <span aria-live="polite" aria-atomic="true">{notices.length+scheduled.notices.length} 条未读</span></summary>
    <div className="space-y-2 border-t border-border p-2">
      {refreshFailed&&<p role="status" className="text-11 text-muted-foreground">暂时无法刷新任务状态，稍后自动重试。</p>}
      {scheduled.failed&&<p role="status" className="text-11 text-muted-foreground">定时任务提醒暂时无法同步，请稍后重试。</p>}
      {scheduled.notices.map(notice=><div key={notice.factId} className="flex items-center gap-2" data-testid="schedule-notification">
        <span className="text-13">{notice.code==="authorization_revoked"?"定时任务已停止：访问权限已撤销":"定时任务未能执行"}</span>
        <Button variant="ghost" size="sm" disabled={scheduled.busy} onClick={()=>void scheduled.markRead(notice.factId)}>标为已读</Button>
      </div>)}
      {scheduled.cursor&&<Button variant="ghost" size="sm" onClick={()=>void scheduled.refresh(scheduled.cursor)}>下一页定时任务提醒</Button>}
      {!notices.length&&!scheduled.notices.length?<p className="text-11 text-muted-foreground">暂无未读提醒</p>:<>
        {notices.map(notice=><Button key={notice.threadId} variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal text-left" onClick={()=>{markRead(notice.threadId);onOpenThread(notice.threadId);}}>
          {cards?.find(card=>card.id===notice.threadId)?.title} · {labels[notice.status]}
        </Button>)}
        {notices.length>0&&<Button variant="ghost" size="sm" onClick={()=>markRead()}>任务状态提醒标为已读</Button>}
      </>}
    </div>
  </details>;
}
