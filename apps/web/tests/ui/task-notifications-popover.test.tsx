import * as React from "react";
import {render,screen,fireEvent,waitFor,within} from "@testing-library/react";
import {describe,it,expect,vi,beforeEach} from "vitest";
import {TaskNotifications} from "@/components/chat/workbench/task-notifications";
/**
 * #3223 反证网：未读数 > 0 时，侧边栏**不许**把通知正文平铺出来——只许一个图标 + 未读数角标，
 * 正文只在弹层里出现。判据是**结构事实**（弹层开合、条目数、DOM 归属），
 * 不是截图字节数、不是"元素存在"。
 *
 * #3224 反证网：同一对话的同一条完成提醒来了三次（三个不同 run ⇒ 三个不同 id，
 * 服务端 `user_notifications_source_key` 唯一索引让"同一 run 投三次"在库里不可能），
 * 列表要**合并成一条并注明次数**，未读数仍然如实是 3——不许静默去重把"发生了三次"抹掉。
 */
const request=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api-client",()=>({apiRequest:request}));
const notice=(id:string,kind:"task"|"email",title:string,threadId:string|null)=>({id:`00000000-0000-4000-8000-00000000000${id}`,kind,title,body:"",threadId,actionable:false,createdAt:"2026-09-08T00:00:00.000Z",readAt:null});
const serve=(notifications:ReturnType<typeof notice>[],unreadCount=notifications.length)=>{
  request.mockImplementation(async(path:string,opts?:{method?:string})=>{
    if(path==="/notifications")return {notifications,unreadCount};
    if(path==="/notifications/read"&&opts?.method==="POST")return {read:notifications.length};
    if(String(path).startsWith("/schedule-notifications"))return {notifications:[]};
    throw new Error(`unexpected ${String(path)}`);
  });
};
const trigger=()=>screen.getByTestId("task-notifications-trigger");
beforeEach(()=>{request.mockReset();});

describe("#3223 通知收成图标 + 角标，正文只在弹层里",()=>{
  it("未读 > 0 时侧边栏不平铺任何通知正文，点开图标才出列表",async()=>{
    serve([notice("1","task","Report · 已完成","t"),notice("2","email","邮件：重置密码",null)]);
    render(<TaskNotifications sessionToken="token" onOpenThread={vi.fn()}/>);
    await waitFor(()=>expect(trigger()).toHaveAttribute("aria-expanded","false"));
    // 结构事实①：收起态整个组件里一条通知条目都没有。
    expect(screen.queryAllByTestId("notification-item")).toHaveLength(0);
    expect(screen.queryByText("邮件：重置密码")).toBeNull();
    expect(screen.queryByText("全部标为已读")).toBeNull();
    expect(screen.queryByText("最近已读")).toBeNull();
    // 结构事实②：收起态可交互元素只有那一个图标按钮。
    expect(within(screen.getByTestId("task-notifications")).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(trigger());
    const popover=await screen.findByTestId("task-notifications-popover");
    expect(trigger()).toHaveAttribute("aria-expanded","true");
    // 结构事实③：条目属于弹层子树，不是侧边栏直挂。
    expect(within(popover).getAllByTestId("notification-item")).toHaveLength(2);
    expect(within(popover).getByText("全部标为已读")).toBeInTheDocument();
  });

  it("角标未读数对读屏可读，且随标已读更新",async()=>{
    serve([notice("1","task","Report · 已完成","t"),notice("2","email","邮件：重置密码",null)]);
    render(<TaskNotifications sessionToken="token" onOpenThread={vi.fn()}/>);
    await waitFor(()=>expect(trigger()).toHaveAccessibleName("任务提醒，2 条未读"));
    expect(screen.getByTestId("task-notifications-badge")).toHaveTextContent("2");
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByText("全部标为已读"));
    await waitFor(()=>expect(trigger()).toHaveAccessibleName("任务提醒，0 条未读"));
    // 归零后角标不再占位（结构事实，不是样式断言）。
    expect(screen.queryByTestId("task-notifications-badge")).toBeNull();
  });

  it("键盘可开关：Escape 关闭弹层且焦点回到图标按钮（TW-A11Y-5）",async()=>{
    serve([notice("1","task","Report · 已完成","t")]);
    render(<TaskNotifications sessionToken="token" onOpenThread={vi.fn()}/>);
    await waitFor(()=>expect(trigger()).toBeInTheDocument());
    fireEvent.click(trigger());
    const popover=await screen.findByTestId("task-notifications-popover");
    // 打开后焦点进入弹层，不留在触发器上。
    await waitFor(()=>expect(popover.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(popover,{key:"Escape"});
    await waitFor(()=>expect(screen.queryByTestId("task-notifications-popover")).toBeNull());
    expect(document.activeElement).toBe(trigger());
  });
});

describe("#3224 同一任务的重复完成提醒合并呈现，不掩盖发生了几次",()=>{
  const triple=[notice("1","task","高铁司机画像 · 已完成","t7"),notice("2","task","高铁司机画像 · 已完成","t7"),notice("3","task","高铁司机画像 · 已完成","t7")];
  it("三条逐字相同的完成提醒合并成一条并注明 3 次，未读数仍是 3",async()=>{
    serve(triple);
    render(<TaskNotifications sessionToken="token" onOpenThread={vi.fn()}/>);
    await waitFor(()=>expect(trigger()).toHaveAccessibleName("任务提醒，3 条未读"));
    fireEvent.click(trigger());
    const popover=await screen.findByTestId("task-notifications-popover");
    const items=within(popover).getAllByTestId("notification-item");
    expect(items).toHaveLength(1);
    expect(items[0]!).toHaveAttribute("data-occurrences","3");
    expect(items[0]!).toHaveTextContent("×3");
  });
  it("点合并条目把三条一起标已读（不是只读掉一条）",async()=>{
    serve(triple);
    const open=vi.fn();
    render(<TaskNotifications sessionToken="token" onOpenThread={open}/>);
    await waitFor(()=>expect(trigger()).toBeInTheDocument());
    fireEvent.click(trigger());
    const merged=within(await screen.findByTestId("task-notifications-popover")).getAllByTestId("notification-item");
    expect(merged).toHaveLength(1);
    fireEvent.click(merged[0]!);
    expect(open).toHaveBeenCalledWith("t7");
    await waitFor(()=>expect(request).toHaveBeenCalledWith("/notifications/read",expect.objectContaining({method:"POST",body:{ids:triple.map(t=>t.id)}})));
  });
  it("标题不同（完成 vs 失败）的两条不许合并",async()=>{
    serve([notice("1","task","高铁司机画像 · 已完成","t7"),notice("2","task","高铁司机画像 · 执行失败","t7")]);
    render(<TaskNotifications sessionToken="token" onOpenThread={vi.fn()}/>);
    await waitFor(()=>expect(trigger()).toBeInTheDocument());
    fireEvent.click(trigger());
    expect(within(await screen.findByTestId("task-notifications-popover")).getAllByTestId("notification-item")).toHaveLength(2);
  });
});
