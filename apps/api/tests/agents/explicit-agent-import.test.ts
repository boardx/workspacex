import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-wave2-agents";
const OTHER_ORG = "org-wave2-agents-other";
const ADMIN = "u-wave2-agent-admin";
const MEMBER = "u-wave2-agent-member";
const SKILL_PACK_ID = "agent-prerequisite-skills";
const AGENT_PACK_ID = "facilitation-agents";
const PACK_VERSION = "1.0.0";

describe("Agent starter import authorization structure", () => {
  it("keeps the admin decision before every dependency and the repository narrowly scoped", () => {
    const useCase = readFileSync(
      new URL("../../src/application/agent-import/import-agent-starter-pack.ts", import.meta.url),
      "utf8",
    );
    const membership = useCase.indexOf("findOrgMembership");
    const adminDecision = useCase.indexOf('membership.orgRole !== "admin"');
    expect(membership).toBeGreaterThan(-1);
    expect(adminDecision).toBeGreaterThan(membership);
    for (const dependencyCall of [
      "deps.imports.findExisting",
      "deps.packs.load",
      "deps.imports.recordFailure",
      "deps.imports.persistVerified",
    ]) expect(useCase.indexOf(dependencyCall)).toBeGreaterThan(adminDecision);

    const repository = readFileSync(
      new URL("../../src/infrastructure/agent/pg-agent-starter-import-repository.ts", import.meta.url),
      "utf8",
    );
    expect(repository).not.toContain("withoutTenant");
    const sqlTables = [...repository.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)]
      .map((match) => match[1]?.toLowerCase());
    expect(new Set(sqlTables)).toEqual(new Set([
      "agent_starter_pack_imports",
      "skill_versions",
      "agents",
      "capability_listings",
      "agent_versions",
    ]));
  });
});

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

let app: NestExpressApplication;
let base = "";
let skillPackRoot = "";
let agentPackRoot = "";

interface SkillImportResult {
  readonly skillIds: string[];
  readonly versionIds: string[];
}

interface AgentImportResult {
  readonly importId: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly packDigest: string;
  readonly status: "succeeded";
  readonly agentIds: string[];
  readonly versionIds: string[];
  readonly importedAt: string;
}

interface SkillReference {
  readonly versionId: string;
  readonly digest: string;
}

