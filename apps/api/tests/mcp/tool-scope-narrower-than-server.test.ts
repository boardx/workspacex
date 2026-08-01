import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";

/**
 * F129 (domain I-29′) -- 授权粒度是**逐工具**，服务器级 `authScope` 是**上限**，
 * 工具级**只能更严**（同 O-23"收紧优先"）；新发现的工具默认 `未开放`。
 *
 * ⚠ **必须双向**（domain.md 逐字，且是 issue #199 notes 里点名要求的一条）：
 *   - 越界：服务器 `仅项目负责人` + 工具 `全体成员` ⇒ 被拒
 *   - 合规：服务器 `全体成员` + 工具 `全体成员` ⇒ 可调用
 *   只写前者时，"工具级一律不可调用"（一个把 `checkToolScopeWithinServer` 恒返回
 *   `ok:false` 的实现）在只跑前一半断言时会全绿——这正是本文件要挡住的空转。
 */

describe("F129 I-29′ · checkToolScopeWithinServer -- 服务器级为上限，工具级只能更严（双向）", () => {
  it("越界：服务器「仅项目负责人」+ 工具「全体成员」⇒ 被拒（不得放宽上层）", () => {
    const r = A.checkToolScopeWithinServer({
      serverScope: "仅项目负责人",
      toolScope: "全体成员",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("TOOL_SCOPE_EXCEEDS_SERVER_SCOPE");
  });

  it("⭐ 反向 / 合规：服务器「全体成员」+ 工具「全体成员」⇒ 可调用（防止『一律不可调用』全绿）", () => {
    const r = A.checkToolScopeWithinServer({
      serverScope: "全体成员",
      toolScope: "全体成员",
    });
    expect(r.ok).toBe(true);
  });

  it("反向：服务器「全体成员」+ 工具「未开放」⇒ 允许收紧，该工具因此不可被任何 agent 调用", () => {
    const r = A.checkToolScopeWithinServer({
      serverScope: "全体成员",
      toolScope: "未开放",
    });
    expect(r.ok).toBe(true);
    // 收紧后，`evaluateMcpAuthScope` 在工具级判定上就该直接拒绝——这不是另一条规则，
    // 是同一条"未开放恒拒"的延续。
  });

  it("边界恰好：工具级与服务器级取同一个值（非首尾）⇒ 允许 -- 『只能更严』不是『必须更严』", () => {
    const r = A.checkToolScopeWithinServer({
      serverScope: "仅某团队",
      toolScope: "仅某团队",
    });
    expect(r.ok).toBe(true);
  });

  it("穷举：对全部 5×5=25 组合，结果恰好等于 rank(tool) <= rank(server)（不依赖字符串比较）", () => {
    const options = A.ToolAuthScope.options;
    for (const serverScope of options) {
      for (const toolScope of options) {
        const r = A.checkToolScopeWithinServer({ serverScope, toolScope });
        const expected = A.TOOL_AUTH_SCOPE_RANK[toolScope] <= A.TOOL_AUTH_SCOPE_RANK[serverScope];
        expect(r.ok, `server=${serverScope} tool=${toolScope}`).toBe(expected);
      }
    }
  });

  it("新发现的工具默认 `未开放`（原型 16,684,300 逐字『默认全关』），任何服务器级上限下都成立", () => {
    expect(A.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE).toBe("未开放");
    for (const serverScope of A.ToolAuthScope.options) {
      const r = A.checkToolScopeWithinServer({
        serverScope,
        toolScope: A.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE,
      });
      expect(r.ok, `server=${serverScope}`).toBe(true);
    }
  });
});
