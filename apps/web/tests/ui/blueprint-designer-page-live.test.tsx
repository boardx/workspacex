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
  completeness: { done: 2, denominator: 13 }, // 13 = DESIGN_FACET_DEFINITIONS.length（roles-and-perms/group-capabilities 已移除，15→13）
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
    expect(screen.getByTestId("bp-designer-completeness").textContent).toContain("2/13");
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
          completeness: { done: 3, denominator: 13 }, // 13：同上
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
    // 完成度是 PUT 响应里的 3/13，不是前端本地 +1 猜出来的。
    await waitFor(() => expect(screen.getByTestId("bp-designer-completeness").textContent).toContain("3/13"));
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
    // 固定参考内容：生成与校验规则原样展示，不是可编辑项（原型 TOPIC_PANEL.genRules）。
    expect(screen.getByTestId("bp-topic-genrules").textContent).toContain(
      "套用时 AI 先出草稿，引导师改完才算定题",
    );
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
          completeness: { done: 1, denominator: 13 }, // 13：同上
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
          completeness: { done: 1, denominator: 13 }, // 13：同上
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
          completeness: { done: 1, denominator: 13 }, // 13：同上
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

  it("流程 Agenda：抓左侧握把拖动重排，松手后编号重算并真实保存", async () => {
    const saved = {
      segments: [
        { no: "01", title: "对齐目标", min: 25, boardSkill: "—", optional: false },
        { no: "02", title: "现状共识", min: 25, boardSkill: "Scout 简报", optional: false },
        { no: "03", title: "假设风暴", min: 60, boardSkill: "画布 hmw", optional: false },
      ],
    };
    let putBody: { value: string } | null = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [{ designFacetKey: "flow-agenda", content: JSON.stringify(saved), itemRevision: "ir-1" }],
        });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/flow-agenda` && init?.method === "PUT") {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({
          itemRevision: "ir-2",
          completed: true,
          completeness: { done: 1, denominator: 13 }, // 13：同上
          autosavedAt: "2026-08-17T02:00:00Z",
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());
    await screen.getByTestId("bp-designer-facet-flow-agenda").click();
    await screen.findByTestId("bp-agenda-segment-title-0");

    // 抓手可达（键盘/屏幕阅读器可发现），且不是整行拖动——只有这个握把响应指针事件。
    const grip0 = screen.getByTestId("bp-agenda-segment-grip-0");
    expect(grip0).toHaveAttribute("aria-label", "拖动排序：对齐目标");
    const row2 = screen.getByTestId("bp-agenda-segment-2");

    // jsdom 压根没实现 elementFromPoint（不是"恒返回 null"，是方法不存在），真实浏览器
    // 里由指针坐标算出悬停行；单测里补一个打桩实现，命中拖到的那一行，不改变生产代码
    // 依赖的接口。
    document.elementFromPoint = () => row2.querySelector("input")!;

    fireEvent.pointerDown(grip0, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(grip0, { pointerId: 1, clientX: 0, clientY: 200 });
    fireEvent.pointerUp(grip0, { pointerId: 1 });

    // 拖到第 3 行位置：原来第 0 行（对齐目标）现在应该在第 2 行（索引 2）。
    await waitFor(() => {
      expect((screen.getByTestId("bp-agenda-segment-title-2") as HTMLInputElement).value).toBe("对齐目标");
    });
    // 编号按新顺序重算——原来排第 3 的环节顶到第 1 位，编号变成 01。
    expect(screen.getByTestId("bp-agenda-segment-2").textContent).toContain("03");

    // 松手真实落库，且发的是重排后的顺序。
    await waitFor(() => expect(putBody).not.toBeNull());
    const parsed = JSON.parse(putBody!.value) as { segments: { title: string; no: string }[] };
    expect(parsed.segments.map((s) => s.title)).toEqual(["现状共识", "假设风暴", "对齐目标"]);
    expect(parsed.segments.map((s) => s.no)).toEqual(["01", "02", "03"]);
  });

  it("流程 Agenda：拖到别的分组（上午→下午）——被拖环节的 day/session 跟着改，不需要再点选择器", async () => {
    const saved = {
      segments: [
        { no: "01", title: "环节甲", min: 20, boardSkill: "", optional: false, day: 1, session: "AM" },
        { no: "02", title: "环节乙", min: 20, boardSkill: "", optional: false, day: 1, session: "PM" },
      ],
    };
    let putBody: { value: string } | null = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [{ designFacetKey: "flow-agenda", content: JSON.stringify(saved), itemRevision: "ir-1" }],
        });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/flow-agenda` && init?.method === "PUT") {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({
          itemRevision: "ir-2",
          completed: true,
          completeness: { done: 1, denominator: 13 },
          autosavedAt: "2026-08-17T02:00:00Z",
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());
    await screen.getByTestId("bp-designer-facet-flow-agenda").click();
    await screen.findByTestId("bp-agenda-segment-title-0");

    // 拖之前两个环节分属不同分组（标题是 <input value>，不进 textContent，按 value 查）。
    expect(screen.getByTestId("bp-agenda-group-1-AM")).toBeInTheDocument();
    expect(screen.getByTestId("bp-agenda-group-1-PM")).toBeInTheDocument();
    expect((screen.getByTestId("bp-agenda-segment-title-0") as HTMLInputElement).value).toBe("环节甲");
    expect((screen.getByTestId("bp-agenda-segment-title-1") as HTMLInputElement).value).toBe("环节乙");

    const grip0 = screen.getByTestId("bp-agenda-segment-grip-0"); // 环节甲，day1/AM
    const row1 = screen.getByTestId("bp-agenda-segment-1"); // 环节乙，day1/PM
    document.elementFromPoint = () => row1.querySelector("input")!;

    fireEvent.pointerDown(grip0, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(grip0, { pointerId: 1, clientX: 0, clientY: 200 });
    fireEvent.pointerUp(grip0, { pointerId: 1 });

    // 拖过去之后，"第 1 天 · 上午"这个分组标题整个消失了（没环节了），两个环节都并到
    // 「第 1 天 · 下午」下面——不是拖不动，也不需要再去点行内选择器。
    await waitFor(() => {
      expect(screen.queryByTestId("bp-agenda-group-1-AM")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("bp-agenda-group-1-PM")).toBeInTheDocument();
    expect((screen.getByTestId("bp-agenda-segment-title-0") as HTMLInputElement).value).toBe("环节乙");
    expect((screen.getByTestId("bp-agenda-segment-title-1") as HTMLInputElement).value).toBe("环节甲");

    await waitFor(() => expect(putBody).not.toBeNull());
    const parsed = JSON.parse(putBody!.value) as {
      segments: { title: string; day: number; session: string }[];
    };
    expect(parsed.segments.map((s) => s.title)).toEqual(["环节乙", "环节甲"]);
    expect(parsed.segments.every((s) => s.day === 1 && s.session === "PM")).toBe(true);
  });

  it("流程 Agenda：pointercancel（松手前指针被系统抢走）也和 pointerup 一样落库", async () => {
    const saved = {
      segments: [
        { no: "01", title: "对齐目标", min: 25, boardSkill: "—", optional: false },
        { no: "02", title: "现状共识", min: 25, boardSkill: "Scout 简报", optional: false },
      ],
    };
    let putBody: { value: string } | null = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [{ designFacetKey: "flow-agenda", content: JSON.stringify(saved), itemRevision: "ir-1" }],
        });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/flow-agenda` && init?.method === "PUT") {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({
          itemRevision: "ir-2",
          completed: true,
          completeness: { done: 1, denominator: 13 },
          autosavedAt: "2026-08-17T02:00:00Z",
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());
    await screen.getByTestId("bp-designer-facet-flow-agenda").click();
    await screen.findByTestId("bp-agenda-segment-title-0");

    const grip0 = screen.getByTestId("bp-agenda-segment-grip-0");
    const row1 = screen.getByTestId("bp-agenda-segment-1");
    document.elementFromPoint = () => row1.querySelector("input")!;

    fireEvent.pointerDown(grip0, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(grip0, { pointerId: 1, clientX: 0, clientY: 100 });
    fireEvent.pointerCancel(grip0, { pointerId: 1 }); // 不是 pointerup——系统手势/多指触摸会抢走指针

    await waitFor(() => {
      expect((screen.getByTestId("bp-agenda-segment-title-1") as HTMLInputElement).value).toBe("对齐目标");
    });
    await waitFor(() => expect(putBody).not.toBeNull());
    const parsed = JSON.parse(putBody!.value) as { segments: { title: string }[] };
    expect(parsed.segments.map((s) => s.title)).toEqual(["现状共识", "对齐目标"]);
  });

  it("流程 Agenda：自动保存的回声回来之后，正在编辑的那一行不会重新挂载，输入不丢", async () => {
    let putCount = 0;
    let lastPutBody: { value: string } | null = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({ revision: "rev-1", designFacets: [] });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/flow-agenda` && init?.method === "PUT") {
        putCount += 1;
        lastPutBody = JSON.parse(init.body as string);
        return jsonResponse({
          itemRevision: `ir-${putCount}`,
          completed: true,
          completeness: { done: 1, denominator: 13 },
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

    // 新增环节触发第一次保存——显式等它的回声（父组件把新 content/itemRevision 传回来）
    // 真的落地之后再继续操作，逼出"保存回声打断正在编辑的行"这条路径。
    await waitFor(() => expect(putCount).toBe(1));
    await screen.findByTestId("bp-facet-save-status"); // "已保存" 徽标出现，回声已经生效

    const titleInput = screen.getByTestId("bp-agenda-segment-title-0") as HTMLInputElement;
    titleInput.focus();
    expect(document.activeElement).toBe(titleInput);

    fireEvent.change(titleInput, { target: { value: "收敛环节" } });
    // 回声没有让这一行重新挂载：同一个 DOM 节点还在文档里，还是焦点所在。
    expect(document.activeElement).toBe(titleInput);
    expect(document.body.contains(titleInput)).toBe(true);
    fireEvent.blur(titleInput);

    await waitFor(() => expect(putCount).toBe(2));
    const parsed = JSON.parse((lastPutBody as unknown as { value: string }).value) as {
      segments: { title: string }[];
    };
    expect(parsed.segments[0]?.title).toBe("收敛环节");
  });

  it("流程 Agenda：开了「减弱动态效果」时，拖拽重排不再对行设置位移动画", async () => {
    const saved = {
      segments: [
        { no: "01", title: "对齐目标", min: 25, boardSkill: "—", optional: false },
        { no: "02", title: "现状共识", min: 25, boardSkill: "Scout 简报", optional: false },
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
      return jsonResponse({ itemRevision: "ir-2", completed: true, completeness: { done: 1, denominator: 13 } });
    });
    vi.stubGlobal("fetch", fetchMock);

    // 假装两行的 getBoundingClientRect 不一样（真实浏览器里重排后确实不一样），
    // 否则 dx/dy 恒为 0，测不出"到底有没有设置位移动画"这件事。
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const idx = this.getAttribute("data-agenda-index");
      const top = idx !== null ? Number(idx) * 40 : 0;
      return { top, left: 0, right: 0, bottom: top, width: 100, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    // 用真的 rAF 打桩（同步执行 + 记调用次数）——不依赖 jsdom 到底有没有实现它。
    const rafSpy = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    try {
      render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
      await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());
      await screen.getByTestId("bp-designer-facet-flow-agenda").click();
      await screen.findByTestId("bp-agenda-segment-title-0");

      const grip0 = screen.getByTestId("bp-agenda-segment-grip-0");
      const row1 = screen.getByTestId("bp-agenda-segment-1");
      document.elementFromPoint = () => row1.querySelector("input")!;

      fireEvent.pointerDown(grip0, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
      fireEvent.pointerMove(grip0, { pointerId: 1, clientX: 0, clientY: 200 });
      fireEvent.pointerUp(grip0, { pointerId: 1 });

      await waitFor(() => {
        expect((screen.getByTestId("bp-agenda-segment-title-1") as HTMLInputElement).value).toBe("对齐目标");
      });
      // 减弱动态效果开着：FLIP 那段 requestAnimationFrame 压根没跑过，行上也没被设过
      // transform——不是"动画很快跑完了"，是根本没有触发。
      expect(rafSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("bp-agenda-segment-1").style.transform).toBe("");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it("流程 Agenda：拖拽之外，上移/下移按钮仍原样可用（键盘/屏幕阅读器兜底）", async () => {
    const saved = {
      segments: [
        { no: "01", title: "环节甲", min: 20, boardSkill: "", optional: false },
        { no: "02", title: "环节乙", min: 20, boardSkill: "", optional: false },
      ],
    };
    let putBody: { value: string } | null = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({
          revision: "rev-1",
          designFacets: [{ designFacetKey: "flow-agenda", content: JSON.stringify(saved), itemRevision: "ir-1" }],
        });
      }
      if (url.pathname === `/blueprints/${BP_ID}/design-facets/flow-agenda` && init?.method === "PUT") {
        putBody = JSON.parse(init.body as string);
        return jsonResponse({
          itemRevision: "ir-2",
          completed: true,
          completeness: { done: 1, denominator: 13 }, // 13：同上
          autosavedAt: "2026-08-17T02:00:00Z",
        });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());
    await screen.getByTestId("bp-designer-facet-flow-agenda").click();
    await screen.findByTestId("bp-agenda-segment-title-0");

    fireEvent.click(screen.getByTestId("bp-agenda-segment-down-0"));
    await waitFor(() => expect(putBody).not.toBeNull());
    const parsed = JSON.parse(putBody!.value) as { segments: { title: string }[] };
    expect(parsed.segments.map((s) => s.title)).toEqual(["环节乙", "环节甲"]);
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
          completeness: { done: 1, denominator: 13 }, // 13：同上
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
    // 原型的固定说明（此前整句没渲染，2026-08-19 差距审计补回）。
    expect(screen.getByTestId("bp-skill-generic-note").textContent).toContain("其余 4 个为全程可用的通用 skill");
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
    // 「中英双语」是原型标题里的固定说明，此前丢了（2026-08-19 差距审计补回）；
    // 章数用真实计数，不是原型写死的示例数字 18。
    expect(screen.getByTestId("bp-report-client").textContent).toContain("1 章骨架（中英双语）");
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
 * 机械门控：不是靠人记得「还有几项是 textbox」——把「配置项定义表里的每一项都有
 * 专属结构化编辑器」钉成一条会红的断言。人类 2026-08-18 的批评正是「11/15 项
 * 仍然是通用 textbox」（当时表里是 15 项），这条测试保证它不会再悄悄退回去；
 * 2026-08-31 产品决策移除 `roles-and-perms`/`group-capabilities` 后表降为 13 项，
 * 断言的分母改成从 `DESIGN_FACET_CATALOG` 派生而不是写死字面量，改表不用改这里。
 */
describe("配置面板：全部落在专属结构化编辑器上（无一落回通用自由文本框）", () => {
  it("design-facet-table 里的每一个 designFacetKey 都在 registry 上有专属编辑器", async () => {
    const { getFacetEditor } = await import("@/components/tpl-designer/facet-editor-registry");
    const { FacetTextEditor } = await import("@/components/tpl-designer/facet-content-editor");
    const { DESIGN_FACET_CATALOG } = await import("@/lib/generated/design-facet-catalog");

    const allKeys = DESIGN_FACET_CATALOG.groups.flatMap((g) => g.items.map((i) => i.designFacetKey));
    // 13 = DESIGN_FACET_DEFINITIONS.length（roles-and-perms/group-capabilities 已移除）；
    // 分母从 catalog 派生，不写死字面量。
    expect(allKeys.length).toBe(DESIGN_FACET_CATALOG.denominator);
    expect(allKeys.length).toBe(13);

    const stillGeneric = allKeys.filter((k) => getFacetEditor(k) === FacetTextEditor);
    expect(stillGeneric).toEqual([]);
  });

  it("反证：registry 上没登记的 key 仍然落回通用编辑器（兜底没被误删）", async () => {
    const { getFacetEditor } = await import("@/components/tpl-designer/facet-editor-registry");
    const { FacetTextEditor } = await import("@/components/tpl-designer/facet-content-editor");
    expect(getFacetEditor("definitely-not-a-real-facet-key")).toBe(FacetTextEditor);
  });
});

/*
 * 「基本配置」聚合页 —— 13 个 designFacetKey 之外唯一的一项，
 * 走 setDurationTier / getInitializationPreview 两个契约操作而不是 facet 读写。
 */
describe("「基本配置」聚合页：真实 setDurationTier + getInitializationPreview", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-bp06");
  });
  afterEach(() => vi.restoreAllMocks());

  function stubBasic(opts: {
    preview?: unknown;
    previewStatus?: number;
    onTierPut?: (body: unknown) => void;
    tierResponse?: () => Response;
  }) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/blueprints") return jsonResponse([REAL_ROW]);
      if (url.pathname === `/blueprints/${BP_ID}/design-facets`) {
        return jsonResponse({ revision: "rev-1", designFacets: [] });
      }
      if (url.pathname === `/blueprints/${BP_ID}/initialization-preview`) {
        return jsonResponse(opts.preview ?? { categories: [], items: [] }, opts.previewStatus ?? 200);
      }
      if (url.pathname === `/blueprints/${BP_ID}/duration-tier` && init?.method === "PUT") {
        opts.onTierPut?.(JSON.parse(init.body as string));
        return opts.tierResponse
          ? opts.tierResponse()
          : jsonResponse({ agendaSegmentCount: 11, added: [], removed: [], recoverable: [] });
      }
      throw new Error(`unexpected fetch: ${url.pathname} ${init?.method ?? "GET"}`);
    });
  }

  it("初始化预览六类恒定：空类也渲染，「没有」与「不初始化」可分辨", async () => {
    fetchMock = stubBasic({
      preview: {
        categories: ["议程环节"],
        items: [{ category: "议程环节", key: "seg-1", label: "对齐目标" }],
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-basic-overview-entry"));
    await screen.findByTestId("bp-basic-overview");

    // 六类恒定——只回了一类数据，其余五类也必须出现，且明确写出「这一类不会初始化」。
    for (const c of ["议程环节", "分组", "角色分工", "材料清单", "会前任务", "画布与产出物"]) {
      expect(screen.getByTestId(`bp-basic-init-category-${c}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("bp-basic-init-category-议程环节").textContent).toContain("对齐目标");
    expect(screen.getByTestId("bp-basic-init-empty-分组")).toBeInTheDocument();
    expect(screen.queryByTestId("bp-basic-init-empty-议程环节")).toBeNull();
    expect(screen.getByTestId("bp-basic-init-footnote").textContent).toContain("不会回写蓝本");
  });

  it("换档是两步：先预检（confirmed:false）看清增删，确认后才真正落库（confirmed:true）", async () => {
    const puts: { tier: string; confirmed: boolean; expectedVersion: string }[] = [];
    fetchMock = stubBasic({
      onTierPut: (b) => puts.push(b as (typeof puts)[number]),
      tierResponse: () =>
        puts.length === 1
          ? // 预检：后端要求确认，并附上将被增删的环节。
            new Response(
              JSON.stringify({
                reasonCode: "CONFIRMATION_REQUIRED",
                detail: {
                  agendaSegmentCount: 7,
                  added: [],
                  removed: [
                    { agendaSegmentId: "s-4", title: "组间互评", addedBy: null, optional: true },
                    { agendaSegmentId: "s-7", title: "原型搭建", addedBy: null, optional: true },
                  ],
                  recoverable: [
                    { agendaSegmentId: "s-4", title: "组间互评", addedBy: null, optional: true },
                    { agendaSegmentId: "s-7", title: "原型搭建", addedBy: null, optional: true },
                  ],
                },
              }),
              { status: 409, headers: { "Content-Type": "application/json" } },
            )
          : jsonResponse({ agendaSegmentCount: 7, added: [], removed: [], recoverable: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-basic-overview-entry"));
    await screen.findByTestId("bp-basic-overview");
    // 档位一节复用 F19 的 BlueprintDurationForm——四档的环节数来自生成的
    // agenda-tier-catalog（前端没有 7/11/14/19 的第二份硬编码）。
    // REAL_ROW 的 durationTier 是 custom（不在可排序四档里），因此没有任何一档被高亮，
    // 如实反映「当前不是这四档之一」而不是随便挑一个亮起来。
    expect(screen.getByTestId("bp-duration-tier-half-day").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("bp-duration-tier-two-day").getAttribute("aria-pressed")).toBe("false");
    // 每档一句「比上一档多出什么」的说明——原型渲染在按钮标签下方，此前 F207 复用
    // BlueprintDurationForm 时整段没带过来（2026-08-19 差距审计发现，已补回）。
    expect(screen.getByTestId("bp-duration-tier-note-half-day").textContent).toBe("只到收敛，不做原型");
    expect(screen.getByTestId("bp-duration-tier-note-two-day").textContent).toBe("加原型与用户测试");

    fireEvent.click(screen.getByTestId("bp-duration-tier-half-day"));

    // 第一次一定是预检：confirmed=false，且带上真实 expectedVersion（乐观并发）。
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ tier: "half-day", confirmed: false, expectedVersion: "0" });

    // 预检结果如实展示：逐条列出**将被移除的环节名**（不是只报个数字——
    // 契约的 AgendaSegmentRef 本来就带 title，报数字等于白扔已有信息），
    // 并写明其中可恢复的那些切回该档会回来。
    const confirmBox = await screen.findByTestId("bp-duration-tier-confirm");
    expect(confirmBox.textContent).toContain("会移除 2 个议程环节");
    expect(screen.getByTestId("bp-duration-tier-confirm-removed-s-4").textContent).toContain("组间互评");
    expect(screen.getByTestId("bp-duration-tier-confirm-removed-s-7").textContent).toContain("原型搭建");
    expect(screen.getByTestId("bp-basic-recoverable").textContent).toContain("切回该档位它们会回来");

    // 确认后才是 confirmed=true 的落库请求。
    fireEvent.click(screen.getByTestId("bp-duration-tier-confirm-confirm"));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]!.confirmed).toBe(true);
  });

  it("取消预检：不发落库请求，档位不变（不替用户拍板删环节）", async () => {
    const puts: unknown[] = [];
    fetchMock = stubBasic({
      onTierPut: (b) => puts.push(b),
      tierResponse: () =>
        new Response(
          JSON.stringify({
            reasonCode: "CONFIRMATION_REQUIRED",
            detail: {
              agendaSegmentCount: 7,
              added: [],
              removed: [{ agendaSegmentId: "s-4", title: "组间互评", addedBy: null, optional: true }],
              recoverable: [],
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("bp-designer-basic-overview-entry"));
    await screen.findByTestId("bp-basic-overview");
    fireEvent.click(screen.getByTestId("bp-duration-tier-one-day"));
    await screen.findByTestId("bp-duration-tier-confirm");

    fireEvent.click(screen.getByTestId("bp-duration-tier-confirm-cancel"));
    await waitFor(() => expect(screen.queryByTestId("bp-duration-tier-confirm")).toBeNull());
    // 只有那一次预检，没有第二次落库请求。
    expect(puts).toHaveLength(1);
  });

  it("预览读失败：只有那一节如实报错，其余 13 项照常能打开（不让整个设计器打不开）", async () => {
    fetchMock = stubBasic({ preview: { reasonCode: "DEPENDENCY_UNAVAILABLE" }, previewStatus: 503 });
    vi.stubGlobal("fetch", fetchMock);
    render(<BlueprintDesignerPageLive blueprintId={BP_ID} />);
    await waitFor(() => expect(screen.getByTestId("bp-designer-shell")).toBeInTheDocument());

    // 反证：整个设计器没有被这一次失败打掉。
    expect(screen.queryByTestId("bp-designer-load-error")).toBeNull();
    fireEvent.click(screen.getByTestId("bp-designer-facet-topic-and-background"));
    expect(await screen.findByTestId("bp-topic-statement-input")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("bp-designer-basic-overview-entry"));
    expect(await screen.findByTestId("bp-basic-preview-error")).toBeInTheDocument();
    // 档位那一节仍然可用。
    expect(screen.getByTestId("bp-basic-tier")).toBeInTheDocument();
  });
});
