/**
 * `contract-route-ratchet.ts` 的 fixture 单测（issue #564 解决方案 2 第 1 条）。
 *
 * 第一节是**反证**：把这道门本应拦住的缺陷逐条注入，断言它当场红，
 * 且**只红对应那一条**（整组一起塌证明不了任何事——issue #564 解决方案 1 第 3 条逐字）。
 *
 * 一道判定不出已知缺陷的棘轮比没有棘轮更糟：它会让「名单没变长」被读成「没有新缺口」。
 */
import { describe, expect, it } from "vitest";
import type { CoverageGap, CoverageReport } from "./contract-route-coverage";
import {
  formatRatchet,
  gapKey,
  judgeContractRouteRatchet,
  parseEntry,
  ratchetFailed,
} from "./contract-route-ratchet";

/* ─────────────────── fixture：两个束、三条缺口 ─────────────────── */

function gap(bundle: string, operation: string, method = "GET", path = `/${operation}`): CoverageGap {
  return {
    bundle,
    phase: "01",
    operation,
    method: method as CoverageGap["method"],
    path,
    contractFile: `packages/contracts/src/${bundle}.ts`,
  };
}

function report(over: Partial<CoverageReport> = {}): CoverageReport {
  const gaps = over.gaps ?? [
    gap("agent-runtime", "listAnomalies"),
    gap("agent-runtime", "queryOrgAudit"),
    gap("skills", "getSatisfaction"),
  ];
  return {
    bundles: over.bundles ?? [
      {
        bundle: "agent-runtime",
        phase: "01",
        contractFile: "packages/contracts/src/agent-runtime.ts",
        inScope: true,
        reason: "15/16 个 feature passing，无 not_started",
        operationsWithPath: 63,
      },
      {
        bundle: "skills",
        phase: "01",
        contractFile: "packages/contracts/src/skills.ts",
        inScope: true,
        reason: "2/2 个 feature passing，无 not_started",
        operationsWithPath: 12,
      },
    ],
    gaps,
    unresolvedRoutes: over.unresolvedRoutes ?? [],
    operationsInScope: over.operationsInScope ?? 75,
    routesParsed: over.routesParsed ?? 440,
  };
}

/** 今天的名单：恰好盖住 fixture 里的三条缺口 */
const BASELINE = ["agent-runtime:listAnomalies", "agent-runtime:queryOrgAudit", "skills:getSatisfaction"];

function judge(r: CoverageReport, allowlist: readonly string[]) {
  return judgeContractRouteRatchet({ report: r, allowlist });
}

/* ─────────────────── 反证 ─────────────────── */

describe("反证：注入这道门本应拦住的缺陷", () => {
  it("基线是绿的（正样本：门不是恒红，否则下面每一条反证都不说明任何事）", () => {
    const v = judge(report(), BASELINE);
    expect(ratchetFailed(v)).toBe(false);
    expect(v.activeEntries).toBe(3);
  });

  it("反证 A：新增一条声明了 path 却不接线的 operation → 当场红，且只红这一条", () => {
    const v = judge(report({ gaps: [...report().gaps, gap("skills", "pinSkill", "POST", "/skills/:id/pin")] }), BASELINE);
    expect(ratchetFailed(v)).toBe(true);
    expect(v.newGaps.map((g) => g.operation)).toEqual(["pinSkill"]);
    // 只红这一条：名单里原有的三条既不陈旧也没被连坐
    expect(v.staleEntries).toEqual([]);
    expect(v.activeEntries).toBe(3);
  });

  it("反证 B：往名单里加一条今天并不缺的豁免 → 陈旧，当场红（棘轮只能变短）", () => {
    const v = judge(report(), [...BASELINE, "agent-runtime:probeBogusOperation"]);
    expect(ratchetFailed(v)).toBe(true);
    expect(v.staleEntries).toEqual(["agent-runtime:probeBogusOperation"]);
    expect(v.newGaps).toEqual([]); // 只红这一条
  });

  it("反证 C：把路由补上（缺口消失）→ 名单那条变陈旧，红，要求删掉", () => {
    const remaining = report().gaps.filter((g) => g.operation !== "queryOrgAudit");
    const v = judge(report({ gaps: remaining }), BASELINE);
    expect(v.staleEntries).toEqual(["agent-runtime:queryOrgAudit"]);
    expect(v.activeEntries).toBe(2);
  });

  it("反证 D：名单文件丢了（空名单）→ 今天的缺口全部算新增，红而不是绿", () => {
    const v = judge(report(), []);
    expect(v.newGaps).toHaveLength(3);
    expect(ratchetFailed(v)).toBe(true);
  });

  it("反证 E：形状不对的条目 → 红（它永远匹配不上缺口，只会变成没人敢删的压舱物）", () => {
    const v = judge(report(), [...BASELINE, "agent-runtime", ":listAnomalies", "skills:"]);
    expect(v.malformedEntries).toEqual(["agent-runtime", ":listAnomalies", "skills:"]);
    expect(ratchetFailed(v)).toBe(true);
  });
});

/* ─────────────────── 休眠 vs 陈旧：同一个静态痕迹的两种相反成因 ─────────────────── */

