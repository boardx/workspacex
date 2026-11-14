import { beforeEach, expect, it, vi } from "vitest";
import { resolveAidtStepChat } from "@/features/aidt/lib/live-aidt-step-chat";
import { AIDT_STEPS } from "@/lib/project-aidt";
import { skills } from "@repo/contracts";
const mocks = vi.hoisted(() => ({ enabled: true, catalog: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), mounts: vi.fn(), mount: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.catalog }));
vi.mock("@/lib/live-chat", () => ({ listThreads: mocks.list, getThread: mocks.get, createThread: mocks.create }));
vi.mock("@/lib/live-skill-mount", () => ({ listThreadMounts: mocks.mounts, mountSkills: mocks.mount }));
const input = () => ({ orgId: "org-one", userId: "student-one", projectId: "group-one", step: AIDT_STEPS[0]!, thread: null, sessionToken: "captured-token" });
const catalog = () => ({ items: [{ skillId: "s1", name: "理解问题", platformStableName: "aidt-understand", status: "已启用", currentVersionId: "v1" }] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled = true;
  mocks.catalog.mockResolvedValue(catalog()); mocks.list.mockResolvedValue({ groups: [] });
  mocks.get.mockResolvedValue({ thread: { projectId: "group-one", visibilityScope: "plenary", archived: false }, capabilities: ["composer.send"], messages: [] });
  mocks.create.mockResolvedValue({ threadId: "new-thread" });
  mocks.mounts.mockResolvedValue({ temporary: [], version: "before" });
  mocks.mount.mockImplementation(async () => { mocks.mounts.mockResolvedValue({ temporary: [{ skillId: "s1", removedAt: null, versionId: "mounted" }], version: "after" }); });
});
it("does no catalog read or native thread mutation while the module is disabled", async () => {
  mocks.enabled = false;
  await expect(resolveAidtStepChat(input())).rejects.toThrow("未启用");
  expect(mocks.catalog).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.mount).not.toHaveBeenCalled();
});
it("pins the captured bearer and organization for the canonical skill catalog read", async () => {
  await resolveAidtStepChat(input());
  expect(mocks.catalog).toHaveBeenCalledWith(skills.operations.listSkills.path, { method: "GET", query: { orgId: "org-one", entry: "library" }, sessionToken: "captured-token" });
});
it("stops subsequent reads and writes when the last host leaves during catalog loading", async () => {
  const pending = deferred<ReturnType<typeof catalog>>(); mocks.catalog.mockReturnValueOnce(pending.promise);
  const scope = new AbortController(); const task = resolveAidtStepChat({ ...input(), signal: scope.signal });
  scope.abort(); pending.resolve(catalog());
  await expect(task).rejects.toThrow("AIDT_CONTEXT_CHANGED");
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.mount).not.toHaveBeenCalled();
});
it("lets the remaining identical-scope consumer continue after one host unmounts", async () => {
  const pending = deferred<ReturnType<typeof catalog>>(); mocks.catalog.mockReturnValueOnce(pending.promise);
  const first = new AbortController(), second = new AbortController();
  const a = resolveAidtStepChat({ ...input(), signal: first.signal }); const b = resolveAidtStepChat({ ...input(), signal: second.signal });
  expect(a).toBe(b); first.abort(); pending.resolve(catalog());
  expect(await b).toMatchObject({ threadId: "new-thread", versionId: "mounted" }); expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("preserves an accepted native thread but starts no later mount after its host leaves", async () => {
  const creating = deferred<{ threadId: string }>(); mocks.create.mockReturnValueOnce(creating.promise);
  const scope = new AbortController(); const task = resolveAidtStepChat({ ...input(), signal: scope.signal });
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  scope.abort(); creating.resolve({ threadId: "accepted-before-cancellation" });
  await expect(task).rejects.toThrow("AIDT_CONTEXT_CHANGED"); expect(mocks.mount).not.toHaveBeenCalled();
});
it("does not coalesce another project, user, bearer or organization into this task", async () => {
  const pending = deferred<ReturnType<typeof catalog>>(); mocks.catalog.mockReturnValue(pending.promise);
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const variants = [input(), { ...input(), projectId: "other-group" }, { ...input(), userId: "other-student" }, { ...input(), orgId: "other-org" }, { ...input(), sessionToken: "other-token" }];
  const tasks = variants.map((value, index) => resolveAidtStepChat({ ...value, signal: controllers[index]!.signal }));
  expect(new Set(tasks).size).toBe(5); expect(mocks.catalog).toHaveBeenCalledTimes(5);
  controllers.forEach((controller) => controller.abort()); pending.resolve(catalog());
  const results = await Promise.allSettled(tasks); expect(results.every((result) => result.status === "rejected")).toBe(true); expect(mocks.create).not.toHaveBeenCalled();
});
