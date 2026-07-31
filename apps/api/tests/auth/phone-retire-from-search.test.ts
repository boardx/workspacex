/**
 * F14（UC-1.2 R7 / I-34 ②）：撤回后「关联可识别信息退出检索范围」。
 *
 * 本仓没有独立的搜索索引——F12 的 `joinByGroupLink` 按
 * `(project_id, contact_kind='phone', contact)` 直接查 `project_participants`，
 * 这张表的这条查询就是「检索范围」本身（见 `pg-invite-link-repository.ts` 该查询
 * 上方的 F14 注释）。⇒ 本文件断言的形状是：撤回触发**之后**，同一手机号走 F12 的
 * 进场路径，结果与「这个手机号从未在名单里」相同——**同一事务**内触发，不是等到
 * 某个后台任务把它从别处删掉，所以这里**不需要**等待、不需要假时钟推进 5 分钟。
 *
 * 反证：如果 `withdrawn_at` 这一列或那条 `AND withdrawn_at IS NULL` 被删掉，
 * 「撤回后仍能查到」这条本应变红的断言必须真的变红——本文件同时保留一条
 * 「撤回前仍能正常查到」的对照组，证明这条查询本身没有被误伤成恒失败。
 *
 * ⚠ 本地不跑—— issue #74：依赖真实 Postgres，本地只对它跑 typecheck，CI 才执行。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withdrawParticipantPhone } from "../../src/application/auth/withdraw-participant-phone";
import { issueInviteLink } from "../../src/application/auth/issue-invite-link";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { facilitator, fixedIds, newDb, repos, toOrgId } from "../support/join";

const ORG = "org-f14-retire-search";
const PROJECT = `${ORG}-p`;
const HOST = "u-f14-retire-host";
const HOOK_TIMEOUT_MS = 60_000;

const PARTICIPANT_ID = "pp-f14-retire-1";
const PHONE_NORMALIZED = "8613900001234";

let db: PgDatabase;
let R: ReturnType<typeof repos>;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const orgId = toOrgId(ORG);
const guestIds = fixedIds("gi-f14-retire");

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = newDb();
  R = repos(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
  await R.roster.upsert(orgId, PROJECT, HOST, [
    {
      participantId: PARTICIPANT_ID,
      contactKind: "phone",
      contact: PHONE_NORMALIZED,
      masked: "139 •••• 1234",
      projectRole: "member",
      groupId: fixture.groups.g1 ?? null,
    },
  ]);
}, HOOK_TIMEOUT_MS);

async function issueGroupLink() {
  return issueInviteLink(
    { repo: R.links },
    {
      orgId,
      projectId: PROJECT,
      kind: "group",
      groupId: fixture.groups.g1 ?? null,
      identity: "member",
      validity: "7d",
      ...facilitator(HOST),
    },
  );
}

describe("对照组：撤回之前，该手机号仍能正常走 F12 进场", () => {
  it("phone-not-on-roster 不成立，能建立免注册身份", async () => {
    const link = await issueGroupLink();
    const out = await R.join.joinByGroupLink({
      token: link.token,
      phone: PHONE_NORMALIZED,
      candidateGuestIdentityId: guestIds.next(),
      now: new Date(),
    });
    expect(out.ok).toBe(true);
  });
});

describe("① 撤回触发后，同一手机号立即退出检索范围（I-34 ②）", () => {
  it("joinByGroupLink 返回 phone-not-on-roster，与从未在名单里同形", async () => {
    await withdrawParticipantPhone(
      { repo: R.withdrawal },
      {
        orgId,
        projectId: PROJECT,
        participantId: PARTICIPANT_ID,
        requestedBy: "data-subject",
        ackImpact: true,
        now: new Date(),
      },
    );

    const link = await issueGroupLink();
    const out = await R.join.joinByGroupLink({
      token: link.token,
      phone: PHONE_NORMALIZED,
      candidateGuestIdentityId: guestIds.next(),
      now: new Date(),
    });

    expect(out).toMatchObject({ ok: false, reason: "phone-not-on-roster" });
  });

  it("即使立刻查（不等待、不推进时钟），退出检索也已生效 —— 触发是同一事务，不是异步任务", async () => {
    const link = await issueGroupLink();

    const before = Date.now();
    await withdrawParticipantPhone(
      { repo: R.withdrawal },
      {
        orgId,
        projectId: PROJECT,
        participantId: PARTICIPANT_ID,
        requestedBy: "facilitator",
        ackImpact: true,
        now: new Date(before),
      },
    );
    const out = await R.join.joinByGroupLink({
      token: link.token,
      phone: PHONE_NORMALIZED,
      candidateGuestIdentityId: guestIds.next(),
      now: new Date(before),
    });
    const elapsedMs = Date.now() - before;

    expect(out).toMatchObject({ ok: false, reason: "phone-not-on-roster" });
    // 断言本身跑得快是理所当然的；这里记录耗时只是为了让「不需要等待」这句话
    // 不是一句没有证据的注释——耗时远小于 I-34 的 5 分钟 SLA。
    expect(elapsedMs).toBeLessThan(5 * 60_000);
  });
});
