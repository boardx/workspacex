/**
 * #464 —— `/canvas?screen=template-admin` 只投影 `GET /canvas/templates` 的真实响应。
 * D-43（2026-08-15）起，这也是 `/admin/canvasadmin` 重定向后的合并落点（见文件尾
 * 「D-43 …源码级回归」那组）。
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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { ADMIN_NAV, type AdminModuleKey } from "@/lib/mock/admin";
import { ROOT } from "../session/import-closure";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-464", orgRole: "admin" }));

// 只有下方 D-43 那组测试会真的挂 `CanvasHub`（经由 `AppShell` → `SessionAppShell`，
// 后者用 `useRouter`）——其余测试直接渲染 `TemplateAdmin` 本体，用不上这个 mock，
// 但 `vi.mock` 是模块级提升的，放这里不影响它们。
/**
 * #9（2026-08-22）：`routerReplace` 是**共享**的 spy——`TemplateAdmin` 每次筛选/视图/
 * 搜索词变化都调 `router.replace` 同步 URL，测试要能断言「调用过、调了什么」，
 * 不能每次 `useRouter()` 都发一个新 `vi.fn()`（那样测试拿不到调用记录）。
 */
const routerReplace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/canvas",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
  // `AdminNav`（现在挂在 `CanvasHub` 的 template-admin 屏左栏）用这一个而不是 `useSession`——
  // 它设计上允许无 Provider 裸渲染，但 `CanvasHub` 是经 `AppShell` → `SessionAppShell`
  // 挂载的，后者要一份完整的 `SessionContextValue`（`status`/`organizations` 等），
  // 不是上面 `useSession` 那份只给 `TemplateAdmin` 用的精简版。
  useOptionalSession: () => ({
    status: "authenticated",
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      displayName: "测试用户",
      avatarUrl: null,
      orgRole: sessionState.orgRole,
      org: {
        id: sessionState.currentOrgId, name: "真实组织", kind: "organization",
        team: null, modelPolicy: "any", avatarUrl: null,
      },
      projectRole: null,
      projectName: null,
      groupName: null,
    },
    organizations: [{ id: sessionState.currentOrgId, name: "真实组织" }],
    error: null,
    startSession: async () => {},
    switchOrganization: async () => {},
    retry: async () => {},
    logout: () => {},
  }),
}));

import { TemplateAdmin } from "@/components/canvas/template-admin";
import { CanvasHub } from "@/components/canvas/canvas-hub";

function adminItem(key: AdminModuleKey) {
  const item = ADMIN_NAV.flatMap((g) => g.items).find((i) => i.key === key);
  if (!item) throw new Error(`ADMIN_NAV 缺 ${key}`);
  return item;
}

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

/**
 * D-43（2026-08-15，人类直接裁决真合并，推翻 D-42 ⑤，见
 * `phases/requirements/DECISIONS-FINAL.md`）—— 后台「画布模板」（`/admin/canvasadmin`）
 * 与「画布模板库与编辑器」（`/canvas?screen=template-admin`）**真合并成一个屏**。
 *
 * `CanvasTemplateScreen`（原后台清单+跳转链接屏）到此退役，不再被任何路由引用，
 * 上面 `#464` 那组 `TemplateAdmin` 测试**同时覆盖**了它原来投影的内容——`TemplateAdmin`
 * 现在就是 `/admin/canvasadmin` 重定向后的落点，不需要再单独测一遍同一份真实响应。
 * 本组不重复断言 UI 行为，只做**机械可检的路由事实**：源码层面确认合并没有被悄悄撤销。
 */
