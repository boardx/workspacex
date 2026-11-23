import * as React from "react";
import { createHash } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { AidtTestPrototypeSource } from "@/features/aidt/components/aidt-test-prototype-source";
import { AidtSavedTextPrint } from "@/features/aidt/components/aidt-saved-text-print";
import { readyFormalPrototypeFixture, storeFormalPrototypeFixture } from "../aidt-round-fixture-independent-qa";
import { editAidtPrototypeText, confirmAidtPrototypeText, readAidtPrototypeTextConfirmation, readAidtPrototypeTextOutputBindings, bindAidtPrototypeTextOutput } from "@/features/aidt/lib/aidt-prototype-text-state";
import { readAidtPrototypeEntityDraft } from "@/features/aidt/lib/aidt-prototype-handoff";
import { updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
import { createAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";
import { createAidtTestGroup, type AidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ api: vi.fn(), preview: vi.fn(), user: "student-a", token: "token-a" }));
vi.mock("@/lib/api-client", async original => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: mocks.api }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { userId: mocks.user, sessionToken: mocks.token, currentOrgId: "qa-org" } }) }));
vi.mock("@/components/design-loop/prototype-canvas", () => ({ PrototypeCanvas: ({ root }: { root: unknown }) => <pre data-testid="actual-native-tree">{JSON.stringify(root)}</pre> }));
vi.mock("@/features/aidt/lib/aidt-print-preview", () => ({ previewAidtText: mocks.preview }));
const projectId = "qa-project", designId = "qa-design";
const context = () => ({ projectId, userId: mocks.user, sessionToken: mocks.token });
const empty = (): AidtUiStageDraft => ({ fields: {}, ideas: [], selectedIdeaId: "" });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const reference = (versionId: string, seq: number) => ({ designId, versionId, seq, designName: "合成服务原型", createdAt: "2026-11-22T06:00:00Z", summary: "有限静态流程", frameCount: 1, generatedFrameCount: 1, source: "user" as const });
let historical: AidtSharedStage, currentV3: AidtSharedStage, group: AidtTestGroup;
function saved(value: AidtUiStageDraft, revision: number): AidtSharedStage {
  return { projectId, stageId: 5, revision, sourceStageRevisions: [{ stageId: 4, revision: 12 }], updatedBy: "qa-student", updatedAt: "2026-11-22T06:00:00Z",
    content: { schemaVersion: 1, draft: StageDraft.parse(storeFormalPrototypeFixture(empty(), designId, value)) } };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.user = "student-a"; mocks.token = "token-a";
  const v1 = readyFormalPrototypeFixture({ projectId, designId, sourceRevision: 12, fields: { verificationQuestion: "V2 用户能否理解试饮量？", beforeTestBelief: "先前认为会理解", verificationBasis: "尚无行为证据", verificationLimits: "只验证理解", type: "服务图", situation: "午休", task: "指出试饮量" }, reference: reference("native-v1", 1) }).draft;
  const v2Text = confirmAidtPrototypeText(editAidtPrototypeText(v1, "V2 正式设计：三口试饮，明确小杯容量。", "text-v2"), projectId, designId, 20)!;
  const basis = readAidtPrototypeTextConfirmation(v2Text)!;
  const v2 = bindAidtPrototypeTextOutput(updateAidtPrototypeReference(v2Text, reference("native-v2", 2)), projectId, designId, "native-v2", basis, {
    kind: "native", bindingMethod: "student-selected-native-version", boundBy: "qa-student", boundAt: "2026-11-22T06:00:00Z", textSha256: hash(basis.text), lineageSha256: hash(basis.lineage),
  });
  historical = saved(v2, 22); currentV3 = saved(editAidtPrototypeText(v2, "V3 尚未确认：改成免费整杯，移除容量说明。", "text-v3"), 30);
  const snapshot = createAidtQuestionSnapshot(v2, 22); if (!snapshot.ok) throw new Error(snapshot.reason);
  group = createAidtTestGroup(snapshot.snapshot, "15c7b5e2-9d0e-4b10-bc47-000000000001", designId)!;
  mocks.preview.mockResolvedValue("cancelled");
  mocks.api.mockImplementation(async (path: string) => {
    if (path === `/projects/${projectId}/aidt/stages/5/revisions?limit=1&beforeRevision=23`) return { items: [historical], nextBeforeRevision: null };
    if (path === `/projects/${projectId}/aidt/stages/5`) throw new Error("CURRENT_V3_MUST_NOT_REPLACE_HISTORY");
    if (path === `/projects/${projectId}/resources`) return { items: [{ kind: "design", id: designId, title: "合成服务原型", ownerUserId: "qa-student", status: "draft", updatedAt: "2026-11-22T06:00:00Z", linkedAt: "2026-11-22T06:00:00Z" }], counts: { design: 1 } };
    if (path === `/pm-designs/${designId}/versions/native-v2`) return { version: { id: "native-v2", seq: 2, source: "user", summary: "V2 合成实际快照", frames: ["试饮流程"], notes: ["仅核对理解"], createdAt: "2026-11-22T06:00:00Z", links: [[]], prototype: [{ type: "text", props: { content: "V2 原型内容" } }] } };
    throw new Error(`UNEXPECTED_API_${path}`);
  });
});
afterEach(cleanup);
const show = (open = false) => render(<AidtTestPrototypeSource group={group} context={context()} showQuestion initiallyOpen={open} />);

