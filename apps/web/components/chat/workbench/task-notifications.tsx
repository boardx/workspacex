"use client";
import * as React from "react";
import {Bell} from "lucide-react";
import {Button} from "@/components/ui/button";
import {useNotificationCenter} from "@/lib/notifications/use-notification-center";
import {useScheduleNotifications} from "@/lib/chat-workbench/use-schedule-notifications";
import type {NotificationKind} from "@repo/contracts/notifications";
export interface TaskNotificationsProps {
  sessionToken?:string;
  /** 通知带 threadId 时点开跳去那个对话。 */
  onOpenThread:(threadId:string)=>void;
  /** 顺带保鲜对话列表（状态点/排序），与通知同一节奏轮询；失败静默，下一轮再试。 */
  onRefresh?:()=>void|Promise<void>;
}
const kindLabel:Record<NotificationKind,string>={task:"任务",email:"邮件",system:"系统"};
/**
 * 全局通知中心入口（2026-09-08 人类直接指令：「任务提醒的功能不工作，把它做成一个 notification
 * 简单服务，放在全局，有消息就可以往里面推，邮件的消息也往里面推送」）。
 *
 * 此前"任务提醒"靠浏览器本地对比对话列表快照来猜"有没有完成的任务"——刷新、换设备、
 * 第一次加载都看不到，人类反馈"不工作"。现在唯一事实源是服务端 `/notifications`
 * （任何模块 publish），这里只读 + 标已读；定时任务失败的收据仍走它自己的表，
 * 在同一个面板里一起列出来，不复制成第二份。
 */
export function TaskNotifications({sessionToken,onOpenThread,onRefresh}:TaskNotificationsProps){
  const center=useNotificationCenter(sessionToken);
  const scheduled=useScheduleNotifications("global",sessionToken);
  const refresh=React.useRef(onRefresh);refresh.current=onRefresh;
  React.useEffect(()=>{
    let busy=false;
    const poll=async()=>{if(busy||!refresh.current)return;busy=true;try{await refresh.current();}catch{/* 下一轮再试 */}finally{busy=false;}};
    const timer=setInterval(()=>void poll(),10000);
    const focus=()=>void poll();window.addEventListener("focus",focus);
    return()=>{clearInterval(timer);window.removeEventListener("focus",focus);};
  },[]);
  const unread=center.items.filter(item=>item.readAt===null);
  const read=center.items.filter(item=>item.readAt!==null).slice(0,10);
  const total=center.unreadCount+scheduled.notices.length;
  return <details className="rounded-control border border-border" data-testid="task-notifications">
    <summary className="flex cursor-pointer items-center gap-2 p-2 text-13"><Bell className="h-4 w-4"/>任务提醒 <span aria-live="polite" aria-atomic="true">{total} 条未读</span></summary>
    <div className="space-y-2 border-t border-border p-2">
      {center.failed&&<p role="status" className="text-11 text-muted-foreground">暂时无法刷新通知，稍后自动重试。</p>}
      {scheduled.failed&&<p role="status" className="text-11 text-muted-foreground">定时任务提醒暂时无法同步，请稍后重试。</p>}
      {scheduled.notices.map(notice=><div key={notice.factId} className="flex items-center gap-2" data-testid="schedule-notification">
        <span className="text-13">{notice.code==="authorization_revoked"?"定时任务已停止：访问权限已撤销":"定时任务未能执行"}</span>
        <Button variant="ghost" size="sm" disabled={scheduled.busy} onClick={()=>void scheduled.markRead(notice.factId)}>标为已读</Button>
      </div>)}
      {scheduled.cursor&&<Button variant="ghost" size="sm" onClick={()=>void scheduled.refresh(scheduled.cursor)}>下一页定时任务提醒</Button>}
      {!unread.length&&!scheduled.notices.length&&<p className="text-11 text-muted-foreground">暂无未读提醒</p>}
      {/* `h-auto` 是为了让长标题折行（不是为了压扁按钮）。24px 最小命中区由 Button base 的
          `min-h-6` 兜底——`h-auto` 只解开上界；这里不重复声明同一个事实（TW-A11Y-2）。 */}
      {unread.map(item=><Button key={item.id} variant="ghost" size="sm" data-testid="notification-item" data-kind={item.kind} className="h-auto w-full justify-start whitespace-normal py-1 text-left" onClick={()=>{void center.markRead([item.id]);if(item.threadId)onOpenThread(item.threadId);}}>
        <span className="mr-1 text-11 text-muted-foreground">[{kindLabel[item.kind]}]</span>{item.title}
      </Button>)}
      {unread.length>0&&<Button variant="ghost" size="sm" disabled={center.busy} onClick={()=>void center.markRead()}>全部标为已读</Button>}
      {read.length>0&&<details className="text-11 text-muted-foreground"><summary className="cursor-pointer">最近已读</summary>
        {read.map(item=><p key={item.id} className="truncate py-0.5">[{kindLabel[item.kind]}] {item.title}</p>)}
      </details>}
    </div>
  </details>;
}
