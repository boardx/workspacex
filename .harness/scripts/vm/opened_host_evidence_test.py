import copy,datetime,hashlib,json,types,unittest,sys
from unittest.mock import patch
import opened_host_evidence as m
from writer_fence import digest
def mock_call(transport,operation,*args):
 profile=json.dumps(dict(candidateComposeEmitter=dict(dockerPath='/usr/bin/docker',dockerSha256='d'*64,dockerSocket=dict(device=1,inode=2,uid=0,gid=0,mode=0o660)))).encode()
 source=types.SimpleNamespace(private=lambda _:profile,invoke=lambda _plan,_binary,cmd,*_:transport.host.run(['/usr/bin/docker',*cmd[4:]]))
 with patch.dict(sys.modules,{'compiled_maintenance_activation':source}),patch('candidate_readonly_docker.socket_authority',lambda e:e['dockerSocket']):return operation(*args)
class Tests(unittest.TestCase):
 def fixture(self):
  n=1791133200.0;i=dict(sourceRevision=m.APP,baselineRevision=m.BASE,migrationPlanSha256='a'*64,attemptId='owned');p=dict(identity=i,holdGeneration='b'*32,candidateWriters=[]);f={};b=dict(identity=i,deploymentMarker='marker')
  for lane in ('canonical','browser'):
   v=dict(schemaVersion=1,kind=lane+'-acceptance-completed',identity=i,deploymentMarker='marker',observedAt=datetime.datetime.fromtimestamp(n,datetime.timezone.utc).isoformat(),ownedAcceptanceRunIds=[] if lane=='canonical' else [lane+'-run'],checks={'status':'passed','lockRetained':True,'passedStages':8} if lane=='canonical' else {k:True for k in ('login','hello','asr','githubFeedbackRead','skillTool','pdfDownload')})
   path=f'/etc/workspacex-cn/maintenance-acceptance/{m.APP}/owned/{lane}.json';raw=json.dumps(v).encode();f[path]=raw;b[lane+'Receipt']=dict(path=path,sha256=hashlib.sha256(raw).hexdigest())
  h=dict(schemaVersion=1,state='cleared',identity=i,generation='b'*32,sha256='c'*64,device=1,inode=2);d=[];calls=[]
  for x,s in enumerate(m.SERVICES):
   config=dict(Labels={'com.docker.compose.service':s});binding=dict(service=s,containerId=str(x)*64,imageId='image'+s,configSha256=digest(config));p['candidateWriters'].append(dict(binding=binding));d.append(dict(Id=binding['containerId'],Image=binding['imageId'],Config=config,State=dict(Status='running',Health=dict(Status='healthy'))))
  def query(k,params):calls.append((k,params));return dict(rows=[dict(id=v,status='succeeded') for v in params['runIds']])
  def run(args):
   self.assertEqual(args[:2],['/usr/bin/docker','exec']);return json.dumps(dict(web={'deploymentMarker':'marker'},api={'deploymentMarker':'marker','trustworthy':True},agent={'ok':True,'runtime':'workspacex-self-hosted'},sandbox={'ok':True})).encode()
  host=types.SimpleNamespace(run=run,read_hold=lambda:copy.deepcopy(h),docker_inventory=lambda:copy.deepcopy(d),diagnostic_connections={'workspacex':types.SimpleNamespace(query=query)})
  t=types.SimpleNamespace(plan=p,host=host,collector=types.SimpleNamespace(collect_opened=lambda *_:None),require_lock=lambda:None,observe_opened_candidate=lambda *_:dict(observedAt=n,runDrain=dict(queued=0,running=0,writebackPending=0)))
  return t,b,f,h,d,calls,n
 def test_actual_sample(self):
  t,b,f,h,d,c,n=self.fixture();v=mock_call(t,m.collect_opened_host_evidence,t,b,f.__getitem__,lambda:n);self.assertEqual(v['hold']['inode'],2);self.assertEqual(v['services'],{s:'healthy' for s in m.SERVICES});self.assertEqual(c,[('owned-release-runs',{'runIds':['browser-run']})])
 def test_health_and_receipt_failclosed(self):
  for mode in ('health','missing','hash'):
   t,b,f,h,d,c,n=self.fixture()
   if mode=='health':d[0]['State']['Status']='stopped'
   elif mode=='missing':d.pop()
   else:b['browserReceipt']['sha256']='d'*64
   with self.assertRaises(Exception):mock_call(t,m.collect_opened_host_evidence,t,b,f.__getitem__,lambda:n)
   self.assertEqual(c,[])
 def test_missing_query_or_failed_rows(self):
  for mode in ('unsupported','failed'):
   t,b,f,h,d,c,n=self.fixture()
   if mode=='unsupported':t.host.diagnostic_connections['workspacex'].query=lambda *_:(_ for _ in ()).throw(RuntimeError('DIAGNOSTIC_QUERY_AUTHORITY'))
   else:t.host.diagnostic_connections['workspacex'].query=lambda *_:dict(rows=[dict(id='canonical-run',status='failed'),dict(id='browser-run',status='succeeded')])
   with self.assertRaises(Exception):mock_call(t,m.collect_opened_host_evidence,t,b,f.__getitem__,lambda:n)
 def test_unsafe_queue_or_hold_drift(self):
  t,b,f,h,d,c,n=self.fixture();t.observe_opened_candidate=lambda *_:dict(observedAt=n,runDrain=dict(queued=2**53,running=0,writebackPending=0))
  with self.assertRaises(Exception):mock_call(t,m.collect_opened_host_evidence,t,b,f.__getitem__,lambda:n)
  t,b,f,h,d,c,n=self.fixture();count=0
  def hold():
   nonlocal count
   count+=1;return dict(h,inode=2 if count==1 else 3)
  t.host.read_hold=hold
  with self.assertRaises(Exception):mock_call(t,m.collect_opened_host_evidence,t,b,f.__getitem__,lambda:n)
if __name__=='__main__':unittest.main()
