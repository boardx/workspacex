import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { GuidedResearchExecutionTimeline } from '@/components/research-studio/guided-research-execution-timeline';
import { runtimeFixture } from '../guided-runtime-fixture';
afterEach(cleanup);
it('shows pending work before any execution',()=>{render(<GuidedResearchExecutionTimeline state={{...runtimeFixture('outline'),tasks:[],sources:[]}} />);expect(screen.getAllByText('待执行')).toHaveLength(5);expect(screen.queryByText('执行完成')).not.toBeInTheDocument();});
it('does not invent active work from a busy report goal',()=>{render(<GuidedResearchExecutionTimeline state={{...runtimeFixture('research'),tasks:[],sources:[],busy:true,executionGoal:'report'} as ReturnType<typeof runtimeFixture>}/>);expect(screen.getAllByText('待执行')).toHaveLength(5);});
it('shows partial task failure without overall completion',()=>{const s=runtimeFixture('research');render(<GuidedResearchExecutionTimeline state={{...s,busy:false,tasks:[{id:'bad',sectionId:'o',query:'q',attempts:1,status:'failed',errorCode:'RESEARCH_SEARCH_EMPTY'}],sources:[],report:null}}/>);expect(screen.getByText('执行失败')).toBeInTheDocument();expect(screen.queryByText('执行完成')).not.toBeInTheDocument();});
it('shows pause and interruption explicitly',()=>{const s={...runtimeFixture('research'),busy:true,controlStatus:'paused' as const};const view=render(<GuidedResearchExecutionTimeline state={s}/>);expect(screen.getByText('执行已暂停')).toBeInTheDocument();view.rerender(<GuidedResearchExecutionTimeline state={s} interrupted/>);expect(screen.getByText('执行已中断')).toBeInTheDocument();});
it('keeps a quality draft limited instead of completed',()=>{const s=runtimeFixture('report');render(<GuidedResearchExecutionTimeline state={{...s,report:null,reportDraft:s.report,busy:false,completed:false}}/>);expect(screen.getByText('部分内容待核实')).toBeInTheDocument();expect(screen.queryByText('执行完成')).not.toBeInTheDocument();});
it('keeps chapter writing active until the real review completes',()=>{render(<GuidedResearchExecutionTimeline state={{...runtimeFixture('report'),report:null,busy:true,leaseUntil:'2099-01-01T00:00:00Z',reportTimeline:[{id:'c',stage:'chapter',sectionId:'o',status:'completed',attempts:1},{id:'r',stage:'review',sectionId:'o',status:'pending',attempts:0}]}}/>);expect(screen.getByTestId('execution-chapters')).toHaveTextContent('执行中');});

it('does not replay an old reading-started activity after reading finished',()=>{render(<GuidedResearchExecutionTimeline state={{...runtimeFixture('report'),report:null,busy:true,activity:[{id:'a',sequence:1,stage:'reading',taskId:null,summary:'read',occurredAt:'now',status:'started'},{id:'b',sequence:2,stage:'reading',taskId:null,summary:'read',occurredAt:'now',status:'succeeded'}]}}/>);expect(screen.getByTestId('execution-documents')).toHaveTextContent('待执行');});

it('keeps prior failed task facts while a leased report retry is running',()=>{const state={...runtimeFixture('research'),busy:true,executionGoal:'report' as const,leaseUntil:'2099-01-01T00:00:00Z',tasks:[{id:'bad',sectionId:'o',query:'q',attempts:1,status:'failed' as const,errorCode:'RESEARCH_SEARCH_EMPTY'}],sources:[],report:null,errorCode:'RESEARCH_SEARCH_FAILED'};const view=render(<GuidedResearchExecutionTimeline state={state}/>);expect(screen.getByRole('status')).toHaveTextContent('正在执行研究计划');expect(screen.getByTestId('execution-search')).toHaveTextContent('失败');view.rerender(<GuidedResearchExecutionTimeline state={{...state,busy:false}}/>);expect(screen.getByRole('status')).toHaveTextContent('执行失败');view.rerender(<GuidedResearchExecutionTimeline state={state} interrupted/>);expect(screen.getByRole('status')).toHaveTextContent('执行已中断');});

