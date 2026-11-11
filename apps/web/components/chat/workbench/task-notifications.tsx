"use client";
import * as React from "react";
import Link from "next/link";
import {useI18n} from "@/lib/i18n/provider";
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from "@/components/ui/tooltip";
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {orgAdmin} from "@repo/contracts";
import {Bell} from "lucide-react";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";
import {useIntervalFocusRefresh} from "@/lib/chat-workbench/use-interval-focus-refresh";
import {useNotificationCenter} from "@/lib/notifications/use-notification-center";
import {useScheduleNotifications} from "@/lib/chat-workbench/use-schedule-notifications";
import type {Notification} from "@repo/contracts/notifications";
export interface TaskNotificationsProps {
  sessionToken?:string;
  /** 通知带 threadId 时点开跳去那个对话。 */
  onOpenThread:(threadId:string)=>void;
  onOpenMessage?:(messageId:string)=>void;
  /** 顺带保鲜对话列表（状态点/排序），与通知同一节奏轮询；失败静默，下一轮再试。 */
  onRefresh?:()=>void|Promise<void>;
  /**
   * `sidebar` = 会话列表栏顶部的老位置（`px-3`、弹层贴栏宽向下展开）。
   * `rail` = 最左侧图标导航栏（issue #3246），与 `FeedbackButton` 的 rail 形态同构：
   * 图标 + 悬停提示 + 右上角角标，弹层**向右**展开。
   */
  variant?:"sidebar"|"rail";
}
/**
 * 弹层与触发器的**几何**（宽度 / 展开方向 / 高度上限 / 图标+标签排布）只在这里声明一次。
 *
 * 真浏览器几何门控 `e2e/chat-rail-notifications-geometry.spec.ts` 的夹具引用的就是这两个
 * 常量——夹具量的是**真组件的盒模型**，不是另抄一份 class 串（同一事实不得声明在两处；
 * 抄一份的话夹具会永远量到"旧的正确答案"，改坏了也不红）。
 */
export const NOTIFICATIONS_TRIGGER_CLASS={
  rail:"mt-1 flex h-9 w-14 items-center justify-center rounded-md text-muted-foreground",
  sidebar:"h-8 w-8 p-0",
} as const;
export const NOTIFICATIONS_POPOVER_BASE_CLASS="absolute z-50 space-y-2 overflow-y-auto rounded-control border border-border bg-popover p-2 shadow-md";
export const NOTIFICATIONS_POPOVER_CLASS={
  // rail 贴屏幕最左且很窄：向右展开（`left-full`）。垂直方向锚**底边**（trigger 钉在栏底），
  // 面板向上生长 + `max-h` 上限 ⇒ 结构上不可能被视口底边裁掉，比"向下再夹逼回来"少一层
  // 运行时计算。判据见 `e2e/chat-rail-notifications-geometry.spec.ts`。
  rail:"bottom-0 left-full ml-2 max-h-[min(70vh,20rem)] w-72",
  sidebar:"left-3 right-3 mt-1 max-h-80",
} as const;
/**
 * 同一件事的重复收据合并成一条（#3224）。
 *
 * 服务端 `user_notifications_source_key`（`(user_id,source_key)` 唯一，见
 * `migrations/20260910040000_user_notifications.sql`）让「同一个 run 的同一个状态投了三次」
 * 在库里根本落不进第二行——所以逐字相同的三条完成提醒必然来自**三个不同的 run**，
 * 也就是同一个对话真的跑完了三次。提醒本身没错，错在没告诉用户这是第 N 次。
 *
 * 因此这里**只合并呈现、并把次数印出来**，不做静默去重（那会把「发生了三次」抹掉），
 * 未读角标也仍然如实用服务端的未读条数。
 */
export interface MergedNotice {readonly head:Notification; readonly ids:readonly string[]}
export function mergeNotifications(items:readonly Notification[]):MergedNotice[]{
  const order:(MergedNotice&{ids:string[]})[]=[];const index=new Map<string,MergedNotice&{ids:string[]}>();
  for(const item of items){
    const key=JSON.stringify([item.kind,item.threadId,item.title,item.inboxInviteId ?? (item.threadId ? null : item.body)]);
    const seen=index.get(key);
    if(seen){seen.ids.push(item.id);continue;}
    const fresh={head:item,ids:[item.id]};index.set(key,fresh);order.push(fresh);
  }
  return order;
}
/**
 * 全局通知中心入口（2026-09-08 人类直接指令：「任务提醒的功能不工作，把它做成一个 notification
 * 简单服务，放在全局，有消息就可以往里面推，邮件的消息也往里面推送」）。唯一事实源是服务端
 * `/notifications`（任何模块 publish），这里只读 + 标已读。
 *
 * 形态是**一个图标 + 未读角标，点开弹层浏览**（#3223 人类原话：「应该是一个图标，显示多少个
 * incoming message，点开，可以 popup 一个列表，供用户浏览」）。此前它是常驻展开的面板，
 * 把通知正文平铺在侧边栏顶部，挤掉了对话列表近一半高度。未读计数、全部标为已读、最近已读
 * 三件功能都还在，只是收进弹层。
 */
