import "reflect-metadata";
import { beforeAll, afterAll, expect, it } from "vitest";
import { Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { createDeletionHttpDeps } from "../../src/infrastructure/files/deletion.providers";
import { DELETION_HTTP_DEPS } from "../../src/application/files/deletion-http-deps";
import { FilesDeletionController } from "../../src/interface/controllers/files-deletion.controller";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
import { PgDeletionTaskRepository, PgCascadeInvalidationRepository } from "../../src/infrastructure/files/pg-deletion-repository";
import { PgDeletionReceiptRepository } from "../../src/infrastructure/files/pg-physical-delete-repository";
import { PgLegalHoldWriteRepository } from "../../src/infrastructure/files/pg-legal-hold-write-repository";
import { maintainPhysicalDeletion } from "../../src/infrastructure/files/physical-deletion-maintenance";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { FsPhysicalPurge } from "../../src/infrastructure/storage/fs-physical-purge";
import { CASCADE_KINDS } from "../../src/domain/files/deletion-cascade";
import { toOrgId } from "../../src/domain/org-id";
import { FilesExportController } from "../../src/interface/controllers/files-export.controller";
import { PgExportContentRepository, PgExportJobRepository } from "../../src/infrastructure/files/pg-export-repository";
import { EXPORT_CONTENT_REPOSITORY, EXPORT_JOB_REPOSITORY, ZIP_BUILDER } from "../../src/application/files/export-ports";
import { DOWNLOAD_URL_BUILDER } from "../../src/application/files/download-ports";
import { OBJECT_STORE, ID_FACTORY } from "../../src/application/artifact/ports";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY } from "../../src/application/identity/ports";
import { PROVENANCE_WRITER } from "../../src/application/provenance/ports";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { NodeZipBuilder, readZip } from "../../src/infrastructure/files/zip-codec";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { deletionLockKey } from "../../src/infrastructure/files/deletion-lock";

const ORG = toOrgId("org-cloud-files-3427"), OTHER = toOrgId("org-cloud-files-other-3427"), PROJECT = "project-cloud-files-3427";
let db: PgDatabase, root: string, objects: FsObjectStore;
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedOrg({ orgId: OTHER, projectId: "project-other-3427" });
  for (const user of ["cloud-fac-3427", "cloud-member-3427"]) await addOrgMember(ORG, user, "consultant", null);
  await addProjectMember(ORG, PROJECT, "cloud-fac-3427", "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, "cloud-member-3427", "member", null, false);
  db = new PgDatabase(appConfig()); root = await mkdtemp(join(tmpdir(), "cloud-maintenance-")); objects = new FsObjectStore(root);
});
afterAll(async () => { await db?.close(); await resetOrgs(ORG, OTHER); if (root) await rm(root, { recursive: true, force: true }); });

