import * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
import { ProjectMemberChatLauncher } from "@/components/project/project-member-chat-launcher";
import { requestOpenInRightPanel, requestOpenFileInRightPanel } from "@/lib/chat-workbench/panel-document";
import { requestOpenKnowledgePanel } from "@/lib/knowledge-graph-events";
const mocks = vi.hoisted(() => ({ mobile: false, request: vi.fn() }));
vi.mock("@/lib/api-client", async original => ({...await original<typeof import("@/lib/api-client")>(), apiRequest: mocks.request}));
vi.mock("@/lib/project-member-chat-config", () => ({ isProjectMemberChatEnabled: () => true }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({status:"authenticated",session:{currentOrgId:"org",userId:"student",sessionToken:"token"}}) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/aidt/group-a", useSearchParams: () => new URLSearchParams("step=1") }));
vi.mock("next/dynamic", () => ({ default: () => function MemberMessages() { return <textarea aria-label="member draft" />; } }));
const base: ChatTaskInspectorProps = {
  hasSelection:true,threadId:"t-1",projectId:"group-a",artifacts:null,materials:null,loading:false,
  artifactsError:null,materialsError:null,onRetry:()=>{},pendingMaterialsCount:0,planTodos:null,isRunning:false,runPhaseLabel:null,runStartedAt:null,
};
function Workspace({ members = false, scope = "a" }: {members?:boolean;scope?:string}) {
  const [open,setOpen] = React.useState(false);
  return <><textarea aria-label="chat draft" defaultValue="保留聊天输入" /><ChatTaskInspector {...base} showKnowledge hostPanel={{scope,title:"成果与资料",open,onOpenChange:setOpen,content:<div data-testid="learning-form"><label>本组问题<input defaultValue={`问题 ${scope}`} /></label></div>}} />{members&&<ProjectMemberChatLauncher />}</>;
}
beforeEach(() => {
  mocks.mobile=false;mocks.request.mockResolvedValue([{id:"group-a",name:"小组 A",kind:"general",status:"active",readOnlyReason:null,tags:[]}]);
  vi.stubGlobal("matchMedia",()=>({matches:mocks.mobile,addEventListener:()=>{},removeEventListener:()=>{}}));
});
afterEach(()=>vi.unstubAllGlobals());
it("shares one resizable Inspector and keeps Chat input mounted across tools, native tabs and closure",()=>{
  render(<Workspace />);const input=screen.getByLabelText("chat draft");
  expect(screen.queryByTestId("learning-form")).toBeNull();
  fireEvent.click(screen.getByTestId("chat-task-workbench-host-open"));
  expect(screen.getAllByTestId("chat-task-workbench-inspector")).toHaveLength(1);
  expect(screen.getByTestId("learning-form")).toBeVisible();
  fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-tab-materials"));
  expect(screen.queryByTestId("learning-form")).toBeNull();
  expect(screen.getByRole("tabpanel")).toBeVisible();
  fireEvent.click(screen.getByTestId("chat-task-workbench-host-open"));
  fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-collapse"));
  expect(screen.getByTestId("chat-task-workbench-host-open")).toHaveFocus();
  expect(screen.getByLabelText("chat draft")).toBe(input);expect(input).toHaveValue("保留聊天输入");
});
it.each(["result","file","knowledge"] as const)("hands an open learning panel back to native %s events",async kind=>{
  render(<Workspace />);fireEvent.click(screen.getByTestId("chat-task-workbench-host-open"));
  await act(async()=>{
    if(kind==="result") requestOpenInRightPanel({id:"result-a",title:"检索结果",text:"真实原生结果面板",url:null});
    else if(kind==="file") requestOpenFileInRightPanel({id:"file-a",title:"原型图片",threadId:"t-1",attachmentId:"attachment-a",mime:"image/png"});
    else requestOpenKnowledgePanel();
  });
  expect(screen.queryByTestId("learning-form")).toBeNull();
  expect(screen.getByTestId("chat-task-workbench-inspector")).toHaveAttribute("data-active-tab",kind==="knowledge"?"memory":"artifacts");
  expect(screen.getByRole("tabpanel")).toBeVisible();
});
it("lets the real member launcher own mobile Escape without closing learning tools or losing drafts",async()=>{
  mocks.mobile=true;render(<Workspace members />);
  fireEvent.click(screen.getByTestId("chat-task-workbench-mobile-open"));
  fireEvent.click(screen.getByTestId("chat-task-workbench-host-open"));
  const question=screen.getByLabelText("本组问题");
  fireEvent.click(screen.getByTestId("global-member-chat-open"));
  const member=await screen.findByLabelText("member draft");member.focus();fireEvent.change(member,{target:{value:"小组成员尚未发送"}});
  fireEvent.keyDown(member,{key:"Escape",keyCode:229,isComposing:false});
  expect(screen.getByTestId("global-member-chat-panel")).toBeVisible();
  fireEvent.keyDown(member,{key:"Escape"});
  expect(screen.getByTestId("global-member-chat-panel")).not.toBeVisible();
  expect(screen.getByTestId("learning-form")).toBeVisible();
  question.focus();fireEvent.keyDown(question,{key:"Escape",keyCode:229,isComposing:false});
  expect(screen.getByTestId("learning-form")).toBeVisible();
  fireEvent.keyDown(question,{key:"Escape"});
  expect(screen.queryByTestId("learning-form")).toBeNull();
  expect(screen.getByTestId("chat-task-workbench-mobile-open")).toHaveFocus();
  fireEvent.click(screen.getByTestId("global-member-chat-open"));expect(screen.getByLabelText("member draft")).toHaveValue("小组成员尚未发送");
  expect(screen.getByLabelText("chat draft")).toHaveValue("保留聊天输入");
});
