import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GitHub stopped supporting the Node.js 20 JavaScript action runtime in 2026.
 * Keep this catalogue explicit: adding or changing an external action requires
 * checking its official action.yml `runs.using` value before updating the pin.
 */
const ROOT = join(import.meta.dirname, "..", "..");
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

const NODE24_ACTIONS = new Map<string, string>([
  ["actions/checkout", "v5"],
  ["actions/setup-node", "v5"],
  ["actions/upload-artifact", "v6"],
  ["astral-sh/setup-uv", "v7.0.0"],
  ["pnpm/action-setup", "v4.4.0"],
]);

function workflowSources(directory = WORKFLOW_DIR, prefix = ""): Array<{ file: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = join(prefix, entry.name);
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) return workflowSources(absolutePath, relativePath);
      if (
        !entry.name.endsWith(".yml") &&
        !entry.name.endsWith(".yaml") &&
        !entry.name.endsWith(".yml.example")
      ) {
        return [];
      }
      return [{ file: relativePath, source: readFileSync(absolutePath, "utf8") }];
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

function externalActionUses(source: string): string[] {
  return [...source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)]
    .map((match) => match[1]!)
    .filter((use) => !use.startsWith("./") && !use.startsWith("docker://"));
}

describe("GitHub workflow JavaScript actions use audited Node.js 24 releases", () => {
  it("pins every external action to the audited release", () => {
    const seen = new Set<string>();

    for (const { file, source } of workflowSources()) {
      for (const use of externalActionUses(source)) {
        const separator = use.lastIndexOf("@");
        expect(separator, `${file}: malformed action reference ${use}`).toBeGreaterThan(0);
        const action = use.slice(0, separator);
        const actualRef = use.slice(separator + 1);
        const expectedRef = NODE24_ACTIONS.get(action);

        expect(
          expectedRef,
          `${file}: ${action} has not been audited for its declared runs.using runtime`,
        ).toBeDefined();
        expect(actualRef, `${file}: ${action} must use its audited Node.js 24 release`).toBe(
          expectedRef,
        );
        seen.add(action);
      }
    }

    expect(seen).toEqual(new Set(NODE24_ACTIONS.keys()));
  });
});
