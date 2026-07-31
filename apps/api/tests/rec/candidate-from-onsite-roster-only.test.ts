/**
 * F74 · I-9 / I-12 —— 候选人名单只来自本场在场名单，无任何跨场次声纹比对调用。
 *
 * 三层断言，由弱到强：
 *   1. **形状**：`deriveCandidates` 的输出恒 `source: "roster"`，且元素与输入一一对应。
 *   2. **隔离**：两个场次各自的在场名单互不污染——B 场的候选人绝不包含 A 场独有的人。
 *   3. **无后门**：`deriveCandidates` / `listSpeakerCandidates` 的签名里根本没有第二个可以
 *      传入跨场次数据的位置——`ROSTER_UNAVAILABLE` 时直接拒绝，不回落到任何默认名单。
 *
 * 依据 `usecases.md`「候选人名单只来自本场在场名单」（uc-5-2 UC:列出本场匿名声道与候选人）
 * 与 `domain.md` I-9 / I-12；`design-signoff.md` ① 把它列为签核前必须确认的一条。
 */
import { describe, expect, it } from "vitest";
import {
  deriveCandidates,
  type RosterEntry,
} from "../../src/domain/recording/speaker-assignment";
import { listSpeakerCandidates } from "../../src/application/recording/assignment";
import { assignmentHarness } from "../support/rec-assignment-fakes";

describe("F74 · 候选人名单只来自本场在场名单", () => {
  const sessionARoster: readonly RosterEntry[] = [
    { personId: "p-zhou", displayName: "周宁" },
    { personId: "p-kraus", displayName: "Kraus" },
  ];
  const sessionBRoster: readonly RosterEntry[] = [
    { personId: "p-li", displayName: "李雷" },
  ];

  it("形状：source 恒为 roster，且与输入一一对应", () => {
    const candidates = deriveCandidates(sessionARoster);
    expect(candidates).toHaveLength(sessionARoster.length);
    for (const c of candidates) {
      expect(c.source).toBe("roster");
    }
    expect(candidates.map((c) => c.personId).sort()).toEqual(
      sessionARoster.map((r) => r.personId).sort(),
    );
  });

  it("隔离：A 场候选人不包含 B 场独有的人，反之亦然", () => {
    const candidatesA = deriveCandidates(sessionARoster);
    const candidatesB = deriveCandidates(sessionBRoster);

    expect(candidatesA.some((c) => c.personId === "p-li")).toBe(false);
    expect(candidatesB.some((c) => c.personId === "p-zhou" || c.personId === "p-kraus")).toBe(
      false,
    );
  });

  it("空名单是真实空态，不是伪造候选人", () => {
    expect(deriveCandidates([])).toEqual([]);
  });

  it("应用层：roster 取不到即拒绝，不回落到任何跨场次来源（ROSTER_UNAVAILABLE）", async () => {
    const deps = assignmentHarness();
    deps.roster.seed("sess-A", sessionARoster);
    // sess-B 故意不 seed —— 模拟「在场名单取不到」。

    const okResult = await listSpeakerCandidates(deps, "sess-A");
    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect(okResult.candidates.map((c) => c.personId).sort()).toEqual(["p-kraus", "p-zhou"]);
    }

    const missingResult = await listSpeakerCandidates(deps, "sess-B");
    expect(missingResult).toEqual({ ok: false, reason: "ROSTER_UNAVAILABLE" });
  });

  it("无后门：两个场次各自查询互不影响对方结果（同一 harness 内并发隔离）", async () => {
    const deps = assignmentHarness();
    deps.roster.seed("sess-A", sessionARoster);
    deps.roster.seed("sess-B", sessionBRoster);

    const [resultA, resultB] = await Promise.all([
      listSpeakerCandidates(deps, "sess-A"),
      listSpeakerCandidates(deps, "sess-B"),
    ]);

    if (!resultA.ok || !resultB.ok) throw new Error("both sessions have a roster seeded");
    expect(resultA.candidates.map((c) => c.personId)).not.toContain("p-li");
    expect(resultB.candidates.map((c) => c.personId)).toEqual(["p-li"]);
  });
});
