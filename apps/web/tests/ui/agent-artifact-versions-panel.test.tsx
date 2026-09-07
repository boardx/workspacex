import * as React from "react";
import { Blob } from "node:buffer";
import { act,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,describe,expect,it,vi } from "vitest";
import { AgentArtifactVersionsPanel } from "@/components/chat/workbench/agent-artifact-versions-panel";
import { continueAgentArtifact,fetchArtifactContent,listAgentArtifacts,type AgentArtifact } from "@/lib/chat-workbench/agent-artifacts";
import { getAgentRun } from "@/lib/agent-run";
vi.mock("@/lib/chat-workbench/agent-artifacts",async importOriginal=>({
  ...await importOriginal<typeof import("@/lib/chat-workbench/agent-artifacts")>(),
  listAgentArtifacts:vi.fn(),continueAgentArtifact:vi.fn(),fetchArtifactContent:vi.fn(),
}));
vi.mock("@/lib/agent-run",()=>({getAgentRun:vi.fn(),isTerminalRunStatus:(status:string)=>["succeeded","failed","cancelled"].includes(status)}));
vi.mock("@/components/ui/select",()=>({Select:(props:{value:string;options:{value:string;label:string}[];onValueChange:(value:string)=>void;"data-testid":string})=>
  <select data-testid={props["data-testid"]} value={props.value} onChange={event=>props.onValueChange(event.target.value)}>{props.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>}));
const artifact:AgentArtifact={artifactId:"artifact-a",threadId:"thread-a",name:"report.md",kind:"other",versions:[1,2].map(version=>({
  version,producedByRunId:`source-${version}`,producedByStepId:"step",createdAt:"2026-09-07T00:00:00Z",sizeBytes:6,changeNote:`change ${version}`,
  contentUrl:`/artifacts/artifact-a/versions/${version}/content`,basedOnVersion:version===2?1:null,
}))};
beforeEach(()=>{
  vi.clearAllMocks();
  Object.defineProperty(URL,"createObjectURL",{configurable:true,value:vi.fn(()=>"blob:test")});
  Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:vi.fn()});
  vi.mocked(listAgentArtifacts).mockResolvedValue([artifact]);
  vi.mocked(fetchArtifactContent).mockResolvedValue(new Blob(["a\nnew\nc"]) as unknown as globalThis.Blob);
  vi.mocked(getAgentRun).mockResolvedValue({status:"succeeded"} as Awaited<ReturnType<typeof getAgentRun>>);
});
describe("artifact version actions",()=>{
  it("has an honest empty state",async()=>{
    vi.mocked(listAgentArtifacts).mockResolvedValue([]);render(<AgentArtifactVersionsPanel threadId="thread-a"/>);
    expect(await screen.findByTestId("empty")).toHaveTextContent("任务生成的文件");
    expect(screen.queryByTestId("artifact-continue")).toBeNull();
  });
  it("pins the selected old version and reuses request id after an uncertain failure",async()=>{
    const started=vi.fn();vi.mocked(continueAgentArtifact).mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({runId:"edit-run",artifactId:"artifact-a"});
    render(<AgentArtifactVersionsPanel threadId="thread-a" canEdit sessionToken="token" onRunStarted={started}/>);
    fireEvent.change(await screen.findByTestId("artifact-version-picker"),{target:{value:"1"}});
    fireEvent.change(screen.getByTestId("artifact-edit-instruction"),{target:{value:"edit old version"}});
    fireEvent.click(screen.getByTestId("artifact-continue"));
    expect(await screen.findByText("修改请求未确认，请重试。重试不会重复创建任务。")).toBeVisible();
    fireEvent.click(screen.getByTestId("artifact-continue"));
    await waitFor(()=>expect(started).toHaveBeenCalledWith("edit-run"));
    const calls=vi.mocked(continueAgentArtifact).mock.calls;
    expect(calls[0]?.slice(0,3)).toEqual(["artifact-a",1,"edit old version"]);
    expect(calls[0]?.[3]).toBe(calls[1]?.[3]);
    await waitFor(()=>expect(listAgentArtifacts).toHaveBeenCalledTimes(2));
  });
  it("hides editing for read-only viewers",async()=>{
    render(<AgentArtifactVersionsPanel threadId="thread-a"/>);
    await screen.findByTestId("artifact-version-picker");
    expect(screen.queryByTestId("artifact-edit-instruction")).toBeNull();
  });
  it("discards a late response from the previous thread",async()=>{
    let complete!:(value:AgentArtifact[])=>void;
    vi.mocked(listAgentArtifacts).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockResolvedValueOnce([]);
    const view=render(<AgentArtifactVersionsPanel threadId="thread-a"/>);
    view.rerender(<AgentArtifactVersionsPanel threadId="thread-b"/>);
    await screen.findByTestId("empty");
    await act(async()=>{complete([artifact]);});
    expect(screen.queryByTestId("artifact-version-picker")).toBeNull();
  });
  it("compares actual text bytes instead of inventing a binary diff",async()=>{
    vi.mocked(fetchArtifactContent).mockImplementation(async(_id,version)=>new Blob([version===1?"a\nold\nc":"a\nnew\nc"]) as unknown as globalThis.Blob);
    render(<AgentArtifactVersionsPanel threadId="thread-a"/>);
    await screen.findByText("a new c",{exact:false}).catch(()=>undefined);
    fireEvent.click(await screen.findByText("与版本 1 比较"));
    const diff=await screen.findByTestId("artifact-text-diff");
    expect(diff).toHaveTextContent("− old");expect(diff).toHaveTextContent("+ new");
  });
});
