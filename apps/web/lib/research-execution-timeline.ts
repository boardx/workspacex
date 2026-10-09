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
export function researchExecutionTimeline(state: Runtime, interrupted = false) {
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
  const lastReading = state.activity?.slice().reverse().find(event => event.stage === 'reading');
  const failedDocument = accepted.some(source => source.documentError);
  // Legacy history has no execution identity and cannot prove active work.
  const preparingSources = lastReading?.executionVersion === state.version && lastReading.status === 'started';
  const reading = displayWork && state.currentNode === 'report' && (currentProgress && state.progress?.stage === 'organizing' || preparingSources);
  const document: ExecutionStatus = accepted.length && accepted.every(source => source.document) && !failedDocument ? 'completed' : reading ? 'running' : failedDocument ? 'warning' : 'pending';
  const chapterStatuses = timeline.filter(step => step.stage === 'chapter').map(chapter => {
    const review = timeline.find(step => step.stage === 'review' && step.sectionId === chapter.sectionId);
    if (chapter.status === 'completed' && review?.status === 'pending') return 'running';
    return chapter.status === 'completed' && review ? review.status : chapter.status;
  });
  const warnings = Boolean(state.reportDraft || state.reportQualityWarnings?.length || state.reportEvidenceWarnings?.length);
  const validation = aggregate(timeline.filter(step => step.stage === 'validation').map(step => step.status));
  const rows: ExecutionRow[] = [
    { id: 'search', title: '检索资料', status: active(search), ...(searching && failedSearch ? { detail: '部分检索失败' } : {}) },
    { id: 'documents', title: '读取并整理真实来源', status: active(document), ...(reading && failedDocument ? { detail: '部分来源读取失败' } : {}) },
    { id: 'chapters', title: '章节撰写与检查', status: active(aggregate(chapterStatuses)) },
    { id: 'synthesis', title: '综合结论', status: active(aggregate(timeline.filter(step => step.stage === 'synthesis').map(step => step.status))) },
    { id: 'validation', title: '质量检查与保存', status: active(warnings ? 'warning' : validation === 'completed' && !state.report ? 'pending' : validation) },
  ];
  const finished = Boolean(state.report && state.completed && !state.busy && !state.errorCode && !warnings && !interrupted && state.controlStatus !== 'paused' && !tasks.some(task => task.status === 'failed'));
  const runningGoal = leasedWork && state.executionGoal === 'report';
  const summary = interrupted ? '执行已中断' : state.controlStatus === 'paused' ? '执行已暂停' : state.busy && !leasedWork ? '执行状态待确认' : runningGoal || searching ? '正在执行研究计划' : state.errorCode || tasks.some(task => task.status === 'failed') ? '执行失败' : warnings ? '部分步骤未完成' : finished ? '执行完成' : leasedWork ? '正在执行研究计划' : state.report ? '已有报告，请查看质量与保存状态' : '将按以下计划执行';
  return { rows, summary, finished };
}
