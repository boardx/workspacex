/**
 * F86 (#356) —— `interview_signing_tokens` / `interview_portal_tokens` /
 * `interview_consent_snapshots` 的真实 Postgres 持久化，替换
 * `in-memory-consent-token-repository.ts`。
 *
 * 这三个仓储此前**完全没有测试**（`in-memory-consent-token-repository.ts` 也从未被任何
 * `.spec.ts`/`.test.ts` 引用过——grep 逐字为零命中）。本文件是它们第一次被真正跑起来，
 * 断言口径抄 `consent-token-ports.ts` 的文档字符串：
 *
 *  ① 签署令牌一次性核销：并发两路 `consume` 同一枚令牌，**恰好一路**成功（I-11 同型断言）。
 *  ② 过期 / 已核销 / 已撤销三种不可用理由，`findActive` 与 `consume` 分类必须一致。
 *  ③ 门户令牌撤销幂等：撤销已撤销的令牌不是错误，返回 `revoked: false`。
 *  ④ 同意书快照 append-only：同一 submissionId 可以追加第二条快照（历史不覆盖）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { FIXTURE_CONTACT_CIPHER, resetInterviews, seedInterview } from "../support/interview-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgInterviewSubjectRepository } from "../../src/infrastructure/interview/pg-interview-subject-repository";
import {
  PgConsentSnapshotRepository,
  PgPortalTokenRepository,
  PgSigningTokenRepository,
} from "../../src/infrastructure/interview/pg-consent-token-repository";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f86-consent-token";
const PROJECT = "proj-f86-consent-token";
const SESSION = "itv-f86-consent-token-session";
const CREATOR = "u-f86-consent-token-creator";

let db: PgDatabase;
let subjects: PgInterviewSubjectRepository;
let signing: PgSigningTokenRepository;
let portal: PgPortalTokenRepository;
let snapshots: PgConsentSnapshotRepository;
let subjectId: string;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  subjects = new PgInterviewSubjectRepository(db, FIXTURE_CONTACT_CIPHER);
  signing = new PgSigningTokenRepository(db);
  portal = new PgPortalTokenRepository(db);
  snapshots = new PgConsentSnapshotRepository(db);
}, 120_000);

afterAll(async () => {
  await resetInterviews(ORG, [SESSION]);
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetInterviews(ORG, [SESSION]);
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, CREATOR, "consultant", null);
  await seedInterview({ orgId: ORG, id: SESSION, createdBy: CREATOR });
  const created = await subjects.create({
    orgId: toOrgId(ORG),
    displayName: "受访者 · F86",
    roleTitle: "",
    orgName: null,
    groupId: null,
    contact: null,
    sourceKind: "human",
    createdBy: CREATOR,
  });
  subjectId = created.subjectId;
}, 60_000);

const NOW = new Date("2026-08-03T10:00:00Z");
const LATER = new Date("2026-08-10T10:00:00Z");
const EXPIRED = new Date("2026-08-02T09:59:59Z"); // 已经过期（< NOW）

describe("F86/#356 — 签署令牌（Postgres）", () => {
  it("签发后 findActive 命中，字段与入参一致", async () => {
    await signing.issue({
      tokenId: "sti-1",
      token: "tok-signing-1",
      interviewId: SESSION,
      subjectId,
      issuedAt: NOW,
      expiresAt: LATER,
    });

    const looked = await signing.findActive("tok-signing-1", NOW);
    expect(looked.ok).toBe(true);
    if (looked.ok) {
      expect(looked.row.interviewId).toBe(SESSION);
      expect(looked.row.subjectId).toBe(subjectId);
      expect(looked.row.consumedAt).toBeNull();
    }
  });

  it("过期令牌：findActive 与 consume 一致判定为 expired", async () => {
    await signing.issue({
      tokenId: "sti-2",
      token: "tok-signing-2",
      interviewId: SESSION,
      subjectId,
      issuedAt: EXPIRED,
      expiresAt: EXPIRED,
    });

    const active = await signing.findActive("tok-signing-2", NOW);
    expect(active).toEqual({ ok: false, reason: "expired" });

    const consumed = await signing.consume({ token: "tok-signing-2", now: NOW });
    expect(consumed).toEqual({ ok: false, reason: "expired" });
  });

  it("核销后不可再次核销（一次性）", async () => {
    await signing.issue({
      tokenId: "sti-3",
      token: "tok-signing-3",
      interviewId: SESSION,
      subjectId,
      issuedAt: NOW,
      expiresAt: LATER,
    });

    const first = await signing.consume({ token: "tok-signing-3", now: NOW });
    expect(first.ok).toBe(true);

    const second = await signing.consume({ token: "tok-signing-3", now: NOW });
    expect(second).toEqual({ ok: false, reason: "consumed" });

    // findActive 之后也必须看到同一个理由——不是只有 consume 自己知道。
    const looked = await signing.findActive("tok-signing-3", NOW);
    expect(looked).toEqual({ ok: false, reason: "consumed" });
  });

  it("🔴 恰好一次：并发两路 consume 同一枚令牌，只有一路成功（I-11 同型）", async () => {
    await signing.issue({
      tokenId: "sti-4",
      token: "tok-signing-4",
      interviewId: SESSION,
      subjectId,
      issuedAt: NOW,
      expiresAt: LATER,
    });

    const [a, b] = await Promise.all([
      signing.consume({ token: "tok-signing-4", now: NOW }),
      signing.consume({ token: "tok-signing-4", now: NOW }),
    ]);

    const oks = [a, b].filter((r) => r.ok);
    expect(oks.length).toBe(1);
  });

  it("未知令牌：findActive 返回 not-found", async () => {
    const looked = await signing.findActive("no-such-token", NOW);
    expect(looked).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("F86/#356 — 门户长效令牌（Postgres）", () => {
  it("签发 → findByTokenId / findActive 命中", async () => {
    await portal.issue({
      tokenId: "pti-1",
      token: "tok-portal-1",
      interviewId: SESSION,
      subjectId,
      issuedAt: NOW,
      expiresAt: LATER,
    });

    const byId = await portal.findByTokenId("pti-1");
    expect(byId?.token).toBe("tok-portal-1");

    const active = await portal.findActive("tok-portal-1", NOW);
    expect(active.ok).toBe(true);
  });

  it("撤销后 findActive 返回 revoked；再次撤销幂等（revoked: false）", async () => {
    await portal.issue({
      tokenId: "pti-2",
      token: "tok-portal-2",
      interviewId: SESSION,
      subjectId,
      issuedAt: NOW,
      expiresAt: LATER,
    });

    const first = await portal.revoke("pti-2", NOW);
    expect(first).toEqual({ revoked: true });

    const second = await portal.revoke("pti-2", NOW);
    expect(second).toEqual({ revoked: false });

    const looked = await portal.findActive("tok-portal-2", NOW);
    expect(looked).toEqual({ ok: false, reason: "revoked" });
  });

  it("撤销一枚不存在的 tokenId：revoked: false，不抛错", async () => {
    const out = await portal.revoke("no-such-portal-token-id", NOW);
    expect(out).toEqual({ revoked: false });
  });
});

describe("F86/#356 — 同意书渲染快照（Postgres, append-only）", () => {
  it("保存后原样返回；同一 submissionId 可追加第二条（历史不覆盖）", async () => {
    const bits = { record: true, transcript: true, ai_analysis: false, attribution: true };
    const renderParams = {
      retentionDays: 180,
      dataController: "WorkspaceX 研究团队",
      contactName: "林可",
      complianceEmail: "compliance@workspacex.invalid",
    };

    const saved1 = await snapshots.save({
      snapshotId: "snap-1",
      submissionId: "sub-1",
      interviewId: SESSION,
      subjectId,
      renderParams,
      bits,
      submittedAt: NOW,
    });
    expect(saved1.bits).toEqual(bits);
    expect(saved1.renderParams).toEqual(renderParams);

    // 追加第二条同一 submissionId 的快照——append-only 不代表「同一提交只能有一条」，
    // 代表「已经写下的那一条不可被覆盖/删除」。两条都必须仍然存在（这里用不同
    // snapshotId 各自 save 成功来断言：没有唯一约束挡住第二次 save）。
    const saved2 = await snapshots.save({
      snapshotId: "snap-2",
      submissionId: "sub-1",
      interviewId: SESSION,
      subjectId,
      renderParams,
      bits: { ...bits, attribution: false },
      submittedAt: LATER,
    });
    expect(saved2.snapshotId).toBe("snap-2");
    expect(saved2.bits.attribution).toBe(false);

    // findBySubject 回的是**最早**那一条（F96「原始快照」），不随后续快照改变。
    const original = await snapshots.findBySubject(SESSION, subjectId);
    expect(original?.snapshotId).toBe("snap-1");
    expect(original?.bits.attribution).toBe(true);
  });

  it("findBySubject 找不到时返回 null", async () => {
    const out = await snapshots.findBySubject(SESSION, "no-such-subject");
    expect(out).toBeNull();
  });
});
