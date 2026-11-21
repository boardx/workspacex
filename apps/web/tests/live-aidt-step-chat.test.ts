import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAidtStepChat, createAidtStepChatWithLatest } from "@/features/aidt/lib/live-aidt-step-chat";
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
  it("uses an independent mounted SUM thread without changing ordinary sixth-stage chats", async () => {
    mocks.catalog.mockResolvedValue([...AIDT_STEPS.map((s, i) => ({ skillId: `s${i + 1}`, name: s.title, platformStableName: s.skill, status: "已启用", currentVersionId: "v1" })), { skillId: "sum", name: "项目总结", platformStableName: "dt-summarize-project", status: "已启用", currentVersionId: "sum-v2" }]);
    mocks.mount.mockImplementation(async () => { mocks.mounts.mockResolvedValue({ temporary: [{ skillId: "sum", versionId: "sum-v2", removedAt: null }], version: "saved" }); });
    expect(await resolveAidtStepChat({ ...input(), step: AIDT_STEPS[5], purpose: "report" })).toMatchObject({ threadId: "new", versionId: "sum-v2" });
    expect(mocks.create).toHaveBeenCalledWith({ projectId: "p", title: "[AIDT SUM] 小组研究报告", groupId: null, visibilityScope: "plenary" }, "token");
    expect(mocks.mount).toHaveBeenCalledWith("new", "p", { skillIds: ["sum"], expectedVersion: "server-version" }, "token");
    await expect(resolveAidtStepChat({ ...input(), step: AIDT_STEPS[5], thread: "new" })).rejects.toThrow("未绑定本步骤");
    await expect(resolveAidtStepChat({ ...input(), purpose: "report" })).rejects.toThrow("只在第6步");
  });
  it("keeps an existing SUM skill version pinned and never repurposes an iterate thread", async () => {
    mocks.catalog.mockResolvedValue([{ skillId: "s6", platformStableName: "aidt-iterate", name: "迭代", status: "已启用", currentVersionId: "v1" }, { skillId: "sum", platformStableName: "dt-summarize-project", name: "项目总结", status: "已启用", currentVersionId: "sum-latest" }]);
    mocks.mounts.mockResolvedValueOnce({ temporary: [active("s6")], version: "x" });
    await expect(resolveAidtStepChat({ ...input(), step: AIDT_STEPS[5], purpose: "report", thread: "stage6" })).rejects.toThrow("未绑定本步骤");
    mocks.mounts.mockResolvedValue({ temporary: [{ skillId: "sum", versionId: "sum-old", removedAt: null }], version: "x" });
    expect(await resolveAidtStepChat({ ...input(), step: AIDT_STEPS[5], purpose: "report", thread: "summary" })).toMatchObject({ versionId: "sum-old", latestVersionId: "sum-latest" });
    expect(mocks.mount).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
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
  it("opens existing history without creating or mounting a legacy thread", async () => {
    const history = { ...input(), existingOnly: true };
    await expect(resolveAidtStepChat(history)).rejects.toThrow("没有早期阶段对话");
    mocks.list.mockResolvedValue({ groups: [{ cards: [{ id: "old", title: "Earlier discussion" }] }] });
    mocks.mounts.mockResolvedValue({ temporary: [active()], version: "x" });
    await expect(resolveAidtStepChat(history)).resolves.toMatchObject({ threadId: "old", versionId: "v1" });
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


describe("explicit latest-version conversation without changing old pins", () => {
  const upgrade = () => ({ ...input(), thread: "old", expectedPinnedVersionId: "v1", expectedLatestVersionId: "v2" });
  const offer = () => {
    mocks.catalog.mockResolvedValue([{ skillId: "s1", name: "理解", platformStableName: "aidt-understand", status: "已启用", currentVersionId: "v2" }]);
    mocks.mounts.mockImplementation(async (id: string) => ({ temporary: id === "old" ? [active()] : [], version: id === "old" ? "old-mount-state" : "new-mount-state" }));
  };
  it("shows a visible catalog update while preserving the current mounted version on normal entry", async () => {
    offer();
    expect(await resolveAidtStepChat({ ...input(), thread: "old" })).toMatchObject({ threadId: "old", versionId: "v1", latestVersionId: "v2" });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.mount).not.toHaveBeenCalled();
  });
  it("creates a separate latest-version conversation only after the explicit action and readback", async () => {
    offer();
    mocks.mount.mockImplementation(async () => { mocks.mounts.mockImplementation(async (id: string) => ({ temporary: [id === "old" ? active() : { ...active(), versionId: "v2" }], version: "saved" })); });
    expect(await createAidtStepChatWithLatest(upgrade())).toMatchObject({ threadId: "new", versionId: "v2", latestVersionId: "v2" });
    expect(mocks.create).toHaveBeenCalledWith({ projectId: "p", title: "[AIDT 1] 理解与提出问题 · 新版教学", groupId: null, visibilityScope: "plenary" }, "token");
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    expect(mocks.mount).toHaveBeenCalledWith("new", "p", { skillIds: ["s1"], expectedVersion: "new-mount-state" }, "token");
    expect(mocks.mount).not.toHaveBeenCalledWith("old", expect.anything(), expect.anything(), expect.anything());
  });
  it("does not silently accept a changed offer or changed source mount", async () => {
    offer();
    await expect(createAidtStepChatWithLatest({ ...upgrade(), expectedLatestVersionId: "no-longer-current" })).rejects.toThrow("目录中的教学版本已变化");
    await expect(createAidtStepChatWithLatest({ ...upgrade(), expectedPinnedVersionId: "another-pin" })).rejects.toThrow("原对话的教学挂载已变化");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.mount).not.toHaveBeenCalled();
  });
  it("recovers its own empty new draft after a failed mount without touching the old conversation", async () => {
    offer(); mocks.mount.mockRejectedValueOnce(new Error("SKILL_VERSION_CHANGED"));
    await expect(createAidtStepChatWithLatest(upgrade())).rejects.toThrow("SKILL_VERSION_CHANGED");
    mocks.list.mockResolvedValue({ groups: [{ cards: [{ id: "new", title: "[AIDT 1] 理解与提出问题 · 新版教学" }] }] });
    mocks.mount.mockImplementation(async () => { mocks.mounts.mockImplementation(async (id: string) => ({ temporary: [id === "old" ? active() : { ...active(), versionId: "v2" }], version: "saved" })); });
    expect(await createAidtStepChatWithLatest(upgrade())).toMatchObject({ threadId: "new", versionId: "v2" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("does not report success when actual readback resolves another version", async () => {
    offer(); mocks.mount.mockImplementation(async () => {
      mocks.mounts.mockImplementation(async (id: string) => ({ temporary: [id === "old" ? active() : { ...active(), versionId: "v3" }], version: "saved" }));
    });
    await expect(createAidtStepChatWithLatest(upgrade())).rejects.toThrow("挂载未能确认");
    expect(mocks.mount).toHaveBeenCalledTimes(1);
  });
  it("rechecks source thread write access before creating any new conversation", async () => {
    offer(); mocks.get.mockResolvedValue(detail("p", []));
    await expect(createAidtStepChatWithLatest(upgrade())).rejects.toThrow("只读");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.mount).not.toHaveBeenCalled();
  });
  it("stops before a new write when the initiating host scope is cancelled", async () => {
    offer(); const cancellation = new AbortController();
    let finish!: (value: { groups: readonly unknown[] }) => void;
    mocks.list.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const task = createAidtStepChatWithLatest({ ...upgrade(), signal: cancellation.signal });
    await vi.waitFor(() => expect(mocks.list).toHaveBeenCalled());
    cancellation.abort(); finish({ groups: [] });
    await expect(task).rejects.toThrow("AIDT_CONTEXT_CHANGED");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.mount).not.toHaveBeenCalled();
  });
  it("does not create another draft after recovering a previously completed empty latest mount", async () => {
    offer(); mocks.list.mockResolvedValue({ groups: [{ cards: [{ id: "prepared", title: "[AIDT 1] 理解与提出问题 · 新版教学" }] }] });
    mocks.mounts.mockImplementation(async (id: string) => ({ temporary: [id === "old" ? active() : { ...active(), versionId: "v2" }], version: "saved" }));
    expect(await createAidtStepChatWithLatest(upgrade())).toMatchObject({ threadId: "prepared", versionId: "v2" });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.mount).not.toHaveBeenCalled();
  });
});
