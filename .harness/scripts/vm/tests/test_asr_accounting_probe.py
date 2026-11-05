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
  self.assertIn("if: ${{ github.event_name == 'workflow_dispatch' && !inputs.asr_accounting && inputs.asr_repair_action == 'none' }}",text)
  self.assertIn('if: ${{ inputs.asr_accounting }}',text)
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
  self.assertIn('BEGIN READ ONLY',m.DATABASE)
  self.assertIn('SET LOCAL row_security=off',m.DATABASE)
  self.assertIn('model_provider=$1 AND model_id=$2',m.DATABASE)
  self.assertIn('ownerConfigured?migrationConfig():appConfig()',m.DATABASE)

 def test_both_exact_tree_pipelines_fail_closed_on_missing_git_source(self):
  import subprocess,tempfile
  text=(pathlib.Path(__file__).parents[4]/'.github/workflows/devapp-probe.yml').read_text()
  self.assertEqual(text.count('shell: bash\n        run: |\n          set -euo pipefail'),2)
  with tempfile.TemporaryDirectory() as cwd:
   result=subprocess.run(['bash','-euo','pipefail','-c','git show HEAD:.harness/scripts/vm/asr-accounting-probe.py | python3 -I -B'],cwd=cwd,capture_output=True)
  self.assertNotEqual(result.returncode,0)
 def test_local_postgres_fallback_refuses_rls_filtered_false_zero(self):
  source=(pathlib.Path(__file__).parents[1]/'asr-accounting-probe.py').read_text()
  self.assertIn('BEGIN READ ONLY; SET LOCAL row_security=off;',source)
