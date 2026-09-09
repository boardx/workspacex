import { describe, expect, it } from "vitest";
import { operations, SkillFileSnapshot } from "../src/skill-file-edit";
const put = { kind: "put", path: "references/guide.md", contentBase64: "YWJj", mediaType: "text/markdown" };
const input = { skillId: "skill-1", expectedVersionId: "version-1", mutations: [put] };
describe("atomic published Skill file editing", () => {
  it("requires exact baseline and canonical bounded file mutations", () => {
    expect(operations.saveSkillFiles.in.safeParse(input).success).toBe(true);
    expect(operations.saveSkillFiles.in.safeParse({ ...input, expectedVersionId: undefined }).success).toBe(false);
    for (const path of ["../SKILL.md", "/etc/a", "a\\b", "a/./b", "a//b", "a/", "C:a"]) {
      expect(operations.saveSkillFiles.in.safeParse({ ...input, mutations: [{ ...put, path }] }).success).toBe(false);
    }
    expect(operations.saveSkillFiles.in.safeParse({ ...input, mutations: [{ ...put, contentBase64: "YQ=" }] }).success).toBe(false);
  });
  it("protects root and rejects overlapping edits, caller authority and empty changes", () => {
    for (const mutations of [[], [{ kind: "delete", path: "SKILL.md" }], [{ kind: "rename", from: "SKILL.md", to: "x.md" }],
      [{ kind: "rename", from: "x.md", to: "SKILL.md" }], [put, put], [put, { kind: "delete", path: put.path }],
      [{ kind: "rename", from: "a.md", to: "b.md" }, { kind: "rename", from: "b.md", to: "a.md" }]]) {
      expect(operations.saveSkillFiles.in.safeParse({ ...input, mutations }).success).toBe(false);
    }
    expect(operations.saveSkillFiles.in.safeParse({ ...input, actorId: "fake" }).success).toBe(false);
    expect(operations.saveSkillFiles.in.safeParse({ ...input, mutations: [{ ...put, digest: "a".repeat(64) }] }).success).toBe(false);
  });
  it("reads a pinned complete snapshot and validates manifest sizes/paths", () => {
    const file = { path: "SKILL.md", contentBase64: "YWJj", mediaType: "text/markdown", digest: "a".repeat(64), sizeBytes: 3 };
    const snapshot = { skillId: "skill-1", versionId: "version-1", semanticLabel: "v1", contentDigest: "b".repeat(64), createdAt: "2026-09-09T19:00:00Z", readOnly: false, files: [file] };
    expect(SkillFileSnapshot.safeParse(snapshot).success).toBe(true);
    expect(SkillFileSnapshot.safeParse({ ...snapshot, files: [{ ...file, sizeBytes: 4 }] }).success).toBe(false);
    expect(SkillFileSnapshot.safeParse({ ...snapshot, files: [file, file] }).success).toBe(false);
    expect(SkillFileSnapshot.safeParse({ ...snapshot, files: [{ ...file, path: "x.md" }] }).success).toBe(false);
    expect(operations.getSkillFileSnapshot.in.safeParse({ skillId: "skill-1", versionId: "version-1" }).success).toBe(true);
    expect(operations.getSkillFileSnapshot.in.safeParse({ skillId: "skill-1" }).success).toBe(false);
  });
});
