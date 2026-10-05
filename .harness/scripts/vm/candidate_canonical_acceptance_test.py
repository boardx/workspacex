import copy,hashlib,json,sys,types,unittest
from unittest.mock import patch
import candidate_canonical_acceptance as m
from writer_fence import digest
from candidate_stage_host import candidate_stage_profile_sha256
class Tests(unittest.TestCase):
 def fixture(self):
  i=dict(sourceRevision=m.APP,baselineRevision=m.BASE,migrationPlanSha256='a'*64,attemptId='canonical');host=dict(instanceId='host',bootId='boot');files={};calls=[];live=[];plan=dict(identity=i,host=host,holdGeneration='b'*32,epoch='e'*64,candidateWriters=[],baselineWriters=[])
  def ref(path,raw):files[path]=raw;return dict(path=path,sha256=hashlib.sha256(raw).hexdigest())
  for index,(project,service) in enumerate([('candidate',s) for s in sorted(m.SERVICES)]+[('baseline','api')]):
   compose='/etc/workspacex-cn/'+project+'.json';cr=ref(compose,json.dumps(dict(name=project,services={},networks={'default':{'external':True,'name':project+'-runtime'}})).encode());cid=hex(index+1)[2:]*64
   cfg=dict(Labels={'com.docker.compose.project':project,'com.docker.compose.service':service,'com.docker.compose.project.config_files':compose,'org.opencontainers.image.revision':m.APP if project=='candidate' else m.BASE})
   network={'none':dict(IPAMConfig=None,Links=None,Aliases=None,MacAddress='',NetworkID='9'*64,EndpointID=hex(index+10)[2:]*64,Gateway='',IPAddress='',IPPrefixLen=0,IPv6Gateway='',GlobalIPv6Address='',GlobalIPv6PrefixLen=0,DNSNames=None)} if service.startswith('sandbox') else {project+'-runtime':dict(NetworkID=project+'-network',Aliases=[service],DNSNames=[service])}
   v=dict(Id=cid,Image='image-'+project+'-'+service,Config=cfg,HostConfig=dict(NetworkMode='none' if service.startswith('sandbox') else project+'-runtime',PortBindings=None,PublishAllPorts=False),Mounts=[],NetworkSettings=dict(Networks=network,Ports=None),State=dict(Running=project=='candidate',Paused=False));live.append(v)
   w=dict(key=project+'-'+service,binding=dict(service=service,containerId=cid,imageId=v['Image'],configSha256=digest(cfg),composePath=compose,composeSha256=cr['sha256']))
   plan['candidateWriters' if project=='candidate' else 'baselineWriters'].append(w)
  none=dict(Id='9'*64,Name='none',Driver='null',Scope='local',Containers={v['Id']:dict(EndpointID=v['NetworkSettings']['Networks']['none']['EndpointID'],MacAddress='',IPv4Address='',IPv6Address='') for v in live if 'none' in v['NetworkSettings']['Networks']})
  approved=dict(Id='candidate-network',Name='candidate-runtime',Driver='bridge',Internal=False,IPAM={},Options={})
  networkref=ref('/etc/workspacex-cn/network.json',json.dumps(approved).encode());manifestref=ref('/etc/workspacex-cn/manifest.json',b'manifest');composeref=dict(path='/etc/workspacex-cn/candidate.json',sha256=hashlib.sha256(files['/etc/workspacex-cn/candidate.json']).hexdigest())
  optionsref=ref('/etc/workspacex-cn/options.json',json.dumps(dict(projectName='candidate',composeRef=composeref,manifestRef=manifestref,networkRef=networkref)).encode())
  profile_raw=json.dumps(dict(toolRevision='f'*40,maintenanceSourceOperations=dict(schemaVersion=1,sourcePath='.harness/scripts/vm/maintenance_source_operations.py',sha256='a'*64,inputs={}),maintenanceBrowserRuntime=dict(nodeSha256='c'*64),candidateComposeEmitter=dict(optionsRef=optionsref,dockerPath='/usr/bin/docker',dockerSha256='d'*64,dockerSocket=dict(device=1,inode=2,uid=0,gid=0,mode=0o660)))).encode()
  bound=dict(identity=i,host=host,holdGeneration=plan['holdGeneration'],epoch=plan['epoch'],toolRevision='f'*40)
  stage=dict(schemaVersion=1,kind='source-inspected-candidate-stage-snapshot',binding=bound,sourceProfileSha256=candidate_stage_profile_sha256(json.loads(profile_raw)),composeRef=composeref,manifestRef=manifestref,containers=copy.deepcopy(live),candidateContainerIds=[w['binding']['containerId'] for w in plan['candidateWriters']],baselineContainerIds=[w['binding']['containerId'] for w in plan['baselineWriters']])
  binding=dict(identity=i,candidateConfig=ref('/etc/workspacex-cn/deployment.json',b'config'),candidateNginx=ref('/etc/nginx/conf.d/workspacex-cn.conf',b'nginx'),stageInspection=ref(f'/etc/workspacex-cn/maintenance-candidate/{m.APP}/canonical/stage-snapshot.json',json.dumps(stage).encode()),browserPlan=ref('/etc/workspacex-cn/browser.json',b'{"publicUrl":"https://example.invalid/","deploymentMarker":"marker"}'),nodeBinary=dict(path='/usr/bin/node',sha256='c'*64))
  artifact=ref('/etc/workspacex-cn/artifact.json',b'artifact');plan['artifactSha256']=artifact['sha256']
  def run(args):
   calls.append(args);self.assertEqual(args[:4],['/usr/bin/docker','exec','--env','PROVISION_TIMEOUT_MS=10000']);self.assertNotIn('workspacex-cn-api-1',args)
   return json.dumps(dict(ok=True,database=True,migrations=True,redis=True) if args[-1]=='scripts/data-readiness.ts' else dict(ok=True,web=True,api=True,agentGraphs=True)).encode()
  def inventory(_):return {w['key']:dict(binding=w['binding'],state='running' if w in plan['candidateWriters'] else 'stopped') for w in plan['candidateWriters']+plan['baselineWriters']}
  t=types.SimpleNamespace(plan=plan,artifact=artifact,private=files.__getitem__,require_lock=lambda:None,_guard=lambda p:self.assertEqual(p,plan),docker_inventory=lambda:live,_inventory=inventory,host=types.SimpleNamespace(run=run,plan=dict(toolRevision='f'*40)))
  def private(path,expected=None):
   if path=='/etc/workspacex-cn/trusted-tool-binding.json':return profile_raw
   raw=files[path];self.assertTrue(expected is None or hashlib.sha256(raw).hexdigest()==expected);return raw
  def invoke(_plan,binary,args,*_):
   if binary=='docker' and args[-3:]==['network','inspect','candidate-runtime']:calls.append('network');return json.dumps([approved]).encode()
   if binary=='docker' and args[-3:]==['network','inspect','none']:calls.append('none');return json.dumps([none]).encode()
   if binary=='docker':return run(['/usr/bin/docker',*args[4:]])
   calls.append('public');return b'{"publicReadOnlyVerified":true}'
  source=types.SimpleNamespace(private=private,installed_code=lambda name:(calls.append(name) or b'module.exports={};'),invoke=invoke)
  return t,binding,source,live,calls
 def test_candidate_ids_and_actual_network_are_used_for_all_eight_checks(self):
  t,b,s,d,c=self.fixture()
  with patch('candidate_readonly_docker.socket_authority',lambda e:e['dockerSocket']),patch.dict(sys.modules,{'compiled_maintenance_activation':s}):v=m.candidate_canonical_receipt(t,b)
  self.assertEqual(v['checks']['passedStages'],8);self.assertEqual(v['ownedAcceptanceRunIds'],[])
  api=[w for w in t.plan['candidateWriters'] if w['binding']['service']=='api'][0]['binding']['containerId'];self.assertTrue(all(args[4]==api for args in c if type(args) is list));self.assertEqual([v for v in c if v in ('cn-maintenance-canonical.cjs','public')],['cn-maintenance-canonical.cjs','public']);self.assertEqual(c.count('none'),2)
 def test_network_fullconfig_or_baseline_alias_reject_before_scripts(self):
  for mode in ('network','hostconfig','mount','project'):
   t,b,s,d,c=self.fixture()
   if mode=='network':d[0]['NetworkSettings']['Networks']['candidate-runtime']['NetworkID']='other'
   elif mode=='hostconfig':d[0]['HostConfig']['NetworkMode']='host'
   elif mode=='mount':d[0]['Mounts']=[dict(Source='other')]
   else:d[0]['Config']['Labels']['com.docker.compose.project']='baseline'
   with patch('candidate_readonly_docker.socket_authority',lambda e:e['dockerSocket']),patch.dict(sys.modules,{'compiled_maintenance_activation':s}):
    with self.assertRaises(Exception):m.candidate_canonical_receipt(t,b)
   self.assertFalse(any(type(v) is list for v in c))
 def test_script_or_public_failure_never_produces_receipt(self):
  for mode in ('script','public'):
   t,b,s,d,c=self.fixture()
   if mode=='script':
    original=s.invoke;s.invoke=lambda plan,binary,args,*rest: b'{"ok":true}' if 'exec' in args else original(plan,binary,args,*rest)
   else:
    original=s.invoke;s.invoke=lambda plan,binary,*args:original(plan,binary,*args) if binary=='docker' else b'{"publicReadOnlyVerified":false}'
   with patch('candidate_readonly_docker.socket_authority',lambda e:e['dockerSocket']),patch.dict(sys.modules,{'compiled_maintenance_activation':s}):
    with self.assertRaises(Exception):m.candidate_canonical_receipt(t,b)
 def test_source_snapshot_contract_rejects_missing_baseline_profile_and_old_kind(self):
  for field,value in [('baselineContainerIds',[]),('sourceProfileSha256','0'*64),('kind','candidate-staged-container-inspection')]:
   t,b,source,d,c=self.fixture();path=b['stageInspection']['path'];stage=json.loads(t.private(path));stage[field]=value
   raw=json.dumps(stage).encode();original=t.private;t.private=lambda p:raw if p==path else original(p);b['stageInspection']['sha256']=hashlib.sha256(raw).hexdigest()
   with patch('candidate_readonly_docker.socket_authority',lambda e:e['dockerSocket']),patch.dict(sys.modules,{'compiled_maintenance_activation':source}):
    with self.assertRaises(Exception):m.candidate_canonical_receipt(t,b)
   self.assertFalse(any(type(v) is list for v in c))
 def test_stopped_snapshot_empty_networkid_uses_approved_actual_network(self):
  t,b,source,d,c=self.fixture();path=b['stageInspection']['path'];stage=json.loads(t.private(path))
  for container in stage['containers']:
   if container['Id'] in stage['candidateContainerIds']:
    container['State']=dict(Running=False,Paused=False)
    for name,network in container['NetworkSettings']['Networks'].items():
     network['NetworkID']=''
     if name=='none':network['EndpointID']=''
  raw=json.dumps(stage).encode();original=t.private;t.private=lambda p:raw if p==path else original(p);b['stageInspection']['sha256']=hashlib.sha256(raw).hexdigest()
  with patch('candidate_readonly_docker.socket_authority',lambda e:e['dockerSocket']),patch.dict(sys.modules,{'compiled_maintenance_activation':source}):v=m.candidate_canonical_receipt(t,b)
  self.assertEqual(v['checks']['passedStages'],8)
 def test_no_compiled_closure_rejects_without_legacy_fallback(self):
  t,b,s,d,c=self.fixture()
  with patch('candidate_readonly_docker.socket_authority',lambda e:e['dockerSocket']),patch.dict(sys.modules,{'compiled_maintenance_activation':None}):
   with self.assertRaises(ModuleNotFoundError):m.candidate_canonical_receipt(t,b)

 def test_late_root_canonical_input_approval_does_not_invalidate_snapshot(self):
  t,b,source,d,c=self.fixture();original=source.private
  profile=json.loads(original('/etc/workspacex-cn/trusted-tool-binding.json'))
  profile['maintenanceSourceOperations']['inputs']['canonical-candidate-acceptance']={'path':'/etc/workspacex-cn/maintenance-source-inputs/'+m.APP+'/canonical/canonical-candidate-acceptance.json','sha256':digest(b)}
  raw=json.dumps(profile).encode();source.private=lambda path,expected=None:raw if path=='/etc/workspacex-cn/trusted-tool-binding.json' else original(path,expected)
  with patch('candidate_readonly_docker.socket_authority',lambda e:e['dockerSocket']),patch.dict(sys.modules,{'compiled_maintenance_activation':source}):
   self.assertEqual(m.candidate_canonical_receipt(t,b)['checks']['passedStages'],8)
  profile['maintenanceSourceOperations']['inputs']['browser-candidate-acceptance']={'path':'/etc/workspacex-cn/browser.json','sha256':'0'*64}
  raw=json.dumps(profile).encode()
  with patch.dict(sys.modules,{'compiled_maintenance_activation':source}):
   with self.assertRaisesRegex(RuntimeError,'STAGE_PROFILE'):m.candidate_canonical_receipt(t,b)


