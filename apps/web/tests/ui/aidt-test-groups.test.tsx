import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AidtTestGroupDirectory } from "@/features/aidt/components/aidt-test-group-directory";
import { AidtTestGroups } from "@/features/aidt/components/aidt-test-groups";
import { readAidtTestGroups, updateAidtTestGroup, createAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { confirmAidtVerificationQuestion, createAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";
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
  return confirmAidtVerificationQuestion(updateAidtPrototypeReference({
    ...emptyAidtUiDrafts()[5]!, fields: { verificationQuestion: "能否比较口味？", beforeTestBelief: "并排更清楚" },
  }, { ...earlier, versionId }))!;
}

it("checks the requested historical entity and opens its chat only after group save", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: "新建测试草稿" }));
  await screen.findByRole("heading", { name: "午休组" });
  expect(mock.history).toHaveBeenCalledWith("project", 5, "session", { beforeRevision: 5, limit: 1 }, expect.any(AbortSignal));
  expect(readPrototypeEntity).toHaveBeenCalledWith(old, "design-a");
  expect(mock.resolve).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project", userId: "user" }), "design-a", "v1");
  expect(screen.queryByRole("link", { name: "打开测试" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存测试列表" }));
  expect(await screen.findByRole("link", { name: "打开测试" })).toHaveAttribute("href", expect.stringMatching(/^\/aidt\/project\?step=6&entity=[0-9a-f-]+$/));
});

it("keeps feedback and source links isolated to the selected test", async () => {
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
  await screen.findByRole("option", { name: "走查访谈" });
  fireEvent.change(screen.getByRole("combobox", { name: "关联项目访谈" }), { target: { value: "interview-01" } });
  expect(screen.getByRole("link", { name: "打开已关联访谈" })).toHaveAttribute("href", "/source/interview/interview-01");
  fireEvent.change(screen.getByRole("textbox", { name: "原话或问卷原始回答" }), { target: { value: "看懂了两种奶感" } });
  expect(screen.getByRole("button", { name: "引用到本轮反思" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "原件位置（时间点、答卷或批次）" }), { target: { value: "01:42" } });
  expect(screen.getByRole("button", { name: "引用到本轮反思" })).toBeEnabled();
  rerender(<Host activeEntityId={b.id} />);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "原话或问卷原始回答" })).toHaveValue(""));
  expect(screen.queryByRole("link", { name: "打开已关联访谈" })).toBeNull();
  expect(screen.getByTestId("records")).toHaveTextContent("看懂了两种奶感");
});