it('shows active siblings alongside partial search failures', () => {
  const base = runtimeFixture('research');
  const state = { ...base, busy: true, leaseUntil: '2099-01-01T00:00:00Z', progress: { stage: 'searching' as const, executionVersion: base.version, completed: 0, total: 2 }, tasks: [
    { ...base.tasks[0]!, id: 'bad', status: 'failed' as const, errorCode: 'RESEARCH_SEARCH_EMPTY' },
    { ...base.tasks[0]!, id: 'active', status: 'running' as const },
  ] };
  const view = render(<GuidedResearchExecutionTimeline state={state} />);
  expect(screen.getByTestId('execution-search')).toHaveTextContent('执行中');
  expect(screen.getByTestId('execution-search')).toHaveTextContent('部分检索失败');
  view.rerender(<GuidedResearchExecutionTimeline state={structuredClone(state)} />);
  expect(screen.getByTestId('execution-search')).toHaveTextContent('执行中');
  view.rerender(<GuidedResearchExecutionTimeline state={{ ...state, busy: false, tasks: state.tasks.map(t => ({ ...t, status: 'failed' })) }} />);
  expect(screen.getByTestId('execution-search')).toHaveTextContent('失败');
  expect(screen.getByTestId('execution-search')).not.toHaveTextContent('执行中');
  expect(screen.queryByText('执行完成')).not.toBeInTheDocument();
});

it('recognizes a running recovery attempt without erasing its failed task', () => {
  const base = runtimeFixture('research');
  const state = { ...base, busy: true, leaseUntil: '2099-01-01T00:00:00Z', progress: { stage: 'searching' as const, executionVersion: base.version, completed: 0, total: 1 }, tasks: [{ ...base.tasks[0]!, status: 'failed' as const,
    errorCode: 'RESEARCH_SEARCH_EMPTY', searchAttempts: [{ query: 'recovery', status: 'running' as const, errorCode: null }],
  }] };
  const view = render(<GuidedResearchExecutionTimeline state={state} />);
  expect(screen.getByTestId('execution-search')).toHaveTextContent('执行中');
  expect(screen.getByTestId('execution-search')).toHaveTextContent('部分检索失败');
  for (const terminal of [{ ...state, busy: false }, { ...state, controlStatus: 'paused' as const }, { ...state, leaseUntil: '2000-01-01T00:00:00Z' }]) {
    view.rerender(<GuidedResearchExecutionTimeline state={terminal} />);
    expect(screen.getByTestId('execution-search')).not.toHaveTextContent('执行中');
  }
  view.rerender(<GuidedResearchExecutionTimeline state={state} interrupted />);
  expect(screen.getByTestId('execution-search')).not.toHaveTextContent('执行中');
  expect(state.tasks[0]!.status).toBe('failed');
});

it('keeps live reading visible alongside a source error and preserves report prose', () => {
  const base = runtimeFixture('report');
  const state = { ...base, busy: true, leaseUntil: '2099-01-01T00:00:00Z', progress: { stage: 'organizing' as const, executionVersion: base.version, completed: 0, total: 2 },
    sources: [{ ...base.sources[0]!, documentError: 'unavailable' as const }],
  };
  const view = render(<GuidedResearchExecutionTimeline state={state} />);
  expect(screen.getByTestId('execution-documents')).toHaveTextContent('执行中');
  expect(screen.getByTestId('execution-documents')).toHaveTextContent('部分来源读取失败');
  view.rerender(<GuidedResearchExecutionTimeline state={{ ...state, busy: false }} />);
  expect(screen.getByTestId('execution-documents')).toHaveTextContent('待核实');
  expect(screen.getByTestId('execution-documents')).not.toHaveTextContent('执行中');
  expect(state.report).toEqual(base.report);
});

it('does not turn a historical reading failure into active reading during a search retry', () => {
  const base = runtimeFixture('research');
  render(<GuidedResearchExecutionTimeline state={{ ...base, busy: true, leaseUntil: '2099-01-01T00:00:00Z',
    progress: { stage: 'searching', completed: 0, total: 1 },
    sources: [{ ...base.sources[0]!, documentError: 'unavailable' }],
    activity: [{ id: 'old', sequence: 1, stage: 'reading', taskId: null, summary: 'old read', occurredAt: '2000-01-01', status: 'started' }],
  }} />);
  expect(screen.getByTestId('execution-documents')).toHaveTextContent('待核实');
  expect(screen.getByTestId('execution-documents')).not.toHaveTextContent('执行中');
});

