import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharedStage, StageDraft } from "@repo/contracts/aidt-stages";
import { AIDT_CANDIDATE_ACTIONS } from "@repo/contracts/aidt-candidate-request";
import { AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX } from "@repo/contracts/aidt-test-research";
import { ChatHostTextActionContext } from "@/components/chat/chat-host-panel";
import { AidtDefinitionChatArtifact, AidtDefinitionOutput } from "@/features/aidt/components/aidt-definition";
import { AidtHmwCandidates } from "@/features/aidt/components/aidt-hmw-candidates";
import { useAidtDefinitionCandidateHost } from "@/features/aidt/lib/use-aidt-definition-candidate-host";
import { aidtAuthorizedDefinitionCards, loadAidtAuthorizedDefinitionEvidence } from "@/features/aidt/lib/aidt-definition-current-evidence";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { readAidtDefinition, saveAidtDefinitionPersona } from "@/features/aidt/lib/aidt-definition";
import type { AidtPersonaCandidateHost } from "@/features/aidt/lib/aidt-persona-candidates";
import { aidtEntityReportLines } from "@/features/aidt/lib/aidt-entity-report";
import { aidtUiReportMarkdown, aidtUiStageMarkdown } from "@/features/aidt/lib/aidt-ui-drafts";

const mocks = vi.hoisted(() => ({ api: vi.fn(), print: vi.fn(), session: { currentOrgId: "qa-org", userId: "qa-user", sessionToken: "qa-token" } }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.api }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session }) }));
vi.mock("@/features/aidt/lib/aidt-print-preview", () => ({ previewAidtText: mocks.print }));
const projectId = "qa-definition-project", entityId = "qa-persona";
const interviewId = "f79a50ec-dc75-4bc4-b718-b038ca6734bd";
const oldBody = "HISTORICAL_V2_ONLY_她在午休先比较口味";
const latestBody = "LATEST_V3_MUST_NOT_REPLACE_FROZEN_她现在只看排队";
const historicalCard = { id: interviewId, participantCode: "U01", headline: oldBody, headlineKind: "student-summary" as const, context: oldBody, quote: "", sourceRef: "文字记录第2行", photoRef: "" };
const latestCard = { ...historicalCard, headline: latestBody, context: latestBody };
function interviewFields(notes: boolean) {
  return { [`interviewConfirmed:${interviewId}`]: "true", [`interviewRecord:${interviewId}`]: JSON.stringify({ version: 1, id: interviewId, code: "U01", topic: "点单经历", topicRevision: 1, goal: "理解过程", original: "请说说上次点单？", adopted: "请说说最近一次点单？", guideConfirmed: true, consent: { notes, audio: false, photos: false, observedAt: "2026-11-22T06:50:00Z" } }) };
}
function stage(revision: number, notes: boolean, missing = false) {
  return SharedStage.parse({ projectId, stageId: 2, revision, updatedBy: "qa-student", updatedAt: "2026-11-22T06:50:00Z", sourceStageRevisions: [],
    content: { schemaVersion: 1, draft: { fields: missing ? {} : interviewFields(notes), ideas: [], selectedIdeaId: "", discoveryCards: [revision === 2 ? historicalCard : latestCard] } } });
}
let current = stage(3, true);
let historical = stage(2, true);
function definition() {
  const empty = emptyAidtUiDrafts()[3]!;
  return saveAidtDefinitionPersona({ ...empty, fields: { surpriseStatus: "none", surpriseConfirmed: "true" } },
    { id: entityId, name: "合成测试画像", situation: "午休点单", behavior: "比较口味", need: "辨别差异", limits: "待核对", cardIds: [interviewId], confirmed: false, archived: false }, 2);
}
function context(draft: AidtUiStageDraft) {
  return { projectId, draft, update: vi.fn(), readOnly: false, availableCards: [latestCard], availableCardsRevision: 3,
    discoveryCardFields: current.content.draft.fields, definitionRevision: 7 };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.print.mockResolvedValue("cancelled"); current = stage(3, true); historical = stage(2, true); mocks.session.userId = "qa-user"; mocks.session.sessionToken = "qa-token";
  mocks.api.mockImplementation(async (url: string) => {
    if (url.includes("/aidt/stages/2/revisions?")) return { items: [historical], nextBeforeRevision: null };
    if (url.endsWith("/aidt/stages/2/revision/2")) return { stage: historical };
    if (url.endsWith("/aidt/stages/2")) return { stage: current };
    throw new Error(`Unexpected QA request ${url}`);
  });
});
afterEach(cleanup);

