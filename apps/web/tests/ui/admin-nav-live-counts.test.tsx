/** 组织能力计数取真实数据，平台导航不显示当前组织的能力计数。 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClientTestWrapper } from "../render-with-query";
import { ADMIN_NAV_TESTID } from "@/components/admin/asset-kind-nav";
import {
  buildAdminNavCountSources,
  fetchLiveAdminNavCounts,
} from "@/lib/live-admin-nav-counts";
import { resolveAdminNavCounts } from "@/lib/admin-nav-counts";
import { adminNavForScope, type AdminModuleKey } from "@/lib/mock/admin";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-881" as string | null }));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () =>
    sessionState.currentOrgId === null ? null : { session: { currentOrgId: sessionState.currentOrgId } },
}));

import { AdminNav } from "@/components/admin/admin-nav";

const ALL_KEYS: AdminModuleKey[] = adminNavForScope("platform").flatMap((g) => g.items.map((i) => i.key));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function listing(id: string, kind: string) {
  return { id, orgId: "org-881", kind, name: id, scope: "org-wide", enabled: true, endpoint: null, disabledReason: null };
}

const countOf = (key: AdminModuleKey) =>
  screen.getByTestId(`${ADMIN_NAV_TESTID[key]}-count`).textContent;

beforeEach(() => {
  sessionState.currentOrgId = "org-881";
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-881");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("F3 · 真实计数（agent / skill）", () => {
  it("平台导航隐藏当前组织的 Agent 和 Skill 计数", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const kind = url.searchParams.get("kind");
      if (kind === "agent") return jsonResponse([listing("a1", "agent"), listing("a2", "agent")]);
      if (kind === "skill") return jsonResponse([listing("s1", "skill"), listing("s2", "skill"), listing("s3", "skill")]);
      return jsonResponse({ count: 4 });
    }));

    render(<AdminNav active="skill" />, { wrapper: QueryClientTestWrapper });

    await waitFor(() => expect(countOf("feedback-drafts")).toBe("4"));
    for (const key of ALL_KEYS) {
      if (key === "feedback-drafts") continue;
      expect(countOf(key)).toBe("—");
      const count = screen.getByTestId(`${ADMIN_NAV_TESTID[key]}-count`);
      expect(count).toHaveAttribute("title", expect.stringContaining("尚未接入真实数据源"));
    }
    expect(screen.getByTestId(`${ADMIN_NAV_TESTID["feedback-drafts"]}-count`)).not.toHaveAttribute("title");
  });

  it("组织能力计数使用 API 条数，空列表解析为 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.searchParams.get("kind") === "agent") {
        return jsonResponse([listing("a1", "agent"), listing("a2", "agent")]);
      }
      return jsonResponse([]);
    }));

    const live = await fetchLiveAdminNavCounts("org-881");
    const resolved = resolveAdminNavCounts(buildAdminNavCountSources(ALL_KEYS, live));
    expect(resolved.agent).toBe(2);
    expect(resolved.skill).toBe(0);
  });

  it("未登录（拿不到 orgId）⇒ 全部「—」，不回退 mock", async () => {
    sessionState.currentOrgId = null;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    render(<AdminNav active="skill" />, { wrapper: QueryClientTestWrapper });
    for (const key of ALL_KEYS) expect(countOf(key)).toBe("—");
  });
});

describe("F3 · 取不到时的行为（I-24）", () => {
  it("装置自检：fetchLiveAdminNavCounts 对失败的那一类不返回键（⇒ 上游判「—」）", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.searchParams.get("kind") === "skill") return jsonResponse({ reasonCode: "BOOM" }, 500);
      return jsonResponse([listing("a1", "agent")]);
    }));

    const live = await fetchLiveAdminNavCounts("org-881");
    expect(live.agent).toBe(1);
    expect("skill" in live).toBe(false);

    // 装配之后：缺键 ⇒ 来源抛错 ⇒ 「—」；有键 ⇒ 数字。尺子本身有效。
    const resolved = resolveAdminNavCounts(buildAdminNavCountSources(ALL_KEYS, live));
    expect(resolved.agent).toBe(1);
    expect(resolved.skill).toBe("—");
  });
});