it("serves real deletion HTTP routes with project authorization and the real graph-edge cascade", async () => {
  const id = "cloud-http-artifact-3427"; await addBrowserArtifact({ orgId: ORG, projectId: PROJECT, id });
  await addBrowserArtifact({ orgId: ORG, projectId: null, id: "cloud-unscoped-3427" });
  await asApp(ORG, session => session.query(
    "INSERT INTO ontology_edges(id,org_id,src_kind,src_id,dst_kind,dst_id,relation) VALUES($1,$2,'segment',$3,'project',$4,'evidence')",
    ["cloud-http-edge-3427", ORG, `${id}-s1`, PROJECT]));
  const deps = createDeletionHttpDeps(db, new PgIdentityRepository(db), new UuidDecisionIdFactory());
  class TestModule {}
  Module({ controllers: [FilesDeletionController], providers: [
    { provide: DELETION_HTTP_DEPS, useValue: deps }, { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Record<string, string>) =>
      headers.authorization === "Bearer facilitator" ? { orgId: ORG, userId: "cloud-fac-3427" }
        : headers.authorization === "Bearer member" ? { orgId: ORG, userId: "cloud-member-3427" }
          : headers.authorization === "Bearer other-tenant" ? { orgId: OTHER, userId: "cloud-fac-3427" } : null } },
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, "127.0.0.1"); const base = await app.getUrl();
  const call = (path: string, token: string, body?: unknown) => fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    expect((await call(`/artifacts/${id}/delete-impact`, "invalid")).status).toBe(401);
    expect((await call(`/artifacts/${id}/delete-impact`, "member")).status).toBe(403);
    expect((await call(`/artifacts/${id}/delete-impact`, "facilitator")).status).toBe(200);
    expect((await call("/artifacts/cloud-unscoped-3427/delete-impact", "member")).status).toBe(404);
    const body = { reason: "compliance test", scope: "ai-only", confirmedImpact: true };
    expect((await call(`/artifacts/${id}/deletion-requests`, "facilitator", { ...body, artifactId: "different" })).status).toBe(400);
    expect((await call(`/artifacts/${id}/deletion-requests`, "facilitator", body)).status).toBe(503);
    const response = await call(`/artifacts/${id}/deletion-requests`, "facilitator", { ...body, scope: null });
    expect(response.status).toBe(201); const created = await response.json() as { taskId: string };
    const status = await call(`/deletion-tasks/${created.taskId}`, "facilitator");
    expect(status.status).toBe(200); const progress = await status.json() as { status: string; receiptId: string | null; cascadeResults: { result: string }[] };
    expect(progress).toMatchObject({ status: "running", receiptId: null });
    expect(progress.cascadeResults).toHaveLength(6); expect(progress.cascadeResults.every(item => item.result === "ok")).toBe(true);
    expect((await asApp(ORG, session => session.query("SELECT id FROM ontology_edges WHERE org_id=$1 AND id=$2", [ORG, "cloud-http-edge-3427"]))).rows).toHaveLength(0);
    expect((await call(`/deletion-tasks/${created.taskId}`, "member")).status).toBe(403);
    expect((await call(`/deletion-tasks/${created.taskId}`, "other-tenant")).status).toBe(403);
    expect((await call(`/deletion-tasks/${created.taskId}/receipt`, "facilitator")).status).toBe(403);
  } finally { await app.close(); }
});

it("invalidates both directions of graph edges and rejects foreign/mixed version references", async () => {
  const id = "cloud-edge-artifact-3427", unrelated = "cloud-edge-unrelated-3427";
  await addBrowserArtifact({ orgId: ORG, projectId: PROJECT, id });
  await addBrowserArtifact({ orgId: ORG, projectId: PROJECT, id: unrelated });
  await asApp(ORG, async session => {
    await session.query("INSERT INTO ontology_edges(id,org_id,src_kind,src_id,dst_kind,dst_id,relation) VALUES($1,$2,'segment',$3,'project',$4,'evidence'),($5,$2,'project',$4,'segment',$3,'evidence'),($6,$2,'segment',$7,'project',$4,'evidence')",
      ["cloud-edge-out-3427", ORG, `${id}-s1`, PROJECT, "cloud-edge-in-3427", "cloud-edge-keep-3427", `${unrelated}-s1`]);
  });
  const cascade = new PgCascadeInvalidationRepository(db);
  await expect(cascade.invalidateOntologyEdges(OTHER, { artifactId: id, versionIds: [`${id}-v1`] })).rejects.toThrow("ontology_version_scope_mismatch");
  await expect(cascade.invalidateOntologyEdges(ORG, { artifactId: id, versionIds: [`${id}-v1`, `${unrelated}-v1`] })).rejects.toThrow("ontology_version_scope_mismatch");
  const result = await cascade.invalidateOntologyEdges(ORG, { artifactId: id, versionIds: [`${id}-v1`] });
  expect([...result.invalidatedEdgeIds].sort()).toEqual(["cloud-edge-in-3427", "cloud-edge-out-3427"]);
  expect((await asApp(ORG, session => session.query("SELECT id FROM ontology_edges WHERE org_id=$1 AND id=$2", [ORG, "cloud-edge-keep-3427"]))).rows).toHaveLength(1);
  expect(await cascade.invalidateOntologyEdges(ORG, { artifactId: id, versionIds: [`${id}-v1`] })).toEqual({ invalidatedEdgeIds: [] });
});