describe("D-43 /admin/canvasadmin 与 /canvas?screen=template-admin 已真合并（源码级回归）", () => {
  it("ADMIN_NAV 的 canvasadmin 项 href 直接指向合并落点，不再经过旧的清单+跳转页", () => {
    expect(adminItem("canvasadmin").href).toBe("/canvas?screen=template-admin");
  });

  it("app/admin/[module]/page.tsx：canvasadmin 在 REDIRECTS 里指向合并落点，且 SCREENS 不再挂 CanvasTemplateScreen", () => {
    const src = readFileSync(
      resolve(ROOT, "app/admin/[module]/page.tsx"),
      "utf8",
    );
    expect(src).toMatch(/canvasadmin:\s*"\/canvas\?screen=template-admin"/);
    // 只锁「导入语句」与「SCREENS 映射项」不再存在，允许说明性注释里提到这个历史组件名
    // （同 `skill-single-screen-nav.test.tsx` 对 `LEFT_NAV_SCREENS` 的处理方式）。
    expect(src).not.toMatch(/from "@\/components\/admin\/canvas-template-screen"/);
    expect(src).not.toMatch(/canvasadmin:\s*CanvasTemplateScreen/);
  });

  it("canvas-hub.tsx：template-admin 屏仍然渲染 TemplateAdmin（合并落点没有被换成别的组件）", () => {
    const src = readFileSync(
      resolve(ROOT, "components/canvas/canvas-hub.tsx"),
      "utf8",
    );
    // #9（2026-08-22）起这一行多包了一层 `(` 给 TemplateAdmin 传 URL 初值 props——
    // 断言只锁「这个条件仍然渲染 TemplateAdmin」，不锁它是不是单行 JSX。
    expect(src).toMatch(/screen === "template-admin" && \(\s*<TemplateAdmin/);
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
/**
 * 2026-08-23——人类原话「新建画布，的时候，不要在这里放分区设计，也不要放key，
 * 只需要一个名字就可以，需要发布的生命周期的管理，所有的内容进入编辑的界面来管理」。
 * `MinimalCreateDialog` 只问显示名；`key` 由 `createMinimal` 从显示名 slugify 而来。
 */
describe("2026-08-23 新建只问名字——分区/key/生命周期都不在这个对话框里", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-496";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-496");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("对话框只有显示名一个输入框——没有 key、没有分区列表、没有可见范围", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [] })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-create"));
    const dialog = await screen.findByTestId("tpladmin-create-dialog");
    expect(within(dialog).getByTestId("tpladmin-create-name")).toBeInTheDocument();
    expect(within(dialog).queryByTestId("tpladmin-create-key")).toBeNull();
    expect(within(dialog).queryByTestId("tpladmin-create-sections")).toBeNull();
    expect(within(dialog).queryByTestId("tpladmin-create-visibility")).toBeNull();
  });

  it("提交打的是 POST /canvas/templates，key 由显示名派生、sections 为空、visibility 默认 org-wide；建完立刻打开编辑面板", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST" && url.pathname === "/canvas/templates") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push({ path: url.pathname, body });
        return jsonResponse({
          key: body["key"], displayName: body["displayName"], version: 1, status: "draft",
          builtin: false, visibility: "org-wide", underlyingType: "canvas", sections: [],
        }, 201);
      }
      listCalls += 1;
      return jsonResponse({
        templates: listCalls === 1
          ? []
          : posts.length > 0
            ? [template({
                key: posts[0]!.body["key"] as string, displayName: posts[0]!.body["displayName"] as string,
                version: 1, status: "draft", builtin: false, usageCount: 0, sections: [],
              })]
            : [],
      });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-create"));
    await screen.findByTestId("tpladmin-create-dialog");
    fireEvent.change(screen.getByTestId("tpladmin-create-name"), { target: { value: "SWOT 分析" } });
    fireEvent.click(screen.getByTestId("tpladmin-create-submit"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/canvas/templates");
    expect(posts[0]!.body["displayName"]).toBe("SWOT 分析");
    expect(posts[0]!.body["sections"]).toEqual([]);
    expect(posts[0]!.body["visibility"]).toBe("org-wide");
    expect(posts[0]!.body["underlyingType"]).toBe("canvas");
    // key 是从显示名派生的字符串，不是使用者填的——但一定是一个非空字符串。
    expect(typeof posts[0]!.body["key"]).toBe("string");
    expect((posts[0]!.body["key"] as string).length).toBeGreaterThan(0);

    // 对话框关了、编辑面板开了——「所有的内容进入编辑的界面来管理」。
    await waitFor(() => expect(screen.queryByTestId("tpladmin-create-dialog")).toBeNull());
    const panel = await screen.findByTestId("tpladmin-editor-panel");
    expect(within(panel).getByTestId("tpladmin-editor-name")).toHaveValue("SWOT 分析");
  });

  it("key 撞车（TEMPLATE_KEY_CONFLICT）时自动换一段随机后缀重试，使用者看不到这次冲突", async () => {
    const posts: { key: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST" && url.pathname === "/canvas/templates") {
        const body = JSON.parse(String(init.body)) as { key: unknown };
        posts.push(body);
        // 第一次撞车，第二次（换了后缀）成功。
        if (posts.length === 1) return jsonResponse({ reasonCode: "TEMPLATE_KEY_CONFLICT" }, 409);
        return jsonResponse({
          key: body.key, displayName: "撞名", version: 1, status: "draft",
          builtin: false, visibility: "org-wide", underlyingType: "canvas", sections: [],
        }, 201);
      }
      return jsonResponse({ templates: [] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-create"));
    await screen.findByTestId("tpladmin-create-dialog");
    fireEvent.change(screen.getByTestId("tpladmin-create-name"), { target: { value: "撞名" } });
    fireEvent.click(screen.getByTestId("tpladmin-create-submit"));

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[0]!.key).not.toBe(posts[1]!.key); // 换了不同的 key 重试
    expect(await screen.findByTestId("tpladmin-editor-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("tpladmin-create-error")).toBeNull(); // 使用者全程没看到这次冲突
  });

  it("显示名留空并失焦才提示必填——刚打开对话框时不是一片红", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [] })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-create"));
    await screen.findByTestId("tpladmin-create-dialog");
    expect(screen.queryByTestId("tpladmin-create-name-hint")).toBeNull();

    fireEvent.blur(screen.getByTestId("tpladmin-create-name"));
    expect(screen.getByTestId("tpladmin-create-name-hint")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("tpladmin-create-name"), { target: { value: "有名字了" } });
    expect(screen.queryByTestId("tpladmin-create-name-hint")).toBeNull();
  });

  it("观察者视角不挂新建入口（降噪，不是权限 —— 真正的拒绝在服务端）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [] })));
    render(<TemplateAdmin previewRole="observer" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("tpladmin-create")).toBeNull();
  });
});

