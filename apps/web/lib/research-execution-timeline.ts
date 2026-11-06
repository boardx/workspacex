import { translate } from "./i18n/messages";
import { DEFAULT_LOCALE, type Locale } from "./i18n/locale";
import type { GuidedResearchRuntime as Runtime } from './guided-research-api';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'warning' | 'paused' | 'interrupted';
export interface ExecutionRow { id: string; title: string; status: ExecutionStatus; detail?: string }
const aggregate = (statuses: string[]): ExecutionStatus => {
  if (!statuses.length) return 'pending';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('running') || statuses.includes('retrying')) return 'running';
  if (statuses.includes('warning')) return 'warning';
  return statuses.every(status => status === 'completed') ? 'completed' : 'pending';
};
export function researchExecutionTimeline(state: Runtime, interrupted = false, locale: Locale = DEFAULT_LOCALE) {
  const timeline = state.reportTimeline ?? [];
  const tasks = state.tasks;
  const accepted = state.sources.filter(source => source.decision === 'accepted');
  const leasedWork = state.busy && Boolean(state.leaseUntil && Date.parse(state.leaseUntil) > Date.now());
  const active = (status: ExecutionStatus): ExecutionStatus => status !== 'running' ? status : interrupted ? 'interrupted' : state.controlStatus === 'paused' ? 'paused' : leasedWork ? status : 'pending';
  const displayWork = leasedWork || (state.busy && interrupted);
  const failedSearch = tasks.some(task => task.status === 'failed');
  const currentProgress = state.progress?.executionVersion === state.version;
  const searching = displayWork && currentProgress && state.progress?.stage === 'searching' && tasks.some(task => task.status === 'running' || task.searchAttempts?.some(attempt => attempt.status === 'running'));
  const search: ExecutionStatus = searching ? 'running' : failedSearch ? 'failed' : tasks.length && tasks.every(task => task.status === 'succeeded') ? 'completed' : 'pending';
  const sourceCounts = currentProgress ? state.progress?.sourceCounts : undefined;
  const acquiring = displayWork && Boolean(sourceCounts && (sourceCounts.reading || sourceCounts.screening));
  const lastReading = state.activity?.slice().reverse().find(event => event.stage === 'reading');
  const failedDocument = accepted.some(source => source.documentError);
  // Legacy history has no execution identity and cannot prove active work.
  const preparingSources = lastReading?.executionVersion === state.version && lastReading.status === 'started';
  const reading = displayWork && state.currentNode === 'report' && (currentProgress && state.progress?.stage === 'organizing' || preparingSources);
  const evidenceRunning = displayWork && timeline.some(step => step.stage === 'evidence' && ['running', 'retrying'].includes(step.status));
  const document: ExecutionStatus = evidenceRunning || acquiring ? 'running' : accepted.length && accepted.every(source => source.document) && !failedDocument ? 'completed' : reading ? 'running' : failedDocument ? 'warning' : 'pending';
  const chapterStatuses = timeline.filter(step => step.stage === 'chapter').map(chapter => {
    const review = timeline.find(step => step.stage === 'review' && step.sectionId === chapter.sectionId);
    if (chapter.status === 'completed' && review?.status === 'pending') return 'running';
    return chapter.status === 'completed' && review ? review.status : chapter.status;
  });
  const warnings = Boolean(state.reportDraft || state.reportQualityWarnings?.length || state.reportEvidenceWarnings?.length);
  const validation = aggregate(timeline.filter(step => step.stage === 'validation').map(step => step.status));
  // Coverage limitations remain in report prose and source diagnostics. Only a
  // persisted, quality-passed current publication proves execution completion.
  const finished = Boolean(state.report && state.completed && validation === 'completed' && !state.reportDraft && !state.reportQualityWarnings?.length && !state.busy && !state.errorCode && !interrupted && state.controlStatus !== 'paused');
  const rows: ExecutionRow[] = [
    { id: 'search', title: translate(locale, "research.timeline.search"), status: active(search) },
    { id: 'documents', title: translate(locale, "research.timeline.documents"), status: active(document), ...(sourceCounts ? { detail: translate(locale, "research.timeline.acquisitionCounts", sourceCounts) } : accepted.length ? { detail: translate(locale, "research.timeline.readSources", { read: accepted.filter(source => source.document).length, count: accepted.length }) } : {}) },
    { id: 'chapters', title: translate(locale, "research.timeline.chapters"), status: active(aggregate(chapterStatuses)),
      detail: timeline.filter(step => (step.stage === 'chapter' || step.stage === 'review') && ['running', 'retrying'].includes(step.status))
        .map(step => state.outline.find(section => section.id === step.sectionId)?.title).filter((title, index, titles) => title && titles.indexOf(title) === index).join('、') || undefined },
    { id: 'synthesis', title: translate(locale, "research.timeline.synthesis"), status: active(aggregate(timeline.filter(step => step.stage === 'synthesis').map(step => step.status))) },
    { id: 'validation', title: translate(locale, "research.timeline.validation"), status: active(warnings ? 'warning' : validation === 'completed' && !state.report ? 'pending' : validation) },
  ];
  if (finished) for (const row of rows) {
    row.status = 'completed';
  }
  const runningGoal = leasedWork && state.executionGoal === 'report';
  const summary = interrupted ? translate(locale, "research.timeline.interrupted") : state.controlStatus === 'paused' ? translate(locale, "research.timeline.paused") : state.busy && !leasedWork ? translate(locale, "research.timeline.unconfirmed") : runningGoal || searching ? translate(locale, "research.timeline.running") : finished ? translate(locale, "research.timeline.completed") : state.errorCode || tasks.some(task => task.status === 'failed') ? translate(locale, "research.timeline.failed") : warnings ? translate(locale, "research.timeline.incomplete") : leasedWork ? translate(locale, "research.timeline.running") : state.report ? translate(locale, "research.timeline.reportExists") : translate(locale, "research.timeline.planned");
  return { rows, summary, finished };
}