function writeSkillPack(packId = SKILL_PACK_ID): void {
  const content = "# Agent prerequisite\n\nUse only cited workshop evidence.\n";
  const isPrimary = packId === SKILL_PACK_ID;
  const skill = {
    stableName: isPrimary ? "agent-prerequisite" : packId,
    name: isPrimary ? "Agent prerequisite" : "Second Agent Skill",
    semanticVersion: PACK_VERSION,
    manifest: { description: "A concrete immutable Agent dependency.", entrypoint: "SKILL.md" },
    files: [{
      path: "SKILL.md",
      mediaType: "text/markdown",
      digest: sha256(Buffer.from(content)),
      contentBase64: Buffer.from(content).toString("base64"),
    }],
  };
  const unsigned = { schemaVersion: 1, packId, packVersion: PACK_VERSION, skills: [skill] };
  const body = { ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) };
  const dir = join(skillPackRoot, packId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${PACK_VERSION}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

function writeAgentPack(input: {
  readonly packId?: string;
  readonly packVersion?: string;
  readonly stableName?: string;
  readonly name?: string;
  readonly skillVersions: readonly SkillReference[];
  readonly instructionDigestOverride?: string;
  readonly packDigestOverride?: string;
  readonly toolPolicy?: readonly string[];
}): void {
  const packId = input.packId ?? AGENT_PACK_ID;
  const packVersion = input.packVersion ?? PACK_VERSION;
  const instructions = "Facilitate the workshop and preserve dissent with citations.";
  const agent = {
    stableName: input.stableName ?? "facilitation-agent",
    name: input.name ?? "Facilitation Agent",
    semanticVersion: PACK_VERSION,
    instructions,
    instructionDigest: input.instructionDigestOverride ?? sha256(instructions),
    skillVersions: input.skillVersions,
    modelProvider: "dashscope",
    modelId: "qwen-plus",
    toolPolicy: input.toolPolicy ?? [],
  };
  const unsigned = { schemaVersion: 1, packId, packVersion, agents: [agent] };
  const body = {
    ...unsigned,
    packDigest: input.packDigestOverride ?? sha256(JSON.stringify(unsigned)),
  };
  const dir = join(agentPackRoot, packId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${packVersion}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

function postImport(
  kind: "skills" | "agents",
  userId: string,
  body: { packId: string; packVersion: string; idempotencyKey: string },
  orgId = ORG,
): Promise<Response> {
  return fetch(`${base}/admin/${kind}/starter-pack-imports`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });
}

async function importPrerequisiteSkill(orgId = ORG): Promise<SkillReference> {
  const response = await postImport("skills", ADMIN, {
    packId: SKILL_PACK_ID,
    packVersion: PACK_VERSION,
    idempotencyKey: randomUUID(),
  }, orgId);
  expect(response.status).toBe(201);
  const imported = await response.json() as SkillImportResult;
  const versionId = imported.versionIds[0]!;
  const digest = await asApp(orgId, async (client) => {
    const result = await client.query<{ content_digest: string }>(
      "SELECT content_digest FROM skill_versions WHERE id = $1 AND org_id = $2",
      [versionId, orgId],
    );
    return result.rows[0]!.content_digest;
  });
  return { versionId, digest };
}

async function counts(orgId = ORG): Promise<Record<string, number>> {
  return asApp(orgId, async (client) => {
    const tables = ["agents", "agent_versions", "agent_starter_pack_imports"] as const;
    const result: Record<string, number> = {};
    for (const table of tables) {
      const rows = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE org_id = $1`,
        [orgId],
      );
      result[table] = Number(rows.rows[0]?.n ?? "0");
    }
    return result;
  });
}

beforeAll(async () => {
  skillPackRoot = mkdtempSync(join(tmpdir(), "workspacex-agent-skill-packs-"));
  agentPackRoot = mkdtempSync(join(tmpdir(), "workspacex-agent-packs-"));
  process.env.SKILL_STARTER_PACK_ROOT = skillPackRoot;
  process.env.AGENT_STARTER_PACK_ROOT = agentPackRoot;
  writeSkillPack();

  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  rmSync(skillPackRoot, { recursive: true, force: true });
  rmSync(agentPackRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  const other = await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-project` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
  await addOrgMember(OTHER_ORG, ADMIN, "admin", other.teams.energy!);
});

describe("production-shaped empty state and authorization", () => {
  it("keeps a fresh repository empty across migration, startup, and catalog reads", async () => {
    expect(await counts()).toEqual({
      agents: 0,
      agent_versions: 0,
      agent_starter_pack_imports: 0,
    });
    const directory = await fetch(`${base}/capabilities?orgId=${ORG}&kind=agent`, {
      headers: authFor(ADMIN),
    });
    expect(directory.status).toBe(200);
    expect(await directory.json()).toEqual([]);
    expect((await counts()).agents).toBe(0);
  });

  it("rejects a non-administrator before loading a pack and writes nothing", async () => {
    const response = await postImport("agents", MEMBER, {
      packId: "not-even-configured",
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(response.status).toBe(403);
    expect(await counts()).toEqual({
      agents: 0,
      agent_versions: 0,
      agent_starter_pack_imports: 0,
    });
  });
});

describe("explicit Skills-first Agent import", () => {
  it("fails all Agent writes when the referenced immutable Skill is missing", async () => {
    writeAgentPack({ skillVersions: [{ versionId: "missing-version", digest: "0".repeat(64) }] });
    const response = await postImport("agents", ADMIN, {
      packId: AGENT_PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ reasonCode: "AGENT_STARTER_SKILL_VERSION_MISSING" });
    expect(await counts()).toEqual({
      agents: 0,
      agent_versions: 0,
      agent_starter_pack_imports: 1,
    });
  });

  it("fails atomically when an imported Skill digest does not match the signed Agent pack", async () => {
    const skill = await importPrerequisiteSkill();
    writeAgentPack({ skillVersions: [{ ...skill, digest: "f".repeat(64) }] });
    const response = await postImport("agents", ADMIN, {
      packId: AGENT_PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ reasonCode: "AGENT_STARTER_SKILL_VERSION_MISMATCH" });
    expect((await counts()).agents).toBe(0);
    expect((await counts()).agent_versions).toBe(0);
  });

  it("persists immutable versions, published heads, provenance, and the Agent directory atomically", async () => {
    const skill = await importPrerequisiteSkill();
    writeAgentPack({ skillVersions: [skill] });
    const request = {
      packId: AGENT_PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    };
    const response = await postImport("agents", ADMIN, request);
    expect(response.status).toBe(201);
    const result = await response.json() as AgentImportResult;
    expect(result).toMatchObject({
      packId: AGENT_PACK_ID,
      packVersion: PACK_VERSION,
      status: "succeeded",
    });
    expect(result.importId).toMatch(/^agent-import-/);
    expect(result.agentIds).toHaveLength(1);
    expect(result.versionIds).toHaveLength(1);
    expect(result.packDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Number.isNaN(Date.parse(result.importedAt))).toBe(false);
    expect(await counts()).toEqual({
      agents: 1,
      agent_versions: 1,
      agent_starter_pack_imports: 1,
    });

    const durable = await asApp(ORG, async (client) => {
      const agent = await client.query<{
        stable_name: string;
        name: string;
        status: string;
        published_version_id: string;
      }>("SELECT stable_name, name, status, published_version_id FROM agents WHERE org_id = $1", [ORG]);
      const version = await client.query<{
        id: string;
        instruction_digest: string;
        instructions: string;
        skill_version_ids: string[];
        model_provider: string;
        model_id: string;
        tool_policy: unknown;
      }>(
        `SELECT id, instruction_digest, instructions, skill_version_ids,
                model_provider, model_id, tool_policy
           FROM agent_versions WHERE org_id = $1`,
        [ORG],
      );
      const provenance = await client.query<{ pack_id: string; pack_version: string; pack_digest: string }>(
        "SELECT pack_id, pack_version, pack_digest FROM agent_starter_pack_imports WHERE org_id = $1",
        [ORG],
      );
      return { agent: agent.rows[0]!, version: version.rows[0]!, provenance: provenance.rows[0]! };
    });
    expect(durable.agent).toEqual({
      stable_name: "facilitation-agent",
      name: "Facilitation Agent",
      status: "enabled",
      published_version_id: result.versionIds[0],
    });
    expect(durable.version.id).toBe(result.versionIds[0]);
    expect(durable.version.instruction_digest).toBe(sha256(durable.version.instructions));
    expect(durable.version.skill_version_ids).toEqual([skill.versionId]);
    expect(durable.version.model_provider).toBe("dashscope");
    expect(durable.version.model_id).toBe("qwen-plus");
    expect(durable.version.tool_policy).toEqual([]);
    expect(durable.provenance).toMatchObject({ pack_id: AGENT_PACK_ID, pack_version: PACK_VERSION });

    const directory = await fetch(`${base}/capabilities?orgId=${ORG}&kind=agent`, {
      headers: authFor(ADMIN),
    }).then((value) => value.json()) as Array<{ id: string; name: string }>;
    expect(directory).toHaveLength(1);
    expect(directory[0]).toMatchObject({
      id: result.agentIds[0],
      name: "Facilitation Agent",
      scope: "org-wide",
    });
  });
});

describe("verification, conflicts, replay, immutability, and tenant isolation", () => {
  it.each([
    { name: "instruction digest", changes: { instructionDigestOverride: "0".repeat(64) } },
    { name: "pack digest", changes: { packDigestOverride: "f".repeat(64) } },
    { name: "non-empty Wave 2 tool policy", changes: { toolPolicy: ["web.search"] } },
  ])("rejects an invalid $name without partial Agent/version rows", async ({ changes }) => {
    const skill = await importPrerequisiteSkill();
    writeAgentPack({ skillVersions: [skill], ...changes });
    const response = await postImport("agents", ADMIN, {
      packId: AGENT_PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(response.status).toBe(422);
    expect((await counts()).agents).toBe(0);
    expect((await counts()).agent_versions).toBe(0);
    expect((await counts()).agent_starter_pack_imports).toBe(1);
  });

  it("returns the byte-equivalent original result on retry and rejects changed payload reuse", async () => {
    const skill = await importPrerequisiteSkill();
    writeAgentPack({ skillVersions: [skill] });
    const idempotencyKey = randomUUID();
    const request = { packId: AGENT_PACK_ID, packVersion: PACK_VERSION, idempotencyKey };
    const first = await postImport("agents", ADMIN, request);
    const firstText = await first.text();
    expect(first.status).toBe(201);

    writeAgentPack({ skillVersions: [skill], packDigestOverride: "f".repeat(64) });
    const retry = await postImport("agents", ADMIN, request);
    expect(retry.status).toBe(200);
    expect(await retry.text()).toBe(firstText);
    expect(await counts()).toEqual({
      agents: 1,
      agent_versions: 1,
      agent_starter_pack_imports: 1,
    });

    const changed = await postImport("agents", ADMIN, {
      packId: AGENT_PACK_ID,
      packVersion: "different",
      idempotencyKey,
    });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ reasonCode: "AGENT_STARTER_IMPORT_IDEMPOTENCY_CONFLICT" });
  });

  it("rejects name conflicts and never overwrites an existing Agent", async () => {
    const skill = await importPrerequisiteSkill();
    writeAgentPack({ skillVersions: [skill] });
    expect((await postImport("agents", ADMIN, {
      packId: AGENT_PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    })).status).toBe(201);

    writeAgentPack({
      packId: "conflicting-agent-pack",
      stableName: "facilitation-agent",
      name: "Overwrite attempt",
      skillVersions: [skill],
    });
    const conflict = await postImport("agents", ADMIN, {
      packId: "conflicting-agent-pack",
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(conflict.status).toBe(409);
    const names = await asApp(ORG, (client) =>
      client.query<{ name: string }>("SELECT name FROM agents WHERE org_id = $1", [ORG]),
    );
    expect(names.rows.map((row) => row.name)).toEqual(["Facilitation Agent"]);
  });

  it("makes immutable versions owner-proof and preserves ordered Skill IDs", async () => {
    const firstSkill = await importPrerequisiteSkill();
    writeSkillPack("second-agent-skill-pack");
    const secondResponse = await postImport("skills", ADMIN, {
      packId: "second-agent-skill-pack",
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(secondResponse.status).toBe(201);
    const secondImport = await secondResponse.json() as SkillImportResult;
    const secondVersionId = secondImport.versionIds[0]!;
    const secondDigest = await asApp(ORG, async (client) => {
      const result = await client.query<{ content_digest: string }>(
        "SELECT content_digest FROM skill_versions WHERE id = $1 AND org_id = $2",
        [secondVersionId, ORG],
      );
      return result.rows[0]!.content_digest;
    });
    writeAgentPack({
      skillVersions: [
        { versionId: secondVersionId, digest: secondDigest },
        firstSkill,
      ],
    });
    const imported = await postImport("agents", ADMIN, {
      packId: AGENT_PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    }).then((response) => response.json()) as AgentImportResult;
    const versionId = imported.versionIds[0]!;
    const version = await asApp(ORG, (client) => client.query<{ skill_version_ids: string[] }>(
      "SELECT skill_version_ids FROM agent_versions WHERE id = $1 AND org_id = $2",
      [versionId, ORG],
    ));
    expect(version.rows[0]!.skill_version_ids).toEqual([secondVersionId, firstSkill.versionId]);

    await expect(asApp(ORG, (client) => client.query(
      "UPDATE agent_versions SET model_id = 'changed' WHERE id = $1",
      [versionId],
    ))).rejects.toThrow(/permission|immutable/i);
    await expect(asOwner((client) => client.query(
      "UPDATE agent_versions SET model_id = 'changed' WHERE id = $1",
      [versionId],
    ))).rejects.toThrow(/immutable/i);
  });

  it("cannot reference another tenant's Skill version and never exposes another tenant's Agent", async () => {
    const foreignSkill = await importPrerequisiteSkill(OTHER_ORG);
    writeAgentPack({ skillVersions: [foreignSkill] });
    const rejected = await postImport("agents", ADMIN, {
      packId: AGENT_PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    });
    expect(rejected.status).toBe(422);
    expect((await counts()).agents).toBe(0);

    writeAgentPack({ skillVersions: [foreignSkill] });
    expect((await postImport("agents", ADMIN, {
      packId: AGENT_PACK_ID,
      packVersion: PACK_VERSION,
      idempotencyKey: randomUUID(),
    }, OTHER_ORG)).status).toBe(201);
    expect((await counts(OTHER_ORG)).agents).toBe(1);
    expect((await counts(ORG)).agents).toBe(0);
    const directory = await fetch(`${base}/capabilities?orgId=${ORG}&kind=agent`, {
      headers: authFor(ADMIN),
    });
    expect(await directory.json()).toEqual([]);
  });
});
