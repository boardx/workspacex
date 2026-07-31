/**
 * F14（UC-1.2 R7 / I-34）：受访者手机号纳入撤回与删除范围 —— 入队与幂等。
 *
 * 断言的形状：
 *   ① 发起撤回 ⇒ 落库一张单据，`queuedAt` / 两个 deadline 都是**服务端记录值**，
 *      两个 deadline 严格等于 `queuedAt + WITHDRAWAL_SLA_MS.{logicalRetire,physicalDelete}`
 *      （反证：不是随手拼的字符串，见下方专门一节）。
 *   ② 同一 `requestedBy` 重放 ⇒ 返回**同一张**单据（`queuedAt` 逐字节相同），不产生第二条。
 *   ③ 不同 `requestedBy` 对同一 `participantId` 再发起 ⇒ `WITHDRAWAL_IN_PROGRESS`，
 *      且不覆盖已有单据（用 ②的读法反查）。
 *   ④ `participantId` 不在本项目名单 ⇒ `NO_PROJECT_ROLE`（复用码的理由见用例层注释）。
 *
 * ⚠ 本地不跑—— issue #74：本文件依赖真实 Postgres（`ensureDatabase`/`migrateOnce`），
 *   本地只对它跑 `pnpm --filter api run typecheck`，不执行。CI 才实际跑这条 vitest。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as OA } from "@repo/contracts";
import { withdrawParticipantPhone } from "../../src/application/auth/withdraw-participant-phone";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { newDb, repos, toOrgId } from "../support/join";

const ORG = "org-f14-withdraw";
const PROJECT = `${ORG}-p`;
const HOST = "u-f14-host";
const HOOK_TIMEOUT_MS = 60_000;

const PARTICIPANT_ID = "pp-f14-1";
const PHONE = "8613800002049";

let db: PgDatabase;
let R: ReturnType<typeof repos>;

const orgId = toOrgId(ORG);

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
  await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  await addOrgMember(ORG, HOST, "consultant", null);
  await addProjectMember(ORG, PROJECT, HOST, "facilitator", null, true);
  await R.roster.upsert(orgId, PROJECT, HOST, [
    {
      participantId: PARTICIPANT_ID,
      contactKind: "phone",
      contact: PHONE,
      masked: "138 •••• 2049",
      projectRole: "member",
      groupId: null,
    },
  ]);
}, HOOK_TIMEOUT_MS);

const NOW = new Date("2026-08-01T00:00:00.000Z");

const deps = () => ({ repo: R.withdrawal });

describe("① 发起撤回：入队 + 两个 deadline 是服务端记录值", () => {
  it("queuedAt = now；两个 deadline 严格等于 now + WITHDRAWAL_SLA_MS", async () => {
    const out = await withdrawParticipantPhone(deps(), {
      orgId,
      projectId: PROJECT,
      participantId: PARTICIPANT_ID,
      requestedBy: "data-subject",
      ackImpact: true,
      now: NOW,
    });

    expect(out.queuedAt).toBe(NOW.toISOString());
    expect(new Date(out.logicalRetireDeadline).getTime() - NOW.getTime()).toBe(5 * 60_000);
    expect(new Date(out.physicalDeleteDeadline).getTime() - NOW.getTime()).toBe(
      30 * 24 * 60 * 60_000,
    );
    // ⚠ 如实返回空集，见 withdraw-participant-phone.ts 文件头「D-13 最小切片」一节。
    expect(out.affectedReportSegments).toEqual([]);

    const parsed = OA.operations.withdrawParticipantPhone.out.safeParse(out);
    expect(parsed.success).toBe(true);
  });
});

describe("② 同一 requestedBy 重放 ⇒ 返回同一张单据", () => {
  it("第二次调用不产生新 queuedAt", async () => {
    const first = await withdrawParticipantPhone(deps(), {
      orgId,
      projectId: PROJECT,
      participantId: PARTICIPANT_ID,
      requestedBy: "facilitator",
      ackImpact: true,
      now: NOW,
    });
    const second = await withdrawParticipantPhone(deps(), {
      orgId,
      projectId: PROJECT,
      participantId: PARTICIPANT_ID,
      requestedBy: "facilitator",
      ackImpact: true,
      // ⚠ 故意传一个更晚的 now：如果实现现算而不是读库，这里会拿到不同的 queuedAt，
      //   断言就会抓到「重放其实在重新排队」这个坑。
      now: new Date(NOW.getTime() + 60_000),
    });

    expect(second.queuedAt).toBe(first.queuedAt);
    expect(second.logicalRetireDeadline).toBe(first.logicalRetireDeadline);
    expect(second.physicalDeleteDeadline).toBe(first.physicalDeleteDeadline);
  });
});

describe("③ 不同 requestedBy 对同一 participantId ⇒ WITHDRAWAL_IN_PROGRESS", () => {
  it("受访者本人已撤回后，引导师代发起同一目标被拒，且不覆盖已有单据", async () => {
    const first = await withdrawParticipantPhone(deps(), {
      orgId,
      projectId: PROJECT,
      participantId: PARTICIPANT_ID,
      requestedBy: "data-subject",
      ackImpact: true,
      now: NOW,
    });

    await expect(
      withdrawParticipantPhone(deps(), {
        orgId,
        projectId: PROJECT,
        participantId: PARTICIPANT_ID,
        requestedBy: "facilitator",
        ackImpact: true,
        now: new Date(NOW.getTime() + 60_000),
      }),
    ).rejects.toMatchObject({ reasonCode: "WITHDRAWAL_IN_PROGRESS" });

    // 冲突分支不得覆盖已有单据——用同一 requestedBy 重放，deadline 仍是第一次的。
    const replay = await withdrawParticipantPhone(deps(), {
      orgId,
      projectId: PROJECT,
      participantId: PARTICIPANT_ID,
      requestedBy: "data-subject",
      ackImpact: true,
      now: new Date(NOW.getTime() + 120_000),
    });
    expect(replay.queuedAt).toBe(first.queuedAt);
  });
});

describe("④ participantId 不在本项目名单 ⇒ NO_PROJECT_ROLE", () => {
  it("陌生 participantId 被拒，不新造一个泄露存在性的码", async () => {
    await expect(
      withdrawParticipantPhone(deps(), {
        orgId,
        projectId: PROJECT,
        participantId: "pp-f14-does-not-exist",
        requestedBy: "data-subject",
        ackImpact: true,
        now: NOW,
      }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });
});

/**
 * ⚠ 反证：上面 `safeParse(...).success === true` 会不会是空转？
 * 一个永远返回 success 的 schema 能让本文件那条契约断言全绿。
 */
