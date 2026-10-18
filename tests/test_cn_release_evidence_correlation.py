"""Self-consistent generated files deliberately remain UNVERIFIED_SOURCE."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('correlation', ROOT/'scripts/cn-release-evidence-correlation.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def raw(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()


def stamp(seconds):
    import datetime as dt
    return (dt.datetime(2026, 10, 18, tzinfo=dt.timezone.utc)+dt.timedelta(seconds=seconds)).isoformat()


class CorrelationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)/'attempt'; self.root.mkdir()
        self.packages = Path(temp.name)/'packages'; self.packages.mkdir()
        self.identity = dict(sourceRevision='a'*40, baselineRevision='b'*40, controlRevision='c'*40,
                             attemptId='one', requestedAt=stamp(10), deadlineAt=stamp(1810))
        self.approval = dict(kind='cn-fixed-release-approval-v1', target=c.observer.TARGET,
                             identity={**self.identity, 'publicationAttemptId':'build-one'},
                             business={'stableWindowSeconds':30})
        self.a6 = dict(kind='cn-independent-business-acceptance-v1', **self.approval['identity'],
                       mode='observe', runtimeRevision='a'*40, runtimeInventorySha256='1'*64,
                       bindingSha256='2'*64, switchReceiptSha256='3'*64, observedAt=stamp(725),
                       checks={key:True for key in c.business.CHECKS}, stableWindowSeconds=30,
                       ownedAcceptanceRunIds=['owned-1','owned-2','owned-3'],
                       liveObservationSha256=['4'*64,'5'*64])
        self.run = dict(id=123, run_attempt=2, actor={'login':'owner'}, repository={'full_name':'boardx/workspacex'},
                        path='.github/workflows/release.yml', head_branch='main', event='workflow_dispatch',
                        head_sha='c'*40, status='completed', conclusion='success', created_at=stamp(0))
        self.jobs = dict(total_count=1, jobs=[dict(id=456,run_id=123,run_attempt=2,status='completed',
                        conclusion='success',started_at=stamp(5),completed_at=stamp(750))])
        self.expected = dict(runId=123, runAttempt=2, jobId=456, owner='owner', workflowPath=self.run['path'])
        self.snapshot()

    def snapshot(self):
        identity = dict(self.identity, scope='runtime-only-reviewed-continuation')
        (self.root/'identity.json').write_bytes(raw(identity))
        previous = None
        for i, stage in enumerate(c.m.entry.STAGES):
            prefix = '%02d-%s' % (i, stage)
            content = raw(self.a6 if stage == 'observe' else {'fixture':True})
            files = {'action.sh':b':\n', 'observe.sh':b':\n', 'verify.py':b'# not executed\n',
                     'authorization.json':raw(self.approval)}
            manifest = dict(identity, stage=stage, previousReceiptSha256=previous,
                            actionSha256=c.m.digest(files['action.sh']), observerSha256=c.m.digest(files['observe.sh']),
                            verifierSha256=c.m.digest(files['verify.py']), authorizationEvidenceSha256=c.m.digest(files['authorization.json']))
            manifest_raw = raw(manifest); request = c.m.digest(manifest_raw)
            folder = self.packages/request; folder.mkdir(exist_ok=True)
            (folder/'manifest.json').write_bytes(manifest_raw)
            for name, value in files.items(): (folder/name).write_bytes(value)
            finish = 740 if stage == 'observe' else 25+i*40
            intent = dict(stage=stage, requestSha256=request, previousReceiptSha256=previous,createdAt=stamp(20+i*40))
            admission = dict(kind='cn-entry-admission-v1', requestSha256=request, verifierSha256=manifest['verifierSha256'],
                             observerSha256=manifest['observerSha256'], authorizationEvidenceSha256=manifest['authorizationEvidenceSha256'],
                             evidenceSha256=c.m.digest(content), terminalObservationSha256=c.m.digest(content))
            receipt = dict(identity, stage=stage, requestSha256=request, previousReceiptSha256=previous,mode='advance',
                           finishedAt=stamp(finish),elapsedSeconds=finish-10,withinTotalBudget=True,
                           evidenceSha256=c.m.digest(content),terminalObservationSha256=c.m.digest(content),admissionSha256=c.m.digest(raw(admission)))
            terminal = dict(reason='EXITED', exitCode=0,stdoutSha256=c.m.digest(content),processGroupStillPresent=False,finishedAt=stamp(finish-1))
            for suffix, value in [('.intent.json',intent),('.process.json',{'pid':321,'requestSha256':request}),
                                  ('.terminal.json',terminal),('.admission.json',admission),('.receipt.json',receipt)]:
                (self.root/(prefix+suffix)).write_bytes(raw(value))
            for suffix in ['.evidence.json','.terminal-observation.json']: (self.root/(prefix+suffix)).write_bytes(content)
            previous = c.m.digest(raw(receipt))

    def correlate(self):
        return c.correlate(self.root, self.packages, raw(self.run), raw(self.jobs), self.expected,
                           github_accepted_at=stamp(0),user_requested_at=stamp(0),observed_at=stamp(800))

    def test_generated_consistent_graph_never_establishes_trust(self):
        value = self.correlate()
        self.assertTrue(value['consistencyChecked'])
        self.assertEqual(value['workflowCreationToA6Seconds'],725)
        self.assertEqual(value['status'],'UNVERIFIED_SOURCE')
        for key in ['productionAccepted','thirtyMinuteProductionProven','sourceAuthorityVerified',
                    'canonicalVerifierExecuted','crossHostClockErrorVerified','githubRequestAcceptanceVerified']:
            self.assertIs(value[key],False)
        self.assertEqual(value['approvalRawSha256'],c.m.digest(raw(self.approval)))

    def test_github_identity_scope_and_terminal_failures(self):
        original = copy.deepcopy(self.run)
        for change in [dict(run_attempt=1),dict(id=True),dict(head_sha='f'*40),dict(actor={'login':'other'}),
                       dict(repository={'full_name':'other/repo'}),dict(head_branch='other'),dict(event='push'),
                       dict(conclusion='skipped'),dict(status='in_progress'),dict(path='.github/workflows/other.yml')]:
            self.run = {**original,**change}
            with self.subTest(change=change),self.assertRaises(c.m.Rejected):self.correlate()

    def test_partial_duplicate_wrong_attempt_or_failed_job_rejected(self):
        original = copy.deepcopy(self.jobs)
        mutations=[{'total_count':2}, {'jobs':[original['jobs'][0],original['jobs'][0]],'total_count':2},
                   {'jobs':[None]}, {'jobs':[{**original['jobs'][0],'run_attempt':1}]},
                   {'jobs':[{**original['jobs'][0],'conclusion':'skipped'}]}]
        for change in mutations:
            self.jobs={**original,**change}
            with self.subTest(change=change),self.assertRaises(c.m.Rejected):self.correlate()

    def test_fully_rehashed_wrong_target_still_fails(self):
        self.approval['target']={**c.observer.TARGET,'ecsInstanceId':'other'};self.snapshot()
        with self.assertRaisesRegex(c.m.Rejected,'TARGET_SCOPE_DRIFT'):self.correlate()

    def test_fully_rehashed_a6_failures(self):
        original=copy.deepcopy(self.a6)
        for change in [dict(mode='rollback'),dict(runtimeRevision='f'*40),dict(checks={}),
                       dict(stableWindowSeconds=29),dict(ownedAcceptanceRunIds=['one']*3),
                       dict(liveObservationSha256=[]),dict(observedAt=stamp(670))]:
            self.a6={**original,**change};self.snapshot()
            with self.subTest(change=change),self.assertRaises(c.m.Rejected):self.correlate()

    def test_frozen_300_second_window_not_silently_shortened(self):
        self.approval['business']['stableWindowSeconds']=300;self.a6['stableWindowSeconds']=300;self.snapshot()
        with self.assertRaisesRegex(c.m.Rejected,'STABLE_WINDOW_TIME'):self.correlate()

    def test_cannot_supply_trusted_boolean_or_callback(self):
        self.expected['trusted']=True
        with self.assertRaisesRegex(c.m.Rejected,'EXPECTED_FIELDS'):self.correlate()

    def test_bad_json_shapes_and_depth_reject(self):
        for value in [[],None,True,12,'string']:
            with self.subTest(value=value),self.assertRaises(c.m.Rejected):c.object_value(raw(value))
        with self.assertRaises(c.m.Rejected):c.object_value(b'['*1100+b']'*1100)

    def test_changes_after_closure_cannot_enter_correlation(self):
        original_inspect=c.closure.inspect
        for name in ['identity.json','16-observe.evidence.json','16-observe.intent.json',
                     '16-observe.receipt.json','16-observe.admission.json']:
            path=self.root/name; original=path.read_bytes()
            def replacing(*args,**kwargs):
                result=original_inspect(*args,**kwargs)
                path.write_bytes(original+b' ')
                return result
            with self.subTest(name=name),patch.object(c.closure,'inspect',replacing),self.assertRaisesRegex(c.m.Rejected,'CORRELATION_SNAPSHOT_CHANGED'):
                self.correlate()
            path.write_bytes(original)


if __name__ == '__main__':unittest.main()
