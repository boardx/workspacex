"""Offline qualification of the fixed operational proposal; never host acceptance."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
OPS=ROOT/'docs/evidence/cn-release-6150'

def load(path,name):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

class FixedProposal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.out=Path(cls.tmp.name)/'bundle'
        load(OPS/'build-tools.py','compiler6150').build(cls.out)
        cls.manifest=json.loads((cls.out/'bundle.json').read_text())
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def test_closure_expansion_does_not_change_old_probe_path(self):
        import ast
        tree=ast.parse((self.out/'cn-reviewed-tag-prepare.py').read_text())
        paths=[node for node in ast.walk(tree) if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='str' and node.args and isinstance(node.args[0],ast.BinOp) and isinstance(node.args[0].right,ast.Constant) and node.args[0].right.value=='cn-tag-old-application-probe.py']
        self.assertEqual(len(paths),2)
        self.assertTrue(all(len(node.args)==1 for node in paths))
    def test_sql_bytes_from_frozen_artifact_are_required_and_tampering_refused(self):
        m=load(self.out/'schema-restore-rehearsal.py','core6150')
        files={n:subprocess.check_output(['git','show',self.manifest['source']+':apps/api/migrations/'+n],cwd=ROOT) for n in self.manifest['migrations']}
        self.assertEqual(len(m.reviewed_sql(files)),11)
        changed={**files};n=next(iter(changed));changed[n]+=b'\nSELECT 1;'
        with self.assertRaisesRegex(ValueError,'CHECKSUM_DRIFT'):m.reviewed_sql(changed)
        with self.assertRaisesRegex(ValueError,'MIGRATION_SET'):m.reviewed_sql({**files,'unreviewed.sql':b'SELECT 1;'})
    def test_real_transaction_driver_accepts_only_exact_new_source_tag_and_sql(self):
        files={n:subprocess.check_output(['git','show',self.manifest['source']+':apps/api/migrations/'+n],cwd=ROOT).decode() for n in self.manifest['migrations']}
        plan={'environment':'cn','source':self.manifest['source'],'tag':self.manifest['tag'],'database':'workspacex_a1cb_20261006','role':'migration_admin','baselineLedger':{'baseline.sql':'a'*64}}
        js="import fs from 'node:fs';import {validate} from "+json.dumps((self.out/'tag-reviewed-migration-driver.mjs').as_uri())+";const x=JSON.parse(fs.readFileSync(0));validate(x.plan,x.files);let rejected=false;try{validate({...x.plan,tag:'1-1'},x.files);}catch{rejected=true;}if(!rejected)throw Error('wrong tag accepted');console.log('EXACT_SQL_VALIDATED');"
        r=subprocess.run(['node','--input-type=module','-e',js],input=json.dumps({'plan':plan,'files':files}),capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr);self.assertIn('EXACT_SQL_VALIDATED',r.stdout)
    def test_complete_state_is_rejected_before_reservation_hold_stop_or_replay(self):
        sys.path.insert(0,str(ROOT/'tests'))
        import test_cn_reviewed_tag_release as existing
        with patch.object(existing,'S',self.out/'cn-reviewed-tag-release.py'):
            case=existing.WriterOrchestrationTests('test_success_fixed_flow_preserves_honest_scope')
            try:
                m,ctx,state,events,nginx,pending,error=case.exercise(initial_ledger='COMPLETE')
                self.assertRegex(str(error),'FIRST_BASELINE_SCHEMA_REQUIRED')
                self.assertNotIn('reserve-once',events);self.assertNotIn('nginx-held',events);self.assertNotIn('stop-old',events);self.assertNotIn('sql-apply',events)
                self.assertTrue(state['running']);self.assertEqual(nginx.read_bytes(),b'original');self.assertTrue(pending.exists())
            finally:case.doCleanups()

    def test_independent_restore_verifier_rejects_changed_archive_and_failed_result(self):
        import hashlib,types
        helper=load(self.out/'cn-reviewed-backup-6150.py','backup6150verify')
        with tempfile.TemporaryDirectory() as tmp:
            attempt=Path(tmp);out=attempt/'stopped-backup';clone=out/'owner-acl-rehearsal';clone.mkdir(parents=True)
            def save(name,value):
                path=out/name;path.write_text(json.dumps(value));return path
            def ref(path):return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            for name in ('database.pgdump.enc','backup.key','snapshot.json','source-capture.json','cn-clone-profile.json'):save(name,{'syntheticFixtureOnly':True})
            save('owner-acl-rehearsal/intent.json',{'syntheticFixtureOnly':True});save('owner-acl-rehearsal/restored.json',{'syntheticFixtureOnly':True});save('owner-acl-rehearsal/restored-catalog.json',{'syntheticFixtureOnly':True})
            save('owner-acl-rehearsal/catalog-comparison.json',{'equal':True});save('owner-acl-rehearsal/cleanup.json',{'removed':True})
            result={'status':'OWNER_ACL_SQL_REHEARSED','sourceOwnerAclRestored':True,'appRoleTransactionRollback':True,'migrationRoleAcceptance':'EXACT_REVIEWED_SQL_LOGIN_ONLY','migrationNames':list(self.manifest['migrations'])}
            save('owner-acl-rehearsal/receipt.json',result)
            def proof():
                import time
                return save('owner-acl-qualification.json',{'kind':'cn-owner-acl-restore-6150','status':'STOPPED_OWNER_ACL_SQL_RESTORE_VERIFIED','environment':'cn','source':self.manifest['source'],'tag':self.manifest['tag'],'migrationChecksums':self.manifest['migrations'],'baselineLedgerCount':438,'targetLedgerCount':449,'createdAt':time.time(),'files':{str(p.relative_to(out)):ref(p)['sha256'] for p in out.rglob('*') if p.is_file() and p.name!='owner-acl-qualification.json'}})
            # Root ancestry is separately covered by the shared pin-reader suite.
            # This local fixture preserves real byte-hash checks; never host proof.
            def pinned(reference,**kw):
                p=Path(reference['path'])
                if ref(p)['sha256']!=reference['sha256']:raise ValueError('INPUT_HASH_DRIFT')
                return p
            modules={'schema-restore-rehearsal':object(),'tag-maintenance-release':types.SimpleNamespace(pinned=pinned)}
            path=proof()
            with patch.object(helper,'load',side_effect=lambda name:modules[name]):
                helper.verify(ref(path),attempt,self.manifest['migrations'])
                (out/'database.pgdump.enc').write_bytes(b'tampered')
                with self.assertRaisesRegex(ValueError,'INPUT_HASH_DRIFT'):helper.verify(ref(path),attempt,self.manifest['migrations'])
                result['appRoleTransactionRollback']=False;save('owner-acl-rehearsal/receipt.json',result);path=proof()
                with self.assertRaisesRegex(ValueError,'RESTORE_RESULT_NOT_PASSED'):helper.verify(ref(path),attempt,self.manifest['migrations'])