it("uses the strict default entity reader, frozen S5 revision and actual native version to link V2 while V3 exists", async () => {
  show(true);
  expect(await screen.findByRole("link", { name: "查看文字设计 V20" })).toHaveAttribute("href", `/aidt/${projectId}?step=5&entity=${designId}&textRevision=20`);
  expect(await screen.findByTestId("actual-native-tree")).toHaveTextContent("V2 原型内容");
  expect(screen.getByText("V2 用户能否理解试饮量？")).toBeVisible();
  expect(screen.queryByText(/V3 尚未确认/)).toBeNull();
  expect(mocks.api).toHaveBeenCalledWith(`/projects/${projectId}/aidt/stages/5/revisions?limit=1&beforeRevision=23`, expect.objectContaining({ sessionToken: "token-a" }));
  expect(mocks.api.mock.calls.some(([path]) => path === `/projects/${projectId}/aidt/stages/5`)).toBe(false);
  expect(currentV3.content.draft.fields[`prototypeText:${designId}:prototypeTextVersion`]).toBe("text-v3");
});

it("finds the same native version's retained binding instead of using a different latest binding", async () => {
  const entity = readAidtPrototypeEntityDraft(historical.content.draft, designId)!;
  const old = readAidtPrototypeTextOutputBindings(entity).find(binding => binding.versionId === "native-v1")!;
  entity.fields.prototypeTextOutputBinding = JSON.stringify(old);
  historical = saved(entity, 22);
  show();
  expect(await screen.findByRole("link", { name: "查看文字设计 V20" })).toHaveAttribute("href", expect.stringContaining("textRevision=20"));
  expect(screen.queryByRole("link", { name: "查看文字设计 V1" })).toBeNull();
});

it.each(["wrong-native", "wrong-project", "future-text-version", "wrong-entity"] as const)("does not invent a text backlink for %s", async fault => {
  const entity = readAidtPrototypeEntityDraft(historical.content.draft, designId)!;
  const bindings = readAidtPrototypeTextOutputBindings(entity).map(binding => binding.versionId !== "native-v2" ? binding : {
    ...binding, ...(fault === "wrong-native" ? { versionId: "other-native" } : fault === "wrong-project" ? { projectId: "foreign-project" } : fault === "future-text-version" ? { textStageRevision: 23 } : { designId: "another-design" }),
  });
  entity.fields.prototypeTextOutputBindings = JSON.stringify(bindings); entity.fields.prototypeTextOutputBinding = JSON.stringify(bindings[1]); historical = saved(entity, 22);
  show(); await screen.findByText("V2 用户能否理解试饮量？");
  expect(screen.queryByRole("link", { name: /查看文字设计/ })).toBeNull();
});