it("keeps the authorized historical V2 evidence instead of substituting V3 body", async () => {
  render(<AidtDefinitionOutput {...context(definition())} entityId={entityId} />);
  expect(await screen.findByText(`U01 · ${oldBody}`)).toBeInTheDocument();
  expect(screen.queryByText(`U01 · ${latestBody}`)).toBeNull();
  expect(screen.getByRole("link", { name: "查看访谈 V2" })).toHaveAttribute("href", expect.stringContaining("entityRevision=2"));
});

it.each(["revoked", "missing"])("does not preview historical source body when current V3 authorization is %s", async mode => {
  current = stage(3, false, mode === "missing");
  render(<AidtDefinitionOutput {...context(definition())} entityId={entityId} />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalled());
  await act(async () => undefined);
  expect(screen.queryByText(`U01 · ${oldBody}`)).toBeNull();
  expect(screen.queryByText(`U01 · ${latestBody}`)).toBeNull();
});

it.each(["revoked", "missing"])("cannot confirm a persona from historical V2 when current V3 source is %s", async mode => {
  current = stage(3, false, mode === "missing");
  const save = vi.fn(); let snapshot = definition();
  const update = (mutate: (value: AidtUiStageDraft) => AidtUiStageDraft) => { snapshot = mutate(snapshot); };
  render(<AidtDefinitionChatArtifact {...context(definition())} update={update} entityId={entityId} savedDraft={definition()} requestSave={save} messages={[]} loading={false} running={false} />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalled());
  await act(async () => undefined);
  const button = screen.queryByRole("button", { name: "确认当前产物" });
  if (button) await act(async () => { fireEvent.click(button); });
  expect(readAidtDefinition(snapshot.fields).personas.find(item => item.id === entityId)?.confirmed).toBe(false);
});

function hostHarness(send: (value: string) => Promise<boolean>) {
  let host: AidtPersonaCandidateHost | null = null;
  function Harness() {
    host = useAidtDefinitionCandidateHost({ projectId, revision: 2, definitionRevision: 7, canWrite: true, messages: [], loading: false, running: false });
    return null;
  }
  const contents = () => <ChatHostTextActionContext.Provider value={{ projectId, threadId: "qa-thread", available: true, running: false, failed: false, occupied: false, sendText: send }}><Harness /></ChatHostTextActionContext.Provider>;
  const view = render(contents());
  return { getHost: () => host!, rerenderActor: () => view.rerender(contents()), ...view };
}
const request = () => ({ kind: "persona" as const, source: { orgId: "qa-org", projectId, revision: 2, definitionRevision: 7, cardIds: [interviewId] },
  cards: [historicalCard], prompt: `${AIDT_CANDIDATE_ACTIONS.persona}\n只使用已保存 V2：${oldBody}` });

it.each(["revoked", "missing"])("does not send the frozen private body after a fresh current source becomes %s", async mode => {
  current = stage(3, false, mode === "missing");
  const send = vi.fn(async (text: string) => !text); const harness = hostHarness(send);
  await act(async () => { await expect(harness.getHost().generate(request())).rejects.toThrow(); });
  expect(send).not.toHaveBeenCalled();
});

it("still sends the exact authorized historical V2 body without replacing it by V3", async () => {
  const send = vi.fn(async (text: string) => !text); const harness = hostHarness(send);
  await act(async () => { await expect(harness.getHost().generate(request())).rejects.toThrow(); });
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]![0]).toContain(oldBody);
  expect(send.mock.calls[0]![0]).not.toContain(latestBody);
});

