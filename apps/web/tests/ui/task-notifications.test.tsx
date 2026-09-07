import * as React from "react";
import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {describe,it,expect,vi,beforeEach} from "vitest";
import {TaskNotifications} from "@/components/chat/workbench/task-notifications";
import type {NotificationThread} from "@/lib/chat-workbench/task-notifications";
const card:NotificationThread={id:"t",title:"Report",status:"running",lastActivityAt:"today"};
beforeEach(()=>localStorage.clear());
describe("background task notification navigation",()=>{
  it("opens the actual thread and persists read state across remount",async()=>{
    const open=vi.fn();const props={scopeKey:"org:user:project",activeThreadId:null,onOpenThread:open,onRefresh:vi.fn()};
    const view=render(<TaskNotifications {...props} cards={[card]}/>);
    await waitFor(()=>expect(localStorage.getItem("workspacex.task-notices.v1:org:user:project")).toContain("running"));
    view.rerender(<TaskNotifications {...props} cards={[{...card,status:"done"}]}/>);
    fireEvent.click(await screen.findByText("Report · 已完成"));
    expect(open).toHaveBeenCalledWith("t");
    await waitFor(()=>expect(screen.getByText("0 条未读")).toBeInTheDocument());
    view.unmount();render(<TaskNotifications {...props} cards={[{...card,status:"done"}]}/>);
    await waitFor(()=>expect(screen.getByText("0 条未读")).toBeInTheDocument());
  });
  it("hides previous account notices synchronously on scope changes",async()=>{
    const props={activeThreadId:null,onOpenThread:vi.fn(),onRefresh:vi.fn()};
    const view=render(<TaskNotifications {...props} scopeKey="first" cards={[{...card,status:"paused"}]}/>);
    await screen.findByText("Report · 已暂停");
    view.rerender(<TaskNotifications {...props} scopeKey="second" cards={null}/>);
    expect(screen.queryByText("Report · 已暂停")).toBeNull();
  });
});
