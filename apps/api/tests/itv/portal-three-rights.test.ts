/**
 * F96 —— 受访者自助门户：同一条门户长效令牌完成三件事（改选择/要副本/要删除），
 * 每项都有可查状态（uc-6-6 R3，issue #289）。
 *
 * 刻意不碰 Postgres：本 feature 依赖的门户侧持久化地基尚未落地为 Postgres 实现，
 * 按 issue #74 的允许口径，这里用内存双工件对编排断言，与 F86/F89 同一立场。
 *
 * 本文件要证明的核心断言：
 *   ① V1/AC1：同一条链接依次完成改选择、索取副本、发起删除三件事，均返回受理凭据；
 *   ② R7：收紧同意位即时生效并触发撤回（复用 F89 五步流水线，不重新实现）；
 *      放宽不触发任何撤回，也不追溯补数据；
 *   ③ I-16：每次改选择追加一条历史版本，不覆盖旧记录；
 *   ④ V4/AC4：文字稿副本只含本人发言；
 *   ⑤ V10：删除确认返回体含「会删/不会删/时限/不可逆」四段，缺一不可；
 *   ⑥ V6：请求状态随撤回流水线推进更新，不是创建时写死的静态值；
 *   ⑦ 对同一条在途删除请求重复确认按幂等处理，不抛契约里没有的 `WITHDRAWAL_IN_PROGRESS`。
 */
import { describe, expect, it } from "vitest";
import { getPortalView } from "../../src/application/interview/get-portal-view";
import { updateConsentFromPortal } from "../../src/application/interview/update-consent-from-portal";
import { requestTranscriptCopy } from "../../src/application/interview/request-transcript-copy";
import { requestErasure } from "../../src/application/interview/request-erasure";
import { listSubjectRequests } from "../../src/application/interview/list-subject-requests";
import {
  InMemoryConsentSnapshotRepository,
  InMemoryPortalTokenRepository,
} from "../../src/infrastructure/interview/in-memory-consent-token-repository";
import {
  FixedTranscriptCopySourceReader,
  InMemoryPortalConsentStateRepository,
  InMemorySubjectRequestRepository,
  InMemoryTranscriptCopyFileStore,
} from "../../src/infrastructure/interview/in-memory-portal-repository";
import {
  FixedWithdrawalSegmentLocator,
  InMemoryCascadeInvalidationStore,
  InMemoryPendingDeletionQueue,
  InMemoryReportSegmentAnnotator,
  InMemoryRetrievalIndex,
  InMemorySignedDecisionReviewNotifier,
  InMemoryWithdrawalRepository,
} from "../../src/infrastructure/interview/in-memory-withdrawal-repository";

const INTERVIEW = "itv-f96-weber-session";
const SUBJECT = "sub-f96-weber";
const PORTAL_TOKEN = "portal-token-f96-weber";

function makeDeps(now: () => Date) {
  const portalTokens = new InMemoryPortalTokenRepository();
  const snapshots = new InMemoryConsentSnapshotRepository();
  const consentState = new InMemoryPortalConsentStateRepository();
  const subjectRequests = new InMemorySubjectRequestRepository();
  const withdrawals = new InMemoryWithdrawalRepository();
  const segments = new FixedWithdrawalSegmentLocator(new Map([[SUBJECT, ["seg-1", "seg-2"]]]));
  const deletionQueue = new InMemoryPendingDeletionQueue();
  const retrieval = new InMemoryRetrievalIndex();
  const cascade = new InMemoryCascadeInvalidationStore();
  const reportAnnotator = new InMemoryReportSegmentAnnotator();
  const decisionReview = new InMemorySignedDecisionReviewNotifier();
  const transcripts = new FixedTranscriptCopySourceReader(
    new Map([
      [
        INTERVIEW,
        [
          { speakerSubjectId: SUBJECT, text: "我觉得这个流程太慢了。" },
          { speakerSubjectId: SUBJECT, text: "希望能有一个自助查询入口。" },
          { speakerSubjectId: "sub-other-observer", text: "（他人发言，不应出现在 Weber 的副本里）" },
        ],
      ],
    ]),
  );
  const files = new InMemoryTranscriptCopyFileStore();

  let seq = 0;
  return {
    portalTokens,
    snapshots,
    consentState,
    subjectRequests,
    withdrawals,
    segments,
    deletionQueue,
    retrieval,
    cascade,
    reportAnnotator,
    decisionReview,
    transcripts,
    files,
    now,
    newWithdrawalId: () => `wd-f96-${++seq}`,
    newRequestId: () => `sreq-f96-${seq}`,
  };
}

