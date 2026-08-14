/**
 * G6（2026-08-14，人类实测：点卡片报 404）—— `skill-catalog-live.tsx`（真实卡片网格
 * 屏，`/skill?screen=library`）上「编辑源码」按钮跳到 `?screen=catalog&edit=<skillId>`，
 * `CapabilityCatalogScreen` 接住这个 query 参数、数据到位后自动展开那一行的编辑表单。
 *
 * 覆盖的是这条深链本身（`capability-catalog-screen.tsx` 读 `edit` 参数那段），
 * 不是「编辑源码」按钮的 href 拼接——那条在 `skill-catalog-live.test.tsx` 的
 * G2/G6 那组已经断言过。两边合起来才是「点了之后真的落地」的完整闭环。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-g6-deeplink", orgRole: "admin" }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
}));

import { SkillScreen } from "@/components/admin/skill-screen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function twoListings() {
  // ⚠ `listCapabilities` 的响应是**裸数组**（`lib/live-capabilities.ts`），
  //   不是 `{items,total}`——那个信封形状是 `skills.listSkills`（另一个不同的契约）的。
  return jsonResponse([
    {
      id: "skill-1", orgId: sessionState.currentOrgId, kind: "skill", name: "第一个",
      scope: "org-wide", enabled: true, endpoint: null, disabledReason: null,
    },
    {
      id: "skill-2", orgId: sessionState.currentOrgId, kind: "skill", name: "第二个（要深链到这个）",
      scope: "org-wide", enabled: true, endpoint: null, disabledReason: null,
    },
  ]);
}

describe("G6：?edit=<skillId> 深链自动展开那一行的编辑表单", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-g6");
    vi.stubGlobal("fetch", vi.fn(async () => twoListings()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  it("地址栏带 ?edit=skill-2 时，数据到位后自动展开 skill-2 这一行的编辑表单", async () => {
    window.history.pushState({}, "", "/skill?screen=catalog&edit=skill-2");
    render(<SkillScreen state="default" />);

    await waitFor(() => expect(screen.getByTestId("admin-skill-list")).toBeTruthy());
    // 自动展开：不需要点「编辑」，编辑表单（`CapabilityEditForm`）直接可见。
    await waitFor(() => expect(screen.queryByTestId("admin-skill-row-skill-2-edit")).toBeNull());
    // 另一行没有被误展开——只有深链指向的那一行。
    expect(screen.getByTestId("admin-skill-row-skill-1-edit")).toBeTruthy();
  });

  it("没有 ?edit= 参数时，两行都保持折叠（既有行为不受影响）", async () => {
    window.history.pushState({}, "", "/skill?screen=catalog");
    render(<SkillScreen state="default" />);

    await waitFor(() => expect(screen.getByTestId("admin-skill-list")).toBeTruthy());
    expect(screen.getByTestId("admin-skill-row-skill-1-edit")).toBeTruthy();
    expect(screen.getByTestId("admin-skill-row-skill-2-edit")).toBeTruthy();
  });

  it("?edit= 指向一个当前这批行里不存在的 id 时，如实什么都不展开（不报错）", async () => {
    window.history.pushState({}, "", "/skill?screen=catalog&edit=skill-does-not-exist");
    render(<SkillScreen state="default" />);

    await waitFor(() => expect(screen.getByTestId("admin-skill-list")).toBeTruthy());
    expect(screen.getByTestId("admin-skill-row-skill-1-edit")).toBeTruthy();
    expect(screen.getByTestId("admin-skill-row-skill-2-edit")).toBeTruthy();
  });
});