const hmwText = "我们如何让午休点单者更清楚地比较口味？";
const hmwReply = () => ({ threadId: "qa-thread", messages: [{ id: "qa-reply", role: "assistant", content: '```aidt-definition\n' + JSON.stringify({ kind: "hmw", text: hmwText, rationale: "合成测试学生的取舍", cardIds: [interviewId], personaIds: [entityId] }) + '\n```' }] });
function confirmedPersonaDraft() {
  const draft = definition(), persona = readAidtDefinition(draft.fields).personas[0]!;
  return saveAidtDefinitionPersona(draft, { ...persona, confirmed: true }, 2);
}

it.each(["allowed", "revoked", "missing"])("rechecks current authorization at explicit HMW adoption when it is %s", async mode => {
  let snapshot = confirmedPersonaDraft();
  const host = { generate: vi.fn(async () => hmwReply()) };
  const create = vi.fn(async (_id: string, change: (value: AidtUiStageDraft) => AidtUiStageDraft) => { snapshot = change(snapshot); return true; });
  render(<AidtHmwCandidates projectId={projectId} draft={snapshot} savedDraft={snapshot} cards={[historicalCard]} revision={2} definitionRevision={7} disabled={false} host={host} onCreate={create} initialOpen />);
  fireEvent.click(screen.getByRole("checkbox", { name: "合成测试画像" }));
  fireEvent.click(screen.getByRole("checkbox", { name: `U01 · ${oldBody}` }));
  fireEvent.click(screen.getByRole("button", { name: "生成 HMW 候选" }));
  fireEvent.click(await screen.findByRole("radio", { name: hmwText }));
  if (mode !== "allowed") current = stage(3, false, mode === "missing");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "将此问题加入产物" })); });
  const hmws = readAidtDefinition(snapshot.fields).hmws;
  if (mode === "allowed") {
    expect(hmws).toHaveLength(1); expect(hmws[0]).toMatchObject({ text: hmwText, confirmed: false, cardIds: [interviewId] });
    expect(snapshot.fields.definitionEvidenceRevision).toBe("2");
  } else { expect(hmws).toEqual([]); expect(create).not.toHaveBeenCalled(); }
});

it("drops a late HMW candidate after the signed-in actor changes", async () => {
  let resolve!: (value: ReturnType<typeof hmwReply>) => void;
  const deferred = new Promise<ReturnType<typeof hmwReply>>(value => { resolve = value; });
  const host = { generate: vi.fn(() => deferred) }, draft = confirmedPersonaDraft(), create = vi.fn();
  const props = { projectId, draft, savedDraft: draft, cards: [historicalCard], revision: 2, definitionRevision: 7, disabled: false, host, onCreate: create, initialOpen: true };
  const view = render(<AidtHmwCandidates {...props} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "合成测试画像" }));
  fireEvent.click(screen.getByRole("checkbox", { name: `U01 · ${oldBody}` }));
  fireEvent.click(screen.getByRole("button", { name: "生成 HMW 候选" }));
  await waitFor(() => expect(host.generate).toHaveBeenCalledOnce());
  mocks.session.userId = "qa-other-user"; mocks.session.sessionToken = "qa-other-token";
  view.rerender(<AidtHmwCandidates {...props} />);
  await act(async () => { resolve(hmwReply()); });
  expect(screen.queryByRole("radio", { name: hmwText })).toBeNull(); expect(create).not.toHaveBeenCalled();
});

it("does not fall back to legacy card bodies after logout with a real project still mounted", async () => {
  const props = { ...context(definition()), availableCards: [historicalCard], availableCardsRevision: 2, discoveryCardFields: historical.content.draft.fields, entityId };
  const view = render(<AidtDefinitionOutput {...props} />);
  expect(await screen.findByText(`U01 · ${oldBody}`)).toBeInTheDocument();
  mocks.session.sessionToken = "";
  view.rerender(<AidtDefinitionOutput {...props} />);
  expect(screen.queryByText(`U01 · ${oldBody}`)).toBeNull();
});

