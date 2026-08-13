/**
 * F154 L2 —— `PgAgentRunRepository.readThreadContextState` / `upsertThreadContextState` 的
 * **真实 Postgres** 反证。跟 `attachment-history-sql.test.ts` 同一理由：内存 fake（execute-run
 * 的单测都用它）只能证明「execute-run 会读/写这两个方法」，证不了 SQL 本身——尤其是
 * `upsertThreadContextState` 的乐观并发 WHERE 子句，纯内存写一个字都覆盖不到。
 *
 * 覆盖：①未摘要过读 null ②首次 upsert（expectedVersion=0）落 version=1 ③读出刚写的 ④按当前
 * version 增量 upsert 成功、version+1 ⑤撞并发（expectedVersion 落后于现存 version）→ 不静默覆盖、
 * 回 false、现有行原样不动 ⑥RLS：另一个 org 读不到。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f154-ctx";
const ORG2 = "org-f154-ctx-other";
const PROJECT = "proj-f154-ctx";
const THREAD = "thr-f154-ctx";
const ACTOR = "u-f154-ctx";

let db: PgDatabase;
let repo: PgAgentRunRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG, ORG2);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await seedOrg({ orgId: ORG2, projectId: `${PROJECT}-2` });
});

afterAll(async () => {
  await db.close();
});

describe("thread_context_state（真库反证）", () => {
  it("还没摘要过 → 读 null", async () => {
    const state = await repo.readThreadContextState(toOrgId(ORG), THREAD);
    expect(state).toBeNull();
  });

  it("首次 upsert（expectedVersion=0）落一行，version=1，读回内容一致", async () => {
    const org = toOrgId(ORG);
    const ok = await repo.upsertThreadContextState(org, THREAD, {
      summary: "用户在讨论巴伐利亚站点选址的三条致命假设。",
      summarizedThroughId: "m-100",
      summarizedThroughAt: "2026-08-12T10:00:00.000Z",
      expectedVersion: 0,
    });
    expect(ok).toBe(true);

    const state = await repo.readThreadContextState(org, THREAD);
    expect(state).toEqual({
      summary: "用户在讨论巴伐利亚站点选址的三条致命假设。",
      summarizedThroughId: "m-100",
      summarizedThroughAt: "2026-08-12T10:00:00.000Z",
      version: 1,
    });
  });

  it("按当前 version 增量 upsert 成功，version 自增；旧游标被新游标替换", async () => {
    const org = toOrgId(ORG);
    await repo.upsertThreadContextState(org, THREAD, {
      summary: "第一版摘要", summarizedThroughId: "m-100",
      summarizedThroughAt: "2026-08-12T10:00:00.000Z", expectedVersion: 0,
    });

    const ok = await repo.upsertThreadContextState(org, THREAD, {
      summary: "第二版摘要（折进了 m-100 之后的新消息）",
      summarizedThroughId: "m-140",
      summarizedThroughAt: "2026-08-12T10:30:00.000Z",
      expectedVersion: 1,
    });
    expect(ok).toBe(true);

    const state = await repo.readThreadContextState(org, THREAD);
    expect(state).toEqual({
      summary: "第二版摘要（折进了 m-100 之后的新消息）",
      summarizedThroughId: "m-140",
      summarizedThroughAt: "2026-08-12T10:30:00.000Z",
      version: 2,
    });
  });

  it("撞并发（expectedVersion 落后于现存 version）→ 不静默覆盖，回 false，现有行原样不动", async () => {
    const org = toOrgId(ORG);
    await repo.upsertThreadContextState(org, THREAD, {
      summary: "权威版本", summarizedThroughId: "m-100",
      summarizedThroughAt: "2026-08-12T10:00:00.000Z", expectedVersion: 0,
    });
    // 现存 version=1，这里仍传 expectedVersion=0（模拟「读到旧状态后才写」的并发者）。
    const ok = await repo.upsertThreadContextState(org, THREAD, {
      summary: "过期并发写——不该生效",
      summarizedThroughId: "m-999",
      summarizedThroughAt: "2026-08-12T11:00:00.000Z",
      expectedVersion: 0,
    });
    expect(ok).toBe(false);

    // 权威版本原样不动——过期写没有半点渗透进去。
    const state = await repo.readThreadContextState(org, THREAD);
    expect(state).toEqual({
      summary: "权威版本", summarizedThroughId: "m-100",
      summarizedThroughAt: "2026-08-12T10:00:00.000Z", version: 1,
    });
  });

  it("首次并发竞态：两个 expectedVersion=0 同时写，一个成功一个 false（不会都成功产生两行/双写）", async () => {
    const org = toOrgId(ORG);
    const [a, b] = await Promise.all([
      repo.upsertThreadContextState(org, THREAD, {
        summary: "写者 A", summarizedThroughId: "m-a",
        summarizedThroughAt: "2026-08-12T10:00:00.000Z", expectedVersion: 0,
      }),
      repo.upsertThreadContextState(org, THREAD, {
        summary: "写者 B", summarizedThroughId: "m-b",
        summarizedThroughAt: "2026-08-12T10:00:01.000Z", expectedVersion: 0,
      }),
    ]);
    // 恰好一个 true 一个 false——INSERT 唯一约束（PK=thread_id）保证不会两个都插入成功。
    expect([a, b].filter(Boolean)).toHaveLength(1);

    const state = await repo.readThreadContextState(org, THREAD);
    expect(state?.version).toBe(1);
    expect(["写者 A", "写者 B"]).toContain(state?.summary);
  });

  it("RLS：另一个 org 读不到（跨租户隔离，不是应用层过滤）", async () => {
    await repo.upsertThreadContextState(toOrgId(ORG), THREAD, {
      summary: "org 1 的摘要", summarizedThroughId: "m-1",
      summarizedThroughAt: "2026-08-12T10:00:00.000Z", expectedVersion: 0,
    });
    // ORG2 视角下同一个 thread_id 字符串查不到——RLS 用 org_id 过滤，不是靠 thread_id 唯一性。
    const state = await repo.readThreadContextState(toOrgId(ORG2), THREAD);
    expect(state).toBeNull();

    // 直接查真库确认：这一行确实带着 org_id=ORG，没有跨租户串行。
    const row = await asApp(ORG, (c) => c.query<{ org_id: string }>(
      `SELECT org_id FROM thread_context_state WHERE thread_id=$1`, [THREAD],
    ));
    expect(row.rows[0]!.org_id).toBe(ORG);
  });
});
