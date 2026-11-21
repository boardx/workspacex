import * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ProjectAidt } from "@/features/aidt/components/project-aidt";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({isAidtModuleEnabled:()=>true}));
const mocks = vi.hoisted(() => ({ search: "", push: vi.fn(), list: vi.fn(), chat: vi.fn(), rec: vi.fn(), design: vi.fn(), resources: vi.fn(), read:vi.fn(), readRevision:vi.fn(), save:vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "org-test", userId: "student-test", sessionToken: "token-test" } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search), useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/dynamic", () => ({ default: (load: () => Promise<{ default: React.ComponentType<any> }>) => {
  const Lazy = React.lazy(async () => ({ default: await load() as unknown as React.ComponentType<any> }));
  return function Dynamic(props: any) { return <React.Suspense fallback={<p>加载中</p>}><Lazy {...props} /></React.Suspense>; };
} }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.list }));
vi.mock("@/features/aidt/components/project-aidt-chat", () => ({ ProjectAidtChat: (props: any) => { mocks.chat(props); return <div data-testid="native-chat">{props.hostPanel?.open && props.hostPanel.content}</div>; } }));
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

vi.mock("@/features/aidt/lib/live-aidt-stages", async original => ({...await original<typeof import("@/features/aidt/lib/live-aidt-stages")>(),readAidtStage:mocks.read,readAidtStageRevision:mocks.readRevision,saveAidtStage:mocks.save}));