it("purges eligible real file bytes, persists receipt transactionally, survives restart and respects holds", async () => {
  const id = "cloud-purge-artifact-3427", taskId = "cloud-purge-task-3427";
  await addBrowserArtifact({ orgId: ORG, projectId: PROJECT, id });
  const key = `${ORG}/artifacts/${id}/v1/${id}-v1`;
  await objects.putOnce(key, Buffer.from("original durable bytes"), "text/plain");
  await new PgDeletionTaskRepository(db).create({ id: taskId, orgId: ORG, artifactId: id,
    requestedBy: "cloud-fac-3427", actorKind: "user", reason: "test", scope: null, status: "running",
    requestedAt: new Date(0), logicalInvalidationDeadline: new Date(0), physicalDeletionDeadline: new Date(0),
    cascadeResults: CASCADE_KINDS.map(kind => ({ kind, result: "ok", detail: null })),
  });
  const holds = new PgLegalHoldWriteRepository(db);
  await holds.apply({ orgId: ORG, holdId: "hold-cloud-3427", artifactId: id, reason: "test hold", appliedBy: "cloud-fac-3427", appliedAt: new Date() });
  const purge = new FsPhysicalPurge(root);
  expect((await maintainPhysicalDeletion(db, purge, ORG)).outcomes).toContainEqual({ taskId, outcome: "skipped-not-eligible" });
  expect(await objects.get(key)).not.toBeNull();
  await holds.release({ orgId: ORG, holdId: "hold-cloud-3427", releasedBy: "cloud-fac-3427", releasedAt: new Date(), releaseReason: "released" });
  expect((await maintainPhysicalDeletion(db, purge, OTHER)).outcomes).toHaveLength(0);
  expect(await objects.get(key)).not.toBeNull();
  expect((await maintainPhysicalDeletion(db, purge, ORG)).outcomes).toContainEqual({ taskId, outcome: "deleted" });
  expect(await new FsObjectStore(root).get(key)).toBeNull();
  const restarted = new PgDatabase(appConfig());
  try {
    expect(await new PgDeletionReceiptRepository(restarted).find(ORG, taskId)).toMatchObject({ objectRefs: [key] });
    expect((await maintainPhysicalDeletion(restarted, purge, ORG)).outcomes).toHaveLength(0);
    expect(await new PgDeletionReceiptRepository(restarted).find(OTHER, taskId)).toBeNull();
  } finally { await restarted.close(); }
});

