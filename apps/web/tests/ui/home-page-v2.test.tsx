/**
 * 组织首页 v2（Refs #4698）的用户可见行为：
 *   · 点推荐 Skill → 新建对话并自动挂载（不再跳后台 Skill 目录）；挂载失败不假装成功；
 *   · 推荐数字人带头像、点击去 `/chat?agent=`；
 *   · 只显示启用的入口（含新增的访谈/研究/问卷/录音/设计）；
 *   · 项目卡显示协作者，没取到就整块省略；
 *   · 横幅背景优先级 图片 > 自定义色 > 预设，非法自定义色回落预设；
 *   · 「继续你的工作」拉不到的类别整组隐藏，全空时如实说没有；
 *   · 每个首页都有「提交反馈」，没有 Provider 时不渲染。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HOME_DEFAULT_QUICK_ACTIONS } from "./home-page-v2-fixtures";

const { push, startChatWithSkill, openFeedback, feedbackCtx, authedSrc } = vi.hoisted(() => ({
  push: vi.fn(),
  startChatWithSkill: vi.fn(),
  openFeedback: vi.fn(),
  feedbackCtx: { current: null as null | { openFeedback: () => void } },
  authedSrc: { current: null as string | null },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/start-chat-with-skill", () => ({ startChatWithSkill }));
vi.mock("@/components/feedback/feedback-provider", () => ({ useOptionalFeedback: () => feedbackCtx.current }));
vi.mock("@/lib/use-authed-image-src", () => ({ useAuthedImageSrc: () => ({ src: authedSrc.current, failed: false }) }));

import { AgentsStrip, CapabilityRecommendations, FeedbackRow, QuickActionsGrid, RecentWorkSection } from "@/components/home/home-sections";
import { HomeBanner } from "@/components/home/home-banner";
import { ProjectCard } from "@/components/home/home-work-cards";
import type { Load } from "@/components/home/use-home-work";

beforeEach(() => {
  push.mockReset();
  startChatWithSkill.mockReset();
  openFeedback.mockReset();
  feedbackCtx.current = { openFeedback } as never;
  authedSrc.current = null;
});
afterEach(cleanup);

describe("组织推荐 Skill → 新建对话并挂载", () => {
  const items = [{ kind: "skill" as const, refId: "sk1", name: "录音转写", note: "会议直接转文字" }];

  it("点击：以 skillId 与名称发起，成功后进入新线程（不是后台 Skill 页）", async () => {
    startChatWithSkill.mockResolvedValue({ threadId: "t1", mounted: true, failureReason: null });
    render(<CapabilityRecommendations items={items} />);
    fireEvent.click(screen.getByTestId("home-recommended-skill-sk1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat?thread=t1"));
    expect(startChatWithSkill).toHaveBeenCalledWith({ skillId: "sk1", name: "录音转写" });
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("/skill"));
  });

  it("挂载失败：留在首页说明原因，给出已建空对话的入口，不自动跳转", async () => {
    startChatWithSkill.mockResolvedValue({ threadId: "t9", mounted: false, failureReason: "SKILL_NOT_ENABLED" });
    render(<CapabilityRecommendations items={items} />);
    fireEvent.click(screen.getByTestId("home-recommended-skill-sk1"));
    const msg = await screen.findByTestId("home-skill-mount-failed");
    expect(msg.textContent).toContain("没能自动加载「录音转写」");
    expect(msg.textContent).not.toContain("SKILL_NOT_ENABLED");
    expect(msg.querySelector("a")?.getAttribute("href")).toBe("/chat?thread=t9");
    expect(push).not.toHaveBeenCalled();
  });

  it("连点只发起一次（进行中禁用）", async () => {
    let resolve!: (v: unknown) => void;
    startChatWithSkill.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<CapabilityRecommendations items={items} />);
    const btn = screen.getByTestId("home-recommended-skill-sk1");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(startChatWithSkill).toHaveBeenCalledTimes(1);
    resolve({ threadId: "t1", mounted: true, failureReason: null });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("新建线程失败：显示人话错误，不跳转", async () => {
    startChatWithSkill.mockRejectedValue(new Error("boom"));
    render(<CapabilityRecommendations items={items} />);
    fireEvent.click(screen.getByTestId("home-recommended-skill-sk1"));
    expect((await screen.findByRole("alert")).textContent).toContain("没能为「录音转写」新建对话");
    expect(push).not.toHaveBeenCalled();
  });

  it("历史遗留的 agent 项链到 /chat?agent=；空列表不渲染", () => {
    const { container, rerender } = render(<CapabilityRecommendations items={[{ kind: "agent", refId: "ag/1", name: "A", note: null }]} />);
    expect(screen.getByTestId("home-recommended-agent-ag/1").getAttribute("href")).toBe("/chat?agent=ag%2F1");
    rerender(<CapabilityRecommendations items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("推荐数字人", () => {
  it("带头像（插画 key）与角色/介绍，点击去和该数字人开始对话", () => {
    render(<AgentsStrip agents={[{ agentId: "ag1", name: "小研", roleLabel: "研究员", avatarKey: "robot", note: "帮你做桌面研究" }]} />);
    const card = screen.getByTestId("home-agent-ag1");
    expect(card.getAttribute("href")).toBe("/chat?agent=ag1");
    expect(card.textContent).toContain("小研");
    expect(card.textContent).toContain("研究员");
    expect(card.textContent).toContain("帮你做桌面研究");
    expect(card.querySelector('[data-avatar-key="robot"]')).not.toBeNull();
  });
  it("未知头像 key 回落为首字母，不报错", () => {
    render(<AgentsStrip agents={[{ agentId: "ag2", name: "Ava", roleLabel: null, avatarKey: "no-such-key", note: null }]} />);
    const card = screen.getByTestId("home-agent-ag2");
    expect(card.querySelector("[data-avatar-key]")).toBeNull();
    expect(card.textContent).toContain("AV");
  });
  it("没有推荐时整栏不渲染", () => {
    const { container } = render(<AgentsStrip agents={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("快捷入口", () => {
  it("默认配置：八个模块（含访谈/研究/问卷/录音/设计），Board/任务默认关", () => {
    render(<QuickActionsGrid actions={HOME_DEFAULT_QUICK_ACTIONS} />);
    const keys = ["chat", "projects", "research", "interview", "survey", "recording", "design", "brain"];
    for (const k of keys) expect(screen.getByTestId(`home-quick-action-${k}`)).toBeTruthy();
    expect(screen.queryByTestId("home-quick-action-board")).toBeNull();
    expect(screen.queryByTestId("home-quick-action-tasks")).toBeNull();
    expect(screen.getByTestId("home-quick-action-interview").getAttribute("href")).toBe("/itv");
    expect(screen.getByTestId("home-quick-action-recording").getAttribute("href")).toBe("/rec");
  });
  it("按 order 排序，关闭的不显示；全关则整块不渲染", () => {
    const { container, rerender } = render(
      <QuickActionsGrid actions={[{ key: "brain", enabled: true, order: 1 }, { key: "chat", enabled: true, order: 0 }, { key: "survey", enabled: false, order: 2 }]} />,
    );
    expect(Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("data-testid"))).toEqual(["home-quick-action-chat", "home-quick-action-brain"]);
    rerender(<QuickActionsGrid actions={[{ key: "chat", enabled: false, order: 0 }]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("项目卡协作者", () => {
  const base = { id: "p1", name: "供应链创新", kind: "general" as const, tags: [] };
  it("显示协作者头像与名字（超过两人用「等 N 人」）", () => {
    render(<ProjectCard project={{ ...base, collaborators: [
      { userId: "u1", displayName: "张伟" }, { userId: "u2", displayName: "李娜" }, { userId: "u3", displayName: "王强" },
    ] }} />);
    const box = screen.getByTestId("home-project-collaborators-p1");
    expect(box.textContent).toContain("张伟、李娜 等 3 人");
    expect(box.querySelectorAll("span[title]").length).toBe(3);
  });
  it("协作者没取到（null）或为空：整块省略，不填占位", () => {
    const { rerender } = render(<ProjectCard project={{ ...base, collaborators: null }} />);
    expect(screen.queryByTestId("home-project-collaborators-p1")).toBeNull();
    rerender(<ProjectCard project={{ ...base, collaborators: [] }} />);
    expect(screen.queryByTestId("home-project-collaborators-p1")).toBeNull();
    expect(screen.getByTestId("home-recent-project-p1").getAttribute("href")).toBe("/projects/p1");
  });
});

describe("横幅背景优先级", () => {
  const p = { title: "T", greeting: "你好", headline: "H", tagline: "" } as const;
  it("预设", () => {
    render(<HomeBanner {...p} preset="rose" color={null} imageUrl={null} />);
    expect(screen.getByTestId("home-banner").getAttribute("data-banner-source")).toBe("preset");
  });
  it("自定义色：inline 背景色，字色随对比度", () => {
    const { rerender } = render(<HomeBanner {...p} preset="custom" color="#FFFF00" imageUrl={null} />);
    const el = screen.getByTestId("home-banner");
    expect(el.getAttribute("data-banner-source")).toBe("custom");
    expect(el.style.backgroundColor).toBe("rgb(255, 255, 0)");
    const darkText = el.style.color;
    rerender(<HomeBanner {...p} preset="custom" color="#101010" imageUrl={null} />);
    expect(screen.getByTestId("home-banner").style.color).not.toBe(darkText);
  });
  it("自定义但色值非法 / 缺失：回落预设，不渲染坏样式", () => {
    render(<HomeBanner {...p} preset="custom" color="#12" imageUrl={null} />);
    const el = screen.getByTestId("home-banner");
    expect(el.getAttribute("data-banner-source")).toBe("preset");
    expect(el.style.backgroundColor).toBe("");
  });
  it("图片优先于自定义色；图片拉不到时回落配色", () => {
    authedSrc.current = "blob:banner";
    const { rerender } = render(<HomeBanner {...p} preset="custom" color="#FFFF00" imageUrl="/organizations/o/home-banner-file/x" />);
    expect(screen.getByTestId("home-banner").getAttribute("data-banner-source")).toBe("image");
    expect(screen.getByTestId("home-banner-image").getAttribute("src")).toBe("blob:banner");
    authedSrc.current = null;
    rerender(<HomeBanner {...p} preset="custom" color="#FFFF00" imageUrl="/organizations/o/home-banner-file/x" />);
    expect(screen.getByTestId("home-banner").getAttribute("data-banner-source")).toBe("custom");
  });
});

describe("继续你的工作", () => {
  const loading: Load<never[]> = { status: "loading" };
  const err: Load<never[]> = { status: "error" };
  const ready = <T,>(items: T[]): Load<T[]> => ({ status: "ready", items });
  const work = (over: Record<string, unknown>) => ({ threads: err, projects: err, research: err, interviews: err, surveys: err, ...over }) as never;

  it("拉不到的类别整组隐藏，其余照常显示", () => {
    render(<RecentWorkSection work={work({
      threads: ready([{ id: "t1", title: "我的对话", subtitle: "最近一条消息的摘要", status: "done", artifactCount: 2, lastActivityAt: new Date().toISOString() }]),
    })} />);
    const card = screen.getByTestId("home-recent-thread-t1");
    expect(card.getAttribute("href")).toBe("/chat?thread=t1");
    expect(card.textContent).toContain("最近一条消息的摘要");
    expect(card.textContent).toContain("2 个产出物");
    expect(screen.queryByText("项目")).toBeNull();
    expect(screen.queryByTestId("home-recent-empty")).toBeNull();
  });
  it("研究 / 访谈 / 问卷卡片各自落到真实路由", () => {
    render(<RecentWorkSection work={work({
      research: ready([{ sessionId: "r1", title: "储能调研", status: "active", progress: 40, stage: "research", updatedAt: "2026-09-30T00:00:00Z" }]),
      interviews: ready([{ interviewId: "i1", name: "用户访谈A", status: "running", kind: "batch", expertCount: 5, completedExpertCount: 2, href: "/itv/i1/setup", updatedAt: "2026-09-30T00:00:00Z" }]),
      surveys: ready([{ id: "s1", title: "满意度", status: "ready", collecting: true, updatedAt: "2026-09-30T00:00:00Z" }]),
    })} />);
    expect(screen.getByTestId("home-recent-research-r1").getAttribute("href")).toBe("/research/r1/research");
    expect(screen.getByTestId("home-recent-research-r1").textContent).toContain("进度 40%");
    expect(screen.getByTestId("home-recent-interview-i1").getAttribute("href")).toBe("/itv/i1/setup");
    expect(screen.getByTestId("home-recent-interview-i1").textContent).toContain("专家 2/5");
    expect(screen.getByTestId("home-recent-survey-s1").getAttribute("href")).toBe("/studio/survey/s1/design");
    expect(screen.getByTestId("home-recent-survey-s1").textContent).toContain("收集中");
  });
  it("加载完都为空：如实说没有；还在加载时不提前下结论", () => {
    const { rerender } = render(<RecentWorkSection work={work({ threads: ready([]), projects: ready([]), research: ready([]), interviews: ready([]), surveys: ready([]) })} />);
    expect(screen.getByTestId("home-recent-empty")).toBeTruthy();
    rerender(<RecentWorkSection work={work({ threads: loading })} />);
    expect(screen.queryByTestId("home-recent-empty")).toBeNull();
  });
});

describe("提交反馈", () => {
  it("点击打开产品级反馈对话框", () => {
    render(<FeedbackRow />);
    fireEvent.click(screen.getByTestId("home-feedback-button"));
    expect(openFeedback).toHaveBeenCalledWith({ target: { kind: "product" }, targetLabel: null });
  });
  it("没有 FeedbackProvider 时不渲染（入口消失比入口失灵诚实）", () => {
    feedbackCtx.current = null;
    const { container } = render(<FeedbackRow />);
    expect(container.firstChild).toBeNull();
  });
});
