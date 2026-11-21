import * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
import { ProjectMemberChatLauncher } from "@/components/project/project-member-chat-launcher";
import { requestOpenInRightPanel, requestOpenFileInRightPanel } from "@/lib/chat-workbench/panel-document";
import { requestOpenKnowledgePanel } from "@/lib/knowledge-graph-events";
import { savedAidtInterviewArtifactTitle } from "@/features/aidt/lib/aidt-interviews";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
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
function Workspace({ members = false, scope = "a", placement }: {members?:boolean;scope?:string;placement?:"artifacts"}) {
  const [open,setOpen] = React.useState(false);
  return <><textarea aria-label="chat draft" defaultValue="保留聊天输入" /><ChatTaskInspector {...base} showKnowledge hostPanel={{scope,placement,title:"成果与资料",open,onOpenChange:setOpen,content:<div data-testid="learning-form"><label>本组问题<input defaultValue={`问题 ${scope}`} /></label></div>}} />{members&&<ProjectMemberChatLauncher />}</>;
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
it("keeps the current entity output selected until the user explicitly returns to the artifact list", () => {
  render(<Workspace placement="artifacts" />);
  const tab = screen.getByRole("tab", { name: "产物" });
  fireEvent.click(tab);
  expect(screen.getByTestId("learning-form")).toBeVisible();
  fireEvent.click(tab);
  expect(screen.getByTestId("learning-form")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /产物列表/ }));
  expect(screen.queryByTestId("learning-form")).toBeNull();
  expect(tab).toHaveAttribute("aria-selected", "true");
});
it("counts a saved interview product, reopens it within the inspector, and scopes it after remount and entity change", async () => {
  const idA = "10000000-0000-4000-8000-000000000001";
  const idB = "10000000-0000-4000-8000-000000000002";
  const record = { version: 1, topicRevision: null, topic: "", goal: "", original: "", guideConfirmed: false, consent: null };
  const draft: AidtUiStageDraft = { fields: {
    ["interviewRecord:" + idA]: JSON.stringify({ ...record, id: idA, code: "U01", adopted: "实际问题清单" }),
    ["interviewRecord:" + idB]: JSON.stringify({ ...record, id: idB, code: "U02", adopted: "" }),
  }, ideas: [], selectedIdeaId: "" };
  function InterviewInspector({ id }: { id: string }) {
    const [open, setOpen] = React.useState(true);
    const title = savedAidtInterviewArtifactTitle(draft, id);
    return <ChatTaskInspector {...base} threadId={null} artifacts={{ items: [] }} hostPanel={{
      scope: id, title: "产物", placement: "artifacts", open, onOpenChange: setOpen, savedArtifactTitle: title,
      content: <p data-testid="interview-inspector-detail">{title ?? "尚无访谈产物"}</p>,
    }} />;
  }
  const back = () => fireEvent.click(screen.getByRole("button", { name: /产物列表/ }));
  const first = render(<InterviewInspector id={idA} />);
  back();
  expect(screen.getByTestId("chat-artifacts-panel-title")).toHaveTextContent("产物（1）");
  expect(screen.queryByTestId("chat-artifacts-empty")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "U01 · 访谈产物" }));
  expect(screen.getByTestId("interview-inspector-detail")).toHaveTextContent("U01 · 访谈产物");
  first.unmount();
  const refreshed = render(<InterviewInspector id={idA} />);
  back();
  expect(screen.getByRole("button", { name: "U01 · 访谈产物" })).toBeVisible();
  refreshed.rerender(<InterviewInspector key={idB} id={idB} />);
  back();
  expect(screen.getByTestId("chat-artifacts-panel-title")).toHaveTextContent("产物（0）");
  expect(screen.queryByRole("button", { name: "U01 · 访谈产物" })).toBeNull();
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
