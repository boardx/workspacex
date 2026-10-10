import contextlib,copy,hashlib,importlib.util,io,json,os,pathlib,shutil,subprocess,sys,tempfile,unittest
from unittest.mock import patch
# Trusted disposable fixture preload; production has no sibling module fallback.
verifier=pathlib.Path(__file__).parent/'cn-maintenance-recovery-evidence-verifier.py'
spec=importlib.util.spec_from_file_location('epoch_recovery',verifier)
module=importlib.util.module_from_spec(spec);sys.modules['epoch_recovery']=module;spec.loader.exec_module(module)
import current_epoch_qualification as q
NODE_BINARY=pathlib.Path(shutil.which('node')).resolve()  # disposable fixture bytes only; production never uses PATH
import cn_maintenance_recovery_evidence_verifier_test as rf
import test_isolated_conservation_evidence_producer as isolation_fixture
from test_cn_backup_sql import facts
import test_current_held_epoch_evidence_producer as held_fixture
class QualificationTests(unittest.TestCase):
 def setUp(self):
  identity={'sourceRevision':q.APP,'baselineRevision':q.BASE,'migrationPlanSha256':'c'*64,'attemptId':'local-fixture'}
  self.r=rf.ReplayTests('test_actual_file_comparison_not_receipt_flags')
  with patch.object(rf,'IDENTITY',identity):self.r.setUp()
  self.root=self.r.root;self.n=0
  self.b={'identity':identity,'toolRevision':'a'*40,'host':{'instanceId':q.ECS,'bootId':'11111111-1111-4111-8111-111111111111'},'epoch':'e'*64,'holdGeneration':'d'*32,'targetInstanceId':'pgm-isolatedfixture','providerBindingSha256':'f'*64}
  baseline=json.loads(pathlib.Path(self.r.manifest['baselineManifest']['path']).read_bytes());baseline['snapshotId']=self.b['epoch'];baseline['baselineRevision']=q.BASE;self.r.manifest['baselineManifest']=self.put(baseline)
  for db,refs in self.r.manifest['databases'].items():
   e=json.loads(pathlib.Path(refs['restoreExecution']['path']).read_bytes());e['snapshotId']=self.b['epoch'];refs['restoreExecution']=self.put(e)
  self.policy={'schemaVersion':2,'kind':'source-approved-epoch-policy','binding':self.b,'sources':{},'producers':{},'invocations':{}}
  for name in q.SOURCES:self.policy['sources']['.harness/scripts/vm/'+name]=self.raw((q.D/name).read_bytes())
  src=self.policy['sources']['.harness/scripts/vm/current_epoch_qualification.py'];exe=self.raw(b'local mocked immutable runtime')
  self.policy['producers']['owned-supervisor']={'source':src,'executable':exe,'imageId':q.IMAGE,'namespaces':{'pid':'123','mnt':'124','net':'125'}}
  self.p={'schemaVersion':2,'kind':'current-held-epoch-qualification','binding':self.b,'sourcePolicy':None,'collection':self.put({'kind':'current-held-epoch-evidence-collection','qualified':False,'ready':False,**{k:self.b[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')},'sourceRdsInstanceId':q.RDS,'isolatedTargetInstanceId':self.b['targetInstanceId']}),'recoveryEvidence':self.put(self.r.evidence),'recoveryManifest':None,'before':None,'after':None,'permissions':{},'dumpLanes':{},'objects':{},'isolation':None,'journeys':{},'outputRoot':str(self.root/'output')}
  self.r.manifest['evidenceSha256']=self.p['recoveryEvidence']['sha256'];self.p['recoveryManifest']=self.actual('recovery-manifest',self.r.manifest)
  self.policy['invocations']['recovery-evidence']=self.put({**json.loads(pathlib.Path(self.policy['invocations']['recovery-manifest']['path']).read_bytes()),'kind':'recovery-evidence','output':self.p['recoveryEvidence'],'inputs':[]})
  for phase,t in [('before',100),('after',200)]:self.p[phase]=self.actual(phase+'-held-drained',{'binding':self.b,'state':'held','writerSessions':[],'writerContainers':[],'automationAdmitted':[],'holdGeneration':self.b['holdGeneration'],'observedAt':t},t,t)
  for db in q.DBS:
   f,_,scope=facts(db)
   for item in scope.values():
    for table in item['tables']:table['name']='fixture'
    for seq in item['sequences']:seq['name']='fixture_seq'
   f['effectiveRelations'][0]['name']='fixture';f['effectiveSequences'][0]['name']='fixture_seq'
   from cn_backup_sql import expected_grants
   f['explicitGrants']=[{'kind':k,'schema':s,'name':n,'privilege':v,'grantable':False,'grantor':'admin'} for k,s,n,v in expected_grants(scope)]
   self.p['permissions'][db]=self.actual('permissions:'+db,{'facts':f,'scope':scope})
   refs=self.r.manifest['databases'][db]
   self.p['dumpLanes'][db]=self.actual('dump:'+db,{'binding':self.b,'database':db,'role':q.ROLE,'backendProof':self.backend(db,exe),'imageId':q.IMAGE,'backendPid':400,'backendStart':'2026-10-04T00:00:00Z','exeSha256':exe['sha256'],'ciphertext':refs['ciphertext'],'backupReceipt':refs['backupReceipt'],'snapshotId':self.b['epoch'],'sourceRdsInstanceId':q.RDS})
  self.p['heldJournal']=self.actual('held-interval-journal',{'binding':self.b,'events':[{'observedAt':t,'holdGeneration':self.b['holdGeneration'],'state':'held','writerSessions':[],'writerContainers':[],'automationAdmitted':[]} for t in (100,150,200)]})
  content=self.raw(b'actual restored object bytes');objects=[{'bucket':'bucket','key':'k','versionId':'v1','bytes':content['bytes'],'sha256':content['sha256'],'content':content}]
  for side in ('before','after','restored'):self.p['objects'][side]=self.actual('objects:'+side,{'binding':self.b,'scopeSha256':'1'*64,'objects':objects,'sourceFactsSha256':q.sha(q.canonical(objects))})
  iso=isolation_fixture.CollectionTests('test_complete_collection_is_deterministic_but_not_admission');iso.setUp();iso.payload['binding']['targetInstanceId']=self.b['targetInstanceId'];iso.payload['binding']['host']=self.b['targetInstanceId']+'.rwlb.rds.aliyuncs.com';iso.payload['binding']['tls']['providerSslEvidence']['targetInstanceId']=self.b['targetInstanceId']
  def convert(v):
   if type(v) is dict:
    if set(v)=={'path','sha256'} and v['path'] in iso.bytes:return {k:x for k,x in self.put(convert(json.loads(iso.bytes[v['path']]))).items() if k!='bytes'}
    return {k:(self.b['targetInstanceId'] if k in ('targetInstanceId','targetRdsInstanceId') else convert(x)) for k,x in v.items()}
   if type(v) is list:return [convert(x) for x in v]
   return v
  for stage in q.STAGES:
   outer=convert(iso.outers[stage]);outer['stage']=stage;iso.payload['stageReceipts'][stage]={k:v for k,v in self.actual('stage:'+stage,outer).items() if k!='bytes'}
  self.p['isolation']=iso.payload
  bodies={'login':{'subject':'local-user','sessionSha256':'a'*64},'hello':{'message':'hello','subject':'local-user'},'asr':{'transcript':'hello','audioSha256':'b'*64},'githubFeedbackRead':{'method':'GET','items':[]},'skillTool':{'toolName':'skill','invocationId':'local-id','result':{'ok':'value'}},'pdfDownload':b'%PDF-1.7\nmock bytes'}
  for name,body in bodies.items():
   r=self.raw(body if type(body) is bytes else q.canonical(body));self.p['journeys'][name]=self.actual('journey:'+name,{'binding':self.b,'request':{'targetInstanceId':self.b['targetInstanceId'],'candidateSha':q.APP},'response':{'status':200,'bodySha256':r['sha256']},'body':r})
  held=held_fixture.HeldEpoch('test_success_ready_false_deterministic');held.setUp()
  def rebind(v):
   if type(v) is dict:
    if set(v)=={'path','sha256'} and v['path'] in held.store:
     proof=json.loads(held.store[v['path']]);proof.update({k:self.b[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')})
     facts=proof['facts'];db=facts.get('database')
     if 'artifact' in facts:facts['artifact']=self.r.manifest['databases'][db]['ciphertext']
     if 'targetInstanceId' in facts:facts['targetInstanceId']=self.b['targetInstanceId']
     if 'ciphertextSha256' in facts:facts['ciphertextSha256']=self.r.manifest['databases'][db]['ciphertext']['sha256']
     return {k:x for k,x in self.put(proof).items() if k!='bytes'}
    return {k:rebind(x) for k,x in v.items()}
   if type(v) is list:return [rebind(x) for x in v]
   return v
  ci=rebind(held.p);ci.update({k:self.b[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')});ci['isolation']['targetInstanceId']=self.b['targetInstanceId'];self.p['collectionInput']=self.put(ci)
  protected=self.r.reader()
  def raw_reader(path,h):return b''.join(protected.blocks(protected.reference(path)))
  co=q.collect_epoch(ci,reader=raw_reader,large_reader=lambda r:list(protected.blocks(r)),expected_identity=self.b['identity'])
  self.p['collection']=self.actual('collection',co)
  (self.root/'output').mkdir(mode=0o700);self.seal()
 def backend(self,db,exe):
  fact={'identity':self.b['identity'],'database':db,'session':{'pid':400,'backendStart':'2026-10-04T00:00:00Z','role':q.ROLE},'applicationName':'wsx-backup-'+self.b['identity']['attemptId']+'-'+db,'processPid':500,'processStart':'12345','containerId':'1'*64}
  return self.actual('backend:'+db,{'kind':'live-owned-pgdump-backend','identity':self.b['identity'],'observedAt':115,'facts':fact,'evidenceSha256':q.sha(q.canonical(fact)),'readOnlyEvidence':{'kind':'pinned-pgdump16-implementation-attestation','sqlObserved':False,'imageId':q.IMAGE,'exeSha256':exe['sha256'],'contract':'pg_dump serializable-deferrable read-only snapshot; precheck PID excluded'}})
 def tearDown(self):
  if hasattr(self,'code_tmp'):self.code_tmp.cleanup()
  self.r.tearDown()
 def raw(self,raw):
  self.n+=1;return self.r.write('qualification-'+str(self.n),raw)
 def put(self,v):return self.raw(q.canonical(v))
 def nested(self,value):
  refs=[]
  def walk(v):
   if type(v) is dict:
    if {'path','sha256'}<=set(v) and set(v)<={'path','sha256','bytes'}:
     r=self.r.reader().reference(v['path']);refs.append(r)
    else:
     for x in v.values():walk(x)
   elif type(v) is list:
    for x in v:walk(x)
  walk(value);return refs
 def actual(self,kind,value,start=110,end=120):
  r=self.put(value);producer=self.policy['producers']['owned-supervisor'];inv={'schemaVersion':2,'kind':kind,'binding':self.b,'producerId':'owned-supervisor','source':producer['source'],'executable':producer['executable'],'pid':500,'processStart':'12345','startedAt':start,'endedAt':end,'namespaces':producer['namespaces'],'providerBindingSha256':self.b['providerBindingSha256'],'inputs':self.nested(value),'output':r,'exitCode':0,'ownedChildrenJoined':True};self.policy['invocations'][kind]=self.put(inv);return r
 def seal(self):self.p['sourcePolicy']=self.put(self.policy)
 def run_it(self):return self._execute(q.qualify)
 def verify_it(self):return self._execute(q.verify_existing_qualification)
 def _execute(self,consumer):
  # Simulate only ambient ancestors above the disposable fixture root;
  # all artifact modes, hashes, O_EXCL and fsync remain actual filesystem calls.
  original=pathlib.Path.lstat
  def local_lstat(path):
   value=original(path)
   if path in self.root.parents:
    fields=list(value);fields[0]&=~0o022;fields[4:6]=[os.geteuid(),os.getegid()];return os.stat_result(fields)
   return value
  with patch.object(pathlib.Path,'lstat',local_lstat):return consumer(self.p,self.r.reader(),self.p['sourcePolicy'],expected_identity=self.b['identity'],expected_release=isolation_fixture.FIXED_RELEASE,code_authority=getattr(self,'code_authority',None))
 def change(self,key,edit):
  inv=json.loads(pathlib.Path(self.policy['invocations'][key]['path']).read_bytes());value=json.loads(pathlib.Path(inv['output']['path']).read_bytes());edit(value);r=self.put(value);inv['output']=r;inv['inputs']=self.nested(value);self.policy['invocations'][key]=self.put(inv);self.seal();return r
 def test_complete_mock_actual_bytes_qualify_and_persist_private_exact_manifest(self):
  e=self.run_it();self.assertEqual(e['kind'],'held-current-epoch-evidence');raw=pathlib.Path(e['epoch']['path']).read_bytes();self.assertEqual(q.sha(raw),e['epoch']['sha256']);m=json.loads(raw);self.assertEqual(m,{k:v for k,v in e.items() if k!='epoch'}|{'kind':'held-current-epoch-manifest'});self.assertEqual(os.stat(e['epoch']['path']).st_mode&0o777,0o600)
  with self.assertRaises(FileExistsError):self.run_it()
 def test_existing_qualification_revalidates_actual_outputs_without_any_write(self):
  expected=self.run_it();before={p.name:(p.read_bytes(),p.stat().st_ino,p.stat().st_mtime_ns) for p in (self.root/'output').iterdir()}
  with patch.object(q,'write_collection',side_effect=AssertionError('NO_WRITES_ALLOWED')),patch.object(q.os,'replace',side_effect=AssertionError('NO_RENAME_ALLOWED')):
   self.assertEqual(self.verify_it(),expected)
  after={p.name:(p.read_bytes(),p.stat().st_ino,p.stat().st_mtime_ns) for p in (self.root/'output').iterdir()};self.assertEqual(before,after)
  with self.assertRaises(FileExistsError):self.run_it()
 def test_existing_aggregate_rawhash_drift_rejects(self):
  self.run_it();path=self.root/'output'/'workspacex.json';path.write_bytes(path.read_bytes()+b' ')
  with self.assertRaisesRegex((q.recovery.Rejected,rf.m.Rejected),'ARTIFACT_(HASH|LENGTH|BYTE_BOUND)'):self.verify_it()
 def test_existing_epoch_rawhash_drift_rejects(self):
  self.run_it();path=self.root/'output'/'epoch.json';path.write_bytes(path.read_bytes().replace(b'held-current-epoch-manifest',b'held-current-epoch-changed!'))
  with self.assertRaisesRegex((q.recovery.Rejected,rf.m.Rejected),'ARTIFACT_(HASH|LENGTH|BYTE_BOUND)'):self.verify_it()
 def test_existing_source_policy_rawhash_drift_rejects(self):
  self.run_it();path=pathlib.Path(self.p['sourcePolicy']['path']);path.write_bytes(path.read_bytes()+b' ')
  with self.assertRaisesRegex((q.recovery.Rejected,rf.m.Rejected),'ARTIFACT_(HASH|LENGTH|BYTE_BOUND)'):self.verify_it()
 def test_existing_input_actual_bytes_drift_rejects(self):
  self.run_it();path=pathlib.Path(self.p['collectionInput']['path']);path.write_bytes(path.read_bytes()+b' ')
  with self.assertRaisesRegex((q.recovery.Rejected,rf.m.Rejected),'ARTIFACT_(HASH|LENGTH|BYTE_BOUND)'):self.verify_it()
 def test_existing_changed_input_cannot_authorize_original_outputs(self):
  self.run_it();self.p['heldJournal']=self.change('held-interval-journal',lambda x:x['events'][1].update(state='cleared'))
  with self.assertRaisesRegex(ValueError,'INTERVAL_REOPENED'):self.verify_it()
 def test_existing_missing_object_output_does_not_recreate(self):
  self.run_it();path=self.root/'output'/'objects.json';path.unlink()
  with self.assertRaisesRegex((q.recovery.Rejected,rf.m.Rejected),'ACTUAL_ARTIFACT_MISSING'):self.verify_it()
  self.assertFalse(path.exists())
 def install_fixture_code(self):
  self.code_tmp=tempfile.TemporaryDirectory();root=pathlib.Path(self.code_tmp.name);root.chmod(0o700);(root/'sources').mkdir(mode=0o700)
  pins={};mapping={}
  for source,old in list(self.policy['sources'].items()):
   filename=source.removeprefix('.harness/scripts/vm/');path=root/'sources'/filename;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(pathlib.Path(old['path']).read_bytes());path.chmod(0o700)
   ref={'path':str(path),'sha256':old['sha256']};pins[source]=ref;mapping[old['path']]=ref;self.policy['sources'][source]=ref
  executable=root/'python3';executable.write_bytes(pathlib.Path(sys.executable).read_bytes());executable.chmod(0o755);exe={'path':str(executable),'sha256':q.sha(executable.read_bytes())}
  for producer in self.policy['producers'].values():producer['source']=mapping[producer['source']['path']];producer['executable']=exe
  for kind,ref in list(self.policy['invocations'].items()):
   inv=json.loads(pathlib.Path(ref['path']).read_bytes());inv['source']=mapping[inv['source']['path']];inv['executable']=exe;inv['inputs']=[mapping.get(r['path'],r) for r in inv['inputs']]+list(pins.values());self.policy['invocations'][kind]=self.put(inv)
  self.seal();self.code_authority=q.QualificationCodeAuthority(pins,{exe['path']:exe['sha256']},uid=os.geteuid(),gid=os.getegid(),fixture_root=root)
  return root,pins,exe
 def test_installed_code_and_actual_runtime_refs_outside_evidence_scope_qualify(self):
  root,pins,exe=self.install_fixture_code();expected=self.run_it();self.assertEqual(self.verify_it(),expected);self.assertTrue(str(root) not in str(self.root));self.assertEqual(len(self.code_authority.snapshots),len(pins)+1)
 def test_unapproved_code_hash_stays_private_scope_rejected(self):
  root,pins,exe=self.install_fixture_code();self.policy['sources']['.harness/scripts/vm/cn_backup_sql.py']={**pins['.harness/scripts/vm/cn_backup_sql.py'],'sha256':'f'*64};self.seal()
  with self.assertRaises((ValueError,q.recovery.Rejected,rf.m.Rejected)):self.run_it()
 def test_actual_closed_fd_bundle_qualifies_and_revalidates_without_sys_path(self):
  root,pins,exe=self.install_fixture_code();names={'epoch_recovery':'cn-maintenance-recovery-evidence-verifier.py',**{name[:-3]:name for name in q.SOURCES if name not in ('current_epoch_qualification.py','cn-maintenance-recovery-evidence-verifier.py')}}
  fds=[]
  try:
   entry=os.open(pins['.harness/scripts/vm/current_epoch_qualification.py']['path'],os.O_RDONLY|os.O_NOFOLLOW);fds.append(entry)
   module_map={}
   for name,filename in names.items():
    fd=os.open(pins['.harness/scripts/vm/'+filename]['path'],os.O_RDONLY|os.O_NOFOLLOW);fds.append(fd);module_map[name]='/proc/self/fd/'+str(fd)
   bootstrap="""import importlib.abc,importlib.machinery,importlib.util,json,os,pathlib,runpy,sys
from unittest.mock import patch
payload=json.loads(sys.stdin.read())
class Finder(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,path=None,target=None):
  if fullname in payload['moduleMap']:return importlib.util.spec_from_loader(fullname,importlib.machinery.SourceFileLoader(fullname,payload['moduleMap'][fullname]))
sys.meta_path.insert(0,Finder())
code=runpy.run_path(payload['entry'],run_name='closed_qualification_fixture')
reader=code['recovery'].ProtectedArtifacts(payload['root'],os.getuid(),os.getgid())
authority=code['QualificationCodeAuthority'](payload['sourcePins'],payload['executablePins'],uid=os.getuid(),gid=os.getgid(),fixture_root=payload['codeRoot'])
original=pathlib.Path.lstat
def local_lstat(path):
 value=original(path)
 if path in pathlib.Path(payload['root']).parents:
  fields=list(value);fields[0]&=~0o022;fields[4:6]=[os.geteuid(),os.getegid()];return os.stat_result(fields)
 return value
with patch.object(pathlib.Path,'lstat',local_lstat):
 result=code['qualify'](payload['input'],reader,payload['input']['sourcePolicy'],expected_identity=payload['input']['binding']['identity'],expected_release=payload['input']['isolation']['release'],code_authority=authority)
 rereader=code['recovery'].ProtectedArtifacts(payload['root'],os.getuid(),os.getgid())
 assert code['verify_existing_qualification'](payload['input'],rereader,payload['input']['sourcePolicy'],expected_identity=payload['input']['binding']['identity'],expected_release=payload['input']['isolation']['release'],code_authority=authority)==result
print(json.dumps({'qualifiedFilesVerified':5,'moduleCount':len(payload['moduleMap'])}))
"""
   payload={'moduleMap':module_map,'entry':'/proc/self/fd/'+str(entry),'root':str(self.root),'sourcePins':pins,'executablePins':{exe['path']:exe['sha256']},'codeRoot':str(root),'input':self.p}
   result=subprocess.run([sys.executable,'-I','-c',bootstrap],input=q.canonical(payload),stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=tuple(fds),timeout=30)
   self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual(json.loads(result.stdout),{'qualifiedFilesVerified':5,'moduleCount':12})
  finally:
   for fd in fds:os.close(fd)
 def test_policy_cannot_self_authorize_private_executable_copy_when_external_runtime_pin_exists(self):
  root,pins,exe=self.install_fixture_code();fake=self.raw(b'private copied runtime')
  for producer in self.policy['producers'].values():producer['executable']=fake
  for kind,ref in list(self.policy['invocations'].items()):
   inv=json.loads(pathlib.Path(ref['path']).read_bytes());inv['executable']=fake;self.policy['invocations'][kind]=self.put(inv)
  self.seal()
  with self.assertRaisesRegex(ValueError,'RUNTIME_INDEPENDENT_AUTHORITY'):self.run_it()
 def test_policy_cannot_self_authorize_private_source_copy_when_external_source_pin_exists(self):
  root,pins,exe=self.install_fixture_code();source='.harness/scripts/vm/cn_backup_sql.py';self.policy['sources'][source]=self.raw((q.D/'cn_backup_sql.py').read_bytes());self.seal()
  with self.assertRaisesRegex(ValueError,'SOURCE_INDEPENDENT_PIN'):self.run_it()
 def test_parent_invocation_recorder_is_approved_code_input_without_json_selected_execution(self):
  self.approve_extra_source('parent_source_invocation_receipt.py');root,pins,exe=self.install_fixture_code();original=q.importlib.import_module
  def fixed_import(name,*args,**kwargs):
   if name=='parent_source_invocation_receipt':raise AssertionError('PRODUCER_MUST_NOT_BE_IMPORTED_FROM_POLICY')
   return original(name,*args,**kwargs)
  with patch.object(q.importlib,'import_module',fixed_import):self.assertEqual(self.run_it()['kind'],'held-current-epoch-evidence')
  self.assertIn(pins['.harness/scripts/vm/parent_source_invocation_receipt.py']['path'],self.code_authority.snapshots)
 def install_node_pin(self):
  root,pins,python=self.install_fixture_code();node=root/'node';node.write_bytes(NODE_BINARY.read_bytes());node.chmod(0o755);ref={'path':str(node),'sha256':q.sha(node.read_bytes())}
  self.code_authority=q.QualificationCodeAuthority(pins,{python['path']:python['sha256'],ref['path']:ref['sha256']},uid=os.geteuid(),gid=os.getegid(),fixture_root=root)
  return root,pins,python,ref
 def test_actual_node_bytes_are_readonly_independently_pinned_runtime(self):
  root,pins,python,node=self.install_node_pin();before=pathlib.Path(node['path']).stat();raw=self.code_authority.read(node);self.assertEqual(raw,NODE_BINARY.read_bytes());self.code_authority.finish();after=pathlib.Path(node['path']).stat();self.assertEqual((before.st_ino,before.st_mtime_ns),(after.st_ino,after.st_mtime_ns))
 def test_approved_node_mock_invocation_can_be_revalidated_without_execution(self):
  root,pins,python,node=self.install_node_pin();self.policy['producers']['node-engine']={**self.policy['producers']['owned-supervisor'],'executable':node}
  key='stage:canonical-setup';inv=json.loads(pathlib.Path(self.policy['invocations'][key]['path']).read_bytes());inv.update(producerId='node-engine',executable=node);self.policy['invocations'][key]=self.put(inv);self.seal();e=self.run_it();self.assertEqual(self.verify_it(),e)
 def test_unknown_runtime_pin_cannot_extend_allowlist(self):
  root,pins,python,node=self.install_node_pin()
  with self.assertRaisesRegex(ValueError,'EXECUTABLE_ALLOWLIST'):q.QualificationCodeAuthority(pins,{python['path']:python['sha256'],str(root/'ruby'):node['sha256']},uid=os.geteuid(),gid=os.getegid(),fixture_root=root)
 def test_node_pin_wrong_mode_and_hash_reject(self):
  root,pins,python,node=self.install_node_pin();path=pathlib.Path(node['path']);path.chmod(0o700)
  with self.assertRaisesRegex(ValueError,'FILE_TRUST'):self.code_authority.read(node)
  path.chmod(0o755);path.write_bytes(b'changed node bytes')
  with self.assertRaisesRegex(ValueError,'RAW_HASH'):self.code_authority.read(node)
 def test_private_node_copy_cannot_self_authorize_runtime(self):
  root,pins,python,node=self.install_node_pin();fake=self.raw(NODE_BINARY.read_bytes());self.assertFalse(self.code_authority.admits(fake))
  with self.assertRaisesRegex(ValueError,'REFERENCE_NOT_APPROVED'):self.code_authority.read(fake)
 def test_code_symlink_and_hardlink_rejected(self):
  root,pins,exe=self.install_fixture_code();r=pins['.harness/scripts/vm/cn_backup_sql.py'];path=pathlib.Path(r['path']);target=root/'original';path.rename(target);path.symlink_to(target)
  with self.assertRaisesRegex(ValueError,'FILE_TRUST'):self.code_authority.read(r)
  path.unlink();os.link(target,path)
  with self.assertRaisesRegex(ValueError,'FILE_TRUST'):self.code_authority.read(r)
 def test_code_finish_detects_actual_file_change(self):
  root,pins,exe=self.install_fixture_code();r=pins['.harness/scripts/vm/cn_backup_sql.py'];self.code_authority.read(r);pathlib.Path(r['path']).write_bytes(b'changed')
  with self.assertRaisesRegex(ValueError,'RAW_HASH'):self.code_authority.finish()
 def test_code_source_path_must_be_fixed_and_explicitly_approved(self):
  root,pins,exe=self.install_fixture_code();pins['.harness/scripts/vm/cn_backup_sql.py']={**pins['.harness/scripts/vm/cn_backup_sql.py'],'path':str(root/'foreign.py')}
  with self.assertRaisesRegex(ValueError,'SOURCE_PATH'):q.QualificationCodeAuthority(pins,{exe['path']:exe['sha256']},uid=os.geteuid(),gid=os.getegid(),fixture_root=root)
 def test_code_executable_requires_independent_fixed_pin(self):
  root,pins,exe=self.install_fixture_code()
  with self.assertRaisesRegex(ValueError,'EXECUTABLE_ALLOWLIST'):q.QualificationCodeAuthority(pins,{},uid=os.geteuid(),gid=os.getegid(),fixture_root=root)
 def test_root_cannot_request_fixture_code_override(self):
  with patch.object(q.os,'geteuid',return_value=0):
   with self.assertRaisesRegex(ValueError,'FIXTURE_FORBIDDEN'):q.QualificationCodeAuthority({}, {},uid=1000,gid=1000,fixture_root='/workspace/private')
 def test_code_runtime_mode_cannot_be_private_copy_mode(self):
  root,pins,exe=self.install_fixture_code();pathlib.Path(exe['path']).chmod(0o600)
  with self.assertRaisesRegex(ValueError,'FILE_TRUST'):self.code_authority.read(exe)
 def test_code_stat_race_is_rejected(self):
  root,pins,exe=self.install_fixture_code();r=pins['.harness/scripts/vm/cn_backup_sql.py'];original=q.os.fstat;calls=0
  def changed(fd):
   nonlocal calls
   value=original(fd);calls+=1
   if calls==2:
    fields=list(value);fields[6]+=1;return os.stat_result(fields)
   return value
  with patch.object(q.os,'fstat',changed):
   with self.assertRaisesRegex(ValueError,'READ_RACE'):self.code_authority.read(r)
 def cli_fixture(self,prehold=True):
  p=copy.deepcopy(self.p);root=pathlib.Path('/etc/workspacex-cn/maintenance-evidence')/q.APP/('earlier-archive' if prehold else 'fresh-attempt');input_ref={'path':str(root/'qualification-input.json'),'sha256':'1'*64,'bytes':100};p['outputRoot']=str(root/'qualified-current-epoch')
  approved=copy.deepcopy(self.policy)
  for source,r in approved['sources'].items():r['path']='/usr/local/lib/workspacex-cn/'+source.removeprefix('.harness/scripts/vm/')
  source_ref={**p['sourcePolicy'],'path':str(root/'source-policy.json')};p['sourcePolicy']=source_ref
  hashes={source:r['sha256'] for source,r in approved['sources'].items()};entry={'schemaVersion':2,'sourcePath':'.harness/scripts/vm/current_epoch_qualification.py','sha256':hashes['.harness/scripts/vm/current_epoch_qualification.py'],'input':input_ref,'sourcePolicy':source_ref,'executablePins':{str(pathlib.Path('/usr/bin/python3').resolve()):'2'*64}}
  profile={'toolRevision':p['binding']['toolRevision'],'filesSha256':hashes,('preholdEpochQualification' if prehold else 'currentEpochQualification'):entry}
  rawfiles={}
  def rootref(name,value):
   raw=q.canonical(value);path='/etc/workspacex-cn/epoch-fixture/'+name;rawfiles[path]=raw;return {'path':path,'sha256':q.sha(raw)}
  manifest=rootref('manifest.json',{'sourceRevision':p['binding']['identity']['sourceRevision'],'release':isolation_fixture.FIXED_RELEASE})
  profile['candidateComposeEmitter']={'configRef':rootref('config.json',{'provision':{'release':isolation_fixture.FIXED_RELEASE}}),'optionsRef':rootref('options.json',{'manifestRef':manifest})}
  class Reads:
   def __init__(self,root):pass
   def blocks(self,r):
    raw=rawfiles[r['path']];assert q.sha(raw)==r['sha256'];yield raw
   def reference(self,path):return {'path':str(path),'sha256':q.sha(rawfiles[str(path)]) if str(path) in rawfiles else '3'*64,'bytes':len(rawfiles[str(path)]) if str(path) in rawfiles else 100}
   def json(self,r):
    if r['path']=='/etc/workspacex-cn/trusted-tool-binding.json':return profile
    if r==input_ref:return p
    if r==source_ref:return approved
    raise AssertionError('UNEXPECTED_READ')
   def finish(self):pass
  return p,entry,profile,Reads
 def test_prehold_cli_selects_only_independent_readonly_archive_capability(self):
  p,entry,profile,Reads=self.cli_fixture();out=io.StringIO();sentinel=object()
  with patch.object(q.os,'geteuid',return_value=0),patch.object(q.os,'getegid',return_value=0),patch.object(q.sys,'argv',['qualification','--verify-prehold-epoch',entry['input']['path']]),patch.object(q.recovery,'ProtectedArtifacts',Reads),patch.object(q,'QualificationCodeAuthority',return_value=sentinel) as authority,patch.object(q,'verify_existing_qualification',return_value={'kind':'held-current-epoch-evidence'}) as verify,patch.object(q,'qualify',side_effect=AssertionError('NO_PREHOLD_PUBLICATION')),contextlib.redirect_stdout(out):q.main()
  verify.assert_called_once();self.assertEqual(verify.call_args.args[0],p);self.assertEqual(verify.call_args.args[2],entry['sourcePolicy']);self.assertIs(verify.call_args.kwargs['code_authority'],sentinel);self.assertEqual(authority.call_args.args[1],entry['executablePins'])
 def test_current_cli_remains_exclusive_publication_current_entry(self):
  p,entry,profile,Reads=self.cli_fixture(False)
  with patch.object(q.os,'geteuid',return_value=0),patch.object(q.os,'getegid',return_value=0),patch.object(q.sys,'argv',['qualification','--qualify-current-epoch',entry['input']['path']]),patch.object(q.recovery,'ProtectedArtifacts',Reads),patch.object(q,'QualificationCodeAuthority',return_value=object()),patch.object(q,'qualify',side_effect=FileExistsError('OEXCL')) as create,patch.object(q,'verify_existing_qualification',side_effect=AssertionError('NO_CURRENT_READONLY_FALLBACK')):
   with self.assertRaises(FileExistsError):q.main()
  create.assert_called_once()
 def test_prehold_cli_cannot_fallback_to_current_entry(self):
  p,entry,profile,Reads=self.cli_fixture(False)
  with patch.object(q.os,'geteuid',return_value=0),patch.object(q.os,'getegid',return_value=0),patch.object(q.sys,'argv',['qualification','--verify-prehold-epoch',entry['input']['path']]),patch.object(q.recovery,'ProtectedArtifacts',Reads):
   with self.assertRaisesRegex(ValueError,'SOURCE_POLICY_CAPABILITY'):q.main()
 def test_prehold_cli_rejects_unpinned_input_path(self):
  p,entry,profile,Reads=self.cli_fixture()
  with patch.object(q.os,'geteuid',return_value=0),patch.object(q.os,'getegid',return_value=0),patch.object(q.sys,'argv',['qualification','--verify-prehold-epoch','/etc/workspacex-cn/foreign.json']),patch.object(q.recovery,'ProtectedArtifacts',Reads):
   with self.assertRaisesRegex(ValueError,'FIXED_INPUT_PATH'):q.main()
 def test_prehold_cli_missing_archive_evidence_remains_rejected(self):
  p,entry,profile,Reads=self.cli_fixture()
  with patch.object(q.os,'geteuid',return_value=0),patch.object(q.os,'getegid',return_value=0),patch.object(q.sys,'argv',['qualification','--verify-prehold-epoch',entry['input']['path']]),patch.object(q.recovery,'ProtectedArtifacts',Reads),patch.object(q,'QualificationCodeAuthority',return_value=object()),patch.object(q,'verify_existing_qualification',side_effect=ValueError('ACTUAL_ARTIFACT_MISSING')),patch.object(q,'qualify',side_effect=AssertionError('NO_CAPTURE_OR_PUBLISH')):
   with self.assertRaisesRegex(ValueError,'ACTUAL_ARTIFACT_MISSING'):q.main()
 def approve_extra_source(self,name='retained_backup_host.py'):
  path='.harness/scripts/vm/'+name;ref=self.raw((q.D/name).read_bytes());self.policy['sources'][path]=ref;return ref
 def test_actual_producer_source_can_be_pinned_without_import_or_false_verifier_attribution(self):
  src=self.approve_extra_source();self.policy['producers']['owned-supervisor']['source']=src
  for kind,ref in list(self.policy['invocations'].items()):
   inv=json.loads(pathlib.Path(ref['path']).read_bytes());inv['source']=src;self.policy['invocations'][kind]=self.put(inv)
  self.seal();self.assertEqual(self.run_it()['kind'],'held-current-epoch-evidence')
 def test_unlisted_extra_source_rejected(self):self.policy['sources']['.harness/scripts/vm/unreviewed_capture.py']=self.raw(b'not approved');self.seal();self.assertReject('SOURCE_CLOSURE')
 def test_extra_source_actual_hash_drift(self):ref=self.approve_extra_source();ref['sha256']='f'*64;self.seal();self.assertReject('ARTIFACT_HASH')
 def test_actual_producer_source_requires_profile_pin(self):
  src=self.raw((q.D/'retained_backend_observer.py').read_bytes());self.policy['producers']['owned-supervisor']['source']=src
  for kind,ref in list(self.policy['invocations'].items()):
   inv=json.loads(pathlib.Path(ref['path']).read_bytes());inv['source']=src;self.policy['invocations'][kind]=self.put(inv)
  self.seal();self.assertReject('PRODUCER_SOURCE_CLOSURE')
 def test_invocation_cannot_falsely_attribute_to_other_pinned_producer(self):
  src=self.approve_extra_source();key='journey:login';inv=json.loads(pathlib.Path(self.policy['invocations'][key]['path']).read_bytes());inv['source']=src;self.policy['invocations'][key]=self.put(inv);self.seal();self.assertReject('PRODUCER_IDENTITY')
 def test_external_source_policy_required(self):
  with self.assertRaisesRegex(ValueError,'EXTERNAL_SOURCE_POLICY'):q.qualify(self.p,self.r.reader(),self.raw(b'unapproved policy'),expected_identity=self.b['identity'],expected_release=isolation_fixture.FIXED_RELEASE)
 def test_legacy_schema_not_qualified(self):self.p['schemaVersion']=1;self.assertReject('SCHEMA2')
 def assertReject(self,code):
  with self.assertRaisesRegex((ValueError,q.recovery.Rejected),code):self.run_it()
  self.assertEqual(list((self.root/'output').iterdir()),[])
 def test_unapproved_invocation(self):del self.policy['invocations']['journey:asr'];self.seal();self.assertReject('UNAPPROVED')
 def test_source_byte_mismatch(self):self.policy['sources']['.harness/scripts/vm/cn_backup_sql.py']=self.raw(b'changed source');self.seal();self.assertReject('LOADED_SOURCE_HASH')
 def test_collection_rename(self):self.p['collection']=self.change('collection',lambda x:x.update(kind='held-current-epoch-manifest',qualified=True));self.assertReject('ACTUAL_COLLECTION_REPRODUCTION')
 def test_writer_survives(self):self.p['before']=self.change('before-held-drained',lambda x:x.update(writerSessions=[{'pid':10}]));self.assertReject('NOT_DRAINED')
 def test_permissions_write(self):self.p['permissions']['workspacex']=self.change('permissions:workspacex',lambda x:x['facts']['effectiveRelations'][0].update(writable=True));self.assertReject('PERMISSION_REJECTED')
 def test_capture_outside_hold(self):key='dump:workspacex';v=json.loads(pathlib.Path(self.policy['invocations'][key]['path']).read_bytes());v['startedAt']=99;self.policy['invocations'][key]=self.put(v);self.seal();self.assertReject('OUTSIDE_HELD')
 def test_wrong_held_snapshot(self):self.p['dumpLanes']['workspacex']=self.change('dump:workspacex',lambda x:x.update(snapshotId='wrong'));self.assertReject('HELD_SNAPSHOT')
 def test_object_version_drift(self):self.p['objects']['restored']=self.change('objects:restored',lambda x:x.update(scopeSha256='2'*64));self.assertReject('RESTORE_DRIFT')
 def test_interval_reopened(self):self.p['heldJournal']=self.change('held-interval-journal',lambda x:x['events'][1].update(state='cleared'));self.assertReject('INTERVAL_REOPENED')
 def test_stage_missing(self):del self.p['isolation']['stageReceipts']['migrate'];self.assertReject('EIGHT_STAGES')
 def test_pdf_flag_cannot_replace_bytes(self):self.p['journeys']['pdfDownload']=self.change('journey:pdfDownload',lambda x:x.update(body=self.raw(b'passed:true')));self.assertReject('BODY_HASH')
 def test_dump_precheck_cannot_claim_sql_readonly(self):
  lane=json.loads(pathlib.Path(self.p['dumpLanes']['workspacex']['path']).read_bytes());r=self.change('backend:workspacex',lambda x:x['readOnlyEvidence'].update(sqlObserved=True));lane['backendProof']=r
  self.p['dumpLanes']['workspacex']=self.change('dump:workspacex',lambda x:x.update(backendProof=r));self.assertReject('READONLY_IMPLEMENTATION')
 def test_missing_source_invocation_inputs(self):
  key='stage:canonical-setup';v=json.loads(pathlib.Path(self.policy['invocations'][key]['path']).read_bytes());v['inputs']=[];self.policy['invocations'][key]=self.put(v);self.seal();self.assertReject('INPUT_CLOSURE')
 def test_false_success_flag_cannot_replace_restore_data(self):
  ref=self.r.manifest['databases']['workspacex']['tableRowHashStreams'][0]['restored'];pathlib.Path(ref['path']).write_bytes(b'changed actual bytes');self.assertReject('ARTIFACT_(LENGTH|HASH)')
 def test_process_identity_cannot_be_unknown(self):
  key='journey:asr';v=json.loads(pathlib.Path(self.policy['invocations'][key]['path']).read_bytes());v['processStart']='unknown';self.policy['invocations'][key]=self.put(v);self.seal();self.assertReject('PROCESS_IDENTITY')
 def test_producer_namespaces(self):key='journey:login';v=json.loads(pathlib.Path(self.policy['invocations'][key]['path']).read_bytes());v['namespaces']={**v['namespaces'],'net':'999'};self.policy['invocations'][key]=self.put(v);self.seal();self.assertReject('PRODUCER_IDENTITY')
if __name__=='__main__':unittest.main()

class ApprovedReleaseAuthority(unittest.TestCase):
 def fixture(self):
  identity={'sourceRevision':'5285bef9a6c91bbb9857ede42779aafa64b98f32','baselineRevision':'a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0'};store={}
  def put(name,value):
   path='/etc/workspacex-cn/'+name;raw=json.dumps(value).encode();store[path]=raw;return {'path':path,'sha256':hashlib.sha256(raw).hexdigest()}
  manifest=put('manifest.json',{'sourceRevision':identity['sourceRevision'],'release':'2026.10.6-cn.1'})
  profile={'candidateComposeEmitter':{'optionsRef':put('options.json',{'manifestRef':manifest}),'configRef':put('config.json',{'provision':{'release':'2026.10.6-cn.1'}})}}
  return identity,profile,store
 def test_pinned_manifest_release_succeeds(self):
  identity,profile,store=self.fixture();self.assertEqual(q.approved_release(profile,identity,store.__getitem__),'2026.10.6-cn.1')
 def test_source_rawpin_config_scope_and_drift_reject(self):
  for kind in ('source','pin','config','scope','drift','missing'):
   with self.subTest(kind=kind):
    identity,profile,store=self.fixture()
    if kind=='source':identity['sourceRevision']='f'*40
    if kind=='pin':profile['candidateComposeEmitter']['optionsRef']['sha256']='f'*64
    if kind=='config':
     ref=profile['candidateComposeEmitter']['configRef'];store[ref['path']]=json.dumps({'release':'foreign'}).encode();ref['sha256']=hashlib.sha256(store[ref['path']]).hexdigest()
    if kind=='scope':profile['candidateComposeEmitter']['optionsRef']['path']='/tmp/self-approved.json'
    if kind=='missing':profile={}
    count={}
    def read(path):
     count[path]=count.get(path,0)+1
     return b'changed' if kind=='drift' and count[path]>1 else store[path]
    with self.assertRaises(ValueError):q.approved_release(profile,identity,read)
