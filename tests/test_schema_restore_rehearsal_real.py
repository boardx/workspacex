"""Real PostgreSQL backup/restore and SQL tests on owned network-none fixtures.

Requires an already cached official postgres:16-alpine (or explicitly supplied
WSX_SCHEMA_RESTORE_TEST_IMAGE). Does not pull images or access production.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('schema_restore',ROOT/'scripts/schema-restore-rehearsal.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class RealRestore(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wsx-schema-restore-test-');self.root=Path(self.temp.name)
        self.docker=shutil.which('docker');self.assertIsNotNone(self.docker)
        self.image=json.loads(self.run_docker('image','inspect',os.environ.get('WSX_SCHEMA_RESTORE_TEST_IMAGE','postgres:16-alpine')))[0]['Id']
        self.token=uuid.uuid4().hex;self.name='wsx-schema-restore-source-test-'+self.token
        self.cid=None;self.addCleanup(self.remove_source)
        self.cid=self.run_docker('run','--detach','--pull=never','--name',self.name,'--label','wsx.test.schema-restore='+self.token,'--network','none',
                                '--memory=512m','--pids-limit=128','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=256m',
                                '--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=workspacex',self.image).strip()
        until=time.monotonic()+60
        while True:
            try:self.psql('SELECT 1');break
            except AssertionError:
                self.assertLess(time.monotonic(),until,'source fixture did not start');time.sleep(.2)
        self.psql("""CREATE ROLE app_rw;
CREATE TABLE public._kernel_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now());
INSERT INTO public._kernel_migrations(name,checksum) VALUES('001_baseline.sql','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
CREATE TABLE public.billing_orders(provider text NOT NULL CHECK(provider IN ('wechat')),channel_order_no text,qr_code_url text);
CREATE TABLE public.billing_monthly_orders(session_ref text CHECK(session_ref IS NULL OR session_ref ~ '^cs_[A-Za-z0-9_]+$'),payment_ref text CHECK(payment_ref IS NULL OR payment_ref ~ '^pi_[A-Za-z0-9_]+$'));
INSERT INTO public.billing_orders(provider,channel_order_no) VALUES('wechat','wx_baseline');
INSERT INTO public.billing_monthly_orders(session_ref,payment_ref) VALUES('cs_baseline','pi_baseline');""")
        self.ledger={'001_baseline.sql':'a'*64}
        self.files={name:(ROOT/'apps/api/migrations'/name).read_bytes() for name in m.MIGRATIONS}
        self.archive,self.key=m.encrypt_dump([self.docker,'exec','--user','postgres',self.cid,'pg_dump','--format=custom','--no-owner','--no-acl','--username=postgres','--dbname=workspacex'],self.root)
    def run_docker(self,*args):
        result=subprocess.run([self.docker,*args],capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stderr[-2000:]);return result.stdout
    def psql(self,sql):
        return self.run_docker('exec','--user','postgres',self.cid,'psql','-X','-w','-v','ON_ERROR_STOP=1','-At','--username=postgres','--dbname=workspacex','-c',sql)
    def remove_source(self):
        try:
            ids=self.run_docker('ps','--all','--no-trunc','--filter','label=wsx.test.schema-restore='+self.token,'--format','{{.ID}}').split()
            self.assertLessEqual(len(ids),1)
            for ident in ids:
                row=json.loads(self.run_docker('inspect',ident))[0]
                self.assertEqual(row['Config']['Labels']['wsx.test.schema-restore'],self.token)
                self.assertEqual(row['Name'],'/'+self.name)
                self.run_docker('rm','--force','--volumes',ident)
            # A failed cleanup must fail the test, but never orphan its fixture.
            for intent in self.root.glob('*/intent.json'):
                planned=json.loads(intent.read_bytes())
                owned=self.run_docker('ps','--all','--no-trunc','--filter','label='+planned['ownerLabel'],'--format','{{.ID}}').split()
                self.assertLessEqual(len(owned),1)
                for ident in owned:
                    row=json.loads(self.run_docker('inspect',ident))[0]
                    self.assertEqual(row['Name'],'/'+planned['name']);self.assertEqual(row['Image'],self.image)
                    self.assertEqual(row['HostConfig']['NetworkMode'],'none')
                    self.assertEqual('wsx.schema-rehearsal='+row['Config']['Labels']['wsx.schema-rehearsal'],planned['ownerLabel'])
                    self.run_docker('rm','--force','--volumes',ident)
        finally:
            destination=os.environ.get('WSX_SCHEMA_RESTORE_TEST_OUTPUT')
            if destination:
                target=Path(destination)/self._testMethodName;target.mkdir(mode=0o700,parents=True,exist_ok=True)
                for name in ('receipt.json','cleanup.json','restored.json'):
                    originals=list(self.root.glob('*/'+name))
                    if len(originals)==1:(target/name).write_bytes(originals[0].read_bytes())
                (target/'fixture.json').write_text(json.dumps({'scope':'synthetic-local-postgres-only','imageId':self.image,'productionAcceptance':False}))
            self.temp.cleanup()
    def assert_source_unchanged(self):
        self.assertEqual(self.psql('SELECT count(*) FROM public._kernel_migrations').strip(),'1')
        self.assertEqual(self.psql("SELECT count(*) FROM information_schema.columns WHERE table_name='billing_orders' AND column_name='stripe_session_ref'").strip(),'0')
        self.assertEqual(self.psql('SELECT count(*) FROM public.billing_orders').strip(),'1')
    def assert_rehearsal_cleaned(self,path):
        cleanup=json.loads((path/'cleanup.json').read_bytes());self.assertTrue(cleanup['removed'])
        left=self.run_docker('ps','--all','--filter','label='+cleanup['ownerLabel'],'--format','{{.ID}}')
        self.assertEqual(left.strip(),'')
    def test_actual_encrypted_restore_and_all_three_sql_leave_source_unchanged(self):
        path=self.root/'success'
        result=m.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,['app_rw'],self.files,path)
        self.assertEqual(result['status'],'ISOLATED_RESTORE_AND_SQL_REHEARSED')
        self.assertFalse(result['activationAllowed']);self.assertEqual(result['oldApiAcceptance'],'NOT_PERFORMED')
        self.assertEqual(json.loads((path/'restored.json').read_bytes())['ledgerCount'],1)
        self.assert_source_unchanged();self.assert_rehearsal_cleaned(path)
    def test_wrong_baseline_ledger_fails_before_sql_and_cleans_clone(self):
        path=self.root/'wrong-ledger'
        with self.assertRaisesRegex(ValueError,'RESTORED_LEDGER_MISMATCH'):
            m.rehearse(self.docker,self.image,self.archive,self.key,{'001_baseline.sql':'b'*64},['app_rw'],self.files,path)
        self.assert_source_unchanged();self.assert_rehearsal_cleaned(path)
    def test_corrupt_archive_is_not_success_and_cleans_clone(self):
        self.archive.write_bytes(os.urandom(2048))
        path=self.root/'corrupt'
        with self.assertRaisesRegex(ValueError,'RESTORE_PIPELINE_FAILED'):
            m.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,['app_rw'],self.files,path)
        self.assert_source_unchanged();self.assert_rehearsal_cleaned(path)
if __name__=='__main__':unittest.main()
