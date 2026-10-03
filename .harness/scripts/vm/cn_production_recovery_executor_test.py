import copy,hashlib,json,os,pathlib,subprocess,sys,time,unittest
from cn_production_recovery_executor import DBS,PRODUCTION,Executor,validate
from cn_production_recovery_stream import stream
class StreamTests(unittest.TestCase):
 def command(self,source):return [sys.executable,'-c',source]
 def test_large_real_stream_bounded(self):
  output=stream(self.command("import sys; b=b'x'*1048576; [sys.stdout.buffer.write(b) for _ in range(40)]"),self.command("import sys,hashlib; h=hashlib.sha256(); n=0\nwhile True:\n b=sys.stdin.buffer.read(65536)\n if not b:break\n h.update(b);n+=len(b)\nprint(n,h.hexdigest())"),pass_fds=(),timeout=10)
  self.assertEqual(output.decode().split()[0],str(40*1048576))
  self.assertEqual(output.decode().split()[1],hashlib.sha256(b'x'*(40*1048576)).hexdigest())
 def test_prefix_stream(self):self.assertEqual(stream(self.command("print('body')"),['/bin/cat'],b'header\n',pass_fds=()),b'header\nbody\n')
 def test_silent_hang_has_deadline(self):
  start=time.monotonic()
  with self.assertRaisesRegex(RuntimeError,'TIMEOUT'):stream(self.command('import time;time.sleep(60)'),self.command('import time;time.sleep(60)'),timeout=.15,pass_fds=())
  self.assertLess(time.monotonic()-start,3)
 def test_grandchild_stdout_holder_has_deadline_and_cleanup(self):
  start=time.monotonic()
  child="import subprocess,sys;subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);sys.exit(0)"
  with self.assertRaisesRegex(RuntimeError,'STREAM_FAILED'):stream(self.command("print('x')"),self.command(child),timeout=.2,pass_fds=())
  self.assertLess(time.monotonic()-start,3)
 def test_producer_failure_rejected_after_partial_output(self):
  with self.assertRaisesRegex(RuntimeError,'STREAM_FAILED'):stream(self.command("import sys;print('partial');sys.exit(7)"),['/bin/cat'],pass_fds=())
 def test_consumer_failure_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'STREAM_FAILED'):stream(self.command("print('data')"),self.command('import sys;sys.exit(8)'),pass_fds=())
 def test_output_bound(self):
  with self.assertRaisesRegex(RuntimeError,'STREAM_FAILED'):stream(self.command("print('x')"),self.command("import sys;sys.stdout.buffer.write(b'x'*(17*1024*1024))"),pass_fds=())
 def test_missing_runtime_rejected(self):
  with self.assertRaises(FileNotFoundError):stream(['/no/such/node'],['/bin/cat'],pass_fds=())
 def test_missing_runner_real_subprocess(self):
  with self.assertRaisesRegex(RuntimeError,'STREAM_FAILED'):stream(self.command("print('{}')"),[sys.executable,'/nonexistent/recovery-runner.py'],pass_fds=())
def plan():
 identity={'sourceRevision':'a'*40,'baselineRevision':'b'*40,'migrationPlanSha256':'c'*64,'attemptId':'d'*32}
 ref=lambda name:{'path':'/etc/workspacex-cn/private/'+name,'sha256':'e'*64}
 p={'schemaVersion':1,'identity':identity,'toolRevision':'3'*40,'production':{'instanceId':PRODUCTION,'hostname':'production.example','regionId':'cn-shanghai','providerBindingSha256':'4'*64,'databasePeers':{d:{'database':d,'serverAddr':'10.0.0.1','serverPort':5432,'systemIdentifier':'123'} for d in DBS},'transportPeers':{d:{'peerAddressSha256':'5'*64,'port':5432} for d in DBS}},'authorization':{'identity':identity,'productionInstanceId':PRODUCTION,'action':'replace-three-production-databases-with-exact-baseline','notBefore':0,'expiresAt':3600},'databases':{d:{'database':d,'sourceRdsInstanceId':PRODUCTION,'baselineRevision':'b'*40,'recipientCertificateSha256':'e'*64,'dumpExitCode':0,'encryptionExitCode':0,'dumpBytes':20,'ciphertext':{'path':'/etc/workspacex-cn/private/'+d+'.cms','sha256':'f'*64,'bytes':30},'sourceCatalog':ref(d+'.json'),'sourceCatalogSha256':'e'*64,'backupReceiptSha256':'6'*64,'serverVersionNum':160000,'completeClusterRoleNames':['migration_admin','app']} for d in DBS},'clientImage':'sha256:'+'2'*64,'clientImageLabels':{'source':'3'*40},'clientPostgresMajor':16,'networkId':'7'*64,'sslmode':'verify-full','spoolBytes':1000,'holdGeneration':'g','holdSha256':'8'*64,'writerPlanCanonicalSha256':'9'*64}
 for k in ('recipientCertificate','recipientKey','rolesSql','credential','fidelityRunner','catalogModule','fidelityModule','caCertificate','productionIdentityProbe','writerPlan'):p[k]=ref(k)
 p['writerTransport']={**ref('writerTransport'),'sourcePath':'.harness/scripts/vm/writer_transport.py'}
 return p

