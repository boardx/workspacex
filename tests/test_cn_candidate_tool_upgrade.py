"""Real-file transaction/rollback tests; no host calls or publisher execution."""
import copy
from datetime import datetime,timedelta,timezone
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('candidate_upgrade',ROOT/'scripts/upgrade-cn-candidate-tools.py')
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.root.chmod(0o700);self.tools=self.root/'tools';self.tools.mkdir(mode=0o700)
        self.backup=self.root/'backup';self.backup.mkdir(mode=0o700)
        self.package=self.root/'package';self.package.mkdir(mode=0o700)
        self.uid=os.getuid();self.gid=self.root.stat().st_gid
        helper=self.package/'cn-tool-install-transaction.py'
        helper.write_bytes((ROOT/'.harness/scripts/vm/cn-tool-install-transaction.py').read_bytes());helper.chmod(0o700)
        self.engine=u.load_engine(self.package,self.uid,self.gid,self.root)
        self.before={n:('# old '+n+'\n').encode() for n in u.OLD}
        self.patcher=patch.object(u,'OLD',{n:u.sha(raw) for n,raw in self.before.items()});self.patcher.start();self.addCleanup(self.patcher.stop)
        for name,data in self.before.items():(self.tools/name).write_bytes(data);(self.tools/name).chmod(0o700)
        self.content={n:('# new '+n+'\n').encode() for n in u.NAMES}
        now=datetime.now(timezone.utc)
        self.manifest=dict(kind='cn-candidate-tool-upgrade-v1',schemaVersion=1,upgradeId='upgrade-test',oldRevision=u.OLD_REVISION,oldFiles=u.OLD.copy(),newRevision='b'*40,
            files={n:dict(sha256=u.sha(data),size=len(data)) for n,data in self.content.items()},transactionHelperSha256=u.HELPER_SHA,installerSha256='c'*64,
            issuedAt=now.isoformat(),expiresAt=(now+timedelta(minutes=30)).isoformat(),ecsInstanceId=u.HOST,installAuthorized=True)
    def execute(self,inject=None):
        u.validate(self.manifest)
        return u.execute(self.engine,self.manifest,'d'*64,self.content,self.tools,self.backup,self.uid,self.gid,self.root,inject)
    def assert_old(self):
        for name,data in self.before.items():self.assertEqual((self.tools/name).read_bytes(),data)
        self.assertFalse((self.tools/'cn_candidate_revalidation.py').exists())
    def test_complete_entry_last_backups_and_bound_commit(self):
        observed=[]
        result=self.execute(lambda i:observed.append(u.targets(self.manifest,self.tools,self.uid,self.gid)[i]['payload']))
        self.assertEqual(observed[-1],u.ENTRY);self.assertFalse(result['productionActivated'])
        for n,data in self.content.items():self.assertEqual((self.tools/n).read_bytes(),data)
        journal=json.loads((self.backup/'journal.json').read_bytes());self.assertEqual(journal['state'],'committed')
        self.assertEqual(journal['binding']['manifestSha256'],'d'*64)
        self.assertEqual(len(list(self.backup.glob('*.before'))),8)
    def test_failure_after_entry_atomic_replace_restores_all_old(self):
        def fault(i):
            if i==8:raise RuntimeError('fixture interruption')
        with self.assertRaisesRegex(RuntimeError,'fixture interruption'):self.execute(fault)
        self.assert_old();self.assertEqual(json.loads((self.backup/'journal.json').read_bytes())['state'],'recovered')
    def test_old_drift_rejects_before_any_replacement(self):
        (self.tools/'cn_candidate_host.py').write_bytes(b'drift')
        with self.assertRaises(RuntimeError):self.execute()
        self.assertEqual(list(self.backup.iterdir()),[])
        self.assertFalse((self.tools/'cn_candidate_revalidation.py').exists())
    def test_new_file_collision_rejects_all(self):
        path=self.tools/'cn_candidate_revalidation.py';path.write_bytes(b'foreign');path.chmod(0o700)
        with self.assertRaises(RuntimeError):self.execute()
        self.assertEqual(path.read_bytes(),b'foreign');self.assertEqual(list(self.backup.iterdir()),[])
    def test_symlink_and_hardlink_reject(self):
        path=self.tools/'cn_candidate_host.py';path.unlink();foreign=self.root/'foreign';foreign.write_bytes(self.before[path.name]);foreign.chmod(0o700)
        for create in (lambda:path.symlink_to(foreign),lambda:os.link(foreign,path)):
            create()
            with self.assertRaises((RuntimeError,OSError)):self.execute()
            path.unlink()
        self.assertEqual(list(self.backup.iterdir()),[])
    def test_failure_foreign_replacement_is_preserved(self):
        rows=u.targets(self.manifest,self.tools,self.uid,self.gid)
        def fault(i):
            if i==0:
                foreign=self.root/'replacement';foreign.write_bytes(self.content[rows[0]['payload']]);foreign.chmod(0o700)
                os.replace(foreign,rows[0]['destination']);raise RuntimeError('fixture')
        with self.assertRaisesRegex(RuntimeError,'ROLLBACK_INCOMPLETE'):self.execute(fault)
        self.assertEqual(Path(rows[0]['destination']).read_bytes(),self.content[rows[0]['payload']])
        self.assertTrue((self.backup/'diagnosis.json').exists())
    def test_sigkill_pending_transaction_reviewed_recovery(self):
        pid=os.fork()
        if pid==0:
            def kill(i):
                if i==3:os.kill(os.getpid(),signal.SIGKILL)
            self.execute(kill);os._exit(3)
        _,status=os.waitpid(pid,0);self.assertEqual(os.WTERMSIG(status),signal.SIGKILL)
        raw=(self.backup/'journal.json').read_bytes();journal=json.loads(raw)
        result=self.engine.recover(self.backup,self.uid,self.gid,self.root,expected_binding=journal['binding'],
            expected_targets=u.targets(self.manifest,self.tools,self.uid,self.gid),expected_journal_sha=u.sha(raw))
        self.assertTrue(result['recovered']);self.assert_old()
    def test_manifest_source_expiry_extra_targets_rejected(self):
        for key,value in [('oldRevision','e'*40),('oldFiles',{}),('newRevision','main'),('expiresAt','2000-01-01T00:00:00Z'),('installAuthorized',False)]:
            candidate=copy.deepcopy(self.manifest);candidate[key]=value
            with self.assertRaises(ValueError):u.validate(candidate)
        candidate=copy.deepcopy(self.manifest);candidate['files']['app.env']={'sha256':'e'*64,'size':1}
        with self.assertRaises(ValueError):u.validate(candidate)
    def test_canonical_lock_busy_fails(self):
        path=self.root/'lock';path.write_bytes(b'');path.chmod(0o600)
        with u.locked(path,self.uid,self.gid,self.root):
            with self.assertRaises(BlockingIOError):
                with u.locked(path,self.uid,self.gid,self.root):pass
    def test_completed_attempt_never_reused(self):
        self.execute()
        with self.assertRaises(RuntimeError):self.execute()
        self.assertEqual(json.loads((self.backup/'journal.json').read_bytes())['state'],'committed')

if __name__=='__main__':unittest.main()
