/**
 * #464 —— `/canvas?screen=template-admin` 与 `/admin/canvasadmin` 两屏只投影
 * `GET /canvas/templates` 的真实响应。
 *
 * 反证重点（每条都对应一次真实事故模式）：
 *  · 空数组不得回落到 mock / 示例模板「先让它显示出来」；
 *  · 读取失败不得伪装成空目录，也不得糊成一句「加载失败」——必须回显
 *    后端真实信封的 `reasonCode` 与 HTTP 状态；
 *  · 归档确认框上的「N 个环节仍绑定」必须来自 `confirmed:false` 的真实预检，
 *    不是前端一个缺省值（契约明说「返回 0 与不返回是两回事」）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-464", orgRole: "admin" }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
}));

import { TemplateAdmin } from "@/components/canvas/template-admin";
import { CanvasTemplateScreen } from "@/components/admin/canvas-template-screen";

interface TemplateRow {
  key: string;
  displayName: string;
  version: number;
  status: "draft" | "trial" | "published" | "archived";
  builtin: boolean;
  visibility: "org-wide" | "team-only";
  underlyingType: string;
  sections: { sectionId: string; name: string; order: number; required: boolean; capacity: number | null }[];
  usageCount: number;
}

function template(overrides: Partial<TemplateRow> = {}): TemplateRow {
  return {
    key: "persona",
    displayName: "用户画像",
    version: 3,
    status: "published",
    builtin: true,
    visibility: "org-wide",
    underlyingType: "canvas",
    sections: [{ sectionId: "s1", name: "基本信息", order: 0, required: true, capacity: null }],
    usageCount: 41,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** mock 清单里那几个名字是「有没有偷偷回落」的探针。 */
const MOCK_ONLY_NAMES = ["PESTEL 分析", "采购比选旅程（高琳自建）", "ESG 记分卡（试跑中）"];

describe("#464 画布模板库（/canvas?screen=template-admin）只画真实响应", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-464";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-464");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("按当前组织 GET /canvas/templates，并只渲染响应里的行", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      expect(url.pathname).toBe("/canvas/templates");
      expect(url.searchParams.get("orgId")).toBe("org-464");
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-464");
      return jsonResponse({ templates: [template(), template({ key: "swot", displayName: "SWOT 分析", version: 2, usageCount: 30 })] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TemplateAdmin previewRole="facilitator" />);

    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());
    expect(screen.getByTestId("tpladmin-row-swot-2")).toBeInTheDocument();
    expect(screen.getByText("用户画像")).toBeInTheDocument();
    // 反证：响应里没有的模板，一个都不许出现。
    for (const name of MOCK_ONLY_NAMES) expect(screen.queryByText(name)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("空响应 = 真实空态，不塞任何示例模板", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [] })));

    render(<TemplateAdmin previewRole="facilitator" />);

    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("tpladmin-table")).toBeNull();
    for (const name of MOCK_ONLY_NAMES) expect(screen.queryByText(name)).toBeNull();
  });

  it("读取失败回显后端真实信封：reasonCode + HTTP 状态，不糊成一句「加载失败」", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503)));

    render(<TemplateAdmin previewRole="facilitator" />);

    const error = await screen.findByTestId("tpladmin-error");
    expect(error.textContent).toContain("DEPENDENCY_UNAVAILABLE");
    expect(error.textContent).toContain("503");
    // 失败不得伪装成空目录。
    expect(screen.queryByTestId("tpladmin-empty")).toBeNull();
  });

  it("筛选按状态打到服务端的 filter 参数，不在前端另过滤一遍", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      seen.push(url.searchParams.get("filter") ?? "<none>");
      return jsonResponse({ templates: [template()] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-filter-archived"));
    await waitFor(() => expect(seen).toContain("archived"));
  });

  it("归档确认框上的影响面来自 confirmed:false 的真实预检；确认后 confirmed:true 并重新拉表", async () => {
    const calls: { path: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST") {
        calls.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
        return jsonResponse({ status: "archived", stillBoundSegmentCount: 7 });
      }
      return jsonResponse({ templates: [template()] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-archive-persona-3"));

    const impact = await screen.findByTestId("tpladmin-archive-impact");
    expect(impact.textContent).toContain("7");
    expect(calls[0]).toEqual({
      path: "/canvas/templates/persona/archive",
      body: { key: "persona", version: 3, confirmed: false },
    });

    fireEvent.click(screen.getByTestId("tpladmin-archive-confirm"));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body).toEqual({ key: "persona", version: 3, confirmed: true });
  });

  it("归档预检失败也回显真实信封，且不打开一个数字来路不明的确认框", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse({ reasonCode: "BUILTIN_TEMPLATE_UNDELETABLE" }, 403);
      return jsonResponse({ templates: [template()] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tpladmin-archive-persona-3"));

    const error = await screen.findByTestId("tpladmin-action-error");
    expect(error.textContent).toContain("BUILTIN_TEMPLATE_UNDELETABLE");
    expect(error.textContent).toContain("403");
    expect(screen.queryByTestId("tpladmin-archive-impact")).toBeNull();
  });

  it("已归档行提供恢复，打到真实 restore 端点并重新拉表", async () => {
    const posts: { path: string; body: unknown }[] = [];
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST") {
        posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
        return jsonResponse({ status: "draft" });
      }
      listCalls += 1;
      return jsonResponse({ templates: [template({ key: "esg", displayName: "ESG", version: 1, status: "archived", builtin: false })] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-esg-1")).toBeInTheDocument());
    expect(listCalls).toBe(1);

    fireEvent.click(screen.getByTestId("tpladmin-restore-esg-1"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ path: "/canvas/templates/esg/restore", body: { key: "esg", version: 1 } });
    // 写完必须回服务端重新读：否则屏上那一行是前端自己猜的状态。
    await waitFor(() => expect(listCalls).toBe(2));
  });

  it("观察者视角不挂写入口——降噪；真正的拒绝仍在服务端", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [template()] })));

    render(<TemplateAdmin previewRole="observer" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());
    expect(screen.queryByTestId("tpladmin-archive-persona-3")).toBeNull();
  });
});

