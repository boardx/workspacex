import {describe,it,expect} from "vitest";
import {emptyTaskNotices,reconcileTaskNotices,type NotificationThread} from "@/lib/chat-workbench/task-notifications";
const card=(status:NotificationThread["status"],id="t"):NotificationThread=>({id,title:"Task",status,lastActivityAt:"2026-09-07"});
describe("durable task notice cursors",()=>{
  it("announces completed background work once across reload and thread switches",()=>{
    const initial=reconcileTaskNotices(emptyTaskNotices(),[card("running")],null);
    const complete=reconcileTaskNotices(initial,[card("done")],null);
    expect(complete.unread).toHaveLength(1);
    expect(reconcileTaskNotices(JSON.parse(JSON.stringify(complete)),[card("done")],null).unread).toHaveLength(1);
    const read=reconcileTaskNotices(complete,[card("done")],"t");
    expect(reconcileTaskNotices(read,[card("done")],null).unread).toEqual([]);
  });
  it("does not flood historical completion but surfaces pending action",()=>{
    expect(reconcileTaskNotices(emptyTaskNotices(),[card("done")],null).unread).toEqual([]);
    expect(reconcileTaskNotices(emptyTaskNotices(),[card("awaiting-approval")],null).unread[0]?.status).toBe("awaiting-approval");
    const paused=reconcileTaskNotices(emptyTaskNotices(),[card("paused")],null);
    const running=reconcileTaskNotices(paused,[card("running")],null);
    expect(reconcileTaskNotices(running,[card("paused")],null).unread).toHaveLength(1);
  });
  it("removes lost-permission notices and current-thread failures",()=>{
    const pending=reconcileTaskNotices(emptyTaskNotices(),[card("paused")],null);
    expect(reconcileTaskNotices(pending,[],null).unread).toEqual([]);
    expect(reconcileTaskNotices(pending,[card("failed")],"t").unread).toEqual([]);
  });
});
