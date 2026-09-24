/**
 * backlog E6 —— Skill 库默认视图按场景分三个入口（方案 B）。
 *
 * 证的是：① 三个入口按契约 `skillEntryPoints` 渲染（label / promise / 成员）；
 * ② 入口接管的平台行不再平铺在网格里；③ 隐藏的底层能力默认不显示、勾选后回到网格；
 * ④ 组织自己的 skill（无 `platformStableName`）照旧在网格里。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { skillEntryPoints } from "@repo/contracts";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: "org-e6" },
    identity: { org: { name: "测试组织" }, orgRole: "admin" },
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/skill",
  useSearchParams: () => new URLSearchParams(),
}));

import { SkillCatalogLive } from "@/components/skill/skill-catalog-live";

function row(skillId: string, name: string, platformStableName: string | null) {
  return {
    skillId, name, duty: "（平台内置）", source: "自建", status: "已启用", visibility: "org-wide",
    currentVersionId: `${skillId}-v1`, satisfaction: null, tags: [], platformStableName,
  };
}

const ITEMS = [
  row("sk-web", "联网研究", "web-research"),
  row("sk-mm", "会议纪要", "meeting-minutes"),
  row("sk-iv", "访谈综合", "interview-synthesis"),
  row("sk-rep", "项目周报", "project-status-report"),
  row("sk-doc", "文档理解", "document-understanding"),
  row("sk-own", "我的排序器", null),
];

describe("E6 Skill 库三个场景入口", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e6");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ items: ITEMS, total: ITEMS.length }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("按契约渲染三个入口及其成员，平台行不再平铺，隐藏能力默认不显示", async () => {
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-list")).toBeTruthy());

    const section = screen.getByTestId("skill-entry-points");
    for (const entry of skillEntryPoints.SKILL_ENTRY_POINTS) {
      const card = within(section).getByTestId(`skill-entry-${entry.id}`);
      expect(card.textContent).toContain(entry.label);
      expect(card.textContent).toContain(entry.promise);
    }
    const research = screen.getByTestId("skill-entry-research-and-read");
    expect(research.textContent).toContain("联网研究");
    expect(research.textContent).toContain("会议纪要");
    expect(screen.getByTestId("skill-entry-user-and-business-insight").textContent).toContain("访谈综合");
    expect(screen.getByTestId("skill-entry-write-for-others").textContent).toContain("项目周报");
    // 成员链接去「编辑源码」同一个目的地。
    const link = within(research).getAllByTestId("skill-entry-member")[0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("sk-web");

    const grid = screen.getByTestId("skill-catalog-list");
    expect(grid.textContent).toContain("我的排序器");
    expect(grid.textContent).not.toContain("联网研究");
    // 隐藏的底层能力：入口里没有、网格里默认也没有。
    expect(section.textContent).not.toContain("文档理解");
    expect(grid.textContent).not.toContain("文档理解");
  });

  it("勾选「显示底层能力」后隐藏的平台 skill 回到网格（数据没被删）", async () => {
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-list")).toBeTruthy());
    const toggle = screen.getByTestId("skill-show-hidden");
    fireEvent.click(toggle);
    expect(screen.getByTestId("skill-catalog-list").textContent).toContain("文档理解");
    fireEvent.click(toggle);
    expect(screen.getByTestId("skill-catalog-list").textContent).not.toContain("文档理解");
  });
});
