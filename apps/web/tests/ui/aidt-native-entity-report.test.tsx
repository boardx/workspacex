import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtReportPreview } from "@/features/aidt/components/aidt-report-preview";
import { aidtUiReportMarkdown, aidtUiStageMarkdown, aidtUiStageSummary, emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { addAidtProblem, archiveAidtProblem, updateAidtProblemEntity } from "@/features/aidt/lib/aidt-problem-entities";
import { archiveAidtInterview, writeAidtInterview } from "@/features/aidt/lib/aidt-interviews";
import { saveAidtDefinitionHmw, saveAidtDefinitionPersona } from "@/features/aidt/lib/aidt-definition";
import { confirmAidtPrototypeEntityHandoff, pinAidtPrototypeInputs, updateAidtPrototypeEntityDraft } from "@/features/aidt/lib/aidt-prototype-handoff";
import { updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
import { confirmAidtVerificationQuestion, createAidtQuestionSnapshot, updateAidtReflectionField } from "@/features/aidt/lib/aidt-verification-loop";
import { createAidtTestGroup, updateAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { StageDraft } from "@repo/contracts/aidt-stages";
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => undefined }));
const one = "73990275-e848-480f-8962-8d39d3b88b43", two = "783bb5b5-794b-47a2-a59d-57d29d7e6931";
function stage(stageId: number, draft: AidtUiStageDraft): AidtSharedStage {
  return { projectId: "qa-project", stageId, revision: 9, updatedAt: "2026-11-21T00:00:00Z", updatedBy: "qa-student", sourceStageRevisions: [], content: { schemaVersion: 1, draft: StageDraft.parse(draft) } };
}
function prototype(id = "qa-design") {
  const ideas = stage(4, { fields: { ideaHandoffIds: '["qa-idea"]' }, ideas: [{ id: "qa-idea", title: "等候提示", description: "让学生先了解等待" }], selectedIdeaId: "" });
  const question = confirmAidtVerificationQuestion(pinAidtPrototypeInputs({ fields: { verificationQuestion: "QA原型验证问题", beforeTestBelief: "QA先前看法", verificationBasis: "QA依据仍是猜测", verificationLimits: "只能测试理解，不能证明实际行为", type: "QA静态服务图", situation: "QA午休", task: "QA理解提示", operations: "QA先看信息再选择" }, ideas: [], selectedIdeaId: "" }, ideas))!;
  return updateAidtPrototypeReference(question, { designId: id, versionId: "qa-native-v1", designName: "QA原型", createdAt: "2026-11-21T00:00:00Z", seq: 1, summary: "静态等候提示", frameCount: 1, generatedFrameCount: 1, source: "model" });
}

it("assembles the normal prototype entity's actual brief, question and native version without mutating it", () => {
  const drafts = emptyAidtUiDrafts();
  drafts[5] = confirmAidtPrototypeEntityHandoff(updateAidtPrototypeEntityDraft(drafts[5]!, "qa-design", () => prototype()), "qa-design");
  const before = JSON.stringify(drafts), markdown = aidtUiReportMarkdown(drafts);
  for (const text of ["QA原型验证问题", "QA先前看法", "QA静态服务图", "QA先看信息再选择", "qa-native-v1", "第 4 步 V9", "本轮已确认交接记录"]) expect(markdown).toContain(text);
  expect(aidtUiStageSummary(5, drafts[5]!)).toContain("QA原型验证问题");
  expect(JSON.stringify(drafts)).toBe(before);
  expect(markdown).not.toContain("测试已通过");
  expect(aidtUiStageMarkdown(5, drafts[5]!)).not.toContain("本轮最想知道：待学生填写");
});

it("keeps multiple named problems and archived history instead of reporting only the current aggregate", () => {
  const drafts = emptyAidtUiDrafts();
  let draft = addAidtProblem(addAidtProblem(drafts[1]!, one, "原始范围"), two, "另一个方向");
  draft = updateAidtProblemEntity(draft, one, old => ({ ...old, fields: { initial: "QA初始命题一", rewrittenTheme: "QA重写主题一", whyWorthStudying: "值得了解时间情境" } }));
  draft = updateAidtProblemEntity(draft, two, old => ({ ...old, fields: { initial: "QA初始命题二" } }));
  drafts[1] = archiveAidtProblem(draft, two);
  const markdown = aidtUiReportMarkdown(drafts);
  for (const text of ["QA初始命题一", "QA重写主题一", "QA初始命题二", "已归档，保留历史", "候选问题，不自动作为本轮结论"]) expect(markdown).toContain(text);
});

it("includes per-person original and adopted questions and retains missing-data and draft states", () => {
  const drafts = emptyAidtUiDrafts();
  let draft = writeAidtInterview(drafts[2]!, { version: 1, id: one, code: "U01", topicRevision: 3, topic: "QA主题", goal: "QA研究重点", original: "QA学生提纲原稿", adopted: "QA学生修订清单", guideConfirmed: false, consent: null });
  draft = writeAidtInterview(draft, { version: 1, id: two, code: "U02", topicRevision: null, topic: "", goal: "", original: "另一人的原稿", adopted: "", guideConfirmed: false, consent: null });
  drafts[2] = archiveAidtInterview(draft, two);
  const markdown = aidtUiReportMarkdown(drafts);
  for (const text of ["访谈记录：U01", "QA学生提纲原稿", "QA学生修订清单", "第 1 步 V3", "访谈记录：U02", "已归档，保留历史", "草稿，尚未确认", "尚未记录受访者发现卡"]) expect(markdown).toContain(text);
  expect(markdown).not.toContain("研究已验证");
});

