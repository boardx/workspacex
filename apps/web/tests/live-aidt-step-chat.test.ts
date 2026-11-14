import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAidtStepChat } from "@/features/aidt/lib/live-aidt-step-chat";
import { AIDT_STEPS } from "@/lib/project-aidt";
const mocks = vi.hoisted(() => ({ catalog: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), mounts: vi.fn(), mount: vi.fn() }));
vi.mock("@/lib/live-chat", () => ({ listThreads: mocks.list, getThread: mocks.get, createThread: mocks.create }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => true }));
vi.mock("@/lib/api-client", () => ({ apiRequest: async (...args: readonly unknown[]) => ({ items: await mocks.catalog(...args) }) }));
vi.mock("@/lib/live-skill-mount", () => ({ listThreadMounts: mocks.mounts, mountSkills: mocks.mount }));
const input = () => ({ orgId: "o", userId: "u", projectId: "p", step: AIDT_STEPS[0], thread: null, sessionToken: "token" });
const detail = (projectId = "p", capabilities = ["composer.send"]) => ({ thread: { projectId, createdBy: "u", archived: false, visibilityScope: "plenary" }, messages: [], capabilities });
const active = (skillId = "s1") => ({ skillId, versionId: "v1", removedAt: null });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.catalog.mockResolvedValue(AIDT_STEPS.map((s, i) => ({ skillId: `s${i + 1}`, name: s.title, platformStableName: s.skill, status: "已启用", currentVersionId: "v1" })));
  mocks.list.mockResolvedValue({ groups: [] });
  mocks.get.mockResolvedValue(detail());
  mocks.create.mockResolvedValue({ threadId: "new" });
  mocks.mounts.mockResolvedValue({ temporary: [], version: "server-version" });
});
describe("durable AIDT step conversation and actual Skill mounting", () => {
  it("coalesces concurrent initialization and verifies the mounted version by read-back", async () => {
    mocks.mount.mockImplementation(async () => { mocks.mounts.mockResolvedValue({ temporary: [active()], version: "saved" }); });
    const a = resolveAidtStepChat(input());
    const b = resolveAidtStepChat(input());
    expect(a).toBe(b);
    expect(await a).toMatchObject({ threadId: "new", versionId: "v1" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.mount).toHaveBeenCalledWith("new", "p", { skillIds: ["s1"], expectedVersion: "server-version" }, "token");
  });
  it("recovers a renamed conversation through its persisted step mount", async () => {
    mocks.list.mockResolvedValue({ groups: [{ cards: [{ id: "renamed", title: "Our cafeteria study" }] }] });
    mocks.mounts.mockResolvedValue({ temporary: [active()], version: "x" });
    expect(await resolveAidtStepChat(input())).toMatchObject({ threadId: "renamed" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.mount).not.toHaveBeenCalled();
  });
  it("does not attach a step to an incoming thread with a different stage", async () => {
    mocks.mounts.mockResolvedValue({ temporary: [active("s2")], version: "x" });
    await expect(resolveAidtStepChat({ ...input(), thread: "other-step" })).rejects.toThrow("未绑定本步骤");
    expect(mocks.mount).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects cross-project and readonly thread URLs before mounting", async () => {
    mocks.get.mockResolvedValue(detail("foreign"));
    await expect(resolveAidtStepChat({ ...input(), thread: "foreign" })).rejects.toThrow("不属于");
    mocks.get.mockResolvedValue(detail("p", []));
    await expect(resolveAidtStepChat({ ...input(), thread: "readonly" })).rejects.toThrow("只读");
    expect(mocks.mount).not.toHaveBeenCalled();
  });
  it("reports missing Skill or list failure without creating a fake empty conversation", async () => {
    mocks.catalog.mockResolvedValue([]);
    await expect(resolveAidtStepChat(input())).rejects.toThrow("尚未安装");
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.catalog.mockResolvedValue([{ skillId: "s1", name: "Understand", platformStableName: "aidt-understand", status: "已启用", currentVersionId: "v1" }]);
    mocks.list.mockRejectedValue(new Error("offline"));
    await expect(resolveAidtStepChat(input())).rejects.toThrow("offline");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("recovers a created draft after mount failure and surfaces optimistic conflicts", async () => {
    mocks.list.mockResolvedValue({ groups: [{ cards: [{ id: "draft", title: "[AIDT 1] 理解与提出问题" }] }] });
    mocks.mount.mockRejectedValue(new Error("SKILL_VERSION_CHANGED"));
    await expect(resolveAidtStepChat(input())).rejects.toThrow("SKILL_VERSION_CHANGED");
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.mount.mockImplementation(async () => { mocks.mounts.mockResolvedValue({ temporary: [active()], version: "saved" }); });
    expect(await resolveAidtStepChat(input())).toMatchObject({ threadId: "draft" });
  });
});

it("all group members recover the same authorized shared conversation regardless of creator", async () => {
  mocks.list.mockResolvedValue({ groups: [{ cards: [{ id: "team-thread", title: "Our decision" }] }] });
  mocks.get.mockResolvedValue({ ...detail(), thread: { ...detail().thread, createdBy: "another-member" } });
  mocks.mounts.mockResolvedValue({ temporary: [active()], version: "x" });
  expect(await resolveAidtStepChat(input())).toMatchObject({ threadId: "team-thread" });
  expect(mocks.create).not.toHaveBeenCalled();
});
it("does not repurpose private chats or silently choose between duplicate stage chats", async () => {
  mocks.get.mockResolvedValue({ ...detail(), thread: { ...detail().thread, visibilityScope: "private" } });
  await expect(resolveAidtStepChat({ ...input(), thread: "private" })).rejects.toThrow("个人范围");
  mocks.get.mockResolvedValue(detail());
  mocks.list.mockResolvedValue({ groups: [{ cards: [{ id: "a", title: "First" }, { id: "b", title: "Second" }] }] });
  mocks.mounts.mockResolvedValue({ temporary: [active()], version: "x" });
  await expect(resolveAidtStepChat(input())).rejects.toMatchObject({ choices: [{ id: "a", title: "First", versionId: "v1" }, { id: "b", title: "Second", versionId: "v1" }] });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.mount).not.toHaveBeenCalled();
});
