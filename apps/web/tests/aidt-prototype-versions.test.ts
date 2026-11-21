import { beforeEach, expect, it, vi } from "vitest";
import { loadAidtPrototypeDesigns, loadAidtPrototypeVersions, resolveAidtPrototypeVersion, saveAidtPrototypeImage } from "@/features/aidt/lib/aidt-prototype-versions";
const mocks = vi.hoisted(() => ({ enabled: true, request: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
const context = { projectId: "class", userId: "student", sessionToken: "captured-token" };
const design = (id = "design", ownerId = "student") => ({ id, name: `原型${id}`, template: "ui", problem: "", criteria: [], frames: [], prototype: [], frameNotes: [], pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null, chat: [], ownerId, ownerName: "学生", createdAt: "now", updatedAt: "now" });
const resource = (id = "design", ownerUserId = "student") => ({ kind: "design", id, title: `关联${id}`, ownerUserId, status: null, updatedAt: "now", linkedAt: "then" });
const summary = (id = "version") => ({ id, seq: 1, source: "model", summary: "增加首页", frames: ["首页"], notes: [], createdAt: "2026-11-16T00:00:00Z", links: [[]] });
const snapshot = () => ({ ...summary(), prototype: [{ type: "text", props: { content: "真实快照" } }] });
let resources: unknown[], owned: unknown[], versions: unknown[], version: unknown;
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled = true;
  resources = [resource()]; owned = [design()]; versions = [summary()]; version = snapshot();
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "/projects/class/resources") return { items: resources, counts: {} };
    if (path === "/pm-designs") return { items: owned };
    if (path === "/pm-designs/design/versions") return { items: versions };
    if (path === "/pm-designs/design/versions/version") return { version };
    throw new Error(`Unexpected path: ${path}`);
  });
});

it("intersects native project links and current owner's list, never treating association as authorization", async () => {
  resources = [resource(), resource(), resource("unlisted"), resource("foreign", "another"), resource("unlinked-owner", "another")];
  owned = [design(), design("unlinked"), design("foreign", "another"), design("unlinked-owner")];
  expect(await loadAidtPrototypeDesigns(context)).toEqual({ items: [{ id: "design", name: "原型design", ownerId: "student" }], unavailableCount: 3 });
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.request.mock.calls.every(([, options]) => options.sessionToken === "captured-token" && options.method === "GET")).toBe(true);
});
it("distinguishes an actual no-link result from service or malformed response failures", async () => {
  resources = []; expect(await loadAidtPrototypeDesigns(context)).toEqual({ items: [], unavailableCount: 0 });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  mocks.request.mockRejectedValueOnce(new Error("503")); await expect(loadAidtPrototypeDesigns(context)).rejects.toThrow("503");
  mocks.request.mockResolvedValueOnce({ items: [{ kind: "design", id: "broken" }], counts: {} });
  await expect(loadAidtPrototypeDesigns(context)).rejects.toThrow();
});
it("lists only persisted IDs after rechecking owner and link, accepting only known native links metadata", async () => {
  expect((await loadAidtPrototypeVersions(context, "design")).map((item) => item.id)).toEqual(["version"]);
  versions = [{ ...summary(), unauthorizedExtra: true }]; await expect(loadAidtPrototypeVersions(context, "design")).rejects.toThrow();
  versions = [{ ...summary(), links: [[{ guessed: true }]] }]; await expect(loadAidtPrototypeVersions(context, "design")).rejects.toThrow();
  versions = [summary(), summary()]; await expect(loadAidtPrototypeVersions(context, "design")).rejects.toThrow("AIDT_PROTOTYPE_INVALID_VERSION");
  versions = [{ ...summary(), id: ".." }]; await expect(loadAidtPrototypeVersions(context, "design")).rejects.toThrow("AIDT_PROTOTYPE_INVALID_VERSION");
});
it("returns metadata for the actual native snapshot with explicit generated-page limits, never generated content", async () => {
  version = { ...snapshot(), frames: ["首页", "待生成"], prototype: [{ type: "text", props: { content: "真实快照" } }, null], links: [[], []] };
  expect(await resolveAidtPrototypeVersion(context, "design", "version")).toEqual({ designId: "design", versionId: "version", designName: "原型design", seq: 1, source: "model", summary: "增加首页", createdAt: "2026-11-16T00:00:00Z", frameCount: 2, generatedFrameCount: 1 });
  expect(mocks.request.mock.calls.map(([path]) => path)).toEqual(["/projects/class/resources", "/pm-designs", "/pm-designs/design/versions/version"]);
});
it("rejects disappeared associations and changed owners before reading a version snapshot", async () => {
  resources = []; await expect(resolveAidtPrototypeVersion(context, "design", "version")).rejects.toThrow("AIDT_PROTOTYPE_UNAVAILABLE");
  resources = [resource()]; owned = [design("design", "another")]; await expect(resolveAidtPrototypeVersion(context, "design", "version")).rejects.toThrow("AIDT_PROTOTYPE_UNAVAILABLE");
  expect(mocks.request.mock.calls.some(([path]) => path.includes("/versions"))).toBe(false);
});
it("rejects mismatched version IDs, missing pages, entirely ungenerated snapshots and malformed trees", async () => {
  for (const invalid of [
    { ...snapshot(), id: "another" }, { ...snapshot(), prototype: [] }, { ...snapshot(), prototype: [null] },
    { ...snapshot(), prototype: [{ type: "made-up-engine" }] }, { ...snapshot(), extra: true },
  ]) { version = invalid; await expect(resolveAidtPrototypeVersion(context, "design", "version")).rejects.toThrow(); }
});
it("does not start or continue requests after module disable, cancellation or missing identity", async () => {
  mocks.enabled = false; await expect(loadAidtPrototypeDesigns(context)).rejects.toThrow("AIDT_CONTEXT_CHANGED");
  expect(mocks.request).not.toHaveBeenCalled(); mocks.enabled = true;
  await expect(loadAidtPrototypeDesigns({ ...context, sessionToken: "" })).rejects.toThrow("AIDT_PROTOTYPE_UNAVAILABLE");
  const controller = new AbortController();
  mocks.request.mockImplementationOnce(async () => { controller.abort(); return { items: resources, counts: {} }; });
  await expect(loadAidtPrototypeDesigns({ ...context, signal: controller.signal })).rejects.toThrow("AIDT_CONTEXT_CHANGED");
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.calls[0]?.[1].signal).toBe(controller.signal);
});


