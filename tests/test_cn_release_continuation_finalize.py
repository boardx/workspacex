"""Real original-template subprocess generation; synthetic evidence, no cloud calls."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'scripts/cn-release-continuation-finalize.py'
spec=importlib.util.spec_from_file_location('finalize_adapter',SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
enc=lambda value:(json.dumps(value,sort_keys=True)+'\n').encode()


class FinalizeIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.now=dt.datetime.now(dt.timezone.utc)
        issued=(self.now-dt.timedelta(seconds=5)).isoformat();expires=(self.now+dt.timedelta(minutes=20)).isoformat()
        self.r=dict(schemaVersion=1,mode='status',sourceRevision='1'*40,controlRevision='2'*40,
            attemptId='new-finalize-attempt',remoteRoot='/var/lib/workspacex-cn/runtime/upgrade-f0eb-new-test',
            requestedAt=issued,deadlineAt=expires,issuedAt=issued,expiresAt=expires,inputs={})
        self.hold=dict(state='held',generation='new-generation',identity=dict(sourceRevision='1'*40,
            baselineRevision='3'*40,attemptId='new-finalize-attempt',migrationPlanSha256='4'*64))
        self.binding=dict(draft=False,hold=self.hold,**{k:self.r[k] for k in ('sourceRevision','controlRevision','attemptId','requestedAt','deadlineAt')})
        self.inputs=dict(binding=enc(self.binding),hold=enc(self.hold),switchReceipt=enc(dict(
            exactFiveRunning=True,holdRetained=True,businessAcceptancePassed=False)))
        self.a=dict(kind='cn-continuation-finalize-approval-v1',requestSha256='',issuedAt=issued,expiresAt=expires,
            packageFiles={n:m.sha((m.TEMPLATES/n).read_bytes()) for n in ('prepare.py','runtime.py')})

    def clear(self):
        self.r['mode']='clear-hold'
        self.inputs['status']=enc(dict(kind='f0eb-exact-five-status-v1',bindingSha256=m.sha(self.inputs['binding']),
            switchReceiptSha256=m.sha(self.inputs['switchReceipt']),hold=self.hold,attemptId=self.r['attemptId'],
            sourceRevision=self.r['sourceRevision'],exactFiveVerified=True,runtimeMutation=False,
            observedAt=self.r['issuedAt'],containers=[]))
        self.inputs['businessReceipt']=enc(dict(kind='cn-independent-business-acceptance-v1',
            **{k:self.r[k]for k in ('sourceRevision','controlRevision','attemptId','requestedAt','deadlineAt')},
            bindingSha256=m.sha(self.inputs['binding']),switchReceiptSha256=m.sha(self.inputs['switchReceipt']),
            holdGeneration=self.hold['generation'],observedAt=self.r['issuedAt'],
            journeys=dict(login=True,hello=True,asr=True,githubFeedbackRead=True,skillTool=True,pdfDownload=True)))
        self.attest()

    def attest(self):
        # Fixture models independent canonical verifier admission, never cloud evidence.
        self.a['businessAcceptance']=dict(receiptSha256=m.sha(self.inputs['businessReceipt']),
            validator='cnReleaseBrowserSchema',validatorSourceSha256=m.sha(m.SCHEMA.read_bytes()),
            independentEvidenceSha256='9'*64)

    def generate(self,name='out',resign=True):
        self.r['inputs']={k:m.sha(v)for k,v in self.inputs.items()};raw=enc(self.r)
        if resign:self.a['requestSha256']=m.sha(raw)
        return m.generate(raw,enc(self.a),self.inputs,self.root/name,now=self.now)

    def test_actual_status_template_generates_new_source_and_original_false_claim(self):
        result=self.generate()
        source=(self.root/'out/bound.py').read_text()
        self.assertIn(self.r['sourceRevision'],source)
        self.assertNotIn(m.OLD_SOURCE,source)
        self.assertIn('businessAcceptancePassed=False',source)
        self.assertEqual(result['identity']['deadlineAt'],self.r['deadlineAt'])
        summary=json.loads((self.root/'out/binding-summary.json').read_bytes())
        self.assertEqual(summary['bindingSha256'],m.sha(self.inputs['binding']))
        self.assertFalse(result['businessAcceptanceGenerated'])

    def test_actual_clear_generation_preserves_original_pins(self):
        self.clear();result=self.generate()
        cfg=json.loads((self.root/'out/binding-summary.json').read_bytes())
        self.assertEqual(cfg['switchReceiptSha256'],m.sha(self.inputs['switchReceipt']))
        self.assertEqual(cfg['statusSha256'],m.sha(self.inputs['status']))
        self.assertEqual(result['inputHashes']['businessReceipt'],m.sha(self.inputs['businessReceipt']))
        self.assertEqual(result['cloudCalls'],0)
        self.assertFalse(result['dispatchAuthorizedByGenerator'])

    def test_clear_needs_independent_attestation_not_receipt_boolean(self):
        self.clear();del self.a['businessAcceptance']
        with self.assertRaises(KeyError):self.generate()
        self.attest();value=json.loads(self.inputs['businessReceipt']);value['journeys']['login']=False
        self.inputs['businessReceipt']=enc(value)
        with self.assertRaisesRegex(ValueError,'INDEPENDENT_BUSINESS'):self.generate('tampered')

    def test_original_clear_validator_rejects_old_hold_and_stale_status(self):
        self.clear();status=json.loads(self.inputs['status']);status['hold']={**self.hold,'generation':'old'}
        self.inputs['status']=enc(status)
        with self.assertRaisesRegex(ValueError,'ORIGINAL_FINALIZE'):self.generate('old-hold')
        self.clear();status=json.loads(self.inputs['status']);status['observedAt']=(self.now-dt.timedelta(minutes=11)).isoformat()
        self.inputs['status']=enc(status)
        with self.assertRaisesRegex(ValueError,'ORIGINAL_FINALIZE'):self.generate('old-status')

    def test_budget_and_cross_request_business_fail_closed(self):
        self.r['deadlineAt']=(self.now-dt.timedelta(seconds=1)).isoformat()
        with self.assertRaisesRegex(ValueError,'END_TO_END_DEADLINE'):self.generate()
        self.r['deadlineAt']=self.r['expiresAt'];self.clear()
        business=json.loads(self.inputs['businessReceipt']);business['attemptId']='another';self.inputs['businessReceipt']=enc(business);self.attest()
        with self.assertRaisesRegex(ValueError,'BUSINESS_attemptId'):self.generate('cross')

    def test_no_recovery_or_self_approval_escape(self):
        self.r['mode']='recovery-clear'
        with self.assertRaisesRegex(ValueError,'NORMAL_FINALIZE_ONLY'):self.generate()
        self.r['mode']='status';self.r['hasApproval']=True
        with self.assertRaisesRegex(ValueError,'REQUEST_FIELDS'):self.generate()

    def test_template_provenance_and_precise_ast_guard(self):
        provenance=json.loads((m.TEMPLATES/'provenance.json').read_bytes())
        for name,value in provenance['files'].items():
            self.assertEqual(value['sha256'],m.sha((m.TEMPLATES/name).read_bytes()))
        raw=("OTHER="+repr(m.OLD_SOURCE)+"\nassert b['sourceRevision']=="+repr(m.OLD_SOURCE)+"\n").encode()
        specialized=m.specialize(raw,'1'*40)
        self.assertIn(('OTHER = '+repr(m.OLD_SOURCE)).encode(),specialized)
        with self.assertRaisesRegex(ValueError,'SOURCE_GUARD_CHANGED'):m.specialize(b'pass\n','1'*40)

    def test_exact_request_and_no_overwrite(self):
        with self.assertRaisesRegex(ValueError,'APPROVAL_REQUEST'):self.generate(resign=False)
        self.generate()
        with self.assertRaisesRegex(ValueError,'OUTPUT_EXISTS'):self.generate()


if __name__=='__main__':unittest.main()
