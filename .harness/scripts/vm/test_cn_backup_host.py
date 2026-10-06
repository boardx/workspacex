import time,unittest,hashlib
from unittest.mock import patch
from test_cn_backup_package import fixture
from cn_backup_host import freshness_budget,BackupHost
from cn_backup_package import DATABASES
class HostTests(unittest.TestCase):
 def host(self):
  p,_=fixture();n=time.time()
  return {'backup':p,'connection':{'transport':{d:{'notBefore':n-10,'expiresAt':p['authorization']['expiresAt']+120} for d in DATABASES}}},n
 def test_freshness_preserves_120second_cleanup_reserve(self):
  h,n=self.host();self.assertAlmostEqual(freshness_budget(h,n,expected_identity=h['backup']['identity']),n+170)
 def test_stale_transport_rejected(self):
  h,n=self.host();h['connection']['transport'][DATABASES[0]]['notBefore']=n-181
  with self.assertRaisesRegex(RuntimeError,'FRESHNESS_RESERVE'):freshness_budget(h,n,expected_identity=h['backup']['identity'])
 def test_partial_transport_rejected(self):
  h,n=self.host();del h['connection']['transport'][DATABASES[0]]
  with self.assertRaisesRegex(RuntimeError,'TRANSPORT_CLOSURE'):freshness_budget(h,n,expected_identity=h['backup']['identity'])
 def test_expired_cert_rejected_even_with_matching_hashes(self):
  p,_=fixture();raw=b'fixture'
  for key in ('recipientCertificate','recipientKey'):p[key]['sha256']=hashlib.sha256(raw).hexdigest()
  obj=object.__new__(BackupHost);obj.plan=p;obj.expected_identity=dict(p['identity']);obj.read=lambda _:raw;obj.clock=time.time;obj.custody={'retentionExpiresAt':time.time()+3600}
  with patch('cn_backup_host.subprocess.run') as run:
   run.return_value.returncode=1
   with self.assertRaisesRegex(RuntimeError,'CERTIFICATE_EXPIRED'):obj.certificate_preflight()
   self.assertIn('-checkend',run.call_args.args[0])
 def test_canary_must_decrypt_actual_bytes(self):
  from cn_backup_host import canary
  p,_=fixture();obj=object.__new__(BackupHost);obj.plan=p;obj.expected_identity=dict(p['identity'])
  with patch('cn_backup_host.subprocess.run') as run:
   run.side_effect=[type('R',(),{'stdout':b'cipher'})(),type('R',(),{'stdout':b'wrong plaintext'})()]
   with self.assertRaisesRegex(RuntimeError,'CMS_CANARY'):canary(obj)
 def test_docker_foreign_owner_never_removable(self):
  from cn_backup_host import docker_inventory
  obj=object.__new__(BackupHost);obj.owner='a'*32
  import json
  row={'Id':'b'*64,'Image': 'wrong','Config':{'Labels':{'wsx.backup.owner':'foreign'}}}
  with patch('cn_backup_host.fixed_docker',side_effect=[('b'*64).encode(),json.dumps([row]).encode()]):
   with self.assertRaisesRegex(RuntimeError,'DOCKER_OWNERSHIP'):docker_inventory(obj)
 def test_cleanup_removes_only_live_verified_id_before_sql_readback(self):
  from cn_backup_host import cleanup_and_revoke
  from cn_backup_package import compile_role_sql
  import json,types
  p,scope=fixture();obj=object.__new__(BackupHost);obj.plan=p;obj.expected_identity=dict(p['identity']);obj.scope=scope;obj.authorization=object();obj.owner='a'*32;obj.registry='/fixture/registry';obj.password=None
  obj.channels={d:object() for d in DATABASES};calls=[]
  obj.read=lambda path: json.dumps({'identity':p['identity'],'owner':obj.owner,'containers':['b'*64]}).encode() if path==obj.registry else b'key'
  p['recipientKey']['sha256']=hashlib.sha256(b'key').hexdigest()
  obj.close_and_revoke_sql=lambda:calls.append('sql-cleanup');obj.close_channels=lambda:None
  with patch('cn_backup_host.dispatch',side_effect=lambda *a,**kw:calls.append('close')),patch('cn_backup_host.docker_inventory',side_effect=[[{'Id':'b'*64}],[]]),patch('cn_backup_host.fixed_docker',side_effect=lambda _,args:calls.append(args)):
   obj.compiled_sql=compile_role_sql(p,scope,expected_identity=p['identity'])
   result=cleanup_and_revoke(obj,p,obj.compiled_sql)
  self.assertEqual(calls,['close',['rm','-f','b'*64],'sql-cleanup'])
  self.assertTrue(result['ownedContainersAbsent']);self.assertTrue(result['recipientKeyRetained'])
 def test_wrong_registry_identity_prevents_container_removal(self):
  from cn_backup_host import cleanup_and_revoke
  from cn_backup_package import compile_role_sql
  import json
  p,scope=fixture();obj=object.__new__(BackupHost);obj.plan=p;obj.expected_identity=dict(p['identity']);obj.scope=scope;obj.authorization=object();obj.owner='a'*32;obj.registry='/fixture';obj.channels={d:object() for d in DATABASES}
  obj.read=lambda _:json.dumps({'identity':{},'owner':obj.owner,'containers':[]}).encode()
  with patch('cn_backup_host.dispatch'),patch('cn_backup_host.fixed_docker') as docker:
   obj.compiled_sql=compile_role_sql(p,scope,expected_identity=p['identity'])
   with self.assertRaisesRegex(RuntimeError,'CLEANUP_REGISTRY'):cleanup_and_revoke(obj,p,obj.compiled_sql)
   docker.assert_not_called()
 def test_stream_receipt_comes_from_collector_atomic_metadata(self):
  from cn_backup_host import export_owned_ciphertext
  from cn_backup_package import digest,IMAGE,ROLE
  from pathlib import Path
  import json,types
  p,scope=fixture();db=DATABASES[0];obj=object.__new__(BackupHost);obj.plan=p;obj.expected_identity=dict(p['identity']);obj.scope=scope;obj.password='secret-test-only';obj.owner='a'*32;obj.root=Path('/fixture');obj.registry=Path('/fixture/owned-containers.json');obj.reference={'path':'/fixture/host','sha256':'b'*64};obj.clock=lambda:0;obj.deadline=100
  obj.channels={d:types.SimpleNamespace(process=types.SimpleNamespace(stdin=None,stdout=None)) for d in DATABASES}
  store={str(obj.registry):{'identity':p['identity'],'owner':obj.owner,'containers':[]}}
  obj.read=lambda path:json.dumps(store[path]).encode()
  app='wsx-backup-'+p['identity']['attemptId']+'-'+db
  facts={'applicationName':app,'session':{'clientAddr':'192.168.100.40'},'peer':{'serverAddr':'192.168.100.44'}}
  proof={'kind':'live-owned-pgdump-backend','identity':p['identity'],'facts':facts,'evidenceSha256':digest(facts),'readOnlyEvidence':{'sqlObserved':False}}
  ch=types.SimpleNamespace(close=lambda:None)
  def stream(prod,enc,credential,path,observe,**kw):
   name=prod[prod.index('--name')+1]
   with patch('cn_backup_host.docker_inventory',return_value=[{'Id':'c'*64,'Name':'/'+name}]),patch('cn_backup_host.fixed_docker',return_value=b'PID COMMAND\n123 pg_dump\n'):
    self.assertIs(observe(99),True)
   self.assertEqual(credential,(db+'\nsecret-test-only\n'+app+'\n').encode())
   return {'backendObserved':True,'ownedProcessesJoined':True}
  with patch('cn_backup_host.recheck_inputs'),patch('cn_backup_host.BackupChannel',return_value=ch),patch('cn_backup_host.atomic_metadata',side_effect=lambda path,value,*args,**kw:store.update({str(path):value})),patch('cn_backup_host.BackupBackendCollector') as collector,patch('cn_backup_host.stream_ciphertext',side_effect=stream):
   collector.return_value.collect.return_value=proof
   result=export_owned_ciphertext(obj,p,db)
  self.assertEqual(store[str(obj.registry)]['containers'],['c'*64]);self.assertEqual(result['readOnlyEvidence'],proof['readOnlyEvidence'])
  self.assertNotIn('password',str(store))
 def client_host(self):
  from cn_backup_package import IMAGE
  import types
  return types.SimpleNamespace(host={'pgDump16':{'imageId':IMAGE,'versionMajor':16,'sha256':'a'*64,'exePath':'/usr/lib/postgresql/16/bin/pg_dump'}})
 def test_cached_clients_probe_actual_versions_and_hash(self):
  from cn_backup_host import verify_cached_clients
  obj=self.client_host();path=obj.host['pgDump16']['exePath'];raw=('pg_dump (PostgreSQL) 16.13\npg_restore (PostgreSQL) 16.13\n'+path+'\n'+'a'*64+'  '+path+'\n').encode()
  with patch('cn_backup_host.fixed_docker',side_effect=[raw,b'']) as run:
   result=verify_cached_clients(obj)
   self.assertIn('--network=none',run.call_args_list[0].args[1]);self.assertIn('--pull=never',run.call_args_list[0].args[1])
   self.assertEqual(result['pgDumpVersion'],'pg_dump (PostgreSQL) 16.13')
 def test_metadata_16_cannot_override_actual_17(self):
  from cn_backup_host import verify_cached_clients
  obj=self.client_host()
  with patch('cn_backup_host.fixed_docker',side_effect=[b'pg_dump (PostgreSQL) 17.1\npg_restore (PostgreSQL) 16.1\n/path\nhash\n',b'']):
   with self.assertRaisesRegex(RuntimeError,'ACTUAL_PG16_VERSION'):verify_cached_clients(obj)
 def test_actual_pgdump_hash_drift_rejected(self):
  from cn_backup_host import verify_cached_clients
  obj=self.client_host();path=obj.host['pgDump16']['exePath'];raw=('pg_dump (PostgreSQL) 16.13\npg_restore (PostgreSQL) 16.13\n'+path+'\n'+'b'*64+'  '+path+'\n').encode()
  with patch('cn_backup_host.fixed_docker',side_effect=[raw,b'']):
   with self.assertRaisesRegex(RuntimeError,'ACTUAL_PGDUMP_HASH'):verify_cached_clients(obj)
 def custody_host(self):
  import json,types
  p,_=fixture();n=time.time();base='/etc/workspacex-cn/backup-approvals/'+p['identity']['attemptId']+'/'
  receipt={'schemaVersion':1,'kind':'backup-key-escrow-receipt','identity':p['identity'],'recipientKeySha256':p['recipientKey']['sha256'],'custodian':'release-custodian','retentionExpiresAt':n+7200,'custodyReceiptId':'human-escrow-123'}
  raw=json.dumps(receipt).encode();procedure=b'Approved recovery procedure: offline CMS decrypt and three database restore rehearsal.'
  approval={k:receipt[k] for k in ('schemaVersion','identity','recipientKeySha256','custodian','retentionExpiresAt')};approval.update(action='retain-backup-recipient-key',escrowReceiptSha256=hashlib.sha256(raw).hexdigest(),recoveryProcedureSha256=hashlib.sha256(procedure).hexdigest())
  ar=json.dumps(approval).encode();files={base+'custody.json':ar,base+'escrow-receipt.json':raw,base+'recovery-procedure.txt':procedure}
  host={k:{'path':base+name,'sha256':hashlib.sha256(files[base+name]).hexdigest()} for k,name in (('custodyApproval','custody.json'),('escrowReceipt','escrow-receipt.json'),('recoveryProcedure','recovery-procedure.txt'))}
  return types.SimpleNamespace(host=host,plan=p,clock=lambda:n,read=lambda path:files[path]),files
 def test_custody_requires_approval_and_actual_artifact_bytes(self):
  from cn_backup_host import verify_custody
  obj,files=self.custody_host();result=verify_custody(obj);self.assertEqual(result['recipientKeySha256'],obj.plan['recipientKey']['sha256'])
  files[obj.host['escrowReceipt']['path']]=b'drift'
  with self.assertRaisesRegex(RuntimeError,'CUSTODY_ARTIFACT_PIN'):verify_custody(obj)
 def test_custody_truthy_flag_not_authority(self):
  from cn_backup_host import verify_custody
  obj,files=self.custody_host();obj.host['custodyApproval']=True
  with self.assertRaisesRegex(RuntimeError,'CUSTODY_APPROVAL_REQUIRED'):verify_custody(obj)
 def test_certificate_checkend_covers_retention(self):
  p,_=fixture();raw=b'fixture'
  for key in ('recipientCertificate','recipientKey'):p[key]['sha256']=hashlib.sha256(raw).hexdigest()
  obj=object.__new__(BackupHost);obj.plan=p;obj.expected_identity=dict(p['identity']);obj.read=lambda _:raw;obj.clock=lambda:1000;obj.custody={'retentionExpiresAt':10000}
  with patch('cn_backup_host.subprocess.run') as run:
   run.return_value.returncode=0;obj.certificate_preflight();args=run.call_args.args[0]
   self.assertEqual(args[args.index('-checkend')+1],'9001')
