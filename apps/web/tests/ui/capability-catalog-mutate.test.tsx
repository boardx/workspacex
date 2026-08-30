/**
 * #458 —— Agent 目录的新增 / 更新 / 停用接到真实 `POST /capabilities/mutate`。
 *
 * ## 这组断言各自防住什么
 *
 * ① 请求本身：路径、方法、`op`、`payload` 形状必须与 `identity.operations.mutateCapability`
 *    一致。写坏时**界面照样显示成功**——因为成功与否是本地 state 决定的。
 * ② 变更后的列表**必须来自服务端的第二次 GET**，不是把 mutate 响应 push 进本地数组。
 *    乐观插入的失效方式是：服务端因为可见性把这条记录挡掉，界面却一直显示它，
 *    直到用户刷新页面才发现「刚建的东西不见了」。
 * ③ **权限由服务端裁决**。前端把按钮藏起来不算权限——客户端手里的 orgRole 是缓存的，
 *    降权与页面之间永远有时间差。所以这里刻意构造「客户端自认为是 admin、服务端返回 403」，
 *    断言界面呈现服务端的 reasonCode 且不把这条记录当成已创建。
 *    服务端那一侧的 401/403 断言在 `apps/api/tests/kernel/capability-mutate-authorization.test.ts`。
 * ④ 非管理员看不到入口——这是降噪，不是权限；它与 ③ 同时存在才成立。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { identity } from "@repo/contracts";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-458", orgRole: "admin" }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
}));

import { AgentScreen } from "@/components/admin/agent-screen";
import { CapabilityEditPage } from "@/components/admin/capability-edit-page";

interface Listing {
  id: string;
  orgId: string;
  kind: string;
  name: string;
  scope: string;
  enabled: boolean;
  endpoint: string | null;
  disabledReason: string | null;
}

function listing(over: Partial<Listing> = {}): Listing {
  return {
    id: "agent-1",
    orgId: sessionState.currentOrgId,
    kind: "agent",
    name: "既有 Agent",
    scope: "org-wide",
    enabled: true,
    endpoint: null,
    disabledReason: null,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
}

/**
 * 一个可编排的 fetch：`GET /capabilities` 依次吐出 `pages` 里的下一页，POST 交给
 * `onMutate`。刻意**不**让 GET 复用同一份数据——②「列表来自第二次 GET」只有在两次
 * GET 内容不同时才可证伪。
 *
 * ⚠ #1915 起，`AgentScreen` 挂载时还会打一个独立的 `GET /agents`（`AgentDefinitionListPanel`
 * 的 `listAgents`）——按路径分流：只有 `listCapabilities.path` 消费 `pages` 序列，
 * 其它 GET（目前只有 `listAgents`）恒回空数组。不分流会让 `getIndex` 被两条不相关的
 * GET 共享推进，`CapabilityCatalogScreen` 那次 GET 拿到的就不是它期望的那一页——
 * 这正是 2026-08-24 实测撞见的那个假红（`-disable` 按钮消失，因为提前吃到了「已停用」
 * 那一页）。
 */