export function TaskNotifications({sessionToken,onOpenThread,onOpenMessage,onRefresh,variant="sidebar"}:TaskNotificationsProps){
  const {t}=useI18n();
  const center=useNotificationCenter(sessionToken);
  const scheduled=useScheduleNotifications("global",sessionToken);
  const [open,setOpen]=React.useState(false);
  const [detail,setDetail]=React.useState<Pick<Notification,"title"|"body"|"inboxInviteId">|null>(null);
  React.useEffect(()=>setDetail(null),[sessionToken]);
  const triggerRef=React.useRef<HTMLButtonElement|null>(null);
  const popoverRef=React.useRef<HTMLDivElement|null>(null);
  useIntervalFocusRefresh(onRefresh);
  // 打开时焦点进弹层；关闭时还给触发器（TW-A11Y-5：弹窗关闭后焦点不许留在 BODY）。
  React.useEffect(()=>{if(open)popoverRef.current?.focus();},[open]);
  const close=React.useCallback(()=>{setOpen(false);triggerRef.current?.focus();},[]);
  React.useEffect(()=>{
    if(!open)return;
    const onPointerDown=(event:MouseEvent)=>{
      const target=event.target as Node|null;
      if(popoverRef.current?.contains(target??null)||triggerRef.current?.contains(target??null))return;
      setOpen(false);
    };
    document.addEventListener("mousedown",onPointerDown);
    return()=>document.removeEventListener("mousedown",onPointerDown);
  },[open]);
  const unread=React.useMemo(()=>mergeNotifications(center.items.filter(item=>item.readAt===null)),[center.items]);
  const read=React.useMemo(()=>mergeNotifications(center.items.filter(item=>item.readAt!==null)).slice(0,10),[center.items]);
  // 未读数只有一个来源：服务端 `unreadCount`（列表只是它的前 50 条投影，别再数一遍）
  // 加上定时任务收据自己的那张表。角标、无障碍名、空状态三处都读这一个 `total`。
  const total=center.unreadCount+scheduled.notices.length;
  const rail=variant==="rail";
  const trigger = (
    <Button ref={triggerRef} variant="ghost" size="sm"
      className={NOTIFICATIONS_TRIGGER_CLASS[variant]}
      data-testid="task-notifications-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open?"task-notifications-popover":undefined} aria-label={t("notifications.triggerUnread",{count:total})}
      onClick={()=>{if(open)close();else setOpen(true);}}>
      <span className="relative flex items-center justify-center">
        <Bell className="h-4 w-4"/>
        {total>0&&<span data-testid="task-notifications-badge" aria-hidden="true"
          className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-destructive px-1 text-10 leading-4 text-destructive-foreground">{total}</span>}
      </span>
      {/* 未读为 0 时图标仍在，只是不显角标——入口不许时有时无（#3246）。 */}
    </Button>
  );
  const openNotice = (head: Notification, ids: readonly string[]) => {
    if ((!onOpenMessage || head.threadId) && head.readAt === null && !head.actionable) void center.markRead([...ids]);
    close();
    if (head.threadId) onOpenThread(head.threadId);
    else if (onOpenMessage) onOpenMessage(head.id);
    else setDetail(head);
  };
  return <div className={rail?"relative flex w-full flex-col items-center":"relative px-3"}
    data-testid="task-notifications" data-variant={variant}>
    {rail?<TooltipProvider><Tooltip><TooltipTrigger asChild>{trigger}</TooltipTrigger><TooltipContent side="right">{t("notifications.triggerUnread",{count:total})}</TooltipContent></Tooltip></TooltipProvider>:trigger}
    {/* 角标是图形，读屏读的是上面的 aria-label；这一行只负责把变化播报出去。 */}
    <span className="sr-only" aria-live="polite" aria-atomic="true">{t("notifications.unread",{count:total})}</span>
    {open&&<div ref={popoverRef} id="task-notifications-popover" data-testid="task-notifications-popover"
      role="dialog" aria-label={t("notifications.title")} tabIndex={-1}
      onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();close();}}}
      className={cn(NOTIFICATIONS_POPOVER_BASE_CLASS,NOTIFICATIONS_POPOVER_CLASS[variant])}>
      {rail&&<Link href="/inbox" className="block rounded-control px-2 py-1 text-13 font-medium transition-colors hover:bg-muted" onClick={close}>{t("notifications.openInbox")}</Link>}
      {center.failed&&<p role="status" className="text-11 text-muted-foreground">{t("notifications.refreshFailed")}</p>}
      {scheduled.failed&&<p role="status" className="text-11 text-muted-foreground">{t("notifications.scheduleSyncFailed")}</p>}
      {scheduled.notices.map(notice=><div key={notice.factId} className="flex items-center gap-2" data-testid="schedule-notification">
        <Button variant="ghost" size="sm" className="h-auto min-w-0 whitespace-normal text-left" onClick={()=>{
          const title=t(notice.code==="authorization_revoked"?"notifications.scheduleRevoked":"notifications.scheduleFailed");
          close();
          setDetail({title,body:""});
        }}>{t(notice.code==="authorization_revoked"?"notifications.scheduleRevoked":"notifications.scheduleFailed")}</Button>
        <Button variant="ghost" size="sm" disabled={scheduled.busy} onClick={()=>void scheduled.markRead(notice.factId)}>{t("notifications.markRead")}</Button>
      </div>)}
      {scheduled.cursor&&<Button variant="ghost" size="sm" onClick={()=>void scheduled.refresh(scheduled.cursor)}>{t("notifications.nextScheduled")}</Button>}
      {total===0&&<p className="text-11 text-muted-foreground">{t("notifications.empty")}</p>}
      {/* `h-auto` 是为了让长标题折行（不是为了压扁按钮）。24px 最小命中区由 Button base 的
          `min-h-6` 兜底——`h-auto` 只解开上界；这里不重复声明同一个事实（TW-A11Y-2）。 */}
      {unread.map(({head,ids})=>{
        const label=<><span className="mr-1 text-11 text-muted-foreground">[{t(`notifications.kind.${head.kind}`)}]</span>{head.title}
          {ids.length>1&&<span className="ml-1 text-11 text-muted-foreground">×{ids.length}</span>}</>;
        if(!head.threadId)return <div key={head.id} data-testid="notification-item" data-kind={head.kind}
          data-occurrences={ids.length} data-actionable={head.actionable?"true":"false"} data-destination={onOpenMessage?"inbox":"detail"}
          className="flex w-full items-center justify-between gap-2 py-1 text-left text-13">
          <Button variant="ghost" size="sm" className="h-auto min-w-0 justify-start whitespace-normal text-left"
            onClick={()=>openNotice(head,ids)}>{label}</Button>
          <Button variant="ghost" size="sm" className="shrink-0" disabled={center.busy}
            onClick={()=>void center.markRead([...ids])}>{t("notifications.markRead")}</Button>
        </div>;
        return <Button key={head.id} variant="ghost" size="sm" data-testid="notification-item"
          data-kind={head.kind} data-occurrences={ids.length}
          data-actionable={head.actionable?"true":"false"} data-destination="thread"
          className="h-auto w-full justify-start whitespace-normal py-1 text-left"
          onClick={()=>openNotice(head,ids)}>{label}</Button>;
      })}
      {unread.length>0&&<Button variant="ghost" size="sm" disabled={center.busy} onClick={()=>void center.markRead()}>{t("notifications.markAllRead")}</Button>}
      {read.length>0&&<details className="text-11 text-muted-foreground"><summary className="cursor-pointer">{t("notifications.recentRead")}</summary>
        {read.map(({head,ids})=><Button key={head.id} variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal text-left" onClick={()=>openNotice(head,ids)}>[{t(`notifications.kind.${head.kind}`)}] {head.title}{ids.length>1?` ×${ids.length}`:""}</Button>)}
      </details>}
    </div>}
    <Dialog open={detail!==null} onOpenChange={next=>{if(!next)setDetail(null);}}>
      {detail&&<DialogContent onCloseAutoFocus={event=>{event.preventDefault();triggerRef.current?.focus();}}>
        <DialogHeader>
          <DialogTitle className="break-words">{detail.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap break-words">{detail.body || t("notifications.title")}</DialogDescription>
        </DialogHeader>
        {detail.inboxInviteId&&<Button asChild variant="primary">
          <a href={`${orgAdmin.INVITATION_ACTIVATION_PATH}?${orgAdmin.INBOX_INVITE_PARAM}=${encodeURIComponent(detail.inboxInviteId)}`}>{t("notifications.openInvitation")}</a>
        </Button>}
      </DialogContent>}
    </Dialog>
  </div>;
}
