import * as React from "react";
import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesignProject as NativeProject } from "@repo/contracts/design-workbench";
import { AidtPrototypeSourceImages as ImageBindings } from "@repo/contracts/aidt-prototype-text";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { AidtPrototypeSourceImages } from "@/features/aidt/components/aidt-prototype-source-images";
import { assertAidtSourceImageCapacity, readAidtSourceImageBytes, requireAidtNativeSourceImages, readAidtSourceImageBinding } from "@/features/aidt/lib/aidt-prototype-source-images";
import { hashAidtResearchBytes } from "@/features/aidt/lib/aidt-research-materials";
import { updateAidtPrototypeEntityDraft, readAidtPrototypeEntityDraft } from "@/features/aidt/lib/aidt-prototype-handoff";
import { editAidtPrototypeText, confirmAidtPrototypeText, readAidtPrototypeTextConfirmation, aidtPrototypeTextHashes, isAidtPrototypeTextConfirmed } from "@/features/aidt/lib/aidt-prototype-text-state";
import type { AidtDesignHandoff } from "@/features/aidt/lib/aidt-design-handoff";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
const mocks = vi.hoisted(() => ({ handoff: vi.fn(), stage: vi.fn(), save: vi.fn(), request: vi.fn(), fetch: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-design-handoff", () => ({ loadAidtDesignHandoff: mocks.handoff }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.stage, saveAidtStage: mocks.save }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => true }));
vi.mock("@/lib/api-client", async original => ({ ...await original<typeof import("@/lib/api-client")>(), apiRequest: mocks.request, apiUrl: (path: string) => "/api" + path }));
vi.mock("@/features/aidt/components/aidt-research-material", () => ({ AidtResearchMaterialPreview: ({ reference }: { reference: { artifactId: string } }) => <span>{reference.artifactId}</span> }));
const input = { projectId: "qa-project", stageId: 5, sessionToken: "synthetic-unit-token", prototypeEntityId: "native-design" };
const empty = () => ({ fields: {}, ideas: [], selectedIdeaId: "" });
let handoff: AidtDesignHandoff, native: ReturnType<typeof NativeProject.parse>, stage: AidtSharedStage;
const files = new Map<string, ArrayBuffer>();
function binding(source: NonNullable<AidtDesignHandoff["sourceImages"]>[number], id = "native-1") {
  return { sourceRunId: source.reference.runId, artifactId: source.reference.artifactId, versionId: source.reference.versionId, sha256: source.reference.sha256,
    stage4Revision: source.stage4Revision, brainstormId: source.brainstormId, nativeImageId: id,
    nativeName: `aidt-source-${source.reference.sha256}.png`, nativeSize: source.reference.bytes, nativeMime: "image/png" };
}
function stored(images: ReturnType<typeof binding>[]) {
  const value = ImageBindings.parse({ schemaVersion: 1, projectId: input.projectId, designId: native.id, textStageRevision: 20,
    textVersion: "text-v2", textSha256: "a".repeat(64), images });
  stage = { ...stage, content: { ...stage.content, draft: StageDraft.parse(updateAidtPrototypeEntityDraft(stage.content.draft, native.id,
    old => ({ ...old, fields: { ...old.fields, prototypeSourceImages: JSON.stringify(value) } }))) } };
  native = { ...native, refImages: images.map(image => ({ id: image.nativeImageId, name: image.nativeName, size: image.nativeSize, mime: "image/png", createdAt: "2026-11-22" })) };
}
function props() { return { input, handoff, project: native, disabled: false, onProjectUpdated: vi.fn() }; }
const postCalls = () => mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST");
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", mocks.fetch); files.clear();
  native = NativeProject.parse({ id: "native-design", name: "软件测试原型", template: "mobile", problem: "", criteria: [], frames: [], prototype: [], frameNotes: [],
    refImages: [], pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null, chat: [], ownerId: "qa-user", ownerName: "QA", createdAt: "2026-11-22", updatedAt: "2026-11-22" });
  // Valid RGB 1×1 PNG files, created from red/green/blue pixels (not tones or
  // arbitrary bytes masquerading as reference images).
  const pngs = ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaGAAAAEEAIFw9selAAAAAElFTkSuQmCC", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"];
  const images = await Promise.all([1, 2, 3].map(async n => {
    const bytes = Uint8Array.from(Buffer.from(pngs[n - 1]!, "base64")).buffer; files.set(`run-${n}`, bytes);
    return { ideaId: `idea-${n}`, title: `点子 ${n}`, stage4Revision: 12, brainstormId: "round-a", reference: { projectId: input.projectId, runId: `run-${n}`, artifactId: `artifact-${n}`, versionId: `version-${n}`, name: `idea-${n}.png`, mime: "image/png", bytes: bytes.byteLength, sha256: await hashAidtResearchBytes(bytes) } };
  }));
  handoff = { offer: { id: "frozen-v2", label: "来源", text: "正式文字V2与三个已确认点子" }, warnings: [], sources: [{ stageId: 4, revision: 12 }], sourceImages: images,
    textBasis: { designId: native.id, stageRevision: 20, textVersion: "text-v2", textSha256: "a".repeat(64) } };
  const selected = { revision: 12, brainstormId: "round-a", ideaIds: images.map(image => image.ideaId) };
  stage = { projectId: input.projectId, stageId: 5, revision: 21, content: { schemaVersion: 1,
    draft: StageDraft.parse(updateAidtPrototypeEntityDraft(empty(), native.id, old => ({ ...old, fields: { ...old.fields, prototypeIdeaSource: JSON.stringify(selected) } }))) },
    sourceStageRevisions: [], updatedAt: "2026-11-22T07:00:00.000Z", updatedBy: "qa-user" };
  mocks.handoff.mockImplementation(async () => handoff); mocks.stage.mockImplementation(async () => ({ stage }));
  mocks.save.mockImplementation(async body => { stage = { ...stage, revision: stage.revision + 1, content: body.content }; return { stage }; });
  mocks.request.mockImplementation(async path => { if (path === "/pm-designs") return { items: [native] }; throw new Error("unexpected native path " + path); });
  mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const file = (init.body as FormData).get("file") as File;
      const image = { id: `native-${native.refImages.length + 1}`, name: file.name, size: file.size, mime: file.type, createdAt: "2026-11-22" };
      native = NativeProject.parse({ ...native, refImages: [...native.refImages, image] });
      return new Response(JSON.stringify({ project: native, image }), { status: 201 });
    }
    const run = /ingestion-runs\/([^/?]+)/.exec(path)?.[1]; const image = handoff.sourceImages?.find(source => source.reference.runId === run)?.reference;
    if (!image || !run) throw new Error("unexpected source " + path);
    if (!path.includes("/content")) return new Response(JSON.stringify({ ingestionRunId: run, status: "STORED", history: ["STORED"], originalDownloadable: true, retrievable: false }));
    return new Response(files.get(run), { headers: { "Content-Type": image.mime, "X-Content-SHA256": image.sha256, "X-Artifact-Id": image.artifactId, "X-Artifact-Version-Id": image.versionId } });
  });
});
afterEach(() => vi.unstubAllGlobals());
it("imports all three actual frozen image byte files with explicit student action and saves immutable native receipts", async () => {
  render(<AidtPrototypeSourceImages {...props()} />); expect(postCalls()).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByText(/已载入并保存 3 张/)).toBeVisible(); expect(postCalls()).toHaveLength(3); expect(mocks.save).toHaveBeenCalledTimes(3);
  for (const [, init] of postCalls()) expect(init.headers.Authorization).toBe("Bearer synthetic-unit-token");
  const saved = readAidtSourceImageBinding(readAidtPrototypeEntityDraft(stage.content.draft, native.id), handoff);
  expect(saved?.images.map(image => image.nativeImageId)).toEqual(["native-1", "native-2", "native-3"]);
  await expect(requireAidtNativeSourceImages(input, handoff, native)).resolves.toBeUndefined();
});
it("reopens saved matching one-image bindings without another upload or CAS", async () => {
  handoff = { ...handoff, sourceImages: handoff.sourceImages!.slice(0, 1) };
  stage = { ...stage, content: { ...stage.content, draft: StageDraft.parse(updateAidtPrototypeEntityDraft(stage.content.draft, native.id,
    old => ({ ...old, fields: { ...old.fields, prototypeIdeaSource: JSON.stringify({ revision: 12, brainstormId: "round-a", ideaIds: [handoff.sourceImages![0]!.ideaId] }) } }))) } };
  stored([binding(handoff.sourceImages![0]!)]);
  render(<AidtPrototypeSourceImages {...props()} />); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByText(/已载入并保存 1 张/)).toBeVisible(); expect(postCalls()).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled();
});
it("imports a single pinned source with one actual multipart upload and one CAS", async () => {
  handoff = { ...handoff, sourceImages: handoff.sourceImages!.slice(0, 1) };
  stage = { ...stage, content: { ...stage.content, draft: StageDraft.parse(updateAidtPrototypeEntityDraft(stage.content.draft, native.id,
    old => ({ ...old, fields: { ...old.fields, prototypeIdeaSource: JSON.stringify({ revision: 12, brainstormId: "round-a", ideaIds: [handoff.sourceImages![0]!.ideaId] }) } }))) } };
  render(<AidtPrototypeSourceImages {...props()} />); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByText(/已载入并保存 1 张/)).toBeVisible(); expect(postCalls()).toHaveLength(1); expect(mocks.save).toHaveBeenCalledOnce();
});
it("recovers a known upload after a CAS conflict without re-uploading its native image", async () => {
  mocks.save.mockRejectedValueOnce(new Error("CAS conflict"));
  render(<AidtPrototypeSourceImages {...props()} />); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByText("CAS conflict")).toBeVisible(); expect(postCalls()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByText(/已载入并保存 3 张/)).toBeVisible(); expect(postCalls()).toHaveLength(3);
  const saved = readAidtSourceImageBinding(readAidtPrototypeEntityDraft(stage.content.draft, native.id), handoff);
  expect(saved?.images.map(image => image.nativeImageId)).toEqual(["native-1", "native-2", "native-3"]);
});
it("does not retry an unknown upload outcome, even on another click", async () => {
  const original = mocks.fetch.getMockImplementation()!; mocks.fetch.mockImplementation((path, init) => init?.method === "POST" ? Promise.reject(new Error("unknown transport")) : original(path, init));
  render(<AidtPrototypeSourceImages {...props()} />); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByText(/上传结果尚不确定/)).toBeVisible(); expect(postCalls()).toHaveLength(1); expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "载入冻结点子图片" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" })); expect(postCalls()).toHaveLength(1);
});
it("never adopts an unbound same-name image as proof", async () => {
  const image = binding(handoff.sourceImages![0]!); native = { ...native, refImages: [{ id: image.nativeImageId, name: image.nativeName, mime: "image/png", size: image.nativeSize, createdAt: "2026-11-22" }] };
  render(<AidtPrototypeSourceImages {...props()} />); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByText(/同名但未保存关联回执/)).toBeVisible(); expect(postCalls()).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled();
});
it("validates original bytes and immutable version through the real material reader", async () => {
  const source = handoff.sourceImages![0]!; await expect(readAidtSourceImageBytes(input, source)).resolves.toMatchObject({ reference: source.reference });
  await expect(readAidtSourceImageBytes(input, { ...source, reference: { ...source.reference, versionId: "not-the-saved-version" } })).rejects.toThrow("AIDT_MATERIAL_INTEGRITY_FAILED");
  files.set(source.reference.runId, new Uint8Array([1, 2, 3, 4, 5]).buffer);
  await expect(readAidtSourceImageBytes(input, source)).rejects.toThrow("AIDT_MATERIAL_INTEGRITY_FAILED");
});
it("refuses wrong project, revoked source access and aborted reads before reporting a usable image", async () => {
  const source = handoff.sourceImages![0]!;
  await expect(readAidtSourceImageBytes({ ...input, projectId: "other" }, source)).rejects.toThrow("SCOPE_MISMATCH");
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ reasonCode: "ARTIFACT_NOT_FOUND" }), { status: 404 }));
  await expect(readAidtSourceImageBytes(input, source)).rejects.toMatchObject({ status: 404 });
  const controller = new AbortController(); controller.abort(); await expect(readAidtSourceImageBytes({ ...input, signal: controller.signal }, source)).rejects.toThrow("CONTEXT_CHANGED");
});
it("rejects missing/deleted/replaced native reference IDs and an unconfirmed replacement text basis", async () => {
  stored(handoff.sourceImages!.map((source, i) => binding(source, `native-${i + 1}`)));
  await expect(requireAidtNativeSourceImages(input, handoff, { ...native, refImages: native.refImages.slice(1) })).rejects.toThrow(/先明确载入/);
  await expect(requireAidtNativeSourceImages(input, handoff, { ...native, refImages: native.refImages.map(image => ({ ...image, id: image.id + "-replaced" })) })).rejects.toThrow(/先明确载入/);
  await expect(requireAidtNativeSourceImages(input, { ...handoff, textBasis: { ...handoff.textBasis!, textVersion: "v3-unconfirmed" } }, native)).rejects.toThrow(/先明确载入/);
});
it("checks every artifact's authorization even when equal bytes share one native ref", async () => {
  const first = handoff.sourceImages![0]!, second = handoff.sourceImages![1]!;
  const duplicate = { ...second, reference: { ...second.reference, sha256: first.reference.sha256 } }; files.set(second.reference.runId, files.get(first.reference.runId)!);
  handoff = { ...handoff, sourceImages: [first, duplicate] };
  stage = { ...stage, content: { ...stage.content, draft: StageDraft.parse(updateAidtPrototypeEntityDraft(stage.content.draft, native.id,
    old => ({ ...old, fields: { ...old.fields, prototypeIdeaSource: JSON.stringify({ revision: 12, brainstormId: "round-a", ideaIds: [first.ideaId, duplicate.ideaId] }) } }))) } };
  stored([binding(duplicate)]);
  const original = mocks.fetch.getMockImplementation()!; mocks.fetch.mockImplementation((path, init) => String(path).includes(first.reference.runId) ? Promise.resolve(new Response("{}", { status: 403 })) : original(path, init));
  await expect(requireAidtNativeSourceImages(input, handoff, native)).rejects.toMatchObject({ status: 403 });
});
it("keeps all four previews while refusing unsupported native capacity", () => {
  handoff = { ...handoff, sourceImages: [...handoff.sourceImages!, { ...handoff.sourceImages![0]!, ideaId: "fourth", title: "第四项", reference: { ...handoff.sourceImages![0]!.reference, sha256: "f".repeat(64) } }] };
  expect(() => assertAidtSourceImageCapacity(handoff)).toThrow(/最多接收 3/); render(<AidtPrototypeSourceImages {...props()} />);
  expect(screen.getByText("第四项 · 第4步 V12")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "载入冻结点子图片" })).toBeDisabled(); expect(postCalls()).toHaveLength(0);
});
it("does not import or save an old frozen round view", () => {
  render(<AidtPrototypeSourceImages {...props()} input={{ ...input, stageId: 6, roundRevision: 8 }} />);
  expect(screen.getByRole("button", { name: "载入冻结点子图片" })).toBeDisabled(); expect(mocks.save).not.toHaveBeenCalled(); expect(postCalls()).toHaveLength(0);
});
it("does not continue after the actor changes while a source read is pending", async () => {
  let done!: (value: AidtDesignHandoff) => void; mocks.handoff.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  const view = render(<AidtPrototypeSourceImages {...props()} />); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  view.rerender(<AidtPrototypeSourceImages {...props()} input={{ ...input, sessionToken: "different-actor" }} />);
  await act(async () => done(handoff)); await waitFor(() => expect(screen.getByRole("button", { name: "载入冻结点子图片" })).not.toBeDisabled());
  expect(postCalls()).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled();
});

