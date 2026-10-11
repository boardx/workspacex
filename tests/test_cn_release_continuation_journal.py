"""Isolated real subprocess outputs + original entry verification/package reader.
Fixture process isolation is local PID readback, not Linux cgroup/cloud E2E.
"""
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=module('projector',ROOT/'scripts/cn-release-continuation-journal.py')


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.e=module('fixture_entry',ROOT/'.harness/scripts/vm/cn-release-advance.py')
        self.e.OWNER=os.getuid();self.e.STATE=self.root/'state';self.e.REQUESTS=self.root/'requests'
        self.e.STATE.mkdir();self.e.REQUESTS.mkdir()
        # Only fixture sandbox root is admitted. Production directory() remains unchanged.
        self.e.directory=lambda p:self.assertTrue(p==self.root or self.root in p.parents)
        self.e.execution_terminal=lambda p:not self.e.alive(p['pid'])
        (self.e.STATE/'entry.lock').touch(mode=0o600)
        self.release='a'*64;self.now=dt.datetime.now(dt.timezone.utc)
        self.start=(self.now-dt.timedelta(seconds=20)).isoformat();self.end=(self.now+dt.timedelta(minutes=20)).isoformat()
        self.identity=dict(sourceRevision='1'*40,baselineRevision='2'*40,controlRevision='3'*40,
            attemptId='journal-test',scope='runtime-only-reviewed-continuation',requestedAt=self.start,deadlineAt=self.end)
        self.attempt=self.e.STATE/'journal-test';self.attempt.mkdir()
        self.write(self.e.STATE/'active-attempt.json',m.encode('journal-test'))
        self.write(self.attempt/'identity.json',m.encode(self.identity))
        self.verify=b'''import json\ndef verify(raw,manifest,previous,mode):\n v=json.loads(raw)\n if mode=='terminal':\n  assert v=={'state':'terminal-observed'}\n  return {'externalWritesTerminal':True}\n assert v=={'stage':manifest['stage'],'result':'actual-child-output'}\n return True\n'''
        self.a=dict(kind='cn-release-once-delegation-v1',scope='normal-four-phase-materialization',
            releaseRequestSha256=self.release,release={k:v for k,v in self.identity.items()if k!='scope'},
            target=m.TARGET,allowedPhases=list(m.ENDS),issuedAt=self.start,expiresAt=self.end,
            evidenceValidatorSha256='4'*64,entrySha256='5'*64,
            stageVerifierSha256={s:m.sha(self.verify)for s in self.e.STAGES},
            stageObserverSha256={s:m.sha(b'observer')for s in self.e.STAGES})
        self.a['release']['publicationAttemptId']='build-test'
        static={k:m.encode(dict(sourceRevision='1'*40,baselineRevision='2'*40,attemptId='journal-test',issuedAt=self.start,expiresAt=self.end))for k in m.STATIC_INPUTS}
        self.inputs=static
        self.a['inputHashes']={k:m.sha(v)for k,v in static.items()}
        self.originals={};self.make_chain(3)
        self.set_phase_inputs('hold')

    def write(self,path,raw):
        path.write_bytes(raw);path.chmod(0o600)

    def make_chain(self,end):
        previous=None
        for i,stage in enumerate(self.e.STAGES[:end+1]):
            prefix=self.attempt/('%02d-%s'%(i,stage))
            manifest=dict(schemaVersion=1,**self.identity,stage=stage,previousReceiptSha256=m.sha(previous)if previous else None,
                issuedAt=self.start,expiresAt=self.end,timeoutSeconds=10,
                actionSha256=m.sha(b'action'),observerSha256=m.sha(b'observer'),verifierSha256=m.sha(self.verify),
                authorizationEvidenceSha256=m.sha(b'authorization'))
            raw=m.encode(manifest);request=m.sha(raw);package=self.e.REQUESTS/request
            package.mkdir(exist_ok=True)
            for name,data in {'manifest.json':raw,'action.sh':b'action','observe.sh':b'observer','verify.py':self.verify,'authorization.json':b'authorization'}.items():self.write(package/name,data)
            # Generate exact evidence with real short-lived local subprocesses.
            p=subprocess.Popen([sys.executable,'-c','import json;print(json.dumps('+repr({'stage':stage,'result':'actual-child-output'})+'))'],stdout=subprocess.PIPE)
            evidence=p.communicate()[0];self.assertEqual(p.returncode,0)
            terminal=subprocess.check_output([sys.executable,'-c','print(\'{"state":"terminal-observed"}\')'])
            finished=(self.now-dt.timedelta(seconds=15-i)).isoformat()
            receipt=dict(schemaVersion=1,**self.identity,stage=stage,requestSha256=request,previousReceiptSha256=manifest['previousReceiptSha256'],
                evidenceSha256=m.sha(evidence),terminalObservationSha256=m.sha(terminal),mode='advance',finishedAt=finished)
            admission=m.encode({'kind':'cn-entry-admission-v1','requestSha256':request,
                'verifierSha256':manifest['verifierSha256'],'observerSha256':manifest['observerSha256'],
                'authorizationEvidenceSha256':manifest['authorizationEvidenceSha256'],
                'evidenceSha256':m.sha(evidence),'terminalObservationSha256':m.sha(terminal)})
            self.write(Path(str(prefix)+'.admission.json'),admission)
            receipt['admissionSha256']=m.sha(admission)
            receipt_raw=m.encode(receipt)
            for suffix,data in {'.receipt.json':receipt_raw,'.intent.json':m.encode({'requestSha256':request}),
                '.process.json':m.encode({'requestSha256':request,'pid':p.pid}),'.evidence.json':evidence,'.terminal-observation.json':terminal}.items():
                self.write(Path(str(prefix)+suffix),data)
            self.originals[stage]=receipt_raw;previous=receipt_raw

    def set_phase_inputs(self,phase):
        self.inputs={k:v for k,v in self.inputs.items()if k in m.STATIC_INPUTS}
        for name,stage in m.STAGE_INPUTS.items():
            if name in m.input_names(phase):
                i=self.e.STAGES.index(stage)
                suffix='terminal-observation' if name in m.TERMINAL_INPUTS else 'evidence'
                self.inputs[name]=(self.attempt/('%02d-%s.%s.json'%(i,stage,suffix))).read_bytes()

    def test_history_survives_legitimate_later_live_state_change(self):
        self.e.verify=lambda *args:(_ for _ in ()).throw(AssertionError('old live observer must not run'))
        self.e.execution_terminal=lambda *args:False  # old PID may now be reused
        self.project('hold')

    def test_history_still_rejects_original_observation_tamper(self):
        path=self.attempt/'00-consume.terminal-observation.json'
        self.write(path,b'{"changedGeneration":true}')
        with self.assertRaisesRegex(ValueError,'RAW_EVIDENCE_HASH'):self.project('hold')

    def test_hold_input_uses_original_readback_not_action_wrapper(self):
        self.make_chain(5);self.set_phase_inputs('stop');self.project('stop')
        self.inputs['hold']=(self.attempt/'05-hold.evidence.json').read_bytes()
        with self.assertRaisesRegex(ValueError,'INPUT_NOT_ORIGINAL_STAGE_EVIDENCE_hold'):
            self.project('stop')

    def test_actual_hold_producer_emits_wrapper_and_preserves_original_hold(self):
        from types import SimpleNamespace
        runtime=module('actual_hold_runtime',ROOT/'.harness/scripts/vm/cn-runtime-continuation/upgrade-draft.py')
        binding={'previousHold':None,'attemptId':'actual-test','migrationDiffEvidenceSha256':'a'*64}
        identity={'sourceRevision':runtime.SOURCE,'baselineRevision':runtime.BASELINE,'attemptId':'actual-test','migrationPlanSha256':'a'*64}
        hold={'state':'held','generation':'one','identity':identity}
        records={}
        result=runtime.create_hold_phase(binding,self.root,'b'*64,None,lambda:hold,
            lambda actual:SimpleNamespace(returncode=0,stdout=m.encode(hold)),
            lambda root,name,value:records.update({name:value}))
        self.assertNotEqual(m.encode(result),m.encode(hold))
        self.assertEqual(result['actualHold'],hold);self.assertEqual(records['hold-result.json'],hold)
        self.assertEqual(m.TERMINAL_INPUTS['hold'],'hold')

    def test_backup_input_comes_from_live_observer_not_action_summary(self):
        self.make_chain(11);self.set_phase_inputs('switch')
        self.project('switch')
        self.inputs['hostBackup']=(self.attempt/'10-backup.evidence.json').read_bytes()
        with self.assertRaisesRegex(ValueError,'INPUT_NOT_ORIGINAL_STAGE_EVIDENCE_hostBackup'):
            self.project('switch')

    def test_unapproved_observer_blocks_journal(self):
        self.a['stageObserverSha256']['consume']='f'*64
        with self.assertRaisesRegex(ValueError,'LIVE_OBSERVER_NOT_APPROVED'):self.project()

    def project(self,phase='hold'):
        gen=m.project(self.e,self.release,m.encode(self.a),phase,self.inputs,now=self.now)
        try:return next(gen)
        finally:gen.close()

    def test_real_entry_verifier_replays_subprocess_bytes_and_preserves_receipts(self):
        journal,receipts=self.project()
        self.assertEqual([v['phase']for v in journal['completed']],['publish'])
        self.assertEqual(receipts['publish'],self.originals['publish'])
        self.assertEqual(len(journal['entryStages']),4)
        self.assertEqual(journal['uncertainOperations'],[])

    def test_full_chain_projection_maps_sessions_and_verifies_stage_steps(self):
        self.make_chain(11);self.set_phase_inputs('switch')
        journal,receipts=self.project('switch')
        self.assertEqual([v['phase']for v in journal['completed']],['publish','hold','stop','sessionzero','backup','rds-backup'])
        self.assertEqual(receipts['sessionzero'],self.originals['sessions'])
        self.assertEqual(len(journal['entryStages']),12)

    def test_missing_terminal_or_changed_original_rejected(self):
        p=self.attempt/'03-publish.terminal-observation.json';raw=p.read_bytes();p.unlink()
        with self.assertRaises(FileNotFoundError):self.project()
        self.write(p,raw+b' ')
        with self.assertRaisesRegex(ValueError,'RAW_EVIDENCE_HASH'):self.project()

    def test_terminal_verifier_rejects_false_evidence_even_with_correct_hash(self):
        p=self.attempt/'03-publish.terminal-observation.json';self.write(p,b'{"state":"still-running"}')
        r=self.attempt/'03-publish.receipt.json';v=m.parse(r.read_bytes());v['terminalObservationSha256']=m.sha(p.read_bytes());self.write(r,m.encode(v))
        with self.assertRaisesRegex(self.e.Rejected,'HISTORICAL_ADMISSION_CHANGED'):self.project()

    def test_active_attempt_unknown_and_cross_attempt_blocked(self):
        pending=self.attempt/'04-hold-stage.intent.json';self.write(pending,b'{}')
        with self.assertRaisesRegex(ValueError,'UNFINISHED_INTENT'):self.project()
        pending.unlink();self.write(self.e.STATE/'active-attempt.json',m.encode('other'))
        with self.assertRaisesRegex(ValueError,'CROSS_ATTEMPT'):self.project()

    def test_recovered_old_attempt_preserves_failed_intent_without_blocking_new(self):
        other=self.e.STATE/'recovered-old';other.mkdir()
        failed=other/'13-switch.intent.json';self.write(failed,m.encode({'requestSha256':'f'*64}))
        # Root entry has already admitted new active-attempt via its recovery
        # completion CAS. Historical failure evidence must never be deleted.
        evidence=subprocess.check_output([sys.executable,'-c',
            'print(\'{"baselineBusinessAccepted":true,"holdCleared":true,"externalWritesTerminal":true}\')'])
        self.e.verify(b'import json\ndef verify(raw,*args):return json.loads(raw)\n',
                      evidence,{},None,'recover')
        self.write(other/'13-switch.recovery.evidence.json',evidence)
        self.write(other/'13-switch.recovery.receipt.json',m.encode({
            'stage':'switch','mode':'recover','requestSha256':'e'*64,
            'evidenceSha256':m.sha(evidence)}))
        self.assertTrue(self.e.completed_attempt(other))
        journal,receipts=self.project()
        self.assertEqual(journal['identity']['attemptId'],'journal-test')
        self.assertTrue(failed.exists())
        self.assertEqual(receipts['publish'],self.originals['publish'])

    def test_global_lock_prevents_concurrent_projection(self):
        with (self.e.STATE/'entry.lock').open('rb')as f:
            fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError,'ENTRY_ACTIVE'):self.project()

    def test_chain_and_package_pins_fail_closed(self):
        path=self.attempt/'02-check-plan.receipt.json';v=m.parse(path.read_bytes());v['previousReceiptSha256']='f'*64;self.write(path,m.encode(v))
        with self.assertRaisesRegex(ValueError,'PREVIOUS_RECEIPT_HASH'):self.project()

    def test_handmade_input_or_forged_metadata_cannot_replace_stage_bytes(self):
        self.inputs['publication']=b'{"receiptKind":"cn-candidate-published-v2","verified":true}'
        with self.assertRaisesRegex(ValueError,'INPUT_NOT_ORIGINAL_STAGE_EVIDENCE_publication'):self.project()
        self.set_phase_inputs('hold')
        self.inputs['publication']+=b' '
        with self.assertRaisesRegex(ValueError,'INPUT_NOT_ORIGINAL_STAGE_EVIDENCE_publication'):self.project()

    def test_static_inputs_must_be_once_approved_and_match_release(self):
        self.inputs['template']+=b' '
        with self.assertRaisesRegex(ValueError,'STATIC_INPUT_HASH_template'):self.project()
        self.a['inputHashes']['template']=m.sha(self.inputs['template'])
        value=m.parse(self.inputs['template']);value['baselineRevision']='f'*40
        self.inputs['template']=m.encode(value);self.a['inputHashes']['template']=m.sha(self.inputs['template'])
        with self.assertRaisesRegex(ValueError,'STATIC_INPUT_IDENTITY_template'):self.project()

    def test_stage_inputs_all_use_exact_verified_action_bytes(self):
        self.make_chain(11);self.set_phase_inputs('switch')
        for name in m.STAGE_INPUTS:
            raw=self.inputs[name];self.inputs[name]=raw+b' '
            with self.assertRaisesRegex(ValueError,'INPUT_NOT_ORIGINAL_STAGE_EVIDENCE_'+name):self.project('switch')
            self.inputs[name]=raw

    def test_publish_exclusive_and_keeps_original_bytes(self):
        out=self.root/'evidence';base=out/self.release;(base/'receipts').mkdir(parents=True);(base/'hold').mkdir()
        result=m.publish(self.e,self.release,m.encode(self.a),'hold',self.inputs,out,now=self.now)
        receipt=self.originals['publish'];self.assertEqual((base/'receipts'/(m.sha(receipt)+'.json')).read_bytes(),receipt)
        self.assertEqual(m.parse((base/'hold/journal.json').read_bytes()),result)
        with self.assertRaises(FileExistsError):m.publish(self.e,self.release,m.encode(self.a),'hold',self.inputs,out,now=self.now)


if __name__=='__main__':unittest.main()
