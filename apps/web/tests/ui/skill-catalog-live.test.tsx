/**
 * #520 —— `/skill` 的 Skill 库屏接真实 API 的**组件测试**。
 *
 * ## ⚠ 这**不能**替代 `e2e/skill-create-smoke.spec.ts`，一条也不能
 *
 * 这里的 `fetch` 是假的。组件测试里的「刷新」只是再调一次这个假 `fetch`，它**永远**
 * 分不出「写进了库」和「写进了 React state」——那正是本 issue 唯一要证的东西。
 * 持久化那一条只有真实浏览器 + 真实 PostgreSQL 证得了，那条在 e2e spec 里。
 *
 * 那这里还证什么？证**请求与渲染的形状**，也就是 e2e 跑起来之前就能钉死的部分：
 *   ① 打的是契约的路径与方法，`orgId` 来自会话而不是别处；
 *   ② 请求体里**没有** `source`（它由服务端按入口打标，写它 ⇒ `SOURCE_TAG_IMMUTABLE`）；
 *   ③ 空结果渲染**真实空态**，不生成任何示例 skill；
 *   ④ 失败态回显后端**真实错误信封**：reasonCode ＋ HTTP 状态，不糊成「加载失败」。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: "org-520" },
    identity: { org: { name: "测试组织" }, orgRole: "admin" },
  }),
}));

import { SkillCatalogLive } from "@/components/skill/skill-catalog-live";

const ORG = "org-520";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Recorded {
  readonly method: string;
  readonly pathname: string;
  readonly search: URLSearchParams;
  readonly body: unknown;
}

describe("#520 Skill 库屏接真实 API", () => {
  let calls: Recorded[];

  function install(handler: (call: Recorded) => Response) {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        const call: Recorded = {
          method: init?.method ?? "GET",
          pathname: url.pathname,
          search: url.searchParams,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        };
        calls.push(call);
        return handler(call);
      }),
    );
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-520");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("空结果渲染真实空态，不生成任何示例 skill", async () => {
    install(() => jsonResponse({ items: [], total: 0 }));
    render(<SkillCatalogLive />);

    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());
    // 反空转：确实是「读成功且为空」，不是「还在加载」。
    expect(screen.queryByTestId("skill-catalog-loading")).toBeNull();
    expect(screen.queryByTestId("skill-catalog-error")).toBeNull();
    expect(screen.queryByTestId("skill-catalog-list")).toBeNull();

    const list = calls.find((c) => c.method === "GET" && c.pathname === "/skills");
    expect(list).toBeTruthy();
    expect(list!.search.get("orgId")).toBe(ORG);
    // 契约 I-14：四入口共用同一份可见性过滤，入口选择器不能漏。
    expect(list!.search.get("entry")).toBe("library");
  });

  it("提交打的是 POST /skills，请求体是契约的形状，且**不含** source", async () => {
    install((call) => {
      if (call.method === "GET") return jsonResponse({ items: [], total: 0 });
      return jsonResponse(
        { skillId: "sk-1", versionId: "sv-1", source: "自建", status: "草稿" },
        201,
      );
    });
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

    fireEvent.click(screen.getByTestId("skill-create-open"));
    fireEvent.change(screen.getByTestId("skill-create-name"), { target: { value: "排序器" } });
    fireEvent.change(screen.getByTestId("skill-create-duty"), { target: { value: "排序" } });
    fireEvent.change(screen.getByTestId("skill-create-prompt"), { target: { value: "排 {{x}}" } });
    fireEvent.change(screen.getByTestId("skill-create-input-schema"), { target: { value: "{}" } });
    fireEvent.change(screen.getByTestId("skill-create-output-schema"), { target: { value: "{}" } });
    fireEvent.change(screen.getByTestId("skill-create-fallback"), { target: { value: "如实说" } });
    fireEvent.click(screen.getByTestId("skill-create-submit"));

    await waitFor(() => expect(screen.getByTestId("skill-catalog-notice")).toBeTruthy());

    const post = calls.find((c) => c.method === "POST");
    expect(post?.pathname).toBe("/skills");
    const body = post!.body as Record<string, unknown>;
    expect(body.orgId).toBe(ORG);
    expect(body.visibility).toBe("org-wide");
    // ⚠ 服务端按入口打标；请求体里出现 source ⇒ `SOURCE_TAG_IMMUTABLE`。
    expect("source" in body).toBe(false);
    const contract = body.contract as Record<string, unknown>;
    // 空输入折成**空数组**，不是 `[""]`——后者会被 fail-closed 的授权判成越权。
    expect(contract.dataScope).toEqual([]);
    expect(contract.readsRawTranscript).toBe(false);

    // 服务端分配的字段进了列表（状态只能是草稿：没有第二个评审人就没有已启用）。
    expect(screen.getByTestId("skill-catalog-list").textContent).toContain("排序器");
    expect(screen.getByTestId("skill-catalog-list").textContent).toContain("草稿");
  });

  it("被拒绝时回显后端真实错误信封：reasonCode ＋ HTTP 状态", async () => {
    install((call) => {
      if (call.method === "GET") return jsonResponse({ items: [], total: 0 });
      return jsonResponse(
        { error: "forbidden", traceId: "t-1", reasonCode: "DATA_SCOPE_EXCEEDS_SUBMITTER" },
        403,
      );
    });
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

    fireEvent.click(screen.getByTestId("skill-create-open"));
    fireEvent.change(screen.getByTestId("skill-create-name"), { target: { value: "越权的" } });
    fireEvent.change(screen.getByTestId("skill-create-data-scope"), {
      target: { value: "crm:customer:read" },
    });
    fireEvent.click(screen.getByTestId("skill-create-submit"));

    const error = await screen.findByTestId("skill-create-error");
    expect(error.textContent).toContain("DATA_SCOPE_EXCEEDS_SUBMITTER");
    expect(error.textContent).toContain("403");
    // 被拒绝的东西没有混进列表——失败态不留乐观插入的残影。
    expect(screen.queryByTestId("skill-catalog-list")).toBeNull();
    expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy();
  });

  it("列表读取失败也回显真实信封，并给出重试", async () => {
    install(() => jsonResponse({ error: "forbidden", traceId: "t-2", reasonCode: "PERMISSION_REVOKED" }, 403));
    render(<SkillCatalogLive />);

    const error = await screen.findByTestId("skill-catalog-error");
    expect(error.textContent).toContain("PERMISSION_REVOKED");
    expect(error.textContent).toContain("403");
    // 失败不是空态：两者在界面上必须分得开。
    expect(screen.queryByTestId("skill-catalog-empty")).toBeNull();
    expect(screen.getByTestId("skill-catalog-retry")).toBeTruthy();
  });
});
