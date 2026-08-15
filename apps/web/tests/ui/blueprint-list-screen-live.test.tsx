/**
 * BP-05（track P P1）—— `/tpl/list` 从 mock 切到真实 `GET/POST /blueprints` 的组件测试。
 *
 * 与 `tests/ui/projects-screen-live.test.tsx`（F353）同一模式：假 `fetch`，不连真实后端。
 * 钉住：① 自动使用 provider 的 currentOrgId；② 只渲染契约 `BlueprintRow` 有的字段（不编
 * tags/draftHint 等 mock 专属字段）；③ 新建（origin=blank）与复制（origin=copy）都真实
 * 调 `POST /blueprints`；④ 「复制」按钮不受 `availableActions` 门控（T14：它走
 * `createBlueprint` 而非未实现的 `copyBlueprint`，见组件文件头注）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-e2e-bp05" } }),
}));

import { BlueprintListScreenLive } from "@/components/tpl/blueprint-list-screen-live";

const ORG = "org-e2e-bp05";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const REAL_ROW = {
  blueprintId: "bp-real-1",
  name: "真实蓝本一号",
  state: "draft" as const,
  versionNumber: 0,
  agendaSegmentCount: 0,
  durationTier: "custom" as const,
  appliedProjectCount: 0,
  satisfaction: null,
  completeness: { done: 2, denominator: 15 },
  availableActions: [] as const,
};

describe("BP-05 /tpl/list：登录 → 真实列表（无编造字段）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let postCalls: { path: string; body: unknown }[];

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-bp05");
    postCalls = [];

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname === "/blueprints" && method === "GET") {
        expect(url.searchParams.get("orgId")).toBe(ORG);
        expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer tok-e2e-bp05");
        return jsonResponse([REAL_ROW]);
      }
      if (url.pathname === "/blueprints" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        postCalls.push({ path: url.pathname, body });
        return jsonResponse({ blueprintId: "bp-real-2", unmappedDesignFacetKeys: [], machineGenerated: false });
      }
      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("按 provider 的 current-org 自动拉取真实列表，只渲染契约有的字段", async () => {
    render(<BlueprintListScreenLive />);
    const card = await screen.findByTestId("tpl-live-card-bp-real-1");
    expect(card).toHaveTextContent("真实蓝本一号");
    expect(card).toHaveTextContent("2/15 已配");
    // 反证：不得出现 mock 专属字段（tags/draftHint 等）留下的痕迹
    expect(card.textContent ?? "").not.toMatch(/客户共创|内部演练|试跑一场后才能发布/);
  });

  it("新建模板（origin=blank）真实调 POST /blueprints，成功后刷新列表", async () => {
    render(<BlueprintListScreenLive />);
    await screen.findByTestId("tpl-live-card-bp-real-1");

    fireEvent.click(screen.getByTestId("tpl-live-new"));
    fireEvent.change(screen.getByTestId("tpl-live-new-name"), { target: { value: "新蓝本" } });
    fireEvent.click(screen.getByTestId("tpl-live-create-submit"));

    await waitFor(() => expect(postCalls).toHaveLength(1));
    expect(postCalls[0]).toMatchObject({
      path: "/blueprints",
      body: { orgId: ORG, name: "新蓝本", origin: "blank", sourceId: null },
    });
  });

  it("复制不受 availableActions 门控——走 createBlueprint(origin=copy)，即使 availableActions 为空", async () => {
    render(<BlueprintListScreenLive />);
    await screen.findByTestId("tpl-live-card-bp-real-1");

    // REAL_ROW.availableActions 恒为空数组（BP-01 至今行为），复制按钮仍应可见可点
    fireEvent.click(screen.getByTestId("tpl-live-card-copy"));

    await waitFor(() => expect(postCalls).toHaveLength(1));
    expect(postCalls[0]).toMatchObject({
      path: "/blueprints",
      body: { orgId: ORG, name: "真实蓝本一号 副本", origin: "copy", sourceId: "bp-real-1" },
    });
  });

  it("空名称提交：就地报错，不发请求", async () => {
    render(<BlueprintListScreenLive />);
    await screen.findByTestId("tpl-live-card-bp-real-1");

    fireEvent.click(screen.getByTestId("tpl-live-new"));
    fireEvent.click(screen.getByTestId("tpl-live-create-submit"));

    expect(await screen.findByTestId("tpl-live-create-error")).toHaveTextContent("名称不能为空");
    expect(postCalls).toHaveLength(0);
  });

  it("有 reasonCode 的创建失败就地显示该码，不编原因", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      if (url.pathname === "/blueprints" && method === "GET") return jsonResponse([REAL_ROW]);
      if (url.pathname === "/blueprints" && method === "POST") {
        return jsonResponse({ reasonCode: "ROLE_INSUFFICIENT" }, 403);
      }
      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    });

    render(<BlueprintListScreenLive />);
    await screen.findByTestId("tpl-live-card-bp-real-1");

    fireEvent.click(screen.getByTestId("tpl-live-new"));
    fireEvent.change(screen.getByTestId("tpl-live-new-name"), { target: { value: "新蓝本" } });
    fireEvent.click(screen.getByTestId("tpl-live-create-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("tpl-live-create-error")).toHaveTextContent("ROLE_INSUFFICIENT");
    });
  });

  it("空列表：如实显示空态文案，不是加载失败", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([]);
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });

    render(<BlueprintListScreenLive />);
    await waitFor(() => {
      expect(screen.getByTestId("tpl-live-empty")).toHaveTextContent("当前组织还没有项目模板");
    });
  });

  describe("后台管理界面统一标准（2026-08-15）——卡片 / 列表视图切换", () => {
    it("默认卡片视图：容器里是 tpl-live-grid，卡片切换按钮处于选中态（aria-pressed=true）", async () => {
      render(<BlueprintListScreenLive />);
      await screen.findByTestId("tpl-live-card-bp-real-1");

      expect(screen.getByTestId("admin-blueprint-view-container")).toBeTruthy();
      expect(screen.getByTestId("tpl-live-grid")).toBeTruthy();
      expect(screen.queryByTestId("tpl-live-list")).toBeNull();
      expect(screen.getByTestId("admin-blueprint-view-toggle-card").getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByTestId("admin-blueprint-view-toggle-list").getAttribute("aria-pressed")).toBe("false");
    });

    it("点「列表视图」按钮：真的切成列表——tpl-live-grid 消失、tpl-live-list 出现，同一行数据仍在", async () => {
      render(<BlueprintListScreenLive />);
      await screen.findByTestId("tpl-live-card-bp-real-1");

      fireEvent.click(screen.getByTestId("admin-blueprint-view-toggle-list"));

      expect(screen.queryByTestId("tpl-live-grid")).toBeNull();
      const row = screen.getByTestId("tpl-live-list-row-bp-real-1");
      expect(row).toHaveTextContent("真实蓝本一号");
      expect(screen.getByTestId("admin-blueprint-view-toggle-list").getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByTestId("admin-blueprint-view-toggle-card").getAttribute("aria-pressed")).toBe("false");

      // 切回卡片视图：还原
      fireEvent.click(screen.getByTestId("admin-blueprint-view-toggle-card"));
      expect(screen.getByTestId("tpl-live-grid")).toBeTruthy();
      expect(screen.queryByTestId("tpl-live-list")).toBeNull();
    });
  });
});
