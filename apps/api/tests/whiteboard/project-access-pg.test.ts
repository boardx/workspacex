/**
 * #4615 W2（人类裁决 ④）—— 挂在项目上的白板对项目成员开放，与白板自己的成员表取并集。真实 PostgreSQL。
 *
 * ⚠ 本文件在提交时**未在本地执行**（本切片不跑 PG；见回报）。用工作坊容器验证（`project_memberships`，不依赖 W1）；
 *   通用项目负责人 / 协作者的映射走同一个 `resolveProjectLayer`，DB-free 覆盖见 tests/project/project-workspace-w2.test.ts。
 *
 * 钉住：
 *   · 白板没挂在项目上 ⇒ 项目成员看不到（私有白板照旧）；
 *   · 挂上之后：项目成员（非白板成员）可读可写、观察者只读（写 ⇒ FORBIDDEN）、组织里的局外人仍 NOT_FOUND；
 *   · repository.get 给出借来的角色；白板 viewer + 项目成员 ⇒ editor（并集）；
 *   · 被移出项目 ⇒ 下一次读写即 NOT_FOUND；白板解挂 ⇒ 项目来源消失，但白板成员表里的人不受影响。
 * （项目归档 ⇒ 借来的角色降为只读：DB-free 覆盖，见 project-workspace-w2.test.ts。）
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WhiteboardCommand } from "@repo/whiteboard-core";
import { toOrgId } from "../../src/domain/org-id";
import type { Principal } from "../../src/domain/principal";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgWhiteboardCollaborationStore } from "../../src/infrastructure/whiteboard/pg-collaboration-store";
import { PgWhiteboardProjectAccess } from "../../src/infrastructure/whiteboard/pg-whiteboard-project-access";
import { PgWhiteboardRepository } from "../../src/infrastructure/whiteboard/pg-whiteboard-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "wb-4615-project-access";
const orgId = toOrgId(ORG);
const PROJECT = `${ORG}-p`;
const actor = (userId: string): Principal => ({ userId, orgId });
const owner = actor("wb4615-owner"), member = actor("wb4615-member"), observer = actor("wb4615-observer");
const boardViewer = actor("wb4615-board-viewer"), outsider = actor("wb4615-outsider");
let db: PgDatabase, repo: PgWhiteboardRepository, store: PgWhiteboardCollaborationStore, objectRoot: string;

const note = (id: string): WhiteboardCommand => ({
  type: "create",
  object: { id, schemaVersion: 1, kind: "sticky", text: "项目便签", style: {}, parentId: null, orderKey: "", geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } },
});
const write = (p: Principal, boardId: string, id: string) =>
  store.writeCommands(p, boardId, { epoch: 1, requestId: randomUUID(), commands: [note(id)] });
const linkBoard = (boardId: string) => asApp(ORG, (c) => c.query(
  "INSERT INTO project_resource_links (org_id, project_id, kind, resource_id, linked_by) VALUES ($1, $2, 'whiteboard', $3, $4)",
  [ORG, PROJECT, boardId, owner.userId],
));
const unlinkBoard = (boardId: string) => asApp(ORG, (c) => c.query(
  "DELETE FROM project_resource_links WHERE org_id = $1 AND kind = 'whiteboard' AND resource_id = $2", [ORG, boardId],
));

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  for (const p of [owner, member, observer, boardViewer, outsider]) await addOrgMember(ORG, p.userId, "consultant", null);
  await addProjectMember(ORG, PROJECT, owner.userId, "facilitator", null);
  await addProjectMember(ORG, PROJECT, member.userId, "member", null);
  await addProjectMember(ORG, PROJECT, observer.userId, "observer", null);
  await addProjectMember(ORG, PROJECT, boardViewer.userId, "member", null);
  db = new PgDatabase(appConfig());
  objectRoot = await mkdtemp(join(tmpdir(), "wb-project-access-"));
  const projectAccess = new PgWhiteboardProjectAccess();
  repo = new PgWhiteboardRepository(db, undefined, projectAccess);
  store = new PgWhiteboardCollaborationStore(db, undefined, undefined, new FsObjectStore(objectRoot), projectAccess);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
  if (objectRoot) await rm(objectRoot, { recursive: true, force: true });
}, 120_000);

describe("白板访问的项目来源（真实 PG）", () => {
  it("没挂在项目上：项目成员看不到、写不了（私有白板照旧）", async () => {
    const board = await repo.create(owner, { requestId: randomUUID(), name: "私有白板" });
    expect(await repo.get(member, board.id)).toBeNull();
    await expect(store.load(member, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(write(member, board.id, "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("挂上之后：成员可读可写、观察者只读、局外人 NOT_FOUND；get 给出借来的角色", async () => {
    const board = await repo.create(owner, { requestId: randomUUID(), name: "项目白板" });
    await linkBoard(board.id);
    expect(await repo.get(member, board.id)).toMatchObject({ id: board.id, role: "editor" });
    expect(await repo.get(observer, board.id)).toMatchObject({ id: board.id, role: "viewer" });
    expect(await repo.get(outsider, board.id)).toBeNull();
    await expect(write(member, board.id, "m1")).resolves.toMatchObject({ seq: 1 });
    expect((await store.load(observer, board.id)).role).toBe("viewer");
    await expect(write(observer, board.id, "o1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(store.load(outsider, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("并集：白板 viewer + 项目成员 ⇒ editor；解挂后白板成员表里的人仍是 viewer、其余项目成员失去访问", async () => {
    const board = await repo.create(owner, { requestId: randomUUID(), name: "并集白板" });
    await repo.putMember(owner, board.id, { userId: boardViewer.userId, role: "viewer" });
    await linkBoard(board.id);
    expect(await repo.get(boardViewer, board.id)).toMatchObject({ role: "editor" });
    await expect(write(boardViewer, board.id, "bv1")).resolves.toMatchObject({ seq: 1 });
    await unlinkBoard(board.id);
    expect(await repo.get(boardViewer, board.id)).toMatchObject({ role: "viewer" });
    await expect(write(boardViewer, board.id, "bv2")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await repo.get(member, board.id)).toBeNull();
    await expect(store.load(member, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("被移出项目 ⇒ 下一次读写即 NOT_FOUND", async () => {
    const board = await repo.create(owner, { requestId: randomUUID(), name: "移出白板" });
    await linkBoard(board.id);
    const leaver = actor("wb4615-leaver");
    await addOrgMember(ORG, leaver.userId, "consultant", null);
    await addProjectMember(ORG, PROJECT, leaver.userId, "member", null);
    await expect(write(leaver, board.id, "l1")).resolves.toMatchObject({ seq: 1 });
    await asApp(ORG, (c) => c.query("DELETE FROM project_memberships WHERE org_id = $1 AND project_id = $2 AND user_id = $3", [ORG, PROJECT, leaver.userId]));
    await expect(store.load(leaver, board.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(write(leaver, board.id, "l2")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
