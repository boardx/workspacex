/**
 * 组织首页 v2（Refs #4698）的纯逻辑：目录与契约双向对齐、自定义色校验与字色对比度、
 * 后台表单模型、相对时间/缩写、访谈落点、「点 Skill → 新建对话并挂载」的流程与失败形态。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { homeConfig } from "@repo/contracts";
import {
  BANNER_PRESET_CATALOG, isValidBannerColor, QUICK_ACTION_CATALOG, QUICK_ACTION_ORDER, readableTextOn,
} from "@/lib/home-config-catalog";
import { formatRelativeTime, initialsOf } from "@/lib/home-format";
import { interviewHref, researchVisualStage } from "@/components/home/use-home-work";
import {
  bannerArtifactIdFromUrl, isFormDirty, toFormState, toUpdateInput, validateForm,
} from "@/components/org-admin/home-config-form-model";
import type { HomeConfig } from "@/lib/live-home-config";

const { createPersonalThread, listThreadMounts, mountSkills } = vi.hoisted(() => ({
  createPersonalThread: vi.fn(),
  listThreadMounts: vi.fn(),
  mountSkills: vi.fn(),
}));
vi.mock("@/lib/live-chat", () => ({ createPersonalThread }));
vi.mock("@/lib/live-skill-mount", () => ({ listThreadMounts, mountSkills }));

import { startChatWithSkill } from "@/lib/start-chat-with-skill";

const BASE: HomeConfig = {
  orgId: "o1", title: "T", tagline: null, bannerHeadline: "H", bannerTagline: "",
  bannerPreset: "ocean", bannerColor: null, bannerImageUrl: null,
  quickActions: [{ key: "chat", enabled: true, order: 0 }, { key: "survey", enabled: true, order: 1 }],
  recommendedCapabilities: [], recommendedAgents: [], sections: { recentWork: true, currentTasks: true },
  updatedAt: "2026-09-30T00:00:00.000Z", updatedBy: null,
};

describe("目录与契约双向对齐（漏一个键就红）", () => {
  it("快捷入口目录 = 契约 QuickActionKey 全集，顺序表无重复无遗漏", () => {
    const contract = [...homeConfig.QuickActionKey.options].sort();
    expect(Object.keys(QUICK_ACTION_CATALOG).sort()).toEqual(contract);
    expect([...QUICK_ACTION_ORDER].sort()).toEqual(contract);
  });
  it("横幅预设目录 + custom = 契约 BannerPreset 全集", () => {
    expect([...Object.keys(BANNER_PRESET_CATALOG), "custom"].sort()).toEqual([...homeConfig.BannerPreset.options].sort());
  });
  it("入口 href 都是站内绝对路径", () => {
    for (const m of Object.values(QUICK_ACTION_CATALOG)) expect(m.href).toMatch(/^\/[a-z]/);
  });
});

describe("自定义颜色", () => {
  it("只接受 #RRGGBB，与契约同一规则", () => {
    for (const ok of ["#000000", "#FFFFFF", "#2f6fed", "#A1b2C3"]) expect(isValidBannerColor(ok), ok).toBe(true);
    for (const bad of ["", "#FFF", "2F6FED", "#GGGGGG", "#2F6FED1", " #2F6FED", "rgb(1,2,3)"]) expect(isValidBannerColor(bad), bad).toBe(false);
    for (const v of ["#2F6FED", "#fff", "red"]) expect(isValidBannerColor(v)).toBe(homeConfig.BannerColor.safeParse(v).success);
  });
  it("字色取对比度更高的一边：亮底深字、暗底浅字", () => {
    expect(readableTextOn("#FFFF00")).toBe("dark");
    expect(readableTextOn("#FFFFFF")).toBe("dark");
    expect(readableTextOn("#101010")).toBe("light");
    expect(readableTextOn("#000000")).toBe("light");
    expect(readableTextOn("#1E40AF")).toBe("light");
    expect(readableTextOn("#93C5FD")).toBe("dark");
  });
});

describe("首页格式化", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  it("相对时间", () => {
    expect(formatRelativeTime("2026-09-30T11:59:40Z", now)).toBe("刚刚");
    expect(formatRelativeTime("2026-09-30T11:30:00Z", now)).toBe("30 分钟前");
    expect(formatRelativeTime("2026-09-30T09:00:00Z", now)).toBe("3 小时前");
    expect(formatRelativeTime("2026-09-27T12:00:00Z", now)).toBe("3 天前");
    expect(formatRelativeTime("2026-05-30T12:00:00Z", now)).toBe("4 个月前");
    expect(formatRelativeTime("2030-01-01T00:00:00Z", now)).toBe("刚刚");
  });
  it("解析不了的时间省略而不是显示 NaN", () => {
    expect(formatRelativeTime("not a date", now)).toBeNull();
    expect(formatRelativeTime(null, now)).toBeNull();
  });
  it("头像缩写", () => {
    expect(initialsOf("张伟")).toBe("张伟");
    expect(initialsOf("王小明")).toBe("王小");
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("ava")).toBe("AV");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf("李娜", 1)).toBe("李");
    expect(initialsOf("ava", 1)).toBe("A");
  });
  it("研究阶段：服务端运行阶段 → 路由可视阶段（researching 不同名）", () => {
    expect(researchVisualStage("brief")).toBe("import");
    expect(researchVisualStage("directions")).toBe("topic");
    expect(researchVisualStage("outline")).toBe("plan");
    expect(researchVisualStage("researching")).toBe("research");
    expect(researchVisualStage("report")).toBe("report");
  });
  it("访谈落点：quick / 有 sourceStep / 默认 setup", () => {
    expect(interviewHref({ interviewId: "a b", kind: "quick" })).toBe("/itv/quick/a%20b");
    expect(interviewHref({ interviewId: "i1", kind: "batch", sourceStep: "report" })).toBe("/itv/i1/report");
    expect(interviewHref({ interviewId: "i1", kind: "batch" })).toBe("/itv/i1/setup");
  });
});

describe("后台表单模型", () => {
  it("缺失的入口键按关闭处理，提交体固定 10 项且 order 连续", () => {
    const form = toFormState(BASE);
    expect(form.quickActionEnabled.chat).toBe(true);
    expect(form.quickActionEnabled.research).toBe(false);
    const out = toUpdateInput(form);
    expect(out.quickActions).toHaveLength(10);
    expect(out.quickActions.map((a) => a.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.quickActions.filter((a) => a.enabled).map((a) => a.key)).toEqual(["chat", "survey"]);
  });
  it("非 custom 预设不提交颜色；custom 提交输入的颜色", () => {
    const f = { ...toFormState(BASE), bannerColorInput: "#123456" };
    expect(toUpdateInput(f).bannerColor).toBeNull();
    expect(toUpdateInput({ ...f, bannerPreset: "custom" }).bannerColor).toBe("#123456");
  });
  it("提交体通过契约 in 校验（去掉 orgId 后逐字）", () => {
    const body = toUpdateInput(toFormState(BASE));
    expect(homeConfig.operations.updateHomeConfig.in.safeParse({ orgId: "o1", ...body }).success).toBe(true);
  });
  it("校验：自定义却没有合法色值 → 报 bannerColor；预设不报", () => {
    const f = toFormState(BASE);
    expect(validateForm({ ...f, bannerPreset: "custom", bannerColorInput: "" }).bannerColor).toBeDefined();
    expect(validateForm({ ...f, bannerPreset: "custom", bannerColorInput: "#12" }).bannerColor).toBeDefined();
    expect(validateForm({ ...f, bannerPreset: "custom", bannerColorInput: "#123456" }).bannerColor).toBeUndefined();
    expect(validateForm(f)).toEqual({});
  });
  it("校验：标题/主标题不能为空，长度上限", () => {
    const f = toFormState(BASE);
    expect(validateForm({ ...f, title: "  " }).title).toBeDefined();
    expect(validateForm({ ...f, title: "x".repeat(25) }).title).toBeDefined();
    expect(validateForm({ ...f, bannerHeadline: "" }).bannerHeadline).toBeDefined();
    expect(validateForm({ ...f, bannerTagline: "x".repeat(121) }).bannerTagline).toBeDefined();
  });
  it("横幅图片 id 取自 URL 最后一段；脏检查", () => {
    expect(bannerArtifactIdFromUrl("/organizations/o1/home-banner-file/home-banner-abc")).toBe("home-banner-abc");
    expect(bannerArtifactIdFromUrl(null)).toBeNull();
    const f = toFormState({ ...BASE, bannerImageUrl: "/organizations/o1/home-banner-file/x1" });
    expect(f.bannerImageArtifactId).toBe("x1");
    expect(isFormDirty(f, f)).toBe(false);
    expect(isFormDirty(f, { ...f, title: "变了" })).toBe(true);
  });
});

describe("startChatWithSkill：建线程 → 读版本 → 挂载", () => {
  beforeEach(() => {
    createPersonalThread.mockReset();
    listThreadMounts.mockReset();
    mountSkills.mockReset();
  });
  it("成功：用 skill 名建线程，版本号来自读端口，个人线程不带 projectId", async () => {
    createPersonalThread.mockResolvedValue({ threadId: "t1" });
    listThreadMounts.mockResolvedValue({ version: "v7", temporary: [] });
    mountSkills.mockResolvedValue({});
    const r = await startChatWithSkill({ skillId: "sk1", name: "录音转写" });
    expect(createPersonalThread).toHaveBeenCalledWith("录音转写");
    expect(listThreadMounts).toHaveBeenCalledWith("t1", undefined);
    expect(mountSkills).toHaveBeenCalledWith("t1", undefined, { skillIds: ["sk1"], expectedVersion: "v7" });
    expect(r).toEqual({ threadId: "t1", mounted: true, failureReason: null });
  });
  it("挂载被服务端拒绝：仍返回已建线程 + 服务端 reasonCode，不吞成成功", async () => {
    createPersonalThread.mockResolvedValue({ threadId: "t2" });
    listThreadMounts.mockResolvedValue({ version: "v1" });
    mountSkills.mockRejectedValue(Object.assign(new Error("x"), { reasonCode: "SKILL_NOT_ENABLED" }));
    expect(await startChatWithSkill({ skillId: "sk1", name: "A" })).toEqual({ threadId: "t2", mounted: false, failureReason: "SKILL_NOT_ENABLED" });
  });
  it("读不到版本号：不盲写（乐观锁纪律），mountSkills 不被调用", async () => {
    createPersonalThread.mockResolvedValue({ threadId: "t3" });
    listThreadMounts.mockRejectedValue(new Error("network"));
    const r = await startChatWithSkill({ skillId: "sk1", name: "A" });
    expect(r.mounted).toBe(false);
    expect(mountSkills).not.toHaveBeenCalled();
  });
  it("建线程失败：抛给调用方（由首页显示「没能新建对话」）", async () => {
    createPersonalThread.mockRejectedValue(new Error("boom"));
    await expect(startChatWithSkill({ skillId: "sk1", name: "A" })).rejects.toThrow("boom");
    expect(listThreadMounts).not.toHaveBeenCalled();
  });
});