class DockerStateTransitionTests(unittest.TestCase):
 def endpoint_fixture(self):
  approved=dict(Id='c'*64,Name='candidate-runtime',IPAM=dict(Config=[dict(Subnet='10.0.0.0/24',Gateway='10.0.0.1')]))
  endpoint=dict(NetworkID='c'*64,Aliases=['candidate-api-1','api'],DNSNames=None,IPAMConfig=None,Links=None,DriverOpts=None,EndpointID='',Gateway='',IPAddress='',IPPrefixLen=0,IPv6Gateway='',GlobalIPv6Address='',GlobalIPv6PrefixLen=0,MacAddress='')
  frozen=dict(Id='a'*64,Name='/candidate-api-1',Config=dict(Hostname='a'*12),HostConfig=dict(NetworkMode='candidate-runtime'),State=dict(Running=False,Paused=False),NetworkSettings=dict(Networks={'candidate-runtime':endpoint}))
  live=copy.deepcopy(frozen);live['State']=dict(Running=True,Paused=False);e=live['NetworkSettings']['Networks']['candidate-runtime'];e.update(DNSNames=['candidate-api-1','api','a'*12],EndpointID='b'*64,Gateway='10.0.0.1',IPAddress='10.0.0.2',IPPrefixLen=24,MacAddress='02:42:0a:00:00:02')
  return live,frozen,approved
 def test_created_candidate_running_dns_is_exact_source_name_alias_id_hostname(self):
  actual,frozen,approved=self.endpoint_fixture();m._verify_network_transition(actual,frozen,True,approved)
  for extra in ('other-service','foreign-host'):
   value=copy.deepcopy(actual);value['NetworkSettings']['Networks']['candidate-runtime']['DNSNames'].append(extra)
   with self.assertRaisesRegex(RuntimeError,'DNS_DRIFT'):m._verify_network_transition(value,frozen,True,approved)
 def test_candidate_new_alias_or_network_or_wrong_approved_subnet_rejects(self):
  for mode in ('alias','network','ip','id'):
   actual,frozen,approved=self.endpoint_fixture();e=actual['NetworkSettings']['Networks']['candidate-runtime']
   if mode=='alias':e['Aliases'].append('foreign')
   elif mode=='network':actual['NetworkSettings']['Networks']['other-runtime']=copy.deepcopy(e)
   elif mode=='ip':e['IPAddress']='10.1.0.2'
   else:e['NetworkID']='d'*64
   with self.assertRaises(Exception):m._verify_network_transition(actual,frozen,True,approved)
 def test_baseline_paused_to_stopped_clears_only_known_operational_fields(self):
  snapshot,_,_=self.endpoint_fixture();snapshot['State']=dict(Running=True,Paused=True);actual=copy.deepcopy(snapshot);actual['State']=dict(Running=False,Paused=False)
  actual['NetworkSettings']['Networks']['candidate-runtime'].update(m._OPERATIONAL_EMPTY)
  m._verify_network_transition(actual,snapshot,False)
  for field,value in [('NetworkID',''),('DNSNames',[]),('Aliases',[]),('DriverOpts',{'unapproved':'value'})]:
   bad=copy.deepcopy(actual);bad['NetworkSettings']['Networks']['candidate-runtime'][field]=value
   with self.assertRaises(Exception):m._verify_network_transition(bad,snapshot,False)
 def test_paused_baseline_cannot_change_endpoint_and_stopped_cannot_keep_active_endpoint(self):
  snapshot,_,_=self.endpoint_fixture();snapshot['State']=dict(Running=True,Paused=True);bad=copy.deepcopy(snapshot)
  bad['NetworkSettings']['Networks']['candidate-runtime']['EndpointID']='d'*64
  with self.assertRaises(Exception):m._verify_network_transition(bad,snapshot,False)
  stopped=copy.deepcopy(snapshot);stopped['State']=dict(Running=False,Paused=False)
  with self.assertRaises(Exception):m._verify_network_transition(stopped,snapshot,False)


