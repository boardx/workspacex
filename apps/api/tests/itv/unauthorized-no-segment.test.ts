/**
 * F88 —— 未获授权时,录制/转写接口同样拒绝,不存在绕过（uc-6-3 R3 步骤7 / AC2，V2 第②条）。
 *
 * ## 为什么这个文件要跟 F69 的录制入口打交道,而不是只测 `startSession`
 *
 * `start-interview-hard-gate-server.test.ts` 证明了「进现场」这个业务动作
 * （`startSession`）会被同意位门禁拒绝。但 F69 的 `startRecording`/`ingestSegment`
 * （`application/recording/capture.ts`）是**另一个**可以被直接调用的入口——如果
 * 只在 `startSession` 挡一次，绕过它直接调录制接口就能在无人授权的情况下拿到片段。
 * 界面「不存在『仍要开始』的绕过按钮」这句话,在服务端的对应形态就是:
 * 这条路径也必须被同一份同意位事实挡住。
 *
 * 本文件因此把 `createRecordingConsentGate`（真实门禁,读的是 Postgres 里的
 * `interview_subjects`/`interview_consent_submissions`,不是一个恒真/恒假的假门）
 * 接到 `startRecording` 的 `consent` 依赖上,重演 F69 既有测试
 * （`mic-permission-decline-no-segment.test.ts` 「start 被拒绝时不产生任何会话」）
 * 那套断言手法,但门禁背后是本 feature 的真实数据,不是 `blockingConsent` 这个占位符。
 *
 * ## 断言的是「store 是空的」，不是「返回值说拒绝」
 *
 * 与 F69 同一条纪律：拒绝之后直接读 `segments.appended`/`sessions.session(...)`,
 * 证明没有任何东西被写入,而不是只信任 `startRecording` 的返回值。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { FIXTURE_CONTACT_CIPHER, seedInterview } from "../support/interview-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgInterviewSubjectRepository } from "../../src/infrastructure/interview/pg-interview-subject-repository";
import { PgConsentSubmissionStore } from "../../src/infrastructure/interview/pg-consent-submission-store";
import { PgConsentGateReader } from "../../src/infrastructure/interview/pg-consent-gate-reader";
import { createRecordingConsentGate } from "../../src/application/interview/consent-gate";
import { startRecording, ingestSegment } from "../../src/application/recording/capture";
import { harness } from "../support/rec-fakes";
import { toOrgId } from "../../src/domain/org-id";
import type { ConsentBits } from "../../src/domain/interview/subject";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f88-no-segment";
const PROJECT = "proj-f88-no-segment";
const RESEARCHER = "u-f88-no-segment-researcher";

let db: PgDatabase;
let subjects: PgInterviewSubjectRepository;
let consent: PgConsentSubmissionStore;
let consentGateReader: PgConsentGateReader;

const ALL_TRUE: ConsentBits = { record: true, transcript: true, ai_analysis: true, attribution: true };

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  subjects = new PgInterviewSubjectRepository(db, FIXTURE_CONTACT_CIPHER);
  consent = new PgConsentSubmissionStore(db);
  consentGateReader = new PgConsentGateReader(db);
}, 120_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, RESEARCHER, "consultant", fx.teams.energy!);
});

describe("F88 — 未授权的访谈,录制/转写接口服务端拒绝,不产生任何片段", () => {
  it("必需受访者未提交同意 ⇒ startRecording 拒绝,且不创建任何会话/轨道", async () => {
    const requiredSubject = await subjects.create({
      orgId: toOrgId(ORG),
      displayName: "受访者-未授权",
      roleTitle: "运营总监",
      orgName: null,
      groupId: null,
      contact: null,
      sourceKind: "human",
      mode: "interview",
      createdBy: RESEARCHER,
    });

    const interviewSessionId = "itv-sess-f88-unauth-1";
    await seedInterview({ orgId: ORG, id: interviewSessionId, createdBy: RESEARCHER, projectId: PROJECT });
    await subjects.attachToSession(toOrgId(ORG), interviewSessionId, requiredSubject.subjectId, RESEARCHER);

    const gate = createRecordingConsentGate({ reader: consentGateReader }, toOrgId(ORG));
    const deps = harness({ consent: gate });

    const started = await startRecording(deps, {
      sourceType: "interview",
      sourceRefId: interviewSessionId,
      projectId: PROJECT,
      orgId: ORG,
      trackPlan: [{ participantId: requiredSubject.subjectId, micState: "granted" }],
    });

    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.reason).toBe("CONSENT_NOT_COMPLETED");

    // 拒绝之后没有创建任何会话/轨道——不是「假装拒绝但已经悄悄开始了」。
    expect(await deps.tracks.tracksOf("rec-session-1")).toEqual([]);
    expect(deps.segments.appended).toHaveLength(0);

    // 绕过 startRecording,直接构造一个不存在的 sessionId 去 ingestSegment——
    // 服务端没有会话可查,天然拒绝,证明没有第二条能拿到片段的路。
    const bypass = await ingestSegment(deps, {
      sessionId: "rec-session-1",
      trackId: "does-not-exist",
      anchor: { startMs: 0, endMs: 900, messageId: null },
      rawText: "不该被记下来的话",
      asrConfidence: 0.99,
      diarization: { channelId: null, overlap: false },
      draft: false,
    });
    expect(bypass.ok).toBe(false);
    expect(deps.segments.appended).toHaveLength(0);
  });

  it("必需受访者提交同意之后,同一个 startRecording 调用改为放行,片段可以正常产生", async () => {
    const requiredSubject = await subjects.create({
      orgId: toOrgId(ORG),
      displayName: "受访者-已授权",
      roleTitle: "运营总监",
      orgName: null,
      groupId: null,
      contact: null,
      sourceKind: "human",
      mode: "interview",
      createdBy: RESEARCHER,
    });

    const interviewSessionId = "itv-sess-f88-auth-1";
    await seedInterview({ orgId: ORG, id: interviewSessionId, createdBy: RESEARCHER, projectId: PROJECT });
    await subjects.attachToSession(toOrgId(ORG), interviewSessionId, requiredSubject.subjectId, RESEARCHER);
    await consent.submit(toOrgId(ORG), interviewSessionId, requiredSubject.subjectId, ALL_TRUE);

    const gate = createRecordingConsentGate({ reader: consentGateReader }, toOrgId(ORG));
    const deps = harness({ consent: gate });

    const started = await startRecording(deps, {
      sourceType: "interview",
      sourceRefId: interviewSessionId,
      projectId: PROJECT,
      orgId: ORG,
      trackPlan: [{ participantId: requiredSubject.subjectId, micState: "granted" }],
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const track = started.tracks[0]!;
    const ingested = await ingestSegment(deps, {
      sessionId: started.sessionId,
      trackId: track.trackId,
      anchor: { startMs: 0, endMs: 900, messageId: null },
      rawText: "已授权,应该被记下来",
      asrConfidence: 0.95,
      diarization: { channelId: "ch-A", overlap: false },
      draft: false,
    });
    expect(ingested.ok).toBe(true);
    expect(deps.segments.appended).toHaveLength(1);
  });

  it("观察/陪同（mode: observation）未授权不阻断录制开始——门禁只看必需受访者", async () => {
    const requiredSubject = await subjects.create({
      orgId: toOrgId(ORG),
      displayName: "主访对象",
      roleTitle: "运营总监",
      orgName: null,
      groupId: null,
      contact: null,
      sourceKind: "human",
      mode: "interview",
      createdBy: RESEARCHER,
    });
    const observer = await subjects.create({
      orgId: toOrgId(ORG),
      displayName: "隐藏观察员",
      roleTitle: "同事陪同",
      orgName: null,
      groupId: null,
      contact: null,
      sourceKind: "human",
      mode: "observation",
      createdBy: RESEARCHER,
    });

    const interviewSessionId = "itv-sess-f88-observer-1";
    await seedInterview({ orgId: ORG, id: interviewSessionId, createdBy: RESEARCHER, projectId: PROJECT });
    await subjects.attachToSession(toOrgId(ORG), interviewSessionId, requiredSubject.subjectId, RESEARCHER);
    await subjects.attachToSession(toOrgId(ORG), interviewSessionId, observer.subjectId, RESEARCHER);
    await consent.submit(toOrgId(ORG), interviewSessionId, requiredSubject.subjectId, ALL_TRUE);
    // 观察员从未提交——不应阻断。

    const gate = createRecordingConsentGate({ reader: consentGateReader }, toOrgId(ORG));
    const deps = harness({ consent: gate });

    const started = await startRecording(deps, {
      sourceType: "interview",
      sourceRefId: interviewSessionId,
      projectId: PROJECT,
      orgId: ORG,
      trackPlan: [{ participantId: requiredSubject.subjectId, micState: "granted" }],
    });
    expect(started.ok).toBe(true);
  });
});
