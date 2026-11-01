import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
S=Path(__file__).resolve().parents[1]/'scripts/cn-reviewed-tag-prepare.py'
def module():
 s=importlib.util.spec_from_file_location('cn_limited_prepare_test',S);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class LimitedPrepareTests(unittest.TestCase):
 def test_missing_closure_rejects_before_import(self):
  m=module()
  with patch.object(m.os,'geteuid',return_value=0),patch.object(m,'load') as load:
   with self.assertRaisesRegex(ValueError,'PREPARE_CLOSURE'):m.prepare({}, {}, '/tmp/output')
   load.assert_not_called()
 def test_baseline_and_complete_bind_same_exact_435(self):
  m=module();core=Mock(MIGRATIONS={'one':'a'*64,'two':'b'*64,'three':'c'*64});base={str(i):'d'*64 for i in range(435)}
  self.assertEqual(m.baseline_ledger(base,core),base);self.assertEqual(m.baseline_ledger({**base,**core.MIGRATIONS},core),base)
  for bad in ({**base,'one':'a'*64},{**base,**core.MIGRATIONS,'one':'e'*64}):
   with self.assertRaisesRegex(ValueError,'PARTIAL_OR_CHANGED'):m.baseline_ledger(bad,core)
 def test_no_restore_no_evidence_dependency(self):
  import ast
  tree=ast.parse(S.read_text());calls=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)]
  self.assertNotIn('rehearse',calls);self.assertNotIn('evidence',calls);self.assertNotIn('encrypt_dump',calls)
if __name__=='__main__':unittest.main()

class ReadonlyBuilderOrchestrationTests(unittest.TestCase):
 def exercise(self,drift=False):
  import tempfile,json,types,hashlib,contextlib
  m=module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name);state=root/'state';state.mkdir();config=root/'config';lock=root/'lock';lock.write_bytes(b'');out=state/('cn-limited-inputs-'+'a'*32);events=[]
  def save(path,value):
   with open(path,'x') as f:json.dump(value,f)
   Path(path).chmod(0o600)
  def reference(path):return {'path':str(path),'sha256':m.sha(path)}
  envfile=root/'migration.env';envfile.write_bytes(b'private env');oldroot=root/'browser';oldroot.mkdir();original=oldroot/'browser.py';original.write_bytes(b'original py');env=root/'browser.env';env.write_bytes(b'private browser')
  cfg={'environment':'cn','lockFile':str(lock),'docker':'/usr/bin/docker','stateDirectory':str(state),'project':'p','services':{'api':'api'},'registryPrefix':'registry/prefix','composeFiles':[],'envFile':reference(envfile),'verificationFiles':[]};save(config,cfg)
  baseline={str(i):'a'*64 for i in range(435)};metadata={'database':'db','role':'migration_admin','bytes':10,'roles':['app_rw'],'ledger':baseline};migrations={'one':'b'*64,'two':'c'*64,'three':'d'*64};counter=[0]
  def read_source(d):
   counter[0]+=1;events.append('read-source');return {**metadata,'ledger':{**baseline,'drift':'e'*64}} if drift and counter[0]>1 else metadata
  row={'Id':'cid','Image':'old','Config':{'Labels':{'com.docker.compose.service':'api'}}}
  p=types.SimpleNamespace(live_service=lambda *a:row,env_map=lambda r:{'PGHOST':'rds','PGDATABASE':'db','PGPORT':'5432','APP_DB_USER':'app_rw'},exact_sql=lambda *a:events.append('verify-exact-sql'))
  core=types.SimpleNamespace(check_ledger=lambda b:None,MIGRATIONS=migrations,save=save)
  cn=types.SimpleNamespace(HOST='rds',DB='db',ENV=str(envfile),bind_env=lambda p:None,read_source=read_source)
  def pinned(ref,**kw):
   self.assertEqual(m.sha(ref['path']),ref['sha256']);return Path(ref['path'])
  maint=types.SimpleNamespace(SERVICES={'api'},runtime_set=lambda *a:None,pinned=pinned,maintenance_bytes=lambda *a:events.append('check-nginx'),require_bootstrap=lambda p:None)
  def resolve(d,prefix,tag,role,pull):self.assertFalse(pull);events.append('resolve-'+role);return {'sourceRevision':m.SOURCE,'tag':m.TAG,'imageId':'target-'+role,'image':'repo@sha256:'+'d'*64,'service':role}
  bootstrap=types.SimpleNamespace(policy_spec=lambda *a:{'executable':reference(config),'inputs':[reference(config)],'timeoutSeconds':60,'binding':{'actual':True}})
  modules={'schema-tag-prepare':p,'schema-restore-rehearsal':core,'schema-tag-prepare-cn':cn,'tag-maintenance-release':maint,'minimal-docker-release':types.SimpleNamespace(Docker=lambda *a:object()),'tag-bootstrap-probe':bootstrap,'registry-images':types.SimpleNamespace(resolve=resolve),'us-tag-migration-adapter':types.SimpleNamespace(inherited_lock=lambda *a:None),'cn-tag-old-application-probe':types.SimpleNamespace(ROOT=oldroot,PINS={'browser.py':m.sha(original)},ENV=env,ENV_SHA=m.sha(env))}
  # Fixed nginx host path maps to an actual immutable fixture file only in this test.
  nginx=root/'nginx';nginx.write_bytes(b'original nginx')
  def trusted(path,*a,**kw):return nginx if str(path)=='/etc/nginx/conf.d/workspacex-app.conf' else Path(path)
  with contextlib.ExitStack() as stack:
   stack.enter_context(patch.object(m,'CONFIG',str(config)));stack.enter_context(patch.object(m,'LOCK',str(lock)));stack.enter_context(patch.object(m,'trusted',side_effect=trusted));stack.enter_context(patch.object(m.os,'geteuid',return_value=0));stack.enter_context(patch.object(m.os,'access',return_value=True));stack.enter_context(patch.object(m,'load',side_effect=lambda name,pins:modules[name]))
   try:result=m.prepare({n:m.sha(m.HERE/n) for n in m.CLOSURE},None,out);error=None
   except ValueError as e:result=None;error=e
  return result,out,events,error,config
 def test_actual_prepare_function_only_builds_fresh_honest_inputs(self):
  import json
  result,out,events,error,config=self.exercise();self.assertIsNone(error);policy=json.loads((out/'policy.json').read_bytes());receipt=json.loads((out/'receipt.json').read_bytes());self.assertEqual(policy['backupState'],'NOT_CAPTURED');self.assertTrue(policy['restoreNotPerformed']);self.assertFalse(policy['activationAllowed']);self.assertEqual(receipt['status'],'CN_LIMITED_READONLY_INPUTS_PREPARED');self.assertEqual(policy['oldApplicationProbe']['timeoutSeconds'],105);self.assertIn('verify-exact-sql',events);self.assertEqual(events.count('read-source'),2);self.assertEqual((out/'policy.json').stat().st_mode&0o777,0o600);self.assertFalse((out/'database.pgdump.enc').exists());self.assertEqual(result['maintenancePolicy']['sha256'],module().sha(out/'policy.json'))
 def test_real_source_ledger_drift_produces_no_policy(self):
  result,out,events,error,config=self.exercise(True);self.assertRegex(str(error),'READONLY_SOURCE_DRIFT');self.assertFalse(out.exists())