function stubFetch(options: {
  pages: readonly (readonly Listing[])[];
  onMutate?: (body: Record<string, unknown>) => Response;
}) {
  const calls: Recorded[] = [];
  let getIndex = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    if (method === "GET" && url.pathname === identity.operations.listCapabilities.path) {
      const page = options.pages[Math.min(getIndex, options.pages.length - 1)]!;
      getIndex += 1;
      return jsonResponse(page);
    }
    if (method === "GET") return jsonResponse([]);
    return options.onMutate!(body!);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const mutateCalls = (calls: readonly Recorded[]) =>
  calls.filter((c) => c.path === identity.operations.mutateCapability.path);
const listCalls = (calls: readonly Recorded[]) =>
  calls.filter((c) => c.path === identity.operations.listCapabilities.path);

describe("#458 Agent 目录写路径接到 POST /capabilities/mutate", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-458";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-458");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("新增：按契约发 op=add，并且列表来自服务端的第二次 GET 而不是本地插入", async () => {
    const created = listing({ id: "agent-new", name: "结算助理", scope: "org-wide" });
    const { calls } = stubFetch({
      pages: [[], [created]],
      onMutate: (body) => {
        // 请求体必须先过契约，再谈行为——否则「界面能跑」只是前后端各自自洽。
        const parsed = identity.operations.mutateCapability.in.safeParse(body);
        expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
        expect(identity.CapabilityAddPayload.safeParse(body.payload).success).toBe(true);
        return jsonResponse({
          listing: created,
          provenanceEventId: "prov-458",
          affectedInFlightCalls: 0,
        });
      },
    });

    render(<AgentScreen state="default" />);
    await screen.findByTestId("admin-agent-empty");

    fireEvent.click(screen.getByTestId("admin-agent-create"));
    fireEvent.change(screen.getByTestId("admin-agent-create-name"), {
      target: { value: "结算助理" },
    });
    // #619：kind="agent" 时 abbr/duty 必填（本地校验先于网络请求）。
    fireEvent.change(screen.getByTestId("admin-agent-create-abbr"), { target: { value: "JS" } });
    fireEvent.change(screen.getByTestId("admin-agent-create-duty"), { target: { value: "结算" } });
    fireEvent.click(screen.getByTestId("admin-agent-create-submit"));

    expect(await screen.findByTestId("admin-agent-row-agent-new")).toHaveTextContent("结算助理");

    const mutations = mutateCalls(calls);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]!.method).toBe("POST");
    expect(mutations[0]!.body).toEqual({
      orgId: "org-458",
      kind: "agent",
      op: "add",
      payload: { name: "结算助理", scope: "org-wide", abbr: "JS", duty: "结算" },
    });
    // 二次读取存在，且发生在 mutate 之后。少了它，界面显示的就是 mutate 的回声。
    expect(listCalls(calls)).toHaveLength(2);
    // ⚠ #1915 起 `AgentScreen` 还并行挂了 `AgentDefinitionListPanel`（独立的
    // `GET /agents`），与本测试要证的「mutate 之后有没有对 /capabilities 重新 GET」
    // 无关——过滤到本能力目录相关的两条路径（listCapabilities/mutateCapability）
    // 再断言顺序，不再断言"全部网络调用"的裸序列。
    const relevant = calls.filter(
      (c) =>
        c.path === identity.operations.listCapabilities.path ||
        c.path === identity.operations.mutateCapability.path,
    );
    expect(relevant.map((c) => c.method)).toEqual(["GET", "POST", "GET"]);
  });

  it("新增 team-only 时携带 ownerTeamId——缺了它可见性规则无法回答", async () => {
    const created = listing({ id: "agent-team", name: "团队助理", scope: "team-only" });
    const { calls } = stubFetch({
      pages: [[], [created]],
      onMutate: () =>
        jsonResponse({ listing: created, provenanceEventId: "p", affectedInFlightCalls: 0 }),
    });

    render(<AgentScreen state="default" />);
    await screen.findByTestId("admin-agent-empty");

    fireEvent.click(screen.getByTestId("admin-agent-create"));
    fireEvent.change(screen.getByTestId("admin-agent-create-name"), {
      target: { value: "团队助理" },
    });
    fireEvent.change(screen.getByTestId("admin-agent-create-scope"), {
      target: { value: "team-only" },
    });
    fireEvent.change(screen.getByTestId("admin-agent-create-owner-team"), {
      target: { value: "team-energy" },
    });
    // #619：kind="agent" 时 abbr/duty 必填。
    fireEvent.change(screen.getByTestId("admin-agent-create-abbr"), { target: { value: "TD" } });
    fireEvent.change(screen.getByTestId("admin-agent-create-duty"), { target: { value: "团队协作" } });
    fireEvent.click(screen.getByTestId("admin-agent-create-submit"));

    await screen.findByTestId("admin-agent-row-agent-team");
    expect(mutateCalls(calls)[0]!.body).toEqual({
      orgId: "org-458",
      kind: "agent",
      op: "add",
      payload: {
        name: "团队助理", scope: "team-only", ownerTeamId: "team-energy",
        abbr: "TD", duty: "团队协作",
      },
    });
  });

  it("team-only 却没填团队时不发请求，本地就给出可定位的字段错误", async () => {
    const { calls } = stubFetch({ pages: [[]] });

    render(<AgentScreen state="default" />);
    await screen.findByTestId("admin-agent-empty");

    fireEvent.click(screen.getByTestId("admin-agent-create"));
    fireEvent.change(screen.getByTestId("admin-agent-create-name"), { target: { value: "无主" } });
    fireEvent.change(screen.getByTestId("admin-agent-create-scope"), {
      target: { value: "team-only" },
    });
    fireEvent.click(screen.getByTestId("admin-agent-create-submit"));

    expect(await screen.findByTestId("admin-agent-create-error")).toHaveTextContent("团队");
    expect(mutateCalls(calls)).toHaveLength(0);
  });

  it("更新：op=update 只带被改动的字段，改完仍以服务端读取为准", async () => {
    const before = listing({ id: "agent-1", name: "旧名字" });
    const after = listing({ id: "agent-1", name: "新名字" });
    const { calls } = stubFetch({
      pages: [[before], [after]],
      onMutate: (body) => {
        expect(identity.CapabilityUpdatePayload.safeParse(body.payload).success).toBe(true);
        return jsonResponse({ listing: after, provenanceEventId: "p", affectedInFlightCalls: 2 });
      },
    });

    // 人类反馈（2026-08-17）：编辑现在是独立页面（`CapabilityEditPage`），
    // 不再需要先渲染列表页、点「编辑」展开——直接渲染那个页面即可。
    render(<CapabilityEditPage kind="agent" id="agent-1" />);
    await screen.findByTestId("admin-agent-row-agent-1-name");
    fireEvent.change(screen.getByTestId("admin-agent-row-agent-1-name"), {
      target: { value: "新名字" },
    });
    fireEvent.click(screen.getByTestId("admin-agent-row-agent-1-save"));

    expect(await screen.findByText("新名字")).toBeInTheDocument();
    expect(mutateCalls(calls)[0]!.body).toEqual({
      orgId: "org-458",
      kind: "agent",
      op: "update",
      payload: { id: "agent-1", name: "新名字", scope: "org-wide" },
    });
    expect(listCalls(calls)).toHaveLength(2);
  });

  it("停用：默认 interrupt，并把服务端报出的受影响调用数原样显示", async () => {
    const before = listing({ id: "agent-1", enabled: true });
    const after = listing({ id: "agent-1", enabled: false, disabledReason: "由组织管理员停用" });
    const { calls } = stubFetch({
      pages: [[before], [after]],
      onMutate: (body) => {
        expect(identity.CapabilityDisablePayload.safeParse(body.payload).success).toBe(true);
        return jsonResponse({ listing: after, provenanceEventId: "p", affectedInFlightCalls: 3 });
      },
    });

    render(<AgentScreen state="default" />);
    const row = await screen.findByTestId("admin-agent-row-agent-1");
    fireEvent.click(within(row).getByTestId("admin-agent-row-agent-1-disable"));
    fireEvent.click(await screen.findByTestId("admin-agent-disable-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-agent-row-agent-1")).toHaveTextContent("已停用"),
    );
    expect(mutateCalls(calls)[0]!.body).toEqual({
      orgId: "org-458",
      kind: "agent",
      op: "disable",
      payload: { id: "agent-1" },
      disableMode: "interrupt",
    });
    expect(screen.getByTestId("admin-agent-mutate-notice")).toHaveTextContent("3");
  });

  it("停用可以显式选 drain——D-U5 的两种模式都要能到达服务端", async () => {
    const before = listing({ id: "agent-1", enabled: true });
    const after = listing({ id: "agent-1", enabled: false });
    const { calls } = stubFetch({
      pages: [[before], [after]],
      onMutate: () =>
        jsonResponse({ listing: after, provenanceEventId: "p", affectedInFlightCalls: 0 }),
    });

    render(<AgentScreen state="default" />);
    const row = await screen.findByTestId("admin-agent-row-agent-1");
    fireEvent.click(within(row).getByTestId("admin-agent-row-agent-1-disable"));
    fireEvent.change(await screen.findByTestId("admin-agent-disable-mode"), {
      target: { value: "drain" },
    });
    fireEvent.click(screen.getByTestId("admin-agent-disable-confirm"));

    await waitFor(() => expect(mutateCalls(calls)).toHaveLength(1));
    expect(mutateCalls(calls)[0]!.body).toMatchObject({ disableMode: "drain" });
  });

  it("服务端 403 是最终裁决：界面呈现 reasonCode，且这条记录不算创建成功", async () => {
    // 客户端手里的 orgRole 仍是 admin（缓存的 identity），服务端已经降权。
    const { calls } = stubFetch({
      pages: [[]],
      onMutate: () => jsonResponse({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" }, 403),
    });

    render(<AgentScreen state="default" />);
    await screen.findByTestId("admin-agent-empty");

    fireEvent.click(screen.getByTestId("admin-agent-create"));
    fireEvent.change(screen.getByTestId("admin-agent-create-name"), { target: { value: "越权" } });
    // #619：kind="agent" 时 abbr/duty 必填——本测试要验的是服务端 403，
    // 不填这两个字段会被本地校验拦下，请求根本发不出去，测不到服务端裁决。
    fireEvent.change(screen.getByTestId("admin-agent-create-abbr"), { target: { value: "YQ" } });
    fireEvent.change(screen.getByTestId("admin-agent-create-duty"), { target: { value: "越权测试" } });
    fireEvent.click(screen.getByTestId("admin-agent-create-submit"));

    expect(await screen.findByTestId("admin-agent-create-error")).toHaveTextContent(
      "PROJECT_ROLE_INSUFFICIENT",
    );
    // 请求真的发出去了（不是前端自己拦下来的），并且没有伪造出一行。
    expect(mutateCalls(calls)).toHaveLength(1);
    expect(screen.queryByTestId("admin-agent-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-agent-empty")).toBeInTheDocument();
    // 失败不触发二次读取——那会把「没有变化」伪装成「刷新过了」。
    expect(listCalls(calls)).toHaveLength(1);
  });

  it("401 同样如实呈现，不静默降级成空目录", async () => {
    const { calls } = stubFetch({
      pages: [[listing()]],
      onMutate: () => jsonResponse({ error: "unauthenticated" }, 401),
    });

    render(<AgentScreen state="default" />);
    const row = await screen.findByTestId("admin-agent-row-agent-1");
    fireEvent.click(within(row).getByTestId("admin-agent-row-agent-1-disable"));
    fireEvent.click(await screen.findByTestId("admin-agent-disable-confirm"));

    expect(await screen.findByTestId("admin-agent-mutate-error")).toHaveTextContent("401");
    expect(screen.getByTestId("admin-agent-row-agent-1")).toHaveTextContent("已启用");
    expect(mutateCalls(calls)).toHaveLength(1);
  });

  it("非管理员看不到任何写入口（降噪；权限本身由上面两条服务端断言守）", async () => {
    sessionState.orgRole = "consultant";
    stubFetch({ pages: [[listing()]] });

    render(<AgentScreen state="default" />);
    await screen.findByTestId("admin-agent-row-agent-1");

    expect(screen.queryByTestId("admin-agent-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-agent-row-agent-1-edit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-agent-row-agent-1-disable")).not.toBeInTheDocument();
  });

  it("反证：契约会拒绝漂移的 mutate 请求体与 payload", () => {
    // 没有这条，上面所有 safeParse 都可能是「对什么都说 yes」。
    expect(identity.operations.mutateCapability.in.safeParse({
      orgId: "o", kind: "agent", op: "remove", payload: {},
    }).success).toBe(false);
    expect(identity.CapabilityAddPayload.safeParse({ name: "x", scope: "team" }).success).toBe(false);
    expect(identity.CapabilityAddPayload.safeParse({ name: "x", scope: "team-only" }).success).toBe(false);
    expect(identity.CapabilityUpdatePayload.safeParse({ name: "x" }).success).toBe(false);
    expect(identity.CapabilityDisablePayload.safeParse({ id: "x", name: "y" }).success).toBe(false);
  });
});
