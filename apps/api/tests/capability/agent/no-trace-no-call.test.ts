/**
 * F60 / I-44 / AC6 -- 没有留痕就没有调用：tool-call 写入失败则该次工具调用必须失败。
 *
 * `user_visible_behavior`: 「tool-call 写入失败则该次调用必须失败（没有留痕就没有调用）。」
 * R7: 「[设计 · 硬前置] 没有留痕就没有调用」；R6 失败后置条件：「不产生『调用发生了但审计里
 * 没有』的空洞；写入失败必须让调用失败并可观测。」
 *
 * ## Reverse assertion first (AGENTS.md 纪律)
 * The success case comes last on purpose -- an implementation that always throws would pass
 * every "failure must propagate" assertion trivially. The final test proves the failure path
 * is not the ONLY path.
 */
import { describe, expect, it } from "vitest";
import {
  ProvenanceWriteFailedError,
  recordToolCall,
} from "../../../src/domain/agent/tool-call-audit";
import { toolCallInput } from "./tool-call-fixtures";

describe("F60 I-44 -- 审计写入失败 ⇒ 该次工具调用必须失败", () => {
  it("writer 报告写入失败（ok: false）⇒ 抛 ProvenanceWriteFailedError，不返回 recordId", () => {
    const writer = { write: () => ({ ok: false }) };
    expect(() => recordToolCall(toolCallInput(), writer)).toThrow(ProvenanceWriteFailedError);
  });

  it("writer 抛异常（例如底层存储不可用）同样必须让调用失败，不被吞掉、不被降级为『先跑后补』", () => {
    const writer = {
      write: () => {
        throw new Error("provenance store unavailable");
      },
    };
    expect(() => recordToolCall(toolCallInput(), writer)).toThrow();
  });

  it("writer 报告 ok:true 但缺 recordId（数据不完整）⇒ 同样视为失败，不允许『半成功』", () => {
    const writer = { write: () => ({ ok: true }) };
    expect(() => recordToolCall(toolCallInput(), writer)).toThrow(ProvenanceWriteFailedError);
  });

  it("没有第二条路径：写入失败时不存在任何返回值可被误当作『调用成功』", () => {
    const writer = { write: () => ({ ok: false }) };
    let observed: unknown;
    try {
      observed = recordToolCall(toolCallInput(), writer);
    } catch (err) {
      expect(err).toBeInstanceOf(ProvenanceWriteFailedError);
    }
    expect(observed).toBeUndefined();
  });

  it("反向断言：writer 写入成功时不抛错、正常返回 recordId（证明失败路径不是恒抛错的实现）", () => {
    const writer = { write: () => ({ ok: true, recordId: "rec-ok" }) };
    expect(recordToolCall(toolCallInput(), writer)).toEqual({ recordId: "rec-ok" });
  });
});
