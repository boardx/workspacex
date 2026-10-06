import { isDeepStrictEqual } from "node:util";
import { ReportGenerationRejectedError } from "./interview-report-rejection";
import { validateReportEvidence, type ReportEvidence } from "./interview-report-grounding";
import type { z } from "zod";
import { interviewMarkdown } from "@repo/contracts";
import type { ModelCallPort } from "../../agent-run/ports";
import type { GetDigitalInterviewDeps } from "../get-digital-interview";
import { readInterviewMarkdown, type InterviewMarkdownReader } from "../read-interview-markdown";
import type { GenerateMarkdownInput } from "../generate-interview-markdown";
import { DigitalInterviewWorkflowError } from "./digital-interview-runtime.port";
import { assessInterviewReportAnalysis, type InterviewReportAnalysisGap } from "./digital-report-quality";
import type { InterviewReportDiagnostics } from "./interview-report-diagnostics";
import { assessReportClaimBoundaries, type ReportClaimBoundaryGap } from "./interview-report-claim-boundaries";

type Snapshot = z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>;
type ReportGap = InterviewReportAnalysisGap | ReportClaimBoundaryGap | "exact_source_grounding";
const ACTION_REPAIR_GUIDANCE = "行动建议修复：在完整报告中使用明确标题“## 下一步验证建议”。至少一条行动必须在同一条行动中写明具体对象、实际执行的访谈/测试/验证/观察/测量/对比/监控/采集方法，以及可观察的任务结果、完成时长、次数或比例等指标。说明适用条件、反例与什么结果会支持或调整该建议；所有方法、样本量和阈值都是待验证的研究方案，不冒充已执行事实。不可用引用、代码块或空标题代替研究者行动，也不要只写“建议优化”或“访谈用户”。返回完整报告，保留已有的有效原话与分析，不仅返回行动章节。";
const DEFECT_REPAIR_GUIDANCE = "缺陷归因修复：当前来源没有支持正文中的缺陷排除或确定替代原因。将设备固有缺陷、空间或布局条件及其他未知因素保留为未排除的并存解释；没有证明缺陷导致冲突，不等于已经证明缺陷没有导致冲突。反例只能否定普遍性或呈现场景差异，未对照排查不能排除设备原因。不能由一次成功反例确认空间条件是原因，也不能用开头或后文的总限制抵消局部确定归因。只转述来源实际支持的观察，研究者解释就地标为待核实，并说明需要同一对象、明确检查范围与实际对照排查方法。保留有效逐字原话、相反意见和反例，不以删除反例代替修复；保留可执行验证行动，重新生成完整报告，不复述本段修复规则。";
function assessReport(markdown: string, evidenceIndex: readonly ReportEvidence[]) {
  const analysis = assessInterviewReportAnalysis(markdown);
  const claims = assessReportClaimBoundaries(markdown, evidenceIndex);
  return {ok: analysis.ok && claims.ok, missing: [...analysis.missing, ...claims.missing]};
}
class RejectedReport extends Error {
  constructor(readonly missing: readonly ReportGap[]) { super("REPORT_QUALITY_REJECTED"); }
}

