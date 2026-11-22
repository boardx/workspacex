import * as React from "react";
import { setTimeout as waitForNativeCrypto } from "node:timers/promises";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharedStage } from "@repo/contracts/aidt-stages";
import { AidtTestGroupIteration } from "@/features/aidt/components/aidt-test-group-iteration";
import { createAidtTestGroup, readAidtTestGroups, updateAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import { readAidtTestGroupRound, writeAidtTestGroupRound } from "@/features/aidt/lib/aidt-test-group-round";
import { isAidtReflectionConfirmed, confirmAidtIterationPrototypeRelation } from "@/features/aidt/lib/aidt-verification-loop";
import { updateAidtIterationPrototypeReference, updateAidtIterationBasis } from "@/features/aidt/lib/aidt-prototype-reference";
import { confirmAidtPrototypeHandoff } from "@/features/aidt/lib/aidt-prototype-handoff";
import { readyFormalPrototypeFixture, storeFormalPrototypeFixture } from "../aidt-round-fixture-independent-qa";
import type { AidtQuestionSnapshot } from "@repo/contracts/aidt-return-reflection";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ session: { currentOrgId: "qa-org", userId: "qa-user", sessionToken: "qa-token" }, context: vi.fn(), read: vi.fn(), revision: vi.fn(), save: vi.fn(), request: vi.fn(), preview: vi.fn(), sources: vi.fn(), pickOld: false }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session }) }));
vi.mock("@/features/aidt/lib/aidt-test-prototype-context", () => ({ loadAidtTestResearchContext: mocks.context }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read, readAidtStageRevision: mocks.revision }));
vi.mock("@/lib/api-client", async original => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: mocks.request }));
vi.mock("@/features/aidt/lib/aidt-print-preview", () => ({ previewAidtPdf: mocks.preview }));
vi.mock("@/features/aidt/lib/aidt-prototype-text-sources", () => ({ loadAidtPrototypeTextSources: mocks.sources }));
const iterationVersion = { designId: "native-design", versionId: "prototype-v3", designName: "软件测试新原型", seq: 3, summary: "改为先比较再领取", source: "model" as const, createdAt: "2026-11-22T08:00:00Z", frameCount: 1, generatedFrameCount: 1 };
vi.mock("@/features/aidt/components/aidt-prototype-version-picker", () => ({ AidtPrototypeVersionPicker: ({ onChange, readOnly }: { onChange: (value: typeof iterationVersion) => void; readOnly?: boolean }) => <button disabled={readOnly} onClick={() => onChange(mocks.pickOld ? { ...iterationVersion, versionId: "prototype-v2", seq: 2 } : iterationVersion)}>选择软件测试新版</button> }));
const snapshot: AidtQuestionSnapshot = { schemaVersion: 1, question: "冻结问题：用户能否理解领取顺序？", beforeTestBelief: "最初仅是学生猜测", verificationBasis: "没有真人行为数据", verificationLimits: "合成软件QA", prototypeRef: "旧原型 V2", prototypeDesignId: "native-design", prototypeVersionId: "prototype-v2", sourceStageRevision: 20 };
const empty = (): AidtUiStageDraft => ({ fields: {}, ideas: [], selectedIdeaId: "" });
function group(id: string, name: string) {
  const value = { ...createAidtTestGroup(snapshot, id, "native-design")!, name, task: "理解领取过程", reflection: name + "研究反思", evidenceGap: "缺少真人测试，软件QA不作真人证据", confirmedFromMessageId: "saved-synthetic-" + name };
  return readAidtTestGroups(updateAidtTestGroup(empty(), value).fields)[0]!;
}
const a = group("11111111-1111-4111-8111-111111111111", "A"), b = group("22222222-2222-4222-8222-222222222222", "B");
const two = () => updateAidtTestGroup(updateAidtTestGroup(empty(), a), b);
const completeRound = (name: string, step = "2"): AidtUiStageDraft => ({ ...empty(), fields: { questionSnapshot: JSON.stringify(snapshot), version: snapshot.prototypeRef, understandingChangeStatus: "insufficient",
  afterTestBelief: name + "已保存认识", understandingEvidence: name + "材料", unresolvedQuestions: "需要真人测试", returnStep: step, returnReason: name + "理由", nextAction: name + "下一步", reflectionConfirmed: "true" } });
