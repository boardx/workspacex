/**
 * Skill 目录（`/skill?screen=library`，`SkillCatalogLive`）补上卡片 / 列表切换
 * （2026-08-15，人类原话：「参照已经做好的 Skill 目录的卡片样式…卡片也可以切换为
 * 列表」——Skill 目录本身此前**只有**卡片网格，没有切换入口，这次一起补上，让它成为
 * 「卡片 + 可切列表」标准第一个真正符合标准的参照）。
 *
 * 反空转：真的点击列表切换按钮后断言容器 class 换了、内容仍然可见，不是
 * 「按钮渲染出来了就算数」。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: "org-skill-view-toggle" },
    identity: { org: { name: "测试组织" }, orgRole: "admin" },
  }),
}));

import { SkillCatalogLive } from "@/components/skill/skill-catalog-live";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ROW = {
  skillId: "sk-view-toggle-1",
  name: "视图切换测试 Skill",
  duty: "验证卡片/列表切换",
  source: "自建",
  status: "草稿",
  visibility: "org-wide",
  currentVersionId: "sv-1",
  satisfaction: null,
  tags: [],
};

describe("Skill 库：补上卡片 / 列表切换（此前只有卡片网格）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-skill-view-toggle");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ items: [ROW], total: 1 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认卡片网格，切换按钮存在（此前完全没有这两个按钮）", async () => {
    render(<SkillCatalogLive />);
    const list = await screen.findByTestId("skill-catalog-list");
    expect(list.className).toContain("grid");
    expect(list).toHaveTextContent("视图切换测试 Skill");

    expect(screen.getByTestId("skill-catalog-view-toggle-card")).toBeInTheDocument();
    expect(screen.getByTestId("skill-catalog-view-toggle-list")).toBeInTheDocument();
  });

  it("点击列表切换按钮后：容器 class 从网格变成纵向排列，内容仍然可见", async () => {
    render(<SkillCatalogLive />);
    await screen.findByTestId("skill-catalog-list");

    fireEvent.click(screen.getByTestId("skill-catalog-view-toggle-list"));

    await waitFor(() => {
      const list = screen.getByTestId("skill-catalog-list");
      expect(list.className).not.toContain("grid");
      expect(list.className).toContain("flex-col");
    });
    expect(screen.getByTestId("skill-catalog-list")).toHaveTextContent("视图切换测试 Skill");
  });
});