it('does not replay historical reading activity even at the report destination', () => {
  render(<GuidedResearchExecutionTimeline state={{ ...runtimeFixture('report'), report: null, busy: true,
    leaseUntil: '2099-01-01T00:00:00Z', tasks: [], sources: [], progress: { stage: 'searching', completed: 0, total: 0 },
    activity: [{ id: 'old', sequence: 1, stage: 'reading', taskId: null, summary: 'old read', occurredAt: '2000-01-01', status: 'started' }],
  }} />);
  expect(screen.getByTestId('execution-documents')).not.toHaveTextContent('执行中');
});

it('does not claim active search or organization without a current lease', () => {
  const base = runtimeFixture('report');
  render(<GuidedResearchExecutionTimeline state={{ ...base, busy: true, leaseUntil: null,
    tasks: [{ ...base.tasks[0]!, status: 'running' }], progress: { stage: 'organizing', completed: 0, total: 1 },
  }} />);
  expect(screen.getByTestId('execution-search')).not.toHaveTextContent('执行中');
  expect(screen.getByTestId('execution-documents')).not.toHaveTextContent('执行中');
  expect(screen.getByRole('status')).toHaveTextContent('执行状态待确认');
});

it('requires the current execution stamp after reclaim instead of relabeling old progress', () => {
  const base = runtimeFixture('report');
  const state = { ...base, busy: true, leaseUntil: '2099-01-01T00:00:00Z', version: base.version + 1,
    progress: { stage: 'organizing' as const, completed: 0, total: 1, executionVersion: base.version },
    sources: [{ ...base.sources[0]!, documentError: 'unavailable' as const }],
    activity: [{ id: 'old', sequence: 1, stage: 'reading' as const, taskId: null, summary: 'old read', occurredAt: '2000-01-01', status: 'started' as const, executionVersion: base.version }],
  };
  const view = render(<GuidedResearchExecutionTimeline state={state} />);
  expect(screen.getByTestId('execution-documents')).toHaveTextContent('待核实');
  view.rerender(<GuidedResearchExecutionTimeline state={{ ...state, activity: [{ ...state.activity[0]!, executionVersion: state.version }] }} />);
  expect(screen.getByTestId('execution-documents')).toHaveTextContent('执行中');
  expect(screen.getByTestId('execution-documents')).toHaveTextContent('部分来源读取失败');
  view.rerender(<GuidedResearchExecutionTimeline state={{ ...state, activity: [{ ...state.activity[0]!, executionVersion: state.version }], revision: state.revision + 1, leaseUntil: '2099-01-02T00:00:00Z' }} />);
  expect(screen.getByTestId('execution-documents')).toHaveTextContent('执行中');
  view.rerender(<GuidedResearchExecutionTimeline state={{ ...state, progress: { ...state.progress, executionVersion: state.version } }} />);
  expect(screen.getByTestId('execution-documents')).toHaveTextContent('执行中');
  view.rerender(<GuidedResearchExecutionTimeline state={{ ...state, progress: { ...state.progress, executionVersion: state.version }, controlStatus: 'paused' }} />);
  expect(screen.getByTestId('execution-documents')).not.toHaveTextContent('执行中');
});

it('requires current progress for a running search attempt after reclaim', () => {
  const base = runtimeFixture('research');
  const state = { ...base, busy: true, leaseUntil: '2099-01-01T00:00:00Z', version: base.version + 1,
    tasks: [{ ...base.tasks[0]!, status: 'running' as const }],
    progress: { stage: 'searching' as const, completed: 0, total: 1, executionVersion: base.version },
  };
  const view = render(<GuidedResearchExecutionTimeline state={state} />);
  expect(screen.getByTestId('execution-search')).not.toHaveTextContent('执行中');
  view.rerender(<GuidedResearchExecutionTimeline state={{ ...state, progress: { ...state.progress, executionVersion: state.version } }} />);
  expect(screen.getByTestId('execution-search')).toHaveTextContent('执行中');
});
