/**
 * F59 / AC1 / V1 / V4 -- 私聊与主线程隔离，转出时带完整出处。
 *
 * `user_visible_behavior`: 「私聊消息不进入主线程的转录/洞察/产物三栏、不计入线程消息数；
 * 把一条结论转到主线程时带完整出处（agent + skill 版本 + 时间 + 数据来源）」。
 *
 * ## Reverse assertions first (AGENTS.md 纪律)
 *
 * An implementation that always reports "isolated" and always builds a provenance object
 * would pass every happy-path test. So this file leads with: (a) a mixed main/private-chat
 * stream where an implementation that forgets to filter would leak a private-chat item into
 * the main-thread count, and (b) an incomplete provenance (missing skill mounts or missing
 * data sources) that an implementation which never checks completeness would happily hand off.
 */
import { describe, expect, it } from "vitest";
import {
  excludeFromMainThreadProjection,
  countMainThreadMessages,
  buildHandoffProvenance,
  attemptHandoffToMainThread,
  type ScopedThreadItem,
} from "../../../src/domain/agent/private-chat";

interface Item extends ScopedThreadItem {
  readonly id: string;
}

const mainA: Item = { id: "m-1", scope: "main" };
const mainB: Item = { id: "m-2", scope: "main" };
const privateX: Item = { id: "p-1", scope: "private-chat" };
const privateY: Item = { id: "p-2", scope: "private-chat" };

describe("F59 V4 -- 私聊不进主线程三栏、不计入消息数", () => {
  it("反向断言：混合流里私聊条目必须被滤掉，不是恰好数量凑对", () => {
    const stream = [mainA, privateX, mainB, privateY];
    const projected = excludeFromMainThreadProjection(stream);
    expect(projected).toEqual([mainA, mainB]);
    expect(projected.some((i) => i.scope === "private-chat")).toBe(false);
  });

  it("主线程消息计数只数 scope=main 的条目，私聊消息不计入", () => {
    const stream = [mainA, privateX, privateY];
    expect(countMainThreadMessages(stream)).toBe(1);
  });

  it("没有私聊条目时投影与计数照旧正确（不是靠私聊条目存在才触发过滤逻辑）", () => {
    const stream = [mainA, mainB];
    expect(excludeFromMainThreadProjection(stream)).toEqual([mainA, mainB]);
    expect(countMainThreadMessages(stream)).toBe(2);
  });

  it("全部是私聊条目时主线程计数为 0，不是全部条目的计数", () => {
    const stream = [privateX, privateY];
    expect(countMainThreadMessages(stream)).toBe(0);
  });
});

describe("F59 AC1 / V1 / R7 -- 转出到主线程必须带完整出处", () => {
  const base = {
    sourceSessionId: "pc-session-1",
    agentId: "agt-ava",
    agentVersionId: "agt-ava-v3",
    handedOffAt: "2026-08-02T10:00:00Z",
  };

  it("反向断言：skillMounts 为空 ⇒ 出处不完整，即使 dataSources 齐全也不放行", () => {
    const result = buildHandoffProvenance({
      ...base,
      skillMounts: [],
      dataSources: ["transcript:seg-3"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INCOMPLETE_PROVENANCE");
  });

  it("反向断言：dataSources 为空 ⇒ 出处不完整，即使 skillMounts 齐全也不放行", () => {
    const result = buildHandoffProvenance({
      ...base,
      skillMounts: [{ skillId: "skl-interview", skillVersion: 3 }],
      dataSources: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INCOMPLETE_PROVENANCE");
  });

  it("agent + skill 版本 + 时间 + 数据来源齐全 ⇒ 出处完整并逐字段可回溯", () => {
    const result = buildHandoffProvenance({
      ...base,
      skillMounts: [{ skillId: "skl-interview", skillVersion: 3 }],
      dataSources: ["transcript:seg-3", "material:doc-9"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provenance).toEqual({
        sourceSessionId: "pc-session-1",
        agentId: "agt-ava",
        agentVersionId: "agt-ava-v3",
        skillMounts: [{ skillId: "skl-interview", skillVersion: 3 }],
        dataSources: ["transcript:seg-3", "material:doc-9"],
        handedOffAt: "2026-08-02T10:00:00Z",
      });
    }
  });

  it("E4：目标线程已归档只读 ⇒ 转出被拒并显式标注私聊内容被保留，即使出处本身完整", () => {
    const outcome = attemptHandoffToMainThread(
      {
        ...base,
        skillMounts: [{ skillId: "skl-interview", skillVersion: 3 }],
        dataSources: ["transcript:seg-3"],
      },
      { archived: true },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("THREAD_ARCHIVED_READONLY");
      expect(outcome.preservedInPrivateChat).toBe(true);
    }
  });

  it("目标线程未归档且出处完整 ⇒ 转出成功", () => {
    const outcome = attemptHandoffToMainThread(
      {
        ...base,
        skillMounts: [{ skillId: "skl-interview", skillVersion: 3 }],
        dataSources: ["transcript:seg-3"],
      },
      { archived: false },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.provenance.agentId).toBe("agt-ava");
      expect(outcome.provenance.dataSources).toEqual(["transcript:seg-3"]);
    }
  });

  it("出处不完整时优先报 INCOMPLETE_PROVENANCE，不与线程归档原因合并成一个理由", () => {
    const outcome = attemptHandoffToMainThread(
      { ...base, skillMounts: [], dataSources: [] },
      { archived: true },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("INCOMPLETE_PROVENANCE");
  });
});