if __name__=='__main__':unittest.main()

class ProtectedGenericHostTests(unittest.TestCase):
 def inputs(self):
  import hashlib,json
  p,_=fixture();identity=dict(p['identity'],sourceRevision='a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0')
  p['identity']=dict(identity);p['authorization']['identity']=dict(identity)
  now=time.time();p['authorization'].update(notBefore=now-10,expiresAt=now+1200)
  host={'identity':identity,'backup':p,'connection':{'transport':{d:{'notBefore':now-10,'expiresAt':now+1400} for d in DATABASES}}}
  raw=json.dumps(host).encode();ref={'path':'/etc/workspacex-cn/maintenance-backup/'+identity['sourceRevision']+'/'+identity['attemptId']+'/host-plan.json','sha256':hashlib.sha256(raw).hexdigest()}
  profile={'backupHostPlan':ref,'toolRevision':p['toolRevision']}
  return identity,raw,ref,profile
 def test_new_candidate_comes_from_profile_pinned_host(self):
  import json
  identity,raw,ref,profile=self.inputs()
  host=BackupHost(ref,read=lambda path:json.dumps(profile).encode() if path.endswith('trusted-tool-binding.json') else raw)
  self.assertEqual(host.expected_identity,identity)
 def test_wrong_profile_or_actor_is_rejected_before_channels(self):
  import json,copy
  identity,raw,ref,profile=self.inputs()
  for mismatch in ('profile','actor'):
   other=copy.deepcopy(profile)
   if mismatch=='profile':other['backupHostPlan']['sha256']='0'*64
   expected=dict(identity,sourceRevision='b'*40) if mismatch=='actor' else identity
   with self.assertRaisesRegex(RuntimeError,'PROFILE|EXPECTED_IDENTITY'):
    BackupHost(ref,read=lambda path:json.dumps(other).encode() if path.endswith('trusted-tool-binding.json') else raw,expected_identity=expected)
