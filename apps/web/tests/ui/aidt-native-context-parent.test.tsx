import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ProjectAidt } from "@/features/aidt/components/project-aidt";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({isAidtModuleEnabled:()=>true}));
const mocks = vi.hoisted(() => ({ search: "", list: vi.fn(), chat: vi.fn(), rec: vi.fn(), design: vi.fn(), resources: vi.fn(), read:vi.fn(), save:vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "org-test", userId: "student-test", sessionToken: "token-test" } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: (load: () => Promise<{ default: React.ComponentType<any> }>) => {
  const Lazy = React.lazy(async () => ({ default: await load() as unknown as React.ComponentType<any> }));
  return function Dynamic(props: any) { return <React.Suspense fallback={<p>加载中</p>}><Lazy {...props} /></React.Suspense>; };
} }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.list }));
vi.mock("@/features/aidt/components/project-aidt-chat", () => ({ ProjectAidtChat: (props: any) => { mocks.chat(props); return <div data-testid="native-chat" />; } }));
vi.mock("@/components/rec/transcription-history", () => ({ TranscriptionHistory: (props: any) => { mocks.rec(props); return <div data-testid="native-rec" />; } }));
vi.mock("@/components/design-loop/detail-screen", () => ({ DesignDetailScreen: (props: any) => { mocks.design(props); return <div data-testid="native-design" />; } }));
vi.mock("@/features/aidt/components/aidt-design-workspace", () => ({ AidtDesignWorkspace: (props: any) => { mocks.design(props); return <div data-testid="native-design" />; } }));
vi.mock("@/components/project/project-conversations", () => ({ ProjectConversations: () => <div data-testid="readonly-conversations" /> }));
vi.mock("@/components/project/project-evidence-section", () => ({ ProjectEvidenceSection: () => <div data-testid="native-evidence" /> }));
vi.mock("@/components/project/project-resource-section", () => ({
  ProjectResourceSection: (props: any) => { mocks.resources(props); return <div data-testid="native-resources" />; },
  describeProjectResourceFailure: () => "资源加载失败",
  projectResourceHref: (_kind: string, id: string, project: string) => `/studio/board/${id}?projectId=${project}`,
}));

vi.mock("@/features/aidt/lib/live-aidt-stages", async original => ({...await original<typeof import("@/features/aidt/lib/live-aidt-stages")>(),readAidtStage:mocks.read,saveAidtStage:mocks.save}));
const drafts=emptyAidtUiDrafts();
function saved(stageId:number,revision:number,fields:Record<string,string>={},sourceStageRevisions:{stageId:number;revision:number}[]=[]){return {projectId:"p",stageId,revision,content:{schemaVersion:1,draft:{...drafts[stageId]!,fields}},sourceStageRevisions,updatedBy:"student",updatedAt:"2026-11-16T00:00:00Z"};}
beforeEach(()=>{vi.clearAllMocks();mocks.search="tool=chat";mocks.list.mockResolvedValue({items:[]});});
it("actual S6 parent and shared-stage controller send the frozen S5 revision instead of its newer head",async()=>{
 const snapshot={schemaVersion:1,question:"旧轮被测问题",beforeTestBelief:"旧看法",verificationBasis:"学生记录",verificationLimits:"待真实测试",prototypeRef:"旧原型",sourceStageRevision:2};
 const fifth=saved(5,3,{verificationQuestion:"head新版问题，不应替换旧轮"}),sixth=saved(6,7,{questionSnapshot:JSON.stringify(snapshot)},[{stageId:5,revision:2}]);mocks.read.mockImplementation(async(_p,id)=>({stage:id===5?fifth:id===6?sixth:null}));
 render(<ProjectAidt projectId="p" sub="aidt-6" canWrite/>);await screen.findByTestId("native-chat");await waitFor(()=>expect(mocks.chat.mock.calls.at(-1)![0].sharedContextReady).toBe(true));
 expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).toEqual([{stageNumber:5,revision:2},{stageNumber:6,revision:7}]);expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).not.toContainEqual({stageNumber:5,revision:3});
});
it("actual S3 parent preserves confirmed discovery-card provenance instead of a newer card head",async()=>{
 const second=saved(2,4),third=saved(3,6,{surpriseStatus:"found",priorBelief:"旧猜测",surprisingFinding:"新发现",surpriseCardIds:'["card-a"]',surpriseSourceRevision:"2",surpriseConfirmed:"true"},[{stageId:2,revision:2}]);mocks.read.mockImplementation(async(_p,id)=>({stage:id===2?second:id===3?third:null}));
 render(<ProjectAidt projectId="p" sub="aidt-3" canWrite/>);await screen.findByTestId("native-chat");await waitFor(()=>expect(mocks.chat.mock.calls.at(-1)![0].sharedContextReady).toBe(true));expect(mocks.chat.mock.calls.at(-1)![0].sharedContextRefs).toEqual([{stageNumber:2,revision:2},{stageNumber:3,revision:6}]);
});
it("actual parent keeps loading and failed stage reads distinct from a confirmed empty result",async()=>{
 let fail!:(cause:Error)=>void;mocks.read.mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));render(<ProjectAidt projectId="p" sub="aidt-6" canWrite/>);await screen.findByTestId("native-chat");expect(mocks.chat.mock.calls.at(-1)![0]).toMatchObject({sharedContextReady:false,sharedContextRefs:[]});await act(async()=>fail(new Error("offline")));await screen.findByTestId("aidt-shared-chat-alert");expect(mocks.chat.mock.calls.at(-1)![0]).toMatchObject({sharedContextReady:false,sharedContextRefs:[]});
});
