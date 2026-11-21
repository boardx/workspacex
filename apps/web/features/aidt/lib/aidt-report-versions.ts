import { listAidtStageHistory, type AidtSharedStage } from "./live-aidt-stages";
import { aidtReportSourceLinks } from "./aidt-report-source-links";

export function reportInStage(stage: AidtSharedStage, reportEntityId?: string) {
  return reportEntityId ? stage.content.reports?.[reportEntityId] : stage.content.summaryReport;
}

export function isConfirmedReportVersion(stage: AidtSharedStage, reportEntityId?: string): boolean {
  return stage.stageId === 6 && reportInStage(stage, reportEntityId)?.confirmedAtRevision === stage.revision;
}

export async function readExactReportSource(projectId: string, stageId: number, revision: number, token: string, signal: AbortSignal) {
  const beforeRevision = revision < 2147483647 ? revision + 1 : undefined;
  const { items } = await listAidtStageHistory(projectId, stageId, token, { beforeRevision, limit: 1 }, signal);
  const stage = items[0];
  if (!stage || stage.projectId !== projectId || stage.stageId !== stageId || stage.revision !== revision) throw new Error("AIDT_REPORT_VERSION_UNAVAILABLE");
  return stage;
}

export async function readConfirmedReportForExport(projectId: string, revision: number, token: string, signal: AbortSignal, reportEntityId?: string) {
  const stage = await readExactReportSource(projectId, 6, revision, token, signal);
  const report = reportInStage(stage, reportEntityId);
  if (!report || !isConfirmedReportVersion(stage, reportEntityId)) throw new Error("AIDT_REPORT_UNCONFIRMED");
  const sources = await Promise.all(report.sourceStageRevisions.map(source =>
    readExactReportSource(projectId, source.stageId, source.revision, token, signal),
  ));
  const receipt = `报告 V${stage.revision} · ${stage.updatedAt} · 确认者 ${stage.updatedBy}`;
  return [
    report.markdown,
    "",
    "## 确认与来源版本",
    receipt,
    ...sources.flatMap(source => [
      `- 第 ${source.stageId} 步 V${source.revision} · ${source.updatedAt} · 保存者 ${source.updatedBy}`,
      ...aidtReportSourceLinks(source).map(link => `  - [${link.title.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ")} · V${source.revision}](${link.href})`),
    ]),
    ...(sources.length ? [] : ["尚未关联已保存的阶段版本。"]),
    "",
  ].join("\n");
}