class ValidationTests(unittest.TestCase):
 def test_exact_authorization(self):self.assertEqual(validate(plan(),now=100)['baselineRevision'],'b'*40)
 def test_expiry(self):
  with self.assertRaisesRegex(RuntimeError,'AUTHORIZATION'):validate(plan(),now=3601)
 def test_wrong_production(self):
  p=plan();p['production']['instanceId']='pgm-other'
  with self.assertRaisesRegex(RuntimeError,'PRODUCTION_IDENTITY'):validate(p,now=100)
 def test_missing_db(self):
  p=plan();del p['databases']['workspacex_memory']
  with self.assertRaisesRegex(RuntimeError,'THREE_DATABASE'):validate(p,now=100)
 def test_baseline_drift(self):
  p=plan();p['databases']['workspacex']['baselineRevision']='9'*40
  with self.assertRaisesRegex(RuntimeError,'BACKUP_IDENTITY'):validate(p,now=100)
 def test_recipient_drift(self):
  p=plan();p['databases']['workspacex']['recipientCertificateSha256']='9'*64
  with self.assertRaisesRegex(RuntimeError,'RECIPIENT'):validate(p,now=100)
 def test_mutable_image(self):
  p=plan();p['clientImage']='postgres:latest'
  with self.assertRaisesRegex(RuntimeError,'IMMUTABLE'):validate(p,now=100)
 def test_tls_exception_rejected(self):
  p=plan();p['sslmode']='disable'
  with self.assertRaisesRegex(RuntimeError,'TLS'):validate(p,now=100)
class PrivateSchemaTests(unittest.TestCase):
 def reject(self,change,code):
  p=plan();change(p)
  with self.assertRaisesRegex(RuntimeError,code):validate(p,now=100)
 def test_unknown_field_rejected(self):self.reject(lambda p:p.update(allowUnsafe=True),'PRIVATE_PLAN_SCHEMA')
 def test_roles_sql_missing_rejected_before_transport(self):self.reject(lambda p:p.pop('rolesSql'),'PRIVATE_PLAN_SCHEMA')
 def test_relative_secret_path_rejected(self):self.reject(lambda p:p['credential'].update(path='relative-secret'),'PRIVATE_REFERENCE_PATH')
 def test_parent_escape_rejected(self):self.reject(lambda p:p['recipientKey'].update(path='/etc/workspacex-cn/../key'),'PRIVATE_REFERENCE_PATH')
 def test_reference_extra_field_rejected(self):self.reject(lambda p:p['credential'].update(password='secret'),'PRIVATE_REFERENCE_SCHEMA')
 def test_source_catalog_digest_drift_rejected(self):self.reject(lambda p:p['databases']['workspacex']['sourceCatalog'].update(sha256='0'*64),'CATALOG_BACKUP_BINDING')
 def test_boolean_exit_code_rejected(self):self.reject(lambda p:p['databases']['workspacex'].update(dumpExitCode=False),'BACKUP_EXIT_SCHEMA')
 def test_role_omission_across_databases_rejected(self):self.reject(lambda p:p['databases']['workspacex'].update(completeClusterRoleNames=['app']),'CLUSTER_ROLE_CLOSURE')
 def test_unbounded_auth_time_rejected(self):self.reject(lambda p:p['authorization'].update(expiresAt=float('inf')),'AUTHORIZATION_TIME')
 def test_sql_peer_wrong_database_rejected(self):self.reject(lambda p:p['production']['databasePeers']['workspacex'].update(database='postgres'),'SQL_PEER_SCHEMA')
class OrchestrationTests(unittest.TestCase):
 def setup(self):
  p=plan();p['authorization']['notBefore']=time.time()-10;p['authorization']['expiresAt']=time.time()+100
  events=[]
  class Protected:
   def recheck(self):events.append('recheck')
  class Journal:
   def record(self,state,**facts):events.append((state,facts))
  class Transport:
   def require_lock(self):events.append('lock')
   def capability(self,p):events.append('capability')
   def guard(self,p):
    return {'kind':'maintenance-writers-held','identity':p['identity'],'holdGeneration':'g','holdSha256':p['holdSha256'],'planSha256':p['writerPlanCanonicalSha256'],'observedAt':time.time(),'databasePeers':p['production']['databasePeers'],'observationSha256':'live'}
   def apply(self,kind,db,p):events.append(('apply',kind,db))
   def fidelity(self,db,p):return {'database':db,'targetRdsInstanceId':PRODUCTION,'ciphertextSha256':'f'*64,'catalogSha256':'e'*64,'dataFidelityVerified':True,'readOnly':True,'rollbackComplete':True}
  return Executor(p,Protected(),Transport(),Journal()),events
 def test_intent_before_each_action_all_three_readbacks(self):
  x,e=self.setup();r=x.run();self.assertEqual(set(r['databases']),set(DBS));self.assertFalse(r['ready'])
  for i,event in enumerate(e):
   if isinstance(event,tuple) and event[0]=='apply':self.assertEqual(e[i-1][0],'action-intent')
 def test_failure_retains_hold_and_does_not_continue(self):
  x,e=self.setup()
  def fail(*a):raise RuntimeError('PRIVATE_PROVIDER_ERROR')
  x.transport.apply=fail
  with self.assertRaisesRegex(RuntimeError,'PRIVATE_PROVIDER_ERROR'):x.run()
  self.assertEqual(e[-1],('recovery-outcome-unknown',{'holdDisposition':'retain'}));self.assertNotIn('PRIVATE_PROVIDER_ERROR',repr(e))
 def test_truthy_receipt_rejected(self):
  x,e=self.setup();original=x.transport.fidelity
  def bad(db,p):r=original(db,p);r['dataFidelityVerified']=1;return r
  x.transport.fidelity=bad
  with self.assertRaisesRegex(RuntimeError,'REAL_FIDELITY'):x.run()
 def test_guard_generation_drift_before_any_action(self):
  x,e=self.setup();original=x.transport.guard
  def bad(p):r=original(p);r['holdGeneration']='changed';return r
  x.transport.guard=bad
  with self.assertRaisesRegex(RuntimeError,'LIVE_GUARD'):x.run()
  self.assertFalse(any(isinstance(v,tuple) and v[0]=='apply' for v in e))
if __name__=='__main__':unittest.main()
