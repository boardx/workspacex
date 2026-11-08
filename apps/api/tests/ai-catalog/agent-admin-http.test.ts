import { createHash } from "node:crypto";
import { insertAgentVersionFromDraft } from "../../src/infrastructure/agent/agent-version-insert";
import { DATABASE_PORT } from "../../src/application/ports/database.port";
import { PgPublishedAgentReader } from "../../src/infrastructure/chat/pg-chat-message-command-repository";
import { PgWorkflowAccess } from "../../src/infrastructure/workflow/pg-workflow-access";
import { toOrgId } from "../../src/domain/org-id";
import { readFileSync } from "node:fs";
import type {
  DatabasePort,
  TenantSession,
} from "../../src/application/ports/database.port";
import { PLATFORM_ORGANIZATION_REPOSITORY } from "../../src/application/system/platform-organization-ports";
import { beforeAll, afterAll, it, expect } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  ensureDatabase,
  migrateOnce,
  seedOrg,
  addCredential,
  addOrgMember,
  resetOrgs,
  asApp,
  asOwner,
} from "../support/db";
const ORG = "org-catalog-agent-http",
  OTHER = "org-catalog-agent-other",
  PUBLIC = "org-platform",
  OPS = "catalog-agent-ops",
  ADMIN = "catalog-agent-admin",
  MEMBER = "catalog-agent-member";