it("downloads a real ZIP via authenticated HTTP and rejects revoked sources and other tenants", async () => {
  const id = "cloud-export-http-3427"; await addBrowserArtifact({ orgId: ORG, projectId: PROJECT, id });
  const key = `${ORG}/artifacts/${id}/v1/${id}-v1`, expected = Buffer.from("exported source bytes");
  await objects.putOnce(key, expected, "text/plain");
  class ExportModule {}
  Module({ controllers: [FilesExportController], providers: [
    { provide: EXPORT_CONTENT_REPOSITORY, useValue: new PgExportContentRepository(db) },
    { provide: EXPORT_JOB_REPOSITORY, useValue: new PgExportJobRepository(db) },
    { provide: OBJECT_STORE, useValue: new FsObjectStore(root) },
    { provide: DOWNLOAD_URL_BUILDER, useValue: { build: () => { throw new Error("obsolete URL path"); } } },
    { provide: IDENTITY_REPOSITORY, useValue: new PgIdentityRepository(db) },
    { provide: DECISION_ID_FACTORY, useValue: new UuidDecisionIdFactory() },
    { provide: ID_FACTORY, useValue: new UuidIdFactory() },
    { provide: PROVENANCE_WRITER, useValue: new PgProvenanceRepository(db) },
    { provide: ZIP_BUILDER, useValue: new NodeZipBuilder() },
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async (headers: Record<string, string>) =>
      headers.authorization === "Bearer exporter" ? { orgId: ORG, userId: "cloud-fac-3427" }
        : headers.authorization === "Bearer other-tenant" ? { orgId: OTHER, userId: "cloud-fac-3427" } : null } },
  ] })(ExportModule);
  const app = await NestFactory.create(ExportModule, { logger: false }); await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const get = (path: string, token = "exporter") => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  try {
    const created = await fetch(`${base}/projects/${PROJECT}/export-jobs`, { method: "POST",
      headers: { Authorization: "Bearer exporter", "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT, artifactIds: [id], treeNodeId: null }) });
    expect(created.status).toBe(201); const job = await created.json() as { jobId: string };
    const info = await (await get(`/export-jobs/${job.jobId}`)).json() as { downloadUrl: string };
    expect(info.downloadUrl).toBe(`/export-jobs/${job.jobId}/content`);
    const content = await get(info.downloadUrl); expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toContain("application/zip");
    expect(content.headers.get("content-disposition")).toContain("attachment");
    const entries = readZip(new Uint8Array(await content.arrayBuffer()));
    expect(entries.some(entry => Buffer.from(entry.content).equals(expected))).toBe(true);
    expect((await get(info.downloadUrl, "other-tenant")).status).toBe(403);
    expect((await get(info.downloadUrl, "invalid")).status).toBe(401);
    await asApp(ORG, session => session.query("UPDATE artifacts SET deleted_at=now() WHERE org_id=$1 AND id=$2", [ORG, id]));
    expect((await get(info.downloadUrl)).status).toBe(403);
    await asApp(ORG, session => session.query("UPDATE artifacts SET deleted_at=NULL WHERE org_id=$1 AND id=$2", [ORG, id]));
  } finally { await app.close(); }
});

it("rolls back receipt/task on an audit failure and safely retries already removed bytes", async () => {
  const id = "cloud-recover-artifact-3427", taskId = "cloud-recover-task-3427";
  await addBrowserArtifact({ orgId: ORG, projectId: PROJECT, id });
  const key = `${ORG}/artifacts/${id}/v1/${id}-v1`;
  await objects.putOnce(key, Buffer.from("recovery"), "text/plain");
  await new PgDeletionTaskRepository(db).create({ id: taskId, orgId: ORG, artifactId: id,
    requestedBy: "cloud-fac-3427", actorKind: "user", reason: "test", scope: null, status: "running",
    requestedAt: new Date(0), logicalInvalidationDeadline: new Date(0), physicalDeletionDeadline: new Date(0),
    cascadeResults: CASCADE_KINDS.map(kind => ({ kind, result: "ok", detail: null })),
  });
  const failing: DatabasePort = { close: async () => {}, withoutTenant: db.withoutTenant.bind(db),
    withTenant: (orgId, work) => db.withTenant(orgId, session => {
      const wrapped: TenantSession = { query: (sql, params) => {
        if (sql.includes("INSERT INTO provenance_events")) throw new Error("injected audit outage");
        return session.query(sql, params);
      } };
      return work(wrapped);
    }),
  };
  const purge = new FsPhysicalPurge(root);
  await expect(maintainPhysicalDeletion(failing, purge, ORG)).rejects.toThrow("injected audit outage");
  expect(await objects.get(key)).toBeNull();
  expect(await new PgDeletionReceiptRepository(db).find(ORG, taskId)).toBeNull();
  expect(await new PgDeletionTaskRepository(db).getTask(ORG, taskId)).toMatchObject({ status: "running", receiptId: null });
  expect((await maintainPhysicalDeletion(db, purge, ORG)).outcomes).toContainEqual({ taskId, outcome: "deleted" });
});

it("returns busy when another process owns this tenant's physical deletion transaction", async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const lock = db.withTenant(ORG, async session => {
    await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [deletionLockKey(ORG)]);
    entered(); await gate;
  });
  await started; const another = new PgDatabase(appConfig());
  try { expect(await maintainPhysicalDeletion(another, new FsPhysicalPurge(root), ORG)).toEqual({ status: "busy", outcomes: [] }); }
  finally { release(); await lock; await another.close(); }
});