describe("#496 画布模板发布/状态机（已签核契约面的既有行为）", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-496";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-496");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
});

/**
 * #988 —— 「基于此开新版」是本束「编辑」的真实入口，之前是永久占位符
 * 「编辑入口待补（契约无更新操作，分区只能在新建时定）」。人类已在 `design-signoff.md`
 * 签核确认（2026-08-17）。
 */
describe("#988 「基于此开新版」——本束「编辑」的真实入口", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-988";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-988");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draft 行没有「基于此开新版」按钮——draft 本身还没定稿", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      templates: [template({ key: "swot", version: 1, status: "draft", builtin: false, usageCount: 0 })],
    })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-swot-1")).toBeInTheDocument());
    expect(screen.queryByTestId("tpladmin-mint-version-swot-1")).toBeNull();
  });

  it("published 行有「基于此开新版」按钮，点击打开对话框且 key 被锁定、字段预填来源版本的值", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [template()] })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-mint-version-persona-3")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-mint-version-persona-3"));

    const dialog = await screen.findByTestId("tpladmin-mint-dialog");
    const keyInput = within(dialog).getByTestId("tpladmin-create-key") as HTMLInputElement;
    expect(keyInput.value).toBe("persona");
    expect(keyInput).toBeDisabled();
    const nameInput = within(dialog).getByTestId("tpladmin-create-name") as HTMLInputElement;
    expect(nameInput.value).toBe("用户画像");
  });

  it("提交打的是 POST /canvas/templates/:key/versions，key 锁定为来源版本的 key，不是新建端点", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST") {
        posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return jsonResponse({
          key: "persona", displayName: "用户画像 v4", version: 4, status: "draft",
          builtin: false, visibility: "org-wide", underlyingType: "canvas",
          sections: [{ sectionId: "s1", name: "基本信息", order: 0, required: true, capacity: null }],
        }, 201);
      }
      listCalls += 1;
      return jsonResponse({
        templates: listCalls === 1
          ? [template()]
          : [
              template(),
              template({
                key: "persona", displayName: "用户画像 v4", version: 4, status: "draft",
                builtin: false, usageCount: 0,
              }),
            ],
      });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-mint-version-persona-3")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tpladmin-mint-version-persona-3"));

    const dialog = await screen.findByTestId("tpladmin-mint-dialog");
    fireEvent.change(within(dialog).getByTestId("tpladmin-create-name"), { target: { value: "用户画像 v4" } });
    fireEvent.click(within(dialog).getByTestId("tpladmin-mint-submit"));

    await waitFor(() => expect(posts).toHaveLength(1));
    // 打的是 :key/versions，不是 createTemplate 的 /canvas/templates。
    expect(posts[0]!.path).toBe("/canvas/templates/persona/versions");
    // key 就是来源版本的 key（对话框里被锁定，不受用户输入影响）。
    expect(posts[0]!.body["key"]).toBe("persona");
    expect(posts[0]!.body["displayName"]).toBe("用户画像 v4");

    // 重新拉了表，且新版本以草稿出现在列表里，不是本地拼出来的。
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-4")).toBeInTheDocument());
    expect(within(screen.getByTestId("tpladmin-row-persona-4")).getByText("草稿")).toBeInTheDocument();
    expect(listCalls).toBeGreaterThan(1);
  });

  it("TEAM_REQUIRED_FOR_TEAM_ONLY 原样回显，不是「保存失败」", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse({ reasonCode: "TEAM_REQUIRED_FOR_TEAM_ONLY" }, 400);
      return jsonResponse({ templates: [template()] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-mint-version-persona-3")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tpladmin-mint-version-persona-3"));
    const dialog = await screen.findByTestId("tpladmin-mint-dialog");
    fireEvent.click(within(dialog).getByTestId("tpladmin-mint-submit"));

    const error = await screen.findByTestId("tpladmin-create-error");
    expect(error.textContent).toContain("TEAM_REQUIRED_FOR_TEAM_ONLY");
  });
});

