/** Supplementary restoration contract, separate from the complete fullstack/native suites. */
export const BOARD_REMAINING_CASES = Object.freeze([
  ...[
    '15 layout commands converge and undo',
    'Alt-drag duplicates ActiveSelection, converges and undoes',
    'pointer snap guide converges and undoes',
    'smart preview cancel apply undo CAS and reload',
    'visual acceptance: compact selection in three viewports',
  ].map(title => ({file:'board-selection-layout.spec.ts', title, group:'restored'})),
  {file:'board-thinking-input.spec.ts', title:'brainstorm input creates twenty connected ideas and one-operation bulk undo', group:'restored'},
  {file:'chat-public-share.spec.ts', title:'real owner publishes, anonymous friends read on phone/desktop, then owner revokes', group:'restored'},
  {file:'inbox-smoke.spec.ts', title:'① 直接提交反馈 → 跳转收件箱并自动打开该条详情 drawer', group:'restored'},
  ...[true,false].flatMap(creating => ['fast','slow','cancel','lock','release-lock','release-delete'].map(mode => ({
    file:'board-connector-fast-snap.spec.ts', title:`#5666 ${creating?'create':'rebind'} ${mode} endpoint snap survives release`, group:'fast-snap',
  }))),
].map(item => Object.freeze(item)));

export const BOARD_REMAINING_PROJECT = 'board-remaining-supplementary';
export const BOARD_REMAINING_FILES = Object.freeze([...new Set(BOARD_REMAINING_CASES.map(item=>item.file))]);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export const BOARD_REMAINING_GREP = new RegExp(`(?:^| )(?:${BOARD_REMAINING_CASES.map(item=>escape(item.title)).join('|')})$`);
const key = item => `${item.file}\0${item.title}`;

/** Validate raw Playwright JSON, never infer success from exit 0 or test collection. */
export function remainingAcceptanceVerdict(report,{collection=false}={}) {
  const failures=[], observed=new Map(), expected=new Map(BOARD_REMAINING_CASES.map(item=>[key(item),item]));
  if(expected.size!==BOARD_REMAINING_CASES.length)failures.push('DUPLICATE_REGISTRY_IDENTITY');
  const visit=suite=>{
    for(const spec of suite.specs??[]){
      const file=String(spec.file??suite.file??'').replaceAll('\\','/').split('/').at(-1);
      const identity=key({file,title:spec.title});
      observed.set(identity,(observed.get(identity)??0)+1);
      if(!expected.has(identity))failures.push(`UNREGISTERED_CASE:${file}:${spec.title}`);
      if(!Array.isArray(spec.tests)||spec.tests.length!==1){failures.push(`DUPLICATE_OR_ABSENT_PROJECT:${file}:${spec.title}`);continue;}
      const test=spec.tests[0];
      if(test.projectName!==BOARD_REMAINING_PROJECT)failures.push(`WRONG_PROJECT:${file}:${spec.title}`);
      if(!collection){
        if(test.expectedStatus!=='passed'||spec.ok!==true||test.status!=='expected')failures.push(`NOT_EXPECTED_PASS:${file}:${spec.title}`);
        if(!Array.isArray(test.results)||test.results.length!==1||test.results[0].status!=='passed'||test.results[0].retry!==0)failures.push(`NOT_SINGLE_PASSED_ATTEMPT:${file}:${spec.title}`);
        if((test.annotations??[]).some(annotation=>['skip','fixme','fail'].includes(annotation.type)))failures.push(`DISALLOWED_ANNOTATION:${file}:${spec.title}`);
      }
    }
    for(const nested of suite.suites??[])visit(nested);
  };
  if(!report||!Array.isArray(report.suites))failures.push('MISSING_REPORT_SUITES');else for(const suite of report.suites)visit(suite);
  if((report?.errors??[]).length)failures.push('GLOBAL_REPORT_ERROR');
  for(const [identity,item] of expected){const count=observed.get(identity)??0;if(count!==1)failures.push(`${count===0?'ABSENT':'DUPLICATE'}:${item.file}:${item.title}`);}
  return {status:failures.length?'FAIL':collection?'COLLECTED_NOT_EXECUTED':'PASS',expected:expected.size,observed:[...observed.values()].reduce((sum,count)=>sum+count,0),groups:Object.fromEntries([...new Set(BOARD_REMAINING_CASES.map(item=>item.group))].map(group=>[group,BOARD_REMAINING_CASES.filter(item=>item.group===group).length])),failures};
}