let app: NestExpressApplication, base: string;
const previous = process.env.PLATFORM_SUPERUSER_EMAILS;
beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  for (const orgId of [ORG, OTHER, PUBLIC])
    await seedOrg({ orgId, projectId: `${orgId}-agent-test` });
  await addCredential(OPS, "catalog-agent-ops@example.test", "Ops");
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  process.env.PLATFORM_SUPERUSER_EMAILS = "catalog-agent-ops@example.test";
  process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
  process.env.KERNEL_QUIET = "1";
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  await asOwner((c) =>
    c.query(
      readFileSync(
        new URL("../../provisioning/platform-org-catalog.sql", import.meta.url),
        "utf8",
      ),
    ),
  );
  const catalog: DatabasePort = {
    withTenant: async () => {
      throw new Error("catalog no tenant access");
    },
    withoutTenant: async (fn) =>
      asOwner(async (c) => {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE app_platform_org_catalog_ro");
        try {
          const out = await fn({
            query: async <R>(sql: string, params?: readonly unknown[]) => ({
              rows: (await c.query(sql, params ? [...params] : undefined))
                .rows as R[],
            }),
          });
          await c.query("COMMIT");
          return out;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      }),
    close: async () => {},
  };
  Object.assign(app.get(PLATFORM_ORGANIZATION_REPOSITORY), { catalog });
}, 240000);
afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER, PUBLIC);
  if (previous === undefined) delete process.env.PLATFORM_SUPERUSER_EMAILS;
  else process.env.PLATFORM_SUPERUSER_EMAILS = previous;
});
const call = (user: string, path: string, body?: unknown) =>
  fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-kernel-test-principal": `${user}:${ORG}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const input = {
  name: "Public executable agent",
  description: "Simple work partner",
  instructions: "You are a helpful work partner.",
  modelId: null,
};
it("platform nonmember manages organization definitions; ordinary administrators cannot use platform routes", async () => {
  const path = `/platform/organizations/${OTHER}/ai-catalog`;
  expect((await call(ADMIN, path, { kind: "agent", input })).status).toBe(403);
  const r = await call(OPS, path, { kind: "agent", input });
  expect(r.status).toBe(201);
  const entry = await r.json();
  expect(entry.orgId).toBe(OTHER);
  expect(
    (
      await call(
        OPS,
        `/platform/organizations/${ORG}/ai-catalog/agent/${entry.id}`,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await asApp(ORG, (s) =>
        s.query("SELECT id FROM agents WHERE id=$1", [entry.id]),
      )
    ).rows,
  ).toHaveLength(0);
});
it("published public Agent requires administrator enablement and becomes a real member-directory candidate; disabled originals cannot be newly enabled", async () => {
  const path = `/platform/organizations/${PUBLIC}/ai-catalog`;
  const created = await call(OPS, path, { kind: "agent", input });
  expect(created.status).toBe(201);
  const source = await created.json();
  await asApp(PUBLIC, (s) =>
    s.query("UPDATE agents SET avatar=$2::jsonb WHERE id=$1", [
      source.id,
      JSON.stringify({
        kind: "illustration",
        key: "person-1",
        alt: "Public avatar",
      }),
    ]),
  );
  const offer = () =>
    call(MEMBER, `/organizations/${ORG}/public-ai-catalog?kind=agent`).then(
      (r) => r.json(),
    );
  expect(
    (await offer()).entries.some((x: { id: string }) => x.id === source.id),
  ).toBe(false);
  const pub = await call(OPS, `${path}/agent/${source.id}/publish`, {});
  expect(pub.status).toBe(201);
  const published = await pub.json();
  const body = {
    kind: "agent",
    id: source.id,
    versionId: published.versionId,
    idempotencyKey: "agent-enable-one",
  };
  expect(
    (await call(MEMBER, `/organizations/${ORG}/public-ai-catalog/enable`, body))
      .status,
  ).toBe(403);
  const enabled = await call(
    ADMIN,
    `/organizations/${ORG}/public-ai-catalog/enable`,
    body,
  );
  expect(enabled.status).toBe(201);
  const local = await enabled.json();
  expect(
    (
      await asApp(ORG, (s) =>
        s.query<{ avatar: { key: string } }>(
          "SELECT avatar FROM agent_versions WHERE id=$1",
          [local.versionId],
        ),
      )
    ).rows[0]?.avatar?.key,
  ).toBe("person-1");
  expect(
    (
      await call(ADMIN, `/organizations/${ORG}/public-ai-catalog/enable`, {
        ...body,
        kind: "skill",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(ADMIN, `/organizations/${ORG}/public-ai-catalog/enable`, {
        ...body,
        id: "another-id",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(ADMIN, `/organizations/${ORG}/public-ai-catalog/enable`, {
        ...body,
        versionId: "another-version",
      })
    ).status,
  ).toBe(409);
  const directory = await call(MEMBER, "/agents/directory");
  expect(directory.status).toBe(200);
  const data = await directory.json();
  expect(JSON.stringify(data)).toContain(local.id);
  expect(
    (
      await asApp(ORG, (s) =>
        s.query(
          "SELECT id FROM agent_versions WHERE org_id=$1 AND id=$2 AND instructions=$3",
          [ORG, local.versionId, input.instructions],
        ),
      )
    ).rows,
  ).toHaveLength(1);
  const db = app.get<DatabasePort>(DATABASE_PORT);
  const reader = new PgPublishedAgentReader(db);
  const workflow = new PgWorkflowAccess(db);
  expect(await reader.resolvePublished(toOrgId(ORG), local.id)).not.toBeNull();
  expect(
    await workflow.runnableAgentVersion(ORG, MEMBER, local.id, "fixture"),
  ).toBe(local.versionId);
  expect(
    (
      await call(
        OPS,
        `/platform/organizations/${ORG}/ai-catalog/agent/${local.id}/disable`,
        {},
      )
    ).status,
  ).toBe(201);
  expect(await reader.resolvePublished(toOrgId(ORG), local.id)).toBeNull();
  expect(
    await workflow.runnableAgentVersion(ORG, MEMBER, local.id, "fixture"),
  ).toBeNull();
  expect(
    await workflow.publishedWorkflowAllowlist(ORG, MEMBER, local.id),
  ).toBeNull();
  expect(
    (await call(OPS, `${path}/agent/${source.id}/disable`, {})).status,
  ).toBe(201);
  expect(
    (
      await call(ADMIN, `/organizations/${ORG}/public-ai-catalog/enable`, {
        ...body,
        idempotencyKey: "after-disable",
      })
    ).status,
  ).toBe(404);
  expect(await reader.resolvePublished(toOrgId(PUBLIC), source.id)).toBeNull();
  const stoppedPublish = await call(
    OPS,
    `${path}/agent/${source.id}/publish`,
    {},
  );
  expect(stoppedPublish.status).toBe(409);
  expect(await stoppedPublish.json()).toMatchObject({
    reasonCode: "CATALOG_ENTRY_NOT_DRAFT",
  });
});
it("draft edits preserve executable instructions, bounded pagination and real actor audit; invalid definitions do not publish", async () => {
  const path = `/platform/organizations/${OTHER}/ai-catalog`;
  const draftResponse = await call(OPS, path, {
    kind: "agent",
    input: { ...input, name: "Editable draft", instructions: "" },
  });
  expect(draftResponse.status).toBe(201);
  const draft = await draftResponse.json();
  const rejected = await call(OPS, `${path}/agent/${draft.id}/publish`, {});
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({
    reasonCode: "AGENT_NO_EXECUTABLE_DEFINITION",
  });
  const edit = await fetch(base + `${path}/agent/${draft.id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-kernel-test-principal": `${OPS}:${ORG}`,
    },
    body: JSON.stringify({
      kind: "agent",
      input: { ...input, name: "Edited draft" },
    }),
  });
  expect(edit.status).toBe(200);
  const detail = await call(OPS, `${path}/agent/${draft.id}`);
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({
    entry: { name: "Edited draft" },
    definition: { kind: "agent", input: { instructions: input.instructions } },
  });
  const pageResponse = await call(
    OPS,
    `/platform/ai-catalog?kind=agent&orgId=${OTHER}&limit=1`,
  );
  expect(pageResponse.status).toBe(200);
  const page = await pageResponse.json();
  expect(page.entries).toHaveLength(1);
  expect(page.nextCursor).toBeTruthy();
  const second = await call(
    OPS,
    `/platform/ai-catalog?kind=agent&orgId=${OTHER}&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
  );
  expect(second.status).toBe(200);
  expect((await second.json()).entries[0].id).not.toBe(page.entries[0].id);
  const audit = await asApp(OTHER, (s) =>
    s.query<{ actor_id: string; action: string }>(
      "SELECT actor_id,action FROM ai_catalog_changes WHERE org_id=$1 AND entity_id=$2 ORDER BY id",
      [OTHER, draft.id],
    ),
  );
  expect(audit.rows).toEqual([
    { actor_id: OPS, action: "create" },
    { actor_id: OPS, action: "update" },
  ]);
});
it("all-organization pagination includes public and continues across empty organizations; private entries remain absent from member public catalogs", async () => {
  const privateResponse = await call(
    OPS,
    `/platform/organizations/${OTHER}/ai-catalog`,
    { kind: "agent", input: { ...input, name: "Private only" } },
  );
  expect(privateResponse.status).toBe(201);
  const privateEntry = await privateResponse.json();
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r = await call(
      OPS,
      `/platform/ai-catalog?kind=agent&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    expect(r.status).toBe(200);
    const page = await r.json();
    for (const entry of page.entries) seen.add(entry.id);
    cursor = page.nextCursor;
    expect(++pages).toBeLessThan(50);
  } while (cursor);
  expect(seen.has(privateEntry.id)).toBe(true);
  const sourceIds = await asApp(PUBLIC, (s) =>
    s.query<{ id: string }>("SELECT id FROM agents WHERE org_id=$1", [PUBLIC]),
  );
  for (const row of sourceIds.rows) expect(seen.has(row.id)).toBe(true);
  const offers = await call(
    MEMBER,
    `/organizations/${ORG}/public-ai-catalog?kind=agent`,
  );
  expect(JSON.stringify(await offers.json())).not.toContain(privateEntry.id);
  expect(
    (await call(MEMBER, `/agents/directory/${privateEntry.id}`)).status,
  ).toBe(404);
  const disabled = await call(
    OPS,
    `/platform/organizations/${OTHER}/ai-catalog/agent/${privateEntry.id}/disable`,
    {},
  );
  expect(disabled.status).toBe(201);
  const audit = await asApp(OTHER, (s) =>
    s.query<{ actor_id: string; action: string }>(
      "SELECT actor_id,action FROM ai_catalog_changes WHERE entity_id=$1 ORDER BY id",
      [privateEntry.id],
    ),
  );
  expect(audit.rows).toEqual([
    { actor_id: OPS, action: "create" },
    { actor_id: OPS, action: "disable" },
  ]);
});
it("editing a published Agent stages a new revision without changing the running immutable version", async () => {
  const path = `/platform/organizations/${OTHER}/ai-catalog`;
  const created = await call(OPS, path, {
    kind: "agent",
    input: { ...input, name: "Versioned Agent" },
  });
  expect(created.status).toBe(201);
  const agent = await created.json();
  const published = await call(OPS, `${path}/agent/${agent.id}/publish`, {});
  expect(published.status).toBe(201);
  const v1 = await published.json();
  const revised = {
    ...input,
    name: "Revised Agent",
    instructions: "Version two instructions, explicitly authored.",
  };
  const edit = await fetch(base + `${path}/agent/${agent.id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-kernel-test-principal": `${OPS}:${ORG}`,
    },
    body: JSON.stringify({ kind: "agent", input: revised }),
  });
  expect(edit.status).toBe(200);
  const detail = await call(OPS, `${path}/agent/${agent.id}`);
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({
    entry: { versionId: v1.versionId },
    definition: { kind: "agent", input: revised },
  });
  const reader = new PgPublishedAgentReader(
    app.get<DatabasePort>(DATABASE_PORT),
  );
  expect(
    (await reader.resolvePublished(toOrgId(OTHER), agent.id))?.instructions,
  ).toBe(input.instructions);
  const oldModel = (await reader.resolvePublished(toOrgId(OTHER), agent.id))!;
  const previousDefault = process.env.KERNEL_DEFAULT_AGENT_MODEL_ID;
  process.env.KERNEL_DEFAULT_AGENT_MODEL_ID =
    "a-new-default-that-must-not-replace-frozen-model";
  let publishAgain: Response;
  try {
    publishAgain = await call(OPS, `${path}/agent/${agent.id}/publish`, {});
  } finally {
    if (previousDefault === undefined)
      delete process.env.KERNEL_DEFAULT_AGENT_MODEL_ID;
    else process.env.KERNEL_DEFAULT_AGENT_MODEL_ID = previousDefault;
  }
  expect(
    (await reader.resolvePublished(toOrgId(OTHER), agent.id))?.modelId,
  ).toBe(oldModel.modelId);
  expect(
    (await reader.resolvePublished(toOrgId(OTHER), agent.id))?.modelProvider,
  ).toBe(oldModel.modelProvider);
  expect(publishAgain.status).toBe(201);
  const v2 = await publishAgain.json();
  expect(v2.versionId).not.toBe(v1.versionId);
  expect(
    (await reader.resolvePublished(toOrgId(OTHER), agent.id))?.instructions,
  ).toBe(revised.instructions);
  const immutable = await asApp(OTHER, (s) =>
    s.query<{ id: string; instructions: string }>(
      "SELECT id,instructions FROM agent_versions WHERE org_id=$1 AND agent_id=$2 ORDER BY id",
      [OTHER, agent.id],
    ),
  );
  expect(immutable.rows).toEqual(
    expect.arrayContaining([
      { id: v1.versionId, instructions: input.instructions },
      { id: v2.versionId, instructions: revised.instructions },
    ]),
  );
});
it("frozen dependencies in an imported base cannot be silently dropped by an empty draft definition", async () => {
  const path = `/platform/organizations/${OTHER}/ai-catalog`;
  const created = await call(OPS, path, {
    kind: "agent",
    input: { ...input, name: "Imported runtime base" },
  });
  expect(created.status).toBe(201);
  const agent = await created.json();
  expect(
    (await call(OPS, `${path}/agent/${agent.id}/publish`, {})).status,
  ).toBe(201);
  const reader = new PgPublishedAgentReader(
    app.get<DatabasePort>(DATABASE_PORT),
  );
  const base = (await reader.resolvePublished(toOrgId(OTHER), agent.id))!;
  const importedVersion = `agent-version-imported-${agent.id}`;
  await asApp(OTHER, async (s) => {
    await insertAgentVersionFromDraft(s, {
      versionId: importedVersion,
      orgId: OTHER,
      agentId: agent.id,
      semanticLabel: "imported-frozen-capabilities",
      instructionDigest: createHash("sha256")
        .update(base.instructions)
        .digest("hex"),
      instructions: base.instructions,
      skillVersionIds: ["skill-version-imported-frozen-pin"],
      modelProvider: base.modelProvider,
      modelId: "imported-model-snapshot",
      toolPolicy: [],
      creatorId: OPS,
      at: new Date().toISOString(),
    });
    await s.query(
      "UPDATE agents SET published_version_id=$3 WHERE org_id=$1 AND id=$2",
      [OTHER, agent.id, importedVersion],
    );
  });
  const raw = await asApp(OTHER, (s) =>
    s.query<{ skill_mounts: unknown[]; tool_whitelist: unknown[] }>(
      "SELECT skill_mounts,tool_whitelist FROM agents WHERE org_id=$1 AND id=$2",
      [OTHER, agent.id],
    ),
  );
  expect(raw.rows[0]).toMatchObject({ skill_mounts: [], tool_whitelist: [] });
  const patch = await fetch(baseUrl(path, agent.id), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-kernel-test-principal": `${OPS}:${ORG}`,
    },
    body: JSON.stringify({
      kind: "agent",
      input: { ...input, instructions: "Attempted replacement" },
    }),
  });
  expect(patch.status).toBe(200);
  const published = await call(OPS, `${path}/agent/${agent.id}/publish`, {});
  expect(published.status).toBe(409);
  expect(await published.json()).toMatchObject({
    reasonCode: "CATALOG_DEPENDENCIES_REQUIRE_INSTALLATION",
  });
  const after = await reader.resolvePublished(toOrgId(OTHER), agent.id);
  expect(after).toMatchObject({
    agentVersionId: importedVersion,
    skillVersionIds: ["skill-version-imported-frozen-pin"],
    modelId: "imported-model-snapshot",
    instructions: base.instructions,
  });
});
function baseUrl(path: string, id: string) {
  return `${base}${path}/agent/${id}`;
}