/**
 * D-43 被推翻（2026-08-17）：后台「画布模板」菜单点进来之后，侧栏不该消失。
 * 人类看真实部署截图后要求把左侧后台菜单加回来——见 `canvas-hub.tsx` 文件头。
 *
 * ⚠ 这条必须渲染 `CanvasHub` 本体（不是直接渲染 `TemplateAdmin`）：侧栏是
 *   `CanvasHub` 按 `screen` 参数决定要不要挂的，渲染子组件本身证明不了这件事。
 */
describe("D-43 已推翻：template-admin 屏重新挂上后台侧栏 AdminNav", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-d43";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-d43");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [] })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("screen=template-admin 时，AdminNav 真的渲染了，且「画布模板」项高亮为当前项", async () => {
    render(
      <CanvasHub previewRole="facilitator" uiState="default" screen="template-admin" initialConflict={false} />,
    );
    const nav = await screen.findByTestId("admin-nav");
    expect(nav).toBeInTheDocument();
    // 高亮的是「画布模板」这一项，不是随便某一项——`active="canvasadmin"` 真的传下去了。
    expect(within(nav).getByTestId("admin-nav-canvasadmin")).toHaveAttribute("aria-current", "page");
    // 模板库屏本身照常渲染，不是被 AdminNav 顶替掉了。
    await waitFor(() => expect(screen.getByTestId("tpladmin-root")).toBeInTheDocument());
  });

  it("其它屏（如 editor）不挂 AdminNav——只有 template-admin 这一屏需要它", () => {
    render(
      <CanvasHub previewRole="facilitator" uiState="default" screen="editor" initialConflict={false} />,
    );
    expect(screen.queryByTestId("admin-nav")).toBeNull();
  });
});

/**
 * 2026-08-22 可用性改进轮——人类原话「检查后台的画布模板的管理……提出 10 个改进可用性的
 * 地方，并实施」。本组只测这一轮里**纯前端新增/改动**的六项；试跑的服务端接线已由
 * `application/canvas/trial-template.ts` 自己的单测与本组的组件测试覆盖，
 * 真实浏览器门控见 `e2e/canvas-template-create-smoke.spec.ts` 的 `tpladmin-trial-*` 断言。
 */
