import copy,hashlib,json,subprocess,sys,unittest
from pathlib import Path
from isolated_conservation_evidence_producer import produce,FIXED_APP,FIXED_BASE,FIXED_RELEASE
from isolated_rehearsal import STAGES
from isolated_conservation_plan import DBS

class CollectionTests(unittest.TestCase):
 def setUp(self):
  self.bytes={};self.counter=0
  b={'accountId':'1177216024653153','regionId':'cn-shanghai','attemptId':'12345678-1234-1234-1234-123456789012','candidateSha':FIXED_APP,'sourceInstanceId':'pgm-uf6rg214cp381l49','targetInstanceId':'pgm-isolated','host':'pgm-isolated.rwlb.rds.aliyuncs.com','peer':'192.168.1.2','peerSha256':hashlib.sha256(b'192.168.1.2').hexdigest(),'providerCreatedUtc':'2026-10-04T00:00:00Z','providerDescription':'wsx-cn-isolated-12345678-1234-1234-1234-123456789012'}
  b['tls']={'sslmode':'disable','approvedException':'aliyun-postgresql-serverless-no-tls','providerSslEvidence':{'targetInstanceId':b['targetInstanceId'],'sslEnabled':False,'providerCreatedUtc':b['providerCreatedUtc']}}
  self.authority={'sourceRevision':FIXED_APP,'baselineRevision':FIXED_BASE,'migrationPlanSha256':'a'*64,'attemptId':'parent-release'};self.child_authority={k:b[k] for k in ('candidateSha','attemptId','targetInstanceId')}
  self.payload={'binding':b,'baselineSha':FIXED_BASE,'release':FIXED_RELEASE,'stageReceipts':{}}
  self.outers={}
  for stage in STAGES:
   out={'accepted':True,**{k:b[k] for k in ('targetInstanceId','attemptId','candidateSha')}}
   if stage in ('restore','before','after','snapshot','recovery-verify'):out['databases']=list(DBS)
   if stage in ('restore','before','after','canonical-setup'):
    proofs={}
    for name in (['canonical'] if stage=='canonical-setup' else DBS):
     if stage=='restore':p=self.fidelity(name)
     else:
      p={**out,'readOnly':True,'rollbackComplete':True,'mode':stage,'database':name,'allBaselineTablesTransformationCovered':True}
      if stage=='canonical-setup':p.update(allCanonicalSetupsAccepted=True,memoryPreparedTwice=True,checkpointSetupTwice=True,force=False,seed=False,connectionPeerIdentityChecks=4)
     proofs[name]=self.ref(p)
    out['baselineProofRefs' if stage=='restore' else 'proofRefs']=proofs
   if stage in ('snapshot','recovery-verify'):
    out.update(ownedCleanupVerified=True,plaintextArchiveCreated=False,snapshots={db:self.fidelity(db) for db in DBS})
   self.outers[stage]=out;self.payload['stageReceipts'][stage]=self.ref(out)
 def fidelity(self,db):
  b=self.payload['binding']
  return {'database':db,'targetRdsInstanceId':b['targetInstanceId'],'targetPeerAddressSha256':b['peerSha256'],'dataFidelityVerified':True,'readOnly':True,'rollbackComplete':True,'backupReceiptSha256':'a'*64,'ciphertextSha256':'b'*64}
 def ref(self,obj):
  self.counter+=1;raw=json.dumps(obj).encode();path='/private/fixture-'+str(self.counter);self.bytes[path]=raw
  return {'path':path,'sha256':hashlib.sha256(raw).hexdigest()}
 def reader(self,path,digest):
  raw=self.bytes[path]
  if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('INPUT_HASH_DRIFT')
  return raw
 def run_it(self):return produce(self.payload,self.reader,expected_identity=self.authority,expected_isolation_binding=self.child_authority,expected_release=FIXED_RELEASE)
 def mutate(self,stage,change):
  out=copy.deepcopy(self.outers[stage]);change(out);self.payload['stageReceipts'][stage]=self.ref(out)
 def test_complete_collection_is_deterministic_but_not_admission(self):
  result=self.run_it();self.assertEqual(result,self.run_it());self.assertTrue(result['collectionVerified'])
  for key in ('qualified','prepared','fullReady'):self.assertFalse(result[key])
 def test_missing_stage_rejects(self):
  del self.payload['stageReceipts']['before']
  with self.assertRaisesRegex(ValueError,'COMPLETE_STAGE'):self.run_it()
 def test_source_drift(self):
  self.payload['binding']['candidateSha']='c'*40
  with self.assertRaisesRegex(ValueError,'FIXED_RELEASE'):self.run_it()
 def test_bytes_drift(self):
  self.bytes[self.payload['stageReceipts']['restore']['path']]+=b' '
  with self.assertRaisesRegex(ValueError,'INPUT_HASH_DRIFT'):self.run_it()
 def test_cross_attempt(self):
  self.mutate('migrate',lambda out:out.update(attemptId='other'))
  with self.assertRaisesRegex(ValueError,'STAGE_RECEIPT'):self.run_it()
 def test_missing_database(self):
  self.mutate('restore',lambda out:out['baselineProofRefs'].pop(DBS[-1]))
  with self.assertRaisesRegex(ValueError,'NESTED_PROOF'):self.run_it()
 def test_recovery_fidelity_required(self):
  self.mutate('recovery-verify',lambda out:out['snapshots'][DBS[0]].update(rollbackComplete=False))
  with self.assertRaisesRegex(ValueError,'FIDELITY_REQUIRED'):self.run_it()
 def test_recovery_must_match_snapshot(self):
  self.mutate('recovery-verify',lambda out:out['snapshots'][DBS[0]].update(ciphertextSha256='c'*64))
  with self.assertRaisesRegex(ValueError,'RECOVERY_SNAPSHOT'):self.run_it()
 def test_secret_rejected(self):
  self.mutate('migrate',lambda out:out.update(password='test-only-never-print'))
  with self.assertRaisesRegex(ValueError,'SECRET_BEARING'):self.run_it()
 def test_unapproved_tls_exception(self):
  self.payload['binding']['tls']['providerSslEvidence']['targetInstanceId']='pgm-other'
  with self.assertRaisesRegex(ValueError,'TLS_EVIDENCE'):self.run_it()
 def test_cli_failure_is_redacted_and_nonzero(self):
  result=subprocess.run([sys.executable,str(Path(__file__).with_name('isolated_conservation_evidence_producer.py'))],input=b'{"password":"test-only-never-print-this"}',capture_output=True)
  self.assertEqual(result.returncode,1);self.assertEqual(result.stdout,b'')
  self.assertEqual(result.stderr,b'ISOLATED_EVIDENCE_COLLECTION_REJECTED\n')
 def test_production_target(self):
  self.payload['binding']['targetInstanceId']=self.payload['binding']['sourceInstanceId']
  with self.assertRaisesRegex(ValueError,'PRODUCTION_TARGET'):self.run_it()

 def test_a1cb_approved_parent_and_independent_child_uuid_succeed(self):
  app='a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0';self.authority['sourceRevision']=app;self.child_authority['candidateSha']=app;self.payload['binding']['candidateSha']=app
  for path,raw in list(self.bytes.items()):
   value=json.loads(raw)
   if value.get('candidateSha')==FIXED_APP:
    value['candidateSha']=app;self.bytes[path]=json.dumps(value).encode()
  for outer in self.outers.values():
   outer['candidateSha']=app
   for key in ('baselineProofRefs','proofRefs'):
    for ref in outer.get(key,{}).values():ref['sha256']=hashlib.sha256(self.bytes[ref['path']]).hexdigest()
  for stage,outer in self.outers.items():self.payload['stageReceipts'][stage]=self.ref(outer)
  result=self.run_it();self.assertEqual(result['parentIdentity'],self.authority);self.assertEqual(result['attemptId'],self.child_authority['attemptId']);self.assertNotEqual(result['attemptId'],self.authority['attemptId'])
 def test_independent_child_parent_baseline_and_release_cannot_self_authorize(self):
  for kind in ('child','parent','baseline','release'):
   with self.subTest(kind=kind):
    self.setUp()
    if kind=='child':self.payload['binding']['attemptId']='22345678-1234-1234-1234-123456789012'
    if kind=='parent':self.authority['sourceRevision']='f'*40
    if kind=='baseline':self.authority['baselineRevision']='f'*40;self.payload['baselineSha']='f'*40
    if kind=='release':self.payload['release']='self-approved'
    with self.assertRaises(ValueError):self.run_it()

if __name__=='__main__':unittest.main()