async function seedSubmittedSubject(
  deps: ReturnType<typeof makeDeps>,
  now: Date,
  initialBits = { record: true, transcript: true, ai_analysis: true, attribution: false },
) {
  await deps.portalTokens.issue({
    tokenId: "ptk-f96-weber",
    token: PORTAL_TOKEN,
    interviewId: INTERVIEW,
    subjectId: SUBJECT,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000),
  });
  await deps.snapshots.save({
    snapshotId: "csnap-f96-weber",
    submissionId: "csub-f96-weber",
    interviewId: INTERVIEW,
    subjectId: SUBJECT,
    renderParams: {
      retentionDays: 180,
      dataController: "某物流园区",
      contactName: "李研究员",
      complianceEmail: "compliance@example.invalid",
    },
    bits: initialBits,
    submittedAt: now,
  });
}

describe("F96 · 受访者自助门户三项能力", () => {
  const now = () => new Date("2026-08-01T09:00:00.000Z");

  it("V1/AC1：同一条链接依次完成改选择、索取副本、发起删除三件事，均返回受理凭据", async () => {
    const deps = makeDeps(now);
    await seedSubmittedSubject(deps, now());

    const view = await getPortalView(deps, { portalToken: PORTAL_TOKEN });
    expect(view.bits).toEqual({ record: true, transcript: true, ai_analysis: true, attribution: false });
    expect(view.snapshot.renderedText).toContain("材料保留期：180 天");
    expect(view.controller.complianceEmail).toBe("compliance@example.invalid");

    // 能力一：改选择——收紧「转成文字稿」。
    const changed = await updateConsentFromPortal(deps, {
      portalToken: PORTAL_TOKEN,
      bits: { record: true, transcript: false, ai_analysis: true, attribution: false },
    });
    expect(changed.submissionId).toBeTruthy();
    expect(changed.triggeredWithdrawalId).not.toBeNull();
    // 这次收紧触发的撤回先走完（物理删除完成），这样紧接着的「删除全部记录」
    // 是一次独立、干净的全量撤回，不与还在途的部分撤回抢同一张单据
    // （两者范围有交集时 `requestWithdrawal` 会拒绝并发——这是 F89 既有的
    // `WITHDRAWAL_IN_PROGRESS` 不变量，不是本用例要验证的东西）。
    await deps.withdrawals.markPhysicalDeleteComplete(changed.triggeredWithdrawalId!, now());

    // 能力二：要一份文字稿副本。
    const copy = await requestTranscriptCopy(deps, { portalToken: PORTAL_TOKEN });
    expect(copy.requestId).toBeTruthy();
    expect(copy.downloadUrl).not.toBeNull();
    expect(copy.expiresAt).not.toBeNull();

    // 能力三：要求删除全部记录。
    const erasure = await requestErasure(deps, { portalToken: PORTAL_TOKEN, acknowledged: true });
    expect(erasure.requestId).toBeTruthy();
    expect(erasure.irreversible).toBe(true);

    // 三件事都在"我的请求进度"里可查（V6）。
    const listed = await listSubjectRequests(deps, { portalToken: PORTAL_TOKEN });
    const kinds = listed.items.map((i) => i.kind).sort();
    expect(kinds).toEqual(["consent-change", "erasure", "transcript-copy"]);
  });

  it("R7：收紧即时生效并触发撤回；放宽不追溯、不触发任何撤回", async () => {
    const deps = makeDeps(now);
    await seedSubmittedSubject(deps, now());

    // 放宽：补上 attribution。
    const loosened = await updateConsentFromPortal(deps, {
      portalToken: PORTAL_TOKEN,
      bits: { record: true, transcript: true, ai_analysis: true, attribution: true },
    });
    expect(loosened.triggeredWithdrawalId).toBeNull();
    expect(deps.deletionQueue.tickets).toHaveLength(0);
    expect(deps.retrieval.excludedSegmentIds.size).toBe(0);

    // 收紧：撤掉「交给 AI 分析」——触发撤回，片段立即退出检索范围。
    const tightened = await updateConsentFromPortal(deps, {
      portalToken: PORTAL_TOKEN,
      bits: { record: true, transcript: true, ai_analysis: false, attribution: true },
    });
    expect(tightened.triggeredWithdrawalId).not.toBeNull();
    expect(deps.deletionQueue.tickets).toHaveLength(1);
    expect(deps.retrieval.excludedSegmentIds.has("seg-1")).toBe(true);

    // 之后再读门户，当前 bits 已是最新一次变更的结果（不是原始快照）。
    const view = await getPortalView(deps, { portalToken: PORTAL_TOKEN });
    expect(view.bits.ai_analysis).toBe(false);
    expect(view.bits.attribution).toBe(true);
    // 但当初的渲染快照（"当初告知你的是什么"）不因后续改选择而改写——
    // 原始提交时 ai_analysis 是 true，即使后来被收紧，快照里仍然是「当初」的 ☑。
    expect(view.snapshot.renderedText).toContain("☑ 交给 AI 做分析");
  });

  it("I-16：每次改选择追加一条历史版本，不覆盖旧记录", async () => {
    const deps = makeDeps(now);
    await seedSubmittedSubject(deps, now());

    await updateConsentFromPortal(deps, {
      portalToken: PORTAL_TOKEN,
      bits: { record: true, transcript: false, ai_analysis: true, attribution: false },
    });
    await updateConsentFromPortal(deps, {
      portalToken: PORTAL_TOKEN,
      bits: { record: false, transcript: false, ai_analysis: true, attribution: false },
    });

    expect(deps.consentState.history).toHaveLength(2);
    // 两条历史各自独立存在——不是"第二条覆盖第一条"。
    expect(deps.consentState.history[0]?.bits.record).toBe(true);
    expect(deps.consentState.history[1]?.bits.record).toBe(false);
  });

  it("V4/AC4：文字稿副本只含本人发言，不含他人发言", async () => {
    const deps = makeDeps(now);
    await seedSubmittedSubject(deps, now());

    await requestTranscriptCopy(deps, { portalToken: PORTAL_TOKEN });

    const lines = deps.files.filesBySubject.get(SUBJECT);
    expect(lines).toBeDefined();
    expect(lines!.length).toBe(2);
    for (const line of lines!) {
      expect(line).not.toContain("他人发言");
    }
  });

  it("E5：文字稿副本生成失败可重试，不静默失败", async () => {
    const deps = makeDeps(now);
    await seedSubmittedSubject(deps, now());
    deps.files.failNextCall = true;

    await expect(requestTranscriptCopy(deps, { portalToken: PORTAL_TOKEN })).rejects.toThrow(
      "COPY_GENERATION_FAILED",
    );

    // 重试（不再失败）应该正常成功——上一次失败没有留下任何半成品状态。
    const retried = await requestTranscriptCopy(deps, { portalToken: PORTAL_TOKEN });
    expect(retried.downloadUrl).not.toBeNull();
  });

  it("V10：删除确认返回体含四段说明（会删/不会删/时限/不可逆），缺一不可", async () => {
    const deps = makeDeps(now);
    await seedSubmittedSubject(deps, now());

    const erasure = await requestErasure(deps, { portalToken: PORTAL_TOKEN, acknowledged: true });

    expect(erasure.willDelete.length).toBeGreaterThan(0);
    expect(erasure.willNotDelete.length).toBeGreaterThan(0);
    expect(erasure.slaText.length).toBeGreaterThan(0);
    expect(erasure.irreversible).toBe(true);
    expect(erasure.slaText).toContain("不可逆");
    expect(erasure.slaText).not.toContain("24 小时");
  });

  it("V6：删除请求的状态随撤回流水线推进更新，不是创建时写死的静态值", async () => {
    const deps = makeDeps(now);
    await seedSubmittedSubject(deps, now());

    const erasure = await requestErasure(deps, { portalToken: PORTAL_TOKEN, acknowledged: true });

    const beforeComplete = await listSubjectRequests(deps, { portalToken: PORTAL_TOKEN });
    const erasureRowBefore = beforeComplete.items.find((i) => i.kind === "erasure")!;
    expect(erasureRowBefore.status).toContain("处理中");
    expect(erasureRowBefore.etaAt).not.toBeNull();

    // 外部（22-files/17-gov）真正把物理层删完之后回写。
    await deps.withdrawals.markPhysicalDeleteComplete(erasure.requestId, now());

    const afterComplete = await listSubjectRequests(deps, { portalToken: PORTAL_TOKEN });
    const erasureRowAfter = afterComplete.items.find((i) => i.kind === "erasure")!;
    expect(erasureRowAfter.status).toBe("删除已完成");
    expect(erasureRowAfter.etaAt).toBeNull();
  });

  it("对同一条在途删除请求重复确认按幂等处理，不抛契约里没有的 WITHDRAWAL_IN_PROGRESS", async () => {
    const deps = makeDeps(now);
    await seedSubmittedSubject(deps, now());

    const first = await requestErasure(deps, { portalToken: PORTAL_TOKEN, acknowledged: true });
    const second = await requestErasure(deps, { portalToken: PORTAL_TOKEN, acknowledged: true });

    expect(second.requestId).toBe(first.requestId);
    // 没有起第二次撤回——待删除队列只有一张单据。
    expect(deps.deletionQueue.tickets).toHaveLength(1);
    // 请求台账里也只登记了一条 erasure 请求，不是两条。
    const listed = await listSubjectRequests(deps, { portalToken: PORTAL_TOKEN });
    expect(listed.items.filter((i) => i.kind === "erasure")).toHaveLength(1);
  });
});
