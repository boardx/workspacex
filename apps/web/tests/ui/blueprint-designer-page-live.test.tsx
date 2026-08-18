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

  /*
   * 通用读写链路（真实已存内容回显 / PUT 带乐观并发 itemRevision / 完成度按响应更新 /
   * VERSION_CHANGED 如实提示）—— 此前这三条绑在还落回 FacetTextEditor 的某个 key 上，
   * 随着 15 项全部结构化，已无「仍是自由文本」的 key 可绑，改绑到 outputs 的结构化
   * 编辑器上。断言的是同一条链路，覆盖面未删减。
   */
  it("打开一项：真实结构化编辑器显示真实已存内容（不是占位文案）", async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [
            {
              designFacetKey: "outputs",
              content: JSON.stringify({ rows: [{ name: "行动项清单", gen: "AI 提取 · 人确认", to: "任务看板", required: true }] }),
              itemRevision: "ir-1",
            },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-outputs"));
    expect(await screen.findByTestId("bp-out-name-0")).toHaveValue("行动项清单");
    // 不再是占位文案。
    expect(screen.queryByText(/本外壳不自行设计其内部交互/)).not.toBeInTheDocument();
  });

  it("编辑并失焦：真实调用 PUT updateDesignFacet（乐观并发 itemRevision），完成度按响应更新", async () => {
    let putBody: { value: string; expectedItemRevision: string } | null = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [
            {
              designFacetKey: "outputs",
              content: JSON.stringify({ rows: [{ name: "旧产出", gen: "", to: "", required: false }] }),
              itemRevision: "ir-1",
            },
          ],
        });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/outputs` && init?.method === "PUT") {
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

    fireEvent.click(screen.getByTestId("bp-designer-facet-outputs"));
    const nameInput = await screen.findByTestId("bp-out-name-0");
    fireEvent.change(nameInput, { target: { value: "新产出" } });
    fireEvent.blur(nameInput);

    // 乐观并发：带上读到的 itemRevision，不是 0 也不是写端口的回声。
    await waitFor(() => expect(putBody!.expectedItemRevision).toBe("ir-1"));
    expect((JSON.parse(putBody!.value) as { rows: { name: string }[] }).rows[0]?.name).toBe("新产出");
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
          designFacets: [
            {
              designFacetKey: "outputs",
              content: JSON.stringify({ rows: [{ name: "旧产出", gen: "", to: "", required: false }] }),
              itemRevision: "ir-1",
            },
          ],
        });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/outputs` && init?.method === "PUT") {
        return jsonResponse({ reasonCode: "VERSION_CHANGED" }, 409);
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-outputs"));
    const nameInput = await screen.findByTestId("bp-out-name-0");
    fireEvent.change(nameInput, { target: { value: "并发改动" } });
    fireEvent.blur(nameInput);

    await waitFor(() =>
      expect(screen.getByTestId("bp-facet-error-outputs").textContent).toContain("刷新页面"),
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
      scenarios: [{ name: "业主首次评估", ask: "投资意愿", leadProfile: "业主代表" }],
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
    expect((screen.getByTestId("bp-grouping-scenario-question-0") as HTMLInputElement).value).toBe("投资意愿");
    expect((screen.getByTestId("bp-grouping-scenario-leader-0") as HTMLInputElement).value).toBe("业主代表");
    // 固定参考清单：规模档位与分配规则原样展示，不是可编辑项。
    expect(screen.getByTestId("bp-grouping-sizing").textContent).toContain("12–16 人");
    expect(screen.getByTestId("bp-grouping-assign-rules").textContent).toContain(
      "套用时 AI 先给一版，引导师拖拽调整",
    );
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
    const parsed = JSON.parse(putBody!.value) as { scenarios: { name: string }[] };
    expect(parsed.scenarios[0]?.name).toBe("采购比选");
  });

  it("流程 Agenda：结构化编辑器显示真实已存环节清单（JSON 解析）", async () => {
    const saved = {
      segments: [
        { no: "01", title: "开场破冰", min: 20, boardSkill: "—", optional: false },
        { no: "02", title: "商业模式草稿", min: 45, boardSkill: "画布 business-model", optional: true },
      ],
    };
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [{ designFacetKey: "flow-agenda", content: JSON.stringify(saved), itemRevision: "ir-1" }],
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    await screen.getByTestId("bp-designer-facet-flow-agenda").click();
    expect((await screen.findByTestId("bp-agenda-segment-title-0") as HTMLInputElement).value).toBe("开场破冰");
    expect((screen.getByTestId("bp-agenda-segment-min-0") as HTMLInputElement).value).toBe("20");
    expect((screen.getByTestId("bp-agenda-segment-optional-1") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("bp-agenda-list").textContent).toContain("2");
    expect(screen.getByTestId("bp-agenda-list").textContent).toContain("65");
    expect(screen.getByTestId("bp-agenda-ai-rhythm").textContent).toContain("AI 已核对过节奏");
  });

  it("流程 Agenda：加环节并编辑标题失焦，真实保存成结构化 JSON", async () => {
    let putBody: { value: string; expectedItemRevision: string } | null = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({ revision: "rev-1", designFacets: [] });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/flow-agenda` && init?.method === "PUT") {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({
          itemRevision: `ir-${(putBody as { value: string }).value.length}`,
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

    await screen.getByTestId("bp-designer-facet-flow-agenda").click();
    await screen.findByTestId("bp-agenda-empty");
    fireEvent.click(screen.getByTestId("bp-agenda-add-segment"));
    const titleInput = await screen.findByTestId("bp-agenda-segment-title-0");
    fireEvent.change(titleInput, { target: { value: "收敛环节" } });
    fireEvent.blur(titleInput);

    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { segments: { title: string }[] };
      expect(parsed.segments[0]?.title).toBe("收敛环节");
    });
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

  /* ── 分组二（问卷 / 访谈与对象 / 会前任务）── */

  function stubFacet(facetKey: string, saved: unknown, onPut?: (body: unknown) => void) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets:
            saved === null
              ? []
              : [{ designFacetKey: facetKey, content: JSON.stringify(saved), itemRevision: "ir-1" }],
        });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/${facetKey}` && init?.method === "PUT") {
        onPut?.(JSON.parse(init.body as string));
        return jsonResponse({
          itemRevision: "ir-new-1",
          completed: true,
          completeness: { done: 1, denominator: 15 },
          autosavedAt: "2026-08-18T02:00:00Z",
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
  }

  it("问卷：结构化编辑器渲染真实已存问卷卡片，不是一个自由文本框", async () => {
    fetchMock = stubFacet("survey", {
      surveys: [
        {
          name: "会前预习问卷",
          timing: "开始前 5 天发 · 60% 阻断开始",
          purpose: "让现场不用花时间对齐背景。8 题、约 6 分钟。",
          skeleton: ["你认为〔…〕最大的障碍是什么 → 生成 HMW 候选方向"],
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-survey"));
    expect((await screen.findByTestId("bp-survey-name-0")) as HTMLInputElement).toHaveValue("会前预习问卷");
    expect(screen.getByTestId("bp-survey-timing-0")).toHaveValue("开始前 5 天发 · 60% 阻断开始");
    expect(screen.getByTestId("bp-survey-question-0-0")).toHaveValue(
      "你认为〔…〕最大的障碍是什么 → 生成 HMW 候选方向",
    );
    // 反证：这一项不再落回通用自由文本编辑器。
    expect(screen.queryByTestId("bp-facet-content-survey")).toBeNull();
  });

  it("问卷：新增一份问卷并编辑名称失焦，真实保存成结构化 JSON", async () => {
    let putBody: { value: string; expectedItemRevision: string } | null = null;
    fetchMock = stubFacet("survey", null, (b) => {
      putBody = b as typeof putBody;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-survey"));
    await screen.findByTestId("bp-survey-empty");
    fireEvent.click(screen.getByTestId("bp-survey-add"));
    const nameInput = await screen.findByTestId("bp-survey-name-0");
    fireEvent.change(nameInput, { target: { value: "会后满意度问卷" } });
    fireEvent.blur(nameInput);

    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { surveys: { name: string }[] };
      expect(parsed.surveys[0]?.name).toBe("会后满意度问卷");
    });
  });

  it("访谈与对象：渲染真实角色配额与授权默认值，硬约束那条不是可关的开关", async () => {
    fetchMock = stubFacet("interview-and-subjects", {
      roles: [{ role: "客户方决策人", ask: "真实约束与不可谈判项", guide: "决策人访谈 v2", quota: 2 }],
      auth: { recordAndTranscribeByDefault: true, requestAiAnalysisByDefault: false },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-interview-and-subjects"));
    expect((await screen.findByTestId("bp-itv-role-name-0")) as HTMLInputElement).toHaveValue("客户方决策人");
    expect(screen.getByTestId("bp-itv-role-quota-0")).toHaveValue(2);
    expect(screen.getByTestId("bp-itv-plan").textContent).toContain("2 场");
    // 原型给的两个可配置默认值，按存的值回显。
    expect(screen.getByTestId("bp-itv-auth-record")).toBeChecked();
    expect(screen.getByTestId("bp-itv-auth-ai")).not.toBeChecked();
    // 硬约束那条：原型标为不可放开，界面里没有勾选框，只有说明文字。
    const hardLimit = screen.getByTestId("bp-itv-auth-hardlimit");
    expect(hardLimit.textContent).toContain("硬约束");
    expect(hardLimit.querySelector("input")).toBeNull();
    // 证据规则是固定说明，不是可编辑字段。
    expect(screen.getByTestId("bp-itv-evidence").textContent).toContain("2 个独立来源");
  });

  it("访谈与对象：勾选 AI 分析默认值，真实保存结构化 JSON", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet(
      "interview-and-subjects",
      { roles: [{ role: "一线执行者", ask: "现状卡点", guide: "JTBD", quota: 2 }], auth: {} },
      (b) => {
        putBody = b as typeof putBody;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-interview-and-subjects"));
    fireEvent.click(await screen.findByTestId("bp-itv-auth-ai"));

    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { auth: { requestAiAnalysisByDefault: boolean } };
      expect(parsed.auth.requestAiAnalysisByDefault).toBe(true);
    });
  });

  it("会前任务：渲染真实任务卡（含挂环节/不做会怎样），催办规则是固定说明卡", async () => {
    fetchMock = stubFacet("pre-tasks", {
      tasks: [
        {
          title: "带 2 个你亲历的失败案例",
          seg: "环节 03",
          forWhom: "全体",
          ifNot: "HMW 发散会停留在抽象层面，产出无法验证。",
          due: "开始前 2 天",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-pre-tasks"));
    expect((await screen.findByTestId("bp-hw-title-0")) as HTMLInputElement).toHaveValue("带 2 个你亲历的失败案例");
    expect(screen.getByTestId("bp-hw-seg-0")).toHaveValue("环节 03");
    expect(screen.getByTestId("bp-hw-ifnot-0")).toHaveValue("HMW 发散会停留在抽象层面，产出无法验证。");
    expect(screen.getByTestId("bp-hw-reminder").textContent).toContain("催办由 AI 做");
    expect(screen.queryByTestId("bp-facet-content-pre-tasks")).toBeNull();
  });

  it("会前任务：切换适用对象为「仅组长」，真实保存结构化 JSON", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet(
      "pre-tasks",
      { tasks: [{ title: "准备本组 3 分钟背景陈述", seg: "环节 01", forWhom: "全体", ifNot: "开场拖时", due: "" }] },
      (b) => {
        putBody = b as typeof putBody;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-pre-tasks"));
    fireEvent.click(await screen.findByTestId("bp-hw-audience-0-仅组长"));

    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { tasks: { forWhom: string }[] };
      expect(parsed.tasks[0]?.forWhom).toBe("仅组长");
    });
  });

  /* ── 分组三（场地与形式 / 项目材料 / 分组打印素材 / 组内能力）── */

  it("场地与形式：5 行固定空间字段真实回显，形式单选可切换并保存", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet(
      "venue-and-format",
      { space: { "主场地": "可容 16 人 · 桌椅可移动", "网络": "≥ 5Mbps" }, format: "hybrid" },
      (b) => { putBody = b as typeof putBody; },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-venue-and-format"));
    expect(await screen.findByTestId("bp-venue-space-主场地")).toHaveValue("可容 16 人 · 桌椅可移动");
    expect(screen.getByTestId("bp-venue-space-网络")).toHaveValue("≥ 5Mbps");
    // 5 行字段名恒定，不是用户可增删的自由列表。
    expect(screen.getAllByTestId(/^bp-venue-space-row-/)).toHaveLength(5);
    expect(screen.queryByTestId("bp-facet-content-venue-and-format")).toBeNull();
    // 布置图是只读示意（原型语义），4 个分组圈。
    expect(screen.getAllByTestId("bp-venue-layout-group")).toHaveLength(4);

    fireEvent.click(screen.getByTestId("bp-venue-format-online"));
    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { format: string };
      expect(parsed.format).toBe("online");
    });
  });

  it("项目材料：四列表格真实回显，切换「谁准备」保存结构化 JSON", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet(
      "project-materials",
      { rows: [{ name: "便签（4 色，76mm）", qty: "16 叠", forSeg: "03 / 04", owner: "场地方" }] },
      (b) => { putBody = b as typeof putBody; },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-project-materials"));
    expect(await screen.findByTestId("bp-mat-name-0")).toHaveValue("便签（4 色，76mm）");
    expect(screen.getByTestId("bp-mat-qty-0")).toHaveValue("16 叠");
    expect(screen.getByTestId("bp-mat-seg-0")).toHaveValue("03 / 04");
    expect(screen.getByTestId("bp-mat-footnote").textContent).toContain("按实际人数重算");
    expect(screen.queryByTestId("bp-facet-content-project-materials")).toBeNull();

    fireEvent.click(screen.getByTestId("bp-mat-owner-0-我方打印"));
    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { rows: { owner: string }[] };
      expect(parsed.rows[0]?.owner).toBe("我方打印");
    });
  });

  it("分组打印素材：尺寸单选与 AI 标记真实回显并可保存，OCR 回流是固定说明", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet(
      "print-materials",
      { items: [{ size: "A0", name: "HMW 画布", qty: "4 张 ＋ 2 备", ai: false, detail: "与 hmw 模板同构" }] },
      (b) => { putBody = b as typeof putBody; },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-print-materials"));
    expect(await screen.findByTestId("bp-print-name-0")).toHaveValue("HMW 画布");
    expect(screen.getByTestId("bp-print-qty-0")).toHaveValue("4 张 ＋ 2 备");
    expect(screen.getByTestId("bp-print-ai-0")).not.toBeChecked();
    expect(screen.getByTestId("bp-print-ocr").textContent).toContain("二维码");
    expect(screen.queryByTestId("bp-facet-content-print-materials")).toBeNull();

    fireEvent.click(screen.getByTestId("bp-print-ai-0"));
    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { items: { ai: boolean }[] };
      expect(parsed.items[0]?.ai).toBe(true);
    });
  });

  it("组内能力：7 项恒定能力，「与 AI 的对话」必留不可关，其余可开关并保存", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet("group-capabilities", { enabled: { "用户研究": false }, uses: {} }, (b) => {
      putBody = b as typeof putBody;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-group-capabilities"));
    // 能力集恒定 7 项（产品真实能力集，不是用户可增删的自由列表）。
    expect(await screen.findByTestId("bp-caps-toggle-与 AI 的对话")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^bp-caps-item-/)).toHaveLength(7);
    // 必留项：禁用且恒开，与原型「开 · 必留」一致。
    const mustKeep = screen.getByTestId("bp-caps-toggle-与 AI 的对话");
    expect(mustKeep).toBeDisabled();
    expect(mustKeep).toBeChecked();
    expect(screen.getByTestId("bp-caps-state-与 AI 的对话").textContent).toContain("必留");
    // 存的关闭态真实回显。
    expect(screen.getByTestId("bp-caps-toggle-用户研究")).not.toBeChecked();
    // 回流与可见性是固定说明，不是可编辑字段。
    expect(screen.getByTestId("bp-caps-reflow").textContent).toContain("洞察库");
    expect(screen.getByTestId("bp-caps-visibility").textContent).toContain("组员私聊");
    expect(screen.queryByTestId("bp-facet-content-group-capabilities")).toBeNull();

    fireEvent.click(screen.getByTestId("bp-caps-toggle-组内投票"));
    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { enabled: Record<string, boolean> };
      expect(parsed.enabled["组内投票"]).toBe(false);
    });
  });

  /* ── 分组四 / 分组五（Agent 编排 / Skill 绑定 / 输出物 / 报告模板）── */

  it("Agent 编排：agent 行真实回显，介入阈值可改，硬约束是只读清单", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet(
      "agent-orchestration",
      {
        agents: [{ name: "Facilitator", segs: "全程", does: "推进议程", canSpeak: true, state: "默认开" }],
        repeatThreshold: 5,
      },
      (b) => { putBody = b as typeof putBody; },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-agent-orchestration"));
    expect(await screen.findByTestId("bp-agent-name-0")).toHaveValue("Facilitator");
    expect(screen.getByTestId("bp-agent-canspeak-0")).toBeChecked();
    expect(screen.getByTestId("bp-agent-threshold")).toHaveValue(5);
    // 阈值史与三条介入规则是只读说明，硬约束四条不给任何开关。
    expect(screen.getByTestId("bp-agent-threshold-history").textContent).toContain("打断太早");
    expect(screen.getAllByTestId("bp-agent-rule")).toHaveLength(3);
    const hardLimits = screen.getAllByTestId("bp-agent-hardlimit");
    expect(hardLimits).toHaveLength(4);
    hardLimits.forEach((li) => expect(li.querySelector("input")).toBeNull());
    expect(screen.queryByTestId("bp-facet-content-agent-orchestration")).toBeNull();

    fireEvent.click(screen.getByTestId("bp-agent-state-0-按需召唤"));
    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { agents: { state: string }[] };
      expect(parsed.agents[0]?.state).toBe("按需召唤");
    });
  });

  it("Skill 绑定：降级绑定显示阻断发布警告，解绑后真实保存", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet(
      "skill-binding",
      {
        skills: [
          { seg: "03", name: "语音转便签", desc: "说出来即成便签", degraded: false },
          { seg: "03", name: "亲和图自动聚类 v2", desc: "便签自动分堆", degraded: true },
        ],
      },
      (b) => { putBody = b as typeof putBody; },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-skill-binding"));
    expect(await screen.findByTestId("bp-skill-name-0")).toHaveValue("语音转便签");
    expect(screen.getByTestId("bp-skill-seg-0")).toHaveValue("03");
    // 降级是组织层治理的投影：只读徽标 + 阻断发布警告，不是可在蓝本里关掉的开关。
    expect(screen.getByTestId("bp-skill-degraded-1")).toBeInTheDocument();
    expect(screen.queryByTestId("bp-skill-degraded-0")).toBeNull();
    expect(screen.getByTestId("bp-skill-degrade-warning").textContent).toContain("亲和图自动聚类 v2");
    expect(screen.queryByTestId("bp-facet-content-skill-binding")).toBeNull();

    fireEvent.click(screen.getByTestId("bp-skill-remove-1"));
    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { skills: { name: string }[] };
      expect(parsed.skills).toHaveLength(1);
      expect(parsed.skills[0]?.name).toBe("语音转便签");
    });
  });

  it("输出物：必须项可勾选并保存，回流规则与结项检查是只读清单", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet(
      "outputs",
      { rows: [{ name: "4 张 HMW 画布快照", gen: "组长提交后锁版本", to: "项目图谱", required: false }] },
      (b) => { putBody = b as typeof putBody; },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-outputs"));
    expect(await screen.findByTestId("bp-out-name-0")).toHaveValue("4 张 HMW 画布快照");
    expect(screen.getByTestId("bp-out-gen-0")).toHaveValue("组长提交后锁版本");
    expect(screen.getByTestId("bp-out-to-0")).toHaveValue("项目图谱");
    expect(screen.getByTestId("bp-out-required-0")).not.toBeChecked();
    expect(screen.getByTestId("bp-out-reflow").textContent).toContain("固定快照");
    expect(screen.getAllByTestId("bp-out-check")).toHaveLength(4);

    fireEvent.click(screen.getByTestId("bp-out-required-0"));
    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { rows: { required: boolean }[] };
      expect(parsed.rows[0]?.required).toBe(true);
    });
  });

  it("报告模板：章节骨架带编号，「必须人写」可勾选并保存，写作硬约束只读", async () => {
    let putBody: { value: string } | null = null;
    fetchMock = stubFacet(
      "report-template",
      { chapters: [{ title: "一页纸结论：3 个题目与推进顺序", by: "必须人写", humanRequired: false }] },
      (b) => { putBody = b as typeof putBody; },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-facet-report-template"));
    expect(await screen.findByTestId("bp-report-title-0")).toHaveValue("一页纸结论：3 个题目与推进顺序");
    expect(screen.getByTestId("bp-report-chapter-0").textContent).toContain("01");
    expect(screen.getByTestId("bp-report-internal").textContent).toContain("不给客户");
    expect(screen.getAllByTestId("bp-report-rule")).toHaveLength(4);
    expect(screen.getByTestId("bp-report-history").textContent).toContain("平均改 22 分钟");
    expect(screen.queryByTestId("bp-facet-content-report-template")).toBeNull();

    fireEvent.click(screen.getByTestId("bp-report-human-0"));
    await waitFor(() => {
      const parsed = JSON.parse(putBody!.value) as { chapters: { humanRequired: boolean }[] };
      expect(parsed.chapters[0]?.humanRequired).toBe(true);
    });
  });
});