it("refuses generation when one of three pinned ideas has no frozen image, rather than treating two pictures as the full input", async () => {
  const missing = { ...handoff, sourceImages: handoff.sourceImages!.slice(0, 2) };
  stored(missing.sourceImages!.map((source, i) => binding(source, `native-${i + 1}`)));
  await expect(requireAidtNativeSourceImages(input, missing, native)).rejects.toThrow();
});

it("refuses partial imports before native POST or receipt CAS", async () => {
  handoff = { ...handoff, sourceImages: handoff.sourceImages!.slice(0, 2) };
  render(<AidtPrototypeSourceImages {...props()} />); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByText(/部分入选点子/)).toBeVisible(); expect(postCalls()).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled();
});

it.each(["revision", "round", "idea"] as const)("rejects a self-consistent native receipt whose frozen %s differs from the actual pinned selection", async kind => {
  const changed = handoff.sourceImages!.map((source, index) => index ? source : {
    ...source, ...(kind === "revision" ? { stage4Revision: 13 } : kind === "round" ? { brainstormId: "other-round" } : { ideaId: "other-idea" }),
  });
  handoff = { ...handoff, sourceImages: changed };
  stored(changed.map((source, index) => binding(source, `native-${index + 1}`)));
  await expect(requireAidtNativeSourceImages(input, handoff, native)).rejects.toThrow(/部分入选点子/);
});

