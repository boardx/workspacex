"""Offline actual entry verifier/finalizer/recovery validators; no cloud E2E."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
def mod(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=mod('terminal_delegation',ROOT/'scripts/cn-release-terminal-delegation.py')
jt=mod('journal_fixture',ROOT/'tests/test_cn_release_continuation_journal.py')
ft=mod('final_fixture',ROOT/'tests/test_cn_release_continuation_finalize.py')
bt=mod('binding_fixture',ROOT/'tests/test_cn_release_continuation_bind.py')


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.j=jt.JournalTests();self.j.setUp();self.addCleanup(self.j.doCleanups)
        self.f=ft.FinalizeIntegration();self.f.setUp();self.addCleanup(self.f.doCleanups);self.f.clear()
        r=self.f.r
        self.identity=dict(sourceRevision=r['sourceRevision'],baselineRevision='3'*40,controlRevision=r['controlRevision'],
            publicationAttemptId='build-final-test',attemptId=r['attemptId'],requestedAt=r['requestedAt'],deadlineAt=r['deadlineAt'])
        self.j.identity={k:v for k,v in self.identity.items()if k!='publicationAttemptId'}
        self.j.identity['scope']='runtime-only-reviewed-continuation'
        self.j.attempt=self.j.e.STATE/self.identity['attemptId'];self.j.attempt.mkdir()
        self.j.write(self.j.e.STATE/'active-attempt.json',m.enc(self.identity['attemptId']))
        self.j.write(self.j.attempt/'identity.json',m.enc(self.j.identity))
        self.j.start=r['issuedAt'];self.j.end=r['expiresAt'];self.j.now=self.f.now
        self.verifiers={};self.make_chain()
        self.a=dict(kind='cn-fixed-release-approval-v1',identity=self.identity,target=m.TARGET,
            issuedAt=r['issuedAt'],expiresAt=r['expiresAt'],codeFiles={},finalize=dict(allowedModes=['clear-hold'],
                stageVerifierSha256=self.verifiers,packageFiles=self.f.a['packageFiles'],
                businessValidatorSourceSha256=ft.m.sha(ft.m.SCHEMA.read_bytes()),remoteRoot=r['remoteRoot']))

    def make_chain(self):
        previous=None
        for i,stage in enumerate(self.j.e.STAGES[:15]):
            action=m.enc({'stage':stage});terminal=m.enc({'terminal':stage})
            if stage=='hold':
                action=m.enc({'actualHold':self.f.hold});terminal=self.f.inputs['hold']
            if stage=='switch':terminal=self.f.inputs['status'] if getattr(self,'held',False) else self.f.inputs['switchReceipt']
            if stage=='acceptance':action=self.f.inputs['status'] if getattr(self,'held',False) else self.f.inputs['businessReceipt'];terminal=self.f.inputs['status']
            verifier=("def verify(raw,manifest,previous,mode):\n if mode=='terminal':\n  assert raw=="+repr(terminal)+"\n  return {'externalWritesTerminal':True}\n assert raw=="+repr(action)+"\n return True\n").encode()
            self.verifiers[stage]=m.sha(verifier)
            manifest=dict(schemaVersion=1,**self.j.identity,stage=stage,previousReceiptSha256=m.sha(previous)if previous else None,
                issuedAt=self.j.start,expiresAt=self.j.end,timeoutSeconds=10,
                actionSha256=m.sha(b'action'),observerSha256=m.sha(b'observer'),verifierSha256=m.sha(verifier),authorizationEvidenceSha256=m.sha(b'authorization'))
            raw=m.enc(manifest);h=m.sha(raw);package=self.j.e.REQUESTS/h;package.mkdir(exist_ok=True)
            for name,value in {'manifest.json':raw,'action.sh':b'action','observe.sh':b'observer','verify.py':verifier,'authorization.json':b'authorization'}.items():self.j.write(package/name,value)
            receipt=dict(schemaVersion=1,**self.j.identity,stage=stage,requestSha256=h,previousReceiptSha256=manifest['previousReceiptSha256'],
                mode='advance',evidenceSha256=m.sha(action),terminalObservationSha256=m.sha(terminal),finishedAt=self.j.start)
            prefix=self.j.attempt/('%02d-%s'%(i,stage))
            admission=m.enc({'kind':'cn-entry-admission-v1','requestSha256':h,'verifierSha256':manifest['verifierSha256'],'observerSha256':manifest['observerSha256'],'authorizationEvidenceSha256':manifest['authorizationEvidenceSha256'],'evidenceSha256':receipt['evidenceSha256'],'terminalObservationSha256':receipt['terminalObservationSha256']})
            self.j.write(Path(str(prefix)+'.admission.json'),admission);receipt['admissionSha256']=m.sha(admission)
            for suffix,value in {'.receipt.json':m.enc(receipt),'.intent.json':m.enc({'requestSha256':h}),
                '.process.json':m.enc({'requestSha256':h,'pid':99999999}),'.evidence.json':action,'.terminal-observation.json':terminal}.items():self.j.write(Path(str(prefix)+suffix),value)
            previous=m.enc(receipt)

    def final(self,folder='final'):
        return m.derive_final(m.enc(self.a),self.f.inputs,self.j.e,ft.m,self.f.root/folder,now=self.f.now)

    def test_normal_final_reuses_real_finalizer_from_complete_verified_chain(self):
        result=self.final()
        self.assertEqual(m.parse(result['request'])['requestedAt'],self.identity['requestedAt'])
        self.assertEqual(result['materialization']['cloudCalls'],0)
        self.assertEqual(m.parse(result['approval'])['businessAcceptance']['receiptSha256'],m.sha(self.f.inputs['businessReceipt']))

    def test_historical_admission_avoids_old_live_observer_and_requires_witness(self):
        self.j.e.verify=lambda *args:(_ for _ in ()).throw(AssertionError('must not rerun historical live verifier'))
        self.j.e.execution_terminal=lambda *args:False
        self.final('historical')
        (self.j.attempt/'05-hold.admission.json').unlink()
        with self.assertRaises(FileNotFoundError):self.final('missing-witness')

    def test_business_raw_substitution_and_unknown_intent_rejected(self):
        self.f.inputs['businessReceipt']+=b' '
        with self.assertRaisesRegex(ValueError,'ACCEPTANCE_RAW_LINK'):self.final()
        self.f.inputs['businessReceipt']=self.f.inputs['businessReceipt'][:-1]
        self.j.write(self.j.attempt/'15-clear-hold.intent.json',b'{}')
        with self.assertRaisesRegex(ValueError,'UNKNOWN_INTENT'):self.final()

    def test_normal_expiry_cannot_be_reopened(self):
        self.a['expiresAt']=(self.f.now-dt.timedelta(seconds=1)).isoformat()
        with self.assertRaisesRegex(ValueError,'NORMAL_EXPIRED'):self.final()

    def writer_fixture(self):
        self.held=True
        b=m.parse(self.f.inputs['binding']);b['baselineRevision']=self.identity['baselineRevision']
        self.f.inputs['binding']=m.enc(b)
        status=m.parse(self.f.inputs['status']);status['bindingSha256']=m.sha(self.f.inputs['binding'])
        self.f.inputs['status']=m.enc(status)
        self.make_chain()
        self.a['writerResume']=dict(self.a['finalize'])
        self.a['codeFiles'][m.FINAL_CODE]=m.sha((ROOT/m.FINAL_CODE).read_bytes())
        inputs={k:self.f.inputs[k]for k in ('binding','hold','switchReceipt','status')}
        inputs.update(userAuthorization=b'explicit fixture A5 approval',testDataScope=b'fixture tenant only')
        w=dict(kind='cn-writer-resume-approval-v1',scope='a5-resume-writers-and-a6-scoped-business-observation',
            releaseSha256=m.sha(m.enc(self.a)),identity=self.identity,target=m.TARGET,
            issuedAt=self.a['issuedAt'],expiresAt=self.a['expiresAt'],holdGeneration=self.f.hold['generation'],
            publicOrigin='https://app.boardx.com.cn/')
        for name,key in [('binding','bindingSha256'),('hold','holdRawSha256'),('switchReceipt','switchReceiptSha256'),
            ('status','heldHealthSha256'),('userAuthorization','userAuthorizationEvidenceSha256'),('testDataScope','testDataScopeSha256')]:w[key]=m.sha(inputs[name])
        return w,inputs

    def test_a5_missing_approval_waits_without_output(self):
        w,inputs=self.writer_fixture();out=self.f.root/'not-created'
        result=m.derive_writer_resume(m.enc(self.a),None,inputs,self.j.e,out,now=self.f.now)
        self.assertEqual(result['status'],'WAITING_FOR_WRITER_APPROVAL');self.assertFalse(out.exists())

    def test_a5_actual_original_clear_materializer_without_business_claim(self):
        w,inputs=self.writer_fixture()
        result=m.derive_writer_resume(m.enc(self.a),m.enc(w),inputs,self.j.e,self.f.root/'a5',now=self.f.now)
        self.assertEqual(result['status'],'MATERIALIZED_A5')
        parameters=m.parse((self.f.root/'a5/parameters.json').read_bytes())
        self.assertEqual(parameters['ContentEncoding'],'PlainText')
        self.assertTrue(parameters['CommandContent'].startswith('/usr/bin/python3.12 -I -S -B -'))
        self.assertEqual(m.parse((self.f.root/'a5/binding-summary.json').read_bytes())['mode'],'clear-hold')
        self.assertFalse(result['provenance']['businessAcceptancePassed'])
        self.assertEqual(result['provenance']['writerApprovalSha256'],m.sha(m.enc(w)))

    def test_a5_scope_substitution_and_budget_extension_rejected(self):
        w,inputs=self.writer_fixture();w['testDataScopeSha256']='f'*64
        with self.assertRaisesRegex(ValueError,'WRITER_APPROVAL_RAW_testDataScope'):
            m.derive_writer_resume(m.enc(self.a),m.enc(w),inputs,self.j.e,self.f.root/'bad',now=self.f.now)
        with self.assertRaisesRegex(ValueError,'A5_NORMAL_BUDGET_EXPIRED'):
            m.derive_writer_resume(m.enc(self.a),None,inputs,self.j.e,self.f.root/'late',now=self.f.now+dt.timedelta(hours=1))

    def test_once_held_health_reuses_original_status_materializer(self):
        w,inputs=self.writer_fixture()
        for path in self.j.attempt.glob('14-acceptance.*'):path.unlink()
        result=m.derive_held_health(m.enc(self.a),{k:inputs[k]for k in ('binding','hold','switchReceipt')},
            self.j.e,ft.m,self.f.root/'held-health',now=self.f.now)
        self.assertEqual(m.parse(result['request'])['mode'],'status')
        parameters=m.parse((self.f.root/'held-health/parameters.json').read_bytes())
        self.assertEqual(parameters['ContentEncoding'],'PlainText')
        self.assertEqual(m.parse((self.f.root/'held-health/binding-summary.json').read_bytes())['mode'],'status')
        self.assertFalse(result['writerResumed'])

    def recovery_fixture(self):
        # Original validator from real, specialized runtime materialization.
        b=bt.ReviewedPackageIntegration();b.setUp();self.addCleanup(b.doCleanups)
        b.advance_inputs('switch');b.run_bind('runtime')
        binding=json.loads((b.root/'runtime/binding.json').read_bytes())
        old=(self.f.now-dt.timedelta(hours=1)).isoformat();expired=(self.f.now-dt.timedelta(minutes=30)).isoformat()
        for k in ('sourceRevision','baselineRevision','controlRevision','attemptId'):self.identity[k]=binding[k]
        self.identity.update(requestedAt=old,deadlineAt=expired)
        binding.update(requestedAt=old,deadlineAt=expired,issuedAt=old,expiresAt=expired)
        self.a['identity']=dict(self.identity);self.a.update(issuedAt=old,expiresAt=expired)
        self.j.identity={k:v for k,v in self.identity.items()if k!='publicationAttemptId'};self.j.identity['scope']='runtime-only-reviewed-continuation'
        root=self.j.e.STATE/self.identity['attemptId'];root.mkdir(exist_ok=True)
        self.j.write(root/'identity.json',m.enc(self.j.identity));self.j.write(self.j.e.STATE/'active-attempt.json',m.enc(self.identity['attemptId']))
        # Failed stop demonstrates terminal/unknown admission without executing recovery.
        verifier=b"import json\ndef verify(raw,*args):\n assert json.loads(raw)=={'terminal':True}\n return {'externalWritesTerminal':True,'safeToRecover':True}\n"
        previous=m.enc({'fixture':'previous stop-stage receipt'});self.j.write(root/'06-stop-stage.receipt.json',previous)
        manifest=dict(schemaVersion=1,**self.j.identity,stage='stop',previousReceiptSha256=m.sha(previous),
            issuedAt=old,expiresAt=expired,timeoutSeconds=10,actionSha256=m.sha(b'x'),observerSha256=m.sha(b'y'),
            verifierSha256=m.sha(verifier),authorizationEvidenceSha256=m.sha(b'z'))
        raw=m.enc(manifest);h=m.sha(raw);package=self.j.e.REQUESTS/h;package.mkdir()
        for name,value in {'manifest.json':raw,'action.sh':b'x','observe.sh':b'y','verify.py':verifier,'authorization.json':b'z'}.items():self.j.write(package/name,value)
        self.j.write(root/'07-stop.intent.json',m.enc({'requestSha256':h}))
        self.j.write(root/'07-stop.process.json',m.enc({'requestSha256':h,'pid':99999999}))
        inputs={'binding':m.enc(binding),'terminalObservation':m.enc({'terminal':True}),
            'reconciliation':m.enc(dict(priorInvocationTerminal=True,activeCloudCommands=[],hold=binding['hold'],
                attemptId=binding['attemptId'],observedAt=self.f.now.isoformat(),operation='abort-original'))}
        fresh=dict(kind='cn-release-fresh-recovery-delegation-v1',releaseSha256=m.sha(m.enc(self.a)),identity=dict(self.identity),target=m.TARGET,
            operation='abort-original',issuedAt=self.f.now.isoformat(),expiresAt=(self.f.now+dt.timedelta(minutes=20)).isoformat(),
            inputHashes={k:m.sha(v)for k,v in inputs.items()},originalBindingSha256=m.sha(inputs['binding']),failedStage='stop',
            failedRequestSha256=h,terminalVerifierSha256=m.sha(verifier))
        upgrade=mod('specialized_recovery',b.root/'runtime/upgrade-draft.py')
        return fresh,inputs,upgrade

    def test_fresh_recovery_after_budget_uses_original_runtime_validator_and_clock(self):
        fresh,inputs,upgrade=self.recovery_fixture()
        result=m.derive_recovery(m.enc(self.a),m.enc(fresh),inputs,self.j.e,upgrade,now=self.f.now)
        provenance=m.parse(result['provenance.json'])
        self.assertEqual(provenance['requestedAt'],self.identity['requestedAt'])
        self.assertLess(m.stamp(provenance['deadlineAt']),self.f.now)
        self.assertFalse(provenance['recoveryExecuted'])

    def test_unknown_process_or_false_terminal_blocks_recovery(self):
        fresh,inputs,upgrade=self.recovery_fixture();self.j.e.execution_terminal=lambda _:False
        with self.assertRaisesRegex(ValueError,'UNKNOWN_EXECUTION_NOT_TERMINAL'):
            m.derive_recovery(m.enc(self.a),m.enc(fresh),inputs,self.j.e,upgrade,now=self.f.now)
        self.j.e.execution_terminal=lambda _:True
        inputs['terminalObservation']=m.enc({'terminal':False});fresh['inputHashes']['terminalObservation']=m.sha(inputs['terminalObservation'])
        with self.assertRaises(AssertionError):m.derive_recovery(m.enc(self.a),m.enc(fresh),inputs,self.j.e,upgrade,now=self.f.now)

    def test_recovery_requires_independent_scope_and_no_retiming(self):
        fresh,inputs,upgrade=self.recovery_fixture();fresh['identity']['requestedAt']=self.f.now.isoformat()
        with self.assertRaisesRegex(ValueError,'RECOVERY_IDENTITY'):m.derive_recovery(m.enc(self.a),m.enc(fresh),inputs,self.j.e,upgrade,now=self.f.now)
        with self.assertRaises((ValueError,KeyError)):m.derive_recovery(m.enc(self.a),m.enc(self.a),inputs,self.j.e,upgrade,now=self.f.now)


if __name__=='__main__':unittest.main()
