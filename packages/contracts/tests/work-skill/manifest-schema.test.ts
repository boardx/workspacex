import { describe, expect, it } from "vitest";
import { CapabilityCategory, WorkSkillManifest } from "../../src/work-skill-meta";

const valid = {
  stableId: "S003",
  domain: "Shared",
  riskClass: "low",
  dependencies: { required: ["knowledge.search"], optional: ["crm.read"] },
  provenance: [
    {
      repo: "github.com/example/skills",
      path: "skills/search/SKILL.md",
      commit: "0123456789abcdef0123456789abcdef01234567",
      license: "Apache-2.0",
      strategy: "adapt",
      copied: false,
    },
  ],
  locales: ["zh-CN", "en"],
  jurisdictions: ["CN"],
  evalSuiteId: "S003",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
};

const paths = (input: unknown): string[] => {
  const r = WorkSkillManifest.safeParse(input);
  return r.success ? [] : r.error.issues.map(i => i.path.join("."));
};

describe("WorkSkillManifest (WS01)", () => {
  it("accepts a complete manifest", () => {
    expect(WorkSkillManifest.parse(valid).stableId).toBe("S003");
  });

  it.each(["stableId", "domain", "riskClass", "dependencies", "provenance", "locales", "jurisdictions", "evalSuiteId", "inputSchema", "outputSchema"])(
    "rejects missing %s with its field path",
    field => {
      const { [field as keyof typeof valid]: _drop, ...rest } = valid;
      expect(paths(rest)).toContain(field);
    },
  );

  it("rejects wrong types", () => {
    expect(paths({ ...valid, riskClass: "extreme" })).toEqual(["riskClass"]);
    expect(paths({ ...valid, stableId: 3 })).toEqual(["stableId"]);
    expect(paths({ ...valid, locales: "zh-CN" })).toEqual(["locales"]);
  });

  it("rejects vendor names as dependencies", () => {
    for (const vendor of ["Salesforce", "salesforce", "https://api.hubspot.com", "google/drive", "Notion API"]) {
      expect(CapabilityCategory.safeParse(vendor).success).toBe(false);
    }
    expect(paths({ ...valid, dependencies: { required: ["Salesforce"], optional: [] } })).toEqual(["dependencies.required.0"]);
  });

  it("rejects a category that is both required and optional", () => {
    expect(WorkSkillManifest.safeParse({ ...valid, dependencies: { required: ["crm.read"], optional: ["crm.read"] } }).success).toBe(false);
  });

  it("requires notice when provenance is copied (E8) and a license", () => {
    expect(paths({ ...valid, provenance: [{ ...valid.provenance[0], copied: true, strategy: "copy" }] })).toEqual(["provenance.0.notice"]);
    const { license: _l, ...noLicense } = valid.provenance[0]!;
    expect(paths({ ...valid, provenance: [noLicense] })).toEqual(["provenance.0.license"]);
  });

  it("rejects channel in the manifest (channel lives on the catalog row)", () => {
    expect(WorkSkillManifest.safeParse({ ...valid, channel: "verified" }).success).toBe(false);
  });
});