it("checks current authorization again after the exact historical read resolves", async () => {
  let release!: (value: { stage: typeof historical }) => void;
  const exact = new Promise<{ stage: typeof historical }>(resolve => { release = resolve; });
  let headReads = 0;
  mocks.api.mockImplementation(async (url: string) => {
    if (url.endsWith("/aidt/stages/2")) { headReads += 1; return { stage: headReads === 1 ? stage(3, true) : stage(4, false) }; }
    if (url.endsWith("/aidt/stages/2/revision/2")) return exact;
    throw new Error(`Unexpected race request ${url}`);
  });
  const send = vi.fn(async (text: string) => !text), harness = hostHarness(send);
  const result = harness.getHost().generate(request()).catch(error => error);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(expect.stringContaining("/revision/2"), expect.anything()));
  await act(async () => { release({ stage: historical }); await result; });
  expect(await result).toBeInstanceOf(Error); expect(headReads).toBe(2); expect(send).not.toHaveBeenCalled();
});

it("drops the preflight read when the signed-in actor changes before it resolves", async () => {
  let release!: (value: { stage: typeof current }) => void;
  const firstRead = new Promise<{ stage: typeof current }>(resolve => { release = resolve; });
  const normal = mocks.api.getMockImplementation()!;
  let held = false;
  mocks.api.mockImplementation((url: string, options: unknown) => {
    if (!held && url.endsWith("/aidt/stages/2")) { held = true; return firstRead; }
    return normal(url, options);
  });
  const send = vi.fn(async (text: string) => !text), harness = hostHarness(send);
  const result = harness.getHost().generate(request()).catch(error => error);
  await waitFor(() => expect(held).toBe(true));
  mocks.session.userId = "qa-second-user"; mocks.session.sessionToken = "qa-second-token";
  harness.rerenderActor();
  await act(async () => { release({ stage: current }); await result; });
  expect(await result).toBeInstanceOf(Error); expect(send).not.toHaveBeenCalled();
});

it("rejects a supplied card body that differs from the actual frozen V2", async () => {
  const send = vi.fn(async (text: string) => !text), harness = hostHarness(send);
  await act(async () => { await expect(harness.getHost().generate({ ...request(), cards: [latestCard] })).rejects.toThrow(); });
  expect(send).not.toHaveBeenCalled();
});

it("uses current audio and photo permission without rewriting historical text", () => {
  const fields = { ...historical.content.draft.fields };
  const audioKey = `interviewMaterial:${interviewId}:audio`;
  fields[audioKey] = JSON.stringify({ projectId, runId: "qa-upload", artifactId: "qa-audio", versionId: "qa-v1", sha256: "a".repeat(64), name: "qa.wav", mime: "audio/wav", bytes: 10 });
  fields[`interviewTranscript:${interviewId}`] = JSON.stringify({ sourceKey: audioKey, text: oldBody, locator: "00:03", checked: true });
  expect(aidtAuthorizedDefinitionCards([historicalCard], fields, current.content.draft.fields)).toEqual([]);
  const currentFields = { ...current.content.draft.fields }, record = JSON.parse(currentFields[`interviewRecord:${interviewId}`]!);
  record.consent.audio = true; currentFields[`interviewRecord:${interviewId}`] = JSON.stringify(record);
  const original = { ...historicalCard, photoRef: "qa-photo", photoAttachment: { attachmentId: "qa-photo", threadId: "qa-thread", name: "qa.png" } };
  expect(aidtAuthorizedDefinitionCards([original], fields, currentFields)).toEqual([{ ...historicalCard, photoRef: "", photoAttachment: undefined }]);
  expect(original.photoRef).toBe("qa-photo"); expect(original.context).toBe(oldBody);
});

it("refuses a foreign project response instead of reusing available historical data", async () => {
  mocks.api.mockResolvedValue({ stage: { ...current, projectId: "foreign-project" } });
  await expect(loadAidtAuthorizedDefinitionEvidence({ projectId, revision: 2, sessionToken: "qa-token", cardIds: [interviewId] })).rejects.toThrow();
});

it.each(["historical", "current"])("preserves an explicit synthetic warning in the actual S3 source preview for a damaged %s marker", async location => {
  const source = location === "historical" ? historical : current;
  source.content.draft.fields[AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + interviewId] = "";
  render(<AidtDefinitionOutput {...context(definition())} entityId={entityId} />);
  expect(await screen.findByText(`U01 · ${oldBody}`)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "当前产物" })).toHaveTextContent(/合成/);
  expect(screen.getByRole("region", { name: "当前产物" })).toHaveTextContent(/不是真人|非真人|不得.*真人/);
});

