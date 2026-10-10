"""Fixture authorizations are synthetic; these tests perform no live action."""
import base64,copy,hashlib,importlib.util,json,os,pathlib,tempfile,unittest
from unittest.mock import patch
import cn_tool_profile as schema
D=pathlib.Path(__file__).parent
TOOL='a'*40
APP='5285bef9a6c91bbb9857ede42779aafa64b98f32'
BASE='a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0'
RUNTIME=dict(path='/usr/bin/node',sha256='1'*64,mode='0755',uid=0,gid=0,links=1,regular=True,symlink=False)
SCHEMA='.harness/scripts/vm/cn_tool_profile.py'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def raw(value):return (json.dumps(value,sort_keys=True)+'\n').encode()
def b64(data):return base64.b64encode(data).decode()
def container(value):
 data=raw(value);return {'sha256':sha(data),'rawBase64':b64(data)}
def load(name):
 spec=importlib.util.spec_from_file_location(name,D/name);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
P=load('prepare-cn-tool-install.py');I=load('cn-tool-install-transaction.py')
def fixture():
 identity=dict(attemptId='fixture-attempt',sourceRevision=APP,baselineRevision=BASE,migrationPlanSha256='b'*64)
 writer=dict(schemaVersion=1,mode='maintenance-all-writer-fence',identity=identity,toolRevision=TOOL,productionActionsAuthorized=True,runtimeSessionBootstrapAuthorized=True)
 docs={}
 def doc(name,value):
  data=value if isinstance(value,bytes) else raw(value)
  docs[name]={'path':'/etc/workspacex-cn/fixture/'+name,'sha256':sha(data),'rawBase64':b64(data)}
  return {k:docs[name][k] for k in ('path','sha256')}
 wr=doc('writerPlan',writer)
 er=doc('entryPlan',dict(schemaVersion=1,productionActionsAuthorized=True,identity=identity,host=dict(identity=identity,writerPlanPath=wr['path'],writerPlanSha256=wr['sha256']),production=dict(toolRevision=TOOL)))
 mr=doc('manifest',dict(schemaVersion=1,release='v1.0.0',sourceRevision=APP,platform='linux/amd64',images={k:{'image':'registry.test/wsx/'+k+'@sha256:'+'d'*64} for k in ('web','api','agent','sandbox','postgres','redis')}))
 cr=doc('config',{'provision':{'release':'v1.0.0'}})
 other=lambda name:{'path':'/etc/workspacex-cn/fixture/'+name,'sha256':'e'*64}
 op=doc('options',dict(projectName='fixture-new',runtimeDirectory='/etc/workspacex-cn/fixture/runtime',runtimeFiles={},manifestRef=mr,composeRef=other('compose'),networkRef=other('network')))
 em=doc('emitter',b'fixture executable bytes, never run')
 sources=['packages/cloud-deploy/src/'+n for n in ('compose.ts','config.ts','storage-config.ts','release.ts','image-reference.ts','runtime-bundle.ts')]+['packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority.ts','packages/cloud-deploy/src/cn-candidate-compose-source.ts','packages/cloud-deploy/src/cn-candidate-compose-source-cli.ts','.harness/scripts/vm/build-cn-candidate-compose-source.mjs']
 data={s:('fixture:'+s).encode() for s in sources};data['node_modules/fixture/index.js']=b'fixture dependency';data['pnpm-lock.yaml']=b'fixture lock'
 inputs={s:{'sha256':sha(v),'rawBase64':b64(v)} for s,v in data.items()}
 sourcepins={s:{'sha256':sha(data[s]),'gitBlob':hashlib.sha1(b'blob '+str(len(data[s])).encode()+b'\0'+data[s]).hexdigest()} for s in sources}
 closure=dict(schemaVersion=2,sourceRevision=APP,identity=identity,toolRevision=TOOL,emitterSourceRevision=TOOL,originalPlanSha256=wr['sha256'],release='v1.0.0',compiler={'name':'esbuild','version':'0.24.2'},sources=sourcepins,dependencies={'node_modules/fixture/index.js':sha(data['node_modules/fixture/index.js'])},lockfileSha256=sha(data['pnpm-lock.yaml']),bundleSha256=em['sha256'],bundledInputs=sorted(sources+['node_modules/fixture/index.js']))
 cl=doc('closure',closure)
 emitter=dict(schemaVersion=2,**em,nodePath='/usr/bin/node',nodeSha256='1'*64,dockerPath='/usr/bin/docker',dockerSha256='2'*64,dockerSocket='/var/run/docker.sock',sourceClosureRef=cl,originalEntryPlanRef=er,configRef=cr,optionsRef=op)
 return dict(schemaVersion=1,kind='cn-compose-profile-extension-v1',toolRevision=TOOL,originalWriterPlan=wr,candidateComposeEmitter=emitter,documents=docs,inputs=inputs),data

