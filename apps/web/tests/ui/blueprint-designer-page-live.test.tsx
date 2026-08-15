/**
 * BP-06（track P P2）—— `/tpl/designer` 从硬编码 `BLUEPRINT[0]` 切到按 `blueprintId`
 * 真实读 `GET /blueprints` + `GET /blueprints/:id/design-facets`（F186）的组件测试。
 *
 * 与 `blueprint-list-screen-live.test.tsx`（BP-05）同一模式：假 `fetch`，不连真实后端。
 * 钉住：① 没有 blueprintId 时如实提示，不回退到假数据；② 真实拉取两个端点并拼出
 * 外壳需要的 props；③ 完成度/已填 key 来自真实 designFacets，不编造；④ 找不到该
 * blueprintId（不在自己组织里）时如实报错，不静默显示别的蓝本。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-e2e-bp06" } }),
}));

import { BlueprintDesignerPageLive } from "@/components/tpl-designer/blueprint-designer-page-live";

const ORG = "org-e2e-bp06";
const BP_ID = "bp-real-designer-1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const REAL_ROW = {
  blueprintId: BP_ID,
  name: "真实设计器蓝本",
  state: "draft" as const,
  versionNumber: 0,
  agendaSegmentCount: 0,
  durationTier: "custom" as const,
  appliedProjectCount: 0,
  satisfaction: null,
  completeness: { done: 2, denominator: 15 },
  availableActions: [] as const,
};

describe("BP-06 /tpl/designer：按 blueprintId 真实读（无编造字段）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-bp06");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("没有 blueprintId：如实提示，不回退到假数据", () => {
    render(<BlueprintDesignerPageLive blueprintId={null} />);
    expect(screen.getByTestId("bp-designer-missing-id")).toBeInTheDocument();
  });

  it("真实拉取两个端点，拼出外壳需要的 props（完成度/已填项都来自真实数据）", async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") {
        expect(url.searchParams.get("orgId")).toBe(ORG);
        return jsonResponse([REAL_ROW]);
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [
            { designFacetKey: "topic-and-background", content: "真实内容", itemRevision: "ir-1" },
            { designFacetKey: "flow-agenda", content: "另一项内容", itemRevision: "ir-2" },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);

    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());
    expect(screen.getByText("真实设计器蓝本 · 蓝本设计")).toBeInTheDocument();
    expect(screen.getByTestId("bp-designer-completeness").textContent).toContain("2/15");
    // 已填的两项在目录里应打勾（✓），不是靠 mock CONFIG_ITEMS 编出来的
    expect(screen.getByTestId("bp-designer-facet-topic-and-background").textContent).toContain("✓");
    expect(screen.getByTestId("bp-designer-facet-flow-agenda").textContent).toContain("✓");
  });

  it("这个 blueprintId 不在自己组织的列表里：如实报错，不静默显示别的蓝本", async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([]); // 组织下没有这个蓝本
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({ revision: "rev-1", designFacets: [] });
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);

    await waitFor(() => expect(screen.getByTestId("bp-designer-load-error")).toBeInTheDocument());
    expect(screen.queryByTestId("bp-designer-shell")).not.toBeInTheDocument();
  });

  it("读端点失败（如 BLUEPRINT_NOT_FOUND）：如实显示失败，不假装加载出内容", async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({ reasonCode: "BLUEPRINT_NOT_FOUND" }, 404);
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);

    await waitFor(() => expect(screen.getByTestId("bp-designer-load-error")).toBeInTheDocument());
  });
});
