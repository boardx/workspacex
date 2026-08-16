/**
 * F192（design-delta `skill-model-a-b-convergence` 选项②，issue #598，已签核）——
 * `/skill` 库屏「完全新建（契约表单）」入口已移除，真栈组件渲染反证。
 *
 * ## 断的是什么（UC-3.7 R12 V2）
 *
 * 真实渲染 `SkillCatalogLive`（本文件不 mock 这个组件本身，只 stub `fetch` 与
 * `useSession`——同 `skill-catalog-live.test.tsx` 的既定做法），断言 DOM 里：
 *   ① 没有任何触发 `createSkillDraft` 的按钮/面板（`skill-create-panel` /
 *      `skill-create-mode-form` / `skill-create-submit` 等曾经存在的 testid 全部不在）；
 *   ② 新建弹窗的 tab 切换器里只剩两条路径（导入 / 市场），不再有第三条；
 *   ③ 打开新建弹窗后，默认落在「导入」这条真实可达的路径上，不是一片空白；
 *   ④ `WAVE2_BACKED_DUTY_MARKER` 哨兵与 A/B 分流逻辑保持不变——存量模型 B 行
 *      （非 wave2 标记）仍然正常显示、可点开「查看契约」。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: "org-f190" },
    identity: { org: { name: "测试组织" }, orgRole: "admin" },
  }),
}));

import { SkillCatalogLive } from "@/components/skill/skill-catalog-live";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("F192 · /skill 库屏没有「完全新建」入口", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-f190");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function install(handler: (call: { method: string; pathname: string }) => Response | Promise<Response>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        return handler({ method: init?.method ?? "GET", pathname: url.pathname });
      }),
    );
  }

  it("打开新建弹窗后，DOM 里不存在任何触发 createSkillDraft 的按钮/面板", async () => {
    install(() => jsonResponse({ items: [], total: 0 }));
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

    fireEvent.click(screen.getByTestId("skill-create-open"));
    const dialog = screen.getByTestId("skill-create-modal");
    expect(dialog).toBeTruthy();

    // 这些 testid 曾经是「完全新建（契约表单）」面板的入口/字段——全部不该再出现。
    expect(screen.queryByTestId("skill-create-panel")).toBeNull();
    expect(screen.queryByTestId("skill-create-mode-form")).toBeNull();
    expect(screen.queryByTestId("skill-create-name")).toBeNull();
    expect(screen.queryByTestId("skill-create-duty")).toBeNull();
    expect(screen.queryByTestId("skill-create-prompt")).toBeNull();
    expect(screen.queryByTestId("skill-create-input-schema")).toBeNull();
    expect(screen.queryByTestId("skill-create-output-schema")).toBeNull();
    expect(screen.queryByTestId("skill-create-data-scope")).toBeNull();
    expect(screen.queryByTestId("skill-create-fallback")).toBeNull();
    expect(screen.queryByTestId("skill-create-model")).toBeNull();
    expect(screen.queryByTestId("skill-create-submit")).toBeNull();

    // 反空转：不是「弹窗压根没渲染出内容」——里面确实有真实可达的东西（导入面板）。
    expect(screen.getByTestId("skill-create-mode-tabs")).toBeTruthy();
    expect(screen.getByTestId("skill-url-import-panel")).toBeTruthy();
  });

  it("新建弹窗只剩两条路径（导入／市场），不再有第三条", async () => {
    install(() => jsonResponse({ items: [], total: 0 }));
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

    fireEvent.click(screen.getByTestId("skill-create-open"));
    expect(screen.getByTestId("skill-create-mode-import")).toBeTruthy();
    expect(screen.getByTestId("skill-create-mode-market")).toBeTruthy();
    expect(screen.queryByTestId("skill-create-mode-form")).toBeNull();
  });

  it("打开新建弹窗默认落在「导入」路径上（不是一片空白，也不是仍然默认到已下线的表单）", async () => {
    install(() => jsonResponse({ items: [], total: 0 }));
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-empty")).toBeTruthy());

    fireEvent.click(screen.getByTestId("skill-create-open"));
    expect(screen.getByTestId("skill-create-mode-import").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("skill-url-import-panel")).toBeTruthy();
  });

  it("反证自检：走图器意义上——组件模块源码里已经不存在 createSkillDraft 这个标识符", async () => {
    // 与 apps/web/tests/session/skill-create-route-no-mock.test.ts 的走图器断言互补：
    // 那个文件断言「全仓只有 lib/live-skill.ts 一处调用创建端点」，本条直接断言
    // 触发它的那个组件级函数/import 已经不在 skill-catalog-live.tsx 源码里了。
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(process.cwd(), "components/skill/skill-catalog-live.tsx"),
      "utf8",
    );
    expect(source).not.toContain("createSkillDraft,");
    expect(source).not.toMatch(/\bcreateSkillDraft\(/);
  });

  it("存量模型 B 行（非 wave2 标记）仍然正常显示、可点开「查看契约」——A/B 分流逻辑不变", async () => {
    install(() =>
      jsonResponse({
        items: [
          {
            skillId: "sk-legacy-b",
            name: "冻结前的遗留契约",
            duty: "普通职责说明（非 wave2 标记）",
            source: "自建",
            status: "草稿",
            visibility: "org-wide",
            currentVersionId: null,
            satisfaction: null,
            tags: [],
          },
        ],
        total: 1,
      }),
    );
    render(<SkillCatalogLive />);
    await waitFor(() => expect(screen.getByTestId("skill-catalog-list")).toBeTruthy());

    // 普通行走「查看契约」入口，不是「编辑源码」——WAVE2_BACKED_DUTY_MARKER 分流未变。
    expect(screen.getAllByTestId("skill-catalog-detail")).toHaveLength(1);
    expect(screen.queryByTestId("skill-catalog-edit-source")).toBeNull();
  });
});
