import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { standardCapabilitiesSchema } from "../scripts/standard-capabilities-schema";
import { TrustedMemoryScope, CanonicalBase64, SKILL_PACKAGE_LIMITS, StandardCapabilityDescriptor, TrustedSkillPackage } from "../src/standard-capabilities";

const file = (path: string) => ({ path, contentBase64: "aGk=", mediaType: "text/plain", digest: "a".repeat(64) });
const pkg = (paths: string[]) => ({ skillId: "s1", versionId: "v1", files: paths.map(file) });

describe("trusted skill package contract", () => {
  it("keeps the Python transport schema mechanically identical", () => {
    expect(readFileSync(resolve(import.meta.dirname, "../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_capabilities_schema.json"), "utf8")).toBe(standardCapabilitiesSchema());
  });
  it("accepts an 8 MiB binary file without regexp stack overflow and rejects excess", () => {
    const value = pkg(["SKILL.md"]);
    value.files[0]!.contentBase64 = Buffer.alloc(SKILL_PACKAGE_LIMITS.maxFileBytes).toString("base64");
    expect(TrustedSkillPackage.safeParse(value).success).toBe(true);
    value.files[0]!.contentBase64 = Buffer.alloc(SKILL_PACKAGE_LIMITS.maxFileBytes + 1).toString("base64");
    expect(TrustedSkillPackage.safeParse(value).success).toBe(false);
  });
  it.each(["A", "AAA", "Zh==", "Zm9=", "===="])("rejects noncanonical base64 %s", (value) => {
    expect(CanonicalBase64.safeParse(value).success).toBe(false);
  });
  it("preserves an immutable multi-file package including binary assets", () => {
    const value = pkg(["SKILL.md", "scripts/run.py", "assets/image.png"]);
    value.files[2]!.contentBase64 = "/wAB";
    expect(TrustedSkillPackage.parse(value)).toEqual(value);
  });
  it.each(["/etc/passwd", "../secret", "scripts/../../secret", "a\\b", "a//b", "a/./b", "C:/secret", "a\u0000b"])("rejects unsafe path %s", (path) => {
    expect(TrustedSkillPackage.safeParse(pkg(["SKILL.md", path])).success).toBe(false);
  });
  it("requires the entry point and unique file paths", () => {
    expect(TrustedSkillPackage.safeParse(pkg(["README.md"])).success).toBe(false);
    expect(TrustedSkillPackage.safeParse(pkg(["SKILL.md", "SKILL.md"])).success).toBe(false);
  });
  it("rejects invalid encoding and untrusted extra authority", () => {
    const value = pkg(["SKILL.md"]);
    value.files[0]!.contentBase64 = "%%%";
    expect(TrustedSkillPackage.safeParse(value).success).toBe(false);
    expect(TrustedSkillPackage.safeParse({ ...pkg(["SKILL.md"]), orgId: "other-org" }).success).toBe(false);
  });
  it("requires an immutable source revision rather than a branch", () => {
    const value = { id: "WX-T001", kind: "tool", canonicalName: "ls", specVersion: "1.0.0", source: { kind: "langchain-native", locator: "deepagents", revision: "0.7.6", license: "MIT" } };
    expect(StandardCapabilityDescriptor.safeParse(value).success).toBe(true);
    expect(StandardCapabilityDescriptor.safeParse({ ...value, source: { ...value.source, revision: "main" } }).success).toBe(false);
    for (const revision of ["develop", "refs/heads/main", " main", "HEAD~1"]) {
      expect(StandardCapabilityDescriptor.safeParse({ ...value, source: { ...value.source, revision } }).success).toBe(false);
    }
  });
});

 it("validates trusted memory identity without anonymous or extra fields", () => {
   expect(TrustedMemoryScope.safeParse({ orgId: "org", userId: "user" }).success).toBe(true);
   for (const value of [{ orgId: "org", userId: " " }, { orgId: "", userId: "u" }, { orgId: "org", userId: "u", role: "admin" }])
     expect(TrustedMemoryScope.safeParse(value).success).toBe(false);
 });
