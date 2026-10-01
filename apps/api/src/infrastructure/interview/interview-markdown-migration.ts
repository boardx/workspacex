import type { interviewMarkdown } from "@repo/contracts";
import type { TenantSession } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { readDigitalInterviewWorkflow } from "./pg-digital-interview-repository";
import { guard, type Guarded } from "../../application/security/permission-filter";
import { appendInterviewMarkdownDocument, readInterviewMarkdownDocuments } from "./interview-markdown-store";
export { appendInterviewMarkdownDocument, readInterviewMarkdownDocuments } from "./interview-markdown-store";

/** Deterministic Markdown archive for pre-rollout fields, not a JSON research body. */
function legacyMarkdown(value: unknown, depth = 2): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item, index) => `${"#".repeat(Math.min(depth, 6))} ${index + 1}\n\n${legacyMarkdown(item, depth + 1)}`).join("\n\n");
  if (typeof value === "object") return Object.entries(value).map(([key, item]) =>
    `${"#".repeat(Math.min(depth, 6))} ${key}\n\n${legacyMarkdown(item, depth + 1)}`).join("\n\n");
  const text = String(value);
  const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1)));
  return `${fence}text\n${text}\n${fence}`;
}

/** Explicit opt-in backfill; ordinary GET never silently mutates legacy data. */
export async function migrateInterviewMarkdown(session: TenantSession, orgId: OrgId, interviewId: string): Promise<Guarded<void>> {
  const revision = await session.query<{ id: string }>(
    `SELECT id FROM digital_interview_revisions WHERE org_id=$1 AND interview_id=$2 AND is_current FOR UPDATE`,
    [orgId, interviewId],
  );
  if (!revision.rows[0]) return guard({ kind: "interview", id: interviewId }, undefined);
  const workflow = await readDigitalInterviewWorkflow(session, orgId, interviewId);
  if (!workflow) return guard({ kind: "interview", id: interviewId }, undefined);
  const migrated = await readInterviewMarkdownDocuments(session, orgId, interviewId, workflow.revisionId);
  const bodies: Partial<Record<interviewMarkdown.InterviewMarkdownDocument["step"], string>> = {
    intake: workflow.topic ?? "",
    analysis: workflow.researchBrief ? `# 研究分析\n\n${legacyMarkdown(workflow.researchBrief)}` : "",
    experts: workflow.expertCandidates.length ? `# 专家画像\n\n${legacyMarkdown(workflow.expertCandidates)}` : "",
    outline: workflow.questions.length || workflow.questionCandidates.length
      ? `# 访谈问题\n\n${legacyMarkdown(workflow.questions.length ? workflow.questions : workflow.questionCandidates)}` : "",
    runs: workflow.expertRuns.length ? `# 访谈记录\n\n${legacyMarkdown(workflow.expertRuns)}` : "",
    report: workflow.report?.markdown ?? workflow.reportGeneration?.markdown ?? "",
  };
  for (const step of ["intake", "analysis", "experts", "outline", "runs", "report"] as const) {
    // A legacy run snapshot is immutable once migrated. Never freeze in-flight
    // evidence: a later explicit initialization can archive completed answers.
    if (step === "runs" && (!workflow.expertRuns.length || workflow.expertRuns.some((run) => run.status !== "completed"))) continue;
    if (migrated.versions.some((document) => document.step === step)) continue;
    const old = workflow.artifacts.find((artifact) => artifact.step === step);
    // Artifacts used to be thin display projections. Archive the richer source
    // fields as well, without rewriting or dropping the existing Markdown bytes.
    const body = bodies[step];
    const markdown = body && old?.markdown && body !== old.markdown
      ? `${body}\n\n# 迁移前步骤正文\n\n${old.markdown}` : body || old?.markdown;
    if (!markdown?.trim()) continue; // Never fabricate analysis or a report for empty stages.
    await appendInterviewMarkdownDocument(session, {
      orgId, interviewId, revisionId: workflow.revisionId, step,
      title: old?.title ?? `${workflow.name} · ${step}`, markdown,
      evidenceMode: old?.evidenceMode ?? workflow.studyEvidenceMode,
      references: [], expectedVersion: old?.version ?? 0, source: "legacy-migration-v1",
      status: old?.status ?? ((step === "report" && !workflow.report)
        || (step === "outline" && !workflow.questions.length) ? "draft" : "confirmed"),
      failure: old?.failure ?? null,
    });
  }
  return guard({ kind: "interview", id: interviewId }, undefined);
}
