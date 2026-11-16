import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberChatPage, MemberChatPost, MemberChatReplies, ProjectMemberMessage } from "@/lib/live-project-member-chat";
const mocks = vi.hoisted(() => ({ enabled: true, list: vi.fn(), replies: vi.fn(), post: vi.fn(), names: vi.fn(), session: { status: "authenticated", session: { currentOrgId: "org", userId: "alice", sessionToken: "token" } } }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => mocks.session }));
vi.mock("@/lib/project-member-chat-config", () => ({ isProjectMemberChatEnabled: () => mocks.enabled }));
vi.mock("@/lib/live-project-member-chat", () => ({ listProjectMemberMessages: mocks.list, listProjectMemberReplies: mocks.replies, postProjectMemberMessage: mocks.post, listProjectMemberNames: mocks.names }));
import { ProjectMemberChat } from "@/components/project/project-member-chat";
const rootId = "10000000-0000-4000-8000-000000000001", replyId = "10000000-0000-4000-8000-000000000002";
function msg(overrides: Partial<ProjectMemberMessage> = {}): ProjectMemberMessage { return { id: rootId, projectId: "p", sequence: 1, authorId: "bob", clientMessageId: "20000000-0000-4000-8000-000000000001", text: "真实成员的讨论", threadRootId: null, stageReference: null, createdAt: "2026-11-14T09:00:00.000Z", ...overrides }; }
function page(items: ProjectMemberMessage[] = [], overrides: Partial<MemberChatPage> = {}): MemberChatPage { return { items, nextBeforeSequence: null, nextAfterSequence: 1, latestSequence: 1, canWrite: true, readOnlyReason: null, threadUpdates: [], ...overrides }; }
function topic(items: ProjectMemberMessage[] = []): MemberChatReplies { const { threadUpdates: _updates, ...base } = page(items); return { ...base, root: msg() }; }
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:unknown)=>void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function posted(index: number): MemberChatPost { const call = mocks.post.mock.calls[index]; if (!call) throw new Error(`Expected member POST call ${index + 1}`); return call[0] as MemberChatPost; }
async function ready() { await waitFor(() => expect(screen.getByTestId("project-member-input")).not.toBeDisabled()); }
function type(text: string) { fireEvent.change(screen.getByTestId("project-member-input"), { target: { value: text } }); }
beforeEach(() => { mocks.enabled=true; mocks.names.mockReset().mockResolvedValue(new Map()); mocks.session={status:"authenticated",session:{currentOrgId:"org",userId:"alice",sessionToken:"token"}}; mocks.list.mockReset().mockResolvedValue(page()); mocks.replies.mockReset().mockResolvedValue(topic()); mocks.post.mockReset().mockImplementation((input:MemberChatPost) => Promise.resolve({message:msg({ id: replyId, authorId:"alice",clientMessageId:input.clientMessageId,text:input.text,threadRootId:input.threadRootId??null,stageReference:input.stageReference??null }),replayed:false})); Object.defineProperty(document,"hidden",{configurable:true,value:false}); Object.defineProperty(navigator,"onLine",{configurable:true,value:true}); });
afterEach(() => { vi.useRealTimers(); });
describe("real member chat controller", () => {
 it.each(["history", "topic"] as const)("still hides cached contents when the current %s request denies access", async (source) => {
  mocks.list.mockResolvedValueOnce(page([msg()], {nextBeforeSequence:1})).mockRejectedValue({reasonCode:"NOT_FOUND",status:404});
  mocks.replies.mockRejectedValue({reasonCode:"NOT_FOUND",status:404});
  render(<ProjectMemberChat projectId="p"/>);
  await ready();
  type("当前撤权后保留的未发草稿");
  if (source === "history") fireEvent.click(screen.getByTestId("project-member-load-older"));
  else fireEvent.click(screen.getByTestId(`project-member-topic-${rootId}`));
  await screen.findByTestId("project-member-history-error");
  expect(screen.queryByText("真实成员的讨论")).toBeNull();
  expect(screen.getByTestId("project-member-input")).toBeDisabled();
  expect(screen.getByTestId("project-member-input")).toHaveValue("当前撤权后保留的未发草稿");
  expect(mocks.post).not.toHaveBeenCalled();
 });
 it.each(["history", "topic"] as const)("keeps fresh authorization after an obsolete %s request rejects access", async (source) => {
  vi.useFakeTimers();
  const stale = deferred<never>();
  mocks.list.mockImplementationOnce(() => Promise.resolve(page([msg()], {nextBeforeSequence:1})))
   .mockImplementation(({beforeSequence}: {beforeSequence?:number}) => beforeSequence !== undefined ? stale.promise : Promise.resolve(page()));
  mocks.replies.mockReturnValueOnce(stale.promise).mockResolvedValue(topic());
  render(<ProjectMemberChat projectId="p"/>);
  await act(async () => { await Promise.resolve(); });
  type("恢复权限后保留的频道草稿");
  if (source === "history") fireEvent.click(screen.getByTestId("project-member-load-older"));
  else fireEvent.click(screen.getByTestId(`project-member-topic-${rootId}`));
  mocks.list.mockResolvedValueOnce(page([], {canWrite:false,readOnlyReason:"role"}));
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByTestId("project-member-readonly")).toHaveTextContent("只读");
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.queryByTestId("project-member-readonly")).toBeNull();
  await act(async () => stale.reject({reasonCode:"NOT_FOUND",status:404}));
  expect(screen.queryByTestId("project-member-readonly")).toBeNull();
  if (source === "topic") {
   expect(screen.getByTestId("project-member-history-error")).toHaveTextContent("话题读取失败");
   fireEvent.click(screen.getByRole("button", {name:"重试读取"}));
   await act(async () => { await Promise.resolve(); });
   expect(screen.getByTestId("project-member-topic-root")).toBeVisible();
   fireEvent.click(screen.getByTestId("project-member-topic-close"));
  }
  expect(screen.getByTestId("project-member-input")).not.toBeDisabled();
  expect(screen.getByTestId("project-member-input")).toHaveValue("恢复权限后保留的频道草稿");
  const calls = mocks.list.mock.calls.length;
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(mocks.list.mock.calls.length).toBeGreaterThan(calls);
 });
 it.each(["archived", "removed"] as const)("does not restore write access from older history after a newer %s observation", async (change) => {
  vi.useFakeTimers();
  const history = deferred<MemberChatPage>();
  mocks.list.mockImplementation(({beforeSequence, afterSequence}: {beforeSequence?: number; afterSequence?: number}) => {
   if (beforeSequence !== undefined) return history.promise;
   if (afterSequence !== undefined) return change === "removed" ? Promise.reject({reasonCode:"NOT_FOUND",status:404}) : Promise.resolve(page([], {canWrite:false,readOnlyReason:"archived"}));
   return Promise.resolve(page([msg()], {nextBeforeSequence:1}));
  });
  render(<ProjectMemberChat projectId="p"/>);
  await act(async () => { await Promise.resolve(); });
  type("降权后仍保留的草稿");
  fireEvent.click(screen.getByTestId("project-member-load-older"));
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByTestId("project-member-input")).toBeDisabled();
  await act(async () => history.resolve(page([msg({text:"旧权限请求迟回的内容"})], {canWrite:true})));
  expect(screen.getByTestId("project-member-input")).toBeDisabled();
  expect(screen.getByTestId("project-member-input")).toHaveValue("降权后仍保留的草稿");
  if (change === "archived") expect(screen.getByTestId("project-member-readonly")).toHaveTextContent("归档");
  else expect(screen.queryByText("旧权限请求迟回的内容")).toBeNull();
  fireEvent.click(screen.getByTestId("project-member-send"));
  expect(mocks.post).not.toHaveBeenCalled();
 });
 it("does not reopen a topic composer when its older writable read follows a newer read-only channel read", async () => {
  vi.useFakeTimers();
  const replies = deferred<MemberChatReplies>();
  mocks.list.mockResolvedValueOnce(page([msg()])).mockResolvedValue(page([], {canWrite:false,readOnlyReason:"archived"}));
  mocks.replies.mockReturnValueOnce(replies.promise);
  render(<ProjectMemberChat projectId="p"/>);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByTestId(`project-member-topic-${rootId}`));
  await act(async () => { vi.advanceTimersByTime(5000); });
  await act(async () => replies.resolve(topic()));
  expect(screen.getByTestId("project-member-topic-root")).toBeVisible();
  expect(screen.getByTestId("project-member-readonly")).toHaveTextContent("归档");
  expect(screen.getByTestId("project-member-input")).toBeDisabled();
  expect(mocks.post).not.toHaveBeenCalled();
 });
 it("keeps a server write denial authoritative over an already pending history read and permits fresh authorization recovery", async () => {
  vi.useFakeTimers();
  const history = deferred<MemberChatPage>();
  const write = deferred<{message:ProjectMemberMessage;replayed:boolean}>();
  mocks.list.mockImplementation(({beforeSequence}: {beforeSequence?:number}) => beforeSequence !== undefined ? history.promise : Promise.resolve(page([msg()], {nextBeforeSequence:1})));
  mocks.post.mockReturnValueOnce(write.promise);
  render(<ProjectMemberChat projectId="p"/>);
  await act(async () => { await Promise.resolve(); });
  type("服务端拒绝的原文");
  fireEvent.click(screen.getByTestId("project-member-send"));
  fireEvent.click(screen.getByTestId("project-member-load-older"));
  await act(async () => write.reject({reasonCode:"READ_ONLY_ROLE"}));
  expect(screen.getByRole("button", {name:"同一请求重试"})).toBeDisabled();
  await act(async () => history.resolve(page([], {canWrite:true})));
  expect(screen.getByRole("button", {name:"同一请求重试"})).toBeDisabled();
  expect(screen.getByTestId("project-member-input")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", {name:"同一请求重试"}));
  expect(mocks.post).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByTestId("project-member-input")).not.toBeDisabled();
  expect(screen.getByRole("button", {name:"同一请求重试"})).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", {name:"同一请求重试"}));
  await act(async () => { await Promise.resolve(); });
  expect(mocks.post).toHaveBeenCalledTimes(2);
  expect(posted(1)).toEqual(posted(0));
 });
 it("stays idle when flag is off or panel is inactive", async () => { mocks.enabled=false; const {rerender}=render(<ProjectMemberChat projectId="p" />); expect(mocks.list).not.toHaveBeenCalled(); mocks.enabled=true; rerender(<ProjectMemberChat projectId="p" active={false} />); expect(mocks.list).not.toHaveBeenCalled(); rerender(<ProjectMemberChat projectId="p" />); await ready(); expect(mocks.list).toHaveBeenCalledWith({projectId:"p",limit:30},expect.objectContaining({sessionToken:"token"})); });
 it("does not POST Safari IME confirmation Enter with keyCode 229 even when isComposing is false",async()=>{render(<ProjectMemberChat projectId="p"/>);await ready();type("中文输入确认不能误发");const input=screen.getByTestId("project-member-input");fireEvent.keyDown(input,{key:"Enter",keyCode:229,isComposing:false});expect(mocks.post).not.toHaveBeenCalled();expect(input).toHaveValue("中文输入确认不能误发");fireEvent.keyDown(input,{key:"Enter",shiftKey:true});fireEvent.keyDown(input,{key:"Enter",isComposing:true});expect(mocks.post).not.toHaveBeenCalled();fireEvent.keyDown(input,{key:"Enter",keyCode:13,isComposing:false});await waitFor(()=>expect(mocks.post).toHaveBeenCalledTimes(1));});
 it("shows server receipts only after POST and preserves raw human text",async()=>{ const send=deferred<Awaited<ReturnType<typeof import('@/lib/live-project-member-chat').postProjectMemberMessage>>>(); mocks.post.mockReturnValueOnce(send.promise); render(<ProjectMemberChat projectId="p" />); await ready(); type("<script>普通消息</script>"); fireEvent.click(screen.getByTestId("project-member-send")); expect(screen.getByTestId("project-member-input")).toHaveValue(""); expect(screen.getByText("发送中…")).toBeVisible(); const request=posted(0); expect(request.threadRootId).toBeUndefined(); expect(request.stageReference).toBeUndefined(); await act(async()=>send.resolve({message:msg({authorId:"alice",clientMessageId:request.clientMessageId,text:request.text}),replayed:false})); expect(screen.getByText("服务器已保存")).toBeVisible(); expect(screen.getByTestId("project-member-message-body")).toHaveTextContent("<script>普通消息</script>"); expect(document.querySelector("script")).toBeNull(); });
 it("retries the same immutable client ID after lost receipt and deduplicates replay",async()=>{mocks.post.mockRejectedValueOnce(new Error("network lost")); render(<ProjectMemberChat projectId="p" />); await ready(); type("原文"); fireEvent.click(screen.getByTestId("project-member-send")); const button=await screen.findByRole("button",{name:"同一请求重试"}); const first=posted(0); type("新的未发草稿"); fireEvent.click(button); await screen.findByText("服务器已保存"); expect(posted(1)).toEqual(first); expect(screen.getAllByTestId("project-member-message")).toHaveLength(1); expect(screen.getByTestId("project-member-input")).toHaveValue("新的未发草稿"); });
 it("never invents a fresh id to hide idempotency conflicts",async()=>{mocks.post.mockRejectedValue({reasonCode:"IDEMPOTENCY_CONFLICT"}); render(<ProjectMemberChat projectId="p" />);await ready();type("冲突原文");fireEvent.click(screen.getByTestId("project-member-send"));await screen.findByText(/请求标识冲突/);expect(screen.queryByRole("button",{name:"同一请求重试"})).toBeNull();expect(mocks.post).toHaveBeenCalledTimes(1);});
 it("keeps project drafts separate and rechecks permission before showing cached history",async()=>{mocks.list.mockImplementation(({projectId}:{projectId:string})=>Promise.resolve(page([msg({projectId,text:`${projectId} 私有历史`})])));const {rerender}=render(<ProjectMemberChat projectId="p"/>);await ready();type("p的草稿");rerender(<ProjectMemberChat projectId="q"/>);await ready();expect(screen.getByTestId("project-member-input")).toHaveValue("");expect(screen.queryByText("p 私有历史")).toBeNull();type("q的草稿");const check=deferred<MemberChatPage>();mocks.list.mockReturnValueOnce(check.promise);rerender(<ProjectMemberChat projectId="p"/>);expect(screen.queryByText("p 私有历史")).toBeNull();await act(async()=>check.resolve(page([msg({text:"p 私有历史"})])));await ready();expect(screen.getByTestId("project-member-input")).toHaveValue("p的草稿");});
 it("isolates new actor from delayed reads and old drafts",async()=>{const late=deferred<MemberChatPage>();mocks.list.mockReturnValueOnce(late.promise);const {rerender}=render(<ProjectMemberChat projectId="p"/>);mocks.session={status:"authenticated",session:{currentOrgId:"other",userId:"carol",sessionToken:"fresh"}};rerender(<ProjectMemberChat projectId="p"/>);await ready();await act(async()=>late.resolve(page([msg({text:"旧账号的私有内容"})])));expect(screen.queryByText("旧账号的私有内容")).toBeNull();expect(screen.getByTestId("project-member-input")).toHaveValue("");});
 it("distinguishes read failure from empty and disables post for archived members",async()=>{mocks.list.mockRejectedValueOnce(new Error("503"));const {rerender}=render(<ProjectMemberChat projectId="p"/>);await screen.findByTestId("project-member-history-error");expect(screen.queryByTestId("project-member-empty")).toBeNull();mocks.list.mockResolvedValue(page([msg()],{canWrite:false,readOnlyReason:"archived"}));fireEvent.click(screen.getByRole("button",{name:"重试读取"}));await screen.findByText("真实成员的讨论");expect(screen.getByTestId("project-member-input")).toBeDisabled();expect(screen.getByTestId("project-member-readonly")).toHaveTextContent("归档");rerender(<ProjectMemberChat projectId="p"/>);expect(mocks.post).not.toHaveBeenCalled();});
 it("adds stage context only on explicit consent, and thread replies target the real root",async()=>{mocks.list.mockResolvedValue(page([msg()]));render(<ProjectMemberChat projectId="p" stageReference={{stageId:3,revision:2}}/>);await ready();fireEvent.click(screen.getByRole("checkbox"));type("主动分享");fireEvent.click(screen.getByTestId("project-member-send"));await waitFor(()=>expect(mocks.post).toHaveBeenCalledTimes(1));expect(posted(0).stageReference).toEqual({stageId:3,revision:2});fireEvent.click(screen.getByTestId(`project-member-topic-${rootId}`));await waitFor(()=>expect(screen.getByTestId("project-member-topic-root")).toBeVisible());await ready();type("只回复这条");fireEvent.click(screen.getByTestId("project-member-send"));await waitFor(()=>expect(mocks.post).toHaveBeenCalledTimes(2));expect(posted(1).threadRootId).toBe(rootId);expect(posted(1).stageReference).toBeUndefined();});
 it("exposes old-root reply updates and loads their authorized root on demand",async()=>{mocks.list.mockResolvedValue(page([],{threadUpdates:[{rootMessageId:rootId,replyCount:2,lastSequence:8}],nextAfterSequence:8,latestSequence:8}));mocks.replies.mockResolvedValue(topic([msg({id:replyId,threadRootId:rootId,text:"旧话题新回复",sequence:8})]));render(<ProjectMemberChat projectId="p"/>);await ready();fireEvent.click(screen.getByTestId(`project-member-earlier-topic-${rootId}`));expect(await screen.findByTestId("project-member-topic-root")).toHaveTextContent("真实成员的讨论");expect(within(screen.getByTestId("project-member-replies")).getByText("旧话题新回复")).toBeVisible();});
 it("keeps a failed older topic escapable, disables misrouted send, and retries the real root",async()=>{mocks.list.mockResolvedValue(page([],{threadUpdates:[{rootMessageId:rootId,replyCount:1,lastSequence:8}]}));mocks.replies.mockRejectedValueOnce(new Error("503"));render(<ProjectMemberChat projectId="p"/>);await ready();fireEvent.click(screen.getByTestId(`project-member-earlier-topic-${rootId}`));await screen.findByTestId("project-member-history-error");expect(screen.getByTestId("project-member-input")).toBeDisabled();expect(screen.getByTestId("project-member-topic-close")).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"重试读取"}));await screen.findByTestId("project-member-topic-root");await ready();fireEvent.click(screen.getByTestId("project-member-topic-close"));expect(screen.queryByTestId("project-member-topic-root")).toBeNull();});
 it("keeps one expandable root summary outside the scrolling reply log with long replies",async()=>{const original="原始问题：我们如何安排真实访谈并保留每一位受访者的证据？".repeat(8);const root=msg({text:original});const longReplies=Array.from({length:30},(_,index)=>msg({id:`30000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,sequence:index+2,threadRootId:rootId,text:`第${index+1}条长回复：${"请保留不同意见和真实材料。".repeat(25)}`}));mocks.list.mockResolvedValue(page([root]));mocks.replies.mockResolvedValue({...topic(longReplies),root});render(<ProjectMemberChat projectId="p"/>);await ready();fireEvent.click(screen.getByTestId(`project-member-topic-${rootId}`));const summary=await screen.findByTestId("project-member-topic-root"),log=screen.getByTestId("project-member-replies");expect(log.contains(summary)).toBe(false);expect(screen.getByTestId("project-member-topic-header")).toContainElement(summary);expect(summary).toHaveAttribute("data-message-id",rootId);expect(within(log).queryByText(original)).toBeNull();expect(screen.getAllByTestId("project-member-topic-original")).toHaveLength(1);Object.defineProperties(log,{scrollHeight:{configurable:true,value:6000},clientHeight:{configurable:true,value:240},scrollTop:{configurable:true,writable:true,value:5760}});fireEvent.scroll(log);expect(summary).toBeVisible();const expand=screen.getByTestId("project-member-topic-expand");expect(expand).toHaveAttribute("aria-expanded","false");fireEvent.click(expand);expect(expand).toHaveAttribute("aria-expanded","true");expect(screen.getByTestId("project-member-topic-original")).toHaveTextContent(original);expect(within(log).getAllByTestId("project-member-message")).toHaveLength(30);});
 it("uses authorized directory display names and keeps actual IDs available on demand",async()=>{mocks.list.mockResolvedValue(page([msg()]));mocks.names.mockResolvedValue(new Map([["bob","小林"]]));render(<ProjectMemberChat projectId="p"/>);await ready();expect(await screen.findByText("小林")).toBeVisible();expect(screen.getByTestId("project-member-author-id")).toHaveTextContent("bob");expect(screen.getByTestId("project-member-author-id")).not.toBeVisible();fireEvent.click(screen.getByText("查看成员ID"));expect(screen.getByTestId("project-member-author-id")).toBeVisible();});
 it("keeps messages usable when names fail and rejects late names from another project",async()=>{const late=deferred<Map<string,string>>();mocks.list.mockImplementation(({projectId}:{projectId:string})=>Promise.resolve(page([msg({projectId})])));mocks.names.mockReturnValueOnce(late.promise).mockRejectedValueOnce(new Error("directory denied"));const {rerender}=render(<ProjectMemberChat projectId="p"/>);await ready();rerender(<ProjectMemberChat projectId="q"/>);await ready();await act(async()=>late.resolve(new Map([["bob","其他组不应显示的名称"]])));expect(screen.queryByText("其他组不应显示的名称")).toBeNull();expect(screen.getByText("小组成员",{selector:"span"})).toBeVisible();type("名单失败仍可发送");fireEvent.click(screen.getByTestId("project-member-send"));await waitFor(()=>expect(mocks.post).toHaveBeenCalledTimes(1));});
 it("hides previously authorized history after token rotation until a fresh read succeeds",async()=>{mocks.list.mockResolvedValueOnce(page([msg({text:"保密历史"})]));const {rerender}=render(<ProjectMemberChat projectId="p"/>);await ready();type("自己的未发草稿");mocks.list.mockRejectedValueOnce(new Error("new-token failed"));mocks.session={status:"authenticated",session:{currentOrgId:"org",userId:"alice",sessionToken:"rotated"}};rerender(<ProjectMemberChat projectId="p"/>);expect(screen.queryByText("保密历史")).toBeNull();await screen.findByTestId("project-member-history-error");expect(screen.queryByText("保密历史")).toBeNull();expect(screen.getByTestId("project-member-input")).toHaveValue("自己的未发草稿");expect(screen.getByTestId("project-member-input")).toBeDisabled();});
 it("does not expose a delayed old-project POST receipt in another project",async()=>{const post=deferred<{message:ProjectMemberMessage;replayed:boolean}>();mocks.post.mockReturnValueOnce(post.promise);const {rerender}=render(<ProjectMemberChat projectId="p"/>);await ready();type("p专属发送");fireEvent.click(screen.getByTestId("project-member-send"));const sent=posted(0);rerender(<ProjectMemberChat projectId="q"/>);await ready();type("q保留草稿");await act(async()=>post.resolve({message:msg({authorId:"alice",clientMessageId:sent.clientMessageId,text:sent.text}),replayed:false}));expect(screen.queryByText("p专属发送")).toBeNull();expect(screen.getByTestId("project-member-input")).toHaveValue("q保留草稿");});
 it("preserves drafts offline, disables sending, and catches up on reconnect",async()=>{render(<ProjectMemberChat projectId="p"/>);await ready();type("断网不丢草稿");Object.defineProperty(navigator,"onLine",{configurable:true,value:false});fireEvent(window,new Event("offline"));expect(screen.getByTestId("project-member-input")).toHaveValue("断网不丢草稿");fireEvent.click(screen.getByTestId("project-member-send"));expect(mocks.post).not.toHaveBeenCalled();const before=mocks.list.mock.calls.length;Object.defineProperty(navigator,"onLine",{configurable:true,value:true});fireEvent(window,new Event("online"));await ready();await waitFor(()=>expect(mocks.list.mock.calls.length).toBeGreaterThan(before));expect(screen.getByTestId("project-member-input")).toHaveValue("断网不丢草稿");});
 it("drains delta pages using nextAfterSequence and retains replies separately from roots",async()=>{vi.useFakeTimers();mocks.list.mockResolvedValueOnce(page([],{nextAfterSequence:8,latestSequence:8})).mockResolvedValueOnce(page([msg({id:replyId,threadRootId:rootId,sequence:10})],{nextAfterSequence:10,latestSequence:12,threadUpdates:[{rootMessageId:rootId,replyCount:1,lastSequence:10}]})).mockResolvedValueOnce(page([],{nextAfterSequence:12,latestSequence:12}));render(<ProjectMemberChat projectId="p"/>);await act(async()=>{await Promise.resolve();});await act(async()=>{vi.advanceTimersByTime(5000);});expect(mocks.list.mock.calls.map((call)=>call[0].afterSequence)).toEqual([undefined,8,10]);expect(screen.queryByTestId("project-member-message-body")).toBeNull();expect(screen.getByTestId(`project-member-earlier-topic-${rootId}`)).toBeVisible();});
 it("restarts an interrupted topic read on project return and rejects its stale response",async()=>{const late=deferred<MemberChatReplies>();mocks.list.mockImplementation(({projectId}:{projectId:string})=>Promise.resolve(page(projectId==="p"?[msg()]:[])));mocks.replies.mockReturnValueOnce(late.promise).mockResolvedValue(topic([msg({id:replyId,threadRootId:rootId,text:"返回后重新读取的回复"})]));const {rerender}=render(<ProjectMemberChat projectId="p"/>);await ready();fireEvent.click(screen.getByTestId(`project-member-topic-${rootId}`));await waitFor(()=>expect(mocks.replies).toHaveBeenCalledTimes(1));const interruptedSignal=mocks.replies.mock.calls[0]?.[1]?.signal as AbortSignal|undefined;rerender(<ProjectMemberChat projectId="q"/>);await ready();expect(interruptedSignal?.aborted).toBe(true);rerender(<ProjectMemberChat projectId="p"/>);await screen.findByTestId("project-member-topic-root");await act(async()=>late.resolve(topic([msg({id:replyId,threadRootId:rootId,text:"旧访问迟回的回复"})])));await waitFor(()=>expect(mocks.replies).toHaveBeenCalledTimes(2));expect(await screen.findByText("返回后重新读取的回复")).toBeVisible();expect(screen.queryByText("旧访问迟回的回复")).toBeNull();});
 it("does not regress reply activity when an older-history request arrives after a new delta",async()=>{vi.useFakeTimers();const history=deferred<MemberChatPage>();mocks.list.mockImplementation(({beforeSequence,afterSequence}:{beforeSequence?:number;afterSequence?:number})=>{if(beforeSequence!==undefined)return history.promise;if(afterSequence!==undefined)return Promise.resolve(page([],{nextAfterSequence:105,latestSequence:105,threadUpdates:[{rootMessageId:rootId,replyCount:5,lastSequence:105}]}));return Promise.resolve(page([msg({sequence:100})],{nextBeforeSequence:50,nextAfterSequence:100,latestSequence:100,threadUpdates:[{rootMessageId:rootId,replyCount:1,lastSequence:50}]}));});render(<ProjectMemberChat projectId="p"/>);await act(async()=>{await Promise.resolve();});fireEvent.click(screen.getByTestId("project-member-load-older"));await act(async()=>{vi.advanceTimersByTime(5000);});expect(screen.getByTestId(`project-member-topic-${rootId}`)).toHaveTextContent("5");await act(async()=>history.resolve(page([],{threadUpdates:[{rootMessageId:rootId,replyCount:1,lastSequence:50}]})));expect(screen.getByTestId(`project-member-topic-${rootId}`)).toHaveTextContent("5");});
 it("pauses polling while hidden and catches up using safe server watermark on reopen",async()=>{vi.useFakeTimers();mocks.list.mockResolvedValue(page([],{nextAfterSequence:90,latestSequence:90}));const {rerender}=render(<ProjectMemberChat projectId="p"/>);await act(async()=>{await Promise.resolve();});expect(mocks.list).toHaveBeenCalledTimes(1);await act(async()=>{vi.advanceTimersByTime(5000);});expect(mocks.list.mock.calls[1]?.[0].afterSequence).toBe(90);rerender(<ProjectMemberChat projectId="p" active={false}/>);await act(async()=>{vi.advanceTimersByTime(15000);});expect(mocks.list).toHaveBeenCalledTimes(2);rerender(<ProjectMemberChat projectId="p"/>);await act(async()=>{await Promise.resolve();});expect(mocks.list).toHaveBeenCalledTimes(3);Object.defineProperty(document,"hidden",{configurable:true,value:true});fireEvent(document,new Event("visibilitychange"));await act(async()=>{vi.advanceTimersByTime(10000);});expect(mocks.list).toHaveBeenCalledTimes(3);});
});
