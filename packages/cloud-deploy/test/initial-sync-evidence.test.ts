import { describe, expect, it } from "vitest";
import { generateInitialSyncEvidence, type EvidenceQuery } from "../src/initial-sync-evidence";

const digest = "a".repeat(64);
const inventory = { schemaVersion: 1 as const, bucket: "workspacex-cn", prefix: "objects/prod", objects: [{ key: "a/file.txt", size: 4, sha256: digest }] };
const input = { sourceSnapshot: "0/16B6C50", sourceOssInventory: inventory, targetOssInventory: inventory,
  secretCiphertextsDetected: true, keyDecision: "rotated" as const };

function fixture(options: { targetCount?: number; targetDigest?: string; orphanCount?: number; validated?: boolean; brokenSkillVersion?: boolean } = {}): EvidenceQuery {
  return async (side, sql) => {
    if (sql.includes("FROM pg_class c")) return `${JSON.stringify({ schema: "public", table: "children", primaryKey: ["id"] })}\n`;
    if (sql.includes("FROM pg_constraint co")) return `${JSON.stringify({ schema: "public", table: "children", name: "children_parent_fk",
      validated: options.validated ?? true, columns: ["parent_id"], referencedSchema: "public", referencedTable: "parents", referencedColumns: ["id"] })}\n`;
    if (sql.includes("FROM public.skill_contracts")) return String(side === "target" && options.brokenSkillVersion ? 1 : 0);
    if (sql.startsWith("SELECT count(*) FROM")) return String(side === "target" ? options.orphanCount ?? 0 : 0);
    return `${JSON.stringify({ count: side === "target" ? options.targetCount ?? 2 : 2,
      primaryKeyMd5: side === "target" ? options.targetDigest ?? "b".repeat(32) : "b".repeat(32) })}\n`;
  };
}

describe("initial sync acceptance evidence", () => {
  it("sets gates from matching database and object evidence", async () => {
    const result = await generateInitialSyncEvidence(input, fixture());
    expect(result).toMatchObject({ databaseRestored: true, foreignKeysValid: true, criticalReferencesValid: true, ossInventoryVerified: true });
    expect(result.evidence.target.foreignKeysChecked).toBe(1);
  });

  it("does not claim success for mismatched rows, orphaned references, or objects", async () => {
    const targetOssInventory = { ...inventory, objects: [{ ...inventory.objects[0]!, size: 5 }] };
    const result = await generateInitialSyncEvidence({ ...input, targetOssInventory }, fixture({ targetCount: 3, orphanCount: 1 }));
    expect(result).toMatchObject({ databaseRestored: false, foreignKeysValid: false, criticalReferencesValid: false, ossInventoryVerified: false });
    expect(result.evidence.target.orphanedForeignKeys).toEqual(["public.children.children_parent_fk"]);
  });

  it("rejects an unvalidated foreign key even when no orphan is currently visible", async () => {
    const result = await generateInitialSyncEvidence(input, fixture({ validated: false }));
    expect(result.foreignKeysValid).toBe(false);
    expect(result.evidence.target.invalidForeignKeys).toEqual(["public.children.children_parent_fk"]);
  });

  it("does not infer a valid current Skill version from unrelated foreign keys", async () => {
    const result = await generateInitialSyncEvidence(input, fixture({ brokenSkillVersion: true }));
    expect(result.foreignKeysValid).toBe(true);
    expect(result.criticalReferencesValid).toBe(false);
    expect(result.evidence.target.criticalReferenceFailures).toEqual(["skill_contracts.current_version_id"]);
  });
});
