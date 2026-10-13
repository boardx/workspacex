import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { chatShare as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg, asOwner } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { OBJECT_STORE, type ObjectStore } from "../../src/application/artifact/ports";
import { PgChatShareRepository } from "../../src/infrastructure/chat/pg-chat-share-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shareHash } from "../../src/application/chat/share-chat";

const objectRoot = mkdtempSync(join(tmpdir(), "wsx-share-http-"));
process.env.WORKSPACEX_OBJECT_ROOT = objectRoot;
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const ORG = "org-public-share-http", OWNER = "u-share-owner", OTHER = "u-share-other", THREAD = "t-public-share";
const as = (userId = OWNER, orgId = ORG) => ({ "x-kernel-test-principal": userId + ":" + orgId });
let base: string, app: NestExpressApplication;
const manage = () => base + "/chat/threads/" + THREAD + "/shares";
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp(); await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = "http://127.0.0.1:" + (typeof address === "object" && address ? address.port : 0);
}, 180000);
afterAll(async () => { await app?.close(); await resetOrgs([ORG, ORG + "-other"]); rmSync(objectRoot, { recursive: true, force: true }); });
beforeEach(async () => {
  await resetOrgs([ORG, ORG + "-other"]);
  await seedOrg({ orgId: ORG, projectId: "p-share-unused" });
  await addOrgMember(ORG, OWNER, "consultant", null); await addOrgMember(ORG, OTHER, "consultant", null);
  await seedOrg({ orgId: ORG + "-other", projectId: "p-share-other" });
  await addOrgMember(ORG + "-other", OWNER, "consultant", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: null, createdBy: OWNER, visibilityScope: "private", title: "我的分享对话" });
  await addChatMessage({ orgId: ORG, id: "m-share-human", threadId: THREAD, authorId: OWNER, authorKind: "human", body: "你好，朋友" });
  await addChatMessage({ orgId: ORG, id: "m-share-ai", threadId: THREAD, authorId: "a-share", authorKind: "agent", body: "回答包含 **Markdown** 和代码。", agentId: null });
});
async function publish() {
  const previewResponse = await fetch(base + "/chat/threads/" + THREAD + "/share-preview", { headers: as() });
  expect(previewResponse.status).toBe(200);
  const preview = C.Preview.parse(await previewResponse.json());
  const response = await fetch(manage(), { method: "POST", headers: { ...as(), "Content-Type": "application/json" }, body: JSON.stringify({ revision: preview.revision }) });
  expect(response.status).toBe(201);
  return { ...C.Created.parse(await response.json()), preview };
}
describe("real HTTP and PostgreSQL anonymous sharing", () => {
  it("reads without an account, persists across repository instances, and freezes the original conversation", async () => {
    const { token, preview } = await publish();
    await addChatMessage({ orgId: ORG, id: "m-after-share", threadId: THREAD, authorId: OWNER, authorKind: "human", body: "后续私密消息" });
    const response = await fetch(base + "/chat/shares/" + token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const output = C.PublicSnapshot.parse(await response.json());
    expect(output.snapshot).toEqual(preview.snapshot);
    expect(JSON.stringify(output)).not.toMatch(/后续私密|org-public-share|u-share-owner|t-public-share/);
    const rows = await asApp(ORG, c => c.query("SELECT token_hash FROM chat_public_shares WHERE thread_id=$1", [THREAD]));
    expect(rows.rows[0]?.token_hash).toBe(shareHash(token));
    const db = new PgDatabase(appConfig());
    try { expect(await new PgChatShareRepository(db).findByTokenHash(shareHash(token))).not.toBeNull(); }
    finally { await db.close(); }
    expect((await asApp(null, c => c.query("SELECT id FROM chat_public_shares"))).rows).toEqual([]);
    expect((await asApp(ORG + "-other", c => c.query("SELECT id FROM chat_public_shares"))).rows).toEqual([]);
  });
  it("keeps creation private, rejects another user/tenant and allows only the creator to revoke", async () => {
    expect((await fetch(manage())).status).toBe(401);
    expect((await fetch(base + "/chat/threads/" + THREAD + "/share-preview", { headers: as(OTHER) })).status).toBe(404);
    expect((await fetch(base + "/chat/threads/" + THREAD + "/share-preview", { headers: as(OWNER, ORG + "-other") })).status).toBe(404);
    const { token, share } = await publish();
    const path = manage() + "/" + share.id;
    expect((await fetch(path, { method: "DELETE", headers: as(OTHER) })).status).toBe(404);
    expect((await fetch(base + "/chat/shares/" + token)).status).toBe(200);
    expect((await fetch(path, { method: "DELETE", headers: as() })).status).toBe(204);
    const revoked = await fetch(base + "/chat/shares/" + token);
    expect(revoked.status).toBe(404);
    expect((await fetch(base + "/chat/shares/" + "b".repeat(43))).status).toBe(404);
  });
  it("rejects stale preview, without creating a token", async () => {
    const response = await fetch(base + "/chat/threads/" + THREAD + "/share-preview", { headers: as() });
    const preview = C.Preview.parse(await response.json());
    await addChatMessage({ orgId: ORG, id: "m-share-extra", threadId: THREAD, authorId: OWNER, authorKind: "human", body: "尚未预览" });
    const created = await fetch(manage(), { method: "POST", headers: { ...as(), "Content-Type": "application/json" }, body: JSON.stringify({ revision: preview.revision }) });
    expect(created.status).toBe(409);
    expect((await fetch(manage(), { headers: as() }).then(r => r.json())).shares).toEqual([]);
  });
  it("stops public reading when the organization is disabled or the source thread is deleted", async () => {
    const { token } = await publish();
    await asOwner(c => c.query("UPDATE organizations SET status='disabled',disabled_at=now(),retention_until=now()+interval '30 days' WHERE id=$1", [ORG]));
    expect((await fetch(base + "/chat/shares/" + token)).status).toBe(404);
    await asOwner(c => c.query("UPDATE organizations SET status='active',disabled_at=NULL,retention_until=NULL WHERE id=$1", [ORG]));
    expect((await fetch(base + "/chat/shares/" + token)).status).toBe(200);
    await asApp(ORG, c => c.query("DELETE FROM chat_threads WHERE id=$1 AND org_id=$2", [THREAD, ORG]));
    expect((await fetch(base + "/chat/shares/" + token)).status).toBe(404);
  });
  it("copies real raster image bytes into the snapshot without exposing its private storage reference", async () => {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5T8AAAAASUVORK5CYII=", "base64");
    const key = "share-test/" + crypto.randomUUID();
    await app.get<ObjectStore>(OBJECT_STORE).putOnce(key, bytes, "image/png");
    await asApp(ORG, c => c.query(`INSERT INTO chat_message_attachments(id,org_id,thread_id,message_id,filename,mime,bytes,storage_ref,uploaded_by)
      VALUES ('att-share',$1,$2,'m-share-human','图片.png','image/png',$3,$4,$5)`, [ORG, THREAD, bytes.length, key, OWNER]));
    const { token } = await publish();
    const response = await fetch(base + "/chat/shares/" + token).then(r => r.json());
    const output = C.PublicSnapshot.parse(response);
    const image = output.snapshot.messages.flatMap(m => m.attachments).find(a => a.mime === "image/png");
    expect(image?.imageData).toBe("data:image/png;base64," + bytes.toString("base64"));
    expect(JSON.stringify(output)).not.toContain(key);
  });
});
