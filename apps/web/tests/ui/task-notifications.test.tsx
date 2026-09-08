import * as React from "react";
import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {describe,it,expect,vi,beforeEach} from "vitest";
import {TaskNotifications} from "@/components/chat/workbench/task-notifications";
const request=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api-client",()=>({apiRequest:request}));
const notice=(id:string,kind:"task"|"email",title:string,threadId:string|null)=>({id:`00000000-0000-4000-8000-00000000000${id}`,kind,title,body:"",threadId,createdAt:"2026-09-08T00:00:00.000Z",readAt:null});
beforeEach(()=>{request.mockReset();});
describe("global notification center",()=>{
  it("lists server-pushed task and email notices, opens the thread and marks it read",async()=>{
    request.mockImplementation(async(path:string,opts?:{method?:string})=>{
      if(path==="/notifications")return {notifications:[notice("1","task","Report · 已完成","t"),notice("2","email","邮件：重置密码",null)],unreadCount:2};
      if(path==="/notifications/read"&&opts?.method==="POST")return {read:1};
      if(String(path).startsWith("/schedule-notifications"))return {notifications:[]};
      throw new Error(`unexpected ${String(path)}`);
    });
    const open=vi.fn();
    render(<TaskNotifications sessionToken="token" onOpenThread={open}/>);
    await screen.findByText("2 条未读");
    expect(screen.getByText("邮件：重置密码")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Report · 已完成"));
    expect(open).toHaveBeenCalledWith("t");
    await waitFor(()=>expect(request).toHaveBeenCalledWith("/notifications/read",expect.objectContaining({method:"POST",body:{ids:["00000000-0000-4000-8000-000000000001"]}})));
    await waitFor(()=>expect(screen.getByText("1 条未读")).toBeInTheDocument());
  });
  it("shows nothing from a previous session token",async()=>{
    request.mockImplementation(async(path:string)=>path==="/notifications"?{notifications:[notice("1","task","Old · 已完成","t")],unreadCount:1}:{notifications:[]});
    const view=render(<TaskNotifications sessionToken="first" onOpenThread={vi.fn()}/>);
    await screen.findByText("Old · 已完成");
    view.rerender(<TaskNotifications sessionToken={undefined} onOpenThread={vi.fn()}/>);
    expect(screen.queryByText("Old · 已完成")).toBeNull();
    expect(screen.getByText("0 条未读")).toBeInTheDocument();
  });
});
