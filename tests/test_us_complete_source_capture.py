import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
S=Path(__file__).resolve().parents[1]/'scripts/us-complete-source-capture.py'
def module():
 s=importlib.util.spec_from_file_location('capture_complete_test',S);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class CompleteCaptureTests(unittest.TestCase):
 def test_exact_complete_ledger(self):
  m=module();base={str(i):'a'*64 for i in range(435)};core=Mock(MIGRATIONS={'x':'b'*64,'y':'c'*64,'z':'d'*64})
  m.complete_ledger(base,{**base,**core.MIGRATIONS},core)
  for bad in (base,{**base,**core.MIGRATIONS,'extra':'e'*64},{**base,**core.MIGRATIONS,'x':'f'*64}):
   with self.assertRaisesRegex(ValueError,'EXACT_COMPLETE_LEDGER'):m.complete_ledger(base,bad,core)
 def test_capture_settings_rejected(self):
  m=module();value={'ledger':{},'roleSettings':[{'settings':['role=admin']} ]};collector=Mock();collector.validate_capture.return_value=value
  with self.assertRaisesRegex(ValueError,'SOURCE_ROLE_SETTINGS_UNQUALIFIED'):m.validate_source(value,collector)
 def test_dump_preserves_acl_readonly_only(self):
  m=module();args=m.dump_args('/usr/bin/docker','a'*64)
  self.assertIn('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000',args)
  self.assertNotIn('--no-owner',args);self.assertNotIn('--no-acl',args)
  self.assertIn('--format=custom',args);self.assertNotIn('psql',args)
 def test_fixed_entry_inputs_reject_before_modules(self):
  m=module()
  with self.assertRaisesRegex(ValueError,'FIXED_INPUTS'):m.capture_complete('/tmp/config','/tmp/old','/tmp/input',3)
if __name__=='__main__':unittest.main()

class HistoricalProofTests(unittest.TestCase):
 def fixture(self):
  import tempfile,json,os,hashlib
  from unittest.mock import patch
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);root=Path(self.tmp.name);old=root/'old';old.mkdir();state=root/'state';state.mkdir();inp=root/'input.json'
  m=module();core=Mock();core.MIGRATIONS={'x':'b'*64,'y':'c'*64,'z':'d'*64};core.sha=lambda raw:hashlib.sha256(raw).hexdigest()
  def save(path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value));os.utime(path,(900,900));return {'path':str(path),'sha256':m.sha(path)}
  executable=save(root/'tool',{});prepared=save(root/'prepared',{'status':'PREPARED_FOR_MAINTENANCE','environment':'us','source':m.SOURCE,'tag':m.TAG})
  policy={'environment':'us','source':m.SOURCE,'tag':m.TAG,'attempt':old.name,'lockFile':m.LOCK,'stateDirectory':str(state),'project':'project','preparedAt':800,'preparationReceipt':prepared,'usDatabase':{'containerId':'a'*64,'imageId':'sha256:'+'b'*64,'targetApiImageId':'sha256:'+'c'*64,'baselineLedger':{str(i):'d'*64 for i in range(435)}},'configurationPins':[]}
  for name in ('databaseCommand','backupCommand','oldApplicationProbe','bootstrapProbe'):policy[name]={'executable':executable,'inputs':[]}
  image='registry/repo@sha256:'+'e'*64;policy['bootstrapProbe']['binding']={'image':{'image':image}}
  save(inp,policy);save(old/'policy.json',policy)
  save(state/'pending.json',{'kind':'reviewed-schema-maintenance','attempt':str(old),'policySha256':m.sha(inp),'source':m.SOURCE,'tag':m.TAG})
  ack=save(old/'databaseCommand-apply.json',{'status':'COMMITTED','commitAcknowledged':True,'ledgerCount':438,'environment':'us','source':m.SOURCE,'tag':m.TAG});os.utime(ack['path'],(1000,1000))
  save(old/'database-transaction-intent.json',{'status':'TRANSACTION_INTENT','environment':'us','source':m.SOURCE,'tag':m.TAG})
  save(old/'databaseCommand-reconcile.json',{'status':'COMPLETE','readOnly':True,'environment':'us','source':m.SOURCE,'tag':m.TAG})
  raw=save(old/'raw',{});save(old/'bootstrapProbe-preactivate.json',{'status':'CANDIDATE_BOOTSTRAP_COMPATIBLE','environment':'us','source':m.SOURCE,'tag':m.TAG,'attempt':str(old),'imageId':policy['usDatabase']['targetApiImageId'],'imageDigest':image.split('@')[1],'readOnlyTransaction':True,'productionWriteStatements':0,'rawOutput':raw})
  proof={'files':{'database.pgdump.enc':'hash'}}
  for name in ('qualification.json',*proof['files']):save(old/'stopped-backup'/name,{})
  us=Mock();us.validate_backup.return_value=proof;boot=Mock()
  patcher=patch.object(m,'trusted',side_effect=lambda path,*a,**kw:Path(path));patcher.start();self.addCleanup(patcher.stop)
  return m,{'stateDirectory':str(state),'project':'project'},old,inp,core,us,boot,save
 def test_refresh_reads_archived_original_pending_without_recreating_it(self):
  m,cfg,old,inp,core,us,boot,save=self.fixture();state=Path(cfg['stateDirectory']);archive=state/'pending-complete-original.json';(state/'pending.json').rename(archive)
  files={str(p.relative_to(old)):m.sha(p) for p in old.rglob('*') if p.is_file()}
  prior=save(state/'prior.json',{'kind':'complete-schema-recovery-v1','status':'COMPLETE_SCHEMA_RECOVERY_VERIFIED','environment':'us','sourceRevision':m.SOURCE,'tag':m.TAG,'originalAttempt':str(old),'originalPolicy':{'path':str(old/'policy.json'),'sha256':m.sha(old/'policy.json')},'originalInputPolicy':{'path':str(inp),'sha256':m.sha(inp)},'originalHistory':{'files':files},'pendingArchive':{'path':str(archive),'sha256':m.sha(archive)}})
  # Current outer-release pending is separate and must remain byte-identical.
  current=save(state/'pending.json',{'outerRelease':'prebind-failed'});before=(state/'pending.json').read_bytes()
  m.history(cfg,old,inp,core,us,boot,archived_recovery=prior)
  self.assertEqual((state/'pending.json').read_bytes(),before);self.assertEqual(us.validate_backup.call_args.kwargs['now'],1000)
  (old/'databaseCommand-reconcile.json').write_text('{}')
  with self.assertRaisesRegex(ValueError,'ARCHIVED_RECOVERY_HISTORY_DRIFT'):m.history(cfg,old,inp,core,us,boot,archived_recovery=prior)
 def test_historical_backup_uses_ack_time_not_current_time(self):
  m,cfg,old,inp,core,us,boot,save=self.fixture();p,refs,pending=m.history(cfg,old,inp,core,us,boot)
  self.assertEqual(us.validate_backup.call_args.kwargs['now'],1000)
  self.assertIn(str(old/'stopped-backup'/'database.pgdump.enc'),refs);boot.validate_output.assert_called_once()
 def test_pending_raw_hash_tamper_rejected_before_backup(self):
  m,cfg,old,inp,core,us,boot,save=self.fixture();value=__import__('json').loads(inp.read_text());inp.write_text(__import__('json').dumps(value,indent=2))
  with self.assertRaisesRegex(ValueError,'HISTORICAL_PENDING_BINDING'):m.history(cfg,old,inp,core,us,boot)
  us.validate_backup.assert_not_called()
 def test_missing_commit_ack_rejects_before_capture(self):
  m,cfg,old,inp,core,us,boot,save=self.fixture();save(old/'databaseCommand-apply.json',{'status':'COMMITTED','commitAcknowledged':False})
  with self.assertRaisesRegex(ValueError,'COMMIT_ACK_REQUIRED'):m.history(cfg,old,inp,core,us,boot)
  us.validate_backup.assert_not_called()
 def test_old_backup_rewritten_after_ack_rejected(self):
  import os
  m,cfg,old,inp,core,us,boot,save=self.fixture();os.utime(old/'stopped-backup'/'database.pgdump.enc',(1001,1001))
  with self.assertRaisesRegex(ValueError,'BACKUP_AFTER_COMMIT'):m.history(cfg,old,inp,core,us,boot)
 def test_raw_bootstrap_tamper_rejected(self):
  m,cfg,old,inp,core,us,boot,save=self.fixture();(old/'raw').write_text('changed')
  with self.assertRaisesRegex(ValueError,'PIN_DRIFT'):m.history(cfg,old,inp,core,us,boot)
  boot.validate_output.assert_not_called()

