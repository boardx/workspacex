import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BOARD_REMAINING_CASES,BOARD_REMAINING_PROJECT,BOARD_REMAINING_GREP,remainingAcceptanceVerdict} from '../board-remaining-registry.mjs';
const fixture=()=>({suites:[{specs:BOARD_REMAINING_CASES.map(item=>({file:`e2e/${item.file}`,title:item.title,ok:true,tests:[{projectName:BOARD_REMAINING_PROJECT,expectedStatus:'passed',status:'expected',annotations:[],results:[{status:'passed',retry:0}]}]}))}],errors:[]});
test('registry identities determine the entire supplementary contract, never collection as PASS',()=>{
  const report=fixture();assert.equal(remainingAcceptanceVerdict(report).status,'PASS');
  assert.equal(remainingAcceptanceVerdict(report,{collection:true}).status,'COLLECTED_NOT_EXECUTED');
  for(const item of BOARD_REMAINING_CASES)assert(BOARD_REMAINING_GREP.test(`${BOARD_REMAINING_PROJECT} ${item.file} suite ${item.title}`));
  assert(!BOARD_REMAINING_GREP.test('a different test'));
});
test('missing duplicate unexpected and global errors fail closed',()=>{
  for(const change of [report=>report.suites[0].specs.pop(),report=>report.suites[0].specs.push(structuredClone(report.suites[0].specs[0])),report=>report.suites[0].specs[0].title='changed source title',report=>report.errors.push({message:'private failure'})]){
    const report=fixture();change(report);assert.equal(remainingAcceptanceVerdict(report).status,'FAIL');
  }
  assert.equal(remainingAcceptanceVerdict(null).status,'FAIL');
});
test('skip fixme expected-failure retry duplicate-project and unsuccessful attempts cannot pass',()=>{
  const changes=[
    test=>test.expectedStatus='skipped',test=>test.expectedStatus='failed',test=>test.status='flaky',
    ...['skipped','failed','timedOut','interrupted'].map(status=>test=>test.results[0].status=status),
    ...['skip','fixme','fail'].map(type=>test=>test.annotations.push({type})),
    test=>test.results.push({status:'passed',retry:1}),test=>test.results=[],test=>test.results[0].retry=1,
    test=>test.projectName='unregistered-project',
  ];
  for(const change of changes){const report=fixture();change(report.suites[0].specs[0].tests[0]);assert.equal(remainingAcceptanceVerdict(report).status,'FAIL');}
  const report=fixture();report.suites[0].specs[0].tests.push(structuredClone(report.suites[0].specs[0].tests[0]));assert.equal(remainingAcceptanceVerdict(report).status,'FAIL');
});
