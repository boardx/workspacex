/**
 * #881 F3 —— 后台左栏计数取**真实组织数据**，不再取 `lib/mock/admin.ts` 的静态 mock。
 *
 * ## 起因是一个真实用户当场发现的矛盾
 *
 * 左栏写「Skill 11」，右边 Skill 目录页写「共 5 条」。
 * 因为左栏那排数字一直是 `skill: () => SKILLS.length`（mock 常量），与当前组织无关。
 *
 * ## 本文件钉死三件事
 *
 * ① 口径明确的两项（agent / skill）取真实 `GET /capabilities`，**且与目录页看的是同一个列表**
 *    ⇒ 左栏数字必然等于该页「共 N 条」。
 * ② 口径**未裁决**的其余项显示「—」，**不编数字**（`mock/admin.ts` 注释：口径待 Q-11）。
 * ③ 取不到 ⇒「—」，**绝不 0**；且**单类失败不传染**（I-24）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { ADMIN_NAV_TESTID } from "@/components/admin/asset-kind-nav";
import {
  buildAdminNavCountSources,
  fetchLiveAdminNavCounts,
  LIVE_COUNT_KEYS,
} from "@/lib/live-admin-nav-counts";
import { resolveAdminNavCounts } from "@/lib/admin-nav-counts";
import { ADMIN_NAV, type AdminModuleKey } from "@/lib/mock/admin";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-881" as string | null }));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () =>
    sessionState.currentOrgId === null ? null : { session: { currentOrgId: sessionState.currentOrgId } },
}));

import { AdminNav } from "@/components/admin/admin-nav";

const ALL_KEYS: AdminModuleKey[] = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.key));

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
  it("左栏 agent/skill 的数字 = 各自 GET /capabilities 返回的条数", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const kind = url.searchParams.get("kind");
      if (kind === "agent") return jsonResponse([listing("a1", "agent"), listing("a2", "agent")]);
      if (kind === "skill") return jsonResponse([listing("s1", "skill"), listing("s2", "skill"), listing("s3", "skill")]);
      return jsonResponse([]);
    }));

    render(<AdminNav active="skill" />);

    await waitFor(() => expect(countOf("agent")).toBe("2"));
    expect(countOf("skill")).toBe("3");
    // ⚠ 反 mock：mock 里 skill 是 11、agent 是 7。若这里读到 11/7，说明又吃回 mock 了。
    expect(countOf("skill")).not.toBe("11");
    expect(countOf("agent")).not.toBe("7");
  });

  it("口径未裁决的其余项显示「—」，不编数字", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    render(<AdminNav active="skill" />);

    await waitFor(() => expect(countOf("skill")).toBe("0"));
    for (const key of ALL_KEYS) {
      if ((LIVE_COUNT_KEYS as readonly string[]).includes(key)) continue;
      expect(countOf(key), `「${key}」口径未裁决，必须显示「—」而不是一个编出来的数`).toBe("—");
    }
  });

  /** ⚠ `0` 与「—」是两件事：查成功且确实为空 ⇒ `0`，不是「—」。 */
  it("查成功但确实为空 ⇒ 显示 0（不是「—」）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    render(<AdminNav active="skill" />);
    await waitFor(() => expect(countOf("skill")).toBe("0"));
    expect(countOf("agent")).toBe("0");
  });

  /**
   * #881：「—」对用户必须是**可解释**的。
   * 本 issue 之后其余项从"有一个 mock 数字"变成「—」，不解释就会被当成故障。
   */
  it("显示「—」的项带一句解释：说明是没接真实数据源，且明说不是 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    render(<AdminNav active="skill" />);
    await waitFor(() => expect(countOf("skill")).toBe("0"));

    const dashed = ALL_KEYS.filter((k) => !(LIVE_COUNT_KEYS as readonly string[]).includes(k));
    for (const key of dashed) {
      const title = screen.getByTestId(`${ADMIN_NAV_TESTID[key]}-count`).getAttribute("title");
      expect(title, `「${key}」的「—」没有给用户任何解释`).toBeTruthy();
      expect(title).toContain("尚未接入真实数据源");
      expect(title).toContain("不是 0");
    }
    // 有真实数字的项**不**挂这句解释——否则它会出现在一个不该出现的地方。
    expect(screen.getByTestId(`${ADMIN_NAV_TESTID.skill}-count`).getAttribute("title")).toBeNull();
  });

  it("未登录（拿不到 orgId）⇒ 全部「—」，不回退 mock", async () => {
    sessionState.currentOrgId = null;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    render(<AdminNav active="skill" />);
    for (const key of ALL_KEYS) expect(countOf(key)).toBe("—");
  });
});

describe("F3 · 取不到时的行为（I-24）", () => {
  it("单类失败不传染：skill 挂了显示「—」，agent 仍是数字", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.searchParams.get("kind") === "skill") return jsonResponse({ reasonCode: "BOOM" }, 500);
      return jsonResponse([listing("a1", "agent")]);
    }));

    render(<AdminNav active="skill" />);
    await waitFor(() => expect(countOf("agent")).toBe("1"));
    // 失败那一类是「—」，**不是 0**——0 会把故障显示成空目录。
    expect(countOf("skill")).toBe("—");
  });

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
