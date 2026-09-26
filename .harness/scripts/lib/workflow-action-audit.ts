import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { parse } from "yaml";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SCHEMA = "workspacex.trusted-workflow-action-audits.v1";
const FIXTURE_PREFIX = `.harness${sep}fixtures${sep}github-actions${sep}`;

export type ActionSourceAudit = {
  repository: string;
  commit: string;
  actionPath: string;
  sourceUrl: string;
  snapshotPath: string;
  sha256: string;
  runsUsing: "composite" | "node24";
};

export type CompositeActionAudit = {
  kind: "composite";
  action: string;
  workflowRef: string;
  release: string;
  source: ActionSourceAudit;
  nested: Array<{ use: string; source: ActionSourceAudit }>;
};

export type JavascriptActionAudit = {
  kind: "javascript";
  action: string;
  workflowRef: string;
  release: string;
  source: ActionSourceAudit;
};

export type TrustedActionAuditCatalog = {
  schema: typeof SCHEMA;
  audits: Array<CompositeActionAudit | JavascriptActionAudit>;
};

export type ValidatedActionAudits = {
  composites: Map<string, string>;
  javascript: Map<string, string>;
};

const fail = (message: string): never => { throw new Error(`[workflow-action-audit] ${message}`); };
const digest = (source: string): string => createHash("sha256").update(source).digest("hex");

export function splitActionUse(use: string, context: string): { action: string; ref: string } {
  const separator = use.lastIndexOf("@");
  if (separator <= 0 || separator === use.length - 1) fail(`${context}: malformed action reference ${use}`);
  return { action: use.slice(0, separator), ref: use.slice(separator + 1) };
}

