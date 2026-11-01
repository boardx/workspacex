import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
s=importlib.util.spec_from_file_location('activation',Path(__file__).resolve().parents[1]/'scripts/tag-migrated-activation.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_budget_reserves_recovery_verifier_and_outer_probe(self):
  p={'activationSeconds':120,'rollbackSeconds':120,'verifierSeconds':30,'outerVerificationSeconds':120,'runtimeSeconds':20,'candidateProbe':{'timeoutSeconds':30},'oldProbe':{'timeoutSeconds':30}}
  m.budget(p,{'expiresAt':600},now=1)
  for change in [{'expiresAt':300},{'expiresAt':700}]:
   with self.assertRaises(ValueError):m.budget(p,change,now=1)
  p['oldProbe']['timeoutSeconds']=300
  with self.assertRaises(ValueError):m.budget(p,{'expiresAt':600},now=1)
 def test_only_exact_three_api_additions_can_activate(self):
  plan={'complete':True,'route':'schema-preparation','changes':[{'role':'api','added':['a','b','c'],'removed':[],'changed':[]}]};m.exact_changes(plan,{'a':1,'b':2,'c':3})
  for value in [dict(plan,complete=False),dict(plan,route='maintenance-review'),dict(plan,changes=[{'role':'agent','added':['a','b','c'],'removed':[],'changed':[]}])]:
   with self.assertRaises(ValueError):m.exact_changes(value,{'a':1,'b':2,'c':3})
 def test_changed_live_config_rejected_despite_same_images(self):
  engine=Mock();engine.resolved_config_hash.return_value=['api','current-config']
  rows=[{'Config':{'Labels':{'com.docker.compose.service':'api','com.docker.compose.config-hash':'stale-config'}}}]
  with self.assertRaisesRegex(ValueError,'LIVE_CONFIG_DRIFT'):m.live_config_cas(engine,Mock(),{},'project',rows,Path('/private'))
  rows[0]['Config']['Labels']['com.docker.compose.config-hash']='current-config'
  m.live_config_cas(engine,Mock(),{},'project',rows,Path('/private'))
 def test_health_uses_loopback_route_with_real_tls_hostname(self):
  for environment,host in [('us','appv1.boardx.us'),('cn','app.boardx.com.cn')]:
   run=Mock(return_value=b'{"trustworthy":true}\n200')
   result=m.loopback_health(environment,{'url':'https://'+host+'/api/healthz','expected':{'trustworthy':True}},3,run)
   args=run.call_args.args[0];self.assertEqual(args[:2],['/usr/bin/curl','--disable']);self.assertTrue(result['tlsVerification']);self.assertIn(host+':443:127.0.0.1',args);self.assertEqual(args[-1],'https://'+host+'/api/healthz');self.assertIn('--fail',args);self.assertNotIn('--insecure',args);self.assertNotIn('-k',args);self.assertNotIn('--location',args);self.assertEqual(args[args.index('--write-out')+1],r'\n%{http_code}')
 def test_health_rejects_foreign_host_http_redirect_or_wrong_body(self):
  config={'url':'https://appv1.boardx.us/api/healthz','expected':{'trustworthy':True}}
  run=Mock(return_value=b'{"trustworthy":true}\n200')
  for url in ['http://appv1.boardx.us/api/healthz','https://evil/api/healthz','https://appv1.boardx.us:444/api/healthz','https://appv1.boardx.us/api/healthz?skip=1']:
   with self.assertRaises(ValueError):m.loopback_health('us',{**config,'url':url},3,run)
  run.assert_not_called()
  for raw in [b'{"trustworthy":true}\n503',b'{"trustworthy":true}\n301',b'{"trustworthy":false}\n200',b'[]\n200']:
   with self.assertRaises(ValueError):m.loopback_health('us',config,3,Mock(return_value=raw))
  with self.assertRaises(RuntimeError):m.loopback_health('us',config,3,Mock(side_effect=RuntimeError('certificate verification failed')))
 def test_held_runtime_scopes_transport_and_restores_engine_health(self):
  from types import SimpleNamespace
  original=Mock(side_effect=RuntimeError('public health is blocked by maintenance'))
  engine=SimpleNamespace(health=original)
  engine.verify_runtime=lambda d,command,services,images,config:engine.health(config['health'],timeout=3)
  host=SimpleNamespace(run=Mock(return_value=b'{"trustworthy":true}\n200'))
  ctx={'engine':engine,'maint':SimpleNamespace(Host=Mock(return_value=host)),'old_policy':{},'attempt':Path('/private'),'fd':3,'request':{'environment':'us'},'config':{'services':{},'health':{'url':'https://appv1.boardx.us/api/healthz','expected':{'trustworthy':True}}},'d':None,'p':{'runtimeSeconds':10}}
  self.assertEqual(m.verify_held_runtime(ctx,[],{})['httpStatus'],200);self.assertIs(engine.health,original);original.assert_not_called()
  host.run.side_effect=RuntimeError('TLS failed')
  with self.assertRaises(RuntimeError):m.verify_held_runtime(ctx,[],{})
  self.assertIs(engine.health,original)
 def test_no_ddl_or_schema_equal_waiver(self):
  text=Path(m.__file__).read_text();self.assertNotIn("run('apply')",text);self.assertNotIn('engine.release(',text);self.assertNotIn('schemaInventoriesEqual=True',text)
if __name__=='__main__':unittest.main()

class ActivationFlow(unittest.TestCase):
 def execute(self,fail_candidate=False):
  import tempfile,json,copy
  from unittest.mock import patch
  from types import SimpleNamespace
  ms=importlib.util.spec_from_file_location('maintenance_flow',Path(m.__file__).with_name('tag-maintenance-release.py'));maint=importlib.util.module_from_spec(ms);ms.loader.exec_module(maint)
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);nginx=root/'nginx';nginx.write_bytes(b'server { server_name appv1.boardx.us; }');attempt=root/'attempt';attempt.mkdir();old_attempt=root/'old';old_attempt.mkdir();(old_attempt/'receipt.json').write_text('{}');(old_attempt/'stopped-backup').mkdir();(old_attempt/'stopped-backup/qualification.json').write_text('{}')
   services={'api':'api','web':'web','agent':'agent','sandbox':'sandbox','sandbox-sessions':'sandbox'}
   old={s:'old-'+s for s in services};new={s:'new-'+role for s,role in services.items()};original={'services':{s:{'image':old[s],'environment':{'PRESERVED':'yes'}} for s in services}}
   class Docker:
    def __init__(self):self.images=dict(old);self.up=[]
    def run(self,args,**kw):
     if args[0]=='ps':return ('id-'+args[-1].split('=')[-1]).encode()
     if 'up' in args:
      overlay=Path(args[args.index('--file')+1]);self.images={s:v['image'] for s,v in json.loads(overlay.read_text())['services'].items()};self.up.append(dict(self.images))
     return b''
    def json(self,args,**kw):
     if args[0]=='inspect':
      service=args[1][3:];return [{'Id':'id-'+service,'Image':self.images[service],'State':{'Running':True},'Config':{'Labels':{'com.docker.compose.service':service,'com.docker.compose.project':'project','com.docker.compose.config-hash':'same'}}}]
     result=copy.deepcopy(original)
     if '--file' in args:
      overlay=Path(args[args.index('--file')+1]);change=json.loads(overlay.read_text())
      for s,v in change['services'].items():result['services'][s]['image']=v['image']
     return result
   d=Docker();engine=Mock();engine.save=maint.save;engine.sha_file=lambda p:__import__('hashlib').sha256(Path(p).read_bytes()).hexdigest();engine.resolved_config_hash=lambda d,o,p,s,a:[s,'same'];engine.schema=lambda *a:{};engine.verify_runtime.return_value={'healthy':True}
   class Host:
    def __init__(self,*args):pass
    def nginx(self,a,b):
     if nginx.read_bytes()!=a:raise ValueError('nginxcas')
     nginx.write_bytes(b)
   fake_maint=SimpleNamespace(save=maint.save,pinned=lambda ref,**kw:Path(ref['path']),maintenance_bytes=maint.maintenance_bytes,Host=Host)
   request={'sourceRevision':m.SOURCE,'tag':m.TAG,'environment':'us','expiresAt':__import__('time').time()+599,'planSha256':'plan','manifestSha256':'manifest'}
   p={'activationSeconds':120,'rollbackSeconds':120,'verifierSeconds':30,'outerVerificationSeconds':120,'runtimeSeconds':20,'candidateProbe':{'timeoutSeconds':30},'oldProbe':{'timeoutSeconds':30},'nginx':{'path':str(nginx)}}
   ctx={'p':p,'request':request,'maint':fake_maint,'engine':engine,'attempt':attempt,'d':d,'config':{'project':'project','services':services,'composeFiles':[],'envFile':{'path':'env'}},'base':['compose'],'images':new,'old_policy':{'baseline':{s:{'containerId':'id-'+s,'imageId':old[s]} for s in services}},'plan':{'baselineInventories':{'api':{},'agent':{}},'candidateInventories':{'api':{},'agent':{}}},'old_attempt':old_attempt,'fd':3,'adapter':Mock(),'handoff':SimpleNamespace(IDENTITY=('environment','tag','sourceRevision','planSha256','manifestSha256'))};ctx['adapter'].run.return_value={'status':'COMPLETE'}
   def probe(c,which,a):
    if which=='candidateProbe' and fail_candidate:raise RuntimeError('businessfailure')
    return {'status':'OLD_APPLICATION_VERIFIED','source':m.SOURCE,'tag':m.TAG,'environment':'us'}
   with patch.object(m,'probe',side_effect=probe):
    try:m.activate(ctx,attempt/'result.json');result=json.loads((attempt/'result.json').read_text())
    except RuntimeError:result=json.loads((attempt/'activation-failure.json').read_text())
   return result,d.up,nginx.read_bytes(),ctx['adapter'].run.call_args_list
 def test_success_activates_only_expected_images_without_ddl(self):
  result,up,nginx,calls=self.execute();self.assertEqual(result['status'],'SUCCEEDED');self.assertEqual(len(up),1);self.assertNotIn(b'return 503',nginx);self.assertTrue(all(c.args==('reconcile',) for c in calls))
 def test_candidate_failure_restores_forward_schema_old_images(self):
  result,up,nginx,calls=self.execute(True);self.assertEqual(result['status'],'OLD_APPLICATION_RESTORED_ON_FORWARD_SCHEMA');self.assertEqual(len(up),2);self.assertTrue(all(x.startswith('old-') for x in up[-1].values()));self.assertNotIn(b'return 503',nginx);self.assertFalse(result['sqlRollbackAttempted'])