it("saves an image as an exact immutable native version without overwriting existing screens", async () => {
  const source = "data:image/png;base64,aGVsbG8=";
  const originalRequest = mocks.request.getMockImplementation()!;
  const patch = vi.fn(async (options) => {
    const { summary: title, ops } = options.body;
    expect(ops).toEqual([{ op: "addScreen", at: 0, frame: "图片原型", root: { type: "image", props: { alt: "菜单", src: source } } }]);
    const receipt = { ...summary("image-v2"), seq: 2, source: "user" as const, summary: title, frames: ["图片原型", "首页"], links: [[], []] };
    versions = [receipt, summary()];
    version = { ...receipt, prototype: [ops[0].root, snapshot().prototype[0]] };
    return {};
  });
  mocks.request.mockImplementation(async (path, options) => {
    if (path === "/pm-designs/design/prototype/patch") return patch(options);
    if (path === "/pm-designs/design/versions/image-v2") return { version };
    return originalRequest(path, options);
  });

  const saved = await saveAidtPrototypeImage(context, "design", source, "菜单");
  expect(saved).toMatchObject({ designId: "design", versionId: "image-v2", seq: 2, frameCount: 2, source: "user" });
  expect(await saveAidtPrototypeImage(context, "design", source, "菜单")).toEqual(saved);
  expect(patch).toHaveBeenCalledTimes(1);
});

it("rejects an unlinked design before writing or accepting an image reference", async () => {
  resources = [];
  await expect(saveAidtPrototypeImage(context, "design", "data:image/png;base64,aGVsbG8=", "菜单")).rejects.toThrow("AIDT_PROTOTYPE_UNAVAILABLE");
  expect(mocks.request.mock.calls.some(([path, options]) => path.includes("/prototype/patch") || options.method === "POST")).toBe(false);
});