it("reports persona details and HMW reasoning from normal definition records without guessing demographics", () => {
  const drafts = emptyAidtUiDrafts();
  let draft = saveAidtDefinitionPersona(drafts[3]!, { id: one, confirmed: false, archived: false, cardIds: [two], name: "QA画像", situation: "QA具体情境", behavior: "QA实际行为记录", need: "QA需求表达", limits: "年龄兴趣未知" }, 4);
  draft = saveAidtDefinitionHmw(draft, { id: two, confirmed: false, archived: false, cardIds: [two], personaIds: [one], text: "QA我们如何保留选择", rationale: "QA选择理由" }, 4);
  drafts[3] = draft;
  const markdown = aidtUiReportMarkdown(drafts);
  for (const text of ["QA画像", "QA具体情境", "QA实际行为记录", "QA需求表达", "年龄兴趣未知", "QA选择理由", "QA我们如何保留选择", "草稿，待学生核对"]) expect(markdown).toContain(text);
  expect(markdown).not.toContain("年龄：20");
});

it("keeps saved test entities beside the frozen question and honest insufficient-evidence reflection", () => {
  const drafts = emptyAidtUiDrafts(), snapshot = createAidtQuestionSnapshot(prototype(), 7);
  if (!snapshot.ok) throw new Error("Normal question fixture is invalid");
  const group = createAidtTestGroup(snapshot.snapshot, one, "qa-design")!;
  let draft = updateAidtTestGroup(drafts[6]!, { ...group, name: "QA测试记录", task: "QA让对象先解释顺序", participant: "T01", situation: "QA模拟情境", interpretation: "QA待验证解释" });
  for (const [field, value] of [["questionSnapshot", snapshot.serialized], ["version", snapshot.snapshot.prototypeRef], ["understandingChangeStatus", "insufficient"], ["afterTestBelief", "没有真实测试，暂不能判断"], ["returnStep", "2"], ["returnReason", "需要补充真实访谈"], ["nextAction", "先理解不同时间情境"]] as const) draft = updateAidtReflectionField(draft, field, value);
  drafts[6] = draft;
  const markdown = aidtUiReportMarkdown(drafts);
  for (const text of ["QA测试记录", "QA让对象先解释顺序", "T01", "QA待验证解释", "QA原型验证问题", "没有真实测试，暂不能判断", "第2步", "先理解不同时间情境", "尚未关联，不补造真实反馈", "Design qa-design；版本 qa-native-v1"]) expect(markdown).toContain(text);
});

it("retains an explicit gap for malformed or mismatched entities without dumping their raw JSON", () => {
  const drafts = emptyAidtUiDrafts();
  drafts[5]!.fields = { "prototypeEntity:broken": '{"secretRawFixture":42}', "prototypeEntity:foreign": JSON.stringify(prototype().fields) };
  drafts[2]!.fields["interviewRecord:broken"] = "not valid JSON";
  drafts[6]!.fields["testGroup:broken"] = "not valid JSON";
  const markdown = aidtUiReportMarkdown(drafts);
  for (const text of ["部分原型记录格式无法读取", "部分访谈记录格式无法读取", "部分测试记录格式无法读取"]) expect(markdown).toContain(text);
  expect(markdown).not.toContain("secretRawFixture"); expect(markdown).not.toContain("QA原型验证问题");
});

it("shows assembled entity outcomes in the existing report reader while preserving an existing manual manuscript", () => {
  const drafts = emptyAidtUiDrafts(); drafts[5] = updateAidtPrototypeEntityDraft(drafts[5]!, "qa-design", () => prototype());
  const { rerender } = render(<AidtReportPreview drafts={drafts} text={null} sourceRevision={1} revision={1} onChange={vi.fn()} regenerate={vi.fn()} readOnly={false} />);
  expect((screen.getByLabelText("小组报告草稿") as HTMLTextAreaElement).value).toContain("QA原型验证问题");
  fireEvent.click(screen.getByRole("button", { name: "阅读预览" }));
  expect(screen.getByRole("article", { name: "小组报告阅读预览" })).toHaveTextContent("QA静态服务图");
  rerender(<AidtReportPreview drafts={drafts} text="已有人工报告不得自动覆盖" sourceRevision={1} revision={1} onChange={vi.fn()} regenerate={vi.fn()} readOnly={false} />);
  expect(screen.getByRole("article", { name: "小组报告阅读预览" })).toHaveTextContent("已有人工报告不得自动覆盖");
  expect(screen.getByRole("article", { name: "小组报告阅读预览" })).not.toHaveTextContent("QA原型验证问题");
});