def change_document(x,name,update):
 item=x['documents'][name];v=json.loads(base64.b64decode(item['rawBase64']));update(v);data=raw(v);item.update(sha256=sha(data),rawBase64=b64(data))
 ref={k:item[k] for k in ('path','sha256')}
 keys={'closure':'sourceClosureRef','entryPlan':'originalEntryPlanRef','config':'configRef','options':'optionsRef'}
 if name in keys:x['candidateComposeEmitter'][keys[name]]=ref
 return ref

class ExtensionTests(unittest.TestCase):
 def validate(self,x,**kw):
  c=container(x);return schema.validate_compose_extension(c,c['sha256'],TOOL,APP,**kw)
 def rows(self):return {SCHEMA:{'target':'/usr/local/lib/workspacex-cn/cn_tool_profile.py','newSha256':sha((D/'cn_tool_profile.py').read_bytes())}}
 def test_complete_extension_same_schema_producer_installer_no_extra_targets(self):
  x,data=fixture();c=container(x);rows=self.rows();values=[]
  for m in (P,I):
   ev=m.extension_evidence(TOOL,rows,(D/'cn_tool_profile.py').read_bytes(),c,c['sha256'],APP,lambda rev,s:data[s]);self.assertEqual(ev['hashes'],{s:sha(v) for s,v in data.items()})
   values.append(m.profile_content(TOOL,rows,(D/'cn_tool_profile.py').read_bytes(),RUNTIME,c,c['sha256']))
  self.assertEqual(values[0],values[1]);self.assertEqual(set(values[0]['installedTargets']),set(rows));self.assertEqual(set(values[0]['composeBaseFilesSha256']),set(rows))
  self.assertEqual(set(values[0]['filesSha256']),set(rows)|set(data))
 def test_no_extension_byte_compatibility(self):
  rows={'fixture':{'newSha256':'b'*64,'target':None}}
  expected=b'{"filesSha256": {"fixture": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}, "installedFilesSha256": {}, "installedTargets": {}, "toolRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n'
  self.assertEqual(raw(schema.build_profile(TOOL,rows)),expected)
 def test_independent_pin_missing_wrong_unsolicited(self):
  x,_=fixture();c=container(x)
  for ext,pin in [(c,None),(c,'f'*64),(None,c['sha256'])]:
   with self.subTest(pin=pin),self.assertRaises(ValueError):schema.validate_compose_extension(ext,pin,TOOL)
 def test_duplicate_fields_and_extra_schema(self):
  x,_=fixture();r=raw(x).replace(b'"schemaVersion": 1',b'"schemaVersion": 1,"schemaVersion": 1',1);c={'sha256':sha(r),'rawBase64':b64(r)}
  with self.assertRaisesRegex(ValueError,'DUPLICATE_KEY'):schema.validate_compose_extension(c,c['sha256'],TOOL)
  for field in ('extra','trusted'):
   y=copy.deepcopy(x);y[field]=True
   with self.assertRaises(ValueError):self.validate(y)
 def test_input_drift_extra_path_and_source_pin(self):
  for case in ('bytes','extra','traversal','source','dependency','blob','lock'):
   x,_=fixture();key=next(iter(x['inputs']))
   if case=='bytes':x['inputs'][key]['rawBase64']=b64(b'drift')
   if case=='extra':x['inputs']['not-in-closure']=copy.deepcopy(x['inputs'][key])
   if case=='traversal':x['inputs']['../escape']=x['inputs'].pop(key)
   if case=='source':change_document(x,'closure',lambda c:c['sources'][key].update(sha256='0'*64))
   if case=='dependency':change_document(x,'closure',lambda c:c['dependencies'].update({'node_modules/fixture/index.js':'0'*64}))
   if case=='blob':change_document(x,'closure',lambda c:c['sources'][key].update(gitBlob='0'*40))
   if case=='lock':change_document(x,'closure',lambda c:c.update(lockfileSha256='0'*64))
   with self.subTest(case=case),self.assertRaises(ValueError):self.validate(x)
 def test_actual_git_source_and_native_app_required(self):
  x,data=fixture()
  for revision in (TOOL,APP):
   with self.subTest(revision=revision),self.assertRaises(ValueError):self.validate(x,git_blob=lambda rev,s:b'foreign' if rev==revision else data[s])
 def test_other_control_source_and_original_approval_rejected(self):
  changes=[('closure',lambda c:c.update(emitterSourceRevision='f'*40)),('closure',lambda c:c.update(sourceRevision='f'*40)),('closure',lambda c:c.update(originalPlanSha256='f'*64)),('entryPlan',lambda c:c.update(productionActionsAuthorized=False)),('entryPlan',lambda c:c['production'].update(toolRevision='f'*40)),('config',lambda c:c['provision'].update(release='other'))]
  for name,fn in changes:
   x,_=fixture();change_document(x,name,fn)
   with self.subTest(name=name),self.assertRaises(ValueError):self.validate(x)
  x,_=fixture();x['originalWriterPlan']['sha256']='f'*64
  with self.assertRaises(ValueError):self.validate(x)
 def test_cross_pair_and_arbitrary_hex_rejected(self):
  for source,baseline in [(APP,'ba6343199f3c834d6a198f83d0c771614292c82b'),('f'*40,BASE)]:
   x,_=fixture();change_document(x,'writerPlan',lambda p:p['identity'].update(sourceRevision=source,baselineRevision=baseline))
   x['originalWriterPlan']={k:x['documents']['writerPlan'][k] for k in ('path','sha256')}
   with self.assertRaisesRegex(ValueError,'RELEASE_IDENTITY'):self.validate(x)
 def test_base_overlap_conflict_and_equal(self):
  x,data=fixture();c=container(x);rows=self.rows();key=next(iter(data));rows[key]={'target':None,'newSha256':sha(data[key])}
  schema.build_profile(TOOL,rows,RUNTIME,c,c['sha256']);rows[key]['newSha256']='f'*64
  with self.assertRaisesRegex(ValueError,'BASE_CONFLICT'):schema.build_profile(TOOL,rows,RUNTIME,c,c['sha256'])
 def test_ref_mutation_with_previous_pin_fails(self):
  x,_=fixture();pin=container(x)['sha256'];x['candidateComposeEmitter']['configRef']['path']+='/other'
  with self.assertRaises(ValueError):schema.validate_compose_extension(container(x),pin,TOOL)
 def test_old_profile_reconstructs_exact_base_and_extension(self):
  x,_=fixture();c=container(x);rows=self.rows();content=schema.build_profile(TOOL,rows,RUNTIME,c,c['sha256']);data=raw(content)
  old=dict(present=True,regular=True,symlink=False,mode='0600',uid=0,gid=0,links=1,sha256=sha(data),rawBase64=b64(data))
  previous={'runtimes':{'node':RUNTIME},'files':{s:dict(target=r['target'],present=True,regular=True,symlink=False,uid=0,gid=0,links=1,sha256=r['newSha256']) for s,r in rows.items()}}
  for m in (P,I):
   m.old_profile_allowlist(content,{s:r['target'] for s,r in rows.items()},previous)
   t,r=m.old_profile_binding(old,previous,(D/'cn_tool_profile.py').read_bytes());self.assertEqual(r,rows)
   tampered=copy.deepcopy(content);tampered['filesSha256']['unrelated']='f'*64;b=raw(tampered)
   with self.assertRaises(Exception):m.old_profile_binding({**old,'sha256':sha(b),'rawBase64':b64(b)},previous,(D/'cn_tool_profile.py').read_bytes())
   with self.assertRaises(Exception):m.profile_content('f'*40,rows,(D/'cn_tool_profile.py').read_bytes(),RUNTIME,c,c['sha256'])
 def test_staged_changed_bytes_and_modes_fail(self):
  x,_=fixture();ev=self.validate(x)
  with tempfile.TemporaryDirectory(dir=pathlib.Path('/tmp').resolve()) as td:
   root=pathlib.Path(td);uid=os.getuid();gid=root.stat().st_gid
   # Paths are rewritten only after pure validation for isolated FD tests.
   for name,item in ev['documents'].items():
    p=root/name;p.write_bytes(base64.b64decode(item['rawBase64']));p.chmod(0o700 if name=='emitter' else 0o600);item['path']=str(p)
   for k,h in [('nodePath','nodeSha256'),('dockerPath','dockerSha256')]:
    p=root/k;p.write_bytes(k.encode());p.chmod(0o755);ev['candidateComposeEmitter'][k]=str(p);ev['candidateComposeEmitter'][h]=sha(k.encode())
   I.verify_staged_extension(ev,uid,gid,root)
   p=root/'config';p.write_bytes(b'foreign')
   with self.assertRaisesRegex(RuntimeError,'STAGED_BINDING'):I.verify_staged_extension(ev,uid,gid,root)
   p.write_bytes(base64.b64decode(ev['documents']['config']['rawBase64']));p.chmod(0o644)
   with self.assertRaisesRegex(RuntimeError,'STAGED_BINDING'):I.verify_staged_extension(ev,uid,gid,root)
 def test_compact_never_admits_new_extension(self):
  x,data=fixture();c=container(x);p=schema.build_profile(TOOL,self.rows(),RUNTIME,c,c['sha256'])['composeExtensionV1']
  self.assertEqual(p['kind'],'cn-compose-profile-projection-v1')
  self.assertTrue(all(set(v)=={'sha256'} for v in p['evidence']['inputs'].values()))
  with self.assertRaises(ValueError):schema.validate_compose_extension(p,c['sha256'],TOOL)
  ev=schema.validate_compose_projection(p,TOOL,APP,lambda rev,s:data[s]);self.assertEqual(ev['projection'],p)
  with self.assertRaises(ValueError):schema.validate_compose_projection(p,'f'*40)
  with self.assertRaises(ValueError):schema.validate_compose_projection(p,TOOL,APP,lambda rev,s:b'foreign')
 def test_node_inventory_pin_required_and_consistent(self):
  x,_=fixture();c=container(x)
  for runtime in (None,{**RUNTIME,'sha256':'f'*64}):
   with self.assertRaisesRegex(ValueError,'NODE_RUNTIME_BINDING'):schema.build_profile(TOOL,self.rows(),runtime,c,c['sha256'])
 def test_profile_size_full_evidence_does_not_inflate_runtime(self):
  x,_=fixture();data=b'x'*1400000;key='node_modules/fixture/index.js'
  x['inputs'][key]={'sha256':sha(data),'rawBase64':b64(data)}
  change_document(x,'closure',lambda c:c['dependencies'].update({key:sha(data)}))
  c=container(x);profile=schema.build_profile(TOOL,self.rows(),RUNTIME,c,c['sha256'])
  self.assertGreater(len(base64.b64decode(c['rawBase64'])),1400000)
  self.assertLess(len(raw(profile)),65536)
  change_document(x,'config',lambda c:c.update(tooLarge='x'*800000))
  c=container(x)
  with self.assertRaisesRegex(ValueError,'CONSUMER_SIZE_LIMIT'):schema.build_profile(TOOL,self.rows(),RUNTIME,c,c['sha256'])
 def test_six_digest_manifest_strict(self):
  for fn in (lambda m:m['images'].pop('redis'),lambda m:m['images']['web'].update(image='registry.test//web@sha256:'+'a'*64),lambda m:m.update(release='not-semver'),lambda m:m.update(platform='linux/arm64')):
   x,_=fixture();ref=change_document(x,'manifest',fn)
   change_document(x,'options',lambda o:o.update(manifestRef=ref))
   with self.assertRaises(ValueError):self.validate(x)
 def test_producer_transaction_to_installer_and_independent_pin(self):
  import datetime
  x,_=fixture();c=container(x);rows=self.rows();hold='.harness/scripts/vm/cn_maintenance_hold.py';target='/etc/workspacex-cn/trusted-tool-binding.json'
  consumer=("profile=Path(%r)\nbinding=read(profile,0o600)\n"%target).encode();rows[hold]={'target':'/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','newSha256':sha(consumer)}
  payload={SCHEMA:(D/'cn_tool_profile.py').read_bytes(),hold:consumer};now=1900000000;observed=datetime.datetime.fromtimestamp(now-10,datetime.timezone.utc).isoformat()
  absent=dict(present=False,regular=False,symlink=False,sha256=None,mode=None,uid=None,gid=None,links=None)
  expected=dict(region='fixture-region',instanceId='fixture-instance',sourceInvocation='fixture-invoke',commandId='fixture-command')
  inv=dict(schemaVersion=1,readOnly=True,ready=False,observedAt=observed,sourceInvocation=expected['sourceInvocation'],runtimes={'node':RUNTIME},profiles={target:absent},files={s:dict(absent,target=r['target']) for s,r in rows.items()})
  for s,row in rows.items():row.update(mode='0700',oldPresent=False,oldSha256=None,oldMode=None,oldUid=None,oldGid=None,oldNlink=None,bytes=len(payload[s]))
  ir=raw(inv);remote=dict(inv);del remote['sourceInvocation'];rr=raw(dict(expected,schemaVersion=1,invocationStatus='Success',exitCode=0,dropped=0,readOnly=True,productionModified=False,localInventorySha256=sha(ir),inventoryObservedAt=observed,outputSha256=sha(raw(remote)),startTime=observed,finishTime=None))
  proposal=P.profile_transaction(TOOL,rows,payload,inv,ir,{'fixture':True},extension=c,expected_extension=c['sha256'])
  m=dict(toolRevision=TOOL,applicationRevision=APP,files=rows,composeExtensionV1=c,profileTransactionsV1=[proposal],previousInventorySha256=sha(ir),inventoryObservedAt=observed,inventorySourceInvocation=expected['sourceInvocation'])
  tx,content=I.profile_transaction(m,consumer,ir,rr,expected,now,schema_raw=payload[SCHEMA],expected_extension=c['sha256']);self.assertEqual(content,raw(proposal['content']));self.assertEqual(tx['destination'],target)
  for pin in (None,'f'*64):
   with self.assertRaises(ValueError):I.profile_transaction(m,consumer,ir,rr,expected,now,schema_raw=payload[SCHEMA],expected_extension=pin)
  # Authenticated old projection cannot be silently removed by omitting the flag.
  oldraw=content;old=dict(present=True,regular=True,symlink=False,sha256=sha(oldraw),rawBase64=b64(oldraw),mode='0600',uid=0,gid=0,links=1)
  inv['profiles'][target]=old
  for source,row in rows.items():inv['files'][source].update(present=True,regular=True,sha256=row['newSha256'],uid=0,gid=0,links=1,mode='0700')
  with self.assertRaisesRegex(ValueError,'REMOVAL_NOT_AUTHORIZED'):P.profile_transaction(TOOL,rows,payload,inv,raw(inv),old_schema_raw=payload[SCHEMA])
if __name__=='__main__':unittest.main()
