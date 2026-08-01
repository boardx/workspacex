/**
 * F75 · V2b①/I-13/I-15/I-16 —— 指派完成即销毁本场声纹 embedding，物理删除 + 审计，
 * 且级联失效以它为输入的派生物。
 *
 * 反证纪律（MEMORY：写完门控立刻造反证）：本组最容易做成「看着对」的错法是——
 *   ① 只翻 `destroyedAt` 标记而不真删行（软删过关，I-15 的字面要求是物理删除）；
 *   ② 删了向量但漏掉级联失效，让 `derived_representations` 继续宣称自己有效（I-16）；
 *   ③ 指派没做完就提前销毁（下一次回填就再也够不着支撑数据了）。
 * 三个反证分别在第 2/4/5 个 it 里。
 */
import { describe, expect, it } from "vitest";
import { destroyVoiceprintsOnAssignmentComplete } from "../../src/application/recording/voiceprint-destruction";
import { voiceprintDestructionHarness } from "../support/voiceprint-destruction-fakes";

describe("F75 · 声纹 embedding：指派完成即销毁 + 级联失效", () => {
  it("指派全部完成 ⇒ 本场声纹 embedding 记录数变为 0（物理删除，非软删），并写一条审计事件", async () => {
    const deps = voiceprintDestructionHarness();
    deps.channels.setChannels("sess-1", [
      { channelId: "ch-A", isAssigned: true },
      { channelId: "ch-B", isAssigned: true },
    ]);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-08-07T00:00:00Z", destroyedAt: null },
      { embeddingId: "emb-2", sessionId: "sess-1", channelId: "ch-B", expiresAt: "2026-08-07T00:00:00Z", destroyedAt: null },
    ]);

    const result = await destroyVoiceprintsOnAssignmentComplete(deps, {
      sessionId: "sess-1",
      actor: "user-guide-1",
      at: "2026-07-31T12:00:00Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.destroyedCount).toBe(2);
    expect(typeof result.auditEventId).toBe("string");

    // I-13：本场记录数为 0——不是靠某个字段读出「已删」，是行真的不在了。
    expect(await deps.embeddings.listBySession("sess-1")).toEqual([]);
    expect(deps.embeddings.rows.size).toBe(0);
    expect(deps.embeddings.deletedIds.sort()).toEqual(["emb-1", "emb-2"]);

    // I-15：审计事件带 sessionId / reason / actor，reason 是「指派触发」，不是兜底。
    expect(deps.provenance.events).toHaveLength(1);
    expect(deps.provenance.events[0]).toMatchObject({
      sessionId: "sess-1",
      reason: "assigned",
      actor: "user-guide-1",
    });
  });

  it("反证 · 物理删除不是软删：deleteAll 之后行从存储里消失，不是多了一个 destroyedAt 字段", async () => {
    const deps = voiceprintDestructionHarness();
    deps.channels.setChannels("sess-1", [{ channelId: "ch-A", isAssigned: true }]);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-08-07T00:00:00Z", destroyedAt: null },
    ]);

    await destroyVoiceprintsOnAssignmentComplete(deps, {
      sessionId: "sess-1", actor: "user-1", at: "2026-07-31T12:00:00Z",
    });

    // 如果实现只是把 destroyedAt 设成非空而不真删，这里 `.get` 仍会命中同一个 key。
    expect(deps.embeddings.rows.get("emb-1")).toBeUndefined();
  });

  it("级联失效：删除向量后，所有引用它的派生物都被标记失效（I-16）", async () => {
    const deps = voiceprintDestructionHarness();
    deps.channels.setChannels("sess-1", [{ channelId: "ch-A", isAssigned: true }]);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-08-07T00:00:00Z", destroyedAt: null },
    ]);
    deps.derived.addRef("derived-cluster-1", "emb-1");
    deps.derived.addRef("derived-cache-1", "emb-1");
    deps.derived.addRef("derived-unrelated", "emb-other"); // 不该被这次调用波及

    await destroyVoiceprintsOnAssignmentComplete(deps, {
      sessionId: "sess-1", actor: "user-1", at: "2026-07-31T12:00:00Z",
    });

    expect(deps.derived.rows.get("derived-cluster-1")?.invalidatedAt).toBe("2026-07-31T12:00:00Z");
    expect(deps.derived.rows.get("derived-cache-1")?.invalidatedAt).toBe("2026-07-31T12:00:00Z");
    // 反证：没被销毁的 embedding 引用的派生物必须保持有效，不能被一锅端。
    expect(deps.derived.rows.get("derived-unrelated")?.invalidatedAt).toBeNull();
  });

  it("反证 · 级联失效失败 ⇒ 整体判失败（CASCADE_INVALIDATION_FAILED），不报成功", async () => {
    const deps = voiceprintDestructionHarness();
    deps.channels.setChannels("sess-1", [{ channelId: "ch-A", isAssigned: true }]);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-08-07T00:00:00Z", destroyedAt: null },
    ]);
    deps.derived.addRef("derived-1", "emb-1");
    deps.derived.failNextInvalidate = true;

    const result = await destroyVoiceprintsOnAssignmentComplete(deps, {
      sessionId: "sess-1", actor: "user-1", at: "2026-07-31T12:00:00Z",
    });

    expect(result).toEqual({ ok: false, reason: "CASCADE_INVALIDATION_FAILED" });
    // 不写审计事件——半成品不留下"看似成功"的记录。
    expect(deps.provenance.events).toHaveLength(0);
  });

  it("反证 · 指派未完成 ⇒ ASSIGNMENT_NOT_COMPLETE，向量与派生物都不动", async () => {
    const deps = voiceprintDestructionHarness();
    deps.channels.setChannels("sess-1", [
      { channelId: "ch-A", isAssigned: true },
      { channelId: "ch-B", isAssigned: false }, // 还有一个声道没指派
    ]);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-08-07T00:00:00Z", destroyedAt: null },
      { embeddingId: "emb-2", sessionId: "sess-1", channelId: "ch-B", expiresAt: "2026-08-07T00:00:00Z", destroyedAt: null },
    ]);

    const result = await destroyVoiceprintsOnAssignmentComplete(deps, {
      sessionId: "sess-1", actor: "user-1", at: "2026-07-31T12:00:00Z",
    });

    expect(result).toEqual({ ok: false, reason: "ASSIGNMENT_NOT_COMPLETE" });
    expect(deps.embeddings.rows.size).toBe(2);
    expect(deps.provenance.events).toHaveLength(0);
  });

  it("删除向量本身失败 ⇒ DESTROY_PARTIAL_FAILURE，且不继续级联失效（顺序：先删成功才失效）", async () => {
    const deps = voiceprintDestructionHarness();
    deps.channels.setChannels("sess-1", [{ channelId: "ch-A", isAssigned: true }]);
    deps.embeddings.seed([
      { embeddingId: "emb-1", sessionId: "sess-1", channelId: "ch-A", expiresAt: "2026-08-07T00:00:00Z", destroyedAt: null },
    ]);
    deps.derived.addRef("derived-1", "emb-1");
    deps.embeddings.failNextDelete = true;

    const result = await destroyVoiceprintsOnAssignmentComplete(deps, {
      sessionId: "sess-1", actor: "user-1", at: "2026-07-31T12:00:00Z",
    });

    expect(result).toEqual({ ok: false, reason: "DESTROY_PARTIAL_FAILURE" });
    expect(deps.derived.rows.get("derived-1")?.invalidatedAt).toBeNull();
    expect(deps.provenance.events).toHaveLength(0);
  });

  it("幂等：本场已无声纹 embedding 时再次调用（指派已完成）仍返回成功、destroyedCount=0", async () => {
    const deps = voiceprintDestructionHarness();
    deps.channels.setChannels("sess-1", [{ channelId: "ch-A", isAssigned: true }]);
    // 没有 seed 任何 embedding —— 模拟"已经被销毁过一次"之后的重复调用。

    const result = await destroyVoiceprintsOnAssignmentComplete(deps, {
      sessionId: "sess-1", actor: "user-1", at: "2026-07-31T12:00:00Z",
    });

    expect(result).toEqual({
      ok: true,
      destroyedCount: 0,
      auditEventId: expect.any(String),
    });
  });
});
