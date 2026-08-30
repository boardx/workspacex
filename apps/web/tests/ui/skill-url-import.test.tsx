/**
 * #881 F2 —— 从 URL 导入 skill 的**界面入口**。
 *
 * 后端 `POST /admin/skills/url-imports`（#595）早就接好了，但 `apps/web` 里一直零调用，
 * 用户在后台只能导 starter pack。本文件证明这条路径现在从浏览器真的走得通。
 *
 * ## 与 `skill-starter-import.test.tsx` 同一层级：mock 的是 `fetch`，不是 lib
 *
 * 打真实的组件树 + 真实的 `apiRequest`，只把网络那一层换掉 ——
 * 这样「路径对不对、方法对不对、Authorization 带没带、body 形状对不对」都被真的验到。
 * mock 掉 lib 函数只能证明"我调了我自己写的函数"。
 *
 * ## 反空转
 * ① 装置自检：确认之前**一次导入请求都没发**（否则"确认后发了一次"可能本来就在发）。
 * ② 幂等键**必须复用**：入参不变时重试用同一个 key，否则"点两次导入两份"就回来了。
 * ③ 失败断言的是**真实 reasonCode**，不是"导入失败请重试"这种不可行动的文案。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-881", orgRole: "admin" as string }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: `组织 ${sessionState.currentOrgId}` },
      orgRole: sessionState.orgRole,
    },
  }),
}));

/**
 * 2026-08-30：「编辑」链接带 `?from=<当前 URL>`（见 `capability-catalog-screen.tsx`
 * 的 `editHrefFor`），需要 `usePathname`/`useSearchParams` 有确定返回值。
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/skill",
  useSearchParams: () => new URLSearchParams(),
}));

import { SkillScreen } from "@/components/admin/skill-screen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const IMPORTED = {
  id: "sk_881_imported",
  orgId: "org-881",
  kind: "skill",
  name: "从 URL 导入的 Skill",
  scope: "org-wide",
  enabled: true,
  endpoint: null,
  disabledReason: null,
};

const URL_IMPORT_PATH = "/admin/skills/url-imports";

/** 只挑出「导入」这一类请求——列表请求不算。 */
function importCalls(fetchMock: { mock: { calls: unknown[][] } }): unknown[][] {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes(URL_IMPORT_PATH));
}

beforeEach(() => {
  sessionState.currentOrgId = "org-881";
  sessionState.orgRole = "admin";
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-881");
});

afterEach(() => vi.unstubAllGlobals());

/**
 * #1941 —— 面板默认已展开（`aria-expanded="true"`），只在它意外收起时才点开，
 * 不无条件点击（否则会把默认展开的面板点成收起，与本轮修的行为正相反）。
 */
function ensureUrlImportOpen() {
  const opener = screen.getByTestId("skill-url-import-open");
  if (opener.getAttribute("aria-expanded") !== "true") fireEvent.click(opener);
}

/** 打开面板并填好两个字段。返回捕获到的导入请求体数组。 */
async function openAndFill(fetchMock: ReturnType<typeof vi.fn>) {
  render(<SkillScreen state="default" />);
  await screen.findByTestId("skill-url-import-panel");
  ensureUrlImportOpen();
  fireEvent.change(screen.getByTestId("skill-url-import-url"), {
    target: { value: "https://example.com/s.md" },
  });
  fireEvent.change(screen.getByTestId("skill-url-import-name"), {
    target: { value: "从 URL 导入的 Skill" },
  });
  // 装置自检：到这一步为止，导入请求必须一次都没发过。
  expect(importCalls(fetchMock)).toHaveLength(0);
}

describe("issue #1941 · 折叠面板默认展开，不需要额外点击就能可发现", () => {
  it("面板挂载后：不点『从 URL 导入』触发按钮，单文件/仓库导入两个 tab 与输入框就已经在 DOM 里", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);
    await screen.findByTestId("skill-url-import-panel");

    const opener = screen.getByTestId("skill-url-import-open");
    expect(opener).toHaveAttribute("aria-expanded", "true");
    // 不点 opener——如果这些元素能被找到，说明确实默认就展开了，不是恰好被别处点开。
    expect(screen.getByTestId("skill-url-import-mode-single")).toBeTruthy();
    expect(screen.getByTestId("skill-url-import-mode-repo")).toBeTruthy();
    expect(screen.getByTestId("skill-url-import-url")).toBeTruthy();
    expect(screen.getByTestId("skill-url-import-name")).toBeTruthy();
  });

  it("点『从 URL 导入』可以收起（折叠触发按钮功能仍在，只是初始态变了）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);
    await screen.findByTestId("skill-url-import-panel");
    fireEvent.click(screen.getByTestId("skill-url-import-open"));

    expect(screen.getByTestId("skill-url-import-open")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("skill-url-import-url")).toBeNull();
  });
});

