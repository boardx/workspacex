/**
 * EV04 —— `/skill?screen=work-catalog` 门状态展示（04-eval-gates R8；契约束 work-eval `getWorkGateStatus`）。
 *
 * 假 `fetch` 证渲染形状：详情抽屉 G0–G5 六枚徽章（原因/判定时间/版本/subject vs baseline）、
 * 列表行 G4/G5 缩略、未评测空态（新版本导入后 A4）、报告过期黄色提示（E4）、读取失败只做局部提示。
 * 门状态只读——前端没有任何改门字段的入口（R5）。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-ev04" }, identity: { org: { name: "测试组织" } } }),
}));

import { WorkSkillCatalog } from "@/components/skill/work-skill-catalog";

const SKILL_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const GATES = ["G0", "G1", "G2", "G3", "G4", "G5"] as const;

const item = {
  skillId: SKILL_ID, name: "竞品情报简报", stableId: "S003", domain: "Research", channel: "candidate",
  riskClass: "medium", currentVersionId: VERSION_ID, currentVersionLabel: "1.1.0",
  readiness: { overall: "ready", missingRequired: 0 }, successorSkillId: null,
};

const detail = {
  ...item,
  description: "汇总竞品动态",
  manifest: {
    stableId: "S003", domain: "Research", riskClass: "medium",
    dependencies: { required: [], optional: [] }, provenance: [], locales: ["zh-CN"], jurisdictions: ["CN"],
    evalSuiteId: "S003", inputSchema: {}, outputSchema: {},
  },
  gates: [],
  versions: [{ skillVersionId: VERSION_ID, semanticLabel: "1.1.0", publishedAt: "2026-09-01T00:00:00.000Z", current: true }],
  successor: null,
  canManageChannel: false,
};

function evaluated(overrides: Record<string, unknown> = {}) {
  return {
    skillVersionId: VERSION_ID, semanticLabel: "1.1.0", evalSuiteId: "S003",
    gates: GATES.map((gate) => gate === "G5"
      ? { gate, state: "fail", reasonCode: "NOT_BETTER_THAN_BASELINE", reason: "持平即失败：6/10 vs 6/10" }
      : { gate, state: "pass", reasonCode: "OK", reason: "ok" }),
    subjectPassed: 9, baselinePassed: 6, deterministicTotal: 10,
    decidedAt: "2026-09-29T01:02:03.000Z", stale: false, canMarkVerified: false,
    markVerifiedBlockedReason: "NOT_BETTER_THAN_BASELINE",
    ...overrides,
  };
}

const notEvaluated = {
  skillVersionId: VERSION_ID, semanticLabel: "1.1.0", evalSuiteId: "S003",
  gates: GATES.map((gate) => ({ gate, state: "not_evaluated", reasonCode: null, reason: null })),
  subjectPassed: null, baselinePassed: null, deterministicTotal: null, decidedAt: null, stale: false,
  canMarkVerified: false, markVerifiedBlockedReason: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let gateCalls = 0;
let nonGetCalls: string[] = [];

function install(gate: () => Response) {
  gateCalls = 0;
  nonGetCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    if (init?.method && init.method !== "GET") nonGetCalls.push(`${init.method} ${url.pathname}`);
    if (url.pathname.endsWith(`/skills/catalog/${SKILL_ID}/gate-status`)) {
      gateCalls++;
      return gate();
    }
    if (url.pathname.endsWith("/skills/catalog")) return json({ items: [item], nextCursor: null });
    if (url.pathname.endsWith(`/skills/catalog/${SKILL_ID}/readiness`)) {
      return json({ skillId: SKILL_ID, skillVersionId: VERSION_ID, overall: "ready", missingRequired: 0, items: [], computedAt: "2026-09-28T00:00:00.000Z" });
    }
    if (url.pathname.endsWith(`/skills/catalog/${SKILL_ID}`)) return json(detail);
    return json({ reasonCode: "NOT_FOUND" }, 404);
  }));
}

async function openDrawer() {
  render(<WorkSkillCatalog />);
  fireEvent.click(await screen.findByTestId("work-catalog-row-S003"));
  return screen.findByTestId("work-skill-detail");
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("EV04 门状态展示", () => {
  it("列表行显示 G4/G5 门状态缩略", async () => {
    install(() => json(evaluated()));
    render(<WorkSkillCatalog />);
    const row = await screen.findByTestId("work-catalog-row-S003");
    await waitFor(() => expect(within(row).getByTestId("work-catalog-gate-summary")).toHaveTextContent("G4✓ G5✗"));
  });

  it("详情抽屉：六枚徽章 + 原因 + 判定时间 + 评测版本 + subject vs baseline + evalSuiteId", async () => {
    install(() => json(evaluated()));
    const drawer = await openDrawer();
    const gates = within(drawer).getByTestId("work-skill-gates");
    await waitFor(() => expect(within(gates).getByTestId("work-gate-badges").children).toHaveLength(6));
    for (const g of GATES) expect(within(gates).getByTestId(`work-gate-${g}`)).toHaveTextContent(g);
    expect(within(gates).getByTestId("work-gate-G4")).toHaveAttribute("data-state", "pass");
    const g5 = within(gates).getByTestId("work-gate-G5");
    expect(g5).toHaveAttribute("data-state", "fail");
    expect(g5).toHaveTextContent("未通过");
    expect(g5).toHaveTextContent("持平即失败");
    expect(within(g5).getByTitle(/判定时间 2026-09-29 01:02 UTC/)).toBeInTheDocument();
    expect(within(gates).getByTestId("work-gate-meta")).toHaveTextContent("套件 S003");
    expect(within(gates).getByTestId("work-gate-meta")).toHaveTextContent("评测版本 1.1.0");
    expect(within(gates).getByTestId("work-gate-meta")).toHaveTextContent("2026-09-29 01:02 UTC");
    expect(within(gates).getByTestId("work-gate-baseline")).toHaveTextContent("9/10 vs 6/10");
    expect(within(gates).queryByTestId("work-gate-state-empty")).toBeNull();
    expect(within(gates).queryByRole("button")).toBeNull(); // R5：没有改门字段的入口
    expect(nonGetCalls).toEqual([]);
  });

  it("新版本导入后（无记录）：六门「未评测」空态，不显示通过数", async () => {
    install(() => json(notEvaluated));
    const drawer = await openDrawer();
    const gates = within(drawer).getByTestId("work-skill-gates");
    expect(await within(gates).findByTestId("work-gate-state-empty")).toHaveTextContent("未评测");
    for (const g of GATES) expect(within(gates).getByTestId(`work-gate-${g}`)).toHaveAttribute("data-state", "not_evaluated");
    expect(within(gates).queryByTestId("work-gate-baseline")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("work-catalog-gate-summary")).toHaveTextContent("G4? G5?"));
  });

  it("E4：报告过期显示黄色提示", async () => {
    install(() => json(evaluated({ stale: true })));
    const drawer = await openDrawer();
    expect(await within(drawer).findByTestId("work-gate-stale")).toHaveTextContent("过期");
  });

  it("门状态读取失败只做局部提示，抽屉其余内容与列表照常", async () => {
    install(() => json({ error: "internal_error" }, 500));
    const drawer = await openDrawer();
    expect(await within(drawer).findByTestId("work-gate-state-error")).toBeInTheDocument();
    expect(within(drawer).getByTestId("work-skill-versions")).toHaveTextContent("1.1.0");
    expect(screen.queryByTestId("work-catalog-state-error")).toBeNull();
    expect(screen.queryByTestId("work-catalog-gate-summary")).toBeNull();
    expect(gateCalls).toBeGreaterThan(0);
  });
});
