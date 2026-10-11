"""Readonly observer fixtures: real pinned runtime/source/files, no production calls."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
def mod(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=mod('live_runtime_observe',ROOT/'scripts/cn-release-runtime-observe.py')
f=mod('backup_fixture',ROOT/'tests/test_cn_release_runtime_readback.py')


class ObserveTests(unittest.TestCase):
    def setUp(self):
        self.f=f.ReadbackTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.rb=f.m;self.root=self.f.root;self.b=self.f.b
        generated=self.f.f.root/'generated'
        self.f.write(self.root/'sessions-after-stop.py',(generated/'sessions-after-stop.py').read_bytes())
        identity={k:self.b[k]for k in ('sourceRevision','baselineRevision','attemptId')};identity['migrationPlanSha256']=self.b['migrationDiffEvidenceSha256']
        self.hold={**self.b['hold'],'identity':identity}
        self.f.write(self.root/'hold-intent.json',f.enc({'bindingSha256':self.rb.sha(self.f.braw),'identity':identity}))
        self.f.write(self.root/'hold-result.json',f.enc(self.hold))
        self.hold_raw=json.dumps(self.hold,separators=(',',':')).encode()+b'\n'
        self.approval=dict(kind='cn-runtime-readonly-observer-approval-v1',mode='hold',remoteRoot=str(self.root),
            bindingSha256=self.f.approval['bindingSha256'],identity=self.f.approval['identity'],
            issuedAt=self.f.approval['issuedAt'],expiresAt=self.f.approval['expiresAt'],maxSeconds=120,
            runtimePins={k:self.b[k]for k in ('scriptSha256','sessionsHelperSha256','backupHelperSha256','holdHelperSha256')},
            codeFiles={'scripts/cn-release-runtime-readback.py':self.rb.sha(m.READBACK.read_bytes())})

    def options(self):
        rb=self.rb;allowed=m.READBACK
        class FixtureReader(rb.Reader):
            def file(self,path,*args,**kwargs):
                if path==allowed:return allowed.read_bytes()
                return super().file(path,*args,**kwargs)
        return dict(readback=rb,reader=FixtureReader(__import__('os').getuid(),self.f.f.root),
                    runtime_root=self.f.runtime,hold_read=lambda:self.hold_raw)

    def test_hold_returns_exact_helper_bytes_not_wrapper_or_reserialized_result(self):
        raw=m.observe(self.approval,**self.options())
        self.assertEqual(raw,self.hold_raw)
        self.assertNotEqual(raw,(self.root/'hold-result.json').read_bytes())
        self.assertNotIn(b'actualHold',raw)
        self.assertNotIn(b'externalWritesTerminal',raw)

    def test_hold_change_between_reads_and_wrong_intent_fail(self):
        values=iter([self.hold_raw,f.enc({**self.hold,'generation':'other'})]);options=self.options();options['hold_read']=lambda:next(values)
        with self.assertRaisesRegex(ValueError,'HOLD_READBACK_DRIFT'):m.observe(self.approval,**options)
        self.f.write(self.root/'hold-intent.json',f.enc({'bindingSha256':'f'*64,'identity':self.hold['identity']}))
        with self.assertRaisesRegex(ValueError,'HOLD_INTENT'):m.observe(self.approval,**self.options())

    def test_summary_cannot_stand_in_for_bare_hold(self):
        options=self.options();options['hold_read']=lambda:f.enc({'operation':'hold','actualHold':self.hold,'writerStopExecuted':False})
        with self.assertRaisesRegex(ValueError,'HOLD_RESULT_CHANGED'):m.observe(self.approval,**options)

    def test_missing_result_and_code_tamper_fail_closed(self):
        path=self.root/'hold-result.json';path.unlink()
        with self.assertRaises(FileNotFoundError):m.observe(self.approval,**self.options())
        self.approval['runtimePins']['scriptSha256']='f'*64
        with self.assertRaisesRegex(ValueError,'RUNTIME_PIN'):m.observe(self.approval,**self.options())

    def test_sessions_uses_only_fixed_original_helper_and_preserves_output(self):
        self.approval['mode']='sessions';calls=[];raw=b'{"fixture":"original-helper-session-observation"}\n'
        options=self.options()
        def run(argv):calls.append(argv);return raw
        options['run_readonly']=run
        self.assertEqual(m.observe(self.approval,**options),raw)
        self.assertEqual(calls,[['/usr/bin/python3','-I','-S','-B',str(self.root/'sessions-after-stop.py'),str(self.root),self.approval['bindingSha256']]])

    def test_backup_reuses_actual_hash_readback_and_preserves_result(self):
        self.approval['mode']='backup'
        self.assertEqual(m.observe(self.approval,**self.options()),self.f.raw)
        path=self.root/'host-backup/sandbox.tar';data=path.read_bytes();self.f.write(path,b'X'+data[1:])
        with self.assertRaisesRegex(ValueError,'ARCHIVE_HASH'):m.observe(self.approval,**self.options())

    def test_sessions_timestamp_changes_preserve_original_raw(self):
        import datetime as dt
        now=dt.datetime.now(dt.timezone.utc)
        old={'finishedAt':(now-dt.timedelta(seconds=2)).isoformat(),'holdGeneration':'fixed','knownFiveStopped':True}
        fresh={**old,'finishedAt':(now-dt.timedelta(seconds=1)).isoformat()}
        raw=f.enc(old);live=f.enc(fresh);self.assertNotEqual(raw,live)
        self.assertTrue(m.verify_observation(raw,live,{'mode':'sessions'},{},now=now))
        fresh['holdGeneration']='different'
        with self.assertRaisesRegex(ValueError,'OBSERVATION_STATE_CHANGED'):
            m.verify_observation(raw,f.enc(fresh),{'mode':'sessions'},{},now=now)

    def test_switch_timestamp_change_uses_original_validate_clear(self):
        import datetime as dt
        ff=mod('real_final_fixture',ROOT/'tests/test_cn_release_continuation_finalize.py')
        fixture=ff.FinalizeIntegration();fixture.setUp();self.addCleanup(fixture.doCleanups);fixture.clear()
        raw=fixture.inputs['status'];fresh=json.loads(raw);fresh['observedAt']=fixture.now.isoformat()
        canonical=self.rb.trusted_module(m.FINAL_TEMPLATE.read_bytes().replace(b'__CONFIG__',b'{}'),'canonical_validation')
        self.assertNotEqual(raw,f.enc(fresh))
        approval={'mode':'switch','bindingSha256':ff.m.sha(fixture.inputs['binding'])}
        self.assertTrue(m.verify_observation(raw,f.enc(fresh),approval,fixture.binding,now=fixture.now,canonical_final=canonical))
        fresh['containers']=[{'unexpected':'replacement'}]
        with self.assertRaisesRegex(ValueError,'OBSERVATION_STATE_CHANGED'):
            m.verify_observation(raw,f.enc(fresh),approval,fixture.binding,now=fixture.now,canonical_final=canonical)

    def test_reconcile_hold_accepts_readonly_bytes_not_action_wrapper(self):
        from unittest.mock import patch
        a={**self.approval,'bindingSha256':self.rb.sha(self.f.braw)}
        manifest={**a['identity'],'stage':'hold'}
        with patch.object(m,'approval_by_sha',return_value=a),patch.object(m,'observe',return_value=self.hold_raw),patch.object(m,'bootstrap_read',return_value=self.f.braw):
            self.assertTrue(m.verify(self.hold_raw,manifest,None,'reconcile',{'approvalSha256':'a'*64}))
            with self.assertRaises(ValueError):m.verify(self.hold_raw,manifest,None,'advance',{'approvalSha256':'a'*64})

    def test_acceptance_alias_is_readonly_status_and_rejects_unknown_stage(self):
        from unittest.mock import patch
        ff=mod('acceptance_fixture',ROOT/'tests/test_cn_release_continuation_finalize.py')
        fixture=ff.FinalizeIntegration();fixture.setUp();self.addCleanup(fixture.doCleanups);fixture.clear()
        raw=fixture.inputs['status'];braw=fixture.inputs['binding'];template=m.FINAL_TEMPLATE.read_bytes()
        a={**self.approval,'mode':'switch','bindingSha256':self.rb.sha(braw),'codeFiles':{'.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py':self.rb.sha(template)}}
        manifest={**a['identity'],'stage':'acceptance'}
        with patch.object(m,'approval_by_sha',return_value=a),patch.object(m,'observe',return_value=raw),patch.object(m,'bootstrap_read',side_effect=lambda p:template if p==m.FINAL_TEMPLATE else braw):
            self.assertTrue(m.verify(raw,manifest,None,'advance',{'approvalSha256':'a'*64}))
            manifest['stage']='unapproved'
            with self.assertRaisesRegex(ValueError,'OBSERVER_STAGE'):m.verify(raw,manifest,None,'advance',{'approvalSha256':'a'*64})

    def test_unsupported_mode_does_not_make_terminal_true(self):
        self.approval['mode']='execute'
        with self.assertRaisesRegex(ValueError,'OBSERVER_SCOPE'):m.observe(self.approval,**self.options())


class ClearObserverTests(unittest.TestCase):
    def setUp(self):
        import base64
        from unittest.mock import patch
        sf=mod('clear_state_fixture',ROOT/'tests/test_cn_release_business_state.py')
        self.f=sf.LiveState();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.rb=f.m;self.enc=self.rb.enc if hasattr(self.rb,'enc') else lambda x:(json.dumps(x)+'\n').encode()
        for key,value in [('ETC',self.f.etc),('VAR',self.f.var)]:
            p=patch.object(m,key,value);p.start();self.addCleanup(p.stop)
        self.canonical=self.rb.trusted_module(m.FINAL_TEMPLATE.read_bytes().replace(b'__CONFIG__',b'{}'),'real_clear_validation')
        status={'containers':self.canonical['validate_status'](self.f.binding,self.f.root,self.f.xs)}
        statusraw=self.enc(status);w=self.f.w
        w.update(kind='cn-writer-resume-approval-v1',scope='a5-resume-writers-and-a6-scoped-business-observation',
            issuedAt=self.f.identity['requestedAt'],expiresAt=self.f.identity['deadlineAt'],heldHealthSha256=self.rb.sha(statusraw))
        wraw=self.enc(w);wsha=self.rb.sha(wraw)
        self.f.put(self.f.etc/'writer-resume-approvals'/(wsha+'.json'),wraw)
        self.f.put(self.f.etc/'writer-resume-approvals'/'by-release'/(self.f.release+'.json'),self.enc({'approvalSha256':wsha}))
        out=self.f.var/'release-generated'/self.f.release/'terminal'/'writer-resume'
        cfg=dict(mode='clear-hold',root=str(self.f.root),bindingSha256=w['bindingSha256'],statusSha256=w['heldHealthSha256'],hold=self.f.hold,statusBase64=base64.b64encode(statusraw).decode())
        cfgraw=self.enc(cfg);self.f.put(out/'binding-summary.json',cfgraw)
        provenance=json.loads((out/'writer-resume-provenance.json').read_bytes());provenance['writerApprovalSha256']=wsha
        provenance['inputHashes']['status']=w['heldHealthSha256'];provenance['files']['binding-summary.json']=self.rb.sha(cfgraw)
        self.f.put(out/'writer-resume-provenance.json',self.enc(provenance));self.f.put(self.f.var/'runtime'/'release.lock',b'')
        self.a=dict(releaseSha256=self.f.release,writerApprovalSha256=wsha,remoteRoot=str(self.f.root),bindingSha256=w['bindingSha256'],
            identity={k:self.f.identity[k]for k in ('sourceRevision','baselineRevision','controlRevision','attemptId')},
            codeFiles={'.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py':self.rb.sha(m.FINAL_TEMPLATE.read_bytes())})
    def read(self):
        rb=self.rb;fixture=self.f
        class Reader(rb.Reader):
            def opened(self,path,*args,**kw):return super().opened(path.resolve(),*args,**kw)
            def file(self,path,*args,**kw):
                if path==m.FINAL_TEMPLATE:return path.read_bytes()
                return fixture.reader.file(path)
        reader=Reader(__import__('os').getuid(),self.f.base.resolve())
        return m.observe_cleared(self.a,self.f.binding,self.f.binding_raw,rb,reader,lambda:self.f.call(['read']),self.f.call,self.f.var/'runtime',self.f.now)
    def test_actual_five_and_clear_hold_readback(self):
        result=json.loads(self.read());self.assertEqual(result['writerApprovalSha256'],self.a['writerApprovalSha256'])
        self.assertFalse(result['businessAcceptancePassed'])
    def test_changed_container_or_hold_rejected(self):
        self.f.xs[0]['State']['Health']['Status']='unhealthy'
        with self.assertRaises(AssertionError):self.read()


if __name__=='__main__':unittest.main()