class NoneDriverTests(unittest.TestCase):
 def fixture(self):
  endpoint=dict(IPAMConfig=None,Links=None,Aliases=None,MacAddress='',NetworkID='9'*64,EndpointID='b'*64,Gateway='',IPAddress='',IPPrefixLen=0,IPv6Gateway='',GlobalIPv6Address='',GlobalIPv6PrefixLen=0,DNSNames=None)
  actual=dict(Id='a'*64,HostConfig=dict(NetworkMode='none',PortBindings=None,PublishAllPorts=False),State=dict(Running=True,Paused=False),NetworkSettings=dict(Networks={'none':endpoint},Ports=None))
  frozen=copy.deepcopy(actual);frozen['State']=dict(Running=False,Paused=False);frozen['NetworkSettings']['Networks']['none'].update(NetworkID='',EndpointID='')
  authority=dict(Id='9'*64,Name='none',Driver='null',Scope='local',Containers={'a'*64:dict(EndpointID='b'*64,MacAddress='',IPv4Address='',IPv6Address='')})
  return actual,frozen,authority
 def test_source_none_allocates_only_identity_without_ip_or_routes(self):
  a,f,n=self.fixture();m._verify_network_transition(a,f,True,source_none=n)
 def test_unknown_driver_owner_or_endpoint_rejects(self):
  for mode in ('driver','owner','endpoint','empty','network'):
   a,f,n=self.fixture()
   if mode=='driver':n['Driver']='bridge'
   elif mode=='owner':n['Containers']={}
   elif mode=='endpoint':a['NetworkSettings']['Networks']['none']['EndpointID']='c'*64
   elif mode=='network':a['NetworkSettings']['Networks']['none']['NetworkID']='c'*64
   else:a['NetworkSettings']['Networks']={}
   with self.assertRaises(Exception):m._verify_network_transition(a,f,True,source_none=n)
 def test_none_cannot_acquire_ip_route_mac_names_or_ports(self):
  for key,value in [('IPAddress','10.0.0.1'),('Gateway','10.0.0.1'),('MacAddress','02:42:00:00:00:01'),('Aliases',['api']),('DNSNames',['api']),('IPPrefixLen',24)]:
   a,f,n=self.fixture();a['NetworkSettings']['Networks']['none'][key]=value
   with self.assertRaises(Exception):m._verify_network_transition(a,f,True,source_none=n)
  a,f,n=self.fixture();a['HostConfig']['PortBindings']={'80/tcp':[{'HostPort':'80'}]}
  with self.assertRaises(Exception):m._verify_network_transition(a,f,True,source_none=n)
 def test_running_empty_metadata_and_unqualified_frozen_ids_reject(self):
  a,f,n=self.fixture();a['NetworkSettings']['Networks']['none'].update(NetworkID='',EndpointID='');n['Containers']={}
  with self.assertRaises(Exception):m._verify_network_transition(a,f,True,source_none=n)
  a,f,n=self.fixture();f['State']['Running']=True
  with self.assertRaises(Exception):m._verify_network_transition(a,f,True,source_none=n)

if __name__=='__main__':unittest.main()
