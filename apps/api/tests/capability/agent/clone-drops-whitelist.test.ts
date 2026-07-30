import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import {
  CLONE_INHERITED_FIELDS,
  CLONE_RESET_FIELDS,
  cloneAgentDefinition,
  newAgentDefinition,
} from "../../../src/domain/agent/clone";
import { checkWhitelistConfigured } from "../../../src/domain/agent/lifecycle";
import { agent } from "./fixtures";

/**
 * F55 / I-30 / O-22① -- 「复制一个现成的」 carries the definition and NOT the tool whitelist.
 *
 * ## Both directions, because either alone is passed by a broken implementation
 *
 *   forward   the clone's whitelist is empty, and it is therefore blocked from publishing
 *   reverse   the clone DID copy something -- an implementation that returns a blank agent
 *             satisfies every "whitelist is empty" assertion while copying nothing at all
 *
 * The reverse direction is also why `CLONE_INHERITED_FIELDS` is asserted field-by-field
 * rather than as "the clone has a name": one spot-checked field passes for an implementation
 * that copies exactly that field.
 */
describe("F55 I-30 -- 复制不继承工具白名单", () => {
  it("forward: the clone's tool whitelist is empty even though the source's is not", () => {
    const source = agent();
    expect(source.toolWhitelist.length).toBeGreaterThan(0); // the fixture is not vacuous

    const clone = cloneAgentDefinition(source, { agentId: "agt-clone" });

    expect(clone.toolWhitelist).toEqual([]);
    expect(clone.cloneFrom).toBe("agt-source");
    expect(clone.publishState).toBe("草稿");
  });

  it("forward: an empty whitelist blocks publication with the contract's own code", () => {
    const clone = cloneAgentDefinition(agent(), { agentId: "agt-clone" });

    const gate = checkWhitelistConfigured(clone);
    expect(gate).toEqual({ ok: false, reason: "TOOL_WHITELIST_EMPTY" });
    // The reason is a member of the bundle's failure enum, not a private string. If someone
    // renames it in the contract, this line -- not a code review -- is what notices.
    expect(A.AgentRuntimeError.safeParse("TOOL_WHITELIST_EMPTY").success).toBe(true);
    // ...and the gate is transported by the operation that actually refuses the publish.
    expect(A.operations.submitAgentForReview.err).toContain("TOOL_WHITELIST_EMPTY");
    expect(A.operations.decideAgentPublish.err).toContain("TOOL_WHITELIST_EMPTY");
  });

  it("reverse: everything on the inherited list IS carried across", () => {
    const source = agent({
      name: "Scout",
      initials: "SC",
      role: "桌面研究",
      visibility: "仅某组",
      modelId: "mdl-local-9",
      concurrencyLimit: 5,
      degradePolicy: "不降级",
      skillMounts: [
        { skillId: "skl-desk-research", skillVersion: 7 },
        { skillId: "skl-summary", skillVersion: 2 },
      ],
    });

    const clone = cloneAgentDefinition(source, { agentId: "agt-clone" });

    for (const field of CLONE_INHERITED_FIELDS) {
      expect({ field, value: clone[field] }).toEqual({ field, value: source[field] });
    }
    // Named explicitly as well: a loop over a list that someone could empty is not on its own
    // proof that the interesting fields travel.
    expect(clone.skillMounts).toEqual(source.skillMounts);
    expect(clone.visibility).toBe("仅某组");
  });

  it("reverse: a whitelist that is re-configured after cloning lifts the gate", () => {
    // Without this case, "publication is blocked" is satisfied by an agent that can NEVER be
    // published -- the gate would be a wall rather than a gate.
    const clone = cloneAgentDefinition(agent(), { agentId: "agt-clone" });
    const reconfigured = {
      ...clone,
      toolWhitelist: [
        { toolFullName: "graph.readEntity", state: "已准" as const, elevationDecision: null },
      ],
    };
    expect(checkWhitelistConfigured(reconfigured)).toEqual({ ok: true });
  });

  it("skill mounts are copied by value, so mutating the source cannot reach the clone", () => {
    const source = agent();
    const clone = cloneAgentDefinition(source, { agentId: "agt-clone" });
    expect(clone.skillMounts).not.toBe(source.skillMounts);
  });

  it("the reset list and the inherited list partition the definition and do not overlap", () => {
    // The compile-time totality check in clone.ts cannot be observed from a test, so the
    // runtime consequence is asserted instead: every key of a produced clone is classified.
    const clone = cloneAgentDefinition(agent(), { agentId: "agt-clone" });
    const classified = new Set<string>([...CLONE_INHERITED_FIELDS, ...CLONE_RESET_FIELDS]);
    for (const key of Object.keys(clone)) expect(classified.has(key)).toBe(true);
    expect(Object.keys(clone).length).toBe(classified.size);

    const overlap = CLONE_INHERITED_FIELDS.filter((f) =>
      (CLONE_RESET_FIELDS as readonly string[]).includes(f),
    );
    expect(overlap).toEqual([]);
  });

  it("从零新建 also starts with an empty whitelist and a null cloneFrom", () => {
    const fresh = newAgentDefinition({
      agentId: "agt-new",
      orgId: "org-1",
      name: "Echo",
      initials: "EC",
      role: "会议纪要",
      visibility: "全组织可用",
      source: "self",
      modelId: null,
      skillMounts: [],
      concurrencyLimit: 1,
      degradePolicy: "跟随组织级",
    });
    expect(fresh.cloneFrom).toBeNull();
    expect(fresh.toolWhitelist).toEqual([]);
    expect(checkWhitelistConfigured(fresh)).toEqual({ ok: false, reason: "TOOL_WHITELIST_EMPTY" });
  });
});
