/**
 * F130 ⑵ · I-28′ -- `setToolAuthScope`'s WRITE PATH enforces the cap. Server-side, not a
 * front-end greyed-out control: a greyed-out option only stops the UI, not a caller that
 * hits `PUT /mcp-tools/:toolFullName/auth-scope` directly. This suite calls the application
 * function the same way that endpoint would, with nothing standing between the call and the
 * store but the check itself -- there is no UI in this test at all.
 *
 * Four-cell, same discipline as the pure-fn suite: reject the over-cap side AND prove the
 * compliant side actually persists, or a "reject every write" stub passes this file too.
 */
import type { z } from "zod";
import { describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import { setToolAuthScope } from "../../src/application/mcp/set-tool-auth-scope";
import {
  McpToolNotFoundError,
  ToolScopeExceedsSideEffectCapError,
  type ToolAuthScopeStore,
} from "../../src/application/mcp/ports";

type Tool = z.infer<typeof AR.McpTool>;

function storeOf(initial: readonly Tool[]) {
  const rows = new Map(initial.map((t) => [t.fullName, t]));
  const store: ToolAuthScopeStore = {
    findByFullName: async (fullName) => rows.get(fullName) ?? null,
    updateAuthScope: async (fullName, authScope) => {
      const existing = rows.get(fullName);
      if (existing === undefined) throw new Error("test setup: unknown tool");
      rows.set(fullName, { ...existing, authScope });
    },
  };
  return { store, rows };
}

const EGRESS_TOOL: Tool = {
  fullName: "mcp:crm.send_email",
  serverId: "mcp-crm",
  signature: "send_email(to: string, body: string) -> void",
  schemaFingerprint: "fp-egress",
  sideEffect: "对外发送",
  authScope: "未开放",
};

const WRITE_TOOL: Tool = {
  fullName: "mcp:crm.create_task",
  serverId: "mcp-crm",
  signature: "create_task(title: string) -> TaskId",
  schemaFingerprint: "fp-write",
  sideEffect: "写入外部",
  authScope: "未开放",
};

const READ_TOOL: Tool = {
  fullName: "mcp:crm.query_contact",
  serverId: "mcp-crm",
  signature: "query_contact(company?: string) -> Contact[]",
  schemaFingerprint: "fp-read",
  sideEffect: "只读",
  authScope: "未开放",
};

describe("F130 ⑵ setToolAuthScope -- 服务端强制（不是界面置灰）", () => {
  it("越界被拒：对外发送 的工具设「全体成员」⇒ 拒 + TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP，且不写入", async () => {
    const { store, rows } = storeOf([EGRESS_TOOL]);
    await expect(
      setToolAuthScope({ store }, { toolFullName: EGRESS_TOOL.fullName, authScope: "全体成员" }),
    ).rejects.toBeInstanceOf(ToolScopeExceedsSideEffectCapError);
    expect(rows.get(EGRESS_TOOL.fullName)!.authScope, "拒绝后不得写入半截结果").toBe("未开放");
  });

  it("越界被拒：写入外部 的工具设「仅某团队」⇒ 拒，且不写入", async () => {
    const { store, rows } = storeOf([WRITE_TOOL]);
    await expect(
      setToolAuthScope({ store }, { toolFullName: WRITE_TOOL.fullName, authScope: "仅某团队" }),
    ).rejects.toBeInstanceOf(ToolScopeExceedsSideEffectCapError);
    expect(rows.get(WRITE_TOOL.fullName)!.authScope).toBe("未开放");
  });

  it("⭐ 合规值通过并真实持久化：对外发送 的工具设「需人工确认每次」⇒ 保存生效", async () => {
    const { store, rows } = storeOf([EGRESS_TOOL]);
    const result = await setToolAuthScope(
      { store },
      { toolFullName: EGRESS_TOOL.fullName, authScope: "需人工确认每次" },
    );
    expect(result.authScope).toBe("需人工确认每次");
    expect(rows.get(EGRESS_TOOL.fullName)!.authScope, "必须真的写进 store，不是只回一个乐观值").toBe(
      "需人工确认每次",
    );
  });

  it("⭐ 合规值通过：对外发送 的工具设「未开放」⇒ 保存生效", async () => {
    const { store } = storeOf([EGRESS_TOOL]);
    const result = await setToolAuthScope(
      { store },
      { toolFullName: EGRESS_TOOL.fullName, authScope: "未开放" },
    );
    expect(result.authScope).toBe("未开放");
  });

  it("⭐ 合规值通过：只读 的工具设「全体成员」⇒ 保存生效（防止『一律拒绝』全绿）", async () => {
    const { store, rows } = storeOf([READ_TOOL]);
    const result = await setToolAuthScope(
      { store },
      { toolFullName: READ_TOOL.fullName, authScope: "全体成员" },
    );
    expect(result.authScope).toBe("全体成员");
    expect(rows.get(READ_TOOL.fullName)!.authScope).toBe("全体成员");
  });

  it("边界恰好：只读 × 全体成员 通过 ∧ 对外发送 × 仅项目负责人 被拒（同一份 store 里两个工具）", async () => {
    const { store, rows } = storeOf([READ_TOOL, EGRESS_TOOL]);
    const okResult = await setToolAuthScope(
      { store },
      { toolFullName: READ_TOOL.fullName, authScope: "全体成员" },
    );
    expect(okResult.authScope).toBe("全体成员");

    await expect(
      setToolAuthScope(
        { store },
        { toolFullName: EGRESS_TOOL.fullName, authScope: "仅项目负责人" },
      ),
    ).rejects.toBeInstanceOf(ToolScopeExceedsSideEffectCapError);
    expect(rows.get(EGRESS_TOOL.fullName)!.authScope, "被拒的那一个不受另一个通过的写入影响").toBe(
      "未开放",
    );
  });

  it("绕过界面直接打这条写路径也一样被拒 -- 本用例本身就没有任何 UI 参与，调用方式与直接打 API 等价", async () => {
    const { store } = storeOf([WRITE_TOOL]);
    const rejection = await setToolAuthScope(
      { store },
      { toolFullName: WRITE_TOOL.fullName, authScope: "全体成员" },
    ).catch((e) => e);
    expect(rejection).toBeInstanceOf(ToolScopeExceedsSideEffectCapError);
    expect((rejection as ToolScopeExceedsSideEffectCapError).reason).toBe(
      "TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP",
    );
  });

  it("未记录过的工具全名 ⇒ McpToolNotFoundError，而不是把未知工具当只读放行", async () => {
    const { store } = storeOf([]);
    await expect(
      setToolAuthScope({ store }, { toolFullName: "mcp:crm.unknown_tool", authScope: "全体成员" }),
    ).rejects.toBeInstanceOf(McpToolNotFoundError);
  });
});
