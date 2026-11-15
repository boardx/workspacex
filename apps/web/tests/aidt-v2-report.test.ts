import { expect, it } from "vitest";
import { aidtUiReportMarkdown, aidtUiStageSummary, emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { confirmAidtVerificationQuestion, createAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";

it("keeps V2-only none and insufficient/undecided records non-empty for shared persistence", () => {
  const drafts = emptyAidtUiDrafts();
  drafts[3]!.fields = { surpriseStatus: "none", surpriseConfirmed: "true" };
  expect(aidtUiStageSummary(3, drafts[3]!)).toContain("暂无");
  drafts[6]!.fields = { understandingChangeStatus: "insufficient", returnStep: "undecided", unresolvedQuestions: "缺少赶课场景测试", returnReason: "需要教师协助" };
  const text = aidtUiStageSummary(6, drafts[6]!);
  expect(text).toContain("证据不足"); expect(text).toContain("暂未决定"); expect(text).toContain("需要教师协助");
});
it("reports problem provenance, valid none, classification and frozen learning without raw internal JSON", () => {
  const drafts = emptyAidtUiDrafts();
  drafts[1]!.fields = { initial: "校园体验", whyWorthStudying: "想了解实际影响", problemSources: '["guess"]', sourceDetails: "目前只是猜测", problemReflectionConfirmed: "true" };
  drafts[3]!.fields = { surpriseStatus: "none", surpriseConfirmed: "true", surprisingFinding: "旧分支的隐藏发现" };
  drafts[4]!.ideas = [{ id: "idea-a", title: "试饮服务", description: "先小步体验，再决定。" }];
  drafts[4]!.fields = { ideaClassificationTags: '{"idea-a":["easy","fun"]}', ideaClassificationReasons: '{"idea-a":"小杯可以低成本尝试"}', ideaClassificationConfirmed: "true" };
  drafts[5] = confirmAidtVerificationQuestion({ ...drafts[5]!, fields: { verificationQuestion: "用户如何理解服务？", beforeTestBelief: "也许能理解", version: "学生纸面原型 A" } })!;
  const snapshot = createAidtQuestionSnapshot(drafts[5]!, 2); expect(snapshot.ok).toBe(true); if (!snapshot.ok) throw new Error(snapshot.reason);
  drafts[6]!.fields = { questionSnapshot: snapshot.serialized, understandingChangeStatus: "unchanged", afterTestBelief: "暂未改变", understandingEvidence: "纸面测试记录T1待核对", returnStep: "2", returnReason: "尚不理解时间差异", nextAction: "补访赶课者", reflectionConfirmed: "true" };
  drafts[5]!.fields.verificationQuestion = "后来另一个问题";
  const report = aidtUiReportMarkdown(drafts);
  for (const value of ["目前只是猜测", "暂无", "最容易实现", "最有趣", "小杯可以低成本尝试", "用户如何理解服务？", "第5步 V2", "补访赶课者", "暂未改变"]) expect(report).toContain(value);
  expect(report).not.toContain("旧分支的隐藏发现"); expect(report).not.toContain('"schemaVersion":'); expect(report).not.toContain('"idea-a":');
  expect(drafts[6]!.fields.newVersion).toBeUndefined();
});
