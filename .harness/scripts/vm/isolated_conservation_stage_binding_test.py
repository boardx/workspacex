from pathlib import Path
import copy,hashlib,unittest
from isolated_conservation_stage import verify_binding,run_stage,bind_request
class BindingTests(unittest.TestCase):
 def setUp(self):
  self.b={'accountId':'1177216024653153','regionId':'cn-shanghai','attemptId':'12345678-1234-4234-8234-123456789abc','targetInstanceId':'pgm-testclone','sourceInstanceId':'pgm-source','candidateSha':'a'*40,'host':'pgm-testclone.rwlb.rds.aliyuncs.com','peer':'10.0.0.2','peerSha256':hashlib.sha256(b'10.0.0.2').hexdigest(),'providerCreatedUtc':'2026-10-02T00:00:00Z','tls':{'sslmode':'verify-full'}}
  self.b['privateRoot']='/var/lib/workspacex-cn/rehearsal/isolated-rds/'+self.b['attemptId'];self.b['providerDescription']='wsx-cn-isolated-round2-'+self.b['attemptId']
  self.s={**self.b,'user':'migration_admin','port':5432,'password':'not-a-real-secret-test'}
 def test_binding_accept(self):verify_binding(self.b,self.s)
 def test_reject_source(self):
  self.b['targetInstanceId']=self.b['sourceInstanceId']
  with self.assertRaises(ValueError):verify_binding(self.b,self.s)
 def test_role_account_is_bound(self):
  self.s['accountId']='other'
  with self.assertRaises(ValueError):verify_binding(self.b,self.s)
 def test_peer_drift(self):
  self.b['peer']='10.0.0.3'
  with self.assertRaises(ValueError):verify_binding(self.b,self.s)
 def test_request_actual_restore_hash(self):
  baseline={'backupReceiptSha256':'a'*64,'ciphertextSha256':'b'*64};r=bind_request({},self.b,'before','workspacex',baseline)
  self.assertEqual(r['targetInstanceId'],self.b['targetInstanceId']);self.assertEqual(r['baselineBackupReceiptSha256'],'a'*64);self.assertFalse(r['seed']);self.assertEqual(r['expiresAtMs']-r['authorizedAtMs'],7200000)
 def test_request_old_target_rejected(self):
  with self.assertRaisesRegex(ValueError,'REQUEST_TEMPLATE_DRIFT'):bind_request({'targetInstanceId':'pgm-old'},self.b,'before','workspacex',{'backupReceiptSha256':'a'*64,'ciphertextSha256':'b'*64})
 def test_request_unbound_archive_rejected(self):
  with self.assertRaises(ValueError):bind_request({},self.b,'before','workspacex',{'backupReceiptSha256':'unknown','ciphertextSha256':'b'*64})
 def test_unfrozen_never_invokes_engine(self):
  self.b.update(frozenManifestPath='/x',frozenManifestSha256='b'*64)
  calls=[]
  with self.assertRaisesRegex(ValueError,'FROZEN_SOURCE_REQUIRED'):
   run_stage({'binding':self.b,'secret':self.s},reader=lambda *a:b'{"frozen":false}',invoke=lambda *a:calls.append(a))
  self.assertEqual(calls,[])
if __name__=='__main__':unittest.main()
