/**
 * 大脑页（/brain）只显示真实数据（2026-09-24 人类指令「取消所有的 mockup 的数据」）。
 *
 * 网络在 `fetch` 这一层打桩（不替身 `lib/knowledge-graph-api.ts`）：请求路径、契约 `out` 校验、
 * 失败信封 → 错误码映射都是真代码在跑。登录态用 SessionProvider 的最小替身（只要当前组织 id）。
 *
 * 覆盖：长期记忆按类型分组 + 搜索 / 类型筛选 + 每条点回出自的对话；对话记忆的计数与「查看记忆」链接；
 * 项目「已开放」（R7）/ 组织「尚未开放」；空态、加载态、依赖失败态（含重试）、无权限态；不渲染任何示例数字；
 * 渲染出的文字不含内部术语。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-brain" } }),
}));

import { KgClaimKind, knowledgeGraph, type KgClaim, type KgObject } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { BrainOverview, PersonalKnowledge } from "@/lib/knowledge-graph-api";
import { KG_BANNED_USER_FACING_WORDS, KG_CLAIM_KIND_LABEL_ZH, KG_CLAIM_KIND_ORDER } from "@/lib/knowledge-graph-view";
import { readChatMemoryRequest } from "@/lib/chat-memory-link";
import { BrainScreen } from "@/components/brain/brain-screen";

const ME = "u-me";
const PSCOPE = { kind: "personal", id: ME } as const;
/** 正午（UTC）：任何常见时区下都还是 9/26 */
const SAID_0926 = "2026-09-26T12:00:00Z";

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
  replaced: [],
});
const OVERVIEW: BrainOverview = knowledgeGraph.getBrainOverview.out.parse({
  threads: [
    { threadId: "thr-1", projectId: null, title: "v2 上线安排", lastActivityAt: "2026-09-24T08:00:00Z", claims: 5, pending: 2, confirmed: 2, conflict: 1, objects: 3 },
    { threadId: "thr-2", projectId: "prj-1", title: "项目周会", lastActivityAt: "2026-09-23T08:00:00Z", claims: 1, pending: 1, confirmed: 0, conflict: 0, objects: 0 },
  ],
  personalOrigins: [
    { personalClaimId: "p-1", sourceClaimId: "c-1", threadId: "thr-1", projectId: null, threadTitle: "v2 上线安排", saidAt: SAID_0926, autoCopied: false },
    { personalClaimId: "p-2", sourceClaimId: "c-2", threadId: "thr-2", projectId: "prj-1", threadTitle: "项目周会", saidAt: null, autoCopied: false },
  ],
});
const EMPTY_PERSONAL: PersonalKnowledge = { scope: PSCOPE, revision: 0, objects: [], claims: [], edges: [], replaced: [] };
const EMPTY_OVERVIEW: BrainOverview = { threads: [], personalOrigins: [] };

