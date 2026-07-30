import { describe, expect, it } from "vitest";
import {
  appendAgentVersion,
  freezeAgentVersion,
  headVersionOf,
  lockAgentVersionsForProject,
  resolveLockedAgentVersion,
  type AgentVersionCatalog,
} from "../../../src/domain/agent/version-snapshot";
import { agent } from "./fixtures";

/**
 * F55 / I-31 / O-22⑤ / D-30 -- 版本快照不可变，且项目开工锁版本。
 *
 * ## Both directions
 *
 *   forward   after the project locks, publishing a NEW version of the agent leaves the
 *             project resolving to the OLD snapshot, byte for byte
 *   reverse   the head DID move -- otherwise "the project still sees v1" is satisfied by a
 *             system where publishing does nothing at all, which is the shape this repo has
 *             recorded nine times
 *
 * The reverse half is the whole point: an assertion that two things are equal is worthless
 * unless something was actually changed in between.
 */

const FROZEN_AT_V1 = "2026-07-31T09:00:00.000Z";
const FROZEN_AT_V2 = "2026-07-31T11:00:00.000Z";

function publishedCatalog() {
  const v1 = freezeAgentVersion(agent(), { agentVersionId: "av-1", frozenAt: FROZEN_AT_V1 });
  const appended = appendAgentVersion(new Map() as AgentVersionCatalog, v1);
  if (!appended.ok) throw new Error("fixture: first publish must succeed");
  return { v1, catalog: appended.catalog };
}

describe("F55 I-31 -- AgentVersion 不可变 + 项目开工锁版本", () => {
  it("forward: after the upstream agent publishes a new version, the project still reads its locked snapshot", () => {
    const { v1, catalog } = publishedCatalog();

    const locked = lockAgentVersionsForProject("proj-1", [{ agent: agent(), catalog }]);
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(locked.locks).toEqual([
      { projectId: "proj-1", agentId: "agt-source", agentVersionId: "av-1" },
    ]);

    // Upstream moves: the role sentence is rewritten, the model swapped, a skill upgraded,
    // and the whitelist widened. All four are things a running project must not inherit.
    const changed = agent({
      role: "改写后的职责",
      modelId: "mdl-closed-api-7",
      skillMounts: [{ skillId: "skl-interview", skillVersion: 9 }],
      toolWhitelist: [
        ...agent().toolWhitelist,
        { toolFullName: "mcp:mailer.send", state: "已准", elevationDecision: null },
      ],
    });
    const v2 = freezeAgentVersion(changed, {
      agentVersionId: "av-2",
      frozenAt: FROZEN_AT_V2,
    });
    const after = appendAgentVersion(catalog, v2);
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    // REVERSE half: the head really did move. Without this the next assertion is vacuous.
    expect(headVersionOf(after.catalog, "agt-source")?.agentVersionId).toBe("av-2");
    expect(v2.definition.role).toBe("改写后的职责");

    // FORWARD half: the project resolves to v1 regardless.
    const resolved = resolveLockedAgentVersion(locked.locks, after.catalog, {
      projectId: "proj-1",
      agentId: "agt-source",
    });
    expect(resolved).toEqual(v1);
    expect(resolved?.agentVersionId).toBe("av-1");
    expect(resolved?.definition.role).toBe("访谈引导与纪要");
    expect(resolved?.definition.modelId).toBe("mdl-local-1");
    expect(resolved?.definition.skillMounts).toEqual([
      { skillId: "skl-interview", skillVersion: 3 },
    ]);
    // The widened whitelist did not reach the running project.
    expect(resolved?.definition.toolWhitelist.map((e) => e.toolFullName)).toEqual([
      "mcp:crm.searchAccount",
      "graph.readEntity",
    ]);
  });

  it("reverse: a project that locks AFTER the new publish gets v2 -- locking is not 'always the first version'", () => {
    const { catalog } = publishedCatalog();
    const v2 = freezeAgentVersion(agent({ role: "改写后的职责" }), {
      agentVersionId: "av-2",
      frozenAt: FROZEN_AT_V2,
    });
    const after = appendAgentVersion(catalog, v2);
    if (!after.ok) throw new Error("fixture");

    const locked = lockAgentVersionsForProject("proj-2", [
      { agent: agent(), catalog: after.catalog },
    ]);
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(locked.locks[0]?.agentVersionId).toBe("av-2");
  });

  it("a published snapshot is frozen: writes to it throw rather than silently landing", () => {
    const { v1 } = publishedCatalog();

    expect(() => {
      (v1 as { agentVersionId: string }).agentVersionId = "av-tampered";
    }).toThrow(TypeError);
    expect(() => {
      (v1.definition as { role: string }).role = "改写后的职责";
    }).toThrow(TypeError);
    // The arrays too -- freezing only the outer object leaves the whitelist widenable.
    expect(() => {
      (v1.definition.toolWhitelist as unknown as unknown[]).push({
        toolFullName: "mcp:mailer.send",
        state: "已准",
        elevationDecision: null,
      });
    }).toThrow(TypeError);
    expect(() => {
      (v1.definition.skillMounts as unknown as unknown[]).push({
        skillId: "skl-x",
        skillVersion: 1,
      });
    }).toThrow(TypeError);

    expect(v1.agentVersionId).toBe("av-1");
    expect(v1.definition.toolWhitelist.length).toBe(2);
  });

  it("a snapshot does not alias the live agent's arrays", () => {
    const live = agent();
    const snapshot = freezeAgentVersion(live, {
      agentVersionId: "av-alias",
      frozenAt: FROZEN_AT_V1,
    });
    expect(snapshot.definition.skillMounts).not.toBe(live.skillMounts);
    expect(snapshot.definition.toolWhitelist).not.toBe(live.toolWhitelist);
    // ...and freezing the snapshot did not freeze the live agent, which must stay editable.
    expect(Object.isFrozen(live.toolWhitelist)).toBe(false);
  });

  it("re-publishing an existing agentVersionId is refused, not overwritten", () => {
    const { v1, catalog } = publishedCatalog();
    const impostor = freezeAgentVersion(agent({ role: "改写后的职责" }), {
      agentVersionId: "av-1",
      frozenAt: FROZEN_AT_V2,
    });
    expect(appendAgentVersion(catalog, impostor)).toEqual({
      ok: false,
      reason: "VERSION_CHANGED",
    });
    expect(catalog.get("av-1")).toEqual(v1);
    expect(catalog.get("av-1")?.definition.role).toBe("访谈引导与纪要");
  });

  it("locking an agent with no published version is AGENT_NOT_FOUND", () => {
    const locked = lockAgentVersionsForProject("proj-3", [
      { agent: agent(), catalog: new Map() as AgentVersionCatalog },
    ]);
    expect(locked).toEqual({ ok: false, reason: "AGENT_NOT_FOUND", agentId: "agt-source" });
  });

  it("an unlocked (agent, project) pair resolves to null instead of falling back to the head", () => {
    // A `?? headVersionOf(...)` fallback would make every assertion above pass while the
    // lock did nothing. This is the case that would catch it.
    const { catalog } = publishedCatalog();
    expect(
      resolveLockedAgentVersion([], catalog, { projectId: "proj-9", agentId: "agt-source" }),
    ).toBeNull();
  });
});