describe("#464 后台画布模板屏（/admin/canvasadmin）只投影真实响应", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-464";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-464");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("列出真实模板行，并保留通往模板库的去向", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      expect(url.pathname).toBe("/canvas/templates");
      expect(url.searchParams.get("orgId")).toBe("org-464");
      return jsonResponse({ templates: [template({ key: "bmc", displayName: "商业模式画布", version: 3, usageCount: 34 })] });
    }));

    render(<CanvasTemplateScreen />);

    const list = await screen.findByTestId("admin-canvasadmin-list");
    expect(within(list).getByText("商业模式画布")).toBeInTheDocument();
    expect(screen.getByTestId("admin-canvasadmin-open-editor")).toBeInTheDocument();
    for (const name of MOCK_ONLY_NAMES) expect(screen.queryByText(name)).toBeNull();
  });

  it("空响应 = 真实空态；读取失败回显 reasonCode + HTTP 状态", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [] })));
    const empty = render(<CanvasTemplateScreen />);
    await waitFor(() => expect(screen.getByTestId("admin-canvasadmin-empty")).toBeInTheDocument());
    empty.unmount();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ reasonCode: "NO_PROJECT_ROLE" }, 403)));
    render(<CanvasTemplateScreen />);
    const error = await screen.findByTestId("admin-canvasadmin-error");
    expect(error.textContent).toContain("NO_PROJECT_ROLE");
    expect(error.textContent).toContain("403");
    expect(screen.queryByTestId("admin-canvasadmin-empty")).toBeNull();
  });
});

/**
 * 🟡 #496 —— 新建模板这条**写**路径。该契约面待人类补签，见
 * `packages/contracts/src/canvas.ts` 的 `createTemplate` 文件头。
 *
 * 三件事在这里被证明：
 *  ① 请求真的发到了契约声明的 `POST /canvas/templates`，请求体是契约 `in` 的五栏；
 *  ② 建完**不**自动发布 —— 界面上不许出现「新建即可用」；
 *  ③ 建完重新拉表，而不是把新行插进本地 state（那种实现刷新后就消失）。
 *
 * ⚠ 组件测试证不了「刷新后仍在」：这里的「刷新」只是再调一次 fetch mock。
 *   那一条只有真浏览器 + 真 PostgreSQL 才算数，在 `e2e/canvas-template-create-smoke.spec.ts`。
 */
