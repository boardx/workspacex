import copy,hashlib,importlib.util,json,os,pathlib,struct,tempfile,unittest
D=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('replay',D/'cn-maintenance-recovery-evidence-verifier.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
IDENTITY={'sourceRevision':'9'*40,'baselineRevision':'b'*40,'migrationPlanSha256':'c'*64,'attemptId':'local-fixture'}
class ReplayTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(dir=str(pathlib.Path(tempfile.gettempdir()).resolve()));self.root=pathlib.Path(self.tmp.name);self.root.chmod(0o700)
  self.evidence={'schemaVersion':1,'identity':IDENTITY,'toolRevision':'a'*40,'fidelityReceipts':{},'productionRecoveryAdapterSha256':'1'*64,'objectRecoveryEvidenceSha256':'2'*64}
  self.manifest={'schemaVersion':1,'identity':IDENTITY,'toolRevision':'a'*40,'sourceInstanceId':m.PRODUCTION,'targetInstanceId':'pgm-isolatedfixture','databases':{}}
  baseline={'baselineRevision':'b'*40,'sourceInstanceId':m.PRODUCTION,'snapshotId':'immutable-snapshot-fixture','databases':{}}
  self.sequence={'schema':'public','sequence':'fixture_seq','relkind':'S','type':'bigint','seqstart':'1','seqincrement':'1','seqmax':'9223372036854775807','seqmin':'1','seqcache':'1','seqcycle':False,'last_value':'2','is_called':True}
  self.hashes=sorted(hashlib.sha256(b'WSX-ROW-V1\0'+row).digest() for row in [b'(1)',b'(2)',b'(2)'])
  self.multi=hashlib.sha256(b'WSX-MULTISET-V1\0'+b''.join(self.hashes)+struct.pack('>Q',3)).hexdigest()
  for db in sorted(m.DATABASES):
   cipher=self.write(db+'.cms',b'fixture-CMS-ciphertext-not-real')
   backup={'database':db,'sourceRdsInstanceId':m.PRODUCTION,'dumpExit':0,'encryptionExit':0,'cleanupVerified':True,'ciphertextSha256':cipher['sha256'],'bytes':cipher['bytes'],'recipientCertificateSha256':'3'*64}
   table={'schema':'public','table':'fixture','columns':['id'],'columnTypes':['bigint'],'owner':'migration_owner','rls':False,'ddlSha256':'4'*64,'policySha256':'5'*64}
   catalog={'tables':[table],'sequences':[{'schema':'public','sequence':'fixture_seq'}],'aclObjects':[{'schema':'public','name':'fixture','kind':'table'},{'schema':'public','name':'fixture_seq','kind':'sequence'},{'schema':'public','name':'fixture_function()','kind':'function'}]}
   role={'name':'migration_owner','superuser':False,'inherit':True,'createRole':False,'createDb':False,'canLogin':False,'replication':False,'bypassRls':False,'connectionLimit':-1,'validUntil':None}
   roles={'roles':[role],'memberships':[],'databaseAcl':[],'objectAcl':[{'schema':'public','name':'fixture','kind':'table','owner':'migration_owner','acl':[]},{'schema':'public','name':'fixture_seq','kind':'sequence','owner':'migration_owner','acl':[]},{'schema':'public','name':'fixture_function()','kind':'function','owner':'migration_owner','acl':[]}]}
   version={'database':db,'instanceId':m.PRODUCTION,'serverVersionNum':160006,'clientVersionNum':160006}
   restore_version=dict(version,instanceId='pgm-isolatedfixture')
   refs={'backupReceipt':self.write_json(db+'.backup.json',backup),'ciphertext':cipher}
   for name,value in [('sourceCatalog',catalog),('restoredCatalog',catalog),('sourceRolesAcl',roles),('restoredRolesAcl',roles),('sourceSequences',[self.sequence]),('restoredSequences',[self.sequence]),('sourceVersion',version),('targetVersion',restore_version)]:refs[name]=self.write_json(db+'.'+name+'.json',value)
   execution={'identity':IDENTITY,'toolRevision':'a'*40,'database':db,'sourceInstanceId':m.PRODUCTION,'targetInstanceId':'pgm-isolatedfixture','ciphertextSha256':cipher['sha256'],'restoreExit':0,'decryptExit':0,'snapshotId':'immutable-snapshot-fixture','clientVersionNum':160006}
   refs['restoreExecution']=self.write_json(db+'.execution.json',execution)
   refs['tableRowHashStreams']=[{'schema':'public','table':'fixture','source':self.write(db+'.source.rows',b''.join(self.hashes)),'restored':self.write(db+'.restored.rows',b''.join(self.hashes))}]
   receipt={'schemaVersion':1,'database':db,'backupReceiptSha256':refs['backupReceipt']['sha256'],'ciphertextSha256':cipher['sha256'],'targetRdsInstanceId':'pgm-isolatedfixture','targetPeerAddressSha256':'6'*64,'tables':[{'schema':'public','table':'fixture','columns':['id'],'rows':3,'multisetSha256':self.multi}],'sequences':[self.sequence],'readOnly':True,'rollbackComplete':True,'dataFidelityVerified':True}
   refs['fidelityReceipt']=self.write_json(db+'.fidelity.json',receipt);self.evidence['fidelityReceipts'][db]=receipt
   self.manifest['databases'][db]=refs
   baseline['databases'][db]={k:copy.deepcopy(refs[k]) for k in ('backupReceipt','ciphertext','sourceCatalog','sourceRolesAcl','sourceSequences','sourceVersion')}
  self.manifest['baselineManifest']=self.write_json('baseline.json',baseline);self.manifest['evidenceSha256']=m.sha(m.canonical(self.evidence))
 def tearDown(self):self.tmp.cleanup()
 def write(self,name,raw):
  p=self.root/name;p.write_bytes(raw);p.chmod(0o600);return {'path':str(p),'sha256':m.sha(raw),'bytes':len(raw)}
 def write_json(self,name,value):return self.write(name,m.canonical(value))
 def reader(self):return m.ProtectedArtifacts(self.root,os.getuid(),os.getgid())
 def run_replay(self):return m.replay(self.evidence,self.manifest,self.reader())
 def mutate(self,key,change,db='workspacex'):
  refs=self.manifest['databases'][db];ref=refs[key];value=json.loads(pathlib.Path(ref['path']).read_bytes());change(value);refs[key]=self.write_json(pathlib.Path(ref['path']).name,value)
 def test_actual_file_comparison_not_receipt_flags(self):
  result=self.run_replay();self.assertEqual(result['rows'],9);self.assertEqual(result['tables'],3);self.assertEqual(result['sequences'],3);self.assertFalse(result['ready']);self.assertFalse(result['productionRecoveryVerified'])
  with self.assertRaisesRegex(m.Rejected,'PRODUCTION_RECOVERY_EXECUTOR_NOT_IMPLEMENTED'):m.admission_result(result)
 def test_missing_actual_artifact_rejects_even_with_passed_receipt(self):
  pathlib.Path(self.manifest['databases']['workspacex']['tableRowHashStreams'][0]['source']['path']).unlink()
  with self.assertRaisesRegex(m.Rejected,'ACTUAL_ARTIFACT_MISSING'):self.run_replay()
 def test_exact_original_evidence_bytes_not_just_equivalent_json(self):
  raw=json.dumps(self.evidence,indent=2).encode();self.manifest['evidenceSha256']=m.sha(raw)
  with self.assertRaisesRegex(m.Rejected,'EVIDENCE_RAW_BINDING'):self.run_replay()
  result=m.replay(self.evidence,self.manifest,self.reader(),evidence_raw=raw)
  self.assertFalse(result['ready'])
 def test_source_production_may_be_read_but_target_production_forbidden(self):
  self.manifest['targetInstanceId']=m.PRODUCTION
  with self.assertRaisesRegex(m.Rejected,'PRODUCTION_TARGET_FORBIDDEN'):self.run_replay()
 def test_exact_baseline_and_artifact_pin_required(self):
  baseline=json.loads(pathlib.Path(self.manifest['baselineManifest']['path']).read_bytes());baseline['baselineRevision']='0'*40
  self.manifest['baselineManifest']=self.write_json('baseline.json',baseline)
  with self.assertRaisesRegex(m.Rejected,'EXACT_BASELINE_CLOSURE'):self.run_replay()
 def test_three_db_full_closure(self):
  self.manifest['databases'].pop('workspacex_agent')
  with self.assertRaisesRegex(m.Rejected,'THREE_DATABASE_CLOSURE'):self.run_replay()
 def test_ciphertext_bytes_must_match_actual_hash(self):
  ref=self.manifest['databases']['workspacex']['ciphertext'];pathlib.Path(ref['path']).write_bytes(b'x'*ref['bytes'])
  with self.assertRaisesRegex(m.Rejected,'ARTIFACT_HASH_OR_IDENTITY'):self.run_replay()
 def test_data_changed_with_updated_artifact_hash_not_hidden_by_receipt(self):
  streams=self.manifest['databases']['workspacex']['tableRowHashStreams'][0]
  streams['restored']=self.write('workspacex.restored.rows',b''.join(self.hashes[:2]))
  with self.assertRaisesRegex(m.Rejected,'ACTUAL_TABLE_DATA_MISMATCH'):self.run_replay()
 def test_sequence_values_and_is_called_definition(self):
  for field,value in [('last_value','3'),('is_called',False),('seqincrement','2')]:
   with self.subTest(field=field):
    self.mutate('restoredSequences',lambda rows:rows[0].update({field:value}))
    with self.assertRaisesRegex(m.Rejected,'SEQUENCE_BASELINE_MISMATCH'):self.run_replay()
    self.manifest['databases']['workspacex']['restoredSequences']=self.write_json('workspacex.restoredSequences.json',[self.sequence])
 def test_role_and_acl_membership_restore_mismatch(self):
  self.mutate('restoredRolesAcl',lambda roles:roles['memberships'].append({'role':'migration_owner','member':'app_rw','adminOption':True}))
  with self.assertRaisesRegex(m.Rejected,'ROLE_ACL_BASELINE_MISMATCH'):self.run_replay()
 def test_function_acl_cannot_be_dropped_from_complete_catalog(self):
  db='workspacex';refs=self.manifest['databases'][db]
  source=json.loads(pathlib.Path(refs['sourceRolesAcl']['path']).read_bytes());source['objectAcl']=[item for item in source['objectAcl'] if item['kind']!='function']
  for key in ['sourceRolesAcl','restoredRolesAcl']:refs[key]=self.write_json(db+'.'+key+'.json',source)
  baseline=json.loads(pathlib.Path(self.manifest['baselineManifest']['path']).read_bytes());baseline['databases'][db]['sourceRolesAcl']=refs['sourceRolesAcl'];self.manifest['baselineManifest']=self.write_json('baseline.json',baseline)
  with self.assertRaisesRegex(m.Rejected,'OBJECT_ACL_CLOSURE'):self.run_replay()
 def test_catalog_columns_or_extra_tables_not_subset(self):
  self.mutate('restoredCatalog',lambda c:c['tables'][0]['columns'].append('extra'))
  with self.assertRaisesRegex(m.Rejected,'RESTORED_CATALOG_MISMATCH'):self.run_replay()
 def test_table_stream_cannot_be_omitted(self):
  self.manifest['databases']['workspacex']['tableRowHashStreams']=[]
  with self.assertRaisesRegex(m.Rejected,'FULL_TABLE_STREAM_CLOSURE'):self.run_replay()
 def test_incompatible_actual_client_version(self):
  self.mutate('targetVersion',lambda v:v.update(clientVersionNum=150010))
  with self.assertRaisesRegex(m.Rejected,'POSTGRES_VERSION_COMPATIBILITY'):self.run_replay()
 def test_multiset_hash_matches_existing_live_engine_framing(self):
  actual=m.multiset(self.reader(),self.write('direct.rows',b''.join(self.hashes)))
  self.assertEqual(actual,{'rows':3,'multisetSha256':self.multi})
  for raw,code in [(b'not-32-byte-digests','ROW_HASH_STREAM_TRUNCATED'),(b''.join(reversed(self.hashes)),'ROW_HASH_STREAM_UNSORTED')]:
   with self.subTest(code=code),self.assertRaisesRegex(m.Rejected,code):m.multiset(self.reader(),self.write('bad.rows',raw))
 def test_same_bytes_replacement_inode_rejected_on_finish(self):
  reader=self.reader();ref=self.write_json('proof.json',{'actual':'fixture'});reader.json(ref)
  p=pathlib.Path(ref['path']);q=self.root/'replacement';q.write_bytes(p.read_bytes());q.chmod(0o600);os.replace(q,p)
  with self.assertRaisesRegex(m.Rejected,'ARTIFACT_CHANGED_AFTER_REPLAY'):reader.finish()
 def test_symlink_and_path_escape_reject(self):
  ref=self.write_json('protected.json',{'fixture':1});p=pathlib.Path(ref['path']);p.unlink();p.symlink_to('/etc/hosts')
  with self.assertRaisesRegex(m.Rejected,'ARTIFACT_FILE_TRUST'):self.reader().json(ref)
  ref['path']='/etc/hosts'
  with self.assertRaisesRegex(m.Rejected,'ARTIFACT_PATH_SCOPE'):self.reader().json(ref)
 def test_receipt_boolean_is_not_evidence_schema(self):
  with self.assertRaisesRegex(m.Rejected,'RECOVERY_EVIDENCE_SCHEMA'):m.replay({'accepted':True},self.manifest,self.reader())
 def test_attempt_sidecar_is_bound_separately_from_static_tool_profile(self):
  ref=self.write_json('recovery-artifacts.json',self.manifest)
  self.write_json('recovery-binding.json',{'schemaVersion':1,'identity':IDENTITY,'toolRevision':'a'*40,'artifactManifest':ref})
  self.assertEqual(m.attempt_manifest(self.reader(),self.root,IDENTITY,'a'*40),self.manifest)
 def test_attempt_sidecar_identity_drift_rejected(self):
  ref=self.write_json('recovery-artifacts.json',self.manifest)
  self.write_json('recovery-binding.json',{'schemaVersion':1,'identity':dict(IDENTITY,attemptId='other'),'toolRevision':'a'*40,'artifactManifest':ref})
  with self.assertRaisesRegex(m.Rejected,'ATTEMPT_BINDING_IDENTITY'):m.attempt_manifest(self.reader(),self.root,IDENTITY,'a'*40)
 def test_attempt_sidecar_cannot_retarget_manifest(self):
  ref=self.write_json('other.json',self.manifest)
  self.write_json('recovery-binding.json',{'schemaVersion':1,'identity':IDENTITY,'toolRevision':'a'*40,'artifactManifest':ref})
  with self.assertRaisesRegex(m.Rejected,'ARTIFACT_MANIFEST_MISSING'):m.attempt_manifest(self.reader(),self.root,IDENTITY,'a'*40)
 def test_prehold_comparison_cannot_claim_common_snapshot(self):
  with self.assertRaisesRegex(m.Rejected,'PREHOLD_COMMON_SNAPSHOT_PROOF_UNVERIFIED'):m.prehold_artifact_replay(self.evidence,self.manifest,self.reader())
 def test_prehold_still_checks_artifacts_before_proof_gate(self):
  pathlib.Path(self.manifest['databases']['workspacex']['ciphertext']['path']).unlink()
  with self.assertRaisesRegex(m.Rejected,'ACTUAL_ARTIFACT_MISSING'):m.prehold_artifact_replay(self.evidence,self.manifest,self.reader())
 def test_prehold_declaration_cannot_replace_snapshot_proof(self):
  self.manifest['commonSnapshotVerified']=True
  with self.assertRaisesRegex(m.Rejected,'PREHOLD_COMMON_SNAPSHOT_PROOF_UNVERIFIED'):m.prehold_artifact_replay(self.evidence,self.manifest,self.reader())
 def test_prehold_cli_dispatch_never_imports_hold_or_executor(self):
  from unittest.mock import patch
  import sys
  with patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'getegid',return_value=0),patch.object(m.sys,'argv',['verifier','--prehold-artifact-audit','fixed-path']),patch.object(m,'prehold_main',side_effect=m.Rejected('PREHOLD_COMMON_SNAPSHOT_PROOF_UNVERIFIED')) as entry,patch.dict(sys.modules,{'cn_maintenance_hold':None,'cn_production_recovery_executor':None}):
   with self.assertRaisesRegex(m.Rejected,'PREHOLD_COMMON_SNAPSHOT_PROOF_UNVERIFIED'):m.main()
   entry.assert_called_once_with('fixed-path')
if __name__=='__main__':unittest.main()