async function confirmedV3WithRetainedV2ImageReceipts() {
  stored(handoff.sourceImages!.map((source, index) => binding(source, `native-${index + 1}`)));
  const v2NativeIds = native.refImages.map(image => image.id);
  const original = readAidtPrototypeEntityDraft(stage.content.draft, native.id)!;
  expect(readAidtSourceImageBinding(original, handoff)?.textVersion).toBe("text-v2");
  const lineage = { schemaVersion: 1, projectId: input.projectId, stage4Revision: 12, brainstormId: "round-a",
    ideas: handoff.sourceImages!.map(source => ({ ideaId: source.ideaId, references: [{ stageId: 4, revision: 12, entityId: source.ideaId, role: "idea" }], missing: [] })) };
  const edited = editAidtPrototypeText({ ...original, fields: { ...original.fields, prototypeTextLineage: JSON.stringify(lineage) } }, "V3：保留三个点子来源图，改成先比较口味再领取试饮。", "text-v3");
  const confirmed = confirmAidtPrototypeText(edited, input.projectId, native.id, 24)!;
  expect(isAidtPrototypeTextConfirmed(confirmed)).toBe(true);
  const basis = readAidtPrototypeTextConfirmation(confirmed)!;
  const hashes = await aidtPrototypeTextHashes(basis);
  const changed = updateAidtPrototypeEntityDraft(stage.content.draft, native.id, () => ({ ...confirmed, fields: { ...confirmed.fields, prototypeTextConfirmation: "" } }));
  stage = { ...stage, revision: 25, content: { ...stage.content, draft: StageDraft.parse(updateAidtPrototypeEntityDraft(changed, native.id, () => confirmed)) } };
  handoff = { ...handoff, offer: { ...handoff.offer, id: "frozen-v3", text: basis.text },
    textBasis: { designId: native.id, stageRevision: basis.stageRevision, textVersion: basis.textVersion, textSha256: hashes.textSha256 } };
  expect(isAidtPrototypeTextConfirmed(readAidtPrototypeEntityDraft(stage.content.draft, native.id)!)).toBe(true);
  return v2NativeIds;
}
it("explicitly rebinds retained real V2 source image receipts after confirming V3 without uploading those files again", async () => {
  const v2NativeIds = await confirmedV3WithRetainedV2ImageReceipts();
  await expect(requireAidtNativeSourceImages(input, handoff, native)).rejects.toThrow(/先明确载入/);
  render(<AidtPrototypeSourceImages {...props()} />); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByText(/已载入并保存 3 张/)).toBeVisible();
  expect(postCalls()).toHaveLength(0); expect(mocks.save).toHaveBeenCalledOnce();
  const rebound = readAidtSourceImageBinding(readAidtPrototypeEntityDraft(stage.content.draft, native.id), handoff);
  expect(rebound?.textVersion).toBe("text-v3"); expect(rebound?.images.map(image => image.nativeImageId)).toEqual(v2NativeIds);
  await expect(requireAidtNativeSourceImages(input, handoff, native)).resolves.toBeUndefined();
});

it.each(["revoked-source", "replaced-native-id", "changed-source-version"] as const)("does not reuse retained receipts after %s", async kind => {
  await confirmedV3WithRetainedV2ImageReceipts();
  if (kind === "revoked-source") {
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((path, init) => String(path).includes("run-1") ? Promise.resolve(new Response("{}", { status: 403 })) : original(path, init));
  } else if (kind === "replaced-native-id") {
    native = { ...native, refImages: native.refImages.map((image, index) => index ? image : { ...image, id: "lookalike-unrelated-id" }) };
  } else {
    handoff = { ...handoff, sourceImages: handoff.sourceImages!.map((source, index) => index ? source : { ...source, reference: { ...source.reference, versionId: "different-frozen-version" } }) };
  }
  render(<AidtPrototypeSourceImages {...props()} />); fireEvent.click(screen.getByRole("button", { name: "载入冻结点子图片" }));
  expect(await screen.findByRole("status")).not.toHaveTextContent("已载入并保存");
  expect(postCalls()).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled();
  await expect(requireAidtNativeSourceImages(input, handoff, native)).rejects.toThrow();
});
