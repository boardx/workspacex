/**
 * 大脑页（/brain）只显示真实数据（2026-09-24 人类指令「取消所有的 mockup 的数据」）。
 *
 * 网络在 `fetch` 这一层打桩（不替身 `lib/knowledge-graph-api.ts`）：请求路径、契约 `out` 校验、
 * 失败信封 → 错误码映射都是真代码在跑。登录态用 SessionProvider 的最小替身（只要当前组织 id）。
 *
 * 覆盖：长期记忆按类型分组 + 搜索 / 类型筛选 + 每条点回出自的对话；对话记忆的计数与「查看记忆」链接；
 * 项目 / 组织「尚未开放」；空态、加载态、依赖失败态（含重试）、无权限态；不渲染任何示例数字；
 * 渲染出的文字不含内部术语。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-brain" } }),
}));

import { knowledgeGraph, type KgClaim, type KgObject } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { BrainOverview, PersonalKnowledge } from "@/lib/knowledge-graph-api";
import { KG_BANNED_USER_FACING_WORDS } from "@/lib/knowledge-graph-view";
import { readChatMemoryRequest } from "@/lib/chat-memory-link";
import { BrainScreen } from "@/components/brain/brain-screen";

const ME = "u-me";
const PSCOPE = { kind: "personal", id: ME } as const;

function claim(id: string, kind: KgClaim["kind"], statement: string, derivedFrom: string | null): KgClaim {
  return {
    id, scope: PSCOPE, kind, statement, status: "accepted", triState: "confirmed", confidence: 0.8, createdBy: "human",
    reviewedBy: ME, supersedesClaimId: null, derivedFromClaimId: derivedFrom, aboutObjectIds: ["o-1"],
    supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-24T08:00:00Z",
  };
}
const object = (id: string, name: string, kind: KgObject["kind"], claimCount: number): KgObject =>
  ({ id, scope: PSCOPE, kind, name, aliases: [], createdBy: "model", claimCount });

const PERSONAL: PersonalKnowledge = knowledgeGraph.getPersonalKnowledge.out.parse({
  scope: PSCOPE, revision: 3,
  objects: [object("o-1", "v2", "product", 2), object("o-2", "老张", "person", 1)],
  claims: [
    claim("p-1", "decision", "v2 下周一上线", "c-1"),
    claim("p-2", "fact", "老张负责测试", "c-2"),
    claim("p-3", "risk", "测试环境不稳定", null),
  ],
  edges: [],
});
const OVERVIEW: BrainOverview = knowledgeGraph.getBrainOverview.out.parse({
  threads: [
    { threadId: "thr-1", projectId: null, title: "v2 上线安排", lastActivityAt: "2026-09-24T08:00:00Z", claims: 5, pending: 2, confirmed: 2, conflict: 1, objects: 3 },
    { threadId: "thr-2", projectId: "prj-1", title: "项目周会", lastActivityAt: "2026-09-23T08:00:00Z", claims: 1, pending: 1, confirmed: 0, conflict: 0, objects: 0 },
  ],
  personalOrigins: [
    { personalClaimId: "p-1", sourceClaimId: "c-1", threadId: "thr-1", projectId: null, threadTitle: "v2 上线安排" },
    { personalClaimId: "p-2", sourceClaimId: "c-2", threadId: "thr-2", projectId: "prj-1", threadTitle: "项目周会" },
  ],
});
const EMPTY_PERSONAL: PersonalKnowledge = { scope: PSCOPE, revision: 0, objects: [], claims: [], edges: [] };
const EMPTY_OVERVIEW: BrainOverview = { threads: [], personalOrigins: [] };

/* ── 网络桩 ───────────────────────────────────────────────────────── */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
function stubNetwork(route: (path: string) => Response | Promise<Response | undefined> | undefined): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = await route(new URL(url, "http://localhost").pathname);
    if (!res) throw new Error(`unexpected fetch: ${url}`);
    return res;
  });
  vi.stubGlobal("fetch", fetchMock);
}
const paths = () => fetchMock.mock.calls.map(([u]) => new URL(String(u), "http://localhost").pathname);
const real = (personal: PersonalKnowledge, overview: BrainOverview) => (p: string) =>
  p === "/knowledge-graph/personal" ? json(personal) : p === "/knowledge-graph/me/overview" ? json(overview) : undefined;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-brain");
});
afterEach(() => { vi.unstubAllGlobals(); });

const text = (root: HTMLElement) => root.textContent ?? "";