describe("#496 新建画布模板（待补签的契约面）", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-496";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-496");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("提交打的是 POST /canvas/templates，请求体正好是契约 in 的五栏", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST") {
        posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return jsonResponse({
          key: "swot", displayName: "SWOT 分析", version: 1, status: "draft",
          builtin: false, visibility: "org-wide", underlyingType: "canvas",
          sections: [{ sectionId: "s1", name: "优势", order: 0, required: false, capacity: null }],
        }, 201);
      }
      listCalls += 1;
      // 第二次拉表时那一行已经在服务端了 —— 界面显示的是**重新读到的**结果。
      return jsonResponse({
        templates: listCalls === 1
          ? []
          : [template({ key: "swot", displayName: "SWOT 分析", version: 1, status: "draft", builtin: false, usageCount: 0 })],
      });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-create"));
    fireEvent.change(screen.getByTestId("tpladmin-create-key"), { target: { value: "swot" } });
    fireEvent.change(screen.getByTestId("tpladmin-create-name"), { target: { value: "SWOT 分析" } });
    fireEvent.change(screen.getByTestId("tpladmin-create-section-0"), { target: { value: "优势" } });
    fireEvent.click(screen.getByTestId("tpladmin-create-submit"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/canvas/templates");
    // 逐字相等而不是 toMatchObject：多一栏也要红 —— 契约的 in 是 `.strict()`，
    // 前端多发一栏在服务端是 400，而 toMatchObject 看不见多出来的那一栏。
    expect(posts[0]!.body).toEqual({
      key: "swot",
      displayName: "SWOT 分析",
      underlyingType: "canvas",
      visibility: "org-wide",
      sections: [{ sectionId: "s1", name: "优势", order: 0, required: false, capacity: null }],
    });

    // ② 只发了这一个 POST：建完没有顺手 publish。
    expect(posts.map((p) => p.path)).toEqual(["/canvas/templates"]);
    // ③ 重新拉了表，且新行以**草稿**出现（不是「已发布」）。
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-swot-1")).toBeInTheDocument());
    expect(within(screen.getByTestId("tpladmin-row-swot-1")).getByText("草稿")).toBeInTheDocument();
    expect(listCalls).toBeGreaterThan(1);
  });

  it("空名字的分区不提交 —— 一行没填的输入框不是一个分区", async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({
          key: "blank", displayName: "空模板", version: 1, status: "draft", builtin: false,
          visibility: "org-wide", underlyingType: "canvas", sections: [],
        }, 201);
      }
      return jsonResponse({ templates: [] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-create"));
    fireEvent.change(screen.getByTestId("tpladmin-create-key"), { target: { value: "blank" } });
    fireEvent.change(screen.getByTestId("tpladmin-create-name"), { target: { value: "空模板" } });
    fireEvent.click(screen.getByTestId("tpladmin-create-submit"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.sections).toEqual([]);
  });

  it("key 冲突回显成一件用户能自己解决的事，且对话框不关", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse({ reasonCode: "TEMPLATE_KEY_CONFLICT" }, 409);
      return jsonResponse({ templates: [] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-create"));
    fireEvent.change(screen.getByTestId("tpladmin-create-key"), { target: { value: "persona" } });
    fireEvent.change(screen.getByTestId("tpladmin-create-name"), { target: { value: "撞名" } });
    fireEvent.click(screen.getByTestId("tpladmin-create-submit"));

    const error = await screen.findByTestId("tpladmin-create-error");
    expect(error.textContent).toContain("已被占用");
    expect(error.textContent).toContain("TEMPLATE_KEY_CONFLICT"); // 真实码仍然可见
    // 对话框留着：用户改个 key 就能重试，不必从头再填一遍。
    expect(screen.getByTestId("tpladmin-create-dialog")).toBeInTheDocument();
  });

  it("发布用的是那一行自己的 visibility，不在界面上让人再挑一次", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST") {
        posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return jsonResponse({ key: "swot", version: 1, status: "published", archivedVersions: [] });
      }
      return jsonResponse({
        templates: [template({
          key: "swot", displayName: "SWOT 分析", version: 1, status: "draft",
          builtin: false, visibility: "team-only", usageCount: 0,
        })],
      });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-publish-swot-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-publish-swot-1"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/canvas/templates/swot/publish");
    expect(posts[0]!.body).toEqual({ key: "swot", version: 1, visibility: "team-only" });
  });

  it("已发布的行没有发布按钮 —— 状态机不由界面重述一遍", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [template()] })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());
    expect(screen.queryByTestId("tpladmin-publish-persona-3")).toBeNull();
    expect(screen.getByTestId("tpladmin-archive-persona-3")).toBeInTheDocument();
  });

  it("观察者视角不挂新建入口（降噪，不是权限 —— 真正的拒绝在服务端）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [] })));
    render(<TemplateAdmin previewRole="observer" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("tpladmin-create")).toBeNull();
  });
});