describe("F2 · 真的能从 URL 导入", () => {
  it("确认后：打真实端口、带 Bearer、body 形状与契约一致，导入结果如实显示", async () => {
    let listCount = 0;
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") {
        listCount += 1;
        return jsonResponse(listCount === 1 ? [] : [IMPORTED]);
      }
      expect(url.pathname).toBe(URL_IMPORT_PATH);
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-881");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return jsonResponse({
        skillId: "sk_881_imported",
        versionId: "skv_881",
        filePaths: ["SKILL.md", "references/a.md"],
        contentDigest: "b".repeat(64),
        replayed: false,
      }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openAndFill(fetchMock);
    fireEvent.click(screen.getByTestId("skill-url-import-confirm"));

    const result = await screen.findByTestId("skill-url-import-result");
    expect(result.textContent).toContain("已导入 2 个文件");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.sourceUrl).toBe("https://example.com/s.md");
    expect(bodies[0]!.name).toBe("从 URL 导入的 Skill");
    expect(String(bodies[0]!.idempotencyKey)).toMatch(/^[0-9a-f-]{36}$/);
    // 导入成功后目录被重新读取，新 skill 出现在列表里。
    await waitFor(() => expect(screen.getByText("从 URL 导入的 Skill")).toBeTruthy());
  });

  /**
   * ⚠ 幂等键复用：这条挡的是「点两次导入两份」。
   * 入参没变 ⇒ 重试必须带**同一个** key，服务端才能认出是重放。
   */
  it("入参不变时重试：复用同一个 idempotencyKey", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") return jsonResponse([]);
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      // 第一次失败，让用户重试；第二次成功且标记为重放。
      if (bodies.length === 1) return jsonResponse({ reasonCode: "AUTH_SERVICE_UNAVAILABLE" }, 503);
      return jsonResponse({
        skillId: "sk_881_imported", versionId: "skv_881",
        filePaths: ["SKILL.md"], contentDigest: "c".repeat(64), replayed: true,
      }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openAndFill(fetchMock);
    fireEvent.click(screen.getByTestId("skill-url-import-confirm"));
    await screen.findByTestId("skill-url-import-result");

    fireEvent.click(screen.getByTestId("skill-url-import-confirm"));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.idempotencyKey).toBe(bodies[0]!.idempotencyKey);

    // 服务端说这次是重放，界面必须把它与"新导入"区分开。
    await waitFor(() =>
      expect(screen.getByTestId("skill-url-import-result").textContent).toContain("重放"),
    );
  });

  it("失败：显示服务端真实 reasonCode，不显示成功", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/capabilities") return jsonResponse([]);
      return jsonResponse({ reasonCode: "IMPORT_URL_NOT_ALLOWED" }, 422);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openAndFill(fetchMock);
    fireEvent.click(screen.getByTestId("skill-url-import-confirm"));

    const result = await screen.findByTestId("skill-url-import-result");
    expect(result.textContent).toContain("IMPORT_URL_NOT_ALLOWED");
    expect(result.textContent).toContain("导入失败");
    // ⛔ 失败时不得出现任何"已导入"字样。
    expect(result.textContent).not.toContain("已导入");
  });

  it("字段没填全时不可提交：不发一次注定被拒的请求", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);
    await screen.findByTestId("skill-url-import-panel");
    ensureUrlImportOpen();
    fireEvent.change(screen.getByTestId("skill-url-import-url"), {
      target: { value: "https://example.com/s.md" },
    });
    // 只填了 URL，没填名字
    expect((screen.getByTestId("skill-url-import-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(importCalls(fetchMock)).toHaveLength(0);
  });
});

describe("F2 · 权限：界面只降噪，服务端才是权威", () => {
  /**
   * ⚠ 这条只证明「非管理员看不到写入口」这一半（降噪）。
   * 「服务端拒绝」那一半由 API 侧证明（`import-skill-from-url.ts` 的 admin 判定是第一动作，
   * 且在 fetch 之前——顺序本身是 SSRF 防护的一部分），不在前端复述一份权限规则。
   */
  it("非管理员：URL 导入面板不渲染", async () => {
    sessionState.orgRole = "consultant";
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);
    await waitFor(() => expect(screen.queryByTestId("skill-url-import-panel")).toBeNull());
  });
});
