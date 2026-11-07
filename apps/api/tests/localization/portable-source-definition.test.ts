import { describe, expect, it } from "vitest";
import { agentRole } from "@repo/contracts";
import { sourceDefinitionDigest, legacyEquivalentDigest, starterAgentDisplayDefaults } from "../../src/domain/localization/portable-pack";
import { skillV1, skillV2, agentV1, agentV2, officialV1, officialV2 } from "./portable-pack-fixture";

describe("portable source definitions for metadata-only imports", () => {
  it("ignores translated copy and package release coordinates, preserving source snapshots", () => {
    const first = skillV2("First"), second = { ...skillV2("Second"), packVersion: "2.1.0" };
    const before = structuredClone(first);
    expect(sourceDefinitionDigest({ kind: "skill", pack: first })).toBe(sourceDefinitionDigest({ kind: "skill", pack: second }));
    expect(first).toEqual(before);
    expect(sourceDefinitionDigest({ kind: "agent", pack: agentV2("First") })).toBe(sourceDefinitionDigest({ kind: "agent", pack: agentV2("Second") }));
  });
  it("normalizes JSONB key order and file transport order, without normalizing execution values", () => {
    const original = skillV2();
    const reordered = structuredClone(original);
    reordered.skills[0]!.manifest = { entrypoint: "SKILL.md", description: "Original summary" };
    expect(sourceDefinitionDigest({ kind: "skill", pack: original })).toBe(sourceDefinitionDigest({ kind: "skill", pack: reordered }));
    reordered.skills[0]!.name = "Changed original";
    expect(sourceDefinitionDigest({ kind: "skill", pack: original })).not.toBe(sourceDefinitionDigest({ kind: "skill", pack: reordered }));
  });
  it("distinguishes changed source file digests, Agent runtime fields and frozen role configuration", () => {
    const first = skillV2(), changed = structuredClone(first);
    changed.skills[0]!.files[0]!.digest = "b".repeat(64);
    expect(sourceDefinitionDigest({ kind: "skill", pack: first })).not.toBe(sourceDefinitionDigest({ kind: "skill", pack: changed }));
    const original = agentV2(), differentModel = structuredClone(original);
    differentModel.agents[0]!.modelId = "another-configured-model";
    expect(sourceDefinitionDigest({ kind: "agent", pack: original })).not.toBe(sourceDefinitionDigest({ kind: "agent", pack: differentModel }));
    const { catalogSource: _source, ...role } = agentRole.AGENT_ROLE_FIELD_DEFAULTS;
    const differentRole = structuredClone(original);
    differentRole.agents[0]!.role = { ...role, workflowAllowlist: ["W001"] };
    expect(sourceDefinitionDigest({ kind: "agent", pack: original })).not.toBe(sourceDefinitionDigest({ kind: "agent", pack: differentRole }));
  });
  it("can prove an unchanged v1 base against its recorded whole-package digest", () => {
    expect(legacyEquivalentDigest({ kind: "skill", pack: skillV2() }, "1.0.0")).toBe(skillV1().packDigest);
    expect(legacyEquivalentDigest({ kind: "agent", pack: agentV2() }, "1.0.0")).toBe(agentV1().packDigest);
    expect(legacyEquivalentDigest({ kind: "official-agent", pack: officialV2() }, "1.0.0")).toBe(officialV1().packDigest);
    const changed = skillV2(); changed.skills[0]!.name = "Changed source";
    expect(legacyEquivalentDigest({ kind: "skill", pack: changed }, "1.0.0")).not.toBe(skillV1().packDigest);
  });
  it("shares the historical ordinary/official display defaults with import persistence", () => {
    expect(starterAgentDisplayDefaults(agentV1().agents[0]!)).toMatchObject({ roleLabel: "portable", duty: "Original agent" });
    expect(starterAgentDisplayDefaults(officialV1().agents[0]!)).toMatchObject({ roleLabel: "Original label", duty: "Original label" });
  });
});

it("keeps export package identities distinct at the maximum source name length", async () => {
  const { portableExportPackId } = await import("../../src/domain/localization/portable-pack");
  const a = "a".repeat(127) + "b", b = "a".repeat(127) + "c";
  expect(portableExportPackId(a)).toHaveLength(128);
  expect(portableExportPackId(a)).not.toBe(portableExportPackId(b));
  expect(portableExportPackId("short")).toBe("export-short");
});