describe("反证：契约 schema 确实会拒绝漂移的响应体", () => {
  it("withdrawParticipantPhone.out 拒绝多字段、拒绝缺字段、拒绝形状错误的段落引用", () => {
    const good = {
      queuedAt: NOW.toISOString(),
      logicalRetireDeadline: NOW.toISOString(),
      physicalDeleteDeadline: NOW.toISOString(),
      affectedReportSegments: [] as { kind: string; id: string }[],
    };
    expect(OA.operations.withdrawParticipantPhone.out.safeParse(good).success).toBe(true);
    expect(OA.operations.withdrawParticipantPhone.out.safeParse({ ...good, surprise: 1 }).success).toBe(
      false,
    );
    const { affectedReportSegments: _drop, ...missing } = good;
    expect(OA.operations.withdrawParticipantPhone.out.safeParse(missing).success).toBe(false);
    expect(
      OA.operations.withdrawParticipantPhone.out.safeParse({
        ...good,
        affectedReportSegments: [{ kind: "report" }],
      }).success,
    ).toBe(false);
  });

  it("withdrawParticipantPhone.in 拒绝 ackImpact !== true", () => {
    const good = {
      projectId: PROJECT,
      participantId: PARTICIPANT_ID,
      requestedBy: "data-subject" as const,
      ackImpact: true as const,
    };
    expect(OA.operations.withdrawParticipantPhone.in.safeParse(good).success).toBe(true);
    expect(
      OA.operations.withdrawParticipantPhone.in.safeParse({ ...good, ackImpact: false }).success,
    ).toBe(false);
  });
});
