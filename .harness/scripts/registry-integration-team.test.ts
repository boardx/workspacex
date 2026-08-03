import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";

interface RegistryEntry {
  id: string;
  active: boolean;
  kind: string;
  owner?: string;
  areas?: string[];
  reports_to?: string;
  directory_agent_id?: string;
  required_for?: string[];
  emits?: string;
}

interface Registry {
  agents: RegistryEntry[];
  reviewers: RegistryEntry[];
}

const registry = parse(
  readFileSync(join(REPO_ROOT, ".harness", "agents", "registry.yaml"), "utf8"),
) as Registry;

const workerIds = ["dev-platform-baseline", "dev-auth", "dev-ai-runtime", "dev-chat-e2e"];
const reviewerIds = ["rev-feature", "rev-e2e"];
const owner = "2325074+usamshen@users.noreply.github.com";

describe("#407 minimal integration team registry projection", () => {
  it("projects four Directory-backed identities as workers without review or merge authority", () => {
    for (const id of workerIds) {
      const entry = registry.agents.find((candidate) => candidate.id === id);
      expect(entry, id).toMatchObject({ active: true, kind: "worker", owner, reports_to: "coord-main" });
      expect(entry?.directory_agent_id, id).toMatch(/^agt_[0-9A-Z]+$/);
      expect(entry?.required_for, id).toBeUndefined();
      expect(entry?.emits, id).toBeUndefined();
    }
  });

  it("keeps reviewers in the reviewer route and preserves one coordinator", () => {
    for (const id of reviewerIds) {
      const entry = registry.reviewers.find((candidate) => candidate.id === id);
      expect(entry, id).toMatchObject({ active: true, kind: "reviewer", owner, reports_to: "coord-main" });
      expect(entry?.directory_agent_id, id).toMatch(/^agt_[0-9A-Z]+$/);
      expect(entry?.required_for?.length, id).toBeGreaterThan(0);
      expect(entry?.emits, id).toMatch(/^review:/);
    }

    const all = [...registry.agents, ...registry.reviewers];
    expect(all.filter((entry) => entry.kind === "coordinator").map((entry) => entry.id)).toEqual(["coord-main"]);
    expect(new Set(all.flatMap((entry) => entry.directory_agent_id ?? [])).size).toBe(6);
  });

  it("reuses exactly the eight neutral agent specs", () => {
    const specs = readdirSync(join(REPO_ROOT, ".harness", "agents"))
      .filter((file) => file.endsWith(".yaml") && file !== "registry.yaml")
      .sort();
    expect(specs).toEqual([
      "code-reviewer.yaml",
      "codebase-researcher.yaml",
      "e2e-verifier.yaml",
      "feature-evaluator.yaml",
      "quality-auditor.yaml",
      "requirement-author.yaml",
      "test-runner.yaml",
      "ui-prototyper.yaml",
    ]);
  });
});