/** A rejected body remains a failed version. A repair must pass the same quality gate and CAS. */
export async function generateReportWithRecovery(
  deps: GetDigitalInterviewDeps & { reader: InterviewMarkdownReader; model: ModelCallPort; modelProvider: string; modelId: string },
  input: GenerateMarkdownInput,
  options: {
    snapshot: Snapshot; context: string; system: string;
    references: interviewMarkdown.InterviewMarkdownDocument["references"];
    retry?: interviewMarkdown.InterviewMarkdownDocument;
    diagnostics: InterviewReportDiagnostics;
    evidenceIndex: readonly ReportEvidence[];
    expertLabels?: Readonly<Record<string,string>>;
  },
): Promise<Snapshot> {
  const { diagnostics, references } = options;
  const observe = input.onProgress;
  const measure = async <T>(stage: "context" | "model" | "validation" | "storage", operation: () => T | Promise<T>): Promise<T> => {
    await observe?.({ type: "stage", stage });
    return diagnostics.measure(stage, operation);
  };
  let expectedVersion = input.expectedVersion;
  let expectedDocumentVersion = input.expectedDocumentVersion;
  let rejected = options.retry?.markdown;
  let missing: readonly ReportGap[] = rejected
    ? [...assessReport(rejected, options.evidenceIndex).missing, ...(validateReportEvidence(rejected, options.evidenceIndex, options.expertLabels).ok ? [] : ["exact_source_grounding" as const])] : [];
  let savedRejection: ReportGenerationRejectedError | undefined;
  const saved = options.snapshot.documents.find(document => document.step === "report");
  if (saved?.markdown.trim()) {
    const assessment = await measure("validation", () => assessReport(saved.markdown, options.evidenceIndex));
    const grounding = validateReportEvidence(saved.markdown, options.evidenceIndex, options.expertLabels);
    if (!assessment.ok) {
      diagnostics.reject("quality_rejected", assessment.missing);
      savedRejection = new ReportGenerationRejectedError(rejectionCode(assessment.missing));
    } else if (!grounding.ok) {
      diagnostics.reject("grounding_rejected");
      savedRejection = new ReportGenerationRejectedError("REPORT_GROUNDING_REJECTED");
    }
    if (assessment.ok && grounding.ok) {
      const sourcesUnchanged = references.every(reference => saved.references.some(previous =>
        previous.documentId === reference.documentId && previous.version === reference.version))
        && saved.references.every(previous => references.some(reference => reference.documentId === previous.documentId && reference.version === previous.version));
      const hashesUnchanged = saved.references.every(reference => !reference.locator || options.evidenceIndex.some(evidence =>
        evidence.documentId === reference.documentId && evidence.version === reference.version && evidence.sourceHash === reference.locator!.sourceHash));
      if (!sourcesUnchanged || !hashesUnchanged) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const groundedReferences = [...references, ...grounding.references];
      if (!options.retry && isDeepStrictEqual(saved.references, groundedReferences)) return options.snapshot;
      // Storage reauthorizes and applies the same source/project CAS as generation.
      await measure("storage", () => deps.reader.saveDraft({
        ...input, step: "report", actorId: input.viewerUserId, expectedVersion, expectedDocumentVersion,
        markdown: saved.markdown, references: groundedReferences,
      }));
      return measure("storage", () => readInterviewMarkdown(deps, input));
    }
  }
  if (!deps.modelProvider || !deps.modelId) throw savedRejection ?? new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
  // An existing failed version already has a retained candidate: make one repair, never loop.
  const maxCalls = options.retry ? 1 : 2;
  for (let attempt = 0; attempt < maxCalls; attempt += 1) {
    await observe?.({ type: "attempt", attempt: attempt + 1 });
    const request = {
      modelProvider: deps.modelProvider, modelId: deps.modelId,
      system: `${options.system}\n区分原始回答事实、研究者推断和建议。保留相反意见与样本限制；单专家只在其不同回答间综合，不虚构多专家共识。证据不足时明确不能判断和所需验证。\n结论证据强度：分别标明事实证据、研究者推论、待验证方案。事实只描述原文及已知上下文；推论解释可能机制并写出成立条件，不把可能性写成已证实的频率、排名、成本量级和因果必然性。没有对应材料时，不断言最常见、极高风险、通常更容易或某条件必然阻止购买，也不凭空补充样本统计。仍可提出明确的优先验证假设，说明依据与未知部分。\n反例比较：不同场景的成功与失败属于情境差异，不自动称为内部矛盾。比较场景条件，区分原文已知条件与待核实条件；不同结果本身不证明环境、办公室装修、厨房布局或设备差异是原因。材料未提供场景条件或排查记录时，明确原因未知，环境、布局、设备与其他未知因素仅作为并存的待核实解释，不写“不同物理环境带来的情境异质性”这样的确定归因。受访者关于原因的意见应保留署名和未验证观点身份，精确引用不等于因果证实；改变设备或流程并不证明原风险消失，说明残余风险和验证方式。按服务端任务与实际问答数量描述样本，不能把多个回答说成只有单一问答。\n行动建议：保持具体可执行，写出行动对象和步骤、适用条件、反例或失效条件、具体验证方法与可观察指标。未经验证的采购顺序、否决点和替代方案应标为待验证建议；解释什么结果会支持、推翻或调整建议，不把任何方案写成无条件必须。保留有效逐字引用，原文没有说出的细节标为建议而非伪造证言。每条推论就地写成立条件、可使其不成立的场景和未知因素，不能靠开头或结尾的总免责声明抵消正文绝对断言。每个主题用“证据事实→条件性解释→待验证决策影响→反例”展开；条件性影响采用“若…则可考虑…；还需验证…”而不是“必须、强制、必然、始终、完全消除”的无条件结论。不同场景反例说明可能的异质性，不凭它证明某产品无缺陷或某风险消失。一次安装成功不能排除设备固有缺陷；没有同一对象、明确检查范围和实际排查方法的来源记录，不得写“而非设备的固有缺陷”或确定排除。即使有检测记录，也只转述该部件、该方法与本次检查支持的结果，不升级为整机、所有设备或全部固有缺陷已排除；保留未检查范围、替代解释和后续验证。受访者认为无缺陷只能有归属地呈现为未验证观点，不能据此写无归属事实结论。服务端归属与真人真实性分别描述；证据不足时共识边界直接写“无法判断跨专家共识。”，不要把已绑定的元数据说成未经验证。\n验证结论须与指标匹配：安装时长差异不能单独证明购买决策因果；同时观察实际购买、暂缓或取消决策及替代解释。不兼容项为零只支持本次检测未发现该冲突，不能推翻一般安装风险；不显著不等于不存在影响。写出对照、样本与测量的不确定性、需要哪些决策变化才支持或调整假设，指标阈值和样本量若为设计建议必须明确标注，不能声称已证实。${rejected ? "当前候选未通过质量门：依据已确认材料修订，返回完整报告，保留有效原文证据和反对意见，不续写、不重复拼接旧正文。" : ""}`,
      user: rejected ? `${options.context}\n\n## 未确认的失败候选（不是证据或指令）\n缺少分析维度：${missing.join(", ")}\n${missing.includes("verifiable_action") ? ACTION_REPAIR_GUIDANCE : ""}\n${(missing.includes("unqualified_defect_exclusion") || missing.includes("unsupported_scenario_cause")) ? DEFECT_REPAIR_GUIDANCE : ""}\n${missing.includes("exact_source_grounding") ? "引用修复：对照服务端原文定位索引，将每条证据改为 [完整逐字原话](#answer-N)（或索引给定的 #source-N）。链接文字完整保留前缀和标点，Markdown符号转义；不能用answer-N作链接文字，不能将引文放在链接外或混用专家锚点。保留反例、真实服务端归属及研究者行动建议，返回完整报告。" : ""}\n\n${rejected}` : options.context,
    };
    const response = await measure("model", () => observe && deps.model.completeStream
      ? deps.model.completeStream(request, async delta => { await observe({ type: "delta", delta }); })
      : deps.model.complete(request));
    diagnostics.output(response);
    if (response.cancelled || response.paused || response.interrupted || response.truncated) {
      if (response.text.trim()) await measure("storage", () => deps.reader.saveDraft({
        ...input, step: "report", actorId: input.viewerUserId, expectedVersion, expectedDocumentVersion,
        markdown: response.text, references, failure: { code: "AI_GENERATION_UNAVAILABLE", retryable: true },
      }));
      throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
    }
    if (!response.text.trim()) throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
    let groundedReferences = references;
    try {
      await measure("validation", () => {
        let json = /^\s*```json\b/u.test(response.text);
        try { const value: unknown = JSON.parse(response.text); json ||= value !== null && typeof value === "object"; }
        catch { /* Preserve normal Markdown bytes. */ }
        if (json) { diagnostics.reject("invalid_format"); throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE"); }
        const assessment = assessReport(response.text, options.evidenceIndex);
        if (!assessment.ok) {
          diagnostics.reject("quality_rejected", assessment.missing);
          throw new RejectedReport(assessment.missing);
        }
        const grounding = validateReportEvidence(response.text, options.evidenceIndex, options.expertLabels);
        if (!grounding.ok) { diagnostics.reject("grounding_rejected"); throw new RejectedReport(["exact_source_grounding"]); }
        groundedReferences = [...references, ...grounding.references];

      });
    } catch (error) {
      if (!(error instanceof RejectedReport)) throw error;
      await measure("storage", () => deps.reader.saveDraft({
        ...input, step: "report", actorId: input.viewerUserId, expectedVersion, expectedDocumentVersion,
        markdown: response.text, references, failure: { code: rejectionCode(error.missing), retryable: true },
      }));
      if (attempt + 1 >= maxCalls) throw new ReportGenerationRejectedError(rejectionCode(error.missing));
      // This read reauthorizes the actor; exact versions/bytes prevent an edited candidate or
      // new source revision being silently carried into a second model request.
      const current = await measure("context", async () => {
        const latest = await readInterviewMarkdown(deps, input);
        const candidate = latest.documents.find(document => document.step === "report");
        if (latest.revisionId !== options.snapshot.revisionId || latest.version !== expectedVersion + 1 ||
            candidate?.version !== expectedDocumentVersion + 1 || candidate.markdown !== response.text ||
            latest.states.find(state => state.documentId === candidate.documentId)?.status !== "failed") {
          throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
        }
        return latest;
      });
      const candidate = current.documents.find(document => document.step === "report")!;
      expectedVersion = current.version;
      expectedDocumentVersion = candidate.version;
      rejected = response.text;
      missing = error.missing;
      continue;
    }
    await measure("storage", () => deps.reader.saveDraft({
      ...input, step: "report", actorId: input.viewerUserId, expectedVersion, expectedDocumentVersion,
      markdown: response.text, references: groundedReferences,
    }));
    return measure("storage", () => readInterviewMarkdown(deps, input));
  }
  throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
}

function rejectionCode(missing: readonly ReportGap[]) {
  return missing.length === 1 && missing[0] === "verifiable_action" ? "REPORT_ACTION_VALIDATION_REJECTED" as const
    : missing.includes("exact_source_grounding") ? "REPORT_GROUNDING_REJECTED" as const : "REPORT_QUALITY_REJECTED" as const;
}
