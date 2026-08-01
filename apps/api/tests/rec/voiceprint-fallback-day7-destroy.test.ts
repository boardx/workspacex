/**
 * F75 · V2b②③/I-14/I-17 —— 兜底销毁：本场结束后第 7 天无条件销毁（无论指派是否完成），
 * 且销毁后重跑 diarization 只产生新的派生版本、旧特征不复活。
 *
 * 反证纪律：本组最容易漏掉的两件事——
 *   ① 兜底销毁**看了**指派状态、对"指派未完成"网开一面（O-14 原文是"无条件"）；
 *   ② 天数门槛判定**差一天就错**（第 6 天不该销毁，第 7 天到点该销毁）——用边界值而不是
 *      "随便推进很久"来测，否则一个总是返回 true 的实现也能通过。
 * 第三个 it 是①的反证，第一、二个 it 是②的边界对照。
 */
import { describe, expect, it } from "vitest";
import { sweepVoiceprints } from "../../src/application/recording/voiceprint-destruction";
import {
  isSweepEligible,
  noRevival,
  nextDerivedVersion,
} from "../../src/domain/recording/voiceprint-destruction";
import { voiceprintDestructionHarness } from "../support/voiceprint-destruction-fakes";

const FALLBACK_DAYS = 7; // 本文件不在 src/domain|application/recording 扫描面内，字面量不受门控约束。
const ENDED_AT = "2026-07-24T10:00:00.000Z";

describe("F75 · 兜底销毁：本场结束后第 7 天无条件销毁", () => {
  it("边界 · 第 6 天（未到 7 天）不具备兜底资格，向量原样保留", async () => {
    const deps = voiceprintDestructionHarness();
    deps.policy.set(FALLBACK_DAYS);
    deps.sessions.setEnded("sess-1", ENDED_AT);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-07-31T10:00:00.000Z", destroyedAt: null },
    ]);

    const asOfDay6 = "2026-07-30T10:00:00.000Z";
    expect(isSweepEligible(ENDED_AT, asOfDay6, FALLBACK_DAYS)).toBe(false);

    const result = await sweepVoiceprints(deps, { asOf: asOfDay6, actor: "system-sweep" });
    expect(result).toEqual({ ok: true, sessions: [] });
    expect(deps.embeddings.rows.size).toBe(1); // 没碰
    expect(deps.provenance.events).toHaveLength(0);
  });

  it("边界 · 第 7 天到点 ⇒ 无条件兜底销毁 + 审计事件（reason=fallback-d7）", async () => {
    const deps = voiceprintDestructionHarness();
    deps.policy.set(FALLBACK_DAYS);
    deps.sessions.setEnded("sess-1", ENDED_AT);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-07-31T10:00:00.000Z", destroyedAt: null },
    ]);
    deps.derived.addRef("derived-1", "emb-1");

    const asOfDay7 = "2026-07-31T10:00:00.000Z";
    expect(isSweepEligible(ENDED_AT, asOfDay7, FALLBACK_DAYS)).toBe(true);

    const result = await sweepVoiceprints(deps, { asOf: asOfDay7, actor: "system-sweep" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toEqual([
      { sessionId: "sess-1", destroyedCount: 1, auditEventId: expect.any(String) },
    ]);
    expect(deps.embeddings.rows.size).toBe(0); // I-13 同样适用于兜底路径
    expect(deps.derived.rows.get("derived-1")?.invalidatedAt).toBe(asOfDay7); // I-16
    expect(deps.provenance.events[0]).toMatchObject({ sessionId: "sess-1", reason: "fallback-d7" });
  });

  it("反证 · 兜底无条件：指派完全没做（0/N 声道已指派）到第 7 天照样被销毁", async () => {
    const deps = voiceprintDestructionHarness();
    deps.policy.set(FALLBACK_DAYS);
    deps.sessions.setEnded("sess-1", ENDED_AT);
    // 指派状态压根没配置任何 channel（等价于"什么都没指派"）——sweep 不应该关心这件事。
    deps.channels.setChannels("sess-1", [
      { channelId: "ch-A", isAssigned: false },
      { channelId: "ch-B", isAssigned: false },
    ]);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-07-31T10:00:00.000Z", destroyedAt: null },
      { embeddingId: "emb-2", sessionId: "sess-1", channelId: "ch-B", expiresAt: "2026-07-31T10:00:00.000Z", destroyedAt: null },
    ]);

    const asOfDay8 = "2026-08-01T10:00:00.000Z";
    const result = await sweepVoiceprints(deps, { asOf: asOfDay8, actor: "system-sweep" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions[0]?.destroyedCount).toBe(2);
    expect(deps.embeddings.rows.size).toBe(0);
  });

  it("兜底天数未配置 ⇒ 拒绝整批扫描，不假设隐含默认值", async () => {
    const deps = voiceprintDestructionHarness();
    deps.policy.set(null);
    deps.sessions.setEnded("sess-1", ENDED_AT);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-07-31T10:00:00.000Z", destroyedAt: null },
    ]);

    const result = await sweepVoiceprints(deps, { asOf: "2026-09-01T00:00:00.000Z", actor: "system-sweep" });
    expect(result).toEqual({ ok: false, reason: "DESTROY_PARTIAL_FAILURE" });
    expect(deps.embeddings.rows.size).toBe(1); // 没销毁
  });

  it("多场次：任一场次销毁失败 ⇒ 整批失败，不返回部分成功的场次列表", async () => {
    const deps = voiceprintDestructionHarness();
    deps.policy.set(FALLBACK_DAYS);
    deps.sessions.setEnded("sess-ok", ENDED_AT);
    deps.sessions.setEnded("sess-bad", ENDED_AT);
    deps.embeddings.seed([
      { embeddingId: "emb-ok", sessionId: "sess-ok", channelId: "ch-A", expiresAt: "2026-07-31T10:00:00.000Z", destroyedAt: null },
      { embeddingId: "emb-bad", sessionId: "sess-bad", channelId: "ch-A", expiresAt: "2026-07-31T10:00:00.000Z", destroyedAt: null },
    ]);

    const asOf = "2026-08-01T10:00:00.000Z";
    // 让处理顺序中较后处理的一场失败——具体是哪一场取决于 Map 迭代序，这里两场都设成同一批，
    // 只让 store 的下一次 deleteAll 调用失败一次，命中"最先处理"的那一场即可验证语义。
    deps.embeddings.failNextDelete = true;

    const result = await sweepVoiceprints(deps, { asOf, actor: "system-sweep" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("DESTROY_PARTIAL_FAILURE");
  });

  it("I-17 · 销毁后重跑 diarization 只产生新的派生版本，旧特征 id 不复活", () => {
    const destroyedIds = ["emb-1", "emb-2"];
    const previousVersion = 3;

    const rerunIds = ["emb-3", "emb-4"]; // 应用层用 IdGenerator 新造的 id，与旧集合不相交
    expect(noRevival(rerunIds, destroyedIds)).toBe(true);
    expect(nextDerivedVersion(previousVersion)).toBe(4);

    // 反证：如果重跑"复用"了旧 id（比如实现偷懒直接复活行），必须被抓住。
    const revivedIds = ["emb-1", "emb-5"];
    expect(noRevival(revivedIds, destroyedIds)).toBe(false);
  });
});
