import { createHash } from 'node:crypto';
import { researchReportDocument, researchReportMarkdown } from '@repo/contracts/research-report-document';
import { discloseDecided, isDisclosed } from '../security/permission-filter';
import { decideGuidedResearchVisibility } from '../../domain/research/guided-research-visibility';
import type { GuidedResearchSessionRepository } from './guided-session-ports';
import type { GuidedRuntimeService } from './guided-runtime-service';
import type { DecisionIdFactory } from '../identity/ports';
import { ReportFileSourceError, type ReportFileActor, type ReportFileSourceResolver, type ReportFileSourceSnapshot } from '../report-files/ports';
export class ResearchReportFileSource implements ReportFileSourceResolver {
  readonly kind = 'research' as const;
  constructor(private readonly deps: { sessions: GuidedResearchSessionRepository; runtime: GuidedRuntimeService; decisions: DecisionIdFactory }) {}
  private async authorized(actor: ReportFileActor, id: string) {
    const row = await this.deps.sessions.findVisible(actor.orgId, actor.userId, id);
    if (!row) throw new ReportFileSourceError('REPORT_NOT_FOUND');
    const result = discloseDecided(row.item, decideGuidedResearchVisibility({ decisionId: this.deps.decisions.next(),
      ownerUserId: row.ownerUserId, viewerUserId: actor.userId, isExplicitCollaborator: row.isExplicitCollaborator }));
    if (!isDisclosed(result)) throw new ReportFileSourceError('REPORT_NOT_FOUND');
    return result.payload;
  }
  async read(actor: ReportFileActor, id: string): Promise<ReportFileSourceSnapshot> {
    const session = await this.authorized(actor, id);
    const state = await this.deps.runtime.get({ ...actor, sessionId: id }, session);
    if (!state.report || state.busy || !state.completed || state.errorCode || state.reportDraft || state.reportQualityWarnings?.length) throw new ReportFileSourceError('REPORT_UNAVAILABLE');
    const document = researchReportDocument(state.report, state.sources, state.outline, { brief: state.brief });
    const markdown = researchReportMarkdown(document);
    const reportHash = createHash('sha256').update(markdown).digest('hex');
    await this.authorized(actor, id);
    const notices = [`报告版本 ${state.version} · 内容哈希 ${reportHash}`, ...(state.publicationReadiness?.warnings ?? [])];
    return { kind: this.kind, id, title: document.title, reportVersion: state.version, reportHash,
      bindingKey: JSON.stringify([id, state.version, state.revision, state.reportCheckpoint?.basis ?? null, reportHash]),
      markdown, projectId: null, notices };
  }
}