/*
 * 机械门控：不是靠人记得「还有几项是 textbox」——把「15 项配置全部有专属结构化
 * 编辑器」钉成一条会红的断言。人类 2026-08-18 的批评正是「11/15 项仍然是通用
 * textbox」，这条测试保证它不会再悄悄退回去。
 */
describe("16 项配置面板：全部落在专属结构化编辑器上（无一落回通用自由文本框）", () => {
  it("design-facet-table 里的每一个 designFacetKey 都在 registry 上有专属编辑器", async () => {
    const { getFacetEditor } = await import("@/components/tpl-designer/facet-editor-registry");
    const { FacetTextEditor } = await import("@/components/tpl-designer/facet-content-editor");
    const { DESIGN_FACET_CATALOG } = await import("@/lib/generated/design-facet-catalog");

    const allKeys = DESIGN_FACET_CATALOG.groups.flatMap((g) => g.items.map((i) => i.designFacetKey));
    expect(allKeys.length).toBeGreaterThanOrEqual(15);

    const stillGeneric = allKeys.filter((k) => getFacetEditor(k) === FacetTextEditor);
    expect(stillGeneric).toEqual([]);
  });

  it("反证：registry 上没登记的 key 仍然落回通用编辑器（兜底没被误删）", async () => {
    const { getFacetEditor } = await import("@/components/tpl-designer/facet-editor-registry");
    const { FacetTextEditor } = await import("@/components/tpl-designer/facet-content-editor");
    expect(getFacetEditor("definitely-not-a-real-facet-key")).toBe(FacetTextEditor);
  });
});