it("shows a legacy old question without fabricating a text-design link when no binding was saved", async () => {
  const entity = readAidtPrototypeEntityDraft(historical.content.draft, designId)!;
  delete entity.fields.prototypeTextOutputBinding; delete entity.fields.prototypeTextOutputBindings; historical = saved(entity, 22);
  show(); expect(await screen.findByText("V2 用户能否理解试饮量？")).toBeVisible();
  expect(screen.queryByRole("link", { name: /查看文字设计/ })).toBeNull();
});

it("ignores a late history response from a previous actor and does not leave its old text link visible", async () => {
  let finish!: (value: unknown) => void;
  mocks.api.mockImplementation((path: string, options: { sessionToken: string }) => {
    expect(path).toBe(`/projects/${projectId}/aidt/stages/5/revisions?limit=1&beforeRevision=23`);
    return options.sessionToken === "token-a" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ items: [], nextBeforeRevision: null });
  });
  const view = show(); mocks.user = "student-b"; mocks.token = "token-b";
  view.rerender(<AidtTestPrototypeSource group={group} context={context()} showQuestion />);
  await screen.findByRole("alert");
  await act(async () => finish({ items: [historical], nextBeforeRevision: null }));
  expect(screen.queryByRole("link", { name: /查看文字设计/ })).toBeNull();
  expect(mocks.api.mock.calls.map(([, options]) => options.sessionToken)).toEqual(["token-a", "token-b"]);
  expect(mocks.api.mock.calls[0]![1].signal.aborted).toBe(true);
});

it("removes an already-visible old actor link immediately while the next actor's history is loading", async () => {
  const view = show(); await screen.findByRole("link", { name: "查看文字设计 V20" });
  let finish!: (value: unknown) => void; mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mocks.user = "student-b"; mocks.token = "token-b"; view.rerender(<AidtTestPrototypeSource group={group} context={context()} showQuestion />);
  expect(screen.queryByRole("link", { name: /查看文字设计/ })).toBeNull();
  await act(async () => finish({ items: [], nextBeforeRevision: null }));
  expect(screen.queryByRole("link", { name: /查看文字设计/ })).toBeNull();
});

const question: AidtUiStageDraft = { fields: { verificationQuestion: "两个实体恰好有同样文字", verificationQuestionConfirmed: "true" }, ideas: [], selectedIdeaId: "" };
const selectQuestion = (value: AidtUiStageDraft) => value.fields.verificationQuestionConfirmed === "true" ? value.fields.verificationQuestion || null : null;
function QuestionPrint({ id }: { id: string }) {
  return <AidtSavedTextPrint projectId={projectId} stageId={5} label="打印验证问题卡" artifactKey={id} draft={question} selectText={selectQuestion} selectSavedDraft={value => readAidtPrototypeEntityDraft(value, id)} />;
}
it("does not print a sibling entity with identical text when the requested entity is absent", async () => {
  mocks.api.mockResolvedValue({ stage: { ...historical, content: { schemaVersion: 1, draft: { ...empty(), fields: { "prototypeEntity:B": JSON.stringify(question.fields) } } } } });
  render(<QuestionPrint id="A" />); fireEvent.click(screen.getByRole("button", { name: "打印验证问题卡" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("请先保存并确认"); expect(mocks.preview).not.toHaveBeenCalled();
});

it("invalidates the previous artifact scope even when its actor and printable text are unchanged", async () => {
  const same = { ...empty(), fields: { "prototypeEntity:A": JSON.stringify(question.fields), "prototypeEntity:B": JSON.stringify(question.fields) } };
  mocks.api.mockResolvedValue({ stage: { ...historical, content: { schemaVersion: 1, draft: same } } });
  const view = render(<QuestionPrint id="A" />); fireEvent.click(screen.getByRole("button", { name: "打印验证问题卡" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  const priorIsCurrent = mocks.preview.mock.calls[0]![2].isCurrent; expect(priorIsCurrent()).toBe(true);
  view.rerender(<QuestionPrint id="B" />); expect(priorIsCurrent()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "打印验证问题卡" })); await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2));
  expect(mocks.preview.mock.calls[1]![2].isCurrent()).toBe(true);
});
