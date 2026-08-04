import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { generatePersistentClaudeMd, generatePersistentCodexToml } from "./gen-subagents";
import { REPO_ROOT } from "./lib/paths";

const ROLE_IDS = [
  "coord-main",
  "coord-architecture",
  "dev-chat-e2e",
  "dev-ai-runtime",
  "rev-feature",
  "rev-e2e",
] as const;

const BOUNDED_SUBAGENTS = [
  "code-reviewer",
  "codebase-researcher",
  "e2e-verifier",
  "feature-evaluator",
  "quality-auditor",
  "requirement-author",
  "test-runner",
  "ui-prototyper",
] as const;

interface PersistentRoleSpec {
  name: string;
  description: string;
  role: "persistent-project-role";
  kind: string;
  areas: string[];
  reports_to: string | null;
  merge_authority: boolean;
  dispatch_authority: boolean;
  developer_instructions: string;
}

const rolesDir = join(REPO_ROOT, ".harness", "agents", "roles");
const claudeDir = join(REPO_ROOT, ".claude", "agents");
const codexDir = join(REPO_ROOT, ".codex", "agents");

function readRole(roleId: string): { raw: string; spec: PersistentRoleSpec } {
  const raw = readFileSync(join(rolesDir, `${roleId}.yaml`), "utf8");
  return { raw, spec: parse(raw) as PersistentRoleSpec };
}

function generated(roleId: string): { claude: string; codex: string } {
  return {
    claude: readFileSync(join(claudeDir, `${roleId}.md`), "utf8"),
    codex: readFileSync(join(codexDir, `${roleId}.toml`), "utf8"),
  };
}

function forbiddenRuntimeMaterial(text: string): string[] {
  return [
    ...text.matchAll(/agt_[0-9A-HJKMNP-TV-Z]{26}/g),
    ...text.matchAll(/(?:token|private[_ -]?key)\s*[:=]\s*["']?[^\s"']+/gi),
  ].map((match) => match[0]);
}

describe("#441 portable persistent role generator", () => {
  it("defines exactly the six signed stable roles in the dedicated neutral source", () => {
    expect(readdirSync(rolesDir).filter((file) => file.endsWith(".yaml")).sort()).toEqual(
      ROLE_IDS.map((roleId) => `${roleId}.yaml`).sort(),
    );

    for (const roleId of ROLE_IDS) {
      const { spec } = readRole(roleId);
      expect(spec).toMatchObject({
        name: roleId,
        role: "persistent-project-role",
        merge_authority: roleId === "coord-main",
        dispatch_authority: ["coord-main", "coord-architecture"].includes(roleId),
      });
      expect(spec.description.trim()).not.toBe("");
      expect(spec.developer_instructions.trim()).not.toBe("");
      expect(spec.developer_instructions).not.toMatch(/(?:允许|不得)合并 PR|(?:可以|不得)派发/);
      expect(spec.areas.length).toBeGreaterThan(0);
      expect(Object.hasOwn(spec, "model")).toBe(false);
      expect(Object.hasOwn(spec, "directory_agent_id")).toBe(false);
    }
  });

  it("generates current Claude frontmatter and current top-level Codex fields from every role", () => {
    for (const roleId of ROLE_IDS) {
      const { spec } = readRole(roleId);
      const output = generated(roleId);

      expect(output.claude).toMatch(new RegExp(`^---\\nname: ${roleId}\\n`));
      expect(output.claude).toContain(`description: ${spec.description.trim().replace(/\n/g, " ")}`);
      expect(output.claude).toContain(spec.developer_instructions.trim());
      expect(output.claude).not.toMatch(/^model:/m);

      expect(output.codex).toMatch(new RegExp(`^name = "${roleId}"\\n`));
      expect(output.codex).toContain("\ndescription = \"\"\"\n");
      expect(output.codex).toContain("\ndeveloper_instructions = \"\"\"\n");
      expect(output.codex).toContain(spec.developer_instructions.trim());
      expect(output.codex).not.toContain("[agent]");
      expect(output.codex).not.toMatch(/^model\s*=/m);
    }
  });

  it("keeps runtime identity, credentials and model selection out of sources and outputs", () => {
    for (const roleId of ROLE_IDS) {
      const { raw } = readRole(roleId);
      const output = generated(roleId);
      const combined = `${raw}\n${output.claude}\n${output.codex}`;
      expect(forbiddenRuntimeMaterial(combined), roleId).toEqual([]);
      expect(combined).not.toMatch(/^\s*(?:model|claude_model|codex_model|directory_agent_id)\s*:/m);
    }
  });

  it("preserves all eight bounded subagents beside the new persistent role surfaces", () => {
    const claudeNames = new Set(readdirSync(claudeDir).filter((file) => file.endsWith(".md")));
    const codexNames = new Set(readdirSync(codexDir).filter((file) => file.endsWith(".toml")));

    for (const name of BOUNDED_SUBAGENTS) {
      expect(claudeNames.has(`${name}.md`), name).toBe(true);
      expect(codexNames.has(`${name}.toml`), name).toBe(true);
      expect(readFileSync(join(codexDir, `${name}.toml`), "utf8")).toContain("[agent]");
    }
  });

  it("matches both tracked surfaces to deterministic pure generation", () => {
    for (const roleId of ROLE_IDS) {
      const { spec } = readRole(roleId);
      const output = generated(roleId);
      expect(generatePersistentClaudeMd(spec), roleId).toBe(output.claude);
      expect(generatePersistentCodexToml(spec), roleId).toBe(output.codex);
      expect(generatePersistentClaudeMd(spec), roleId).toBe(generatePersistentClaudeMd(spec));
      expect(generatePersistentCodexToml(spec), roleId).toBe(generatePersistentCodexToml(spec));
    }
  });

  it("keeps merge and dispatch authority least-privileged in source and generated prompts", () => {
    for (const roleId of ROLE_IDS) {
      const { spec } = readRole(roleId);
      const output = generated(roleId);
      const combinedPrompt = `${spec.developer_instructions}\n${output.claude}\n${output.codex}`;

      if (roleId === "coord-main") expect(combinedPrompt).toContain("唯一允许合并 PR");
      else expect(combinedPrompt).toContain("不得合并 PR");

      if (["coord-main", "coord-architecture"].includes(roleId)) {
        expect(combinedPrompt).toContain("可以派发");
      } else {
        expect(combinedPrompt).toContain("不得派发");
      }
    }
  });
});
