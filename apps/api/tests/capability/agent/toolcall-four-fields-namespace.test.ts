/**
 * F60 / I-20 / AC2 -- tool-call 四要素（函数签名 + 参数 + 命中数/结果量 + 运行态）+
 * 内建工具（graph./brain.）与 MCP 工具（mcp:<服务器>.<工具>）命名空间可区分。
 *
 * `user_visible_behavior`: 「每次工具调用留 函数签名+参数+命中数/结果量+运行态 四要素，
 * 内建工具（graph./brain.）与 MCP 工具（mcp:<服务器>.<工具>）命名空间可区分」。
 *
 * ## Reverse assertions first (AGENTS.md 纪律)
 * An implementation that always classifies as "builtin" (or always as "mcp") would pass a
 * suite that only checks the positive case for each -- the "既不是也不是" and "两者不会同时命中"
 * cases below are what would catch that.
 */
import { describe, expect, it } from "vitest";
import {
  classifyToolNamespace,
  recordToolCall,
  ToolNamespaceUnclassifiableError,
  type RecordToolCallInput,
} from "../../../src/domain/agent/tool-call-audit";
import { toolCallInput } from "./tool-call-fixtures";

describe("F60 I-20 -- 命名空间分类：graph./brain. 内建 vs mcp:<服务器>.<工具>", () => {
  it("graph.search 归类为内建（graph.）", () => {
    expect(classifyToolNamespace("graph.search")).toEqual({ kind: "builtin", prefix: "graph." });
  });

  it("brain.recall 归类为内建（brain.）", () => {
    expect(classifyToolNamespace("brain.recall")).toEqual({ kind: "builtin", prefix: "brain." });
  });

  it("mcp:market-data.query_market 归类为 MCP 工具，服务器/工具两段可拆", () => {
    expect(classifyToolNamespace("mcp:market-data.query_market")).toEqual({
      kind: "mcp",
      serverSlug: "market-data",
      toolName: "query_market",
    });
  });

  it("反向断言：既不是内建前缀也不是合法 mcp 全名 ⇒ null，不是恒归为某一类的实现", () => {
    expect(classifyToolNamespace("random.thing")).toBeNull();
    expect(classifyToolNamespace("mcp:")).toBeNull();
    expect(classifyToolNamespace("mcp:no-dot-tool")).toBeNull();
  });

  it("反向断言：内建与 MCP 是互斥分类，三个合法签名各自只命中一边", () => {
    const graph = classifyToolNamespace("graph.readEntity");
    const brain = classifyToolNamespace("brain.recall");
    const mcp = classifyToolNamespace("mcp:crm.search_account");
    expect(graph?.kind).toBe("builtin");
    expect(brain?.kind).toBe("builtin");
    expect(mcp?.kind).toBe("mcp");
  });
});

describe("F60 AC2 -- tool-call 四要素齐全时写入成功", () => {
  it("四要素（签名/参数/命中数/运行态）齐全 ⇒ 返回 recordId", () => {
    const writer = { write: () => ({ ok: true, recordId: "rec-1" }) };
    const result = recordToolCall(toolCallInput(), writer);
    expect(result).toEqual({ recordId: "rec-1" });
  });

  it("运行态逐条独立：不同调用各自携带自己的 runState，不被合并成一个整体状态", () => {
    const seen: string[] = [];
    const writer = {
      write: (input: RecordToolCallInput) => {
        seen.push(input.runState);
        return { ok: true, recordId: `rec-${input.callId}` };
      },
    };
    recordToolCall(toolCallInput({ callId: "c1", runState: "成功" }), writer);
    recordToolCall(toolCallInput({ callId: "c2", runState: "被拒", hitCount: 0 }), writer);
    recordToolCall(toolCallInput({ callId: "c3", runState: "试跑" }), writer);
    expect(seen).toEqual(["成功", "被拒", "试跑"]);
  });

  it("命中数/结果量随每条调用独立记录，不与其它调用共享同一个数", () => {
    const capturedHits: number[] = [];
    const writer = {
      write: (input: RecordToolCallInput) => {
        capturedHits.push(input.hitCount);
        return { ok: true, recordId: `rec-${input.callId}` };
      },
    };
    recordToolCall(toolCallInput({ callId: "c1", hitCount: 64 }), writer);
    recordToolCall(toolCallInput({ callId: "c2", hitCount: 1 }), writer);
    expect(capturedHits).toEqual([64, 1]);
  });

  it("反向断言：签名不可归类（非内建、非合法 mcp 全名）⇒ 拒绝，不进入写入路径", () => {
    const writes: unknown[] = [];
    const writer = {
      write: (input: RecordToolCallInput) => {
        writes.push(input);
        return { ok: true, recordId: "should-not-happen" };
      },
    };
    expect(() => recordToolCall(toolCallInput({ signature: "unknown.tool" }), writer)).toThrow(
      ToolNamespaceUnclassifiableError,
    );
    expect(writes).toEqual([]);
  });
});