describe("2026-08-22 模板管理可用性改进", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-usability";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-usability");
    routerReplace.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("① 搜索框按名字/key 在当前筛选结果内过滤，不发新请求；清空后恢复全部", async () => {
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      listCalls += 1;
      return jsonResponse({
        templates: [
          template({ key: "persona", displayName: "用户画像", version: 3 }),
          template({ key: "swot", displayName: "SWOT 分析", version: 2 }),
        ],
      });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());
    expect(screen.getByTestId("tpladmin-row-swot-2")).toBeInTheDocument();
    expect(listCalls).toBe(1);

    fireEvent.change(screen.getByTestId("tpladmin-search"), { target: { value: "swot" } });
    await waitFor(() => expect(screen.queryByTestId("tpladmin-row-persona-3")).toBeNull());
    expect(screen.getByTestId("tpladmin-row-swot-2")).toBeInTheDocument();
    // 纯前端过滤——不为一次按键多发一次 GET。
    expect(listCalls).toBe(1);

    fireEvent.change(screen.getByTestId("tpladmin-search"), { target: { value: "" } });
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());
  });

  it("① 搜不到任何模板时显示「没有匹配」空态，不是「组织里没有模板」那句", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [template()] })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("tpladmin-search"), { target: { value: "找不到的名字" } });
    await waitFor(() => expect(screen.getByTestId("tpladmin-search-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("tpladmin-empty")).toBeNull();
  });

  it("② 「只看当前版本」默认关闭时两个版本都在；打开后同 key 只留状态优先级最高的那个", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      templates: [
        template({ key: "persona", displayName: "用户画像", version: 1, status: "archived" }),
        template({ key: "persona", displayName: "用户画像", version: 2, status: "published" }),
      ],
    })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-1")).toBeInTheDocument());
    expect(screen.getByTestId("tpladmin-row-persona-2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tpladmin-latest-only-toggle"));
    await waitFor(() => expect(screen.queryByTestId("tpladmin-row-persona-1")).toBeNull());
    // published（v2）比 archived（v1）优先级高，留下的是 v2。
    expect(screen.getByTestId("tpladmin-row-persona-2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tpladmin-latest-only-toggle"));
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-1")).toBeInTheDocument());
  });

  it("④ 内置模板显示「内置模板」，不再暗示别的模板可以被删除；页头有「不支持永久删除」说明", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [template({ builtin: true })] })));
    render(<TemplateAdmin previewRole="facilitator" />);
    const row = await waitFor(() => screen.getByTestId("tpladmin-row-persona-3"));
    expect(within(row).getByText("内置模板")).toBeInTheDocument();
    expect(within(row).queryByText(/不可删/)).toBeNull();
    expect(screen.getByText(/没有任何画布模板支持永久删除/)).toBeInTheDocument();
  });

  it("⑥ draft 行的「试跑」真调 trialTemplate，成功后重读列表——不在本地把 status 改成 trial", async () => {
    let listCalls = 0;
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/projects") {
        // 契约 `listProjects.out` 是**裸数组**，不是 `{ projects: [...] }`。
        return jsonResponse([{ id: "proj-1", name: "试跑用工作坊", kind: "workshop", status: "active" }]);
      }
      if (init?.method === "POST" && url.pathname === "/canvas/templates/persona/trial") {
        posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return jsonResponse({ key: "persona", version: 3, status: "trial" });
      }
      listCalls += 1;
      return jsonResponse({
        templates: [template({ status: listCalls === 1 ? "draft" : "trial" })],
      });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());
    expect(screen.getByTestId("tpladmin-row-persona-3").textContent).toContain("草稿");

    fireEvent.click(screen.getByTestId("tpladmin-trial-persona-3"));
    await waitFor(() => expect(screen.getByTestId("tpladmin-trial-dialog")).toBeInTheDocument());
    // 选项来自异步的 `listProjects`——先等它真的渲染出来，否则 `fireEvent.change`
    // 选中一个 DOM 里还不存在的 `<option>`，浏览器/jsdom 会静默忽略，值仍是 ""。
    await waitFor(() => expect(screen.getByText("试跑用工作坊")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("tpladmin-trial-project"), { target: { value: "proj-1" } });
    fireEvent.click(screen.getByTestId("tpladmin-trial-submit"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      path: "/canvas/templates/persona/trial",
      body: { key: "persona", version: 3, projectId: "proj-1" },
    });
    // 写完必须回服务端重新读，屏上那一行不是前端自己猜的状态。
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3").textContent).toContain("试跑"));
  });

  it("⑧ 「基于此开新版」表单里，显示名与已加载行重名时给软提示，但不阻断提交（2026-08-23 起搬到 mint 对话框——「新建」不再有显示名以外的字段可比对）", async () => {
    const posts: Record<string, unknown>[] = [];
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({
          key: "swot", displayName: "另一个用户画像", version: 2, status: "draft",
          builtin: false, visibility: "org-wide", underlyingType: "canvas", sections: [],
        }, 201);
      }
      listCalls += 1;
      return jsonResponse({
        templates: [
          template({ key: "persona", displayName: "用户画像" }),
          template({ key: "swot", displayName: "另一个用户画像", version: 1, status: "published" }),
        ],
      });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-mint-version-swot-1"));
    const dialog = await screen.findByTestId("tpladmin-mint-dialog");
    fireEvent.change(within(dialog).getByTestId("tpladmin-create-name"), { target: { value: "用户画像" } });
    fireEvent.blur(within(dialog).getByTestId("tpladmin-create-name"));

    await waitFor(() => expect(within(dialog).getByTestId("tpladmin-create-name-duplicate-hint")).toBeInTheDocument());
    // 软提示——提交按钮仍然可点。
    expect(within(dialog).getByTestId("tpladmin-mint-submit")).not.toBeDisabled();
    fireEvent.click(within(dialog).getByTestId("tpladmin-mint-submit"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(listCalls).toBeGreaterThan(0);
  });

  it("⑨ 切换筛选 tab / 视图 / 搜索词都调用 router.replace 把状态写进 URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [template()] })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-filter-published"));
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith(expect.stringContaining("filter=published"), { scroll: false }));

    fireEvent.click(screen.getByTestId("tpladmin-view-card"));
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith(expect.stringContaining("view=card"), { scroll: false }));

    fireEvent.change(screen.getByTestId("tpladmin-search"), { target: { value: "画像" } });
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith(expect.stringContaining("q="), { scroll: false }));
  });

  it("⑨ `initialFilter`/`initialView`/`initialQuery` 从 URL 初值恢复上次的筛选/视图/搜索状态", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      templates: [template({ status: "draft" })],
    })));
    render(<TemplateAdmin previewRole="facilitator" initialFilter="draft" initialView="card" initialQuery="用户" />);

    await waitFor(() => expect(screen.getByTestId("tpladmin-filter-draft")).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByTestId("tpladmin-cards")).toBeInTheDocument();
    expect(screen.getByTestId("tpladmin-search")).toHaveValue("用户");
  });
});

