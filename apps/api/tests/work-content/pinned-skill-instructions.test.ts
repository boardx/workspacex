import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { ModelContentSkillRunner } from "../../src/application/work-content/content-skill-runner";
import type { ModelCallPort } from "../../src/application/agent-run/ports";

const call = {
  orgId: "org-pinned", instanceId: "instance-pinned", agentVersionId: "agent-v1",
  workflowId: "W029", stageId: "frame", skillId: "S064", skillVersion: "1.0.0",
  input: { problem: "导入失败" }, prior: {},
};
const agents = { agentVersionModel: async () => ({ modelProvider: "dashscope", modelId: "qwen-plus" }) };

describe("workflow executes pinned Skill instructions", () => {
  it("loads only tenant-scoped executable definitions behind Workflow admission", () => {
    const root = resolve(__dirname, "../..");
    const source = readFileSync(join(root, "src/infrastructure/work-content/pg-content-skill-instructions.ts"), "utf8");
    const tables = [...source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/g)].map(m => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(["skill_catalog_entries", "skill_versions", "skill_version_files"]).toContain(table);
    expect(source).not.toMatch(/withoutTenant/);
    expect(source).toContain("withTenant(toOrgId(orgId)");
    expect(source).toContain("e.org_id = $1 AND e.stable_id = $2");
    expect(source).toContain("v.semantic_label = $3 AND v.published AND f.path = 'SKILL.md'");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
      const path = join(dir, n);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
    });
    expect(walk(join(root, "src/interface")).filter(p => readFileSync(p, "utf8").includes("pg-content-skill-instructions"))).toEqual([]);
  });

  it("uses the authored procedure, rather than inferring a Skill from its ID", async () => {
    const procedure = "Use the five-whys method and return the marker PINNED_S064_V1.";
    const reads: unknown[] = [];
    const skills = { skillInstructions: async (...args: string[]) => { reads.push(args); return procedure; } };
    const model = { complete: async ({ system }: { system: string }) => ({
      text: JSON.stringify({ procedureUsed: system.includes(procedure) ? "PINNED_S064_V1" : "generic-answer" }),
    }) } as unknown as ModelCallPort;
    const runner = new ModelContentSkillRunner(model, agents, skills);
    expect(await runner.run(call)).toEqual({ procedureUsed: "PINNED_S064_V1" });
    expect(reads).toEqual([[call.orgId, call.skillId, call.skillVersion]]);
  });

  it("fails before any model call when the pinned version has no instructions", async () => {
    let calls = 0;
    const model = { complete: async () => { calls++; return { text: "{}" }; } } as unknown as ModelCallPort;
    for (const body of [null, "", "   "]) {
      const runner = new ModelContentSkillRunner(model, agents, { skillInstructions: async () => body });
      await expect(runner.run(call)).rejects.toMatchObject({
        code: "CONTENT_SKILL_INSTRUCTIONS_MISSING", reason: "skill_instructions_missing", skillId: "S064",
      });
    }
    expect(calls).toBe(0);
  });
});
