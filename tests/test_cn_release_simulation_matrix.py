"""Machine coverage inventory: static IDs are requirements, never execution proof."""
import ast
import json
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
PATH=ROOT/'docs/operations/cn-release-simulation-matrix.json'

class MatrixContract(unittest.TestCase):
 def setUp(self):self.matrix=json.loads(PATH.read_text())
 def test_exact_twenty_five_faults_and_seven_scenarios(self):
  rows=self.matrix['requirements']
  self.assertEqual({r['id']for r in rows},{'T%02d'%i for i in range(1,26)}|{'S%02d'%i for i in range(1,8)})
  self.assertEqual(len(rows),32);self.assertFalse(self.matrix['productionAccepted'])
 def test_every_required_id_is_exact_existing_test_method(self):
  cases=self.matrix['cases'];ids=[c['caseId']for c in cases]
  self.assertEqual(len(ids),len(set(ids)))
  for case in cases:
   if case.get('caseKind')=='standalone-aggregate-contract':
    spec=importlib.util.spec_from_file_location('simulation_inventory',ROOT/'scripts/cn-release-simulation.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
    self.assertEqual(case['caseId'],case['suite'].replace('-','_')+'_contract')
    self.assertEqual(case['source'],'tests/'+runner.SUITES[case['suite']][0])
    self.assertTrue(any(isinstance(n,ast.FunctionDef)and n.name=='main' for n in ast.parse((ROOT/case['source']).read_text()).body));continue
   module,cls,method=case['caseId'].split('.')
   self.assertEqual(case['source'],'tests/'+module+'.py')
   classes=[c for c in ast.parse((ROOT/case['source']).read_text()).body if isinstance(c,ast.ClassDef)and c.name==cls]
   self.assertEqual(len(classes),1,case['caseId'])
   self.assertEqual(sum(isinstance(f,ast.FunctionDef)and f.name==method for f in classes[0].body),1,case['caseId'])
 def test_bidirectional_ids_and_no_implicit_extra_credit(self):
  registry={c['caseId']:c for c in self.matrix['cases']}
  for row in self.matrix['requirements']:
   self.assertEqual(len(row['requiredCaseIds']),len(set(row['requiredCaseIds'])))
   for case_id in row['requiredCaseIds']:self.assertIn(row['id'],registry[case_id]['requiredBy'])
  for case_id,case in registry.items():
   self.assertEqual(set(case['requiredBy']),{r['id']for r in self.matrix['requirements']if case_id in r['requiredCaseIds']})
 def test_unimplemented_requirements_cannot_claim_complete(self):
  for row in self.matrix['requirements']:
   self.assertIn(row['implementation'],('implemented','partial','notImplemented'))
   if row['implementation']=='implemented':self.assertTrue(row['requiredCaseIds']);self.assertEqual(row['notImplemented'],[])
   else:self.assertTrue(row['notImplemented'])
   if row['implementation']=='notImplemented':self.assertEqual(row['requiredCaseIds'],[])
  for identifier in ('T18','T19'):
   self.assertEqual(next(r for r in self.matrix['requirements']if r['id']==identifier)['implementation'],'partial')
 def test_boundaries_and_actual_evidence_fields_are_required(self):
  for case in self.matrix['cases']:
   self.assertTrue(case['realBoundaries']);self.assertTrue(case['mockBoundaries']);self.assertTrue(case['coverageLimit'])
   self.assertEqual(case['evidenceLayer'],'isolated-production-code-fixture')
  self.assertEqual(self.matrix['coverageContract']['missingCaseStatus'],'notrun')
  self.assertEqual(self.matrix['coverageContract']['requiredEvidence'],['commit','runId','roundId','observedAt','caseId','status','evidence'])
  self.assertTrue(self.matrix['integrationGaps'])
 def calculate(self,results):
  spec=importlib.util.spec_from_file_location('simulation_matrix_runtime',ROOT/'scripts/cn-release-simulation.py')
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  return module.matrix_coverage(self.matrix,results,'a'*40,'123','01')
 def observation(self,case_id,status='pass',**changes):
  return dict(caseId=case_id,status=status,commit='a'*40,runId='123',roundId='01',observedAt='2026-10-12T00:00:00Z',evidence='round-01/release.tests.cases.json',**changes)
 def test_missing_skip_fail_and_duplicate_never_receive_credit(self):
  ids=[c['caseId']for c in self.matrix['cases']]
  values=[self.observation(ids[0]),self.observation(ids[1],'skip'),self.observation(ids[2],'fail'),self.observation(ids[3]),self.observation(ids[3])]
  result=self.calculate(values)
  self.assertEqual(result['caseDenominator'],60);self.assertEqual(result['caseNumerator'],1)
  by_id={c['caseId']:c for c in result['cases']}
  self.assertEqual(by_id[ids[4]]['status'],'notrun');self.assertTrue(by_id[ids[3]]['duplicate']);self.assertFalse(result['complete'])
 def test_other_round_or_commit_cannot_fill_this_round(self):
  ids=[c['caseId']for c in self.matrix['cases']];first=self.observation(ids[0]);second=self.observation(ids[1])
  first['roundId']='02';second['commit']='b'*40
  result=self.calculate([first,second]);self.assertEqual(result['caseNumerator'],0);self.assertEqual(result['foreignIdentityResults'],2)
 def test_all_implemented_cases_do_not_fill_unimplemented_requirements(self):
  result=self.calculate([self.observation(c['caseId'])for c in self.matrix['cases']])
  self.assertEqual(result['caseNumerator'],60);self.assertEqual(result['requirementDenominator'],32);self.assertEqual(result['requirementNumerator'],22);self.assertFalse(result['complete'])
 def test_pass_without_evidence_is_not_counted(self):
  value=self.observation(self.matrix['cases'][0]['caseId']);value['evidence']=None
  self.assertEqual(self.calculate([value])['caseNumerator'],0)

if __name__=='__main__':unittest.main()