function collectUses(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectUses);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => key === "uses" && typeof nested === "string" ? [nested] : collectUses(nested));
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function validateSourceShape(source: ActionSourceAudit, context: string, expectedUsing: "composite" | "node24"): void {
  requireString(source.repository, `${context}.repository`);
  if (!SHA.test(source.commit)) fail(`${context}.commit must be an immutable 40-character lowercase SHA`);
  requireString(source.actionPath, `${context}.actionPath`);
  requireString(source.snapshotPath, `${context}.snapshotPath`);
  if (!DIGEST.test(source.sha256)) fail(`${context}.sha256 must be a lowercase SHA-256 digest`);
  if (source.runsUsing !== expectedUsing) fail(`${context}.runsUsing must be ${expectedUsing}`);
  const expectedUrl = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${source.actionPath}`;
  if (source.sourceUrl !== expectedUrl) fail(`${context}.sourceUrl must identify its exact immutable commit and action path`);
}

function actionIdentity(source: ActionSourceAudit): string {
  if (source.actionPath === "action.yml" || source.actionPath === "action.yaml") return source.repository;
  const suffix = source.actionPath.replace(/\/(?:action\.ya?ml)$/, "");
  if (suffix === source.actionPath || suffix.length === 0) fail(`${source.repository}: actionPath must end in action.yml or action.yaml`);
  return `${source.repository}/${suffix}`;
}

function readTrustedSnapshot(root: string, source: ActionSourceAudit, context: string, readText: (path: string) => string): string {
  if (isAbsolute(source.snapshotPath) || source.snapshotPath.includes("..")) fail(`${context}.snapshotPath must remain repository-relative`);
  const platformPath = source.snapshotPath.split("/").join(sep);
  if (!platformPath.startsWith(FIXTURE_PREFIX)) fail(`${context}.snapshotPath must live under .harness/fixtures/github-actions`);
  const absolute = resolve(root, platformPath);
  const fixtureRoot = `${resolve(root, ".harness", "fixtures", "github-actions")}${sep}`;
  if (!absolute.startsWith(fixtureRoot)) fail(`${context}.snapshotPath escapes the trusted fixture directory`);
  const text = readText(absolute);
  if (digest(text) !== source.sha256) fail(`${context}: vendored action manifest digest does not match the trusted catalog`);
  return text;
}

function manifestRuntime(source: string, context: string): string {
  const using = parse(source)?.runs?.using;
  if (typeof using !== "string") fail(`${context}: action manifest has no runs.using runtime`);
  return using;
}

export function validateTrustedActionAudits(
  root: string,
  catalog: TrustedActionAuditCatalog,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ValidatedActionAudits {
  if (catalog?.schema !== SCHEMA || !Array.isArray(catalog.audits) || catalog.audits.length === 0) fail("catalog schema or audits are invalid");
  const composites = new Map<string, string>();
  const javascript = new Map<string, string>();
  for (const [index, audit] of catalog.audits.entries()) {
    const context = `audits[${index}]`;
    requireString(audit.action, `${context}.action`);
    requireString(audit.release, `${context}.release`);
    if (composites.has(audit.action) || javascript.has(audit.action)) fail(`${audit.action}: duplicate trusted action audit`);
    if (audit.kind === "javascript") {
      if (!SHA.test(audit.workflowRef) || audit.workflowRef !== audit.source.commit) fail(`${audit.action}: trusted JavaScript workflow ref must equal the audited immutable source commit`);
      validateSourceShape(audit.source, `${context}.source`, "node24");
      if (actionIdentity(audit.source) !== audit.action) fail(`${audit.action}: action identity differs from its audited source path`);
      const source = readTrustedSnapshot(root, audit.source, `${context}.source`, readText);
      if (manifestRuntime(source, audit.action) !== "node24") fail(`${audit.action}: vendored manifest must declare runs.using node24`);
      javascript.set(audit.action, audit.workflowRef);
      continue;
    }
    if (audit.kind !== "composite") fail(`${context}.kind must be composite or javascript`);
    if (!SHA.test(audit.workflowRef) || audit.workflowRef !== audit.source.commit) fail(`${audit.action}: composite workflow ref must equal the audited immutable source commit`);
    validateSourceShape(audit.source, `${context}.source`, "composite");
    if (actionIdentity(audit.source) !== audit.action) fail(`${audit.action}: action identity differs from its audited source path`);
    const outerSource = readTrustedSnapshot(root, audit.source, `${context}.source`, readText);
    if (manifestRuntime(outerSource, audit.action) !== "composite") fail(`${audit.action}: vendored outer manifest must declare runs.using composite`);
    if (!Array.isArray(audit.nested) || audit.nested.length === 0) fail(`${audit.action}: composite audit must record nested actions`);
    const manifestUses = collectUses(parse(outerSource)?.runs?.steps ?? []).filter(use => !use.startsWith("./") && !use.startsWith("docker://"));
    const catalogUses = audit.nested.map(item => item.use);
    if (new Set(manifestUses).size !== manifestUses.length) fail(`${audit.action}: vendored composite manifest contains duplicate nested uses`);
    if (new Set(catalogUses).size !== catalogUses.length) fail(`${audit.action}: trusted catalog contains duplicate nested uses`);
    if (JSON.stringify(manifestUses) !== JSON.stringify(catalogUses)) fail(`${audit.action}: complete nested action graph differs from the trusted catalog`);
    for (const [nestedIndex, nestedAudit] of audit.nested.entries()) {
      const nestedContext = `${context}.nested[${nestedIndex}]`;
      const nested = splitActionUse(nestedAudit.use, nestedContext);
      if (!SHA.test(nested.ref)) fail(`${nested.action}: nested action must use an immutable 40-character lowercase SHA`);
      if (nested.ref !== nestedAudit.source.commit) fail(`${nested.action}: nested use ref differs from its audited source commit`);
      validateSourceShape(nestedAudit.source, `${nestedContext}.source`, "node24");
      if (actionIdentity(nestedAudit.source) !== nested.action) fail(`${nested.action}: nested action identity differs from its audited source path`);
      const nestedSource = readTrustedSnapshot(root, nestedAudit.source, `${nestedContext}.source`, readText);
      if (manifestRuntime(nestedSource, nested.action) !== "node24") fail(`${nested.action}: vendored nested manifest must declare runs.using node24`);
    }
    composites.set(audit.action, audit.workflowRef);
  }
  return { composites, javascript };
}

export function loadTrustedActionAuditCatalog(root: string): TrustedActionAuditCatalog {
  return JSON.parse(readFileSync(resolve(root, ".harness", "config", "trusted-workflow-action-audits.json"), "utf8")) as TrustedActionAuditCatalog;
}
