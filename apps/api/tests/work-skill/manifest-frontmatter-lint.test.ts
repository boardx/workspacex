import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseWorkSkillManifest } from "../../src/domain/skill/work-skill-manifest";

const API_ROOT = resolve(__dirname, "../..");
const SCRIPT = join(API_ROOT, "scripts/lint-work-skill-manifests.ts");
const TSX = join(API_ROOT, "node_modules/.bin/tsx");

const work = (overrides: Record<string, string | null> = {}): string => {
  const fields: Record<string, string> = {
    stableId: "    stableId: S003",
    domain: "    domain: Shared",
    riskClass: "    riskClass: low",
    dependencies: "    dependencies:\n      required: [knowledge.search]\n      optional: [crm.read]",
    provenance:
      "    provenance:\n      - repo: github.com/example/skills\n        path: skills/search/SKILL.md\n        commit: 0123456789abcdef0123456789abcdef01234567\n        license: Apache-2.0\n        strategy: adapt\n        copied: false",
    locales: "    locales: [zh-CN, en]",
    jurisdictions: "    jurisdictions: [CN]",
    evalSuiteId: "    evalSuiteId: S003",
    inputSchema: "    inputSchema: { type: object }",
    outputSchema: "    outputSchema: { type: object }",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete fields[key];
    else fields[key] = value;
  }
  return `---\nname: search-brief\ndescription: demo\nmetadata:\n  work:\n${Object.values(fields).join("\n")}\n---\n\n# Body\n`;
};

const tmpRoots: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ws01-lint-"));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}
afterAll(() => tmpRoots.forEach(r => rmSync(r, { recursive: true, force: true })));

function runLint(...roots: string[]) {
  const r = spawnSync(TSX, [SCRIPT, ...roots], { cwd: API_ROOT, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("parseWorkSkillManifest (WS01 UC-1)", () => {
  it("treats a skill without metadata.work as absent (A1)", () => {
    expect(parseWorkSkillManifest("a/SKILL.md", "---\nname: plain\nversion: 1.0.0\n---\n").kind).toBe("absent");
    expect(parseWorkSkillManifest("a/SKILL.md", "# no frontmatter").kind).toBe("absent");
  });

  it("parses a complete manifest", () => {
    const r = parseWorkSkillManifest("a/SKILL.md", work());
    expect(r.kind).toBe("valid");
    if (r.kind === "valid") expect(r.manifest.dependencies.required).toEqual(["knowledge.search"]);
  });

  it("reports file and field path for a missing field", () => {
    const r = parseWorkSkillManifest("x/SKILL.md", work({ riskClass: null }));
    expect(r).toMatchObject({ kind: "invalid", issues: [{ file: "x/SKILL.md", fieldPath: "metadata.work.riskClass" }] });
  });
});

describe("lint-work-skill-manifests CLI (WS01)", () => {
  it("passes on the repository skills/ tree", () => {
    const r = runLint();
    expect(r.out).toContain("lint-work-skill-manifests:");
    expect(r.code).toBe(0);
  });

  it("passes on a valid Work Skill and skips plain skills", () => {
    const root = fixture({ "good/SKILL.md": work(), "plain/SKILL.md": "---\nname: plain\n---\n" });
    const r = runLint(root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("1/1");
  });

  it("exits non-zero with file + field path when riskClass is removed (V4)", () => {
    const root = fixture({ "s003/SKILL.md": work({ riskClass: null }) });
    const r = runLint(root);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/s003\/SKILL\.md: metadata\.work\.riskClass: /);
  });

  it("exits non-zero on a wrong type", () => {
    const r = runLint(fixture({ "t/SKILL.md": work({ riskClass: "    riskClass: extreme", locales: "    locales: zh-CN" }) }));
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("metadata.work.riskClass");
    expect(r.out).toContain("metadata.work.locales");
  });

  it("exits non-zero when a dependency is a vendor name", () => {
    const r = runLint(fixture({ "v/SKILL.md": work({ dependencies: "    dependencies:\n      required: [Salesforce]\n      optional: []" }) }));
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/v\/SKILL\.md: metadata\.work\.dependencies\.required\.0: /);
  });

  it("exits non-zero when copied provenance has no notice (E8)", () => {
    const r = runLint(
      fixture({
        "p/SKILL.md": work({
          provenance:
            "    provenance:\n      - repo: r\n        path: p\n        commit: 0123456789abcdef0123456789abcdef01234567\n        license: MIT\n        strategy: copy\n        copied: true",
        }),
      }),
    );
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("metadata.work.provenance.0.notice");
  });
});