import { StageDraft } from "@repo/contracts/aidt-stages";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtInterviewHandoffReady, areAidtInterviewsComplete, aidtInterviewMaterialKey, confirmAidtInterviewFinding, writeAidtInterview, writeAidtInterviewFinding, writeAidtInterviewMaterial, writeAidtInterviewTranscript } from "@/features/aidt/lib/aidt-interviews";
const projectId = "p";
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear(); mocks.search = "";
  mocks.list.mockResolvedValue({ items: [] }); mocks.readRevision.mockResolvedValue(null);
  network = vi.fn(async () => { throw new Error("UNEXPECTED_REAL_NETWORK"); });
  vi.stubGlobal("fetch", network);
});
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
function interviews(guides: number, evidence: number, count = 10): AidtUiStageDraft {
  let draft = emptyAidtUiDrafts()[2]!;
  for (let i = 1; i <= count; i++) {
    const id = `15c7b5e2-9d0e-4b10-bc47-${String(i).padStart(12,"0")}`;
    const interview = { version: 1 as const, id, code: `U${String(i).padStart(2,"0")}`, topicRevision: 1, topic: "内存合成软件夹具，非真人访谈", goal: "检验软件门控", original: "合成输入", adopted: "请说明合成事件", guideConfirmed: i <= guides, consent: { notes: true, photos: false, audio: false, observedAt: "2026-11-21T00:00:00Z" } };
    draft = writeAidtInterview(draft, interview);
    if (i <= evidence) {
      const quote = `仅为合成软件夹具的第${i}条记录，不代表真人证据。`;
      const key = aidtInterviewMaterialKey(id, "synthetic-transcript");
      draft = writeAidtInterviewFinding(draft, interview, { headlineKind: "quote", headline: quote, quote, context: "内存软件隔离测试" });
      draft = writeAidtInterviewMaterial(draft, id, key, JSON.stringify({ projectId, runId: `synthetic-${i}`, artifactId: `raw-${i}`, versionId: "v1", name: `synthetic-${i}.txt`, mime: "text/plain", sha256: "a".repeat(64), bytes: 42 }));
      draft = writeAidtInterviewTranscript(draft, id, { sourceKey: key, locator: "第1段", text: quote, checked: true });
      draft = confirmAidtInterviewFinding(draft, id, projectId);
    }
  }
  return draft;
}
async function actualParent(draft: AidtUiStageDraft, complete: boolean) {
  const second = { projectId, stageId: 2, revision: 7, sourceStageRevisions: [], content: { schemaVersion: 1, draft: StageDraft.parse(draft) }, updatedBy: "synthetic-student", updatedAt: "2026-11-21T00:00:00Z" };
  mocks.read.mockImplementation(async (_p, stageId) => ({ stage: stageId === 2 ? second : null }));
  mocks.search = "";
  const overview = render(<ProjectAidt projectId={projectId} sub={null} canWrite />);
  const mark = await screen.findByTestId("aidt-stage-save-2");
  await waitFor(() => expect(screen.queryByTestId("aidt-dashboard-confirmation-loading")).not.toBeInTheDocument());
  expect(mark).toHaveAttribute("data-completed", String(complete));
  expect(mark).toHaveTextContent(complete ? "已完成" : "草稿");
  overview.unmount();
  mocks.search = "step=2";
  render(<ProjectAidt projectId={projectId} sub="aidt-2" canWrite />);
  await screen.findByRole("region", { name: /^访谈工作区$/ });
  await waitFor(() => expect(screen.getByTestId("aidt-shared-status")).toHaveTextContent("小组已保存"));
  await act(async () => { await Promise.resolve(); });
  if (complete) expect(await screen.findByTestId("aidt-stage-next")).toHaveAttribute("href", "/aidt/p?step=3");
  else expect(screen.queryByTestId("aidt-stage-next")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /^带入综合与定义$/ })).not.toBeInTheDocument();
}
it("G1/E1 among ten active interviews: internal handoff is true, real parent has no next and dashboard is not complete", async () => {
  const draft = interviews(1, 1); expect(aidtInterviewHandoffReady(draft)).toBe(true); expect(areAidtInterviewsComplete(draft, projectId)).toBe(false); await actualParent(draft, false);
});
it("G10/E1 among ten active interviews: all guides alone cannot expose the real next step or completion", async () => {
  const draft = interviews(10, 1); expect(aidtInterviewHandoffReady(draft)).toBe(true); expect(areAidtInterviewsComplete(draft, projectId)).toBe(false); await actualParent(draft, false);
});
it("G10/E10 with all authorized, located, checked, explicitly confirmed synthetic findings enables the real next and completion", async () => {
  const draft = interviews(10, 10); expect(areAidtInterviewsComplete(draft, projectId)).toBe(true); await actualParent(draft, true);
});
it("foreign-project material blocks the real next and completion even when old confirmation flags remain", async () => {
  const draft = interviews(10, 10), key = aidtInterviewMaterialKey("15c7b5e2-9d0e-4b10-bc47-000000000010", "synthetic-transcript");
  draft.fields[key] = JSON.stringify({ ...JSON.parse(draft.fields[key]!), projectId: "foreign-project" });
  expect(areAidtInterviewsComplete(draft, projectId)).toBe(false); await actualParent(draft, false);
});
it("malformed material blocks the real next and completion without archiving incomplete interviews", async () => {
  const draft = interviews(10, 10), key = aidtInterviewMaterialKey("15c7b5e2-9d0e-4b10-bc47-000000000010", "synthetic-transcript");
  draft.fields[key] = JSON.stringify({ ...JSON.parse(draft.fields[key]!), sha256: "invalid" });
  expect(areAidtInterviewsComplete(draft, projectId)).toBe(false); await actualParent(draft, false);
});
it("zero interviews cannot complete or expose the real next", async () => {
  const draft = interviews(0, 0, 0); expect(aidtInterviewHandoffReady(draft)).toBe(null); expect(areAidtInterviewsComplete(draft, projectId)).toBe(false); await actualParent(draft, false);
});

for (const missing of ["consent", "locator", "checked", "confirmation"] as const) it(`removing ${missing} from one of ten active records blocks real next and completion`, async () => {
  const draft = interviews(10, 10), id = "15c7b5e2-9d0e-4b10-bc47-000000000010";
  if (missing === "consent") {
    const record = JSON.parse(draft.fields[`interviewRecord:${id}`]!); record.consent.notes = false;
    draft.fields[`interviewRecord:${id}`] = JSON.stringify(record);
  } else if (missing === "confirmation") draft.fields[`interviewConfirmed:${id}`] = "";
  else {
    const transcript = JSON.parse(draft.fields[`interviewTranscript:${id}`]!);
    if (missing === "locator") transcript.locator = ""; else transcript.checked = false;
    draft.fields[`interviewTranscript:${id}`] = JSON.stringify(transcript);
  }
  expect(Object.keys(draft.fields).filter(key => key.startsWith("interviewRecord:"))).toHaveLength(10);
  expect(Object.keys(draft.fields).some(key => key.startsWith("interviewArchived:"))).toBe(false);
  expect(areAidtInterviewsComplete(draft, projectId)).toBe(false); await actualParent(draft, false);
});