function published(draft: AidtUiStageDraft, subject = a, name = "A", revision = 31) {
  // The fifth argument is the new namespace publication pin. Reflect.apply
  // keeps this regression executable against the pre-fix four-argument build.
  return Reflect.apply(writeAidtTestGroupRound, undefined, [draft, subject, completeRound(name), true, revision]) as AidtUiStageDraft;
}
function iterationDraft() {
  let value = updateAidtIterationPrototypeReference(completeRound("A", "5"), iterationVersion);
  value = updateAidtIterationBasis(value, "iterationFeedbackReference", "合成材料A第2条：领取顺序误读");
  value = updateAidtIterationBasis(value, "iterationChangeReason", "明确先比较再领取，仍待真实测试");
  const related = confirmAidtIterationPrototypeRelation(value); if (!related.ok) throw new Error(related.reason);
  value = { ...related.draft, fields: { ...related.draft.fields, reflectionConfirmed: "true", iterationSourceStageRevision: "24" } };
  return Reflect.apply(writeAidtTestGroupRound, undefined, [two(), a, value, true, 31]) as AidtUiStageDraft;
}
function props(draft = two()) { return { projectId: "qa-project", entityId: a.id, draft, savedDraft: draft, savedRevision: 30, readOnly: false, saveDraft: mocks.save }; }
const savedStage = (draft: AidtUiStageDraft, revision: number) => SharedStage.parse({ projectId: "qa-project", stageId: 6, revision, sourceStageRevisions: [], content: { schemaVersion: 1, draft }, updatedBy: "qa-user", updatedAt: "2026-11-22T08:00:00Z" });
function stage5(version = "prototype-v3", seq = 3) {
  const value = readyFormalPrototypeFixture({ projectId: "qa-project", designId: "native-design", sourceRevision: 12,
    fields: { verificationQuestion: snapshot.question, beforeTestBelief: snapshot.beforeTestBelief, verificationBasis: snapshot.verificationBasis, verificationLimits: snapshot.verificationLimits, type: "静态图", situation: "软件QA", task: "理解领取顺序" }, reference: { ...iterationVersion, versionId: version, seq } });
  const confirmed = confirmAidtPrototypeHandoff(value.draft)!;
  expect(confirmed).toBeTruthy();
  return SharedStage.parse({ ...savedStage(empty(), 24), stageId: 5, content: { schemaVersion: 1, draft: storeFormalPrototypeFixture(empty(), "native-design", confirmed) } });
}
async function expand() {
  fireEvent.click(screen.getByText("本轮反思与迭代"));
  await screen.findByLabelText("测试后怎么看");
}
function fill(step = "2") {
  fireEvent.change(screen.getByLabelText("测试后的认识"), { target: { value: "insufficient" } });
  fireEvent.change(screen.getByLabelText("测试后怎么看"), { target: { value: "证据不足，先补研究" } });
  fireEvent.change(screen.getByLabelText("从哪一步重新入手"), { target: { value: step } });
  fireEvent.change(screen.getByLabelText("选择理由"), { target: { value: "需要更多具体经历" } });
  fireEvent.change(screen.getByLabelText("下一步行动"), { target: { value: "向不同情境对象补访" } });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.session = { currentOrgId: "qa-org", userId: "qa-user", sessionToken: "qa-token" };
  mocks.pickOld = false;
  mocks.context.mockResolvedValue({ question: snapshot, text: "已保存原型与问题" });
  mocks.save.mockResolvedValue(true);
  mocks.sources.mockImplementation(async value => ({ lineage: value.lineage, items: [], restricted: false }));
  mocks.read.mockImplementation(async (_project, stageId) => ({ stage: stageId === 5 ? stage5() : savedStage(two(), 30) }));
  mocks.revision.mockImplementation(async (_project, stageId, revision) => stageId === 5 ? { ...stage5(revision === 20 ? "prototype-v2" : "prototype-v3", revision === 20 ? 2 : 3), revision } : null);
  mocks.request.mockImplementation(async path => {
    if (path === "/projects/qa-project/resources") return { items: [{ kind: "design", id: "native-design", title: "软件测试原型", ownerUserId: "qa-user", status: null, updatedAt: "now", linkedAt: "then" }], counts: { design: 1 } };
    if (path === "/pm-designs/native-design/versions/prototype-v3") return { version: { id: "prototype-v3", seq: 3, source: "model", summary: "已保存新树", frames: ["新页面"], notes: ["测试说明"], createdAt: "2026-11-22T08:00:00Z", prototype: [{ type: "text", props: { content: "新原型V3真实快照树" } }], links: [[]] } };
    throw new Error("Unexpected read " + path);
  });
});
afterEach(() => vi.useRealTimers());
it("opening, editing and cancelling remains local and makes no save or model request", async () => {
  render(<AidtTestGroupIteration {...props()} />); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  await expand(); expect(screen.getByText(snapshot.question)).toBeVisible(); fill();
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(mocks.save).not.toHaveBeenCalled();
});
it("keeps A's unsaved input when only the shared head and B's learning change", async () => {
  const original = published(two()); const view = render(<AidtTestGroupIteration {...props(original)} savedRevision={31} />);
  await expand(); fireEvent.change(screen.getByLabelText("测试后怎么看"), { target: { value: "A尚未保存的本地认识" } });
  expect(screen.getByLabelText("测试后怎么看")).toHaveValue("A尚未保存的本地认识");
  const newHead = published(original, b, "B", 32);
  view.rerender(<AidtTestGroupIteration {...props(newHead)} savedRevision={32} />);
  expect(screen.getByLabelText("测试后怎么看")).toHaveValue("A尚未保存的本地认识"); expect(mocks.save).not.toHaveBeenCalled();
});
it("readonly users can inspect their saved round but cannot edit or save", async () => {
  render(<AidtTestGroupIteration {...props(published(two()))} savedRevision={31} readOnly />); await expand();
  expect(screen.getByLabelText("测试后怎么看")).toBeDisabled(); expect(screen.queryByRole("button", { name: "确认并保存本轮反思与迭代" })).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
});
it("does not replace a failed frozen source with a current or another group's question", async () => {
  mocks.context.mockRejectedValue(new Error("403")); render(<AidtTestGroupIteration {...props()} />);
  fireEvent.click(screen.getByText("本轮反思与迭代")); expect(await screen.findByRole("alert")).toHaveTextContent("无法读取本测试绑定的原问题");
  expect(screen.queryByLabelText("测试后怎么看")).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
});
it("drops a late source read after the actor changes", async () => {
  let finish!: (value: { question: AidtQuestionSnapshot; text: string }) => void;
  mocks.context.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<AidtTestGroupIteration {...props()} />); fireEvent.click(screen.getByText("本轮反思与迭代"));
  await waitFor(() => expect(mocks.context).toHaveBeenCalledOnce()); const signal = mocks.context.mock.calls[0]![0].signal as AbortSignal;
  mocks.session = { ...mocks.session, userId: "another", sessionToken: "new-token" }; view.rerender(<AidtTestGroupIteration {...props()} />);
  expect(signal.aborted).toBe(true); await act(async () => finish({ question: { ...snapshot, question: "前一用户私有问题" }, text: "private" }));
  expect(screen.queryByText("前一用户私有问题")).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
});
it("does not create a confirmed return link when the CAS outcome is false", async () => {
  mocks.save.mockResolvedValue(false); const original = two(); render(<AidtTestGroupIteration {...props(original)} />); await expand(); fill("2");
  fireEvent.click(screen.getByRole("button", { name: "确认并保存本轮反思与迭代" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存尚未确认"); expect(mocks.save).toHaveBeenCalledOnce();
  expect(screen.queryByRole("link", { name: /带着本轮反思/ })).toBeNull(); expect(readAidtTestGroupRound(original, a.id)).toBeNull();
});
it("confirms one entity through a real mutator CAS and exact history readback, then reloads the pinned return without a new prototype", async () => {
  let server = savedStage(two(), 30);
  const normalRevision = mocks.revision.getMockImplementation()!;
  mocks.revision.mockImplementation((project, id, revision, ...rest) => id === 6 ? Promise.resolve(revision === server.revision ? server : null) : normalRevision(project, id, revision, ...rest));
  mocks.read.mockImplementation(async (_project, stageId) => ({ stage: stageId === 6 ? server : stage5() }));
  mocks.save.mockImplementation(async (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => {
    server = savedStage(change(server.content.draft), server.revision + 1);
    return true;
  });
  const otherBefore = server.content.draft.fields["testGroup:" + b.id];
  const view = render(<AidtTestGroupIteration {...props(server.content.draft)} savedRevision={server.revision} />);
  await expand(); fill("2"); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认并保存本轮反思与迭代" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  await waitFor(() => expect(mocks.revision.mock.calls.some(([, id, revision]) => id === 6 && revision === 31)).toBe(true));
  const saved = readAidtTestGroupRound(server.content.draft, a.id)!;
  expect(isAidtReflectionConfirmed(saved)).toBe(true); expect(saved.fields.publicationRevision).toBe("31");
  expect(server.content.draft.fields["testGroup:" + b.id]).toBe(otherBefore);
  expect(server.content.draft.fields["testGroup:" + a.id]).toBe(two().fields["testGroup:" + a.id]);
  expect(saved.fields.iterationPrototypeReference).toBeUndefined();
  view.rerender(<AidtTestGroupIteration {...props(server.content.draft)} savedRevision={server.revision} />);
  expect(await screen.findByRole("link", { name: /带着本轮反思/ })).toHaveAttribute("href", expect.stringContaining("returnRevision=31"));
  expect(mocks.request.mock.calls.filter(([path]) => String(path).includes("/versions/"))).toHaveLength(0);
});
it("a per-group formatter confirms only its namespace and does not mutate the old tested prototype", () => {
  const draft = published(two()); const scoped = readAidtTestGroupRound(draft, a.id)!;
  expect(isAidtReflectionConfirmed(scoped)).toBe(true); expect(readAidtTestGroups(draft.fields).find(item => item.id === a.id)?.versionId).toBe("prototype-v2");
  expect(readAidtTestGroupRound(draft, b.id)).toBeNull();
});

it("keeps A's actual published return revision after B advances the shared head", async () => {
  const original = published(two(), a, "A", 31);
  mocks.revision.mockResolvedValue(savedStage(original, 31));
  const view = render(<AidtTestGroupIteration {...props(original)} savedRevision={31} />);
  expect(await screen.findByRole("link", { name: /带着本轮反思/ })).toHaveAttribute("href", expect.stringContaining("returnRevision=31"));
  const newHead = published(original, b, "B", 32);
  view.rerender(<AidtTestGroupIteration {...props(newHead)} savedRevision={32} />);
  expect(await screen.findByRole("link", { name: /带着本轮反思/ })).toHaveAttribute("href", expect.stringContaining("returnRevision=31"));
  expect(screen.getByRole("link", { name: /带着本轮反思/ })).toHaveAttribute("href", expect.stringContaining("returnEntity=" + a.id));
});

it("prints the actual exact V3 snapshot through the normal renderer, with A3 default rather than an old-version metadata substitute", async () => {
  const saved = iterationDraft();
  mocks.read.mockResolvedValue({ stage: savedStage(saved, 31) });
  const normal = mocks.revision.getMockImplementation()!;
  mocks.revision.mockImplementation((project, id, revision, ...rest) => id === 6 ? Promise.resolve(savedStage(saved, 31)) : normal(project, id, revision, ...rest));
  mocks.preview.mockResolvedValue(undefined);
  render(<AidtTestGroupIteration {...props(saved)} savedRevision={31} />);
  fireEvent.click(await screen.findByRole("button", { name: "预览与打印迭代原型" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  const [, title, options] = mocks.preview.mock.calls[0]!;
  expect(title).toContain("V3"); expect(options.defaultPaper).toBe("A3");
  expect(options.nativeDocuments).toHaveLength(1); expect(options.nativeDocuments[0]).toContain("新原型V3真实快照树");
  expect(mocks.request.mock.calls.some(([path]) => path === "/pm-designs/native-design/versions/prototype-v2")).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("does not print an iteration output after its bound research text authorization is revoked", async () => {
  const saved = iterationDraft();
  mocks.read.mockResolvedValue({ stage: savedStage(saved, 31) });
  const normal = mocks.revision.getMockImplementation()!;
  mocks.revision.mockImplementation((project, id, revision, ...rest) => id === 6 ? Promise.resolve(savedStage(saved, 31)) : normal(project, id, revision, ...rest));
  mocks.sources.mockImplementation(async value => ({ lineage: value.lineage, items: [], restricted: true }));
  mocks.preview.mockResolvedValue(undefined);
  render(<AidtTestGroupIteration {...props(saved)} savedRevision={31} />);
  fireEvent.click(await screen.findByRole("button", { name: "预览与打印迭代原型" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
  expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});

it("closes an open exact-snapshot preview when the periodic bound-source check loses consent", async () => {
  const saved = iterationDraft();
  mocks.read.mockResolvedValue({ stage: savedStage(saved, 31) });
  const normal = mocks.revision.getMockImplementation()!;
  mocks.revision.mockImplementation((project, id, revision, ...rest) => id === 6 ? Promise.resolve(savedStage(saved, 31)) : normal(project, id, revision, ...rest));
  let finish!: () => void;
  mocks.preview.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<AidtTestGroupIteration {...props(saved)} savedRevision={31} />);
  const button = await screen.findByRole("button", { name: "预览与打印迭代原型" });
  vi.useFakeTimers();
  try {
    fireEvent.click(button); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.preview).toHaveBeenCalledOnce(); const options = mocks.preview.mock.calls[0]![2]; expect(options.isCurrent()).toBe(true);
    mocks.sources.mockImplementation(async value => ({ lineage: value.lineage, items: [], restricted: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
      // Advancing browser timers does not complete native WebCrypto. Await the
      // existing poll's observable result; do not manufacture another poll.
      for (let attempt = 0; attempt < 100 && options.isCurrent(); attempt++) await waitForNativeCrypto(5);
    });
    expect(options.isCurrent()).toBe(false); expect(mocks.save).not.toHaveBeenCalled();
  } finally { if (finish) await act(async () => finish()); vi.useRealTimers(); }
});

it("selects a genuinely confirmed new native version, relates its feedback, and saves a distinct frozen S5 iteration pin", async () => {
  let server = savedStage(two(), 30);
  const normal = mocks.revision.getMockImplementation()!;
  mocks.revision.mockImplementation((project, id, revision, ...rest) => id === 6 ? Promise.resolve(revision === server.revision ? server : null) : normal(project, id, revision, ...rest));
  mocks.read.mockImplementation(async (_project, id) => ({ stage: id === 6 ? server : stage5() }));
  mocks.save.mockImplementation(async change => { server = savedStage(change(server.content.draft), 31); return true; });
  const view = render(<AidtTestGroupIteration {...props(server.content.draft)} savedRevision={30} />);
  await expand(); fill("5"); fireEvent.click(screen.getByText("已有新版？关联迭代产出"));
  fireEvent.click(screen.getByRole("button", { name: "选择软件测试新版" }));
  fireEvent.change(screen.getByLabelText("本次修改依据的反馈或未解问题引用"), { target: { value: "合成材料A误读顺序" } });
  fireEvent.change(screen.getByLabelText("相对旧版改了什么，为什么？"), { target: { value: "说明先比较再领取，仍待真人测试" } });
  fireEvent.click(screen.getByRole("button", { name: "确认关联本次产出、旧版与反馈" }));
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认并保存本轮反思与迭代" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  await waitFor(() => expect(mocks.revision.mock.calls.some(([, id, revision]) => id === 6 && revision === 31)).toBe(true));
  const round = readAidtTestGroupRound(server.content.draft, a.id)!;
  expect(round.fields.iterationSourceStageRevision).toBe("24");
  expect(JSON.parse(round.fields.iterationPrototypeReference!).versionId).toBe("prototype-v3");
  expect(JSON.parse(round.fields.questionSnapshot!).prototypeVersionId).toBe("prototype-v2");
  view.rerender(<AidtTestGroupIteration {...props(server.content.draft)} savedRevision={31} />);
  expect(await screen.findByRole("link", { name: /带着本轮反思/ })).toHaveAttribute("href", expect.stringContaining("step=5"));
  expect(screen.getByRole("link", { name: /带着本轮反思/ })).toHaveAttribute("href", expect.stringContaining("entity=native-design"));
});

it("cannot pass the old tested version off as a new iteration output", async () => {
  mocks.pickOld = true;
  render(<AidtTestGroupIteration {...props()} />); await expand(); fill("5"); fireEvent.click(screen.getByText("已有新版？关联迭代产出"));
  fireEvent.click(screen.getByRole("button", { name: "选择软件测试新版" }));
  fireEvent.change(screen.getByLabelText("本次修改依据的反馈或未解问题引用"), { target: { value: "合成材料" } });
  fireEvent.change(screen.getByLabelText("相对旧版改了什么，为什么？"), { target: { value: "尚未产生新版" } });
  expect(screen.getByRole("button", { name: "确认关联本次产出、旧版与反馈" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "确认并保存本轮反思与迭代" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("新的原型"); expect(mocks.save).not.toHaveBeenCalled();
});

it("normal directory rename keeps the exact published learning and historical return link after reopen", async () => {
  const original = published(two());
  original.fields[`testRound:${a.id}:testSourceSignature`] = JSON.stringify(a);
  const renamed = updateAidtTestGroup(original, { ...a, name: "重命名后的 A" });
  mocks.revision.mockResolvedValue(savedStage(original, 31));
  render(<AidtTestGroupIteration {...props(renamed)} savedRevision={32} />);
  await expand();
  expect(screen.getByLabelText("测试后怎么看")).toHaveValue("A已保存认识");
  expect(await screen.findByRole("link", { name: /带着本轮反思/ })).toHaveAttribute("href", expect.stringContaining("returnRevision=31"));
  expect(mocks.save).not.toHaveBeenCalled();
});
it("normal directory rename preserves unsaved local learning without stale-source or automatic writes", async () => {
  const original = published(two());
  const view = render(<AidtTestGroupIteration {...props(original)} savedRevision={31} />);
  await expand();
  fireEvent.change(screen.getByLabelText("测试后怎么看"), { target: { value: "改名期间仍未保存的认识" } });
  const renamed = updateAidtTestGroup(original, { ...a, name: "新的显示名" });
  view.rerender(<AidtTestGroupIteration {...props(renamed)} savedRevision={32} />);
  expect(screen.getByLabelText("测试后怎么看")).toHaveValue("改名期间仍未保存的认识");
  expect(screen.queryByRole("button", { name: "读取本测试的已保存版本" })).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});
