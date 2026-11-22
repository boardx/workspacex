import { StageDraft } from "@repo/contracts/aidt-stages";
import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AidtDashboard } from "@/features/aidt/components/project-aidt-dashboard";
import { useAidtConfirmedStages } from "@/features/aidt/lib/use-aidt-confirmed-stages";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { AidtTestGroupDirectory } from "@/features/aidt/components/aidt-test-group-directory";
import { AidtTestConversation, AidtTestGroupOutput } from "@/features/aidt/components/aidt-test-conversation";
import { readAidtTestProposal } from "@/features/aidt/lib/aidt-test-proposal";
import { AidtTestGroups } from "@/features/aidt/components/aidt-test-groups";
import { readAidtTestGroups, updateAidtTestGroup, createAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { confirmAidtVerificationQuestion, createAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";
import { confirmAidtPrototypeHandoff } from "@/features/aidt/lib/aidt-prototype-handoff";
import { updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";

const mock = vi.hoisted(() => ({ history: vi.fn(), resolve: vi.fn(), resources: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org", userId: "user", sessionToken: "session" } }),
}));
vi.mock("@/components/project/project-resource-section", () => ({
  startNewProjectResource: async (kind: string) => `/new/${kind}`,
  projectResourceHref: (kind: string, id: string) => `/source/${kind}/${id}`,
}));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mock.resources }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ listAidtStageHistory: mock.history }));
vi.mock("@/features/aidt/lib/aidt-prototype-versions", () => ({ resolveAidtPrototypeVersion: mock.resolve }));
vi.mock("@/features/aidt/components/aidt-research-material", () => ({
  AidtResearchMaterialControl: () => null,
  AidtResearchMaterialPreview: () => null,
}));

const earlier = { designId: "design-a", versionId: "v1", designName: "菜单", seq: 1, summary: "起点", source: "user" as const, createdAt: "2026-11-21", frameCount: 1, generatedFrameCount: 1 };
function prototype(versionId: string) {
  return confirmAidtPrototypeHandoff(confirmAidtVerificationQuestion(updateAidtPrototypeReference({
    ...emptyAidtUiDrafts()[5]!, fields: { verificationQuestion: "能否比较口味？", beforeTestBelief: "并排更清楚", verificationBasis: "之前的点单观察",
      verificationLimits: "只评估读懂标签", type: "纸质比较卡", situation: "午休点单", task: "阅读比较卡",
      prototypeIdeaSource: JSON.stringify({ revision: 2, ideaIds: ["menu"] }) },
  }, { ...earlier, versionId }))!)!;
}

it("pins the test version and preserves its Chat identity through rename and deletion", async () => {
  const old = prototype("v1"), newer = prototype("v2");
  mock.history.mockResolvedValue({ items: [{ revision: 4, content: { draft: old } }] });
  mock.resolve.mockResolvedValue(earlier);
  const readPrototypeEntity = vi.fn((draft: AidtUiStageDraft) => draft);
  function Host() {
    const [draft, update] = React.useState(emptyAidtUiDrafts()[6]!);
    const [saved, setSaved] = React.useState<AidtUiStageDraft>();
    return <AidtTestGroupDirectory projectId="project" draft={draft} savedDraft={saved} readOnly={false} canSave={draft !== saved} save={async () => setSaved(draft)}
      update={update} previousPrototype={newer} previousPrototypeRevision={7} prototypeRevision="4" prototypeEntity="design-a" readPrototypeEntity={readPrototypeEntity} />;
  }
  render(<Host />);
  fireEvent.change(screen.getByRole("textbox", { name: "测试名称" }), { target: { value: "午休组" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "确认使用所选原型的已保存版本开展本轮研究" }));
  fireEvent.change(screen.getByRole("combobox", { name: "研究路径" }), { target: { value: "offline" } });
  fireEvent.click(screen.getByRole("button", { name: "新建测试草稿" }));
  await screen.findByRole("heading", { name: "午休组" });
  expect(mock.history).toHaveBeenCalledWith("project", 5, "session", { beforeRevision: 5, limit: 1 }, expect.any(AbortSignal));
  expect(readPrototypeEntity).toHaveBeenCalledWith(old, "design-a");
  expect(mock.resolve).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project", userId: "user" }), "design-a", "v1", "linked-reader");
  expect(screen.queryByRole("link", { name: "打开测试 午休组" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存测试列表" }));
  const link = await screen.findByRole("link", { name: "打开测试 午休组" });
  const address = link.getAttribute("href");
  expect(address).toMatch(/^\/aidt\/project\?step=6&entity=[0-9a-f-]+$/);
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  const edit = within(screen.getByRole("dialog", { name: "编辑测试卡" }));
  fireEvent.change(edit.getByLabelText("测试名称"), { target: { value: "午休再测" } });
  fireEvent.click(edit.getByRole("button", { name: "保存修改" }));
  fireEvent.click(screen.getByRole("button", { name: "保存测试列表" }));
  expect(await screen.findByRole("link", { name: "打开测试 午休再测" })).toHaveAttribute("href", address);
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "删除测试卡？" })).getByRole("button", { name: "确认删除" }));
  expect(within(screen.getByRole("list", { name: "测试卡片" })).queryByRole("listitem")).toBeNull();
  expect(screen.getByText("已移除（1）")).toBeInTheDocument();
});