/* ── 网络桩 ───────────────────────────────────────────────────────── */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
function stubNetwork(route: (path: string, init?: RequestInit) => Response | Promise<Response | undefined> | undefined): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = await route(new URL(url, "http://localhost").pathname, init);
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
    // p-3 没有来源会话（例如原话被删、或那一条在对话里被忘掉）
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

  it("两层如实显示开放状态：项目「已开放」（R7）、组织「尚未开放」，没有数字", async () => {
    stubNetwork(real(PERSONAL, OVERVIEW));
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.mouseDown(screen.getByTestId("brain-tab-shared"));
    fireEvent.click(screen.getByTestId("brain-tab-shared"));
    await screen.findByTestId("brain-shared");
    expect(screen.getByTestId("brain-layer-project-status").textContent).toBe("已开放");
    expect(screen.getByTestId("brain-layer-project-hint")).toHaveTextContent("记到项目大脑");
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

  it("已不在当前组织（KG_NOT_VISIBLE）⇒ 无权限态，说清是组织层、不出现内部码", async () => {
    stubNetwork(() => json({ error: "forbidden", traceId: "t", reasonCode: "KG_NOT_VISIBLE" }, 403));
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

/* ── issue #4343：目标 / 偏好 ─────────────────── */

describe("大脑页：本人的目标 / 偏好（issue #4343）", () => {
  const GOAL = "我的目标是探索未来教育";
  const PREF = "我更喜欢简洁的回答";
  const WITH_GOALS: PersonalKnowledge = knowledgeGraph.getPersonalKnowledge.out.parse({
    ...PERSONAL,
    claims: [...PERSONAL.claims, claim("p-goal", "goal", GOAL, null), claim("p-pref", "preference", PREF, null)],
  });

  it("类型表与分组先后覆盖契约的每一种类型（漏一种 = 那一类永远不渲染）", () => {
    expect([...KG_CLAIM_KIND_ORDER].sort()).toEqual([...KgClaimKind.options].sort());
    for (const k of KgClaimKind.options) expect(KG_CLAIM_KIND_LABEL_ZH[k]).toBeTruthy();
    expect(KG_CLAIM_KIND_LABEL_ZH.goal).toBe("目标");
    expect(KG_CLAIM_KIND_LABEL_ZH.preference).toBe("偏好");
  });

  it("长期记忆里「目标 · 1」「偏好 · 1」各成一组（决定之后、事实之前），类型筛选有「目标 1」「偏好 1」", async () => {
    stubNetwork(real(WITH_GOALS, OVERVIEW));
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    const goal = screen.getByTestId("brain-personal-group-goal");
    expect(goal.querySelector("h2")?.textContent).toBe("目标 · 1");
    expect(within(goal).getByText(GOAL)).toBeTruthy();
    expect(screen.getByTestId("brain-personal-group-preference").querySelector("h2")?.textContent).toBe("偏好 · 1");
    const groups = [...screen.getByTestId("brain-personal").querySelectorAll("[data-testid^='brain-personal-group-']")]
      .map((s) => s.getAttribute("data-testid"));
    expect(groups).toEqual([
      "brain-personal-group-decision", "brain-personal-group-goal", "brain-personal-group-preference",
      "brain-personal-group-fact", "brain-personal-group-risk",
    ]);
    expect(screen.getByTestId("brain-kind-goal").textContent).toBe("目标 1");
    fireEvent.click(screen.getByTestId("brain-kind-preference"));
    expect(screen.getAllByTestId("brain-personal-item").map((li) => li.querySelector("p")?.textContent)).toEqual([PREF]);
  });
});

/* ── issue #4302：时间、折叠的取代历史、忘掉 / 撤销取代 ─────────────────── */

const pending = (id: string, statement: string, derivedFrom: string): KgClaim =>
  ({ ...claim(id, "decision", statement, derivedFrom), status: "proposed", triState: "pending", createdBy: "model", reviewedBy: null });
const OLD_211 = "我决定关注 211 高校";
const NEW_985 = "改成关注 985 高校";
const FRONT = "我决定用 React 做前端";
const UNDO = { threadId: "thr-b", noticeId: "sn-1" };
/** 改口之后：985 活着（AI 记下的），211 折叠在它下面。 */
const AFTER_CHANGE: PersonalKnowledge = knowledgeGraph.getPersonalKnowledge.out.parse({
  scope: PSCOPE, revision: 5, objects: [], edges: [],
  claims: [pending("p-985", NEW_985, "c-985"), claim("p-front", "decision", FRONT, "c-front")],
  replaced: [{ byClaimId: "p-985", replaces: { claimId: "p-211", statement: OLD_211 }, undo: UNDO }],
});
const AFTER_CHANGE_OVERVIEW: BrainOverview = knowledgeGraph.getBrainOverview.out.parse({
  threads: [],
  personalOrigins: [
    { personalClaimId: "p-985", sourceClaimId: "c-985", threadId: "thr-b", projectId: null, threadTitle: "选校 B", saidAt: SAID_0926, autoCopied: true },
    { personalClaimId: "p-front", sourceClaimId: "c-front", threadId: "thr-c", projectId: null, threadTitle: "前端", saidAt: "2026-09-20T12:00:00Z", autoCopied: true },
  ],
});
/** 撤销取代之后：两条都活着，没有折叠行。 */
const AFTER_UNDO: PersonalKnowledge = { ...AFTER_CHANGE, claims: [pending("p-211", OLD_211, "c-211"), ...AFTER_CHANGE.claims], replaced: [] };
const threadKnowledge = (threadId: string, revision: number) => knowledgeGraph.getThreadKnowledge.out.parse({
  scope: { kind: "chat_session", id: threadId }, revision, objects: [], claims: [], edges: [],
  ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
  canEdit: true, canPromote: true, visibility: "owner_only", extractionActive: true,
});
const failure = (reasonCode: string, status: number) => json({ error: "x", traceId: "t", reasonCode }, status);
const writes = () => fetchMock.mock.calls
  .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
  .map(([u, init]) => ({ path: new URL(String(u), "http://localhost").pathname, body: JSON.parse(String((init as RequestInit).body)) as unknown }));
const itemOf = (statement: string) => {
  const li = screen.getAllByTestId("brain-personal-item").find((x) => x.querySelector("p")?.textContent === statement);
  if (li === undefined) throw new Error(`no item「${statement}」`);
  return li;
};
const statements = () => screen.getAllByTestId("brain-personal-item").map((li) => li.querySelector("p")?.textContent);
const THREAD_PATH = /^\/knowledge-graph\/threads\/([^/]+)$/;

/** 服务端：读 personal / overview 时给 `state` 的现值；POST 按 `onWrite` 回；读对话给版本号 7。 */
function brainServer(onWrite: (path: string, body: unknown) => Response | Promise<Response>) {
  const state = { personal: AFTER_CHANGE, overview: AFTER_CHANGE_OVERVIEW };
  stubNetwork(async (p, init) => {
    if (p === "/knowledge-graph/personal") return json(state.personal);
    if (p === "/knowledge-graph/me/overview") return json(state.overview);
    if (init?.method === "POST") return onWrite(p, JSON.parse(String(init.body)));
    const t = THREAD_PATH.exec(p);
    return t ? json(threadKnowledge(t[1]!, 7)) : undefined;
  });
  return state;
}

describe("大脑页：跨会话的长期记忆（issue #4302）", () => {
  it("每条带「来自你 {M/D} 的对话」；来源没有时间时只说「来自对话」", async () => {
    stubNetwork(real(PERSONAL, OVERVIEW));
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    expect(within(itemOf("v2 下周一上线")).getByTestId("brain-origin-time").textContent).toBe("来自你 9/26 的对话");
    expect(within(itemOf("老张负责测试")).getByTestId("brain-origin-time").textContent).toBe("来自对话");
  });

  it("被改口取代的旧记忆折叠在新的那条下面（「取代了：…」），不单独成一条；没有撤销的不给按钮", async () => {
    const noUndo = { ...AFTER_CHANGE, replaced: [{ ...AFTER_CHANGE.replaced[0]!, undo: null }] };
    stubNetwork(real(noUndo, AFTER_CHANGE_OVERVIEW));
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    expect(statements()).toEqual([NEW_985, FRONT]);
    expect(screen.getByTestId("brain-tab-personal-count").textContent).toBe("2");
    const folded = within(itemOf(NEW_985)).getByTestId("brain-replaced");
    expect(within(folded).getByTestId("brain-replaced-text").textContent).toBe(`取代了：${OLD_211}`);
    expect(within(folded).queryByTestId("brain-undo-supersede")).toBeNull();
    expect(within(itemOf(FRONT)).queryByTestId("brain-replaced")).toBeNull();
  });

  it("撤销取代 = 在说出改口的那个对话上 undoSupersede（带那个对话的最新版本号）；成功后列表刷新，两条都在", async () => {
    const state = brainServer(() => { state.personal = AFTER_UNDO; return json({ revision: 8, actionId: "act-1" }); });
    render(<BrainScreen />);
    fireEvent.click(await screen.findByTestId("brain-undo-supersede"));
    await waitFor(() => expect(statements()).toEqual([OLD_211, NEW_985, FRONT]));
    expect(writes()).toEqual([{ path: "/knowledge-graph/threads/thr-b/actions", body: { basedOnRevision: 7, action: { type: "undoSupersede", noticeId: "sn-1" } } }]);
    expect(paths()).toContain("/knowledge-graph/threads/thr-b");
    expect(screen.queryByTestId("brain-replaced")).toBeNull();
    expect(screen.queryByTestId("brain-action-error")).toBeNull();
  });

  it("忘掉仍是「AI 记下的」自动记下的一条 ⇒ undoAutoPersonalCopy（只拿掉长期记忆里那份）；成功后它不见了", async () => {
    const state = brainServer(() => {
      state.personal = { ...AFTER_CHANGE, claims: AFTER_CHANGE.claims.filter((c) => c.id !== "p-985"), replaced: [] };
      return json({ personalClaimId: "p-985", outcome: "revoked" });
    });
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.click(within(itemOf(NEW_985)).getByTestId("brain-forget"));
    await waitFor(() => expect(statements()).toEqual([FRONT]));
    expect(writes()).toEqual([{ path: "/knowledge-graph/threads/thr-b/claims/c-985/personal-copy/undo", body: {} }]);
    expect(screen.getByTestId("brain-tab-personal-count").textContent).toBe("1");
  });

  it("忘掉你确认过的一条 ⇒ 在出自的对话上 revokeClaim 那条原话记下的（与对话里的「忘掉这条」同一个动作）", async () => {
    const state = brainServer(() => {
      state.personal = { ...AFTER_CHANGE, claims: AFTER_CHANGE.claims.filter((c) => c.id !== "p-front") };
      return json({ revision: 8, actionId: "act-2" });
    });
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.click(within(itemOf(FRONT)).getByTestId("brain-forget"));
    await waitFor(() => expect(statements()).toEqual([NEW_985]));
    expect(writes()).toEqual([{ path: "/knowledge-graph/threads/thr-c/actions", body: { basedOnRevision: 7, action: { type: "revokeClaim", claimId: "c-front" } } }]);
  });

  it("忘掉失败 ⇒ 点下去先消失，失败后放回原处，并在那一条下面说原因（不出现内部码）", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    brainServer(async () => { await gate; return new Response("<html>bad gateway</html>", { status: 502 }); });
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.click(within(itemOf(NEW_985)).getByTestId("brain-forget"));
    await waitFor(() => expect(statements()).toEqual([FRONT]));
    release();
    const err = await screen.findByTestId("brain-action-error");
    expect(statements()).toEqual([NEW_985, FRONT]);
    expect(within(itemOf(NEW_985)).getByTestId("brain-action-error")).toBe(err);
    expect(err.textContent).toBe("没能完成，请稍后重试。");
    expect(err.textContent).not.toMatch(/KG_|502/);
  });

  it("撤销取代失败（已经撤销过了）⇒ 折叠行放回来，说清原因并重读列表", async () => {
    brainServer(() => failure("KG_PROMPT_NOT_FOUND", 404));
    render(<BrainScreen />);
    fireEvent.click(await screen.findByTestId("brain-undo-supersede"));
    const err = await screen.findByTestId("brain-action-error");
    expect(err.textContent).toBe("这次改口已经撤销过了，已为你刷新列表。");
    expect(within(itemOf(NEW_985)).getByTestId("brain-replaced-text").textContent).toBe(`取代了：${OLD_211}`);
    // 失败后重读过一次：初次一份 + 重读一份
    await waitFor(() => expect(paths().filter((p) => p === "/knowledge-graph/personal")).toHaveLength(2));
  });

  it("新加的文字同样不出现内部术语", async () => {
    stubNetwork(real(AFTER_CHANGE, AFTER_CHANGE_OVERVIEW));
    const { container } = render(<BrainScreen />);
    await screen.findByTestId("brain-replaced");
    const copy = text(container);
    expect(copy).toContain("忘掉这条");
    expect(copy).toContain("撤销取代");
    for (const w of KG_BANNED_USER_FACING_WORDS) expect(copy).not.toContain(w);
  });
});

/* ── issue #4302 review：多个来源的忘掉、中途失败、忘掉后仍活着 ─────────────────── */

/** 仍是「AI 记下的」、两个来源：thr-m 是你手动记下的，thr-a 是自动记下的。 */
const MULTI: PersonalKnowledge = { ...AFTER_CHANGE, claims: [pending("p-multi", FRONT, "c-m")], replaced: [] };
const MULTI_OVERVIEW: BrainOverview = knowledgeGraph.getBrainOverview.out.parse({
  threads: [],
  personalOrigins: [
    { personalClaimId: "p-multi", sourceClaimId: "c-m", threadId: "thr-m", projectId: null, threadTitle: "手动", saidAt: SAID_0926, autoCopied: false },
    { personalClaimId: "p-multi", sourceClaimId: "c-a", threadId: "thr-a", projectId: null, threadTitle: "自动", saidAt: SAID_0926, autoCopied: true },
  ],
});
const UNDO_A = "/knowledge-graph/threads/thr-a/claims/c-a/personal-copy/undo";
const REVOKE_M = { path: "/knowledge-graph/threads/thr-m/actions", body: { basedOnRevision: 7, action: { type: "revokeClaim", claimId: "c-m" } } };

describe("大脑页：忘掉有多个来源的一条（issue #4302 review）", () => {
  it("逐个来源各走一步：不碰对话结论的撤销自动记入在前，忘掉对话里那条在后；全部成功后它不见了", async () => {
    const state = brainServer((p) => {
      if (p === UNDO_A) return json({ personalClaimId: "p-multi", outcome: "detached" });
      state.personal = { ...MULTI, claims: [] };
      return json({ revision: 8, actionId: "act-m" });
    });
    state.personal = MULTI;
    state.overview = MULTI_OVERVIEW;
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.click(within(itemOf(FRONT)).getByTestId("brain-forget"));
    await screen.findByTestId("brain-personal-empty");
    expect(writes()).toEqual([{ path: UNDO_A, body: {} }, REVOKE_M]);
    expect(screen.queryByTestId("brain-action-error")).toBeNull();
  });

  it("做掉一步后第二步失败（没有错误码）⇒ 仍然重读列表看真实结果，并在那一条下面说原因", async () => {
    const state = brainServer((p) => (p === UNDO_A
      ? json({ personalClaimId: "p-multi", outcome: "detached" })
      : new Response("<html>bad gateway</html>", { status: 502 })));
    state.personal = MULTI;
    state.overview = MULTI_OVERVIEW;
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.click(within(itemOf(FRONT)).getByTestId("brain-forget"));
    const err = await screen.findByTestId("brain-action-error");
    expect(err.textContent).toBe("没能完成，请稍后重试。");
    expect(writes()).toEqual([{ path: UNDO_A, body: {} }, REVOKE_M]);
    // 初次一份 + 因「已经做掉一步」重读一份（去掉 progressed > 0 这条就只剩初次那份）
    await waitFor(() => expect(paths().filter((p) => p === "/knowledge-graph/personal")).toHaveLength(2));
  });

  it("每一步都成功、重读后那条却还活着 ⇒ 不报成功，在那一条下面如实说「还有别的来源，没有忘掉」", async () => {
    // 服务端：动作都 200，但长期记忆里那条仍在（有界面看不到的来源撑着）
    brainServer(() => json({ revision: 8, actionId: "act-2" }));
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    fireEvent.click(within(itemOf(FRONT)).getByTestId("brain-forget"));
    const err = await screen.findByTestId("brain-action-error");
    expect(err.textContent).toBe("这条长期记忆还有别的来源，没有忘掉。");
    expect(statements()).toEqual([NEW_985, FRONT]);
    expect(within(itemOf(FRONT)).getByTestId("brain-action-error")).toBe(err);
    expect(writes()).toEqual([{ path: "/knowledge-graph/threads/thr-c/actions", body: { basedOnRevision: 7, action: { type: "revokeClaim", claimId: "c-front" } } }]);
  });
});
