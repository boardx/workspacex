"""Once-delegation authority tests with real original binder validation."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('derived',ROOT/'scripts/cn-release-derived-approval.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
spec=importlib.util.spec_from_file_location('bind_tests',ROOT/'tests/test_cn_release_continuation_bind.py')
fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)


class DerivedApprovalTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.ReviewedPackageIntegration();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.release='a'*64;self.validator='8'*64;self.phase='hold'
        r={k:self.f.request[k]for k in m.IDENTITY}
        self.a=dict(kind='cn-release-once-delegation-v1',scope='normal-four-phase-materialization',
            releaseRequestSha256=self.release,release=r,target=m.TARGET,allowedPhases=list(m.PRECEDING),
            issuedAt=self.f.approval['issuedAt'],expiresAt=self.f.approval['expiresAt'],
            templateHashes=self.f.approval['packageFiles'],derivationSha256='6'*64,binderSha256='7'*64,
            evidenceValidatorSha256=self.validator)
        self.validated=[];self.prepare('hold')

    def prepare(self,phase):
        self.phase=phase;self.f.advance_inputs(phase)
        self.receipts={p:m.encode({'fixture':p})for p in m.PRECEDING[phase]}
        self.j=dict(kind='cn-release-validated-journal-v1',releaseRequestSha256=self.release,
            identity=dict(self.a['release']),target=m.TARGET,phaseReady=phase,validatorSha256=self.validator,
            activeOperations=[],uncertainOperations=[],observedAt=self.f.now.isoformat(),
            inputHashes={k:m.sha(v)for k,v in self.f.inputs.items()},
            completed=[dict(phase=p,status='succeeded',releaseRequestSha256=self.release,
                attemptId=self.a['release']['attemptId'],validatorSha256=self.validator,
                observedAt=self.f.now.isoformat(),receiptSha256=m.sha(self.receipts[p]))for p in m.PRECEDING[phase]])

    def validate(self,request,approval,inputs):
        with tempfile.TemporaryDirectory()as td:
            result=fixtures.m.bind(request,approval,self.f.package,inputs,Path(td)/'phase',now=self.f.now)
            self.validated.append(result)

    def derive(self):
        return m.derive(self.release,m.encode(self.a),m.encode(self.j),self.f.inputs,self.phase,
                        validate=self.validate,preceding_receipts=self.receipts,now=self.f.now)

    def test_one_delegation_generates_four_real_materializer_approvals(self):
        approved_raw=m.encode(self.a)
        for phase in ('hold','stop','backup','switch'):
            self.prepare(phase);request,approval=self.derive()
            self.assertEqual(m.encode(self.a),approved_raw)
            r,a=m.parse(request),m.parse(approval)
            self.assertEqual(r['requestedAt'],self.a['release']['requestedAt'])
            self.assertEqual(r['deadlineAt'],self.a['release']['deadlineAt'])
            self.assertEqual(a['requestSha256'],m.sha(request))
            self.assertEqual(a['delegation']['approvalRawSha256'],m.sha(approved_raw))
        self.assertEqual(len(self.validated),4)

    def test_phase_skip_unknown_and_active_fail_before_materializer(self):
        self.prepare('switch');self.j['completed'].pop(2)
        with self.assertRaisesRegex(ValueError,'PHASE_SKIP'):self.derive()
        self.prepare('switch');self.j['uncertainOperations']=['stop']
        with self.assertRaisesRegex(ValueError,'UNKNOWN_OPERATION'):self.derive()
        self.prepare('switch');self.j['activeOperations']=['backup']
        with self.assertRaisesRegex(ValueError,'UNKNOWN_OPERATION'):self.derive()
        self.assertEqual(self.validated,[])

    def test_cross_attempt_or_retimed_journal_rejected(self):
        self.j['identity']['attemptId']='other'
        with self.assertRaisesRegex(ValueError,'JOURNAL_IDENTITY'):self.derive()
        self.prepare('hold');self.j['identity']['requestedAt']=self.f.now.isoformat()
        with self.assertRaisesRegex(ValueError,'JOURNAL_IDENTITY'):self.derive()

    def test_unvalidated_or_changed_raw_receipt_rejected(self):
        self.j['completed'][0]['validatorSha256']='f'*64
        with self.assertRaisesRegex(ValueError,'UNVALIDATED'):self.derive()
        self.prepare('hold');self.receipts['publish']=b'changed'
        with self.assertRaisesRegex(ValueError,'PRECEDING_RAW_HASH'):self.derive()

    def test_input_bytes_cannot_be_substituted(self):
        self.f.inputs['publication']+=b' '
        with self.assertRaisesRegex(ValueError,'EVIDENCE_RAW_HASH'):self.derive()

    def test_original_binder_validates_receipts_before_approval(self):
        self.prepare('switch')
        r=json.loads(self.f.inputs['rdsBackup']);r['holdGeneration']='wrong'
        self.f.inputs['rdsBackup']=m.encode(r);self.j['inputHashes']['rdsBackup']=m.sha(self.f.inputs['rdsBackup'])
        with self.assertRaisesRegex(ValueError,'MATERIALIZER_REJECTED'):self.derive()
        self.assertEqual(self.validated,[])

    def test_normal_scope_never_creates_final_recovery_or_acquire_authority(self):
        for phase in ('clear-hold','status','rollback','abort-original','acquire'):
            self.phase=phase
            with self.assertRaisesRegex(ValueError,'UNSUPPORTED_PHASE_SCOPE'):self.derive()
        self.phase='hold';self.a['scope']='fresh-recovery'
        with self.assertRaisesRegex(ValueError,'DELEGATION_SCOPE'):self.derive()

    def test_expired_release_and_wrong_target_rejected(self):
        self.a['release']['deadlineAt']=(self.f.now-dt.timedelta(seconds=1)).isoformat()
        with self.assertRaisesRegex(ValueError,'RELEASE_DEADLINE'):self.derive()
        self.a['target']={**m.TARGET,'ecsInstanceId':'other'}
        with self.assertRaisesRegex(ValueError,'FIXED_TARGET'):self.derive()

    def test_publish_is_exclusive_and_uses_both_fsyncs(self):
        path=self.f.root/'approval.json'
        with patch.object(m,'trusted_dir'),patch.object(m.os,'fsync',wraps=m.os.fsync)as sync:
            m.publish(path,b'original')
            self.assertEqual(sync.call_count,2)
            with self.assertRaises(FileExistsError):m.publish(path,b'replacement')
        self.assertEqual(path.read_bytes(),b'original')


if __name__=='__main__':unittest.main()
