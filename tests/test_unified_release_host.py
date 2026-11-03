import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('host',Path(__file__).parents[1]/'scripts/unified-release-host.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class HostTests(unittest.TestCase):
 def test_stopping_writers_never_stops_local_database(self):
  for env in ('devapp','cn','us'):
   with self.subTest(env=env),tempfile.TemporaryDirectory() as d:
    host=m.Host({'environment':env,'project':'app','services':{'api':'api','web':'web','postgres':'postgres'}},d,d)
    with patch.object(host,'run') as run:host.stop({'compose':'old.json'})
    args=run.call_args.args[0];self.assertEqual(args[-3:],['stop','api','web']);self.assertNotIn('postgres',args)
 def test_failed_hook_result_is_retained(self):
  with tempfile.TemporaryDirectory() as d:
   host=m.Host({'project':'app','migrationCommand':['/fixed/driver','{api_image}','{mode}']},d,d)
   result={'status':'RECONCILE_REQUIRED','stage':'commit'}
   with patch.object(host,'migration_command',return_value=['driver']),patch.object(m.process,'cleanup_container'),patch.object(host,'run',return_value=json.dumps(result).encode()) as run:
    self.assertEqual(host.plan({'apiImage':'sha256:abc'},Path(d)),result)
   self.assertTrue(run.call_args.kwargs['allow_failure']);self.assertEqual(json.loads((Path(d)/'migrationCommand-plan.json').read_text()),result)
 def test_backup_cannot_claim_an_absent_file(self):
  with tempfile.TemporaryDirectory() as d:
   host=m.Host({},d,d)
   with patch.object(host,'hook',return_value={'status':'COMPLETE','path':d+'/backup/missing.dump'}):
    with self.assertRaisesRegex(ValueError,'BACKUP_FILE_MISSING'):host.backup(Path(d))
 def test_runtime_database_identity_must_match_environment_config(self):
  host=m.Host({'database':{'host':'rds.example','port':5432,'name':'cn'}},'/unused','/unused')
  host.database_binding({'PGHOST':'rds.example','PGDATABASE':'cn','PGPORT':'5432'})
  for env in [{'PGHOST':'other','PGDATABASE':'cn'},{'PGHOST':'rds.example','PGDATABASE':'clone'}]:
   with self.assertRaisesRegex(ValueError,'APPLICATION_DATABASE_MISMATCH'):host.database_binding(env)
 def test_hook_timeout_cleans_its_own_container(self):
  with tempfile.TemporaryDirectory() as d:
   host=m.Host({'migrationCommand':['docker','run','--name','{worker}']},d,d)
   with patch.object(host,'migration_command',return_value=['driver']),patch.object(host,'run',side_effect=TimeoutError()),patch.object(m.process,'cleanup_container') as cleanup:
    with self.assertRaises(TimeoutError):host.plan({'apiImage':'sha256:abc'},Path(d))
   self.assertRegex(cleanup.call_args.args[1],r'^wsx-unified-[a-f0-9]{32}$')
 def test_runtime_verifier_receives_docker_arguments_without_duplicate_executable(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'compose.json';path.write_text('{}');path.chmod(0o600)
   host=m.Host({'project':'app','services':{'api':'api'},'health':{}},d,d)
   version={'compose':str(path),'composeSha256':m.engine.sha_file(path),'images':{'api':'sha256:abc'}}
   with patch.object(m.consumer,'trusted'),patch.object(m.engine,'verify_runtime') as verify:host.verify(version)
   self.assertEqual(verify.call_args.args[1][0],'compose')
