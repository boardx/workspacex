import importlib.util,json,pathlib,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('probe',pathlib.Path(__file__).parents[1]/'asr-accounting-probe.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Probe(unittest.TestCase):
 def test_mount_must_be_persistent_rw_and_most_specific(self):
  self.assertFalse(m.persistent_mount({},'/private'))
  row={'Mounts':[{'Destination':'/data','Type':'volume','RW':True}]}
  self.assertTrue(m.persistent_mount(row,'/data/receipts'))
  self.assertFalse(m.persistent_mount(row,'/database'))
  row['Mounts'].append({'Destination':'/data/receipts','Type':'tmpfs','RW':True})
  self.assertFalse(m.persistent_mount(row,'/data/receipts'))
 def test_sql_literal_cannot_change_fixed_query(self):
  self.assertEqual(m.literal("a'b"),"'a''b'")
 def test_errors_never_expose_command_output(self):
  result=type('Result',(),{'returncode':1,'stdout':'secret'})()
  with patch.object(m.subprocess,'run',return_value=result):
   with self.assertRaisesRegex(ValueError,'^probe_command_unavailable$'):m.call(['docker'])
 def test_diagnostic_dispatch_skips_legacy_private_output(self):
  text=(pathlib.Path(__file__).parents[4]/'.github/workflows/devapp-probe.yml').read_text()
  self.assertIn("if: ${{ github.event_name == 'workflow_dispatch' && !inputs.asr_accounting && inputs.asr_repair_action == 'none' && inputs.target_environment == 'devapp' }}",text)
  self.assertIn("if: ${{ inputs.asr_accounting && inputs.target_environment == 'devapp' }}",text)
  self.assertIn('git show \"$GITHUB_SHA:.harness/scripts/vm/asr-accounting-probe.py\" | python3 -I -B',text)
  self.assertNotIn('readFile',m.STORAGE)
  self.assertNotIn('write',m.STORAGE)
 def test_live_output_contains_only_aggregates_even_when_logs_contain_secrets(self):
  import io,contextlib
  api={'Id':'api-id','Config':{'Labels':{'com.docker.compose.service':'api'},'Env':['KERNEL_ASR_API_KEY=secret','KERNEL_ASR_PROVIDER=provider','KERNEL_ASR_MODEL=model','PGHOST=remote','PGDATABASE=live']},'State':{'Running':True}}
  def call(args,data=None):
   if args[1]=='ps':return 'api-id' if 'label=com.docker.compose.project=workspacex-image' in args else ''
   if args[1]=='inspect':return json.dumps([api])
   if data==m.STORAGE:return '{"asrConfigured":true}'
   if data==m.DATABASE:return '{"tariffQueryAvailable":true,"matchingTariffs":0,"pricedOrganizations":0}'
   raise AssertionError(args)
  logs=type('Result',(),{'returncode':0,'stdout':'secret user body CREDIT_ACCOUNTING_UNAVAILABLE','stderr':'private token'})()
  output=io.StringIO()
  with patch.object(m,'call',side_effect=call),patch.object(m.subprocess,'run',return_value=logs),contextlib.redirect_stdout(output):m.run()
  report=json.loads(output.getvalue());self.assertEqual(report['matchingTariffs'],0)
  self.assertEqual(report['recentErrorCounts']['CREDIT_ACCOUNTING_UNAVAILABLE'],1)
  for private in ['secret','private token','user body','remote','api-id']:self.assertNotIn(private,output.getvalue())
 def test_database_probe_is_read_only_parameterized_and_refuses_filtered_zero(self):
  self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',m.DATABASE)
  self.assertIn('SET LOCAL row_security=off',m.DATABASE)
  self.assertIn('model_provider=$1 AND model_id=$2',m.DATABASE)
  self.assertIn('ownerConfigured?migrationConfig():appConfig()',m.DATABASE)

 def test_both_exact_tree_pipelines_fail_closed_on_missing_git_source(self):
  import subprocess,tempfile
  text=(pathlib.Path(__file__).parents[4]/'.github/workflows/devapp-probe.yml').read_text()
  self.assertEqual(text.count('shell: bash\n        run: |\n          set -euo pipefail'),3)
  with tempfile.TemporaryDirectory() as cwd:
   result=subprocess.run(['bash','-euo','pipefail','-c','git show HEAD:.harness/scripts/vm/asr-accounting-probe.py | python3 -I -B'],cwd=cwd,capture_output=True)
  self.assertNotEqual(result.returncode,0)
 def test_local_postgres_fallback_refuses_rls_filtered_false_zero(self):
  source=(pathlib.Path(__file__).parents[1]/'asr-accounting-probe.py').read_text()
  self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL row_security=off;',source)

 def test_fixed_cn_target_uses_own_project_and_known_official_region(self):
  from unittest.mock import patch
  with patch.dict(m.os.environ,{'ASR_PROBE_TARGET':'foreign'}):
   with self.assertRaisesRegex(ValueError,'fixed_probe_target_required'):m.run()
  self.assertEqual(m.runtime_configuration({'KERNEL_ASR_BASE_URL':'wss://dashscope-intl.aliyuncs.com/x'})['asrRegion'],'sg-international')
  self.assertEqual(m.runtime_configuration({'KERNEL_ASR_BASE_URL':'wss://credential@dashscope.aliyuncs.com/x'})['asrRegion'],'unverified')
  self.assertEqual(m.runtime_configuration({'KERNEL_ASR_BASE_URL':'wss://other.example/x'})['asrRegion'],'unverified')

 def test_global_probe_counts_global_rows_without_querying_tenant_compatibility_view(self):
  import subprocess
  prelude=r'''
const sqls=[];
const fixtureClient={release(){},async query(sql){sqls.push(sql);
 if(sql.includes("to_regclass"))return {rows:[{enabled:true}]};
 if(sql.includes('count(*)::integer AS count FROM organizations'))return {rows:[{count:4}]};
 if(sql.includes('AS "matchingTariffs"'))return {rows:[{matchingTariffs:1}]};
 if(sql.includes('AS "rowCount"'))return {rows:[{model_provider:'dashscope',model_id:'qwen3-asr-flash-realtime',quantum:'4300',hundredths_per_quantum:'33',rowCount:1,versionCount:1}]};
 if(sql.includes('count(*)::integer AS count FROM credit_'))return {rows:[{count:1}]};
 return {rows:[]};}};
class Pool{async connect(){return fixtureClient;}async end(){console.error(JSON.stringify(sqls));}}
const appConfig=()=>({}),migrationConfig=()=>({});
const readProductConfiguration=async()=>({version:'live',rows:[]});
const personalConfiguredProducts=()=>[{kind:'credit_topup',currency:'CNY',sku:'live-min',amountMinor:12900,credits:10000}];
'''
  source=prelude+'\n'+'\n'.join(line for line in m.DATABASE.splitlines()if not line.startswith('import '))
  result=subprocess.run(['node','--input-type=module'],input=source,text=True,capture_output=True,timeout=10)
  self.assertEqual(result.returncode,0,result.stderr)
  out=json.loads(result.stdout);self.assertTrue(out['tariffQueryAvailable']);self.assertEqual(out['tariffScope'],'deployment-global')
  self.assertEqual(out['matchingTariffs'],1);self.assertEqual(out['pricedOrganizations'],4)
  self.assertEqual(out['millisecondTariffs'][0]['organizationCount'],4)
  self.assertFalse(any('FROM credit_native_tariffs 'in sql for sql in json.loads(result.stderr)))
