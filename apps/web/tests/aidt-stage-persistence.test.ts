import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { GetThreadOut, GetThreadArtifactSourceOut, LandAsArtifactInput, ListThreadArtifactsOut } from "@/lib/live-chat";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { AidtPersonalCheckpointError, loadAidtPersonalStageCheckpoints, saveAidtPersonalStageCheckpoint, type AidtPersonalStageSaveInput } from "@/features/aidt/lib/aidt-stage-persistence";

const mocks = vi.hoisted(() => ({ get: vi.fn(), source: vi.fn(), list: vi.fn(), land: vi.fn(), api: vi.fn(), enabled: true }));
vi.mock("@/lib/live-chat", () => ({ getThread: mocks.get, getThreadArtifactSource: mocks.source, listThreadArtifacts: mocks.list, landAsArtifact: mocks.land }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/lib/api-client", async original => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: mocks.api }));
const scope = () => ({ orgId: "o", userId: "u", projectId: "p", sessionToken: "captured-token" });
const input = (overrides: Partial<AidtPersonalStageSaveInput> = {}): AidtPersonalStageSaveInput => ({ threadId: "t", messageId: "m", stageId: 2, operationId: "op", expectedHead: null, draft: { ...emptyAidtUiDrafts()[2]!, fields: { guide: "学生原稿" } }, ...overrides });
const thread = (): GetThreadOut => ({
  thread: { id: "t", projectId: "p", groupId: null, visibilityScope: "plenary", phase: "research", archived: false, createdBy: "u", lastActivityAt: "2026-11-15T01:00:00Z", version: 1 },
  messages: [{ id: "m", authorKind: "human", agentId: null, skill: null, thinkingSummary: null, badges: [], citations: [], toolCallSummary: null, card: "学生自己的研究讨论" }], rightTabs: [], capabilities: ["composer.send"],
});
type Stored = { row: ListThreadArtifactsOut["items"][number]; source: GetThreadArtifactSourceOut };
let records = new Map<string, Stored>();
function store(threadId: string, data: LandAsArtifactInput) {
  const id = `a${records.size + 1}`;
  records.set(id, { row: { artifactId: id, title: data.title, mode: data.mode, version: null, pinnedBy: null, pinnedAt: null, hasSource: false, messageId: data.messageId }, source: { markdown: data.payloadRef, immutableRevision: "artifact-v1:1", version: null, savedAt: "2026-11-15T01:00:00Z", savedBy: "u" } });
  return { artifactId: id, mode: data.mode, versionId: null, contentHash: null, hasSource: false, provenanceBacklink: { conversationId: threadId, messageId: data.messageId, citations: [] } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled = true; records = new Map();
  mocks.get.mockResolvedValue(thread());
  mocks.api.mockResolvedValue({ projectId: "p", name: "研究", kind: "general", status: "active", currentAgendaSegment: null, roleCounts: null, backflow: [], blueprint: null });
  mocks.list.mockImplementation(async () => ({ items: Array.from(records.values(), item => structuredClone(item.row)) }));
  mocks.source.mockImplementation(async (_thread: string, artifact: string) => structuredClone(records.get(artifact)!.source));
  mocks.land.mockImplementation(async (threadId: string, data: LandAsArtifactInput) => store(threadId, data));
});
it("defaults to a hard disabled boundary with no read or write calls", async () => {
  mocks.enabled = false;
  await expect(loadAidtPersonalStageCheckpoints(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_DISABLED" });
  await expect(saveAidtPersonalStageCheckpoint(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_DISABLED" });
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.land).not.toHaveBeenCalled();
});
it.each([{ ...scope(), userId: "" }, { ...scope(), orgId: "" }, { ...scope(), sessionToken: "" }])("rejects missing identity before any network access", async badScope => {
  await expect(saveAidtPersonalStageCheckpoint(badScope, input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_INVALID" }); expect(mocks.get).not.toHaveBeenCalled();
});
it.each([0, 7, 1.5])("rejects invalid stage %s before reading", async stageId => {
  await expect(loadAidtPersonalStageCheckpoints(scope(), input({ stageId }))).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_INVALID" }); expect(mocks.get).not.toHaveBeenCalled();
});
it("saves and restores complete personal draft, discovery cards, extensions and server provenance", async () => {
  const draft = { ...input().draft, discoveryCards: [{ id: "person-a", participantCode: "A", headline: "学生概括", headlineKind: "student-summary" as const, context: "一次真实观察的学生记录", quote: "", sourceRef: "附件引用待补", photoRef: "" }], extension: { later: ["保留未知扩展", 1] } };
  const saved = await saveAidtPersonalStageCheckpoint(scope(), input({ draft }));
  expect(saved).toMatchObject({ artifactId: "a1", immutableRevision: "artifact-v1:1", visibility: "personal-draft", draft, savedBy: "u" });
  expect(mocks.land).toHaveBeenCalledWith("t", expect.objectContaining({ mode: "draft", messageId: "m" }), "captured-token");
  expect(mocks.land.mock.calls[0]![1]).not.toHaveProperty("artifactId");
  expect(JSON.stringify(mocks.land.mock.calls[0]![1])).not.toContain("captured-token");
  expect(JSON.parse(mocks.land.mock.calls[0]![1].payloadRef)).toMatchObject({ contentOrigin: "student-authored-unverified", recordKind: "working-draft-not-original-evidence" });
  expect(mocks.land.mock.calls[0]![1].title).toContain("学生填写");
  expect(mocks.api).toHaveBeenCalledWith("/projects/p/overview", expect.objectContaining({ sessionToken: "captured-token" }));
  const restored = await loadAidtPersonalStageCheckpoints(scope(), input()); expect(restored.heads).toEqual([saved]);
  expect(mocks.get).toHaveBeenCalledWith("t", "p", "captured-token"); expect(mocks.source).toHaveBeenCalledWith("t", "a1", "p", "captured-token");
});
it("retains old checkpoints and uses the actual parent revision for the next save", async () => {
  const first = await saveAidtPersonalStageCheckpoint(scope(), input());
  const second = await saveAidtPersonalStageCheckpoint(scope(), input({ operationId: "next", expectedHead: first, draft: { ...input().draft, fields: { guide: "修改后" } } }));
  const result = await loadAidtPersonalStageCheckpoints(scope(), input());
  expect(result.checkpoints).toHaveLength(2); expect(result.heads).toEqual([second]);
  expect(result.checkpoints.find(c => c.artifactId === first.artifactId)!.draft.fields.guide).toBe("学生原稿");
});
it("captures the submitted draft before awaiting and does not mutate a newer local edit", async () => {
  const gate = deferred<GetThreadOut>(); mocks.get.mockReturnValueOnce(gate.promise);
  const request = input(); const saving = saveAidtPersonalStageCheckpoint(scope(), request); request.draft.fields.guide = "保存时继续编辑的新稿";
  gate.resolve(thread()); const saved = await saving;
  expect(saved.draft.fields.guide).toBe("学生原稿"); expect(request.draft.fields.guide).toBe("保存时继续编辑的新稿");
});
it("does not turn a dependency error into an empty checkpoint list", async () => {
  mocks.list.mockRejectedValue(new Error("offline"));
  await expect(loadAidtPersonalStageCheckpoints(scope(), input())).rejects.toThrow("offline");
});
it("rejects cross-project threads before reading any artifact sources", async () => {
  const other = thread(); other.thread.projectId = "other-project"; mocks.get.mockResolvedValue(other);
  await expect(loadAidtPersonalStageCheckpoints(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_INVALID" }); expect(mocks.list).not.toHaveBeenCalled();
});
it("rejects stale head identities without writing over the prior draft", async () => {
  const first = await saveAidtPersonalStageCheckpoint(scope(), input()); mocks.land.mockClear();
  await expect(saveAidtPersonalStageCheckpoint(scope(), input({ operationId: "stale", expectedHead: null }))).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_CONFLICT", heads: [first] });
  await expect(saveAidtPersonalStageCheckpoint(scope(), input({ operationId: "wrong-revision", expectedHead: { artifactId: first.artifactId, immutableRevision: "artifact-v1:2" } }))).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_CONFLICT" });
  expect(mocks.land).not.toHaveBeenCalled(); expect(records.size).toBe(1);
});
it("blocks explicit readonly and authoritative thread/project readonly responses", async () => {
  await expect(saveAidtPersonalStageCheckpoint(scope(), input({ readOnly: true }))).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_READONLY" }); expect(mocks.get).not.toHaveBeenCalled();
  const readonly = thread(); readonly.capabilities = []; mocks.get.mockResolvedValue(readonly);
  await expect(saveAidtPersonalStageCheckpoint(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_READONLY" });
  mocks.get.mockResolvedValue(thread()); mocks.api.mockResolvedValue({ projectId: "p", name: "研究", kind: "general", status: "archived", currentAgendaSegment: null, roleCounts: null, backflow: [], blueprint: null });
  await expect(saveAidtPersonalStageCheckpoint(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_READONLY" }); expect(mocks.land).not.toHaveBeenCalled();
});
it("requires a real human message and never creates an Agent message/run", async () => {
  await expect(saveAidtPersonalStageCheckpoint(scope(), input({ messageId: "invented" }))).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_SOURCE_REQUIRED" });
  const agent = thread(); agent.messages[0]!.authorKind = "agent"; mocks.get.mockResolvedValue(agent);
  await expect(saveAidtPersonalStageCheckpoint(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_SOURCE_REQUIRED" }); expect(mocks.land).not.toHaveBeenCalled();
});
it("coalesces identical same-operation saves within this host", async () => {
  const gate = deferred<GetThreadOut>(); mocks.get.mockReturnValueOnce(gate.promise);
  const a = saveAidtPersonalStageCheckpoint(scope(), input()), b = saveAidtPersonalStageCheckpoint(scope(), input()); expect(a).toBe(b);
  gate.resolve(thread()); await a; expect(mocks.land).toHaveBeenCalledTimes(1);
});
it("refuses reuse of a pending operation identity for different student content", async () => {
  const gate = deferred<GetThreadOut>(); mocks.get.mockReturnValueOnce(gate.promise); const a = saveAidtPersonalStageCheckpoint(scope(), input());
  await expect(saveAidtPersonalStageCheckpoint(scope(), input({ draft: { ...input().draft, fields: { guide: "另一份内容" } } }))).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_INVALID" });
  gate.resolve(thread()); await a; expect(mocks.land).toHaveBeenCalledTimes(1);
});
it("keeps concurrent branches and reports a conflict instead of pretending server CAS", async () => {
  const barrier = deferred<void>(); let arrivals = 0;
  mocks.land.mockImplementation(async (threadId: string, data: LandAsArtifactInput) => { const saved = store(threadId, data); if (++arrivals === 2) barrier.resolve(); await barrier.promise; return saved; });
  const a = saveAidtPersonalStageCheckpoint(scope(), input({ operationId: "tab-a" }));
  const b = saveAidtPersonalStageCheckpoint(scope(), input({ operationId: "tab-b", draft: { ...input().draft, fields: { guide: "B保留" } } }));
  const outcomes = await Promise.allSettled([a, b]);
  expect(outcomes.every(r => r.status === "rejected" && r.reason instanceof AidtPersonalCheckpointError && r.reason.code === "AIDT_PERSONAL_CHECKPOINT_CONFLICT" && r.reason.checkpoint)).toBe(true);
  const restored = await loadAidtPersonalStageCheckpoints(scope(), input()); expect(restored.heads).toHaveLength(2); expect(restored.checkpoints.map(c => c.draft.fields.guide).sort()).toEqual(["B保留", "学生原稿"].sort());
});
it("recovers an accepted write after an unknown network result without creating another artifact", async () => {
  mocks.land.mockImplementationOnce(async (threadId: string, data: LandAsArtifactInput) => { store(threadId, data); throw new TypeError("connection lost"); });
  await expect(saveAidtPersonalStageCheckpoint(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_WRITE_UNCONFIRMED" });
  expect(await saveAidtPersonalStageCheckpoint(scope(), input())).toMatchObject({ artifactId: "a1" }); expect(mocks.land).toHaveBeenCalledTimes(1);
});
it("keeps known permission failures distinct from unknown write outcomes", async () => {
  mocks.land.mockRejectedValueOnce(new ApiError(403, "NO_WRITE_ROLE", {}));
  await expect(saveAidtPersonalStageCheckpoint(scope(), input())).rejects.toMatchObject({ status: 403, reasonCode: "NO_WRITE_ROLE" }); expect(records.size).toBe(0);
});
it("reports a saved artifact reference when readback fails, then restores it without rewriting", async () => {
  mocks.source.mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(saveAidtPersonalStageCheckpoint(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_WRITE_UNCONFIRMED", artifactId: "a1" });
  expect(await saveAidtPersonalStageCheckpoint(scope(), input())).toMatchObject({ artifactId: "a1" }); expect(mocks.land).toHaveBeenCalledTimes(1);
});
it("does not write after cancellation while reading the native thread", async () => {
  const gate = deferred<GetThreadOut>(), controller = new AbortController(); mocks.get.mockReturnValueOnce(gate.promise);
  const pending = saveAidtPersonalStageCheckpoint(scope(), input({ signal: controller.signal })); controller.abort(); gate.resolve(thread());
  await expect(pending).rejects.toMatchObject({ code: "AIDT_CONTEXT_CHANGED" }); expect(mocks.land).not.toHaveBeenCalled(); expect(mocks.api).not.toHaveBeenCalled();
});
it("treats a write finishing after cancellation as stale while preserving the persisted checkpoint", async () => {
  const gate = deferred<void>(), controller = new AbortController();
  mocks.land.mockImplementationOnce(async (threadId: string, data: LandAsArtifactInput) => { const saved = store(threadId, data); await gate.promise; return saved; });
  const pending = saveAidtPersonalStageCheckpoint(scope(), input({ signal: controller.signal })); await vi.waitFor(() => expect(mocks.land).toHaveBeenCalledTimes(1)); controller.abort(); gate.resolve();
  await expect(pending).rejects.toMatchObject({ code: "AIDT_CONTEXT_CHANGED" }); expect((await loadAidtPersonalStageCheckpoints(scope(), input())).checkpoints).toHaveLength(1);
});
it("rejects malformed discovery cards without silently stripping student fields", async () => {
  const bad = { ...input().draft, discoveryCards: [{ id: "a", headlineKind: "fake" }] };
  await expect(saveAidtPersonalStageCheckpoint(scope(), input({ draft: bad as unknown as AidtUiStageDraft }))).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_INVALID" }); expect(mocks.get).not.toHaveBeenCalled();
});
it("does not treat changed authorship, schema or landing visibility as a valid personal draft", async () => {
  await saveAidtPersonalStageCheckpoint(scope(), input()); const original = structuredClone(records.get("a1")!);
  records.get("a1")!.source.savedBy = "other-user";
  await expect(loadAidtPersonalStageCheckpoints(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_INVALID" });
  records.set("a1", structuredClone(original)); records.get("a1")!.source.markdown = "{bad-json";
  await expect(loadAidtPersonalStageCheckpoints(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_INVALID" });
  records.set("a1", structuredClone(original)); records.get("a1")!.row.mode = "pinned";
  await expect(loadAidtPersonalStageCheckpoints(scope(), input())).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_INVALID" });
});
it("preflights the actual existing endpoint byte limit and rejects non-JSON data", async () => {
  await expect(saveAidtPersonalStageCheckpoint(scope(), input({ draft: { ...input().draft, fields: { huge: "中".repeat(40000) } } }))).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_TOO_LARGE" });
  const nonJson = { ...input().draft, futureBinary: new Blob(["not a reference"]) };
  await expect(saveAidtPersonalStageCheckpoint(scope(), input({ draft: nonJson }))).rejects.toMatchObject({ code: "AIDT_PERSONAL_CHECKPOINT_INVALID" }); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.land).not.toHaveBeenCalled();
});