class ClosureBoundaryTests(unittest.TestCase):
 def test_missing_closure_pins_before_dynamic_import(self):
  from unittest.mock import patch
  m=module();cfg={'environment':'us','lockFile':m.LOCK,'docker':'/usr/bin/docker'}
  with patch.object(m,'read',return_value=cfg),patch.object(m.os,'geteuid',return_value=0),patch.object(m,'load') as load:
   with self.assertRaisesRegex(ValueError,'CAPTURE_CLOSURE_PINS_REQUIRED'):m.capture_complete(m.CONFIG,m.OLD,m.INPUT,3)
   load.assert_not_called()
 def test_closure_hash_drift_before_any_import(self):
  from unittest.mock import patch
  m=module();cfg={'environment':'us','lockFile':m.LOCK,'docker':'/usr/bin/docker'};pins={n:'0'*64 for n in m.CLOSURE}
  with patch.object(m,'read',return_value=cfg),patch.object(m.os,'geteuid',return_value=0),patch.object(m,'trusted',side_effect=lambda p,*a,**k:Path(p)),patch.object(m,'load') as load:
   with self.assertRaisesRegex(ValueError,'CAPTURE_CLOSURE_DRIFT'):m.capture_complete(m.CONFIG,m.OLD,m.INPUT,3,closure_pins=pins)
   load.assert_not_called()

class HistoryInventoryTests(unittest.TestCase):
 def test_recursive_original_inventory_and_symlink_rejection(self):
  import tempfile
  from unittest.mock import patch
  m=module()
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'trusted',side_effect=lambda p,*a,**k:Path(p)):
   root=Path(tmp);(root/'sub').mkdir();(root/'sub'/'raw').write_bytes(b'original');(root/'archive').write_bytes(b'encrypted')
   refs=m.all_history_files(root);self.assertEqual(set(refs),{str(root/'sub'/'raw'),str(root/'archive')})
   (root/'link').symlink_to(root/'archive')
   with self.assertRaisesRegex(ValueError,'HISTORY_SYMLINK'):m.all_history_files(root)
