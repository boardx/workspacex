/**
 * #596 —— 组织切换器必须显示**用户注册时填的组织名**，永远不显示内部组织 ID。
 *
 * 人类在 devapp 实测截图：顶栏切换器里躺着 `org-2e5de17f74b8731f` 和
 * `org-local-e30d9514-…`。后端**存对了**（`pg-registration-repository.ts` 的
 * `INSERT INTO organizations (id, name, kind)` 写的是表单里的 orgName，
 * `pg-identity-repository.findOrganization` 也把 `name` 读回来了）——
 * 坏的是前端读侧：`app-shell.tsx` 过去写
 * `label: id === 当前组织 ? identity.org.name : id`，
 * 于是**除当前组织外一律回落成裸 ID**。
 *
 * ## 这些断言断的是渲染出来的 DOM 文本，不是源码字符串
 * 本仓刚栽过一次「`toContain("assertProjectMember")` 命中的是方法定义本身，
 * 把调用注释掉照样全绿」。所以这里跑的是**真的 `SessionProvider` + 真的 `AppShell`**，
 * 只把网络边界（`@/lib/session-api`）换成 mock；断言全部落在
 * `getByTestId("org-switcher")` 渲染出的 `<option>` 文本上。
 *
 * ## 等待形状：一次 `findBy*` 等挂载，之后只用**同步**回调的 `waitFor`（2026-08-09）
 * 本文件曾在高负载下随机抛 `Error: Timed out in waitFor.`，把**任何人**的 push 挡下来
 * （pre-push 跑 `--affected`，动了 web 就带上它）。根因不是「机器慢、不稳」，是
 * `waitFor(async () => … await findByTestId …)` 这个嵌套：两个 1000ms 预算抢同一段
 * 墙钟，且外层在内层挂起期间**停止重查**、`lastError` 为空 —— 详见 `switcherOptions` 上方。
 * 修法是去掉嵌套 + 让重试回调足够便宜，不是加超时、加重试：本仓 e2e fixture 注释里
 * 点名过「间歇失败最后被归因成『不稳』然后加重试掩盖过去」，这里不重蹈。
 *
 * ## 三条反证（对应工单要求 A / B / C）
 *   A 把修复摘掉（`label: … : id`）⇒ 用例 1 必红。
 *   B 红落在「第二个组织显示真名」那一步，之前「当前组织显示真名」仍绿 —— 用例 1 的
 *     断言顺序刻意这么排，摘掉修复时前一条不会跟着红。
 *   C 用例 2 / 3 造「名字还没到 / 拿不到」的时序：界面必须显示**加载态或不可用文案**，
 *     绝不能出现裸 ID。这是本 bug 的本质 —— 旧代码正是在这个时序下露出 ID。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import {
  ORG_NAME_PENDING_LABEL,
  ORG_NAME_UNAVAILABLE_LABEL,
} from "@/lib/org-display";
import {
  SESSION_COMMIT_STORAGE_KEY,
  SESSION_STORAGE_KEY,
} from "@/components/session/session-provider";

const { replace, resolveIdentity, switchCurrentOrganization } = vi.hoisted(() => ({
  replace: vi.fn(),
  resolveIdentity: vi.fn(),
  switchCurrentOrganization: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/session-api", () => ({ resolveIdentity, switchCurrentOrganization }));

import { SessionProvider } from "@/components/session/session-provider";
import { AppShell } from "@/components/shell/app-shell";

/** 注册时填的那个组织，以及注册事务顺手建出来的个人本地组织。两者都有真名。 */
const CURRENT_ORG = { id: "org-2e5de17f74b8731f", name: "远洋咨询" } as const;
const OTHER_ORG = { id: "org-local-e30d9514-1b8f-4758-a2f9-4135023042cb", name: "闭环管理员的本地空间" } as const;

function identityFor(orgId: string, name: string, kind: "organization" | "personal-local") {
  return {
    org: { id: orgId, name, kind, team: null },
    orgRole: "admin",
    teamId: null,
    projectRole: null,
    groupId: null,
    displayName: "user-596",
  };
}

function seedSession() {
  const revision = "rev-596";
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "bearer-596");
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    version: 2,
    revision,
    userId: "user-596",
    orgs: [CURRENT_ORG.id, OTHER_ORG.id],
    currentOrgId: CURRENT_ORG.id,
    expiresAt: "2099-01-01T00:00:00.000Z",
  }));
  window.localStorage.setItem(SESSION_COMMIT_STORAGE_KEY, revision);
}

function renderShell() {
  return render(
    <SessionProvider>
      <AppShell previewRole={null}>内容区</AppShell>
    </SessionProvider>,
  );
}

