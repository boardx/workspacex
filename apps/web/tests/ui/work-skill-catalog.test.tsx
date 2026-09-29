/**
 * WS05 —— `/skill?screen=work-catalog` Work Skill 目录屏（R8；契约束 work-skill-meta ui.md）。
 *
 * 假 `fetch` 证请求与渲染的形状：S003 行字段、筛选/通道/搜索参数、详情抽屉分组、
 * 空态+清除筛选（E7）、就绪性 unknown 局部提示（E5）、非管理员不渲染通道按钮（E9）、
 * 列表失败态、屏路由接线。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-ws05" }, identity: { org: { name: "测试组织" } } }),
}));

import { WorkSkillCatalog } from "@/components/skill/work-skill-catalog";
import { resolveSkillScreen } from "@/lib/mock/skill";

const SKILL_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const SUCC_ID = "33333333-3333-4333-8333-333333333333";

type Readiness = { overall: "ready" | "not_ready" | "unknown"; missingRequired: number | null };

function item(readiness: Readiness = { overall: "not_ready", missingRequired: 1 }) {
  return {
    skillId: SKILL_ID,
    name: "竞品情报简报",
    stableId: "S003",
    domain: "Research",
    channel: "candidate",
    riskClass: "medium",
    currentVersionId: VERSION_ID,
    currentVersionLabel: "1.0.0",
    readiness,
    successorSkillId: null,
  };
}

function detail(canManageChannel: boolean) {
  return {
    ...item(),
    successorSkillId: SUCC_ID,
    description: "汇总竞品动态",
    manifest: {
      stableId: "S003",
      domain: "Research",
      riskClass: "medium",
      dependencies: { required: ["knowledge.search", "web.fetch"], optional: ["crm.read"] },
      provenance: [{
        repo: "github.com/acme/skills", path: "research/brief", commit: "a".repeat(40),
        license: "Apache-2.0", strategy: "adapt", copied: false,
      }],
      locales: ["zh-CN", "en"],
      jurisdictions: ["CN"],
      evalSuiteId: "S003",
      inputSchema: {}, outputSchema: {},
    },
    gates: [],
    versions: [{ skillVersionId: VERSION_ID, semanticLabel: "1.0.0", publishedAt: "2026-09-01T00:00:00.000Z", current: true }],
    successor: { skillId: SUCC_ID, name: "竞品情报简报 v2", stableId: "S103" },
    canManageChannel,
  };
}

function readiness(overall: "not_ready" | "unknown") {
  return {
    skillId: SKILL_ID, skillVersionId: VERSION_ID, overall,
    missingRequired: overall === "unknown" ? null : 1,
    items: overall === "unknown"
      ? [
          { category: "knowledge.search", kind: "required", state: "unknown", reasonCode: "GRANT_LOOKUP_FAILED", grantHref: null },
        ]
      : [
          { category: "knowledge.search", kind: "required", state: "satisfied", reasonCode: "OK", grantHref: null },
          { category: "web.fetch", kind: "required", state: "missing", reasonCode: "NO_ENABLED_TOOL", grantHref: null },
          { category: "crm.read", kind: "optional", state: "missing", reasonCode: "NO_ENABLED_TOOL", grantHref: null },
        ],
    computedAt: "2026-09-28T00:00:00.000Z",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Opts {
  list?: (search: URLSearchParams) => Response;
  admin?: boolean;
  readinessOverall?: "not_ready" | "unknown";
}

let listCalls: URLSearchParams[] = [];
let patchCalls: string[] = [];
let patchBodies: Record<string, unknown>[] = [];
let currentChannel = "candidate";

function install(opts: Opts = {}) {
  listCalls = [];
  patchCalls = [];
  patchBodies = [];
  currentChannel = "candidate";
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    if (init?.method === "PATCH") {
      patchCalls.push(url.pathname);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patchBodies.push(body);
      if (typeof body.channel === "string") currentChannel = body.channel;
      return json({ ...item(), channel: currentChannel });
    }
    if (url.pathname.endsWith("/skills/catalog")) {
      listCalls.push(url.searchParams);
      return opts.list ? opts.list(url.searchParams) : json({ items: [{ ...item(), channel: currentChannel }], nextCursor: null });
    }
    if (url.pathname.endsWith(`/skills/catalog/${SKILL_ID}/readiness`))
      return json(readiness(opts.readinessOverall ?? "not_ready"));
    if (url.pathname.endsWith(`/skills/catalog/${SKILL_ID}`)) return json({ ...detail(opts.admin ?? false), channel: currentChannel });
    if (url.pathname.endsWith(`/skills/catalog/${SUCC_ID}`))
      return json({ ...detail(false), skillId: SUCC_ID, name: "竞品情报简报 v2", stableId: "S103", successor: null, successorSkillId: null });
    return json({ reasonCode: "NOT_FOUND" }, 404);
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("WS05 Work Skill 目录屏", () => {
  it("屏路由：?screen=work-catalog 可解析", () => {
    expect(resolveSkillScreen("work-catalog")).toBe("work-catalog");
  });

  it("列表行展示名称/stableId/domain/通道徽章/riskClass/就绪性徽章", async () => {
    install();
    render(<WorkSkillCatalog />);
    const row = await screen.findByTestId("work-catalog-row-S003");
    expect(row).toHaveTextContent("竞品情报简报");
    expect(row).toHaveTextContent("S003");
    expect(row).toHaveTextContent("Research");
    expect(row).toHaveTextContent("中风险");
    expect(within(row).getByTestId("work-catalog-channel-badge")).toHaveTextContent("候选");
    expect(within(row).getByTestId("work-catalog-readiness-badge")).toHaveTextContent("缺 1 项");
    expect(listCalls[0]?.get("includeDeprecated")).toBe("false");
    expect(listCalls[0]?.has("cursor")).toBe(false);
  });

  it("领域筛选、通道切换、显示已废弃、搜索都进入请求参数", async () => {
    install();
    render(<WorkSkillCatalog />);
    await screen.findByTestId("work-catalog-row-S003");
    fireEvent.change(screen.getByTestId("work-catalog-domain-filter"), { target: { value: "Research" } });
    await waitFor(() => expect(listCalls.at(-1)?.get("domain")).toBe("Research"));
    fireEvent.click(screen.getByTestId("work-catalog-channel-verified"));
    await waitFor(() => expect(listCalls.at(-1)?.get("channel")).toBe("verified"));
    fireEvent.click(screen.getByTestId("work-catalog-include-deprecated"));
    await waitFor(() => expect(listCalls.at(-1)?.get("includeDeprecated")).toBe("true"));
    fireEvent.change(screen.getByTestId("work-catalog-search"), { target: { value: "情报" } });
    await waitFor(() => expect(listCalls.at(-1)?.get("q")).toBe("情报"));
    expect(screen.getByTestId("work-catalog-channel-candidate")).toBeInTheDocument();
  });

  it("详情抽屉展示依赖分组/溯源/地区/门占位/版本/后继；可选缺失显示降级", async () => {
    install();
    render(<WorkSkillCatalog />);
    fireEvent.click(await screen.findByTestId("work-catalog-row-S003"));
    const drawer = await screen.findByTestId("work-skill-detail");
    const required = await within(drawer).findByTestId("work-skill-deps-required");
    await waitFor(() => expect(required).toHaveTextContent("缺失"));
    expect(required).toHaveTextContent("knowledge.search");
    expect(required).toHaveTextContent("web.fetch");
    expect(within(drawer).getByTestId("work-skill-deps-optional")).toHaveTextContent("可选，未授权，功能降级");
    expect(within(drawer).getByTestId("work-skill-provenance")).toHaveTextContent("Apache-2.0");
    expect(within(drawer).getByTestId("work-skill-provenance")).toHaveTextContent("github.com/acme/skills");
    expect(drawer).toHaveTextContent("zh-CN");
    expect(drawer).toHaveTextContent("CN");
    expect(within(drawer).getByTestId("work-skill-gates")).toBeInTheDocument();
    expect(within(drawer).getByTestId("work-skill-versions")).toHaveTextContent("1.0.0");
    expect(within(drawer).getByTestId("work-skill-successor")).toHaveTextContent("S103");
  });

  it("E9：非管理员不渲染通道/后继按钮；管理员渲染", async () => {
    install({ admin: false });
    const { unmount } = render(<WorkSkillCatalog />);
    fireEvent.click(await screen.findByTestId("work-catalog-row-S003"));
    await screen.findByTestId("work-skill-deps-required");
    expect(screen.queryByTestId("work-skill-change-channel")).toBeNull();
    expect(screen.queryByTestId("work-skill-set-successor")).toBeNull();
    unmount();

    install({ admin: true });
    render(<WorkSkillCatalog />);
    fireEvent.click(await screen.findByTestId("work-catalog-row-S003"));
    expect(await screen.findByTestId("work-skill-change-channel")).toBeInTheDocument();
    expect(screen.getByTestId("work-skill-set-successor")).toBeInTheDocument();
  });

  it("E7：空态给清除筛选，点击后重置参数", async () => {
    install({ list: () => json({ items: [], nextCursor: null }) });
    render(<WorkSkillCatalog />);
    await screen.findByTestId("work-catalog-state-empty");
    fireEvent.change(screen.getByTestId("work-catalog-search"), { target: { value: "zzz" } });
    await waitFor(() => expect(listCalls.at(-1)?.get("q")).toBe("zzz"));
    fireEvent.click(await screen.findByTestId("work-catalog-clear-filters"));
    await waitFor(() => expect(listCalls.at(-1)?.get("q")).toBeNull());
  });

  it("E5：就绪性 unknown 只做局部提示，绝不显示为可运行，其余字段照常", async () => {
    install({
      list: () => json({ items: [item({ overall: "unknown", missingRequired: null })], nextCursor: null }),
      readinessOverall: "unknown",
    });
    render(<WorkSkillCatalog />);
    const row = await screen.findByTestId("work-catalog-row-S003");
    const badge = within(row).getByTestId("work-catalog-readiness-badge");
    expect(badge).toHaveTextContent("未知");
    expect(badge).not.toHaveTextContent("可运行");
    expect(within(row).getByTestId("work-catalog-readiness-unknown")).toBeInTheDocument();
    expect(row).toHaveTextContent("Research");
    expect(screen.queryByTestId("work-catalog-state-error")).toBeNull();
    fireEvent.click(row);
    const drawer = await screen.findByTestId("work-skill-detail");
    expect(await within(drawer).findByTestId("work-skill-detail-readiness-unknown")).toBeInTheDocument();
    expect(within(drawer).queryByTestId("work-catalog-readiness-unknown")).toBeNull();
  });

  it("列表接口失败：错误态显示人话、不回显内部错误码，可重试", async () => {
    let fail = true;
    install({
      list: () => (fail ? json({ reasonCode: "UNAUTHENTICATED" }, 401) : json({ items: [item()], nextCursor: null })),
    });
    render(<WorkSkillCatalog />);
    const err = await screen.findByTestId("work-catalog-state-error");
    expect(err).toHaveTextContent("登录已过期");
    expect(err).not.toHaveTextContent("UNAUTHENTICATED");
    expect(err).not.toHaveTextContent("401");
    fail = false;
    fireEvent.click(within(err).getByRole("button", { name: "重试" }));
    expect(await screen.findByTestId("work-catalog-row-S003")).toBeInTheDocument();
  });

  it("R3 步 5：nextCursor 不被丢弃——加载更多带 cursor 并追加第二页", async () => {
    const second = { ...item(), skillId: SUCC_ID, stableId: "S058", name: "第 58 个", domain: "Legal" };
    install({
      list: (sp) =>
        sp.get("cursor") === "page-2"
          ? json({ items: [second], nextCursor: null })
          : json({ items: [item()], nextCursor: "page-2" }),
    });
    render(<WorkSkillCatalog />);
    await screen.findByTestId("work-catalog-row-S003");
    fireEvent.click(await screen.findByTestId("work-catalog-load-more"));
    expect(await screen.findByTestId("work-catalog-row-S058")).toBeInTheDocument();
    expect(screen.getByTestId("work-catalog-row-S003")).toBeInTheDocument();
    expect(listCalls.some((c) => c.get("cursor") === "page-2")).toBe(true);
    expect(screen.queryByTestId("work-catalog-load-more")).toBeNull();
  });

  it("领域选项来自不带筛选的全量翻页，不受当前筛选/第一页限制", async () => {
    install({
      list: (sp) => {
        if (sp.get("q")) return json({ items: [], nextCursor: null });
        if (sp.get("cursor") === "p2") return json({ items: [{ ...item(), domain: "Legal", stableId: "S050" }], nextCursor: null });
        return json({ items: [item()], nextCursor: "p2" });
      },
    });
    render(<WorkSkillCatalog />);
    const select = screen.getByTestId("work-catalog-domain-filter");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Legal" })).toBeInTheDocument());
    expect(within(select).getByRole("option", { name: "Research" })).toBeInTheDocument();
  });

  it("搜索框防抖：连续输入只发一次带 q 的请求", async () => {
    install();
    render(<WorkSkillCatalog />);
    await screen.findByTestId("work-catalog-row-S003");
    const input = screen.getByTestId("work-catalog-search");
    for (const v of ["竞", "竞品", "竞品情", "竞品情报"]) fireEvent.change(input, { target: { value: v } });
    await waitFor(() => expect(listCalls.at(-1)?.get("q")).toBe("竞品情报"));
    expect(listCalls.filter((c) => c.has("q"))).toHaveLength(1);
  });

  it("R3 步 10：后继链接打开后继 Skill 的详情抽屉", async () => {
    install();
    render(<WorkSkillCatalog />);
    fireEvent.click(await screen.findByTestId("work-catalog-row-S003"));
    const link = await screen.findByTestId("work-skill-successor-link");
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId("work-skill-detail")).toHaveTextContent("S103"));
    expect(window.location.hash).toBe(`#${SUCC_ID}`);
  });

  it("深链 #<skillId> 直接打开对应抽屉", async () => {
    window.history.replaceState(null, "", `/#${SUCC_ID}`);
    install();
    render(<WorkSkillCatalog />);
    await waitFor(() => expect(screen.getByTestId("work-skill-detail")).toHaveTextContent("竞品情报简报 v2"));
  });

  it("R3 步 9：转 verified 未填门证据时禁止提交，填写后才发 PATCH", async () => {
    install({ admin: true });
    render(<WorkSkillCatalog />);
    fireEvent.click(await screen.findByTestId("work-catalog-row-S003"));
    const btn = await screen.findByTestId("work-skill-change-channel");
    expect(btn).toBeDisabled();
    expect(screen.getByTestId("work-skill-gate-evidence-required")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(patchCalls).toHaveLength(0);
    fireEvent.change(screen.getByTestId("work-skill-gate-evidence"), { target: { value: "eval-run://1" } });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(patchCalls).toHaveLength(1));
  });

  it("连续两次转移：PATCH 成功后详情/列表刷新、管理控件按新通道重置", async () => {
    install({ admin: true });
    render(<WorkSkillCatalog />);
    fireEvent.click(await screen.findByTestId("work-catalog-row-S003"));
    fireEvent.change(await screen.findByTestId("work-skill-gate-evidence"), { target: { value: "eval-run://1" } });
    const listBefore = listCalls.length;
    fireEvent.click(screen.getByTestId("work-skill-change-channel"));
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchBodies[0]).toMatchObject({ expectedChannel: "candidate", channel: "verified", gateEvidenceRef: "eval-run://1" });
    // 刷新：列表重拉，控件按 verified 的合法转移重置（只剩 deprecated）
    await waitFor(() => expect(listCalls.length).toBeGreaterThan(listBefore));
    await waitFor(() => {
      const select = screen.getByLabelText("目标通道") as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.value)).toEqual(["deprecated"]);
      expect(select.value).toBe("deprecated");
    });
    expect(screen.queryByTestId("work-skill-gate-evidence-required")).toBeNull();
    const btn = screen.getByTestId("work-skill-change-channel");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(patchCalls).toHaveLength(2));
    expect(patchBodies[1]).toMatchObject({ expectedChannel: "verified", channel: "deprecated" });
    expect(patchBodies[1]).not.toHaveProperty("gateEvidenceRef");
    // deprecated 无出边：通道选择器消失
    await waitFor(() => expect(screen.queryByLabelText("目标通道")).toBeNull());
  });
});