it("keeps feedback isolated and does not treat a project digital interview as real offline evidence", async () => {
  mock.resources.mockResolvedValue({ items: [{ kind: "interview", id: "interview-01", title: "走查访谈" }] });
  const binding = createAidtQuestionSnapshot(prototype("v1"), 4);
  if (!binding.ok) throw new Error(binding.reason);
  const a = createAidtTestGroup(binding.snapshot, "8d806f0e-516e-4a40-97f9-fcd3991df967")!;
  const b = createAidtTestGroup(binding.snapshot, "2bd72401-e9ca-4dc2-ae30-e82498bced7a")!;
  const initial = updateAidtTestGroup(updateAidtTestGroup({
    ...emptyAidtUiDrafts()[6]!, fields: { questionSnapshot: binding.serialized },
  }, { ...a, name: "午休组" }), { ...b, name: "放学组" });
  function Host({ activeEntityId }: { activeEntityId: string }) {
    const [draft, update] = React.useState(initial);
    return <><AidtTestGroups projectId="project" draft={draft} update={update} readOnly={false} activeEntityId={activeEntityId} />
      <output data-testid="records">{JSON.stringify(readAidtTestGroups(draft.fields))}</output></>;
  }
  const { rerender } = render(<Host activeEntityId={a.id} />);
  await waitFor(() => expect(mock.resources).toHaveBeenCalled());
  expect(screen.queryByRole("combobox", { name: "关联项目访谈" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "原话或问卷原始回答" }), { target: { value: "看懂了两种奶感" } });
  expect(screen.getByRole("button", { name: "引用到本轮反思" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "原件位置（时间点、答卷或批次）" }), { target: { value: "01:42" } });
  expect(screen.getByRole("button", { name: "引用到本轮反思" })).toBeDisabled();
  rerender(<Host activeEntityId={b.id} />);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "原话或问卷原始回答" })).toHaveValue(""));
  expect(screen.queryByRole("link", { name: "打开已关联访谈" })).toBeNull();
  expect(screen.getByTestId("records")).toHaveTextContent("看懂了两种奶感");
});

it("uses an explicit Chat confirmation and keeps the output free of editing fields", async () => {
  const binding = createAidtQuestionSnapshot(prototype("v1"), 4);
  if (!binding.ok) throw new Error(binding.reason);
  const group = createAidtTestGroup(binding.snapshot, "8d806f0e-516e-4a40-97f9-fcd3991df967")!;
  const initial = updateAidtTestGroup({ ...emptyAidtUiDrafts()[6]!, fields: { questionSnapshot: binding.serialized, version: binding.snapshot.prototypeRef } }, { ...group, name: "午休组" });
  const content = [
    "```aidt-test-result",
    JSON.stringify({ entityId: group.id, task: "比较两张标签", reflection: "尚需观察", evidenceGap: "尚无实际行为记录",
      round: { understandingChangeStatus: "insufficient", unresolvedQuestions: "尚无实际行为证据", returnStep: "undecided", returnReason: "请老师协助选择补访对象" } }),
    "```",
  ].join("\n");
  const messages = [{ id: "student-turn", role: "user", content: "本轮没有行为记录" }, { id: "assistant-turn", role: "assistant", content }];
  const proposal = readAidtTestProposal(messages, group.id);
  let receipt: AidtSharedStage | undefined;
  function Host({ restored }: { restored?: AidtSharedStage }) {
    const [draft, update] = React.useState(restored?.content.draft ?? initial);
    const [saved, setSaved] = React.useState<AidtSharedStage | undefined>(restored);
    const stages = React.useMemo(() => { const records: Record<number, AidtSharedStage> = {}; if (saved) records[6] = saved; return records; }, [saved]);
    const completed = useAidtConfirmedStages(stages, "project");
    return <><AidtDashboard href={id => `/aidt/project?step=${id}`} completed={completed} shared={{ phase: "ready", stages }} drafts={{ ...emptyAidtUiDrafts(), 6: draft }} />
      <AidtTestGroupOutput projectId="project" draft={draft} activeEntityId={group.id} savedDraft={saved?.content.draft} proposal={proposal} />
      <AidtTestConversation projectId="project" entityId={group.id} draft={draft} savedDraft={saved?.content.draft} readOnly={false}
        messages={messages} loading={false} running={false} update={update}
        requestSave={() => { receipt = { projectId: "project", stageId: 6, revision: (saved?.revision ?? 0) + 1, sourceStageRevisions: [{ stageId: 5, revision: 4 }], content: { schemaVersion: 1, draft: StageDraft.parse(draft) }, updatedBy: "student", updatedAt: "2026-11-21T00:00:00Z" }; setSaved(receipt); }} /></>;
  }
  const view = render(<Host />);
  const output = screen.getByTestId("aidt-test-group-detail");
  expect(output).toHaveTextContent("AI 草稿");
  expect(output).toHaveTextContent("比较两张标签");
  expect(output.querySelector("input,textarea,select")).toBeNull();
  expect(screen.queryByText(/已完成/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "确认并保存测试成果" }));
  expect(await screen.findByText("已完成 · V1")).toBeVisible();
  expect(receipt?.content.draft.fields.newVersion).toBeFalsy();
  view.unmount();
  render(<Host restored={structuredClone(receipt)} />);
  expect(await screen.findByText("已完成 · V1")).toBeVisible();
  expect(screen.queryByRole("button", { name: "确认并保存测试成果" })).toBeNull();
});
