import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock,patch
P=Path(__file__).resolve().parents[1]/'scripts/cn-tag-maintenance-policy.py';s=importlib.util.spec_from_file_location('cn_policy',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Proof(unittest.TestCase):
 def test_status_alone_cannot_create_prepared_receipt(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp)
   for name,value in [('intent.json',{'environment':'cn','tag':m.TAG,'target':{'sourceRevision':m.SOURCE}}),('receipt.json',{'environment':'cn','tag':m.TAG,'status':'ISOLATED_RESTORE_AND_SQL_REHEARSED'}),('source-snapshot.json',{'database':'workspacex_a1cb_20261006','role':'migration_admin','ledger':{'old.sql':'a'*64}})]:
    (d/name).write_text(json.dumps(value))
   with patch.object(m,'trusted',side_effect=lambda p,*args:Path(p)):
    with self.assertRaises(FileNotFoundError):m.evidence(d,Mock())
 def test_wrong_target_stops_before_archive_or_any_write(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp)
   for name,value in [('intent.json',{'environment':'cn','tag':m.TAG,'target':{'sourceRevision':'0'*40}}),('receipt.json',{}),('source-snapshot.json',{})]:(d/name).write_text(json.dumps(value))
   with patch.object(m,'trusted',side_effect=lambda p,*args:Path(p)):
    with self.assertRaisesRegex(ValueError,'TARGET_SOURCE'):m.evidence(d,Mock())
if __name__=='__main__':unittest.main()

class FullOriginalEvidence(unittest.TestCase):
 def fixture(self,d):
  import hashlib,time
  sha=lambda raw:hashlib.sha256(raw).hexdigest()
  archive=b'ciphertext-fixture';ledger={'old.sql':'a'*64};image='sha256:'+'b'*64
  values={
   'intent.json':{'environment':'cn','tag':m.TAG,'target':{'sourceRevision':m.SOURCE}},
   'receipt.json':{'environment':'cn','tag':m.TAG,'status':'ISOLATED_RESTORE_AND_SQL_REHEARSED'},
   'source-snapshot.json':{'database':'workspacex_a1cb_20261006','role':'migration_admin','ledger':ledger},
   'isolated/restored.json':{'status':'RESTORED','archiveSha256':sha(archive),'ledgerSha256':sha(json.dumps(ledger,sort_keys=True).encode()),'cloneImageId':image},
   'isolated/receipt.json':{'status':'ISOLATED_RESTORE_AND_SQL_REHEARSED','migrationNames':['new.sql'],'cloneImageId':image},
   'isolated/intent.json':{'imageId':image,'network':'none','name':'fixture','ownerLabel':'fixture-owner'},
   'isolated/cleanup.json':{'removed':True,'name':'fixture','ownerLabel':'fixture-owner'}}
  for name,value in values.items():
   target=d/name;target.parent.mkdir(exist_ok=True);target.write_text(json.dumps(value))
  (d/'database.pgdump.enc').write_bytes(archive);(d/'backup.key').write_bytes(b'key-fixture')
  core=Mock();core.MIGRATIONS={'new.sql':'c'*64};core.sha=sha;core.file_sha=lambda path:sha(Path(path).read_bytes())
  return core
 def test_original_proof_set_is_reconciled(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);core=self.fixture(d)
   with patch.object(m,'trusted',side_effect=lambda p,*args:Path(p)):
    intent,metadata,proofs=m.evidence(d,core)
   self.assertEqual(len(proofs),9);self.assertEqual(metadata['role'],'migration_admin')
 def test_each_material_restore_claim_is_checked(self):
  mutations=[('isolated/restored.json','archiveSha256','0'*64),('isolated/restored.json','ledgerSha256','0'*64),('isolated/receipt.json','migrationNames',[]),('isolated/cleanup.json','removed',False),('isolated/intent.json','network','host')]
  for filename,key,value in mutations:
   with self.subTest(filename=filename,key=key),tempfile.TemporaryDirectory() as tmp:
    d=Path(tmp);core=self.fixture(d);path=d/filename;data=json.loads(path.read_text());data[key]=value;path.write_text(json.dumps(data))
    with patch.object(m,'trusted',side_effect=lambda p,*args:Path(p)):
     with self.assertRaises(ValueError):m.evidence(d,core)
 def test_stale_original_files_are_rejected(self):
  import os,time
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);core=self.fixture(d);old=time.time()-1801;os.utime(d/'backup.key',(old,old))
   with patch.object(m,'trusted',side_effect=lambda p,*args:Path(p)):
    with self.assertRaisesRegex(ValueError,'SOURCE_PROOF_EXPIRED'):m.evidence(d,core)
 def test_symlink_input_is_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);(d/'target').write_text('test');(d/'link').symlink_to(d/'target')
   # Root ownership is independently mandatory; this also fails closed on a non-root workstation.
   with self.assertRaises(ValueError):m.trusted(d/'link')

class LiveBoundaries(unittest.TestCase):
 def test_live_api_change_rejects_source_receipt(self):
  with self.assertRaisesRegex(ValueError,'BASELINE_API_DRIFT'):m.baseline_identity({'api':{'imageId':'new'}},{'baselineApiImageId':'old'})
 def test_replaced_lock_rejected(self):
  import stat
  opened=Mock(st_dev=1,st_ino=2);named=Mock(st_dev=1,st_ino=3,st_uid=0,st_mode=stat.S_IFREG|0o600);path=Mock();path.lstat.return_value=named
  with patch.object(m.os,'fstat',return_value=opened):
   with self.assertRaisesRegex(ValueError,'CANONICAL_LOCK_DRIFT'):m.lock_identity(3,path)
