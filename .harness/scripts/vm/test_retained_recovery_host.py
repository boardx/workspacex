import hashlib,json,pathlib,stat,tempfile,time,types,unittest
from unittest.mock import patch
import host_transport as h
from writer_fence import DATABASES

class RetainedRecoveryTests(unittest.TestCase):
 def test_actor_three_database_receipt_and_partial_failure(self):
  for fault in (None,'legacy-approved','second-db','wrong-receipt','guard','replay','unbound-plan','cross-source','cross-attempt','cross-tool','unapproved-original','runtime-original','wrong-original-pin','missing-original'):
   with self.subTest(fault=fault),tempfile.TemporaryDirectory() as tmp:
    identity={'sourceRevision':('9b25bfa65662b96c0826fe67506b562ea46aa6d0' if fault=='legacy-approved' else 'a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0'),'baselineRevision':'ba6343199f3c834d6a198f83d0c771614292c82b','migrationPlanSha256':'a'*64,'attemptId':'test'}
    name='/etc/workspacex-cn/maintenance-recovery/'+identity['sourceRevision']+'/test/recovery-plan.json';calls=[];events=[];now=time.time()
    peers={db:{'database':db,'serverAddr':'10.0.0.1','serverPort':5432,'systemIdentifier':'42'} for db in DATABASES}
    data={'identity':identity,'toolRevision':'b'*40,'production':{'instanceId':'pgm-uf6rg214cp381l49','databasePeers':peers},'authorization':{'identity':identity,'productionInstanceId':'pgm-uf6rg214cp381l49','action':'replace-three-production-databases-with-exact-baseline','notBefore':now-10,'expiresAt':now+600},'databases':{db:{'ciphertext':{'sha256':'c'*64},'backupReceiptSha256':'d'*64,'sourceCatalogSha256':'e'*64} for db in DATABASES}}
    raw=json.dumps(data).encode();reference={'path':name,'sha256':hashlib.sha256(raw).hexdigest()}
    plan={'identity':identity,'toolRevision':data['toolRevision'],'databasePeers':peers,'recoveryAuthorization':{'identity':identity,'planPath':name,'planSha256':reference['sha256']}}
    def recover(db):
     calls.append(db)
     if fault=='second-db' and db==DATABASES[1]:raise RuntimeError('helper rejected')
     return {'database':db,'targetRdsInstanceId':'pgm-uf6rg214cp381l49','ciphertextSha256':'c'*64,'backupReceiptSha256':'d'*64,'catalogSha256':('f' if fault=='wrong-receipt' else 'e')*64,'dataFidelityVerified':True,'existingSession':True,'precommitFidelityVerified':True,'restoreCommitted':True,'decoderJoined':True,'ready':False}
    original=json.loads(json.dumps(plan));original.update(schemaVersion=1,mode='maintenance-all-writer-fence',productionActionsAuthorized=True)
    if fault=='cross-source':original['identity']['sourceRevision']='f'*40
    if fault=='cross-attempt':original['identity']['attemptId']='other'
    if fault=='cross-tool':original['toolRevision']='f'*40
    if fault=='unapproved-original':original['productionActionsAuthorized']=False
    if fault=='runtime-original':original['runtimeSourcePlanSha256']='f'*64
    original_raw=json.dumps(original).encode();original_ref={'path':'/etc/workspacex-cn/original-host-plan.json','sha256':hashlib.sha256(original_raw).hexdigest()}
    if fault=='wrong-original-pin':original_ref['sha256']='f'*64
    transport=types.SimpleNamespace(plan=plan,manifest_sha=original_ref['sha256'],reviewed_plan_ref=None if fault=='missing-original' else original_ref,control_connections={db:types.SimpleNamespace(recover_existing_session=lambda identity,db=db:recover(db)) for db in DATABASES})
    def guard(identity):
     events.append('guard')
     if fault=='guard':raise RuntimeError('not held')
    adapter=types.SimpleNamespace(verifyWritesBlocked=guard)
    journal=types.SimpleNamespace(value={'retainedRecoveryStarted':fault=='replay'},record=lambda state,**facts:events.append(state))
    real_path=pathlib.PosixPath;real_lstat=real_path.lstat
    def output_path(value):return real_path(tmp)/'recovery-plan.json' if value==name else real_path(value)
    def root_fixture_lstat(value,*args,**kwargs):
     result=real_lstat(value,*args,**kwargs)
     if str(value)==tmp:
      fields=list(result);fields[4]=0;fields[5]=0;return __import__('os').stat_result(fields)
     return result
    def read_private(value):return original_raw if value==original_ref['path'] else raw if value==name else real_path(value).read_bytes()
    if fault=='unbound-plan':reference={**reference,'sha256':'0'*64}
    with patch.object(h.pathlib,'Path',side_effect=output_path),patch.object(real_path,'lstat',root_fixture_lstat):
     if fault and fault!='legacy-approved':
      with self.assertRaises(RuntimeError):h.recover_retained_databases(transport,adapter,journal,identity,reference,read_private)
      self.assertFalse((real_path(tmp)/'production-recovery-result.json').exists())
      if fault=='second-db':self.assertEqual(calls,list(DATABASES[:2]));self.assertIn('retained-recovery-outcome-unknown',events)
      if fault in ('guard','replay','unbound-plan'):self.assertEqual(calls,[])
     else:
      result=h.recover_retained_databases(transport,adapter,journal,identity,reference,read_private)
      self.assertEqual(calls,list(DATABASES));self.assertTrue(result['writesHeld']);self.assertFalse(result['ready'])
      receipt=(real_path(tmp)/'production-recovery-result.json').read_bytes();self.assertEqual(hashlib.sha256(receipt).hexdigest(),result['receiptSha256']);self.assertEqual(events[-1],'retained-recovery-receipt-durable')
    self.assertFalse(any('resume' in event for event in events))

if __name__=='__main__':unittest.main()
