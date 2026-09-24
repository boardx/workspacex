import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import {
  loadTrustedActionAuditCatalog,
  splitActionUse,
  type TrustedActionAuditCatalog,
  validateTrustedActionAudits,
} from "./lib/workflow-action-audit";

/**
 * GitHub stopped supporting the Node.js 20 JavaScript action runtime in 2026.
 * Composite and supply-chain-sensitive JavaScript actions are proven from the
 * independent trusted manifest catalogue; the remaining audited releases stay explicit here.
 */
const ROOT = join(import.meta.dirname, "..", "..");
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");
const TRUSTED_CATALOG = loadTrustedActionAuditCatalog(ROOT);
const TRUSTED = validateTrustedActionAudits(ROOT, TRUSTED_CATALOG);

const NODE24_ACTIONS = new Map<string, string>([
  ["actions/checkout", "v5"],
  ...TRUSTED.javascript,
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
      if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml.example")) return [];
      return [{ file: relativePath, source: readFileSync(absolutePath, "utf8") }];
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

function collectUses(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectUses);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => key === "uses" && typeof nested === "string" ? [nested] : collectUses(nested));
}

function externalActionUses(source: string): string[] {
  return collectUses(parse(source)).filter(use => !use.startsWith("./") && !use.startsWith("docker://"));
}

function auditWorkflowActions(
  sources: Array<{ file: string; source: string }>,
  node24Actions = NODE24_ACTIONS,
  compositeActions = TRUSTED.composites,
): Set<string> {
  for (const action of node24Actions.keys()) {
    if (compositeActions.has(action)) throw new Error(`${action}: action cannot be both JavaScript and composite`);
  }
  const seen = new Set<string>();
  for (const { file, source } of sources) {
    for (const use of externalActionUses(source)) {
      const { action, ref } = splitActionUse(use, file);
      const node24Ref = node24Actions.get(action);
      const compositeRef = compositeActions.get(action);
      if (node24Ref === undefined && compositeRef === undefined) throw new Error(`${file}: ${action} has not been audited for its declared runs.using runtime`);
      const expectedRef = node24Ref ?? compositeRef;
      if (ref !== expectedRef) {
        const kind = compositeRef ? "audited immutable composite commit" : "audited Node.js 24 release";
        throw new Error(`${file}: ${action} must use its ${kind} ${expectedRef}, received ${ref}`);
      }
      seen.add(action);
    }
  }
  const expected = new Set([...node24Actions.keys(), ...compositeActions.keys()]);
  if (seen.size !== expected.size || [...expected].some(action => !seen.has(action))) throw new Error("external action audit catalogue and workflow usage have drifted");
  return seen;
}

const cloneCatalog = (): TrustedActionAuditCatalog => structuredClone(TRUSTED_CATALOG);
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
function mutatedFixture(snapshotPath: string, source: string): (path: string) => string {
  return (path) => path === resolve(ROOT, snapshotPath) ? source : readFileSync(path, "utf8");
}

describe("GitHub workflow actions have an explicit Node.js 24 or trusted composite audit", () => {
  it("pins every workflow action to its audited release or immutable composite commit", () => {
    expect(auditWorkflowActions(workflowSources())).toEqual(new Set([...NODE24_ACTIONS.keys(), ...TRUSTED.composites.keys()]));
    expect(NODE24_ACTIONS.has("actions/attest-build-provenance")).toBe(false);
    expect(TRUSTED.composites.get("actions/attest-build-provenance")).toBe("977bb373ede98d70efdf65b84cb5f73e068dcc2a");
    expect(NODE24_ACTIONS.get("actions/download-artifact")).toBe("3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c");
  });

  it("proves the vendored official composite graph and every nested Node24 runtime", () => {
    expect(validateTrustedActionAudits(ROOT, cloneCatalog())).toEqual(TRUSTED);
  });

  it("rejects arbitrary aaaa/bbbb 40-hex nested refs even when the catalogue entries are edited", () => {
    const catalog = cloneCatalog();
    const composite = catalog.audits.find(audit => audit.kind === "composite");
    if (!composite || composite.kind !== "composite") throw new Error("missing fixture composite");
    composite.nested[0]!.use = `actions/attest-build-provenance/predicate@${"a".repeat(40)}`;
    composite.nested[0]!.source.commit = "a".repeat(40);
    composite.nested[1]!.use = `actions/attest@${"b".repeat(40)}`;
    composite.nested[1]!.source.commit = "b".repeat(40);
    expect(() => validateTrustedActionAudits(ROOT, catalog)).toThrow(/complete nested action graph differs/);
  });

  it.each(["missing", "extra", "duplicate"] as const)("rejects a %s nested use in the vendored outer manifest", mutation => {
    const catalog = cloneCatalog();
    const composite = catalog.audits.find(audit => audit.kind === "composite");
    if (!composite || composite.kind !== "composite") throw new Error("missing fixture composite");
    const document = parse(readFileSync(resolve(ROOT, composite.source.snapshotPath), "utf8"));
    if (mutation === "missing") document.runs.steps.splice(0, 1);
    if (mutation === "extra") document.runs.steps.push({ uses: `example/extra@${"c".repeat(40)}` });
    if (mutation === "duplicate") document.runs.steps.push({ ...document.runs.steps[0] });
    const source = stringify(document);
    composite.source.sha256 = sha256(source);
    expect(() => validateTrustedActionAudits(ROOT, catalog, mutatedFixture(composite.source.snapshotPath, source))).toThrow(
      mutation === "duplicate" ? /duplicate nested uses/ : /complete nested action graph differs/,
    );
  });

  it("rejects a nested manifest whose audited runtime is no longer Node24", () => {
    const catalog = cloneCatalog();
    const composite = catalog.audits.find(audit => audit.kind === "composite");
    if (!composite || composite.kind !== "composite") throw new Error("missing fixture composite");
    const nested = composite.nested[0]!;
    const document = parse(readFileSync(resolve(ROOT, nested.source.snapshotPath), "utf8"));
    document.runs.using = "node20";
    const source = stringify(document);
    nested.source.sha256 = sha256(source);
    expect(() => validateTrustedActionAudits(ROOT, catalog, mutatedFixture(nested.source.snapshotPath, source))).toThrow(/must declare runs.using node24/);
  });

  it("rejects mutable or wrong outer composite refs in a workflow", () => {
    expect(() => auditWorkflowActions(
      [{ file: "fixture.yml", source: "jobs:\n  attest:\n    steps:\n      - uses: actions/attest-build-provenance@v3\n" }],
      new Map(),
      TRUSTED.composites,
    )).toThrow(/audited immutable composite commit/);
  });

  it("rejects an unknown workflow action and a catalogue that is not fully used", () => {
    expect(() => auditWorkflowActions(
      [{ file: "fixture.yml", source: "jobs:\n  test:\n    steps:\n      - uses: example/unknown@v1\n" }],
      new Map(),
      new Map(),
    )).toThrow(/has not been audited/);
    expect(() => auditWorkflowActions([], new Map([["actions/checkout", "v5"]]), new Map())).toThrow(/catalogue and workflow usage have drifted/);
  });

  it("rejects an action classified as both JavaScript and composite", () => {
    expect(() => auditWorkflowActions([], new Map([["example/action", "v1"]]), new Map([["example/action", "a".repeat(40)]]))).toThrow(/cannot be both/);
  });
});
