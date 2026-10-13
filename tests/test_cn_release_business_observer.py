import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/('cn-release-business-'+name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('observer');state=load('state')
class Admission(unittest.TestCase):
    def fixture(self):
        identity=dict(sourceRevision='a'*40,baselineRevision='b'*40,controlRevision='c'*40,publicationAttemptId='publication',attemptId='attempt',requestedAt='2026-10-11T20:00:00Z',deadlineAt='2026-10-11T20:30:00Z')
        return json.dumps({'kind':'cn-fixed-release-approval-v1','target':m.TARGET,'identity':identity,'business':{'passed':True}}).encode()
    def test_missing_runtime_not_waived_by_passed_flag(self):
        a=m.validate_approval(self.fixture(),hashlib.sha256(self.fixture()).hexdigest(),'preflight')
        with self.assertRaises((KeyError,ValueError)):m.preflight(a)
    def test_preflight_calls_fixed_capability_checker_without_a5_requirement(self):
        a=m.validate_approval(self.fixture(),hashlib.sha256(self.fixture()).hexdigest(),'preflight')
        class Fixed:
            @staticmethod
            def preflight(actual):self.assertEqual(actual,a);return {'ready':'capabilities-only'}
        with patch.object(m,'state_module',return_value=Fixed):self.assertEqual(m.preflight(a),{'ready':'capabilities-only'})
    def test_entry_reconcile_and_terminal_use_identical_original_business_bytes(self):
        raw_approval=self.fixture();release=hashlib.sha256(raw_approval).hexdigest();a=json.loads(raw_approval)
        receipt={'kind':'cn-independent-business-acceptance-v1','checks':{'actualFixture':True}};raw=state.enc(receipt)
        manifest={k:v for k,v in a['identity'].items()if k!='publicationAttemptId'};manifest.update(stage='observe',previousReceiptSha256='prior')
        with patch.object(m,'private',return_value=raw_approval),patch.object(m,'execute',return_value=receipt),patch.object(m,'state_module',return_value=state):
            self.assertEqual(m.verify(raw,manifest,'prior','terminal',release),{'externalWritesTerminal':True})
            self.assertTrue(m.verify(raw,manifest,'prior','reconcile',release))
            with self.assertRaisesRegex(ValueError,'ORIGINAL_RAW'):m.verify(b'{"terminal":true}',manifest,'prior','reconcile',release)
    def test_wrong_hash(self):
        with self.assertRaisesRegex(ValueError,'APPROVAL_HASH'):m.validate_approval(self.fixture(),'0'*64,'observe')
    def test_duplicate(self):
        raw=b'{"kind":1,"kind":2}'
        with self.assertRaisesRegex(ValueError,'DUPLICATE_KEY'):m.validate_approval(raw,hashlib.sha256(raw).hexdigest(),'observe')
    def test_reader_actual_fs_closure_symlink_and_unlisted_rejected(self):
        with tempfile.TemporaryDirectory()as td:
            root=Path(td);root.chmod(0o700);p=root/'module.js';p.write_bytes(b'actual bytes');p.chmod(0o600)
            r=state.Reader(os.getuid(),root);pins={'module.js':state.sha(p.read_bytes())};r.tree(root,pins)
            (root/'extra.js').write_bytes(b'x')
            with self.assertRaisesRegex(ValueError,'TREE_CLOSURE'):r.tree(root,pins)
            (root/'extra.js').unlink();p.unlink();p.symlink_to('/etc/passwd')
            with self.assertRaisesRegex(ValueError,'TREE_SYMLINK'):r.tree(root,pins)
    def test_reader_world_writable_parent(self):
        with tempfile.TemporaryDirectory()as td:
            root=Path(td);root.chmod(0o777)
            with self.assertRaisesRegex(ValueError,'UNTRUSTED_PARENT'):state.Reader(os.getuid(),root).directory(root)
    def test_real_subprocess_rpc_private_session_and_terminal(self):
        code="import json,sys;json.loads(input());print(json.dumps({'type':'read-state'}),flush=True);assert json.loads(input())=={'actual':'readback'};print(json.dumps({'type':'private-session','token':'fixture-only'}),flush=True);print(json.dumps({'type':'result','receipt':{'kind':'fixture'}}),flush=True)"
        with tempfile.TemporaryDirectory()as td:
            session=Path(td)/'session';result=m.run_child([sys.executable,'-I','-c',code],{'operation':'action'},lambda:{'actual':'readback'},session,5)
            self.assertEqual(result,{'kind':'fixture'});self.assertEqual(session.read_bytes(),b'fixture-only');self.assertEqual(session.stat().st_mode&0o777,0o600)
    def test_duplicate_session_unknown_no_overwrite(self):
        code="import json;input();print(json.dumps({'type':'private-session','token':'first'}),flush=True);print(json.dumps({'type':'private-session','token':'second'}),flush=True)"
        with tempfile.TemporaryDirectory()as td:
            p=Path(td)/'session'
            with self.assertRaisesRegex(ValueError,'SESSION_ORDER'):m.run_child([sys.executable,'-I','-c',code],{'operation':'action'},lambda:None,p,5)
            self.assertEqual(p.read_bytes(),b'first')
    def test_timeout_and_oversize_kill_without_receipt(self):
        for code,reason in [("import time;input();time.sleep(10)",'DEADLINE'),("input();print('x'*70000,flush=True)",'BOUND')]:
            with tempfile.TemporaryDirectory()as td,self.assertRaisesRegex(ValueError,reason):m.run_child([sys.executable,'-I','-c',code],{'operation':'readback'},lambda:None,Path(td)/'session',.3)
if __name__=='__main__':unittest.main()
