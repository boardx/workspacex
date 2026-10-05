import copy,hashlib,json,os,stat,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import current_held_epoch_evidence_producer as m
class HeldEpoch(unittest.TestCase):
 def setUp(self):
  self.store={};self.serial=0;self.large=[]
  self.p={'identity':{'sourceRevision':m.APP,'baselineRevision':m.BASE,'migrationPlanSha256':'a'*64,'attemptId':'fixture'},'toolRevision':'b'*40,'host':{'instanceId':m.ECS,'bootId':'12345678-1234-1234-1234-123456789012'},'epoch':'c'*64,'holdGeneration':'d'*32,'kind':'current-held-epoch-evidence-input'}
  self.p.update(before={k:self.ref('before-'+k,{'state':'held','allWritersDrained':True,'sample':1,'observedAt':1}) for k in ('held','drained')},after={k:self.ref('after-'+k,{'state':'held','allWritersDrained':True,'sample':2,'observedAt':2}) for k in ('held','drained')})
  self.p['databases']={db:{k:self.ref('database-'+k,{'database':db,'complete':True,'sourceRdsInstanceId':m.RDS,**({'artifact':{'path':'/private/'+db+'.cms','sha256':'e'*64,'bytes':10}} if k=='ciphertext' else {})}) for k in m.DB_FIELDS} for db in m.DATABASES}
  self.p['objects']={k:self.ref('objects-'+k,{'objectScopeSha256':'f'*64,'inventorySha256':'e'*64,'complete':True}) for k in ('inventory','version','recovery')}
  self.p['cleanup']={k:self.ref('cleanup-'+k,{k:True}) for k in ('ownedChildrenJoined','credentialCleanup')}
  target='pgm-isolated';self.p['isolation']={'targetInstanceId':target,'restoreFidelity':{db:self.ref('isolation-restore-fidelity',{'database':db,'targetInstanceId':target,'ciphertextSha256':'e'*64,'dataFidelityVerified':True,'readOnly':True,'rollbackComplete':True}) for db in m.DATABASES},'journeys':{k:self.ref('isolation-journey-'+k,{'targetInstanceId':target,k:True}) for k in m.JOURNEYS}}
 def ref(self,kind,facts,changes=None):
  self.serial+=1;value={**{k:self.p[k] for k in m.BIND_FIELDS},'kind':kind,'passed':True,'facts':facts}
  if changes:value.update(changes)
  raw=json.dumps(value).encode();path='/private/proof-'+str(self.serial);self.store[path]=raw;return {'path':path,'sha256':hashlib.sha256(raw).hexdigest()}
 def read(self,path,digest):
  raw=self.store[path]
  if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('HASH_DRIFT')
  return raw
 def run_it(self):return m.produce(self.p,self.read,lambda ref:self.large.append(ref))
 def test_success_ready_false_deterministic(self):
  a=self.run_it();self.assertEqual(a,self.run_it());self.assertFalse(a['ready']);self.assertFalse(a['qualified']);self.assertEqual(len(self.large),6)
 def test_online_backup_rejected(self):
  self.p['kind']='three-db-online-backup'
  with self.assertRaisesRegex(RuntimeError,'ONLINE_BACKUP'):self.run_it()
 def test_epoch_drift(self):
  self.p['after']['held']=self.ref('after-held',{'state':'held'},dict(epoch='e'*64))
  with self.assertRaisesRegex(RuntimeError,'PROOF_BINDING'):self.run_it()
 def test_database_missing(self):
  self.p['databases'].pop(m.DATABASES[0])
  with self.assertRaisesRegex(RuntimeError,'THREE_DATABASES'):self.run_it()
 def test_object_recovery_missing(self):
  self.p['objects'].pop('recovery')
  with self.assertRaisesRegex(RuntimeError,'OBJECT_COMPONENTS'):self.run_it()
 def test_object_inventory_drift(self):
  self.p['objects']['version']=self.ref('objects-version',{'objectScopeSha256':'f'*64,'inventorySha256':'a'*64,'complete':True})
  with self.assertRaisesRegex(RuntimeError,'INVENTORY_DRIFT'):self.run_it()
 def test_cleanup_not_joined(self):
  self.p['cleanup']['ownedChildrenJoined']=self.ref('cleanup-ownedChildrenJoined',{'ownedChildrenJoined':False})
  with self.assertRaisesRegex(RuntimeError,'CLEANUP_NOT'):self.run_it()
 def test_production_isolation_target(self):
  self.p['isolation']['targetInstanceId']=m.RDS
  with self.assertRaisesRegex(RuntimeError,'PRODUCTION_ISOLATION'):self.run_it()
 def test_missing_journey(self):
  self.p['isolation']['journeys'].pop('asr')
  with self.assertRaisesRegex(RuntimeError,'SIX_JOURNEYS'):self.run_it()
 def test_restore_ciphertext_drift(self):
  db=m.DATABASES[0];self.p['isolation']['restoreFidelity'][db]=self.ref('isolation-restore-fidelity',{'database':db,'targetInstanceId':'pgm-isolated','ciphertextSha256':'f'*64,'dataFidelityVerified':True,'readOnly':True,'rollbackComplete':True})
  with self.assertRaisesRegex(RuntimeError,'RESTORE_CIPHERTEXT'):self.run_it()
 def test_rawhash_drift(self):
  self.store[self.p['before']['held']['path']]+=b' '
  with self.assertRaisesRegex(ValueError,'HASH_DRIFT'):self.run_it()
 def test_tool_drift(self):
  self.p['after']['held']=self.ref('after-held',{'state':'held'},dict(toolRevision='f'*40))
  with self.assertRaisesRegex(RuntimeError,'PROOF_BINDING'):self.run_it()
 def test_output_exclusive_private_rawhash_fsync(self):
  value=self.run_it()
  with tempfile.TemporaryDirectory(dir='/tmp') as directory:
   path=Path(directory)/'collection.json';real=Path.lstat
   # Mapped system ancestors in local tests are owned by uid 65534; production
   # path policy continues to reject it. Mock that ancestor, not output/file.
   def safe_lstat(p):
    st=real(p)
    if str(p) in ('/tmp','/'):return type('S',(),{'st_mode':stat.S_IFDIR|0o755,'st_uid':os.geteuid()})()
    return st
   with patch.object(Path,'lstat',safe_lstat),patch.object(m.os,'fsync',wraps=m.os.fsync) as sync:
    ref=m.write_collection(str(path),value);self.assertEqual(sync.call_count,2)
    self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600);self.assertEqual(ref['sha256'],hashlib.sha256(path.read_bytes()).hexdigest())
    with self.assertRaises(FileExistsError):m.write_collection(str(path),value)
if __name__=='__main__':unittest.main()