describe("束退出判定范围时，它的条目是休眠而不是陈旧（AGENTS.md「静态痕迹 ≠ 动态事实」）", () => {
  /** `skills` 束新进一个 not_started ⇒ #1177 的束级判据让整束退出范围，它的缺口整批消失 */
  function skillsOutOfScope(): CoverageReport {
    const base = report();
    return {
      ...base,
      gaps: base.gaps.filter((g) => g.bundle !== "skills"),
      bundles: base.bundles.map((b) =>
        b.bundle === "skills"
          ? { ...b, inScope: false, reason: "还有 1 个 not_started（F999）—— 契约有、路由没有是设计，不是缺口" }
          : b,
      ),
      operationsInScope: 63,
    };
  }

  it("不判红，也不要求删条目 —— 缺口消失的成因是「不判了」，不是「补好了」", () => {
    const v = judge(skillsOutOfScope(), BASELINE);
    expect(ratchetFailed(v)).toBe(false);
    expect(v.dormantEntries).toEqual(["skills:getSatisfaction"]);
    expect(v.staleEntries).toEqual([]);
  });

  it("束重新进入判定范围后，那条老缺口仍被名单盖住，不会被读成「新增」", () => {
    // 假如上一步把休眠条目当陈旧删掉了，这里就会红在一个什么都没做错的 PR 上
    const v = judge(report(), BASELINE);
    expect(v.newGaps).toEqual([]);
  });

  it("同一个束里，在判定范围内的条目该陈旧还是陈旧（休眠不是一张免死金牌）", () => {
    const r = skillsOutOfScope();
    const v = judge(
      { ...r, gaps: r.gaps.filter((g) => g.operation !== "queryOrgAudit") },
      BASELINE,
    );
    expect(v.staleEntries).toEqual(["agent-runtime:queryOrgAudit"]);
    expect(v.dormantEntries).toEqual(["skills:getSatisfaction"]);
  });
});

/* ─────────────────── 扫不全就不判 ─────────────────── */

describe("扫不全就不判（fail-closed，方向是「不下结论」）", () => {
  it.each([
    ["interface 侧解析出 0 条路由", report({ routesParsed: 0 })],
    ["0 个束进入判定范围", report({ bundles: report().bundles.map((b) => ({ ...b, inScope: false })), gaps: [] })],
    ["判定范围里 0 条 operation", report({ operationsInScope: 0 })],
  ])("%s → incomplete，不把整份名单判成陈旧", (_name, r) => {
    const v = judge(r, BASELINE);
    expect(v.incomplete).toBe(true);
    expect(v.staleEntries).toEqual([]);
    expect(v.newGaps).toEqual([]);
  });

  it("只读模式：扫不全退出 0，但必须明说「没做判断」", () => {
    const out = formatRatchet(judge(report({ routesParsed: 0 }), BASELINE), { strict: false, allowlistSize: 3 });
    expect(out.exitCode).toBe(0);
    expect(out.stderr.join("\n")).toContain("扫不全");
  });

  it("`--strict`（PR 门控）：扫不全退出非 0 —— required check 在「没做判断」时给绿就是 fail-open", () => {
    const out = formatRatchet(judge(report({ routesParsed: 0 }), BASELINE), { strict: true, allowlistSize: 3 });
    expect(out.exitCode).toBe(1);
  });
});

/* ─────────────────── 判据只有一份 ─────────────────── */

describe("判据单一事实源：本模块不重新判断「有没有路由」", () => {
  it("报告说它是缺口就是缺口 —— method/path 长什么样都不影响条目身份", () => {
    const weird = gap("skills", "getSatisfaction", "PATCH", "/完全不同的/路径");
    const v = judge(report({ gaps: [weird] }), ["skills:getSatisfaction"]);
    expect(v.newGaps).toEqual([]);
    expect(v.activeEntries).toBe(1);
  });

  it("报告里没有的 operation 不会被本模块凭空判成缺口", () => {
    const v = judge(report({ gaps: [] , bundles: report().bundles}), []);
    expect(v.newGaps).toEqual([]);
    expect(v.incomplete).toBe(false);
  });
});

describe("条目身份", () => {
  it("gapKey / parseEntry 往返", () => {
    const ref = { bundle: "agent-runtime", operation: "listAnomalies" };
    expect(parseEntry(gapKey(ref))).toEqual(ref);
  });

  it("operation 名里的冒号不会把 key 切错（只切第一个冒号）", () => {
    expect(parseEntry("skills:a:b")).toEqual({ bundle: "skills", operation: "a:b" });
  });
});

describe("输出", () => {
  it("绿的时候说清楚名单有多长、其中多少条今天仍是缺口（不然「绿」读不出信息量）", () => {
    const out = formatRatchet(judge(report(), BASELINE), { strict: false, allowlistSize: 3 });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.join("\n")).toContain("名单 3 条，其中 3 条今天仍是缺口");
  });

  it("红的时候逐条指名，并给出两条出路（接线 / 由人加名单）", () => {
    const withNew = report({ gaps: [...report().gaps, gap("skills", "pinSkill", "POST", "/skills/:id/pin")] });
    const out = formatRatchet(judge(withNew, BASELINE), { strict: false, allowlistSize: 3 });
    expect(out.exitCode).toBe(1);
    const text = out.stderr.join("\n");
    expect(text).toContain("POST /skills/:id/pin");
    expect(text).toContain("contract-route-coverage-allowlist.json");
  });
});
