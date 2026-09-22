// cycle-result-gate.test.ts — #534 的反证：**构造一个漏报 cycle-result 的 fixture，
// 证明新门会红**，并逐条钉死「红在对的理由上」（issue 里的红线 10）。
//
// fixture 复刻的就是事故现场：coord-chat-e2e 一路发 cycle-plan、cycle-result 一条没发，
// 同一条 issue 上别的角色（coord-architecture）发了——所以「这条 issue 上有 cycle-result」
// 不等于「它发了」，门必须按 (agent, cycle) 两个维度判。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRACE_MINUTES,
  fetchWorkCycleComments,
  isCoordinatorLease,
  judgeCycleResults,
  normalizeCycleId,
  parseCycleResults,
  previousCycleId,
  type CommentLike,
  type GateFinding,
  type LeaseLike,
} from "./cycle-result-gate";
import type { ShResult } from "./sh";

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/cycle-result-gate/${name}`, import.meta.url), "utf8");
const fixtureJson = <T>(name: string): T => JSON.parse(fixture(name)) as T;

/** 事故当时的权威时钟：周期 2026-08-04T21Z 刚结束，本周期已进行 20 分钟（过了宽限期）。 */
const CYCLE = { id: "2026-08-05T00Z", started_at: "2026-08-05T00:00:00.000Z", elapsed_seconds: 20 * 60 };
const JUDGED = "2026-08-04T21Z";

const claims = fixtureJson<{ leases: LeaseLike[] }>("active-claims.json").leases;
const missingComments = fixtureJson<CommentLike[]>("gh-comments-missing.json");
const reportedComments = fixtureJson<CommentLike[]>("gh-comments-reported.json");

const kinds = (findings: GateFinding[]): string[] => findings.map((f) => f.kind);

describe("#534 反证：漏报 cycle-result 的 fixture 必须把门打红", () => {
  it("持协调租约、上一周期没发 cycle-result ⇒ FAIL", () => {
    const verdict = judgeCycleResults({ cycle: CYCLE, leases: claims, comments: missingComments });

    expect(verdict.failed).toBe(true);
    expect(verdict.judgedCycle).toBe(JUDGED);
    const fail = verdict.findings.find((f) => f.level === "FAIL");
    expect(fail).toMatchObject({ kind: "missing-cycle-result", agent: "coord-chat-e2e", cycle: JUDGED });
    expect(fail?.message).toContain(JUDGED);
  });

  it("红线 10：红在「该周期没有评论」上，不是红在前置失败上", () => {
    const verdict = judgeCycleResults({ cycle: CYCLE, leases: claims, comments: missingComments });

    // 这次跑里根本不该出现任何前置失败——周期 id 解析到了、租约列表拿到了、评论拿到了。
    expect(kinds(verdict.findings)).not.toContain("precondition");
    expect(verdict.findings.filter((f) => f.level === "FAIL").map((f) => f.kind)).toEqual(["missing-cycle-result"]);
  });

  it("同一条 issue 上别人发了 cycle-result 不算它发了（按 agent 判）", () => {
    const othersOnly = missingComments.filter((c) => c.body.includes("by:coord-architecture"));
    const verdict = judgeCycleResults({ cycle: CYCLE, leases: claims, comments: othersOnly });
    expect(verdict.failed).toBe(true);
  });

  it("它发过别的周期的 cycle-result 也不算（按 cycle 判）", () => {
    const staleOnly = missingComments.filter((c) => c.body.startsWith("cycle-result cycle:2026-08-04T15Z"));
    const verdict = judgeCycleResults({ cycle: CYCLE, leases: claims, comments: staleOnly });
    expect(verdict.failed).toBe(true);
  });

  it("补发之后转绿（含 `cycle:<id>:00Z` 写法与「与下周期 plan 合并成一条」的形态）", () => {
    const verdict = judgeCycleResults({ cycle: CYCLE, leases: claims, comments: reportedComments });

    expect(verdict.failed).toBe(false);
    expect(verdict.findings.find((f) => f.kind === "cycle-result-present")).toMatchObject({
      agent: "coord-chat-e2e",
      cycle: JUDGED,
    });
  });
});

describe("红线 10：前置失败一律不红（问不到 ≠ 没发）", () => {
  const cases: Array<[string, Parameters<typeof judgeCycleResults>[0], string]> = [
    ["读不到权威时钟", { cycle: null, leases: claims, comments: missingComments }, "clock-unavailable"],
    [
      "周期 started_at 解析不出时刻",
      { cycle: { id: "??", started_at: "not-a-time" }, leases: claims, comments: missingComments },
      "clock-unavailable",
    ],
    ["拿不到租约列表", { cycle: CYCLE, leases: null, comments: missingComments }, "leases-unavailable"],
    ["读不到 work-cycle issue 的评论", { cycle: CYCLE, leases: claims, comments: null }, "comments-unavailable"],
    [
      "找不到 work-cycle issue",
      { cycle: CYCLE, leases: claims, comments: null, workCycleIssueFound: false },
      "work-cycle-issue-missing",
    ],
    [
      "租约 claimed_at 解析不出时刻",
      {
        cycle: CYCLE,
        leases: [{ ...claims[0]!, claimed_at: "昨天" }],
        comments: missingComments,
      },
      "lease-timestamp-unparseable",
    ],
  ];

  for (const [name, input, reason] of cases) {
    it(`${name} ⇒ WARN（precondition:${reason}），不 FAIL`, () => {
      const verdict = judgeCycleResults(input);
      expect(verdict.failed).toBe(false);
      expect(kinds(verdict.findings)).not.toContain("missing-cycle-result");
      expect(verdict.findings.find((f) => f.kind === "precondition")).toMatchObject({ level: "WARN", reason });
    });
  }
});

describe("义务边界：只判在任 coordinator，判据取存在性", () => {
  it("worker 的 issue:<n> 租约不背周期汇报义务", () => {
    const worker = claims.filter((l) => l.resource_id.startsWith("issue:"));
    const verdict = judgeCycleResults({ cycle: CYCLE, leases: worker, comments: missingComments });
    expect(verdict.failed).toBe(false);
    expect(kinds(verdict.findings)).toEqual(["not-applicable"]);
  });

  it("resource_type 缺失时按 resource_id 形状认协调租约", () => {
    expect(isCoordinatorLease({ resource_id: "role:coord-main", agent_id: "a" })).toBe(true);
    expect(isCoordinatorLease({ resource_id: "module:board", agent_id: "a" })).toBe(true);
    expect(isCoordinatorLease({ resource_id: "issue:534", agent_id: "a" })).toBe(false);
    expect(isCoordinatorLease({ resource_id: "feature:F01", resource_type: "feature", agent_id: "a" })).toBe(false);
  });

  it("上一周期结束后才认领的租约，不背那个周期的义务", () => {
    const fresh: LeaseLike[] = [{ ...claims[0]!, claimed_at: "2026-08-05T00:05:00Z" }];
    const verdict = judgeCycleResults({ cycle: CYCLE, leases: fresh, comments: missingComments });
    expect(verdict.failed).toBe(false);
    expect(kinds(verdict.findings)).toEqual(["not-applicable"]);
  });

  it(`新周期头 ${DEFAULT_GRACE_MINUTES} 分钟内只 WARN（可与本周期 cycle-plan 合并成一条）`, () => {
    const verdict = judgeCycleResults({
      cycle: { ...CYCLE, elapsed_seconds: 4 * 60 },
      leases: claims,
      comments: missingComments,
    });
    expect(verdict.failed).toBe(false);
    expect(verdict.findings.find((f) => f.kind === "pending-cycle-result")).toMatchObject({ level: "WARN" });
  });

  it("agents 过滤：tick 只判自己，不替别人背红", () => {
    const verdict = judgeCycleResults({
      cycle: CYCLE,
      leases: claims,
      comments: missingComments,
      agents: ["dev-harness"],
    });
    expect(verdict.failed).toBe(false);
    expect(kinds(verdict.findings)).toEqual(["not-applicable"]);
  });
});

describe("解析（只查有没有，不查写得好不好）", () => {
  it("同一周期的两种写法判成相等", () => {
    expect(normalizeCycleId("2026-08-04T21Z")).toBe(JUDGED);
    expect(normalizeCycleId("2026-08-04T21:00Z")).toBe(JUDGED);
    expect(normalizeCycleId("2026-08-04T21:00:00.000Z")).toBe(JUDGED);
    expect(normalizeCycleId("上周")).toBeNull();
  });

  it("previousCycleId 从本周期起点回推一个 3h 周期（含跨日）", () => {
    expect(previousCycleId("2026-08-05T00:00:00.000Z")).toBe(JUDGED);
    expect(previousCycleId("2026-08-05T12:00:00.000Z")).toBe("2026-08-05T09Z");
    expect(previousCycleId("nope")).toBeNull();
  });

  it("逐行解析，cycle-result 与 cycle-plan 合并成一条也认得出", () => {
    const merged = reportedComments.find((c) => c.body.includes("cycle-plan cycle:2026-08-05T00Z"))!;
    expect(parseCycleResults(merged.body)).toEqual([{ cycle: JUDGED, by: "coord-chat-e2e" }]);
    expect(parseCycleResults("cycle-plan cycle:2026-08-04T21Z by:coord-main\ncommit: 清队列")).toEqual([]);
    expect(parseCycleResults("cycle-result by:coord-main\ndone: 忘了写 cycle")).toEqual([]);
  });
});

describe("fetchWorkCycleComments：读不到绝不退化成「没评论」", () => {
  const ok = (stdout: string): ShResult => ({ code: 0, stdout, stderr: "" });

  function execWith(view: ShResult, list: ShResult = ok(fixture("gh-issue-list.json"))) {
    const cmds: string[] = [];
    const exec = (cmd: string): ShResult => {
      cmds.push(cmd);
      return cmd.includes("issue list") ? list : view;
    };
    return { cmds, exec };
  }

  it("真实 gh 输出形状 → 解析出评论 → 喂进门 → 红（端到端走一遍 fixture）", () => {
    const { cmds, exec } = execWith(ok(fixture("gh-comments-missing.json")));
    const fetched = fetchWorkCycleComments({ repo: "boardx/workspacex", exec });

    expect(fetched.kind).toBe("ok");
    if (fetched.kind !== "ok") return;
    expect(fetched.issue).toBe(323);
    expect(cmds[0]).toContain('--label "coordination:work-cycle"');
    expect(cmds[1]).toContain("gh issue view 323");

    const verdict = judgeCycleResults({ cycle: CYCLE, leases: claims, comments: fetched.comments });
    expect(verdict.failed).toBe(true);
    expect(kinds(verdict.findings)).toContain("missing-cycle-result");
  });

  it("gh 不可用（退出码非 0）⇒ unavailable，不是空评论", () => {
    const { exec } = execWith(ok("[]"), { code: 127, stdout: "", stderr: "gh: command not found" });
    expect(fetchWorkCycleComments({ exec })).toMatchObject({ kind: "unavailable" });
  });

  it("gh 输出不是 JSON ⇒ unavailable", () => {
    const { exec } = execWith(ok("not json"));
    expect(fetchWorkCycleComments({ exec })).toMatchObject({ kind: "unavailable" });
  });

  it("没有 work-cycle issue ⇒ no-issue（与「有 issue 但没评论」分开）", () => {
    const { exec } = execWith(ok("[]"), ok("[]"));
    expect(fetchWorkCycleComments({ exec })).toMatchObject({ kind: "no-issue" });
  });

  it("有 issue 但一条评论都没有 ⇒ ok + 空数组（这才是真的「没发过」）", () => {
    const { exec } = execWith(ok("[]"));
    const fetched = fetchWorkCycleComments({ exec });
    expect(fetched).toMatchObject({ kind: "ok", issue: 323 });
    const verdict = judgeCycleResults({
      cycle: CYCLE,
      leases: claims,
      comments: fetched.kind === "ok" ? fetched.comments : null,
    });
    expect(verdict.failed).toBe(true);
  });
});
