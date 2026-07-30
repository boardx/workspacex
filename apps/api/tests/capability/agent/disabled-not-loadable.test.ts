import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import {
  AGENT_SURFACES,
  PUBLISH_STATE_TRANSITIONS,
  canTransition,
  isLoadable,
  visibleOnSurface,
} from "../../../src/domain/agent/lifecycle";
import {
  appendAgentVersion,
  freezeAgentVersion,
  lockAgentVersionsForProject,
  resolveLockedAgentVersion,
  type AgentVersionCatalog,
} from "../../../src/domain/agent/version-snapshot";
import { agent } from "./fixtures";

/**
 * F55 / I-32 / O-22④ -- 已停用 leaves the runtime surfaces, and already-locked projects keep
 * running.
 *
 * ## Both directions
 *
 *   forward   a disabled agent is not in the loadable pool, the roster, or the private-chat
 *             entry, and cannot be locked into a NEW project
 *   reverse   (a) a 运行中 agent IS on all three -- otherwise "hidden when disabled" is
 *                 passed by an implementation that hides everything
 *             (b) a project that locked BEFORE the disable still resolves its snapshot --
 *                 the second half of I-32, and the one a naive "filter out disabled agents
 *                 everywhere" implementation breaks
 */
describe("F55 I-32 -- 已停用不进可载入池，已锁版本的在跑项目不受影响", () => {
  it("forward: a disabled agent is off the three runtime surfaces", () => {
    const disabled = agent({ publishState: "已停用" });
    expect(isLoadable(disabled)).toBe(false);
    expect(visibleOnSurface(disabled, "loadable-pool")).toBe(false);
    expect(visibleOnSurface(disabled, "roster")).toBe(false);
    expect(visibleOnSurface(disabled, "private-chat")).toBe(false);
  });

  it("reverse: a 运行中 agent is ON all three -- the predicate is not 'always false'", () => {
    const running = agent({ publishState: "运行中" });
    expect(isLoadable(running)).toBe(true);
    expect(visibleOnSurface(running, "roster")).toBe(true);
    expect(visibleOnSurface(running, "private-chat")).toBe(true);
  });

  it("reverse: a disabled agent remains on the admin library, so it stays auditable", () => {
    expect(visibleOnSurface(agent({ publishState: "已停用" }), "agent-library")).toBe(true);
    expect(visibleOnSurface(agent({ publishState: "草稿" }), "agent-library")).toBe(true);
  });

  it("every publish state has an answer for every surface", () => {
    // Not `toHaveLength(4)`: the property to hold is that the set is closed and total, not
    // that it has a particular size (discipline rule 7 -- a size assertion blocks a
    // legitimate ADR-reviewed addition).
    for (const state of A.AgentPublishState.options) {
      for (const surface of AGENT_SURFACES) {
        expect(typeof visibleOnSurface({ publishState: state }, surface)).toBe("boolean");
      }
    }
    expect(new Set(Object.keys(PUBLISH_STATE_TRANSITIONS))).toEqual(
      new Set(A.AgentPublishState.options),
    );
  });

  it("已停用 is terminal, and 运行中 is reachable -- both halves of the state machine", () => {
    expect(PUBLISH_STATE_TRANSITIONS["已停用"]).toEqual([]);
    for (const state of A.AgentPublishState.options) {
      expect(canTransition("已停用", state)).toBe(false);
    }
    // Reverse: the machine is not "nothing transitions".
    expect(canTransition("草稿", "待审核")).toBe(true);
    expect(canTransition("待审核", "运行中")).toBe(true);
    expect(canTransition("待审核", "草稿")).toBe(true); // [退回]
    expect(canTransition("运行中", "已停用")).toBe(true);
    // ...and it does not permit the shortcut that I-28 exists to block.
    expect(canTransition("草稿", "运行中")).toBe(false);
  });

  it("forward: a disabled agent cannot be locked into a NEW project", () => {
    const v1 = freezeAgentVersion(agent(), {
      agentVersionId: "av-1",
      frozenAt: "2026-07-31T09:00:00.000Z",
    });
    const appended = appendAgentVersion(new Map() as AgentVersionCatalog, v1);
    if (!appended.ok) throw new Error("fixture");

    const attempt = lockAgentVersionsForProject("proj-new", [
      { agent: agent({ publishState: "已停用" }), catalog: appended.catalog },
    ]);
    expect(attempt).toEqual({
      ok: false,
      reason: "AGENT_DISABLED",
      agentId: "agt-source",
    });
    expect(A.operations.lockAgentVersionForProject.err).toContain("AGENT_DISABLED");
  });

  it("reverse: a project locked BEFORE the disable still resolves its snapshot afterwards", () => {
    const v1 = freezeAgentVersion(agent(), {
      agentVersionId: "av-1",
      frozenAt: "2026-07-31T09:00:00.000Z",
    });
    const appended = appendAgentVersion(new Map() as AgentVersionCatalog, v1);
    if (!appended.ok) throw new Error("fixture");

    const locked = lockAgentVersionsForProject("proj-running", [
      { agent: agent({ publishState: "运行中" }), catalog: appended.catalog },
    ]);
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;

    // The agent is disabled AFTER kickoff. The catalog is untouched -- disabling an agent
    // does not retract its published versions.
    const disabled = agent({ publishState: "已停用" });
    expect(isLoadable(disabled)).toBe(false); // the pool really did lose it

    const still = resolveLockedAgentVersion(locked.locks, appended.catalog, {
      projectId: "proj-running",
      agentId: "agt-source",
    });
    expect(still).toEqual(v1);
    expect(still?.definition.role).toBe("访谈引导与纪要");
  });

  it("AGENT_DISABLED is the contract's own code, not a private string", () => {
    expect(A.AgentRuntimeError.safeParse("AGENT_DISABLED").success).toBe(true);
    expect(A.AgentRuntimeError.safeParse("AGENT_RETIRED").success).toBe(false);
  });
});