/**
 * 切换器里逐个 `<option>` 的可见文本 —— 用户真正读到的东西。
 *
 * ⚠ **同步**，而且刻意用最便宜的两步：`getByTestId`（属性选择器）+ `querySelectorAll`。
 * 它要在 `waitFor` 的回调里被反复调用，回调本身的成本就是这次 flake 的关键变量。
 *
 * 反面教材（2026-08-09 实测记录，别再走一遍）：
 *   ① 原写法 `async` + 内部 `await screen.findByTestId(…)`，调用点套在
 *      `waitFor(async () => …)` 里 —— `waitFor` 明令禁止的嵌套异步查询。
 *      `wait-for.js` 的 `checkCallback()` 第一行是 `if (promiseStatus === 'pending') return;`：
 *      内层 `findBy*`（自带 1000ms 预算）挂起期间外层**完全停止重查**，`lastError`
 *      始终为 undefined，于是外层到点抛出**没有任何诊断信息的**
 *      `Error: Timed out in waitFor.` —— 正是挡住所有人 push 的那条。
 *   ② 第一版修法改成 `findByRole("option", { name })`，**实测更糟**：40 burner 稳态
 *      负载下 6 轮里红 5 轮，而原写法 6 轮全绿。`byRole` 每次重试都要重算整棵
 *      可及性树并求每个节点的 accessible name，查询本身就把 1000ms 预算吃光了。
 *      教训：`waitFor` 回调必须**便宜**，`byRole` 在热重试路径上不是免费的语义糖。
 */
function switcherOptions(): string[] {
  const select = screen.getByTestId("org-switcher");
  return Array.from(select.querySelectorAll("option")).map((o) => o.textContent ?? "");
}

beforeEach(() => {
  replace.mockReset();
  resolveIdentity.mockReset();
  switchCurrentOrganization.mockReset();
  window.localStorage.clear();
  seedSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#596 组织切换器显示真实组织名", () => {
  it("两个组织都显示注册时填的名字，界面上没有任何裸组织 ID", async () => {
    resolveIdentity.mockImplementation(async (orgId: string) =>
      orgId === CURRENT_ORG.id
        ? identityFor(CURRENT_ORG.id, CURRENT_ORG.name, "organization")
        : identityFor(OTHER_ORG.id, OTHER_ORG.name, "personal-local"));

    renderShell();

    // 先等挂载：**唯一**一次异步查询，之后的等待全是同步回调。
    await screen.findByTestId("org-switcher");

    // ── B：这一条在「摘掉修复」时仍必须绿 —— 当前组织的名字本来就拿得到 ──
    await waitFor(() => expect(switcherOptions()).toContain(CURRENT_ORG.name));

    // ── A/B 的靶心：**非当前组织**过去在这里显示成 `org-local-…` ──
    await waitFor(() =>
      expect(switcherOptions()).toEqual([CURRENT_ORG.name, OTHER_ORG.name]));

    // 兜底：切换器整块可见文本里不得出现内部 ID 的任何片段。
    expect(screen.getByTestId("org-switcher").textContent).not.toContain("org-");
  });

  it("C：另一个组织的名字还没回来时显示加载态，不拿 ID 顶替", async () => {
    // 当前组织正常解析；另一个组织的 `/identity/me` **永不返回** —— 这正是旧代码露出 ID 的时序。
    resolveIdentity.mockImplementation(async (orgId: string) => {
      if (orgId === CURRENT_ORG.id) return identityFor(CURRENT_ORG.id, CURRENT_ORG.name, "organization");
      return new Promise(() => {});
    });

    renderShell();

    await screen.findByTestId("org-switcher");
    await waitFor(() =>
      expect(switcherOptions()).toEqual([CURRENT_ORG.name, ORG_NAME_PENDING_LABEL]));
    const switcher = screen.getByTestId("org-switcher");
    expect(switcher.textContent).not.toContain(OTHER_ORG.id);
    expect(switcher.textContent).not.toContain("org-");
  });

  it("C'：某个组织的名字查失败时显示「暂不可用」，不降级成 ID，也不把整个会话打成失败态", async () => {
    resolveIdentity.mockImplementation(async (orgId: string) => {
      if (orgId === CURRENT_ORG.id) return identityFor(CURRENT_ORG.id, CURRENT_ORG.name, "organization");
      throw new Error("identity lookup failed");
    });

    renderShell();

    await screen.findByTestId("org-switcher");
    await waitFor(() =>
      expect(switcherOptions()).toEqual([CURRENT_ORG.name, ORG_NAME_UNAVAILABLE_LABEL]));
    // 会话本身仍然可用：一个组织读不到名字，不该把人踢出应用。
    expect(screen.getByTestId("app-shell")).toBeTruthy();
    expect(screen.queryByTestId("session-dependency-failed")).toBeNull();
  });
});
