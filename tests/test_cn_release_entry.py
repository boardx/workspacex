"""Real local process tests; no cloud, Docker or production fixture execution."""
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('entry', ROOT / '.harness/scripts/vm/cn-release-advance.py')
e = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(e)
VERIFIER = b'''import json\ndef verify(raw, manifest, previous, mode):\n return {'externalWritesTerminal':True} if mode=='terminal' and json.loads(raw)=={'verified':True} else json.loads(raw)=={'verified':True}\n'''
ACTION = b"printf '%s\\n' '{\"verified\":true}'\n"


class EntryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.release-entry-test-', dir=ROOT)
        self.root = Path(self.temp.name)
        self.requests = self.root / 'requests'; self.requests.mkdir(mode=0o700)
        self.state = self.root / 'state'; self.state.mkdir(mode=0o700)
        self.clocks = {}
        self.patches = [patch.object(e, 'REQUESTS', self.requests), patch.object(e, 'STATE', self.state), patch.object(e, 'OWNER', os.getuid()), patch.object(e, 'CGROUP_BASE', None)]
        for p in self.patches: p.start()
        self.addCleanup(self.temp.cleanup)
        for p in self.patches: self.addCleanup(p.stop)

    def package(self, stage='consume', previous=None, action=ACTION, observer=ACTION, verifier=VERIFIER, attempt='test-one', **updates):
        start = self.clocks.setdefault(attempt, e.now() - dt.timedelta(seconds=2))
        m = dict(schemaVersion=1, sourceRevision='1'*40, baselineRevision='2'*40, controlRevision='3'*40,
                 attemptId=attempt, scope='runtime-only-reviewed-continuation', stage=stage,
                 previousReceiptSha256=previous, issuedAt=start.isoformat(), expiresAt=(start+dt.timedelta(minutes=20)).isoformat(),
                 requestedAt=start.isoformat(), deadlineAt=(start+dt.timedelta(minutes=30)).isoformat(),
                 timeoutSeconds=3, actionSha256=e.digest(action), observerSha256=e.digest(observer), verifierSha256=e.digest(verifier),
                 authorizationEvidenceSha256=e.digest(b'{"fixture":true}\n'))
        m.update(updates)
        raw=e.encode(m); h=e.digest(raw); folder=self.requests/h; folder.mkdir(mode=0o700)
        for name,data in [('manifest.json',raw),('action.sh',action),('observe.sh',observer),('verify.py',verifier),('authorization.json',b'{"fixture":true}\n')]:
            e.create(folder/name,data)
        return h

    def advance(self, h, attempt='test-one'):
        return e.entry('advance', h, attempt)

    def test_real_process_chain_original_bytes_and_completed_no_replay(self):
        marker=self.root/'marker'
        action=('printf x >> '+shlex.quote(str(marker))+'\n').encode()+ACTION
        first=self.package(action=action)
        one=self.advance(first)
        self.assertTrue(one['mutationExecuted'])
        self.assertEqual((self.state/'test-one/00-consume.evidence.json').read_bytes(),b'{"verified":true}\n')
        self.assertFalse(self.advance(first)['mutationExecuted'])
        self.assertEqual(marker.read_text(),'x')
        second=self.package('publication-stage',one['receiptSha256'])
        two=self.advance(second)
        receipt=e.decode((self.state/'test-one/01-publication-stage.receipt.json').read_bytes())
        self.assertEqual(receipt['previousReceiptSha256'],one['receiptSha256'])
        self.assertEqual(two['status'],'COMPLETED')
        self.assertFalse(receipt['productionAcceptanceClaimedByTransport'])

    def test_wrong_receipt_does_not_execute(self):
        self.advance(self.package())
        with self.assertRaisesRegex(e.Rejected,'PREVIOUS_RECEIPT_CHANGED'):
            self.advance(self.package('publication-stage','f'*64))

    def test_unknown_failed_write_cannot_be_retried_or_renamed(self):
        marker=self.root/'marker'
        action=('printf x >> '+shlex.quote(str(marker))+'\nexit 7\n').encode()
        h=self.package(action=action)
        with self.assertRaisesRegex(e.Rejected,'EXECUTION_UNCERTAIN'):
            self.advance(h)
        with self.assertRaisesRegex(e.Rejected,'UNCERTAIN_RECONCILE'):
            self.advance(h)
        with self.assertRaisesRegex(e.Rejected,'UNCERTAIN_RECONCILE'):
            self.advance(self.package())
        with self.assertRaisesRegex(e.Rejected,'OTHER_RELEASE_INCOMPLETE'):
            self.advance(self.package(attempt='test-two'),'test-two')
        self.assertEqual(marker.read_text(),'x')
        self.assertEqual(e.entry('status',h,'test-one')['status'],'UNCERTAIN')

    def test_reconcile_only_runs_observer_preserves_original_intent(self):
        marker=self.root/'marker'
        action=('printf x >> '+shlex.quote(str(marker))+'\nexit 9\n').encode()
        h=self.package(action=action)
        with self.assertRaises(e.Rejected): self.advance(h)
        intent=(self.state/'test-one/00-consume.intent.json').read_bytes()
        result=e.entry('reconcile',h,'test-one')
        self.assertFalse(result['mutationExecuted'])
        self.assertEqual(marker.read_text(),'x')
        self.assertEqual((self.state/'test-one/00-consume.intent.json').read_bytes(),intent)
        self.assertEqual(self.advance(h)['status'],'COMPLETED')

    def test_no_success_receipt_when_verifier_rejects(self):
        h=self.package(verifier=b'def verify(*args): return False\n')
        with self.assertRaisesRegex(e.Rejected,'EVIDENCE_NOT_VERIFIED|TERMINAL_OR_RECOVERY_UNPROVEN'): self.advance(h)
        self.assertFalse((self.state/'test-one/00-consume.receipt.json').exists())
        self.assertFalse((self.state/'test-one/00-consume.evidence.json').exists())
        with self.assertRaisesRegex(e.Rejected,'UNCERTAIN_RECONCILE'): self.advance(h)

    def test_package_tamper_symlink_and_duplicate_keys_rejected(self):
        h=self.package()
        p=self.requests/h/'action.sh';p.write_bytes(b'exit 0')
        with self.assertRaisesRegex(e.Rejected,'PACKAGE_FILE_CHANGED'): self.advance(h)
        p.unlink();p.symlink_to('/etc/passwd')
        with self.assertRaises(OSError): self.advance(h)
        with self.assertRaisesRegex(e.Rejected,'DUPLICATE_KEY'): e.decode(b'{"x":1,"x":2}')

    def test_strict_schema_expiry_and_unknown_fields(self):
        for updates in ({'schemaVersion':True},{'timeoutSeconds':True},{'scope':'hotfix-skip-backup'},{'extra':True}):
            with self.assertRaises(e.Rejected): self.advance(self.package(**updates))
        h=self.package(requestedAt=(e.now()-dt.timedelta(minutes=25)).isoformat(),issuedAt=(e.now()-dt.timedelta(minutes=25)).isoformat(),expiresAt=(e.now()-dt.timedelta(minutes=5)).isoformat(),deadlineAt=(e.now()+dt.timedelta(minutes=4)).isoformat())
        with self.assertRaisesRegex(e.Rejected,'REQUEST_EXPIRED'):self.advance(h)
        self.assertFalse((self.state/'test-one/00-consume.intent.json').exists())

    def test_started_journal_failure_does_not_start_action(self):
        marker=self.root/'marker'
        raw=('touch '+shlex.quote(str(marker))+'\n').encode()
        def failed(*_):raise RuntimeError('simulated disk failure')
        with self.assertRaises(RuntimeError):e.run_command(raw,1,failed)
        self.assertFalse(marker.exists())

    def test_timeout_joins_process_before_allowing_observation(self):
        marker=self.root/'late'
        action=('sleep 3\nprintf late > '+shlex.quote(str(marker))+'\n').encode()
        h=self.package(action=action,timeoutSeconds=1)
        begin=time.monotonic()
        with self.assertRaisesRegex(e.Rejected,'EXECUTION_UNCERTAIN'):self.advance(h)
        self.assertLess(time.monotonic()-begin,2.5)
        terminal=e.decode((self.state/'test-one/00-consume.terminal.json').read_bytes())
        self.assertEqual(terminal['reason'],'TIMEOUT')
        self.assertFalse(marker.exists())
        # Terminal.json is a historical snapshot: a zombie group can be reaped
        # before reconciliation. The live execution probe owns that decision.
        with patch.object(e,'execution_terminal',return_value=False):
            with self.assertRaisesRegex(e.Rejected,'PROCESS_STILL_ACTIVE'):
                e.entry('reconcile',h,'test-one')
        try:
            result=e.entry('reconcile',h,'test-one')
        except e.Rejected as error:
            self.assertEqual(str(error),'PROCESS_STILL_ACTIVE_OR_UNPROVEN')
        else:
            self.assertEqual(result['status'],'COMPLETED')
            self.assertFalse(result['mutationExecuted'])
        self.assertFalse(marker.exists())

    def test_output_overflow_and_secret_error_not_persisted(self):
        action=(shlex.quote(sys.executable)+" -c 'print(\"SENSITIVE\"*20000)'\n").encode()
        h=self.package(action=action)
        with self.assertRaises(e.Rejected):self.advance(h)
        files=b''.join(p.read_bytes() for p in (self.state/'test-one').iterdir() if p.is_file())
        self.assertNotIn(b'SENSITIVE',files)
        self.assertFalse((self.state/'test-one/00-consume.evidence.json').exists())

    def test_fresh_process_loads_previous_receipt_and_reconciles(self):
        h=self.package(action=b'exit 8\n')
        with self.assertRaises(e.Rejected):self.advance(h)
        code=f'''import importlib.util,os\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('entry',{str(ROOT/'.harness/scripts/vm/cn-release-advance.py')!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.REQUESTS=Path({str(self.requests)!r});m.STATE=Path({str(self.state)!r});m.OWNER=os.getuid();m.CGROUP_BASE=None\nprint(m.entry('reconcile',{h!r},'test-one')['status'])\n'''
        r=subprocess.run([sys.executable,'-I','-B','-c',code],capture_output=True,timeout=10)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout,b'COMPLETED\n')

    def test_status_is_readonly_and_does_not_claim_global_owner(self):
        h=self.package(attempt='not-started')
        before=list(self.state.iterdir())
        self.assertEqual(e.entry('status',h,'not-started')['status'],'NOT_STARTED')
        self.assertEqual(list(self.state.iterdir()),before)
        self.assertEqual(self.advance(self.package())['status'],'COMPLETED')

    def test_budget_cannot_be_reset_by_later_stage(self):
        first=self.advance(self.package())
        h=self.package('publication-stage',first['receiptSha256'],requestedAt=e.now().isoformat())
        with self.assertRaisesRegex(e.Rejected,'TOTAL_BUDGET_INVALID|IDENTITY_CHANGED'):
            self.advance(h)
        raw=e.decode((self.state/'test-one/00-consume.receipt.json').read_bytes())
        self.assertGreaterEqual(raw['elapsedSeconds'],2)
        self.assertTrue(raw['withinTotalBudget'])

    def test_global_lock_prevents_parallel_attempts_and_reconcile(self):
        import fcntl
        lock=self.state/'entry.lock'
        fd=os.open(lock,os.O_RDWR|os.O_CREAT,0o600)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaisesRegex(e.Rejected,'ANOTHER_ENTRY_ACTIVE'):
                self.advance(self.package())
        finally:os.close(fd)

    def test_partial_receipt_and_missing_process_never_replay(self):
        h=self.package(action=b'exit 9\n')
        with self.assertRaises(e.Rejected):self.advance(h)
        (self.state/'test-one/00-consume.process.json').unlink()
        with self.assertRaisesRegex(e.Rejected,'PROCESS_STATE_UNPROVEN'):
            e.entry('reconcile',h,'test-one')
        e.create(self.state/'test-one/00-consume.receipt.json',b'{')
        with self.assertRaisesRegex(e.Rejected,'JSON_INVALID'):self.advance(h)

    def test_remote_accepted_local_failure_requires_independent_observation(self):
        h=self.package(action=b'exit 9\n',observer=b"printf '%s' '{\"pending\":true}'\n")
        with self.assertRaises(e.Rejected):self.advance(h)
        with self.assertRaisesRegex(e.Rejected,'EVIDENCE_NOT_VERIFIED|TERMINAL_OR_RECOVERY_UNPROVEN'):
            e.entry('reconcile',h,'test-one')
        self.assertFalse((self.state/'test-one/00-consume.receipt.json').exists())

    def test_full_fixture_stage_chain_reports_lead_and_activation_time(self):
        previous=None
        for stage in e.STAGES:
            result=self.advance(self.package(stage,previous))
            previous=result['receiptSha256']
        final=e.decode((self.state/'test-one/16-observe.receipt.json').read_bytes())
        self.assertIsNotNone(final['activationStartedAt'])
        self.assertGreaterEqual(final['elapsedSeconds'],final['activationElapsedSeconds'])
        self.assertFalse(final['productionAcceptanceClaimedByTransport'])
        self.assertEqual(self.advance(self.package(attempt='next-release'),'next-release')['status'],'COMPLETED')

    def test_fresh_recovery_after_budget_preserves_clock_and_never_retries(self):
        original=self.package(action=b'exit 9\n')
        with self.assertRaises(e.Rejected):self.advance(original)
        # Move only the observation clock forward; original bytes stay immutable.
        original_time=self.clocks['test-one']
        later=original_time+dt.timedelta(minutes=31)
        verifier=b"def verify(raw,manifest,previous,mode):\n return {'externalWritesTerminal':True,'safeToRecover':True} if mode=='pre-recovery' else {'baselineBusinessAccepted':True,'holdCleared':True,'externalWritesTerminal':True}\n"
        recovered=self.package(scope='runtime-only-reviewed-recovery',recoveryOf=original,
                               issuedAt=later.isoformat(),expiresAt=(later+dt.timedelta(minutes=10)).isoformat(),verifier=verifier)
        with patch.object(e,'now',return_value=later):
            result=e.entry('recover',recovered,'test-one')
            self.assertEqual(result['status'],'COMPLETED')
            self.assertFalse(e.entry('recover',recovered,'test-one')['mutationExecuted'])
        receipt=e.decode((self.state/'test-one/00-consume.recovery.receipt.json').read_bytes())
        self.assertEqual(receipt['requestedAt'],original_time.isoformat())
        self.assertFalse(receipt['withinTotalBudget'])
        self.assertFalse((self.state/'test-one/00-consume.receipt.json').exists())

    def test_production_kill_domain_missing_blocks_before_child(self):
        marker=self.root/'must-not-run'
        with patch.object(e,'CGROUP_BASE',self.root/'missing-cgroup'):
            with self.assertRaises((OSError,e.Rejected)):
                e.run_command(('touch '+shlex.quote(str(marker))).encode(),1,lambda *a:None)
        self.assertFalse(marker.exists())

    def test_child_session_ready_precedes_durable_pid(self):
        original=e.os.setsid
        started_at=time.monotonic();seen=[]
        def delayed():
            time.sleep(.2)
            original()
        with patch.object(e.os,'setsid',side_effect=delayed):
            result=e.run_command(ACTION,2,lambda pid,domain:seen.append((time.monotonic()-started_at,os.getpgid(pid)==pid)))
        self.assertEqual(result[:2],('EXITED',0))
        self.assertGreaterEqual(seen[0][0],.18)
        self.assertTrue(seen[0][1])

    def test_parent_dies_before_child_session_no_late_mutation(self):
        marker=self.root/'late-after-parent-death';ready=self.root/'parent-ready';journal=self.root/'pid-journal'
        code=f"""import importlib.util,os,time
from pathlib import Path
s=importlib.util.spec_from_file_location('e',{str(ROOT/'.harness/scripts/vm/cn-release-advance.py')!r});e=importlib.util.module_from_spec(s);s.loader.exec_module(e)
e.CGROUP_BASE=None
original=e.os.setsid
def delayed():
 time.sleep(.7)
 original()
e.os.setsid=delayed
Path({str(ready)!r}).write_text('ready')
e.run_command({('touch '+shlex.quote(str(marker))).encode()!r},3,lambda pid,domain:Path({str(journal)!r}).write_text(str(pid)))
"""
        p=subprocess.Popen([sys.executable,'-I','-B','-c',code],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            end=time.monotonic()+3
            while not ready.exists() and time.monotonic()<end:time.sleep(.01)
            self.assertTrue(ready.exists());time.sleep(.1)
            p.kill();p.wait(timeout=3);time.sleep(.9)
            self.assertFalse(journal.exists())
            self.assertFalse(marker.exists())
        finally:
            if p.poll() is None:p.kill();p.wait()

    def test_success_exit_still_requires_external_terminal_observer(self):
        h=self.package(observer=b"printf '%s' '{\"stillRunning\":true}'\n")
        with self.assertRaisesRegex(e.Rejected,'TERMINAL_OR_RECOVERY_UNPROVEN'):
            self.advance(h)
        self.assertFalse((self.state/'test-one/00-consume.receipt.json').exists())
        with self.assertRaisesRegex(e.Rejected,'UNCERTAIN_RECONCILE'):self.advance(h)

    def test_partial_completion_does_not_unlock_other_attempt(self):
        self.advance(self.package())
        e.create(self.state/'test-one/16-observe.receipt.json',b'{')
        with self.assertRaisesRegex(e.Rejected,'JSON_INVALID'):
            self.advance(self.package(attempt='other'),'other')

    def test_capability_failure_leaves_no_intent_or_global_owner(self):
        h=self.package()
        with patch.object(e,'CGROUP_BASE',self.root/'absent'):
            with self.assertRaises((OSError,e.Rejected)): self.advance(h)
        self.assertFalse((self.state/'active-attempt.json').exists())
        self.assertFalse((self.state/'test-one/00-consume.intent.json').exists())
        self.assertEqual(self.advance(h)['status'],'COMPLETED')

    def test_reconcile_cannot_bypass_external_terminal_contract(self):
        h=self.package(action=b'exit 9\n',verifier=b'def verify(*args): return True\n')
        with self.assertRaises(e.Rejected):self.advance(h)
        with self.assertRaisesRegex(e.Rejected,'TERMINAL_OR_RECOVERY_UNPROVEN'):
            e.entry('reconcile',h,'test-one')
        self.assertFalse((self.state/'test-one/00-consume.receipt.json').exists())

    def test_actual_canonical_seven_zip_fixture_through_entry(self):
        command=[sys.executable,'-I','-B',str(ROOT/'tests/test_cn_hk_proof_integration.py')]
        python='import subprocess,sys,json\nr=subprocess.run('+repr(command)+',capture_output=True)\nassert r.returncode==0\nassert b"proof admission + all tar verification" in r.stdout\nprint(json.dumps({"canonicalBundleVerified":True}))\n'
        action=(shlex.quote(sys.executable)+' -I -B -c '+shlex.quote(python)+'\n').encode()
        verifier=b'''import json\ndef verify(raw,manifest,previous,mode): return {'externalWritesTerminal':True} if mode=='terminal' and json.loads(raw)=={"canonicalBundleVerified":True} else json.loads(raw)=={"canonicalBundleVerified":True}\n'''
        h=self.package(action=action,observer=b'''printf '%s\\n' '{"canonicalBundleVerified":true}'\n''',verifier=verifier,timeoutSeconds=30)
        self.assertEqual(self.advance(h)['status'],'COMPLETED')


class OfflinePackagingTests(unittest.TestCase):
    def test_target_scope_and_observer_bounds(self):
        spec=importlib.util.spec_from_file_location('packager',ROOT/'scripts/cn-release-orchestrate.py')
        p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
        with tempfile.TemporaryDirectory(dir=ROOT) as td:
            path=Path(td)/'parameters.json'
            value={'RegionId':'cn-shanghai','InstanceId.1':'i-uf6ga92ewloganobbln6','Type':'RunShellScript','ContentEncoding':'PlainText','WorkingDir':'/','Username':'root','RepeatMode':'Once','KeepCommand':'false','EnableParameter':'false','Name':'fixture','CommandContent':'true','Timeout':'10'}
            path.write_text(json.dumps(value));self.assertEqual(p.command(path),(b'true',10))
            for key,new in [('RegionId','us-east-1'),('RepeatMode','EveryReboot'),('InstanceId.1','other')]:
                bad=dict(value);bad[key]=new;path.write_text(json.dumps(bad))
                with self.assertRaises(Exception):p.command(path)
            bad=dict(value);bad['Launcher']='arbitrary';path.write_text(json.dumps(bad))
            with self.assertRaises(Exception):p.command(path)
            probe=Path(td)/'probe.json';probe.write_text('{"wrappers":[]}')
            plan=p.installation_plan(probe)
            self.assertFalse(plan['installationReady']);self.assertFalse(plan['files'][0]['oldStateVerified'])
            self.assertEqual(plan['ecsIamDelta'],[])
            self.assertTrue(plan['processIsolation']['requiresCgroupKill'])


if __name__=='__main__': unittest.main()