it.each(["historical", "current"])("includes synthetic provenance in the actual native send for a damaged %s marker", async location => {
  const source = location === "historical" ? historical : current;
  source.content.draft.fields[AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + interviewId] = "{broken";
  const send = vi.fn(async (text: string) => !text), harness = hostHarness(send);
  await act(async () => { await expect(harness.getHost().generate(request())).rejects.toThrow(); });
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]![0]).toContain("合成");
  expect(send.mock.calls[0]![0]).toMatch(/不是真人|非真人|不得.*真人/);
});

it("preserves synthetic provenance from a chosen HMW through saved output, actual print entry and report Markdown", async () => {
  current.content.draft.fields[AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + interviewId] = "";
  let snapshot = confirmedPersonaDraft();
  const host = { generate: vi.fn(async () => ({ ...hmwReply(), syntheticCardIds: [interviewId] })) };
  const create = async (_id: string, change: (value: AidtUiStageDraft) => AidtUiStageDraft) => { snapshot = change(snapshot); return true; };
  const view = render(<AidtHmwCandidates projectId={projectId} draft={snapshot} savedDraft={snapshot} cards={[historicalCard]} revision={2} definitionRevision={7} disabled={false} host={host} onCreate={create} initialOpen />);
  fireEvent.click(screen.getByRole("checkbox", { name: "合成测试画像" }));
  fireEvent.click(screen.getByRole("checkbox", { name: `U01 · ${oldBody}` }));
  fireEvent.click(screen.getByRole("button", { name: "生成 HMW 候选" }));
  fireEvent.click(await screen.findByRole("radio", { name: hmwText }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/非真人/);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "将此问题加入产物" })); });
  const savedId = readAidtDefinition(snapshot.fields).hmws[0]?.id;
  expect(savedId).toBeTruthy();
  view.unmount();
  // A later absent marker cannot silently rewrite the persisted candidate's origin.
  delete current.content.draft.fields[AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + interviewId];
  render(<AidtDefinitionOutput {...context(snapshot)} entityId={savedId!} />);
  expect(screen.getByRole("region", { name: "当前产物" })).toHaveTextContent(/非真人/);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "打印问题" })); });
  expect(mocks.print).toHaveBeenCalledOnce();
  expect(mocks.print.mock.calls[0]![0]).toContain(hmwText);
  expect(mocks.print.mock.calls[0]![0]).toMatch(/非真人/);
  const all = emptyAidtUiDrafts(); all[3] = snapshot;
  for (const text of [aidtEntityReportLines(3, snapshot, [], projectId).join("\n"), aidtUiStageMarkdown(3, snapshot), aidtUiReportMarkdown(all)]) {
    expect(text).toContain(hmwText); expect(text).toMatch(/非真人/);
  }
});

it.each(["matching", "wrong-revision", "changed-persona"])("uses the exact current S3 persona metadata before native HMW send: %s", async mode => {
  const draft = confirmedPersonaDraft(), persona = readAidtDefinition(draft.fields).personas[0]!;
  const definitionStage = SharedStage.parse({ projectId, stageId: 3, revision: mode === "wrong-revision" ? 8 : 7, content: { schemaVersion: 1, draft }, sourceStageRevisions: [], updatedBy: "qa-user", updatedAt: "2026-11-22T07:00:00Z" });
  if (mode === "changed-persona") definitionStage.content.draft = StageDraft.parse(saveAidtDefinitionPersona(draft, { ...persona, need: "另一项完全不同的需求" }, 2));
  const normal = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((url: string, options: unknown) => url.endsWith("/aidt/stages/3") ? Promise.resolve({ stage: definitionStage }) : normal(url, options));
  const send = vi.fn(async (text: string) => !text), harness = hostHarness(send);
  const hmwRequest = { ...request(), kind: "hmw" as const, personaIds: [entityId], prompt: `${AIDT_CANDIDATE_ACTIONS.hmw}\n${JSON.stringify(persona)}\n${oldBody}` };
  await act(async () => { await expect(harness.getHost().generate(hmwRequest)).rejects.toThrow(); });
  expect(send).toHaveBeenCalledTimes(mode === "matching" ? 1 : 0);
});