describe("大脑页：真实数据", () => {
  it("取的是两个真实接口；长期记忆按类型分组，计数来自数据，没有任何示例数字", async () => {
    stubNetwork(real(PERSONAL, OVERVIEW));
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    expect(paths().sort()).toEqual(["/knowledge-graph/me/overview", "/knowledge-graph/personal"]);
    expect(screen.getByTestId("brain-tab-personal-count").textContent).toBe("3");
    expect(screen.getByTestId("brain-tab-sessions-count").textContent).toBe("2");
    expect(screen.getAllByTestId("brain-personal-item")).toHaveLength(3);
    expect(within(screen.getByTestId("brain-personal-group-decision")).getByText("v2 下周一上线")).toBeTruthy();
    expect(within(screen.getByTestId("brain-personal-group-risk")).getByText("测试环境不稳定")).toBeTruthy();
    expect(screen.getAllByTestId("brain-personal-object").map((o) => o.textContent)).toEqual(["v2产品 · 2", "老张人物 · 1"]);
    const page = text(screen.getByTestId("brain-screen"));
    for (const fake of ["1,482", "604", "86", "决策台账", "推演链", "Context Pack"]) expect(page).not.toContain(fake);
    expect(screen.queryByTestId("prototype-data-banner")).toBeNull();
  });

  it("每条长期记忆都能点回出自的对话，并直接打开那一条的来源；来源看不到了就如实说", async () => {
    stubNetwork(real(PERSONAL, OVERVIEW));
    render(<BrainScreen />);
    const links = await screen.findAllByTestId("brain-origin-link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/chat/thr-1?memory=c-1",
      "/chat/thr-2?projectId=prj-1&memory=c-2",
    ]);
    expect(readChatMemoryRequest("?projectId=prj-1&memory=c-2")).toEqual({ claimId: "c-2" });
    expect(readChatMemoryRequest("?memory=1")).toEqual({ claimId: null });
    expect(readChatMemoryRequest("")).toBeNull();
    // p-3 没有来源会话（例如会话被删、或已被移出项目）
    expect(screen.getAllByTestId("brain-origin-gone")).toHaveLength(1);
  });

  it("搜索与类型筛选只作用于列表；没有匹配时说一句人话", async () => {
    stubNetwork(real(PERSONAL, OVERVIEW));
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.change(screen.getByTestId("brain-personal-search"), { target: { value: "老张" } });
    expect(screen.getAllByTestId("brain-personal-item").map((li) => li.querySelector("p")?.textContent)).toEqual(["老张负责测试"]);
    fireEvent.change(screen.getByTestId("brain-personal-search"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("brain-kind-risk"));
    expect(screen.getAllByTestId("brain-personal-item")).toHaveLength(1);
    fireEvent.change(screen.getByTestId("brain-personal-search"), { target: { value: "没有这句" } });
    expect(screen.getByTestId("brain-personal-no-match")).toBeTruthy();
  });

  it("对话里的记忆：每个对话一行真实计数，「查看记忆」直达那个对话的记忆页签", async () => {
    stubNetwork(real(PERSONAL, OVERVIEW));
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.mouseDown(screen.getByTestId("brain-tab-sessions"));
    fireEvent.click(screen.getByTestId("brain-tab-sessions"));
    const rows = await screen.findAllByTestId("brain-session-row");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/chat/thr-1?memory=1", "/chat/thr-2?projectId=prj-1&memory=1"]);
    expect(text(rows[0]!)).toContain("记下 5 条");
    expect(text(rows[0]!)).toContain("AI 记下的 2");
    expect(text(rows[0]!)).toContain("有矛盾 1");
    expect(screen.getByTestId("brain-sessions-summary").textContent).toBe("2 个对话共记下 6 条，其中 3 条等你确认，1 条有矛盾。");
  });

  it("项目与组织两层：如实显示「尚未开放」，没有数字", async () => {
    stubNetwork(real(PERSONAL, OVERVIEW));
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.mouseDown(screen.getByTestId("brain-tab-shared"));
    fireEvent.click(screen.getByTestId("brain-tab-shared"));
    await screen.findByTestId("brain-shared");
    expect(screen.getByTestId("brain-layer-project-status").textContent).toBe("尚未开放");
    expect(screen.getByTestId("brain-layer-org-status").textContent).toBe("尚未开放");
    expect(text(screen.getByTestId("brain-shared"))).not.toMatch(/\d/);
  });

  it("空：长期记忆与对话记忆都给出下一步", async () => {
    stubNetwork(real(EMPTY_PERSONAL, EMPTY_OVERVIEW));
    render(<BrainScreen />);
    expect(await screen.findByTestId("brain-personal-empty")).toBeTruthy();
    expect(screen.getByTestId("empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("brain-personal-go-sessions"));
    expect(await screen.findByTestId("brain-sessions")).toBeTruthy();
    expect(within(screen.getByTestId("brain-sessions")).getByTestId("empty")).toBeTruthy();
  });

  it("加载中显示骨架；服务不可用显示人话 + 重试，重试后恢复", async () => {
    let fail = true;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    stubNetwork(async (p) => {
      await gate;
      if (fail) return new Response("<html>bad gateway</html>", { status: 502 });
      return real(PERSONAL, OVERVIEW)(p);
    });
    render(<BrainScreen />);
    expect(screen.getByTestId("loading")).toBeTruthy();
    release();
    const failed = await screen.findByTestId("dep-failed");
    expect(failed.textContent).toContain("暂时读不到你的记忆");
    expect(failed.textContent).not.toMatch(/KG_|502|http_/);
    fail = false;
    fireEvent.click(screen.getByTestId("dep-failed-retry"));
    expect(await screen.findByTestId("brain-personal")).toBeTruthy();
  });

  it("已不在当前组织（找不到个人空间）⇒ 无权限态，说清是组织层、不出现内部码", async () => {
    stubNetwork(() => json({ error: "not found", traceId: "t", reasonCode: "KG_THREAD_NOT_FOUND" }, 404));
    render(<BrainScreen />);
    const denied = await screen.findByTestId("denied");
    expect(denied.textContent).toContain("组织层限制");
    expect(denied.textContent).not.toContain("KG_");
  });

  it("界面上的文字不出现内部术语", async () => {
    stubNetwork(real(PERSONAL, OVERVIEW));
    const { container } = render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    for (const tab of ["brain-tab-sessions", "brain-tab-shared"]) {
      fireEvent.mouseDown(screen.getByTestId(tab));
      fireEvent.click(screen.getByTestId(tab));
    }
    await waitFor(() => expect(screen.getByTestId("brain-shared")).toBeTruthy());
    const copy = text(container);
    for (const w of KG_BANNED_USER_FACING_WORDS) expect(copy).not.toContain(w);
  });
});
