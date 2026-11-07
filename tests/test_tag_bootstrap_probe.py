import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
P=Path(__file__).resolve().parents[1]/'scripts/tag-bootstrap-probe.py'
def module():
 s=importlib.util.spec_from_file_location('bootstrap',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class Inputs(unittest.TestCase):
 def test_four_fields_and_duplicate_env_reject_before_execution(self):
  m=module()
  with self.assertRaises(ValueError):m.env_map(['A=1','A=2'])
  for bad in [['A=line\nsecret'],['INVALID KEY=x'],['A=\x00']]:
   with self.assertRaises(ValueError):m.env_map(bad)
 def test_starter_override_is_narrow_and_preserves_application_database(self):
  m=module();base={'MODEL_API_KEY':'must-not-copy','NODE_OPTIONS':'--require /unrelated.js','PGHOST':'postgres','PGPORT':'5432','PGDATABASE':'workspacex','PGSSLMODE':'disable','APP_DB_USER':'app_rw','APP_DB_PASSWORD':'privatepassword16'}
  admin={'PROVISION_ADMIN_EMAIL':'a@example.com','PROVISION_ADMIN_PASSWORD':'privateadmin123','PROVISION_ADMIN_NAME':'Admin','PROVISION_ORG_NAME':'Org'}
  value=m.inputs(base,admin,'us','starter');self.assertNotIn('MODEL_API_KEY',value);self.assertNotIn('NODE_OPTIONS',value);self.assertNotIn('WORKSPACEX_DEPLOY_PROFILE',value);self.assertEqual(value['WSX_BOOTSTRAP_APPROVED_PROFILE'],'starter');self.assertEqual(value['APP_DB_PASSWORD'],base['APP_DB_PASSWORD'])
  for patch in [{'PGSSLMODE':'verify-full'},{'PGHOST':'remote'},{'WORKSPACEX_DEPLOY_PROFILE':'production'}]:
   with self.assertRaises(ValueError):m.inputs({**base,**patch},admin,'us','starter')
  with self.assertRaises(ValueError):m.inputs(base,{**admin,'PROVISION_ORG_NAME':''},'us','starter')
 def test_command_runs_dynamic_entry_and_canonical_validator_without_static(self):
  m=module();args=m.command('sha256:'+'a'*64,'owned','label','network','/private/env',[])
  self.assertIn('--read-only',args);self.assertNotIn('--static',args);self.assertNotIn('scripts/provision-admin.ts',args);self.assertIn('assertPostMigrationBootstrap',args[-1]);self.assertIn('provision-admin-compatibility.ts',args[-1]);self.assertIn('appConfig',args[-1])
class NetworkBinding(unittest.TestCase):
 def test_us_frontend_network_cannot_substitute_for_actual_pg_network(self):
  import copy
  m=module();nid='a'*64;policy={'environment':'us','project':'project','usDatabase':{'containerId':'pg-id','imageId':'pg-image'}};api={'NetworkSettings':{'Networks':{'app':{'NetworkID':nid}}}};pg={'Id':'pg-id','Image':'pg-image','State':{'Running':True},'Config':{'Labels':{'com.docker.compose.project':'project','com.docker.compose.service':'postgres'}},'NetworkSettings':{'Networks':{'app':{'NetworkID':nid,'Aliases':['postgres']}}}};d=Mock();d.json.return_value=[pg];binding={'network':'app','networkId':nid}
  self.assertEqual(m.database_network(policy,{'PGHOST':'postgres'},api,d,binding),'app')
  for change in ['network','alias','image','container','state']:
   bad=copy.deepcopy(pg)
   if change=='network':bad['NetworkSettings']['Networks']['app']['NetworkID']='b'*64
   if change=='alias':bad['NetworkSettings']['Networks']['app']['Aliases']=['unrelated']
   if change=='image':bad['Image']='foreign'
   if change=='container':bad['Id']='foreign'
   if change=='state':bad['State']['Running']=False
   d.json.return_value=[bad]
   with self.assertRaises(ValueError):m.database_network(policy,{'PGHOST':'postgres'},api,d,binding)
 def test_cn_requires_fixed_original_managed_database_binding(self):
  m=module();cn=Mock();cn.NETWORK='cn-network';cn.HOST='fixed.rds';cn.DB='fixed-db';nid='a'*64;api={'NetworkSettings':{'Networks':{'cn-network':{'NetworkID':nid}}}};binding={'network':'cn-network','networkId':nid};base={'PGHOST':'fixed.rds','PGDATABASE':'fixed-db','PGPORT':'5432','PGSSLMODE':'disable'}
  self.assertEqual(m.database_network({'environment':'cn'},base,api,Mock(),binding,cn,Mock()),'cn-network');cn.bind_env.assert_called_once()
  with self.assertRaises(ValueError):m.database_network({'environment':'cn'},{**base,'PGHOST':'foreign.rds'},api,Mock(),binding,cn,Mock())

class ProofAndCleanup(unittest.TestCase):
 def fixture(self):
  m=module();return m,{'schemaVersion':1,'sourceSha':m.SOURCE,'phase':'preactivate','imageDigest':'sha256:'+'a'*64,'ready':True,'readOnlyTransaction':True,'productionWriteStatements':0,'stateClass':'matching-existing','checks':{k:True for k in ['imageEntrypoint','inputContract','schemaContract','permissionContract','agentSeedContract','migrationLedgerContract']},'blockers':[]}
 def test_exact_dynamic_result_and_each_required_check(self):
  import json
  m,value=self.fixture();raw=lambda v:('CN_BOOTSTRAP_COMPAT_JSON='+json.dumps(v)+'\n').encode()
  self.assertEqual(m.validate_output(raw(value),m.SOURCE,value['imageDigest']),value)
  for key in value['checks']:
   with self.assertRaises(ValueError):m.validate_output(raw({**value,'checks':{**value['checks'],key:False}}),m.SOURCE,value['imageDigest'])
  for patch in [{'phase':'prebuild'},{'readOnlyTransaction':False},{'productionWriteStatements':True},{'sourceSha':'b'*40},{'blockers':['failure']},{'baselineCompatibility':True}]:
   with self.assertRaises(ValueError):m.validate_output(raw({**value,**patch}),m.SOURCE,value['imageDigest'])
 def test_no_multiline_or_oversized_machine_output(self):
  m,_=self.fixture()
  for raw in [b'noise\nCN_BOOTSTRAP_COMPAT_JSON={}\n',b' '*65537,b'CN_BOOTSTRAP_COMPAT_JSON={}']:
   with self.assertRaises(ValueError):m.validate_output(raw,m.SOURCE,'sha256:'+'a'*64)
 def test_real_timeout_terms_child_and_runs_finally(self):
  import tempfile,sys,subprocess
  m=module()
  with tempfile.TemporaryDirectory() as directory:
   clean=Path(directory)/'cleanup';script=Path(directory)/'child.py'
   script.write_text("import signal,time,pathlib\ndef stop(*_):raise RuntimeError('term')\nsignal.signal(signal.SIGTERM,stop)\ntry:time.sleep(30)\nfinally:pathlib.Path(%r).write_text('clean')\n"%str(clean))
   with self.assertRaises(subprocess.TimeoutExpired):m.run_job([sys.executable,str(script)],2)
   self.assertEqual(clean.read_text(),'clean')
if __name__=='__main__':unittest.main()

class PolicyConstruction(unittest.TestCase):
 def test_us_and_cn_use_original_admin_files_and_exact_target(self):
  import tempfile,hashlib
  from unittest.mock import patch
  from types import SimpleNamespace
  m=module()
  with tempfile.TemporaryDirectory() as directory:
   file=Path(directory)/'input';file.write_text('PROVISION_ADMIN_EMAIL=a@example.com\nPROVISION_ADMIN_PASSWORD=fixture-password\nPROVISION_ADMIN_NAME=Admin\nPROVISION_ORG_NAME=Org\n')
   for environment in ('us','cn'):
    base={'PGHOST':'postgres','PGPORT':'5432','PGDATABASE':'workspacex','PGSSLMODE':'disable','APP_DB_USER':'app_rw'}
    base['WECHAT_PAY_PRIVATE_KEY']='-----BEGIN KEY-----\r\nfixture\n-----END KEY-----\n'
    if environment=='cn':base['WORKSPACEX_DEPLOY_PROFILE']='production'
    api={'Config':{'Env':[k+'='+v for k,v in base.items()]},'NetworkSettings':{'Networks':{('workspacex-selfhost-runtime' if environment=='us' else 'cn-network'):{'NetworkID':'a'*64}}}}
    target={'sourceRevision':m.SOURCE,'imageId':'target','image':'registry/api@sha256:'+'a'*64};policy={environment+'Database':{'targetApiImageId':'target'}}
    core=SimpleNamespace(sha=lambda raw:hashlib.sha256(raw).hexdigest(),file_sha=lambda _: 'b'*64);cn=SimpleNamespace(ENV='/fixed/original/migration.env',NETWORK='cn-network')
    observed=[]
    def trust(path,*args):observed.append(str(path));return file
    with patch.object(m,'trusted',side_effect=trust),patch.object(m,'database_network') as network,patch.object(m.os,'access',return_value=True):
     spec=m.policy_spec(environment,{},api,target,policy,Mock(),Mock(),core,[],cn)
    self.assertEqual(spec['binding']['baselineEnvSha256'],hashlib.sha256(__import__('json').dumps(base,sort_keys=True).encode()).hexdigest());self.assertEqual(spec['timeoutSeconds'],60);self.assertEqual(spec['binding']['profile'],'starter' if environment=='us' else 'production');self.assertEqual(spec['binding']['networkId'],'a'*64);self.assertIn(spec['binding']['adminEnv'],spec['inputs']);network.assert_called_once()
    expected='/etc/workspacex-selfhost/probe.env' if environment=='us' else '/fixed/original/bootstrap.env';self.assertIn(expected,observed)
    with self.assertRaisesRegex(ValueError,'BOOTSTRAP_TARGET_SOURCE'):m.policy_spec(environment,{},api,{**target,'sourceRevision':'b'*40},policy,Mock(),Mock(),core,[],cn)
    with self.assertRaisesRegex(ValueError,'BOOTSTRAP_PREPARED_TARGET_DRIFT'):m.policy_spec(environment,{},api,{**target,'imageId':'foreign'},policy,Mock(),Mock(),core,[],cn)
 def test_original_ca_file_mapping_is_exact_and_unambiguous(self):
  m=module();api={'Mounts':[{'Type':'bind','Source':'/root/tls','Destination':'/run/tls'}]}
  self.assertEqual(m.original_ca_file(api,'/run/tls/ca.pem'),'/root/tls/ca.pem')
  for path in ['/run/other/ca.pem','relative.pem','/run/tls/../outside']:
   with self.assertRaises(ValueError):m.original_ca_file(api,path)
  with self.assertRaises(ValueError):m.original_ca_file({'Mounts':api['Mounts']*2},'/run/tls/ca.pem')

class DockerEnvironmentParsing(unittest.TestCase):
 def test_unrelated_multiline_pem_preserved_in_memory_but_never_generated(self):
  import hashlib,json
  m=module();pem='-----BEGIN '+'PRIVATE KEY-----\nline1\nline2\n-----END '+'PRIVATE KEY-----\n';lines=['PGHOST=postgres','PGPORT=5432','PGDATABASE=workspacex','PGSSLMODE=disable','APP_DB_USER=app_rw','WECHAT_PAY_PRIVATE_KEY='+pem]
  base=m.parse_docker_env(lines);self.assertEqual(base['WECHAT_PAY_PRIVATE_KEY'],pem)
  admin={'PROVISION_ADMIN_EMAIL':'a@example.com','PROVISION_ADMIN_PASSWORD':'privateadmin123','PROVISION_ADMIN_NAME':'Admin','PROVISION_ORG_NAME':'Org'}
  selected=m.inputs(base,admin,'us','starter');self.assertNotIn('WECHAT_PAY_PRIVATE_KEY',selected);self.assertEqual(m.env_map([k+'='+v for k,v in selected.items()]),selected)
  self.assertNotEqual(hashlib.sha256(json.dumps(base,sort_keys=True).encode()).hexdigest(),hashlib.sha256(json.dumps({**base,'WECHAT_PAY_PRIVATE_KEY':pem.replace('\n','')},sort_keys=True).encode()).hexdigest())
 def test_docker_parser_rejects_null_duplicate_or_malformed_names(self):
  m=module()
  for bad in (['A=1','A=2'],['A=has\0null'],['A\nB=x'],['INVALID KEY=x'],['missing-equals'],[None]):
   with self.subTest(bad=bad),self.assertRaises(ValueError):m.parse_docker_env(bad)
 def test_selected_db_and_admin_controls_remain_rejected(self):
  m=module();base={'PGHOST':'postgres','PGPORT':'5432','PGDATABASE':'workspacex','PGSSLMODE':'disable','APP_DB_USER':'app_rw','APP_DB_PASSWORD':'password'};admin={'PROVISION_ADMIN_EMAIL':'a@example.com','PROVISION_ADMIN_PASSWORD':'privateadmin123','PROVISION_ADMIN_NAME':'Admin','PROVISION_ORG_NAME':'Org'}
  for control in ('\r','\n','\0'):
   with self.subTest(control=repr(control)):
    with self.assertRaisesRegex(ValueError,'ENV_SERIALIZATION'):m.inputs({**base,'APP_DB_PASSWORD':'before'+control+'after'},admin,'us','starter')
    with self.assertRaisesRegex(ValueError,'ENV_SERIALIZATION'):m.inputs(base,{**admin,'PROVISION_ADMIN_NAME':'before'+control+'after'},'us','starter')
