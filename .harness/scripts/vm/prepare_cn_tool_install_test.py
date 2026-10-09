import importlib.util,pathlib,tempfile,subprocess,json,hashlib,unittest,os,datetime
from unittest.mock import patch
D=pathlib.Path(__file__).parent
s=importlib.util.spec_from_file_location('producer',D/'prepare-cn-tool-install.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Producer(unittest.TestCase):
 def fixture(self,p):
  repo=p/'repo';repo.mkdir();subprocess.run(['git','init','-q',str(repo)],check=True)
  source='.harness/scripts/vm/cn-build-tool-identity.py';dest=repo/source;dest.parent.mkdir(parents=True);dest.write_text("FILES={'"+source+"':'/usr/local/bin/fixture'}\ndef validate_identity(value,tool):\n return value.get('toolRoot')=='/opt/workspacex-cn/release-tools/'+tool\n")
  def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL).decode().strip()
  # Fixture commits must not spawn background Git maintenance while the security
  # producer inventories immutable metadata. Keep every trust check fail-closed.
  git('config','maintenance.auto','false');git('config','gc.auto','0')
  git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture');head=git('rev-parse','HEAD')
  inv=p/'inventory.json';value={'schemaVersion':1,'observedAt':'2026-10-03T00:00:00Z','sourceInvocation':'untrusted-fixture','files':{source:{'target':'/usr/local/bin/fixture','present':True,'uid':0,'gid':0,'links':1,'regular':True,'symlink':False,'mode':'0755','sha256':'a'*64}}};inv.write_text(json.dumps(value));return repo,head,inv,value
 def test_fixture_commits_do_not_spawn_background_maintenance(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);trace=p/'git-trace.jsonl'
   (repo/'next').write_text('second fixture commit')
   env={**m.git_environment(),'GIT_TRACE2_EVENT':str(trace)}
   subprocess.run(m.git_command(repo,'add','.'),env=env,check=True)
   subprocess.run(m.git_command(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','next'),env=env,check=True)
   children=[row for row in map(json.loads,trace.read_text().splitlines()) if row.get('event')=='child_start']
   self.assertFalse(any('maintenance' in row.get('argv',[]) or 'gc' in row.get('argv',[]) for row in children),children)
   self.assertRegex(m.trusted_local_git(repo),r'^[a-f0-9]{64}$')
 def test_old_profile_allowlist_is_independent_and_complete(self):
  files={'schema':None,'script':'/usr/local/lib/old.py'};content={'filesSha256':{'schema':'a'*64,'script':'b'*64}};inv={'files':{'schema':{'target':None},'script':{'target':'/usr/local/lib/old.py'}}}
  m.old_profile_allowlist(content,files,inv)
  for missing in files:
   with self.subTest(missing=missing),self.assertRaises(Exception):m.old_profile_allowlist({'filesSha256':{k:v for k,v in content['filesSha256'].items() if k!=missing}},files,inv)
  with self.assertRaises(Exception):m.old_profile_allowlist(content,files,{'files':{'schema':{'target':None},'script':{'target':'/usr/local/lib/foreign.py'}}})
 def test_review_only_package_and_readback(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);out=p/'out';r=m.produce(repo,h,h,h,inv,out)
   self.assertFalse(r['ready']);self.assertFalse(r['installationAuthorized']);self.assertFalse(r['installerImplemented']);self.assertEqual(r['inventoryTrust'],'untrustedInput')
   self.assertEqual(r,json.loads((out/'manifest.json').read_text()));self.assertEqual((out/'COMPLETE').read_text().strip(),hashlib.sha256((out/'manifest.json').read_bytes()).hexdigest())
   for source,row in r['files'].items():self.assertEqual(hashlib.sha256((out/'payload'/source).read_bytes()).hexdigest(),row['newSha256'])
   self.assertEqual(r['toolRoot'],'/opt/workspacex-cn/release-tools/'+h)
   self.assertEqual(r['trustedGitClosure']['fsckExitCode'],0)
   self.assertEqual(r['trustedGitClosure']['toolRevision'],h)
   self.assertEqual(r['trustedGitClosure']['entries'][0]['sha256'],next(iter(r['files'].values()))['newSha256'])
   self.assertEqual(r['profileEntries'],[])
   self.assertIn('ROOT_PROFILE_OLD_INVENTORY_MISSING',r['installationBlockers'])
   with self.assertRaises(ValueError):m.produce(repo,h,h,h,inv,out)
 def test_missing_inventory_wrong_target_symlink_hardlink(self):
  for bad in ('missing','target','mode','symlink','hardlink'):
   with self.subTest(bad=bad),tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
    p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);source=next(iter(v['files']))
    if bad=='missing':v['files']={}
    if bad=='target':v['files'][source]['target']='/etc/passwd'
    if bad=='mode':v['files'][source]['mode']='0777'
    inv.write_text(json.dumps(v))
    if bad=='symlink':other=p/'other';inv.rename(other);inv.symlink_to(other)
    if bad=='hardlink':os.link(inv,p/'alias')
    with self.assertRaises((ValueError,OSError)):m.produce(repo,h,h,h,inv,p/'out')
 def test_new_absent_files_have_no_fabricated_old_identity(self):
  for bad in ('valid','hash','mode'):
   with self.subTest(bad=bad),tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
    p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);row=next(iter(v['files'].values()));row.update(present=False,sha256=None,mode=None,uid=None,gid=None,links=None)
    if bad=='hash':row['sha256']='a'*64
    if bad=='mode':row['mode']='0700'
    inv.write_text(json.dumps(v))
    if bad=='valid':
     r=m.produce(repo,h,h,h,inv,p/'out');newrow=next(iter(r['files'].values()));self.assertFalse(newrow['oldPresent']);self.assertIsNone(newrow['oldSha256'])
    else:
     with self.assertRaises(ValueError):m.produce(repo,h,h,h,inv,p/'out')
 def test_unsafe_output_parent_and_duplicate_target(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);bad=p/'writable';bad.mkdir();bad.chmod(0o777)
   with self.assertRaises(ValueError):m.produce(repo,h,h,h,inv,bad/'out')
  with self.assertRaises(ValueError):m.allowlist(b"FILES={'a':'/usr/local/bin/x','b':'/usr/local/bin/x'}")
  self.assertEqual(m.allowlist(b"FILES={'a':None,'b':'/usr/local/bin/x'}")['a'],None)
 def test_unmerged_local_ancestry(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);(repo/'new').write_text('x');subprocess.run(['git','-C',str(repo),'add','.'],check=True);subprocess.run(['git','-C',str(repo),'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','new'],check=True);new=m.git(repo,'rev-parse','HEAD').decode().strip()
   with self.assertRaises(subprocess.CalledProcessError):m.produce(repo,new,h,h,inv,p/'out')
 def test_allowlist_unsafe_sources_and_targets(self):
  for source,target in [('../x','/usr/local/bin/x'),('/x','/usr/local/bin/x'),('x','/etc/x'),('x','/usr/local/../etc/x')]:
   with self.assertRaises(ValueError):m.allowlist(('FILES='+repr({source:target})).encode())
 def test_untrusted_metadata_rejected_before_any_git(self):
  for bad,code in [('gitfile','GIT_DIRECTORY_REQUIRED'),('alternate','GIT_EXTERNAL_OR_PARTIAL'),('promisor','GIT_PROMISOR'),('include','GIT_CONFIG_EXECUTION'),('filter','GIT_CONFIG_EXECUTION'),('writable','GIT_MEMBER_TRUST'),('hardlink','GIT_MEMBER_HARDLINK'),('symlink','GIT_MEMBER_TRUST')]:
   with self.subTest(bad=bad),tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
    p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);gd=repo/'.git'
    if bad=='gitfile':gd.rename(repo/'metadata');gd.write_text('gitdir: metadata\n')
    if bad=='alternate':(gd/'objects/info/alternates').write_text('/tmp/foreign\n')
    if bad=='promisor':(gd/'objects/info/fixture.promisor').write_text('')
    if bad in ('include','filter'):
     with (gd/'config').open('a') as f:f.write('\n['+bad+']\n path=/tmp/foreign\n')
    if bad=='writable':(gd/'HEAD').chmod(0o666)
    if bad=='hardlink':os.link(gd/'HEAD',p/'alias')
    if bad=='symlink':(gd/'HEAD').rename(p/'head');(gd/'HEAD').symlink_to(p/'head')
    with patch.object(m.subprocess,'check_output') as call:
     with self.assertRaisesRegex(ValueError,code):m.produce(repo,h,h,h,inv,p/'out')
     call.assert_not_called()
 def test_missing_object_cannot_claim_fsck(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,v=self.fixture(p)
   blob=m.git(repo,'rev-parse',h+':.harness/scripts/vm/cn-build-tool-identity.py').decode().strip()
   (repo/'.git/objects'/blob[:2]/blob[2:]).unlink()
   with self.assertRaises(subprocess.CalledProcessError):m.produce(repo,h,h,h,inv,p/'out')
   self.assertFalse((p/'out').exists())
 def test_root_contract_must_come_from_actual_source(self):
  with self.assertRaisesRegex(ValueError,'TOOL_ROOT_CONTRACT_REQUIRED'):m.tool_root_contract('FILES={}', 'a'*40)
 def test_git_process_count_does_not_grow_with_blob_count(self):
  counts=[]
  for extra in (0,40):
   with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
    p=pathlib.Path(d);repo,h,inv,v=self.fixture(p)
    if extra:
     for n in range(extra):(repo/('blob-'+str(n))).write_bytes(bytes([n])*8192)
     m.git(repo,'add','.');m.git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','more')
     h=m.git(repo,'rev-parse','HEAD').decode().strip()
    with patch.object(m,'trusted_local_git',wraps=m.trusted_local_git) as trust,patch.object(m,'execute_git',wraps=m.execute_git) as calls,patch.object(m.subprocess,'Popen',wraps=m.subprocess.Popen) as processes:
     result=m.produce(repo,h,h,h,inv,p/'out')
     self.assertEqual(trust.call_count,2)
     self.assertEqual(len(result['trustedGitClosure']['entries']),extra+1)
     batch=[call for call in processes.call_args_list if '--batch' in call.args[0]]
     self.assertEqual(len(batch),1)
     counts.append((calls.call_count,processes.call_count))
  self.assertEqual(counts[0],counts[1]);self.assertLessEqual(counts[1][1],10)
 def test_metadata_drift_after_batch_prevents_package(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);original=m.tree_closure
   def drift(*args):
    value=original(*args)
    with (repo/'.git/config').open('a') as f:f.write('\n[fixture]\n drift=true\n')
    return value
   with patch.object(m,'tree_closure',side_effect=drift):
    with self.assertRaisesRegex(ValueError,'GIT_METADATA_CHANGED'):m.produce(repo,h,h,h,inv,p/'out')
   self.assertFalse((p/'out').exists())
 def test_profile_create_proposal_derives_consumer_path_and_binds_absence(self):
  source='.harness/scripts/vm/cn_maintenance_hold.py'
  raw=b"from pathlib import Path\ndef check():\n profile=Path('/etc/fixture/profile.json')\n return read(profile,0o600)\n"
  rows={source:{'newSha256':hashlib.sha256(raw).hexdigest()}}
  absent={'present':False,'regular':False,'symlink':False,'sha256':None,'mode':None,'uid':None,'gid':None,'links':None}
  inv={'profiles':{'/etc/fixture/profile.json':absent},'readOnly':True,'ready':False,'observedAt':'fixture-time','sourceInvocation':'fixture-provider'}
  invraw=json.dumps(inv).encode();r=m.profile_transaction('a'*40,rows,{source:raw},inv,invraw)
  self.assertEqual(r['target'],'/etc/fixture/profile.json');self.assertEqual(r['mode'],'0600')
  self.assertEqual(r['previousInventorySha256'],hashlib.sha256(invraw).hexdigest())
  self.assertEqual(r['content']['filesSha256'],{source:rows[source]['newSha256']})
  self.assertFalse(r['providerSuccessIndependentlyVerified']);self.assertFalse(r['installationAuthorized']);self.assertFalse(r['ready'])
  for key,value in [('present',True),('sha256','f'*64),('symlink',True)]:
   changed=json.loads(json.dumps(inv));changed['profiles'][r['target']][key]=value
   with self.assertRaisesRegex(ValueError,'PROFILE_OLD_(ABSENCE_REQUIRED|PRESENT_TRUST)'):m.profile_transaction('a'*40,rows,{source:raw},changed,json.dumps(changed).encode())
 def test_profile_replace_recomputes_old_authority_and_rejects_expansion(self):
  import base64,copy
  source='.harness/scripts/vm/cn_maintenance_hold.py';raw=b"profile=Path('/etc/fixture/profile.json')\nread(profile,0o600)\n";digest=m.sha(raw);rows={source:{'newSha256':digest}}
  content={'toolRevision':'b'*40,'filesSha256':{source:digest}};oldraw=(json.dumps(content,sort_keys=True)+'\n').encode()
  old={'present':True,'regular':True,'symlink':False,'sha256':m.sha(oldraw),'mode':'0600','uid':0,'gid':0,'links':1,'rawBase64':base64.b64encode(oldraw).decode()}
  inv={'profiles':{'/etc/fixture/profile.json':old},'files':{source:{'target':None}},'readOnly':True,'ready':False,'observedAt':'fixture-time','sourceInvocation':'fixture-provider'}
  proposal=m.profile_transaction('a'*40,rows,{source:raw},inv,json.dumps(inv).encode());self.assertEqual(proposal['kind'],'reviewed-profile-replace-proposal');self.assertTrue(proposal['oldPresent']);self.assertEqual(proposal['oldIdentity'],old)
  for key,value in [('uid',1000),('gid',1000),('links',2),('mode','0644'),('symlink',True),('sha256','0'*64),('rawBase64','invalid')]:
   bad=copy.deepcopy(inv);bad['profiles']['/etc/fixture/profile.json'][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):m.profile_transaction('a'*40,rows,{source:raw},bad,json.dumps(bad).encode())
  bad=copy.deepcopy(inv);expanded=dict(content,backupPrivilege=True);data=(json.dumps(expanded,sort_keys=True)+'\n').encode();bad['profiles']['/etc/fixture/profile.json'].update(rawBase64=base64.b64encode(data).decode(),sha256=m.sha(data))
  with self.assertRaisesRegex(ValueError,'OLD_CONTENT_AUTHORITY'):m.profile_transaction('a'*40,rows,{source:raw},bad,json.dumps(bad).encode())
 def test_profile_without_exact_consumer_contract_is_rejected(self):
  source='.harness/scripts/vm/cn_maintenance_hold.py';rows={source:{'newSha256':'a'*64}}
  with self.assertRaisesRegex(ValueError,'PROFILE_CONSUMER_CONTRACT'):m.profile_transaction('a'*40,rows,{source:b'profile="guessed"'}, {},b'{}')
 def receipt_fixture(self):
  expected={'region':'fixture-region','instanceId':'fixture-instance','sourceInvocation':'fixture-invocation','commandId':'fixture-command'}
  inv={'schemaVersion':1,'sourceInvocation':expected['sourceInvocation'],'observedAt':'2026-10-03T08:47:21.351070+00:00','readOnly':True,'ready':False,'profiles':{},'files':{}}
  raw=json.dumps(inv).encode();remote=dict(inv);remote.pop('sourceInvocation')
  receipt={'schemaVersion':1,**expected,'invocationStatus':'Success','exitCode':0,'dropped':0,'startTime':'2026-10-03T08:47:21Z','finishTime':None,'outputSha256':hashlib.sha256((json.dumps(remote,sort_keys=True)+'\n').encode()).hexdigest(),'inventoryObservedAt':inv['observedAt'],'localInventorySha256':hashlib.sha256(raw).hexdigest(),'readOnly':True,'productionModified':False,'ready':False}
  return raw,receipt,expected,datetime.datetime.fromisoformat('2026-10-03T08:48:00+00:00')
 def test_provider_receipt_checks_actual_bytes_target_and_time(self):
  raw,receipt,expected,now=self.receipt_fixture();encoded=json.dumps(receipt).encode();binding=m.verify_inventory_receipt(raw,encoded,expected,now)
  self.assertEqual(binding['receiptSha256'],hashlib.sha256(encoded).hexdigest());self.assertIsNone(binding['finishTime'])
  for field,value,code in [('instanceId','foreign','PROVIDER_TARGET_BINDING'),('region','foreign','PROVIDER_TARGET_BINDING'),('sourceInvocation','foreign','PROVIDER_TARGET_BINDING'),('commandId','foreign','PROVIDER_TARGET_BINDING'),('invocationStatus','Running','PROVIDER_TERMINAL_SUCCESS'),('exitCode',1,'PROVIDER_TERMINAL_SUCCESS'),('exitCode',False,'PROVIDER_TERMINAL_SUCCESS'),('dropped',1,'PROVIDER_TERMINAL_SUCCESS'),('localInventorySha256','f'*64,'PROVIDER_LOCAL_BYTES'),('outputSha256','f'*64,'PROVIDER_OUTPUT_BYTES'),('inventoryObservedAt','other','PROVIDER_OBSERVATION_BINDING'),('productionModified',True,'PROVIDER_READ_ONLY')]:
   with self.subTest(field=field):
    changed=dict(receipt);changed[field]=value
    with self.assertRaisesRegex(ValueError,code):m.verify_inventory_receipt(raw,json.dumps(changed).encode(),expected,now)
  for date in ['2026-10-03T08:47:20+00:00','2026-10-03T09:47:21+00:00']:
   with self.assertRaisesRegex(ValueError,'PROVIDER_NOT_FRESH'):m.verify_inventory_receipt(raw,encoded,expected,datetime.datetime.fromisoformat(date))
 def test_receipt_must_not_self_supply_expected_target(self):
  raw,receipt,expected,now=self.receipt_fixture()
  with self.assertRaisesRegex(ValueError,'PROVIDER_EXPECTED_BINDING'):m.verify_inventory_receipt(raw,json.dumps(receipt).encode(),None,now)
 def test_package_contains_pinned_evidence_and_profile_transaction(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,old=self.fixture(p)
   identity='.harness/scripts/vm/cn-build-tool-identity.py';hold='.harness/scripts/vm/cn_maintenance_hold.py'
   source=repo/identity;s=source.read_text();s=s.replace("FILES={", "FILES={'"+hold+"':'/usr/local/lib/fixture-hold.py',");source.write_text(s)
   (repo/hold).write_text("from pathlib import Path\ndef consumer():\n profile=Path('/etc/fixture/profile.json')\n return read(profile,0o600)\n")
   m.git(repo,'add','.');m.git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','profile')
   h=m.git(repo,'rev-parse','HEAD').decode().strip();raw,receipt,expected,now=self.receipt_fixture();value=json.loads(raw)
   value['files']=old['files'];value['files'][hold]={'target':'/usr/local/lib/fixture-hold.py','present':False,'sha256':None,'mode':None,'uid':None,'gid':None,'links':None}
   value['profiles']={'/etc/fixture/profile.json':{'present':False,'regular':False,'symlink':False,'sha256':None,'mode':None,'uid':None,'gid':None,'links':None}}
   raw=json.dumps(value).encode();inv.write_bytes(raw);receipt['localInventorySha256']=hashlib.sha256(raw).hexdigest();remote=dict(value);remote.pop('sourceInvocation');receipt['outputSha256']=hashlib.sha256((json.dumps(remote,sort_keys=True)+'\n').encode()).hexdigest()
   receipt_path=p/'receipt.json';receipt_raw=json.dumps(receipt).encode();receipt_path.write_bytes(receipt_raw)
   result=m.produce(repo,h,h,h,inv,p/'out',receipt_path,expected,now);profile=result['profileTransactionsV1'][0];e=result['inventoryEvidenceV1']
   self.assertEqual(profile['content']['toolRevision'],h);self.assertEqual(profile['inventoryEvidenceRef'],'inventoryEvidenceV1')
   self.assertEqual(pathlib.Path(e['inventoryPath']).read_bytes(),raw);self.assertEqual(pathlib.Path(e['providerReceiptPath']).read_bytes(),receipt_raw)
   self.assertEqual(e['expected'],expected);self.assertEqual(result['profileEntries'],[]);self.assertFalse(result['ready'])
   self.assertNotIn('PROVIDER_RECEIPT_BINDING_MISSING',result['installationBlockers']);self.assertIn('TOOL_ROOT_GIT_ARTIFACT_NOT_PACKAGED',result['installationBlockers'])
 def commit_fixture(self,repo):
  m.git(repo,'add','.');m.git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','tracked tree links')
  return m.git(repo,'rev-parse','HEAD').decode().strip()
 def add_skill_links(self,repo):
  links={'.claude/skills/execution-plan':'../../.agents/skills/execution-plan','.claude/skills/frontend-design':'../../.agents/skills/frontend-design'}
  for name,target in links.items():
   dest=repo/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.symlink_to(target)
   directory=repo/'.agents/skills'/pathlib.Path(name).name;directory.mkdir(parents=True,exist_ok=True);(directory/'SKILL.md').write_bytes(b'fixture committed skill\n')
  return links
 def test_real_git_two_tracked_skill_links_preserve_raw_blob_identity(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);links=self.add_skill_links(repo);h=self.commit_fixture(repo)
   result=m.produce(repo,h,h,h,inv,p/'out');entries={e['path']:e for e in result['trustedGitClosure']['entries']}
   for name,target in links.items():
    raw=m.git(repo,'show',h+':'+name);entry=entries[name]
    self.assertEqual(raw,target.encode());self.assertEqual(entry['mode'],'120000')
    self.assertEqual(entry['blobSha'],m.git(repo,'rev-parse',h+':'+name).decode().strip())
    self.assertEqual(entry['sha256'],hashlib.sha256(raw).hexdigest());self.assertEqual(entry['bytes'],len(raw))
    self.assertEqual(entry['linkTarget'],target);self.assertEqual(entry['resolvedTrackedPath'],'.agents/skills/'+pathlib.Path(name).name)
   self.assertFalse(result['ready']);self.assertFalse(result['installationAuthorized'])
 def test_real_git_rejects_absolute_escape_link_chain_cycle_and_gitlink(self):
  for scenario in ('absolute','escape','chain','cycle','submodule'):
   with self.subTest(scenario=scenario),tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
    p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);links=self.add_skill_links(repo)
    link=repo/'.claude/skills/execution-plan';link.unlink()
    if scenario=='absolute':link.symlink_to('/etc/passwd')
    elif scenario=='escape':link.symlink_to('../../../outside')
    elif scenario=='chain':
     target=repo/'.agents/skills/execution-plan';(target/'SKILL.md').unlink();target.rmdir();target.symlink_to('frontend-design');link.symlink_to(links['.claude/skills/execution-plan'])
    elif scenario=='cycle':
     link.symlink_to('frontend-design');other=repo/'.claude/skills/frontend-design';other.unlink();other.symlink_to('execution-plan')
    else:
     link.symlink_to(links['.claude/skills/execution-plan'])
    if scenario=='submodule':
     m.git(repo,'add','.');m.git(repo,'update-index','--add','--cacheinfo','160000,'+h+',vendor/submodule')
     m.git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','tracked gitlink')
     h=m.git(repo,'rev-parse','HEAD').decode().strip()
     self.assertIn(b'160000 commit',m.git(repo,'ls-tree','-r',h))
    else:h=self.commit_fixture(repo)
    code={'absolute':'TOOL_SYMLINK_RELATIVE','escape':'TOOL_SYMLINK_ESCAPE','chain':'TOOL_SYMLINK_CHAIN','cycle':'TOOL_SYMLINK_CHAIN','submodule':'TOOL_TREE_REGULAR_ONLY'}[scenario]
    with self.assertRaisesRegex(ValueError,code):m.produce(repo,h,h,h,inv,p/'out')
    self.assertFalse((p/'out').exists())
 def test_real_git_rejects_transient_links_and_malformed_raw_targets(self):
  for scenario in ('untracked','transient','non-directory','root-cycle','ancestor-cycle','empty','nul','newline','oversize'):
   with self.subTest(scenario=scenario),tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
    p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);self.add_skill_links(repo);link=repo/'.claude/skills/execution-plan';link.unlink()
    raw={'untracked':b'../../.agents/skills/missing','transient':b'frontend-design/../execution-plan','non-directory':b'../../.agents/skills/frontend-design/SKILL.md/../','root-cycle':b'../..','ancestor-cycle':b'..','empty':b'','nul':b'target\x00tail','newline':b'target\n','oversize':b'x'*4097}[scenario]
    m.git(repo,'add','.')
    blob=subprocess.check_output(['git','-C',str(repo),'hash-object','-w','--stdin'],input=raw).decode().strip()
    m.git(repo,'update-index','--add','--cacheinfo','120000,'+blob+',.claude/skills/execution-plan')
    m.git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','exact raw malicious link')
    h=m.git(repo,'rev-parse','HEAD').decode().strip();self.assertEqual(m.git(repo,'show',h+':.claude/skills/execution-plan'),raw)
    code={'untracked':'TOOL_SYMLINK_UNTRACKED','transient':'TOOL_SYMLINK_CHAIN','non-directory':'TOOL_SYMLINK_NON_DIRECTORY','root-cycle':'TOOL_SYMLINK_DIRECTORY_CYCLE','ancestor-cycle':'TOOL_SYMLINK_DIRECTORY_CYCLE','empty':'TOOL_SYMLINK_SIZE','nul':'TOOL_SYMLINK_RELATIVE','newline':'TOOL_SYMLINK_RELATIVE','oversize':'TOOL_SYMLINK_SIZE'}[scenario]
    with self.assertRaisesRegex(ValueError,code):m.produce(repo,h,h,h,inv,p/'out')
    self.assertFalse((p/'out').exists())
 def test_real_git_128_allowlisted_sources_cannot_be_exact_link(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);identity='.harness/scripts/vm/cn-build-tool-identity.py'
   sources={identity:'/usr/local/bin/fixture'}|{'.harness/scripts/vm/source-'+str(n)+'.py':'/usr/local/lib/fixture-'+str(n) for n in range(127)}
   (repo/identity).write_text('FILES='+repr(sources)+"\ndef validate_identity(value,tool):\n return value.get('toolRoot')=='/opt/workspacex-cn/release-tools/'+tool\n")
   for name,target in sources.items():
    if name!=identity:
     (repo/name).write_bytes(b'actual source\n');v['files'][name]={'target':target,'present':False,'sha256':None,'mode':None,'uid':None,'gid':None,'links':None}
   source=repo/'.harness/scripts/vm/source-0.py';source.unlink();source.symlink_to('source-1.py');h=self.commit_fixture(repo);inv.write_text(json.dumps(v))
   with self.assertRaisesRegex(ValueError,'TOOL_INSTALL_SOURCE_SYMLINK'):m.produce(repo,h,h,h,inv,p/'out')
   self.assertFalse((p/'out').exists())
 def test_real_git_128_allowlisted_sources_cannot_follow_link_ancestor(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as d:
   p=pathlib.Path(d);repo,h,inv,v=self.fixture(p);identity='.harness/scripts/vm/cn-build-tool-identity.py'
   sources={identity:'/usr/local/bin/fixture'}|{'.harness/linked/source-'+str(n)+'.py':'/usr/local/lib/fixture-'+str(n) for n in range(127)}
   (repo/identity).write_text('FILES='+repr(sources)+"\ndef validate_identity(value,tool):\n return value.get('toolRoot')=='/opt/workspacex-cn/release-tools/'+tool\n")
   target=repo/'ordinary';target.mkdir()
   for n in range(127):(target/('source-'+str(n)+'.py')).write_bytes(b'actual tracked source\n')
   (repo/'.harness/linked').symlink_to('../ordinary');h=self.commit_fixture(repo)
   for name,target in sources.items():
    if name!=identity:v['files'][name]={'target':target,'present':False,'sha256':None,'mode':None,'uid':None,'gid':None,'links':None}
   inv.write_text(json.dumps(v))
   with self.assertRaisesRegex(ValueError,'TOOL_INSTALL_SOURCE_SYMLINK'):m.produce(repo,h,h,h,inv,p/'out')
   self.assertFalse((p/'out').exists())
if __name__=='__main__':unittest.main()