/**
 * 2026-08-23 —— 人类原话「输入一个常用的管理模板……系统可以自动创建可视化的模板」，
 * 又说「所有的内容进入编辑的界面来管理」——AI 起草的家因此从新建对话框搬进了
 * `TemplateEditorPanel`（新建时已经没有分区表单可回填了）。
 * `suggestTemplateSections` 只读、回填表单（见其契约文件头「为什么不直接写库」），
 * 所以这里只验前端这一半：调对了端点、回填对了字段、失败原样回显、且**不自动保存**。
 * 只读端口本身的服务端反证（模型失败/输出解析不出来映射到同一个 reasonCode、
 * 不落库）已由 `apps/api/tests/canvas/suggest-template-sections-http.test.ts` 覆盖。
 */
describe("2026-08-23 AI 起草模板（suggestTemplateSections，落点在编辑面板）", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-ai-suggest";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-ai-suggest");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("非草稿行的编辑面板是只读预览，不挂 AI 起草入口——内容不可变，AI 建议没有地方可写", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [template({ status: "published" })] })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-edit-persona-3"));
    const panel = await screen.findByTestId("tpladmin-editor-panel");
    expect(within(panel).queryByTestId("tpladmin-editor-ai-suggest")).toBeNull();
  });

  it("草稿行的编辑面板里，AI 生成成功后回填显示名与分区，且不自动保存", async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST" && url.pathname === "/canvas/templates/suggestions") {
        expect(JSON.parse(String(init.body))).toEqual({ prompt: "商业模式画布" });
        posts.push({ path: url.pathname });
        return jsonResponse({
          suggestedDisplayName: "商业模式画布",
          sections: [
            { name: "关键合作伙伴" }, { name: "价值主张" }, { name: "客户细分" },
          ],
          modelProvider: "test-qwen",
          modelId: "qwen3.7-plus",
        });
      }
      return jsonResponse({ templates: [template({ key: "swot", displayName: "SWOT", version: 1, status: "draft", builtin: false, usageCount: 0, sections: [] })] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-swot-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tpladmin-edit-swot-1"));
    const panel = await screen.findByTestId("tpladmin-editor-panel");

    fireEvent.change(within(panel).getByTestId("tpladmin-editor-ai-prompt"), { target: { value: "商业模式画布" } });
    fireEvent.click(within(panel).getByTestId("tpladmin-editor-ai-generate"));

    await waitFor(() => expect(posts).toHaveLength(1));
    // 回填——显示名与三个分区框都出现了 AI 建议的值。
    await waitFor(() => expect(within(panel).getByTestId("tpladmin-editor-name")).toHaveValue("商业模式画布"));
    expect(within(panel).getByTestId("tpladmin-editor-section-0")).toHaveValue("关键合作伙伴");
    expect(within(panel).getByTestId("tpladmin-editor-section-1")).toHaveValue("价值主张");
    expect(within(panel).getByTestId("tpladmin-editor-section-2")).toHaveValue("客户细分");

    // ⚠ 核心断言：只回填，不自动保存——没有任何 POST .../draft 发生，面板还开着。
    expect(posts).toHaveLength(1);
    expect(screen.getByTestId("tpladmin-editor-panel")).toBeInTheDocument();
    expect(within(panel).getByTestId("tpladmin-editor-save")).not.toBeDisabled();
  });

  it("AI 生成失败时原样回显 reasonCode，且不清空使用者已经填的字段", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST" && url.pathname === "/canvas/templates/suggestions") {
        return jsonResponse({ reasonCode: "TEMPLATE_SUGGESTION_UNAVAILABLE" }, 503);
      }
      return jsonResponse({ templates: [template({ key: "swot", displayName: "SWOT", version: 1, status: "draft", builtin: false, usageCount: 0, sections: [] })] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-swot-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tpladmin-edit-swot-1"));
    const panel = await screen.findByTestId("tpladmin-editor-panel");

    fireEvent.change(within(panel).getByTestId("tpladmin-editor-name"), { target: { value: "手动填的名字" } });
    fireEvent.change(within(panel).getByTestId("tpladmin-editor-ai-prompt"), { target: { value: "商业模式画布" } });
    fireEvent.click(within(panel).getByTestId("tpladmin-editor-ai-generate"));

    await waitFor(() => expect(within(panel).getByTestId("tpladmin-editor-ai-error").textContent).toContain("TEMPLATE_SUGGESTION_UNAVAILABLE"));
    // 失败不清空使用者已经手填的东西。
    expect(within(panel).getByTestId("tpladmin-editor-name")).toHaveValue("手动填的名字");
  });
});

