/**
 * Phase 14 F06（`plan-permissions` 契约束 UC-6 `decideToolPermission`，R5，domain.md
 * `StandingToolGrant`，I-4）—— 三档授权粒度各自的生效范围反证套件。
 *
 * · `once`：只放行这一次，不落任何授权记录（I-4：授权粒度互不越界，"单次"永远不在
 *   授权存储里留痕）。
 * · `run`：只在本次 run 内生效，`hasGrant` 对同组织不同 run 恒不命中。
 * · `forever`：组织级运行时持久化，无过期，`hasGrant` 对同组织任意 run 恒命中
 *   （跨 run 生效，R12 验收线索）。
 * · `deny`：不落任何授权记录，且走 `denyAndRequeue`（不是 `failRun`）——R3 步骤 6，
 *   拒绝后内核据此调整计划而不是直接判定 run 失败。
 *
 * 授权判定本身（`createInMemoryToolPermissionGrantStore`）与 `decideToolPermission`
 * 用例串起来测：真实调用路径是"人在弹层点了哪个按钮 → 这里落哪种效果"，不是分别测
 * 两个从不放在一起验证的孤岛。
 */
import { describe, expect, it, vi } from "vitest";
import type { OrgId } from "../../src/domain/org-id";
import { toOrgId } from "../../src/domain/org-id";
import { createInMemoryToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";

async function makeDeps(overrides: {
  status: string;
  requeueWins?: boolean;
  pendingToolName?: string | null;
}) {
  vi.resetModules();
  vi.doMock("../../src/application/chat/resolve-visibility", () => ({
    resolveVisibility: async () => ({
      kind: "allow",
      actor: { projectRole: "member" },
      thread: { archived: false },
      base: { requesterId: "u1" },
    }),
    AuthzUnavailableError: class extends Error {},
  }));
  vi.doMock("../../src/application/security/permission-filter", () => ({
    discloseDecided: (g: { value: unknown }) => ({ kind: "disclosed", payload: g.value }),
    isDisclosed: (d: { kind: string }) => d.kind === "disclosed",
  }));
  const mod = await import("../../src/application/agent-run/decide-tool-permission");

  const calls: string[] = [];
  let status = overrides.status;
  const pendingApproval = overrides.pendingToolName === undefined
    ? { permissionRequestId: "permission-1", toolName: "call_skill", argsSummary: "{}" }
    : overrides.pendingToolName === null ? null : { permissionRequestId: "permission-1", toolName: overrides.pendingToolName, argsSummary: "{}" };
  const grants = createInMemoryToolPermissionGrantStore();
  const runs = {
    findLocator: async () => ({ threadId: "t", projectId: null }),
    readRun: async () => ({ value: { runId: "r1", status, error: null, pendingApproval } }),
    decidePermissionRequest: async (orgId: OrgId, runId: string, requestId: string,
      decision: "once" | "run" | "forever" | "deny", userId: string) => {
      calls.push(`decide:${requestId}:${decision}`);
      if (overrides.requeueWins === false || status !== "awaiting_tool_permission" || requestId !== "permission-1") return false;
      if (decision === "run") await grants.grantForRun(orgId, runId, pendingApproval!.toolName);
      if (decision === "forever") await grants.grantStanding(orgId, pendingApproval!.toolName, userId);
      status = "queued";
      return true;
    },
  };
  let kicked = 0;
  const deps = { runs, grants, kick: () => { kicked += 1; } } as never;
  return { mod, deps, calls, grants, kicked: () => kicked };
}

const ORG = toOrgId("org-f06-grant-scopes");

describe("Phase 14 F06 -- decideToolPermission 四选一：授权粒度各自的生效范围", () => {
  it("once：原子裁决 + kick，不落任何授权记录", async () => {
    const { mod, deps, calls, grants, kicked } = await makeDeps({ status: "awaiting_tool_permission" });
    const out = await mod.decideToolPermission(deps, {
      userId: "u1", orgId: ORG, runId: "r1", permissionRequestId: "permission-1", decision: "once",
    });
    expect(calls).toEqual(["decide:permission-1:once"]);
    expect(kicked()).toBe(1);
    expect(out.status).toBe("queued");
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(false);
    expect(await grants.hasGrant(ORG, "some-other-run", "call_skill")).toBe(false);
  });

  it("run：原子裁决 + 落一条本 run 内的授权记录，不越界到另一个 run", async () => {
    const { mod, deps, calls, grants } = await makeDeps({ status: "awaiting_tool_permission" });
    await mod.decideToolPermission(deps, {
      userId: "u1", orgId: ORG, runId: "r1", permissionRequestId: "permission-1", decision: "run",
    });
    expect(calls).toEqual(["decide:permission-1:run"]);
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(true);
    // I-4：授权粒度互不越界——"本次 run 内"不该被另一个 run 读到。
    expect(await grants.hasGrant(ORG, "r2-never-decided-here", "call_skill")).toBe(false);
  });

  it("forever：原子裁决 + 落一条组织级授权记录，跨任意 run 生效（R12）", async () => {
    const { mod, deps, calls, grants } = await makeDeps({ status: "awaiting_tool_permission" });
    await mod.decideToolPermission(deps, {
      userId: "u1", orgId: ORG, runId: "r1", permissionRequestId: "permission-1", decision: "forever",
    });
    expect(calls).toEqual(["decide:permission-1:forever"]);
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(true);
    // 跨 run 持久化生效——换一个从未在这次决策里出现过的 run 依然命中。
    expect(await grants.hasGrant(ORG, "a-totally-different-run", "call_skill")).toBe(true);
  });

  it("deny：原子拒绝裁决+ kick，不落任何授权记录", async () => {
    const { mod, deps, calls, grants, kicked } = await makeDeps({ status: "awaiting_tool_permission" });
    const out = await mod.decideToolPermission(deps, {
      userId: "u1", orgId: ORG, runId: "r1", permissionRequestId: "permission-1", decision: "deny",
    });
    expect(calls).toEqual(["decide:permission-1:deny"]);
    expect(kicked()).toBe(1);
    // R3 步骤 6：拒绝也重新入队继续跑，不是终态失败——status 落回 queued，不是 failed。
    expect(out.status).toBe("queued");
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(false);
  });

  it("run 不在 awaiting_tool_permission 时任何决策都拒绝——不是随时可以裁决的开关", async () => {
    const { mod, deps, calls } = await makeDeps({ status: "running" });
    await expect(
      mod.decideToolPermission(deps, { userId: "u1", orgId: ORG, runId: "r1", permissionRequestId: "permission-1", decision: "forever" }),
    ).rejects.toBeInstanceOf(mod.RunNotAwaitingToolPermissionError);
    expect(calls).toEqual([]);
  });

  it("竞态输了（已被别处裁决）→ 抛冲突，不假装生效、不静默补落授权记录", async () => {
    const { mod, deps, calls, grants } = await makeDeps({ status: "awaiting_tool_permission", requeueWins: false });
    await expect(
      mod.decideToolPermission(deps, { userId: "u1", orgId: ORG, runId: "r1", permissionRequestId: "permission-1", decision: "forever" }),
    ).rejects.toBeInstanceOf(mod.RunNotAwaitingToolPermissionError);
    expect(calls).toEqual(["decide:permission-1:forever"]);
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(false);
  });
  it("旧审批身份不能裁决新请求或写入授权", async () => {
    const { mod, deps, calls, grants } = await makeDeps({ status: "awaiting_tool_permission" });
    await expect(mod.decideToolPermission(deps, {
      userId: "u1", orgId: ORG, runId: "r1", permissionRequestId: "old-permission", decision: "forever",
    })).rejects.toBeInstanceOf(mod.RunNotAwaitingToolPermissionError);
    expect(calls).toEqual([]);
    expect(await grants.hasGrant(ORG, "r1", "call_skill")).toBe(false);
  });

});
