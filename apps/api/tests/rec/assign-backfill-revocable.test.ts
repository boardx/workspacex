/**
 * F74 · AC1 —— 指派后引述出处/洞察来源/报告/图谱一处更新处处更新；撤销后全部回填处
 * 同步退回「出处待补」，不留脏数据。
 *
 * 反证纪律（MEMORY：写完门控立刻造反证）：本测试组的核心不是"assignChannel 返回了
 * assignmentId"，而是**撤销后必须恢复到指派前的完全相同状态**——不是"大致恢复"，是
 * `resolveSpeaker` 逐字返回 `null`，且所有消费方计数在语义上等价于"未指派过"。
 * 反证在第三个 it 里：故意验证撤销后重新指派同一声道不会撞上任何"上次指派的残留状态"。
 */
import { describe, expect, it } from "vitest";
import { resolveSpeaker } from "../../src/domain/recording/speaker-assignment";
import { assignChannel, revokeAssignment } from "../../src/application/recording/assignment";
import { assignmentHarness } from "../support/rec-assignment-fakes";

const ROSTER = [
  { personId: "p-zhou", displayName: "周宁" },
  { personId: "p-kraus", displayName: "Kraus" },
];

describe("F74 · 声道↔人映射：指派回填、撤销可逆", () => {
  it("AC1 · 指派后引述/洞察/报告/图谱全部能解析出说话人，且是同一条映射记录", async () => {
    const deps = assignmentHarness();
    deps.roster.seed("sess-1", ROSTER);
    // 四类消费方各自持有对 ch-A 的一个「引用」——不是各自的一份 personId 副本。
    deps.backfill.addRef("sess-1", "ch-A", "quote");
    deps.backfill.addRef("sess-1", "ch-A", "quote");
    deps.backfill.addRef("sess-1", "ch-A", "insight");
    deps.backfill.addRef("sess-1", "ch-A", "report");
    deps.backfill.addRef("sess-1", "ch-A", "graph");
    deps.channels.setSegmentCount("sess-1", "ch-A", 7);

    // 指派前：未指派，出处待补。
    expect(resolveSpeaker("ch-A", [...deps.assignments.rows.values()])).toBeNull();

    const result = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-zhou",
      expectedChannelVersion: 0,
      assignedAt: "2026-07-31T10:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.affectedSegmentCount).toBe(7);
    // 四类消费方一次性全部"回填"——因为它们本来就指向同一条记录，指派一发生就都能读到。
    expect(Object.fromEntries(result.backfilledRefs.map((r) => [r.kind, r.count]))).toEqual({
      quote: 2,
      insight: 1,
      report: 1,
      graph: 1,
    });

    // 一处更新处处更新：所有消费方现在都解析到同一个人，因为它们查的是同一条记录。
    const rows = [...deps.assignments.rows.values()];
    expect(resolveSpeaker("ch-A", rows)).toBe("p-zhou");
    expect(deps.backfill.currentlyResolvedFor("sess-1", "ch-A", rows)).toBe("p-zhou");
  });

  it("AC1 · 撤销后所有回填处同步退回「出处待补」，不留脏数据", async () => {
    const deps = assignmentHarness();
    deps.roster.seed("sess-1", ROSTER);
    deps.backfill.addRef("sess-1", "ch-A", "quote");
    deps.backfill.addRef("sess-1", "ch-A", "graph");
    deps.channels.setSegmentCount("sess-1", "ch-A", 3);

    const assigned = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-zhou",
      expectedChannelVersion: 0,
      assignedAt: "2026-07-31T10:00:00Z",
    });
    if (!assigned.ok) throw new Error(`setup failed: ${assigned.reason}`);
    expect(resolveSpeaker("ch-A", [...deps.assignments.rows.values()])).toBe("p-zhou");

    const revoked = await revokeAssignment(deps, {
      assignmentId: assigned.assignmentId,
      revokedAt: "2026-07-31T11:00:00Z",
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;

    // 撤销动作本身没有touch任何 quote/insight/report/graph 的行——它只翻了一条记录的
    // revokedAt。但下一次读取（resolveSpeaker）必须已经看不到这个人了。
    const rowsAfterRevoke = [...deps.assignments.rows.values()];
    expect(resolveSpeaker("ch-A", rowsAfterRevoke)).toBeNull();
    expect(deps.backfill.currentlyResolvedFor("sess-1", "ch-A", rowsAfterRevoke)).toBeNull();

    // 撤销记录本身还在（审计轨迹），只是不再 active。
    const revokedRow = deps.assignments.rows.get(assigned.assignmentId);
    expect(revokedRow?.revokedAt).toBe("2026-07-31T11:00:00Z");
    expect(revokedRow?.personId).toBe("p-zhou"); // 历史不可篡改，只是不再生效
  });

  it("反证：撤销后重新指派同一声道，看到的是全新映射，没有上一次的残留状态", async () => {
    const deps = assignmentHarness();
    deps.roster.seed("sess-1", ROSTER);
    deps.channels.setSegmentCount("sess-1", "ch-A", 5);

    const first = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-zhou",
      expectedChannelVersion: 0,
      assignedAt: "2026-07-31T10:00:00Z",
    });
    if (!first.ok) throw new Error(`setup failed: ${first.reason}`);

    await revokeAssignment(deps, {
      assignmentId: first.assignmentId,
      revokedAt: "2026-07-31T10:05:00Z",
    });

    // 撤销后必须回到"未指派"状态，channelVersion 语义上等于「上一条已生效指派的版本」——
    // 重新指派要拿到当时递增后的版本号，而不是回退到 0（否则并发指派的版本号就会撞车）。
    const rowsAfterRevoke = [...deps.assignments.rows.values()];
    const versionAfterRevoke = rowsAfterRevoke.find((r) => r.assignmentId === first.assignmentId)
      ?.channelVersion;
    expect(versionAfterRevoke).toBe(1);

    const second = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-kraus",
      expectedChannelVersion: 1,
      assignedAt: "2026-07-31T10:06:00Z",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // 新的映射记录，不是复用第一条的 id。
    expect(second.assignmentId).not.toBe(first.assignmentId);
    const rowsAfterSecond = [...deps.assignments.rows.values()];
    expect(resolveSpeaker("ch-A", rowsAfterSecond)).toBe("p-kraus");
    // 第一条记录仍然可查（审计），且仍然是撤销状态，没有被第二次指派悄悄复活。
    const firstRowStill = deps.assignments.rows.get(first.assignmentId);
    expect(firstRowStill?.revokedAt).not.toBeNull();
  });

  it("并发：两人同时指派同一未指派声道，后到者收到版本冲突，不静默覆盖", async () => {
    const deps = assignmentHarness();
    deps.roster.seed("sess-1", ROSTER);
    deps.channels.setSegmentCount("sess-1", "ch-A", 2);

    const winner = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-zhou",
      expectedChannelVersion: 0,
      assignedAt: "2026-07-31T10:00:00Z",
    });
    expect(winner.ok).toBe(true);

    // 第二个人仍然带着旧版本号（0）来指派——赢家已经把声道写到版本 1，
    // 版本校验先于"已指派"判定，所以这里是版本冲突，而不是"已指派"（E3：不静默覆盖）。
    const loser = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-kraus",
      expectedChannelVersion: 0,
      assignedAt: "2026-07-31T10:00:01Z",
    });
    expect(loser).toEqual({ ok: false, reason: "CHANNEL_VERSION_CHANGED" });

    // 若输家读到了最新版本号（1）但声道确实已生效指派给别人，才是 CHANNEL_ALREADY_ASSIGNED。
    const staleButCorrectVersion = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-kraus",
      expectedChannelVersion: 1,
      assignedAt: "2026-07-31T10:00:02Z",
    });
    expect(staleButCorrectVersion).toEqual({ ok: false, reason: "CHANNEL_ALREADY_ASSIGNED" });

    // 声道仍然解析为赢家，输家没有留下任何记录。
    expect(resolveSpeaker("ch-A", [...deps.assignments.rows.values()])).toBe("p-zhou");
  });

  it("PERSON_NOT_IN_ROSTER：候选人不在本场在场名单里，拒绝指派", async () => {
    const deps = assignmentHarness();
    deps.roster.seed("sess-1", ROSTER);
    deps.channels.setSegmentCount("sess-1", "ch-A", 1);

    const result = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-stranger",
      expectedChannelVersion: 0,
      assignedAt: "2026-07-31T10:00:00Z",
    });
    expect(result).toEqual({ ok: false, reason: "PERSON_NOT_IN_ROSTER" });
  });

  it("OVERLAP_SEGMENT_REQUIRES_SPLIT：未拆分的重叠段声道不可整体指派", async () => {
    const deps = assignmentHarness();
    deps.roster.seed("sess-1", ROSTER);
    deps.channels.setOverlap("sess-1", "ch-A", true);

    const result = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-zhou",
      expectedChannelVersion: 0,
      assignedAt: "2026-07-31T10:00:00Z",
    });
    expect(result).toEqual({ ok: false, reason: "OVERLAP_SEGMENT_REQUIRES_SPLIT" });
  });

  it("ASSIGNMENT_NOT_FOUND / ASSIGNMENT_ALREADY_REVOKED：撤销的边界", async () => {
    const deps = assignmentHarness();
    deps.roster.seed("sess-1", ROSTER);
    deps.channels.setSegmentCount("sess-1", "ch-A", 1);

    const missing = await revokeAssignment(deps, {
      assignmentId: "does-not-exist",
      revokedAt: "2026-07-31T10:00:00Z",
    });
    expect(missing).toEqual({ ok: false, reason: "ASSIGNMENT_NOT_FOUND" });

    const assigned = await assignChannel(deps, {
      sessionId: "sess-1",
      channelId: "ch-A",
      personId: "p-zhou",
      expectedChannelVersion: 0,
      assignedAt: "2026-07-31T10:00:00Z",
    });
    if (!assigned.ok) throw new Error(`setup failed: ${assigned.reason}`);

    const firstRevoke = await revokeAssignment(deps, {
      assignmentId: assigned.assignmentId,
      revokedAt: "2026-07-31T10:05:00Z",
    });
    expect(firstRevoke.ok).toBe(true);

    const secondRevoke = await revokeAssignment(deps, {
      assignmentId: assigned.assignmentId,
      revokedAt: "2026-07-31T10:06:00Z",
    });
    expect(secondRevoke).toEqual({ ok: false, reason: "ASSIGNMENT_ALREADY_REVOKED" });
  });
});
