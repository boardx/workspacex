"""Fixed two-job aggregation rejects partial, foreign and duplicated evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('split_aggregate', ROOT / 'scripts/cn-release-simulation-aggregate.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SplitAggregate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.sha = 'a' * 40
        self.parts = {}
        for name, suites in [('release', ['release']), ('remaining', [n for n in m.sim.SUITES if n != 'release'])]:
            p = self.root / name / 'cn-simulation-artifacts'; rd = p / 'round-01'; rd.mkdir(parents=True)
            rows = []
            for suite in suites:
                cid = 'fixture.' + suite
                cases = [dict(caseId=cid, status='pass', durationSeconds=.1, layer='isolated-fixture')]
                inventory = [dict(caseId=cid, status='notrun', durationSeconds=None, layer='isolated-fixture')]
                stats = dict(tests=1, failures=0, errors=0, skipped=0, expectedFailures=0, unexpectedSuccesses=0)
                for suffix, value in [('cases', cases), ('inventory', inventory)]:
                    self.put(rd / (suite + '.tests.' + suffix + '.json'), value)
                self.put(rd / (suite + '.tests.json'), stats)
                rows.append(dict(suite=suite, status='passed', reason=None, exitCode=0, durationSeconds=.2, statistics=stats,
                    cleanup=dict(kind='linux-cgroup-v2-owned-cleanup', verified=True, populated=0, removed=True),
                    dockerCleanup=dict(verified=True) if suite in m.sim.DOCKER_SUITE_REGISTRIES else None,
                    casesEvidence=suite+'.tests.cases.json', inventoryEvidence=suite+'.tests.inventory.json'))
            r = dict(roundId='01', commit=self.sha, seed=0, status='passed', sourceUnchanged=True,
                     sourceStateBefore=dict(dirty=False), sourceStateAfter=dict(dirty=False), suites=rows,
                     startedAt='2026-11-03T00:00:00+00:00', finishedAt='2026-11-03T00:00:01+00:00', durationSeconds=1)
            s = dict(kind='cn-release-isolated-simulation-v1', suiteSelection=name, commit=self.sha,
                     githubRunId='42', githubRunAttempt='1', mode='acceptance', requestedRounds=1, completedRounds=1,
                     baseSeed=0, status='passed', testsStatus='passed', exitStatus='passed', trackedChanges=False,
                     productionAccepted=False, externalServiceMode='fixtures', rounds=[r])
            self.put(p / 'summary.json', s); self.put(rd / 'round.json', r)
            self.put(p / 'simulation-outer-cleanup.json', dict(kind='linux-systemd-owned-resource-cleanup', verified=True, populated=0, removed=True))
            self.parts[name] = p

    def put(self, path, value): path.write_text(json.dumps(value))
    def change(self, path, fn):
        value=json.loads(path.read_text()); fn(value); self.put(path,value)
    def validate(self): return m.validate(self.root, self.sha, '42', '1', 0)

    def test_complete_exact_two_part_inventory(self):
        result=self.validate()
        self.assertEqual(len(result['suites']),len(m.sim.SUITES))
        self.assertEqual(len(result['caseIds']),len(m.sim.SUITES))
        self.assertEqual(result['durationSeconds'],1)

    def test_aggregate_reuses_existing_reports_without_claiming_ten_rounds(self):
        output=self.root.parent/(self.root.name+'-combined')
        self.addCleanup(lambda: __import__('shutil').rmtree(output,ignore_errors=True))
        result=m.aggregate(self.root,output,self.sha,'42','1',0)
        self.assertEqual(result['caseCounts']['pass'],len(m.sim.SUITES))
        self.assertFalse(result['completeRegressionAccepted'])
        self.assertFalse(result['productionAccepted'])
        self.assertEqual(result['splitEvidence']['caseCount'],len(m.sim.SUITES))
        self.assertTrue((output/'report.txt').exists())

    def test_copy_uses_validated_snapshot_after_artifact_changes(self):
        validated=self.validate()
        self.change(self.parts['release']/'round-01/release.tests.cases.json',lambda x:x[0].update(caseId='unvalidated'))
        output=self.root.parent/(self.root.name+'-snapshot')
        self.addCleanup(lambda: __import__('shutil').rmtree(output,ignore_errors=True))
        with patch.object(m,'validate',return_value=validated):
            result=m.aggregate(self.root,output,self.sha,'42','1',0)
        self.assertIn('fixture.release',{r['caseId']for r in result['caseResults']})
        self.assertNotIn('unvalidated',{r['caseId']for r in result['caseResults']})

    def test_outer_cleanup_missing_and_symlink_rejected(self):
        path=self.parts['release']/'simulation-outer-cleanup.json'
        raw=path.read_bytes();path.unlink()
        with self.assertRaises((ValueError,OSError)):self.validate()
        target=self.root/'unexpected';target.write_bytes(raw);path.symlink_to(target)
        with self.assertRaises((ValueError,OSError)):self.validate()

    def test_foreign_identity_and_wrong_part_rejected(self):
        p=self.parts['release']/'summary.json'; original=p.read_text()
        for field,value in [('commit','b'*40),('githubRunId','43'),('githubRunAttempt','2'),('suiteSelection','remaining'),('baseSeed',1),('requestedRounds',10),('mode','development')]:
            with self.subTest(field=field):
                self.change(p,lambda x:x.update({field:value}))
                with self.assertRaises(ValueError): self.validate()
                p.write_text(original)

    def test_uploaded_archive_layout_is_fixed_and_unambiguous(self):
        packet=self.parts['release'].parent
        # Actual upload uses RUNNER_TEMP as common ancestor because the terminal
        # diagnostic is outside the exported report directory.
        (packet/'cn-terminal-diagnostic.log').write_text('fixture only')
        self.validate()
        (packet/'summary.json').write_text((self.parts['release']/'summary.json').read_text())
        with self.assertRaises(ValueError):self.validate()

    def test_missing_part_suite_or_changed_round_rejected(self):
        p=self.parts['remaining']/'summary.json'; raw=p.read_text()
        p.unlink()
        with self.assertRaises((ValueError,OSError)): self.validate()
        p.write_text(raw)
        self.change(p,lambda x:x['rounds'][0]['suites'].pop())
        with self.assertRaises(ValueError): self.validate()

    def test_duplicate_case_skip_or_inventory_mismatch_rejected(self):
        rd=self.parts['release']/'round-01'; p=rd/'release.tests.cases.json'; raw=p.read_text()
        for mutate in (lambda x:x.append(copy.deepcopy(x[0])), lambda x:x[0].update(status='skip'),lambda x:x[0].update(caseId='foreign')):
            with self.subTest(mutate=mutate):
                self.change(p,mutate)
                with self.assertRaises(ValueError): self.validate()
                p.write_text(raw)

    def test_cross_suite_duplicate_rejected(self):
        name=next(n for n in m.sim.SUITES if n!='release');rd=self.parts['remaining']/'round-01'
        for suffix in ('cases','inventory'):
            self.change(rd/(name+'.tests.'+suffix+'.json'),lambda x:x[0].update(caseId='fixture.release'))
        with self.assertRaises(ValueError): self.validate()

    def test_failed_cleanup_stats_or_traversal_rejected(self):
        p=self.parts['release']/'summary.json'; q=self.parts['release']/'round-01/round.json'; raw=p.read_text(); rraw=q.read_text()
        for mutate in (lambda x:x['suites'][0]['cleanup'].update(verified=False),lambda x:x['suites'][0]['statistics'].update(tests=2),lambda x:x['suites'][0].update(casesEvidence='../secret.json'),lambda x:x['suites'].append(copy.deepcopy(x['suites'][0]))):
            self.change(p,lambda x:mutate(x['rounds'][0])); self.change(q,mutate)
            with self.assertRaises(ValueError): self.validate()
            p.write_text(raw);q.write_text(rraw)
        self.change(self.parts['release']/'simulation-outer-cleanup.json',lambda x:x.update(populated=1))
        with self.assertRaises(ValueError): self.validate()

    def test_remaining_is_exact_complement_without_changing_suite_inventory(self):
        import contextlib,io,sys
        seen=[]
        def execute(name,*args):
            seen.append(name)
            return dict(suite=name,status='passed',exitCode=0,statistics=dict(tests=1,failures=0,errors=0,skipped=0,expectedFailures=0,unexpectedSuccesses=0))
        output=self.root/'remaining-selection'
        argv=['simulation','--output',str(output),'--suite','remaining','--workers','3']
        with patch.object(m.sim,'scheduled_execute',side_effect=execute), patch.object(m.sim.subprocess,'check_output',side_effect=lambda cmd,**kw:'a'*40+'\n' if 'rev-parse' in cmd else ''), patch.object(sys,'argv',argv), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.sim.main(),0)
        self.assertEqual(set(seen),set(m.sim.SUITES)-{'release'})
        self.assertEqual(len(seen),len(m.sim.SUITES)-1)
        summary=json.loads((output/'summary.json').read_text())
        self.assertEqual(summary['suiteSelection'],'remaining')
        self.assertEqual(summary['rounds'],[json.loads((output/'round-01/round.json').read_text())])
        self.assertFalse(summary['completeRegressionAccepted'])

    def test_plan_only_splits_one_acceptance_all(self):
        self.assertNotIn('release',m.sim.HEAVY_SUITES)
        self.assertEqual(m.sim.workflow_plan('all',1,'acceptance'),dict(suites=['release','remaining'],split=True))
        for lane, rounds, mode in [('all',10,'acceptance'),('all',1,'development'),('targeted',1,'acceptance')]:
            self.assertFalse(m.sim.workflow_plan(lane,rounds,mode)['split'])
        for lane,rounds in [('remaining',1),('targeted',10)]:
            with self.assertRaises(ValueError):m.sim.workflow_plan(lane,rounds,'acceptance')


if __name__=='__main__':unittest.main()
