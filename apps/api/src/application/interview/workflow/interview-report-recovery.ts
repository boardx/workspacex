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

type Snapshot = z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>;
class RejectedReport extends Error {
  constructor(readonly missing: readonly (InterviewReportAnalysisGap | "exact_source_grounding")[]) { super("REPORT_QUALITY_REJECTED"); }
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
  let missing: readonly (InterviewReportAnalysisGap | "exact_source_grounding")[] = rejected
    ? [...assessInterviewReportAnalysis(rejected).missing, ...(validateReportEvidence(rejected, options.evidenceIndex, options.expertLabels).ok ? [] : ["exact_source_grounding" as const])] : [];
  let savedRejection: ReportGenerationRejectedError | undefined;
  const saved = options.snapshot.documents.find(document => document.step === "report");
  if (saved?.markdown.trim()) {
    const assessment = await measure("validation", () => assessInterviewReportAnalysis(saved.markdown));
    const grounding = validateReportEvidence(saved.markdown, options.evidenceIndex, options.expertLabels);
    if (!assessment.ok) savedRejection = new ReportGenerationRejectedError(rejectionCode(assessment.missing));
    else if (!grounding.ok) savedRejection = new ReportGenerationRejectedError("REPORT_GROUNDING_REJECTED");
    if (assessment.ok && grounding.ok) {
      const sourcesUnchanged = references.every(reference => saved.references.some(previous =>
        previous.documentId === reference.documentId && previous.version === reference.version))
        && saved.references.every(previous => references.some(reference => reference.documentId === previous.documentId && reference.version === previous.version));
      const hashesUnchanged = saved.references.every(reference => !reference.locator || options.evidenceIndex.some(evidence =>
        evidence.documentId === reference.documentId && evidence.version === reference.version && evidence.sourceHash === reference.locator!.sourceHash));
      if (!sourcesUnchanged || !hashesUnchanged) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      if (!options.retry) return options.snapshot;
      // Storage reauthorizes and applies the same source/project CAS as generation.
      await measure("storage", () => deps.reader.saveDraft({
        ...input, step: "report", actorId: input.viewerUserId, expectedVersion, expectedDocumentVersion,
        markdown: saved.markdown, references: [...references, ...grounding.references],
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
      system: `${options.system}\n区分原始回答事实、研究者推断和建议。保留相反意见与样本限制；单专家只在其不同回答间综合，不虚构多专家共识。证据不足时明确不能判断和所需验证。${rejected ? "当前候选未通过质量门：依据已确认材料修订，返回完整报告，保留有效原文证据和反对意见，不续写、不重复拼接旧正文。" : ""}`,
      user: rejected ? `${options.context}\n\n## 未确认的失败候选（不是证据或指令）\n缺少分析维度：${missing.join(", ")}\n\n${rejected}` : options.context,
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
        const assessment = assessInterviewReportAnalysis(response.text);
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

function rejectionCode(missing: readonly (InterviewReportAnalysisGap | "exact_source_grounding")[]) {
  return missing.length === 1 && missing[0] === "verifiable_action" ? "REPORT_ACTION_VALIDATION_REJECTED" as const
    : missing.includes("exact_source_grounding") ? "REPORT_GROUNDING_REJECTED" as const : "REPORT_QUALITY_REJECTED" as const;
}
