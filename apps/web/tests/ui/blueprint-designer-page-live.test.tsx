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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("D-05 二级 sign-off 已签核：面板真实可编辑（design-deltas/blueprint-design-facet-panels/）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-bp06");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("打开一项：真实文本编辑器显示真实已存内容（不是占位文案）", async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [{ designFacetKey: "survey", content: "真实分组内容", itemRevision: "ir-1" }],
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    await screen.getByTestId("bp-designer-facet-survey").click();
    const editor = await screen.findByTestId("bp-facet-content-survey");
    expect((editor as HTMLTextAreaElement).value).toBe("真实分组内容");
    // 不再是占位文案。
    expect(screen.queryByText(/本外壳不自行设计其内部交互/)).not.toBeInTheDocument();
  });

  it("编辑并失焦：真实调用 PUT updateDesignFacet（乐观并发 itemRevision），完成度按响应更新", async () => {
    let putBody: unknown = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [{ designFacetKey: "survey", content: "旧内容", itemRevision: "ir-1" }],
        });
      }
      if (
        url.pathname === `/blueprints/${BP_ID}/design-facets/survey` &&
        init?.method === "PUT"
      ) {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({
          itemRevision: "ir-2",
          completed: true,
          completeness: { done: 3, denominator: 15 },
          autosavedAt: "2026-08-17T02:00:00Z",
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    await screen.getByTestId("bp-designer-facet-survey").click();
    const editor = await screen.findByTestId("bp-facet-content-survey");
    fireEvent.change(editor, { target: { value: "新内容" } });
    fireEvent.blur(editor);

    await waitFor(() => expect(putBody).toEqual({ value: "新内容", expectedItemRevision: "ir-1" }));
    // 完成度是 PUT 响应里的 3/15，不是前端本地 +1 猜出来的。
    await waitFor(() => expect(screen.getByTestId("bp-designer-completeness").textContent).toContain("3/15"));
  });

  it("并发冲突（VERSION_CHANGED）：如实提示，不静默覆盖", async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [{ designFacetKey: "survey", content: "旧内容", itemRevision: "ir-1" }],
        });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/survey` && init?.method === "PUT") {
        return jsonResponse({ reasonCode: "VERSION_CHANGED" }, 409);
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    await screen.getByTestId("bp-designer-facet-survey").click();
    const editor = await screen.findByTestId("bp-facet-content-survey");
    fireEvent.change(editor, { target: { value: "并发改动" } });
    fireEvent.blur(editor);

    await waitFor(() =>
      expect(screen.getByTestId("bp-facet-error-survey").textContent).toContain("刷新页面"),
    );
  });

  it("主题与背景：结构化编辑器显示真实已存内容（JSON 解析，不是自由文本框）", async () => {
    const saved = {
      themeStatementText: "以 AI 辅助的方式在 2 周内交付可验证的 MVP",
      background: [
        { element: "为什么现在", content: "市场窗口收窄", citedFrom: "客户访谈#3" },
        { element: "已知结论", content: "", citedFrom: "" },
        { element: "硬约束", content: "预算 50 万", citedFrom: "" },
        { element: "要拍板的事", content: "", citedFrom: "" },
        { element: "不讨论的事", content: "", citedFrom: "" },
      ],
    };
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [
            { designFacetKey: "topic-and-background", content: JSON.stringify(saved), itemRevision: "ir-1" },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    // 目录第一项恒为 topic-and-background（catalog ordinal 1），默认选中。
    const statementInput = await screen.findByTestId("bp-topic-statement-input");
    expect((statementInput as HTMLTextAreaElement).value).toBe(saved.themeStatementText);
    expect((screen.getByTestId("bp-topic-bg-content-为什么现在") as HTMLInputElement).value).toBe("市场窗口收窄");
    expect((screen.getByTestId("bp-topic-bg-cited-为什么现在") as HTMLInputElement).value).toBe("客户访谈#3");
    expect((screen.getByTestId("bp-topic-bg-content-硬约束") as HTMLInputElement).value).toBe("预算 50 万");
  });

  it("主题与背景：编辑一行背景要素并失焦，真实保存成结构化 JSON（不是拼接成自由文本）", async () => {
    let putBody: { value: string; expectedItemRevision: string } | null = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({ revision: "rev-1", designFacets: [] });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/topic-and-background` && init?.method === "PUT") {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({
          itemRevision: "ir-new-1",
          completed: true,
          completeness: { done: 1, denominator: 15 },
          autosavedAt: "2026-08-17T02:00:00Z",
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    const bgInput = await screen.findByTestId("bp-topic-bg-content-硬约束");
    fireEvent.change(bgInput, { target: { value: "预算 50 万" } });
    fireEvent.blur(bgInput);

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody!.expectedItemRevision).toBe(""); // 未填过，哨兵空串
    const parsed = JSON.parse(putBody!.value) as { background: { element: string; content: string }[] };
    expect(parsed.background.find((b) => b.element === "硬约束")?.content).toBe("预算 50 万");
  });

  it("分组规则：结构化编辑器显示真实已存场景清单（JSON 解析）", async () => {
    const saved = {
      scenarios: [{ scenario: "业主首次评估", whatToAnswer: "投资意愿", defaultLeaderProfile: "业主代表" }],
      autoMatchByProfile: false,
      balanceByBackground: true,
    };
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [{ designFacetKey: "grouping-rule", content: JSON.stringify(saved), itemRevision: "ir-1" }],
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    await screen.getByTestId("bp-designer-facet-grouping-rule").click();
    expect((await screen.findByTestId("bp-grouping-scenario-name-0") as HTMLInputElement).value).toBe(
      "业主首次评估",
    );
    expect((screen.getByTestId("bp-grouping-auto-match") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("bp-grouping-balance-background") as HTMLInputElement).checked).toBe(true);
  });

  it("分组规则：加一个场景并失焦，真实保存成结构化 JSON", async () => {
    let putBody: { value: string; expectedItemRevision: string } | null = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({ revision: "rev-1", designFacets: [] });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/grouping-rule` && init?.method === "PUT") {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({
          itemRevision: "ir-new-1",
          completed: true,
          completeness: { done: 1, denominator: 15 },
          autosavedAt: "2026-08-17T02:00:00Z",
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    await screen.getByTestId("bp-designer-facet-grouping-rule").click();
    await screen.findByTestId("bp-grouping-scenarios-empty");
    fireEvent.click(screen.getByTestId("bp-grouping-add-scenario"));
    const nameInput = screen.getByTestId("bp-grouping-scenario-name-0");
    fireEvent.change(nameInput, { target: { value: "采购比选" } });
    fireEvent.blur(nameInput);

    await waitFor(() => expect(putBody).not.toBeNull());
    const parsed = JSON.parse(putBody!.value) as { scenarios: { scenario: string }[] };
    expect(parsed.scenarios[0]?.scenario).toBe("采购比选");
  });

  it("角色与权限：灰色格禁用点击不发请求，可勾选格点击真实保存", async () => {
    let putCount = 0;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({ revision: "rev-1", designFacets: [] });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/roles-and-perms` && init?.method === "PUT") {
        putCount += 1;
        return jsonResponse({
          itemRevision: "ir-roles-1",
          completed: true,
          completeness: { done: 1, denominator: 15 },
          autosavedAt: "2026-08-17T02:00:00Z",
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-roles-and-perms"));
    await screen.findByTestId("bp-permission-matrix");

    // 灰格：已裁决只读，点击不触发保存。
    const lockedCell = screen.getByTestId("bp-permission-cell-看已发布结论-引导");
    expect(lockedCell).toBeDisabled();
    fireEvent.click(lockedCell);
    expect(putCount).toBe(0);

    // 可勾选格：点击真实保存。
    const openCell = screen.getByTestId("bp-permission-cell-写本组画布-组员");
    expect(openCell).not.toBeDisabled();
    fireEvent.click(openCell);
    await waitFor(() => expect(putCount).toBe(1));
  });
});
