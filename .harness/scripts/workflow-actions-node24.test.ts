import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * GitHub stopped supporting the Node.js 20 JavaScript action runtime in 2026.
 * Keep this catalogue explicit: adding or changing an external action requires
 * checking its official action.yml `runs.using` value before updating the pin.
 */
const ROOT = join(import.meta.dirname, "..", "..");
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

const NODE24_ACTIONS = new Map<string, string>([
  ["actions/checkout", "v5"],
  ["actions/download-artifact", "v8.0.1"],
  ["actions/setup-node", "v5"],
  ["actions/upload-artifact", "v6"],
  ["astral-sh/setup-uv", "v7.0.0"],
  ["pnpm/action-setup", "v4.4.0"],
]);

type CompositeActionAudit = {
  ref: string;
  nestedUses: readonly string[];
};

/**
 * Composite actions do not declare a JavaScript runtime of their own. Keep them out of
 * NODE24_ACTIONS and record the exact nested action graph inspected in the upstream action.yml.
 * Every nested action must use an immutable commit SHA so a moving composite dependency cannot
 * silently reintroduce Node 20 after this audit.
 */
const COMPOSITE_ACTIONS = new Map<string, CompositeActionAudit>([
  [
    "actions/attest-build-provenance",
    {
      ref: "v3",
      nestedUses: [
        "actions/attest-build-provenance/predicate@864457a58d4733d7f1574bd8821fa24e02cf7538",
        "actions/attest@daf44fb950173508f38bd2406030372c1d1162b1",
      ],
    },
  ],
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

function collectUses(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectUses);
  if (value === null || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, nested]) => {
    if (key === "uses" && typeof nested === "string") return [nested];
    return collectUses(nested);
  });
}

function externalActionUses(source: string): string[] {
  return collectUses(parse(source)).filter(
    (use) => !use.startsWith("./") && !use.startsWith("docker://"),
  );
}

function splitActionUse(use: string, context: string): { action: string; ref: string } {
  const separator = use.lastIndexOf("@");
  if (separator <= 0 || separator === use.length - 1) {
    throw new Error(`${context}: malformed action reference ${use}`);
  }
  return { action: use.slice(0, separator), ref: use.slice(separator + 1) };
}

function validateCompositeAudit(action: string, audit: CompositeActionAudit): void {
  if (audit.nestedUses.length === 0) throw new Error(`${action}: composite audit must record nested actions`);
  const nestedActions = new Set<string>();
  for (const use of audit.nestedUses) {
    const nested = splitActionUse(use, `${action} composite audit`);
    if (!/^[a-f0-9]{40}$/.test(nested.ref)) {
      throw new Error(`${action}: nested action ${nested.action} must use an immutable 40-character commit SHA`);
    }
    if (nestedActions.has(nested.action)) throw new Error(`${action}: duplicate nested action ${nested.action}`);
    nestedActions.add(nested.action);
  }
}

function auditWorkflowActions(
  sources: Array<{ file: string; source: string }>,
  node24Actions = NODE24_ACTIONS,
  compositeActions = COMPOSITE_ACTIONS,
): Set<string> {
  for (const action of node24Actions.keys()) {
    if (compositeActions.has(action)) throw new Error(`${action}: action cannot be both JavaScript and composite`);
  }
  for (const [action, audit] of compositeActions) validateCompositeAudit(action, audit);

  const seen = new Set<string>();
  for (const { file, source } of sources) {
    for (const use of externalActionUses(source)) {
      const { action, ref } = splitActionUse(use, file);
      const node24Ref = node24Actions.get(action);
      const composite = compositeActions.get(action);
      if (node24Ref === undefined && composite === undefined) {
        throw new Error(`${file}: ${action} has not been audited for its declared runs.using runtime`);
      }
      const expectedRef = node24Ref ?? composite?.ref;
      if (ref !== expectedRef) {
        const kind = composite ? "audited composite release" : "audited Node.js 24 release";
        throw new Error(`${file}: ${action} must use its ${kind} ${expectedRef}, received ${ref}`);
      }
      seen.add(action);
    }
  }

  const expected = new Set([...node24Actions.keys(), ...compositeActions.keys()]);
  if (seen.size !== expected.size || [...expected].some((action) => !seen.has(action))) {
    throw new Error("external action audit catalogue and workflow usage have drifted");
  }
  return seen;
}

describe("GitHub workflow actions have an explicit Node.js 24 or composite audit", () => {
  it("pins every external action to its audited release and action kind", () => {
    expect(auditWorkflowActions(workflowSources())).toEqual(
      new Set([...NODE24_ACTIONS.keys(), ...COMPOSITE_ACTIONS.keys()]),
    );
    expect(NODE24_ACTIONS.has("actions/attest-build-provenance")).toBe(false);
    expect(NODE24_ACTIONS.get("actions/download-artifact")).toBe("v8.0.1");
  });

  it("records the attestation composite's exact immutable Node.js 24 dependencies", () => {
    expect(COMPOSITE_ACTIONS.get("actions/attest-build-provenance")).toEqual({
      ref: "v3",
      nestedUses: [
        "actions/attest-build-provenance/predicate@864457a58d4733d7f1574bd8821fa24e02cf7538",
        "actions/attest@daf44fb950173508f38bd2406030372c1d1162b1",
      ],
    });
  });

  it("rejects an unknown workflow action", () => {
    expect(() => auditWorkflowActions(
      [{ file: "fixture.yml", source: "jobs:\n  test:\n    steps:\n      - uses: example/unknown@v1\n" }],
      new Map(),
      new Map(),
    )).toThrow(/has not been audited/);
  });

  it("rejects mutable or malformed nested composite pins", () => {
    expect(() => validateCompositeAudit("example/composite", {
      ref: "v1",
      nestedUses: ["example/javascript@v1"],
    })).toThrow(/immutable 40-character commit SHA/);
  });

  it("rejects an action classified as both JavaScript and composite", () => {
    expect(() => auditWorkflowActions([], new Map([["example/action", "v1"]]), new Map([
      ["example/action", { ref: "v1", nestedUses: [`example/nested@${"a".repeat(40)}`] }],
    ]))).toThrow(/cannot be both JavaScript and composite/);
  });
});
