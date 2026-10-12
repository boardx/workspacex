"""Synthetic evidence fixtures test gates; no generated attestation is a real review."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('acceptance',ROOT/'scripts/cn-release-isolated-acceptance.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
CASE='test_cn_release_simulation.SimulationTests.test_skip_and_expected_failure_cannot_report_green'

class AcceptanceTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.git('init','-q');(self.root/'source.py').write_text('pass\n');self.git('add','.');self.git('commit','-qm','test fixture source');self.fix=self.git('rev-parse','HEAD').strip()
  pins={'source.py':hashlib.sha256((self.root/'source.py').read_bytes()).hexdigest()}
  report=dict(kind='cn-release-independent-code-review-v1',reviewer='synthetic-reviewer',sourceRef='synthetic-unit-fixture-not-real-review',reviewedAt='2026-10-12T00:00:00Z',findings=[dict(issueId=i,disposition='accepted',reviewedFiles=pins)for i in sorted(m.KNOWN_DEFECTS)])
  raw=(json.dumps(report)+'\n').encode();(self.root/'review.json').write_bytes(raw);self.git('add','.');self.git('commit','-qm','synthetic attestation fixture');self.commit=self.git('rev-parse','HEAD').strip()
  self.ledger=dict(kind='cn-release-isolated-defect-ledger-v1',issues=[dict(id=i,severity='P1',author='synthetic-author',disposition='fixed-awaiting-replay',fixCommit=self.fix,requiredCaseIds=[CASE],requiredReviewedFiles=['source.py'],review={'file':'review.json','sha256':hashlib.sha256(raw).hexdigest()},remainingGap=None)for i in sorted(m.KNOWN_DEFECTS)])
  self.inv=dict(kind='cn-release-isolated-invariant-registry-v1',invariants=[dict(id=i,scope='synthetic unit assertion',requiredCaseIds=[CASE])for i in sorted(m.KNOWN_INVARIANTS)])
  rounds=[dict(roundId='%02d'%i,seed=40+i,commit=self.commit,status='passed',sourceUnchanged=True,sourceStateBefore={'dirty':False},sourceStateAfter={'dirty':False})for i in range(1,11)]
  results=[dict(caseId=CASE,roundId=r['roundId'],commit=self.commit,runId='12345',status='pass',evidence='fixture.json',observedAt='2026-10-12T00:00:00Z')for r in rounds]
  coverage=[dict(roundId=r['roundId'],commit=self.commit,runId='12345',complete=True,requirementDenominator=32,requirementNumerator=32,caseDenominator=1,cases=[{'caseId':CASE}],requirements=[dict(id=i,covered=True,implementation='implemented',notImplemented=[])for i in sorted(m.REQUIREMENTS)])for r in rounds]
  self.summary=dict(commit=self.commit,githubRunId='12345',baseSeed=41,requestedRounds=10,completedRounds=10,status='passed',rounds=rounds,caseResults=results,matrixCoverage=coverage)
 def git(self,*args):
  return subprocess.check_output(['git','-c','user.name=Isolated Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-C',str(self.root),*args],text=True,stderr=subprocess.DEVNULL)
 def evaluate(self):return m.evaluate(self.summary,self.ledger,self.inv,self.root)
 def test_complete_synthetic_isolated_evidence_never_accepts_production(self):
  self.assertEqual(len(m.REQUIREMENTS),32);value=self.evaluate();self.assertTrue(value['isolatedAcceptance']);self.assertFalse(value['productionAcceptance']);self.assertIsNone(value['realCloudThirtyMinutes'])
 def test_missing_review_author_claim_and_stale_bytes_do_not_close(self):
  for mutation in ('missing','self','stale','untracked','gap','unknown-author'):
   with self.subTest(mutation=mutation):
    issue=self.ledger['issues'][0];old=copy.deepcopy(issue)
    if mutation=='missing':issue['review']=None
    elif mutation=='self':issue['author']='synthetic-reviewer'
    elif mutation=='stale':issue['review']['sha256']='0'*64
    elif mutation=='untracked':issue['review']['file']='missing.json'
    elif mutation=='gap':issue['remainingGap']='pending'
    else:issue['author']=None
    self.assertFalse(self.evaluate()['isolatedAcceptance']);self.ledger['issues'][0]=old
 def test_nonancestor_commit_rejects_and_ancestor_is_real_git(self):
  self.assertTrue(m.ancestor(self.root,self.fix,self.commit));self.ledger['issues'][0]['fixCommit']='f'*40;self.assertFalse(self.evaluate()['seriousIssuesClosed'])
 def test_current_reviewed_source_tampering_rejects(self):
  (self.root/'source.py').write_text('changed\n');self.assertFalse(self.evaluate()['seriousIssuesClosed'])
 def test_nine_rounds_dirty_different_commit_skip_duplicate_and_missing_case_reject(self):
  for mode in ('nine','dirty','commit','skip','duplicate','missing'):
   with self.subTest(mode=mode):
    original=copy.deepcopy(self.summary)
    if mode=='nine':self.summary['completedRounds']=9
    elif mode=='dirty':self.summary['rounds'][0]['sourceStateAfter']['dirty']=True
    elif mode=='commit':self.summary['caseResults'][0]['commit']='a'*40
    elif mode=='skip':self.summary['caseResults'][0]['status']='skip'
    elif mode=='duplicate':self.summary['caseResults'].append(copy.deepcopy(self.summary['caseResults'][0]))
    else:self.summary['caseResults'].pop()
    self.assertFalse(self.evaluate()['isolatedAcceptance']);self.summary=original
 def test_partial_requirement_open_serious_issue_and_unmeasured_invariant_reject(self):
  self.summary['matrixCoverage'][0]['requirements'][0]['implementation']='partial';self.assertFalse(self.evaluate()['fullMatrixCoverage'])
  self.summary['matrixCoverage'][0]['requirements'][0]['implementation']='implemented'
  self.ledger['issues'][0]['disposition']='open';self.assertFalse(self.evaluate()['seriousIssuesClosed'])
  self.inv['invariants'][0]['requiredCaseIds']=[];value=self.evaluate();self.assertFalse(value['safetyInvariantAssertionsPassed']);self.assertIsNone(value['assertedInvariantFailureCount'])
 def test_removing_known_defect_or_invariant_cannot_shrink_denominator(self):
  self.ledger['issues'].pop();self.assertFalse(self.evaluate()['seriousIssuesClosed']);self.inv['invariants'].pop();self.assertFalse(self.evaluate()['safetyInvariantAssertionsPassed'])
 def test_open_p2_known_blocker_prevents_acceptance_without_changing_severity(self):
  issue=next(i for i in self.ledger['issues']if i['id']=='UPG-01');issue['severity']='P2';issue['disposition']='open'
  value=self.evaluate();self.assertTrue(value['seriousIssuesClosed']);self.assertFalse(value['allKnownIssuesClosed']);self.assertFalse(value['isolatedAcceptance']);self.assertEqual(issue['severity'],'P2')
 def test_observed_assertion_failure_is_counted_but_missing_is_null(self):
  self.summary['caseResults'][0]['status']='fail';value=self.evaluate()
  self.assertEqual(value['assertedInvariantFailureCount'],len(m.KNOWN_INVARIANTS));self.assertEqual(value['assertedInvariantCaseDenominator'],10*len(m.KNOWN_INVARIANTS))
  self.summary['caseResults'].pop();self.assertIsNone(self.evaluate()['assertedInvariantFailureCount'])
 def test_nonrequired_duplicate_case_is_rejected(self):
  row=copy.deepcopy(self.summary['caseResults'][0]);row['caseId']='test_cn_release_simulation.SimulationTests.test_real_child_success_and_stats'
  self.summary['caseResults'] += [row,copy.deepcopy(row)]
  value=self.evaluate();self.assertFalse(value['allCaseKeysUnique']);self.assertFalse(value['isolatedAcceptance'])
 def test_invalid_identity_and_repeated_or_wrong_round_seed_reject(self):
  for key,value in [('githubRunId','fixture-run'),('githubRunId','0'),('githubRunId',12345),('commit','main'),('commit','A'*40),('baseSeed',True)]:
   with self.subTest(key=key,value=value):
    old=self.summary[key];self.summary[key]=value;self.assertFalse(self.evaluate()['isolatedAcceptance']);self.summary[key]=old
  for seed in (41,999,True):
   self.summary['rounds'][1]['seed']=seed;self.assertFalse(self.evaluate()['roundSeedsValid'])
 def test_real_shallow_clone_rejects_ancestor_until_local_history_is_obtained(self):
  import os
  shallow=self.root/'shallow-clone';env={**os.environ,'GIT_ALLOW_PROTOCOL':'file','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
  subprocess.run(['git','clone','--quiet','--depth','1',self.root.as_uri(),str(shallow)],env=env,check=True,capture_output=True)
  self.assertEqual(m.git(shallow,'rev-parse','--is-shallow-repository').stdout.strip(),b'true')
  self.assertFalse(m.review_verified(shallow,self.commit,self.ledger['issues'][0]))
  subprocess.run(['git','-C',str(shallow),'fetch','--quiet','--unshallow','origin'],env=env,check=True,capture_output=True)
  self.assertEqual(m.git(shallow,'rev-parse','--is-shallow-repository').stdout.strip(),b'false')
  self.assertTrue(m.review_verified(shallow,self.commit,self.ledger['issues'][0]))
  workflow=(ROOT/'.github/workflows/cn-release-simulation.yml').read_text();self.assertIn('fetch-depth: 0',workflow)
  helper=(ROOT/'scripts/cn-release-simulation-ci.py').read_text();self.assertIn('CI_FULL_HISTORY_REQUIRED',helper)
 def test_real_cli_final_gate_rejects_green_tests_with_partial_or_open_p2(self):
  import sys
  # This subprocess executes the production CLI/main. Expensive suite execution
  # and evidence quantification are explicit fixtures; evaluator itself is
  # exercised with real Git review evidence by the tests above.
  code="""import importlib.util,json,sys