/**
 * 2026-08-23 —— `TemplateEditorPanel`：`updateTemplateDraft` 唯一的前端调用点。
 * 服务端反证（已发布/已归档恒 409 TEMPLATE_NOT_DRAFT、不落库）已由
 * `apps/api/tests/canvas/update-template-draft-http.test.ts` 覆盖；这里只验前端接线。
 */
describe("2026-08-23 TemplateEditorPanel —— 内容与生命周期在编辑界面里管理", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-editor-panel";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-editor-panel");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("草稿行点「编辑」打开可写面板；加一个分区、改显示名、保存打的是 POST .../draft", async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST" && url.pathname === "/canvas/templates/swot/draft") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push({ path: url.pathname, body });
        return jsonResponse({
          key: "swot", version: 1, status: "draft", displayName: body["displayName"],
          builtin: false, visibility: body["visibility"], underlyingType: "canvas",
          sections: body["sections"],
        });
      }
      listCalls += 1;
      return jsonResponse({ templates: [template({ key: "swot", displayName: "SWOT", version: 1, status: "draft", builtin: false, usageCount: 0, sections: [] })] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-swot-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tpladmin-edit-swot-1"));
    const panel = await screen.findByTestId("tpladmin-editor-panel");

    fireEvent.change(within(panel).getByTestId("tpladmin-editor-name"), { target: { value: "SWOT 分析" } });
    fireEvent.click(within(panel).getByTestId("tpladmin-editor-add-section"));
    fireEvent.change(within(panel).getByTestId("tpladmin-editor-section-0"), { target: { value: "优势" } });
    fireEvent.click(within(panel).getByTestId("tpladmin-editor-save"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/canvas/templates/swot/draft");
    expect(posts[0]!.body["displayName"]).toBe("SWOT 分析");
    expect(posts[0]!.body["sections"]).toEqual([
      { sectionId: "s1", name: "优势", order: 0, required: false, capacity: null },
    ]);
    expect(listCalls).toBeGreaterThan(0); // 保存后重读了列表
  });

  it("非草稿行（已发布）打开的面板是只读预览——显示名/可见范围/分区全部禁用，没有保存按钮", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ templates: [template({ status: "published" })] })));
    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-persona-3")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tpladmin-edit-persona-3"));
    const panel = await screen.findByTestId("tpladmin-editor-panel");
    expect(within(panel).getByTestId("tpladmin-editor-name")).toBeDisabled();
    expect(within(panel).getByTestId("tpladmin-editor-visibility")).toBeDisabled();
    expect(within(panel).queryByTestId("tpladmin-editor-save")).toBeNull();
    expect(within(panel).getByTestId("tpladmin-editor-immutable-note")).toBeInTheDocument();
  });

  it("面板里点「发布」——面板关闭，打的是既有的 publish 端点（同行上按钮走同一个函数）", async () => {
    const posts: { path: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST" && url.pathname === "/canvas/templates/swot/publish") {
        posts.push({ path: url.pathname });
        return jsonResponse({ key: "swot", version: 1, status: "published", archivedVersions: [] });
      }
      return jsonResponse({ templates: [template({ key: "swot", displayName: "SWOT", version: 1, status: "draft", builtin: false, usageCount: 0, sections: [] })] });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-swot-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tpladmin-edit-swot-1"));
    const panel = await screen.findByTestId("tpladmin-editor-panel");

    fireEvent.click(within(panel).getByTestId("tpladmin-editor-publish"));
    // 面板立刻关闭——继续开着只会显示过期的 "draft" 状态。
    await waitFor(() => expect(screen.queryByTestId("tpladmin-editor-panel")).toBeNull());
    await waitFor(() => expect(posts).toHaveLength(1));
  });

  it("迭代 2/3：拖拽分区顺序——拖第一个到第三个位置，保存时顺序真的变了", async () => {
    const posts: { body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (init?.method === "POST" && url.pathname === "/canvas/templates/swot/draft") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push({ body });
        return jsonResponse({
          key: "swot", version: 1, status: "draft", displayName: body["displayName"],
          builtin: false, visibility: body["visibility"], underlyingType: "canvas", sections: body["sections"],
        });
      }
      return jsonResponse({
        templates: [template({
          key: "swot", displayName: "SWOT", version: 1, status: "draft", builtin: false, usageCount: 0,
          sections: [
            { sectionId: "s1", name: "优势", order: 0, required: false, capacity: null },
            { sectionId: "s2", name: "劣势", order: 1, required: false, capacity: null },
            { sectionId: "s3", name: "机会", order: 2, required: false, capacity: null },
          ],
        })],
      });
    }));

    render(<TemplateAdmin previewRole="facilitator" />);
    await waitFor(() => expect(screen.getByTestId("tpladmin-row-swot-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tpladmin-edit-swot-1"));
    const panel = await screen.findByTestId("tpladmin-editor-panel");
    await waitFor(() => expect(within(panel).getByTestId("tpladmin-editor-section-2")).toHaveValue("机会"));

    // 拖手柄 0（优势）到行 2（机会）的位置。jsdom 没有真实拖拽物理引擎，
    // 逐个派发 HTML5 drag 事件序列是官方推荐的测试手法。
    const handle0 = within(panel).getByTestId("tpladmin-editor-section-0-drag");
    const row2Target = within(panel).getByTestId("tpladmin-editor-section-2").closest("div")!;
    fireEvent.dragStart(handle0);
    fireEvent.dragOver(row2Target);
    fireEvent.drop(row2Target);

    // 拖完顺序是 劣势/机会/优势——优势从下标 0 挪到了下标 2。
    await waitFor(() => expect(within(panel).getByTestId("tpladmin-editor-section-0")).toHaveValue("劣势"));
    expect(within(panel).getByTestId("tpladmin-editor-section-1")).toHaveValue("机会");
    expect(within(panel).getByTestId("tpladmin-editor-section-2")).toHaveValue("优势");

    fireEvent.click(within(panel).getByTestId("tpladmin-editor-save"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body["sections"]).toEqual([
      { sectionId: "s1", name: "劣势", order: 0, required: false, capacity: null },
      { sectionId: "s2", name: "机会", order: 1, required: false, capacity: null },
      { sectionId: "s3", name: "优势", order: 2, required: false, capacity: null },
    ]);
  });
});
