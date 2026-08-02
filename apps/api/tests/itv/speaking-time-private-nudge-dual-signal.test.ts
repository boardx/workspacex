/**
 * F91 —— 发言时长监测与私下提醒：触发必须同时满足「连续发言 ≥ 阈值」与「他人举手/未答」
 * 两个信号 (`uc-6-4` R3 步骤4, E2, V5, O-36;
 * `domain/interview/speaking-balance.ts::evaluateSpeakingBalance`).
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74）。
 */
import { describe, expect, it } from "vitest";
import { thresholds } from "@repo/contracts";
import {
  DEFAULT_SPEAKING_BALANCE_THRESHOLD_SECONDS,
  evaluateSpeakingBalance,
  type SpeakingBalanceSnapshot,
  type WaitingParticipant,
} from "../../src/domain/interview/speaking-balance";

const kraus: WaitingParticipant = {
  subjectId: "subj-kraus",
  displayName: "Kraus",
  handRaised: true,
  hasAnsweredCurrentTopic: false,
};

const base: SpeakingBalanceSnapshot = {
  activeSpeakerName: "Weber",
  continuousSeconds: 260,
  thresholdSeconds: DEFAULT_SPEAKING_BALANCE_THRESHOLD_SECONDS,
  waitingParticipants: [kraus],
};

describe("F91 / O-36 · 发言时长私下提醒 —— 双信号缺一不可", () => {
  it("默认阈值取自 thresholds.ts 单一事实源，等于 240（不得在别处另抄字面量）", () => {
    expect(DEFAULT_SPEAKING_BALANCE_THRESHOLD_SECONDS).toBe(240);
    expect(thresholds.requireValue<number>(thresholds.THRESHOLDS.speakingBalanceThresholdSeconds, "x")).toBe(240);
  });

  it("两个信号同时满足 ⇒ 触发，且文案含两项事实（连续发言时长 + 举手未答者）", () => {
    const alert = evaluateSpeakingBalance(base);
    expect(alert).not.toBeNull();
    expect(alert?.pendingSpeakerId).toBe("subj-kraus");
    expect(alert?.continuousSeconds).toBe(260);
    expect(alert?.text).toContain("Weber");
    expect(alert?.text).toContain("4 分 20 秒");
    expect(alert?.text).toContain("Kraus");
    expect(alert?.text).toContain("举手");
  });

  it("反证 ①：A 长发言但无人举手/未答 ⇒ 不触发，即使远超阈值", () => {
    const noOneWaiting: SpeakingBalanceSnapshot = {
      ...base,
      continuousSeconds: 600,
      waitingParticipants: [{ ...kraus, handRaised: false }],
    };
    expect(evaluateSpeakingBalance(noOneWaiting)).toBeNull();
  });

  it("反证 ②：举手但已经回答过当前主题 ⇒ 不触发（『未答』是必要条件，不只是『举手』）", () => {
    const alreadyAnswered: SpeakingBalanceSnapshot = {
      ...base,
      waitingParticipants: [{ ...kraus, hasAnsweredCurrentTopic: true }],
    };
    expect(evaluateSpeakingBalance(alreadyAnswered)).toBeNull();
  });

  it("反证 ③：信号齐全但连续发言时长未达阈值 ⇒ 不触发", () => {
    const tooShort: SpeakingBalanceSnapshot = { ...base, continuousSeconds: 100 };
    expect(evaluateSpeakingBalance(tooShort)).toBeNull();
  });

  it("恰好等于阈值（240 秒整）⇒ 触发（阈值是『≥』不是『>』）", () => {
    const exactly: SpeakingBalanceSnapshot = { ...base, continuousSeconds: 240 };
    expect(evaluateSpeakingBalance(exactly)).not.toBeNull();
  });

  it("项目级可上调阈值：同一份快照，阈值改大后不再触发（O-36 对照『打断时机过早』的教训）", () => {
    const raised: SpeakingBalanceSnapshot = { ...base, thresholdSeconds: 600 };
    expect(evaluateSpeakingBalance(raised)).toBeNull();
  });

  it("多位候选等待者：取第一个『举手且当前主题未答』的人，不是任意选一个", () => {
    const first: WaitingParticipant = { subjectId: "subj-first", displayName: "高琳", handRaised: false, hasAnsweredCurrentTopic: false };
    const second: WaitingParticipant = kraus;
    const multi: SpeakingBalanceSnapshot = { ...base, waitingParticipants: [first, second] };
    const alert = evaluateSpeakingBalance(multi);
    expect(alert?.pendingSpeakerId).toBe("subj-kraus");
  });

  it("契约 evaluateSpeakingBalance.out.alert 校验通过（字段形状对齐，不另造一份）", async () => {
    const { interview } = await import("@repo/contracts");
    const alert = evaluateSpeakingBalance(base);
    expect(alert).not.toBeNull();
    const outShape = interview.operations.evaluateSpeakingBalance.out;
    expect(() => outShape.parse({ alert })).not.toThrow();
  });
});