from pathlib import Path
s=importlib.util.spec_from_file_location('runner',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.subprocess.check_output=lambda args,**kw: 'a'*40+'\\n' if 'rev-parse' in args else ''
m.execute=lambda *a,**kw:dict(suite=a[0],status='passed',statistics=dict(tests=1,failures=0,errors=0,skipped=0,expectedFailures=0,unexpectedSuccesses=0))
gate=sys.argv[4]
def quantify(summary,output):
 summary.update(isolatedAcceptance=False,completeRegressionAccepted=False,caseCounts={'pass':10},matrixCoverage=[],acceptanceGates={gate:False},durationDistribution={},metrics=[],caseResults=[])
m.quantify=quantify
rounds=sys.argv[2];out=sys.argv[3]
sys.argv=['simulation','--rounds',rounds,'--output',out]
raise SystemExit(m.main())
"""
  for rounds in (1,10):
   for gate in ('fullMatrixCoverage','allKnownIssuesClosed'):
    out=self.root/('cli-'+str(rounds)+'-'+gate)
    result=subprocess.run([sys.executable,'-I','-B','-c',code,str(ROOT/'scripts/cn-release-simulation.py'),str(rounds),str(out),gate],capture_output=True,text=True,timeout=15)
    self.assertEqual(result.returncode,0 if rounds==1 else 1,result.stderr)
    value=json.loads((out/'summary.json').read_text());self.assertEqual(value['testsStatus'],'passed');self.assertFalse(value['completeRegressionAccepted'])
    self.assertEqual(value['blockedReason'],'FINAL_ISOLATED_ACCEPTANCE_INCOMPLETE' if rounds==10 else None)
 def assert_standalone_binding(self,identifier,mutate_runner=None):
  import ast,types
  from unittest.mock import patch
  fixed={name.replace('-','_')+'_contract':(name,'cn_release_'+file+'_linux.py')for name,file in (
   ('linux-domain','simulation_domain'),('linux-postgres','postgres'),('linux-postgres-lifecycle','postgres_lifecycle'),
   ('linux-storage','storage'),('linux-api-startup','api_startup'),('linux-docker-cleanup','docker_cleanup'),
   ('linux-readiness','readiness'),('linux-boundary-reap','boundary_reap'),('linux-entry','cgroup'),('linux-browser','browser'))}
  self.assertIn(identifier,fixed,'Unregistered standalone aggregate')
  suite,filename=fixed[identifier]
  source=ROOT/'tests'/filename;tree=ast.parse(source.read_text())
  self.assertTrue(any(isinstance(n,ast.FunctionDef)and n.name=='main'for n in tree.body))
  rs=importlib.util.spec_from_file_location('actual_simulation_runner',ROOT/'scripts/cn-release-simulation.py');runner=importlib.util.module_from_spec(rs);rs.loader.exec_module(runner)
  if mutate_runner is not None:mutate_runner(runner)
  self.assertEqual(runner.SUITES.get(suite),[filename])
  # Exercise actual child registration with a explicitly synthetic main, without
  # claiming execution of the Linux integration itself.
  fake=types.SimpleNamespace(main=lambda:0);loader=types.SimpleNamespace(exec_module=lambda module:None)
  with tempfile.TemporaryDirectory()as td,patch.object(runner.platform,'system',return_value='Linux'),patch.object(runner.importlib.util,'spec_from_file_location',return_value=types.SimpleNamespace(loader=loader))as load,patch.object(runner.importlib.util,'module_from_spec',return_value=fake):
   result=Path(td)/'aggregate.tests.json';self.assertEqual(runner.child(suite,result),0)
   load.assert_called_once_with('cn_simulation_standalone_integration',source)
   rows=json.loads(result.with_suffix('.cases.json').read_text());self.assertEqual([(r['caseId'],r['status'])for r in rows],[(identifier,'pass')])
 def test_standalone_binding_rejects_unregistered_identifier(self):
  for identifier in ('unknown_contract','linux_readiness','linux_readiness_contract.extra'):
   with self.assertRaises(AssertionError):self.assert_standalone_binding(identifier)
 def test_standalone_binding_rejects_wrong_source_mapping(self):
  with self.assertRaises(AssertionError):self.assert_standalone_binding('linux_readiness_contract',lambda runner:runner.SUITES.__setitem__('linux-readiness',['cn_release_postgres_linux.py']))
 def test_actual_registry_case_ids_exist_in_inventory_sources(self):
  import ast
  ledger=json.loads((ROOT/'docs/operations/cn-release-simulation-defects.json').read_text());inv=json.loads((ROOT/'docs/operations/cn-release-simulation-invariants.json').read_text())
  ids=set(i for row in ledger['issues']+inv['invariants'] for i in row['requiredCaseIds'])
  for identifier in ids:
   if '.'not in identifier:
    self.assert_standalone_binding(identifier);continue
   module,cls,name=identifier.split('.')
   if module=='test_cn_release_boundary_faults':
    # This fixed original suite generates its 51 methods from real STAGES.
    # Load the inventory without running setup or any test body.
    loaded=unittest.defaultTestLoader.loadTestsFromName(identifier)
    def flatten(items):
     for item in items:
      if isinstance(item,unittest.TestSuite):yield from flatten(item)
      else:yield item.id()
    self.assertEqual(list(flatten(loaded)),[identifier]);continue
   tree=ast.parse((ROOT/'tests'/(module+'.py')).read_text())
   self.assertTrue(any(isinstance(c,ast.ClassDef)and c.name==cls and any(isinstance(f,ast.FunctionDef)and f.name==name for f in c.body)for c in tree.body),identifier)

if __name__=='__main__':unittest.main()
