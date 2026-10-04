import unittest,tempfile,pathlib,json,copy,time,os
from writer_fence import WriterFenceAdapter,Journal,FAMILIES,DATABASES
class FixtureTransport:
 def __init__(self,plan):
  self.plan=plan;self.hold={'identity':plan['identity'],'generation':plan['holdGeneration'],'state':'held'};self.fail=None;self.pendingJournal=None;self.acceptance=None
  self.snapshot={'host':plan['host'],'observedAt':time.time(),'scopes':['host-proc','all-docker-containers','systemd-writer-units','three-db-sessions','database-admission'],'writers':{b['key']:{'binding':b['binding'],'state':'running'} for b in plan['writers']},'automationUnits':{u:'active' for u in plan['automationUnits']},'databases':{db:{'peer':p,'sessions':[],'preparedTransactions':[]} for db,p in plan['databasePeers'].items()},'admission':plan['originalAdmission'],'unclassifiedProcesses':[],'unclassifiedContainers':[]};self.actions=[]
 def require_lock(self):pass
 def verify_capabilities(self,plan):pass
 def read_hold(self):return copy.deepcopy(self.hold)
 def read_acceptance(self,identity):return self.acceptance
 def observe(self,plan):self.snapshot['observedAt']=time.time();return copy.deepcopy(self.snapshot)
 def apply(self,a,plan):
  durable=json.loads(self.pendingJournal.read_text());self.assertion=durable['events'][-1]['action']==a
  if not self.assertion:raise RuntimeError('INTENT_NOT_DURABLE')
  self.actions.append(a)
  if a['kind']=='close-database-admission':self.snapshot['admission']=plan['closedAdmission']
  elif a['kind']=='restore-database-admission':self.snapshot['admission']=a['after']
  elif a['kind']=='mask-unit':self.snapshot['automationUnits'][a['unit']]='masked'
  elif a['kind']=='restore-unit':self.snapshot['automationUnits'][a['unit']]=a['state']
  elif a['kind']=='pause-writer':self.snapshot['writers'][a['key']]['state']='paused'
  elif a['kind']=='resume-writer':self.snapshot['writers'][a['key']]['state']='running'
  elif a['kind']=='terminate-writer-sessions':self.snapshot['databases'][a['database']]['sessions']=[]
  if self.fail==a['kind']:raise RuntimeError('RESPONSE_LOST')
class Tests(unittest.TestCase):
 def setup_fixture(self,root):
  identity={'sourceRevision':'9'*40,'baselineRevision':'b'*40,'migrationPlanSha256':'a'*64,'attemptId':'test-attempt'}
  plan={'identity':identity,'sourceEvidenceSha256':'e'*64,'host':{'instanceId':'instance','bootId':'boot'},'holdGeneration':1,'writers':[{'key':f,'families':[f],'binding':{'kind':'process','pid':100+i,'startTicks':1,'exeSha256':'f'*64}} for i,f in enumerate(FAMILIES)],'databasePeers':{db:{'resourceId':db,'tlsPeerSha256':'f'*64} for db in DATABASES},'databaseWriterRoles':{db:['app','privileged'] for db in DATABASES},'automationUnits':['deploy.timer','scheduler.service'],'closedAdmission':{'kind':'role-login-v1','login':{db:{'app':False,'privileged':False} for db in DATABASES}},'originalAdmission':{'kind':'role-login-v1','login':{db:{'app':True,'privileged':True} for db in DATABASES}},'diagnosticRole':'diag_ro','diagnosticClientIdentity':'bound-diagnostic','threeDatabaseRecoveryPlanSha256':'d'*64}
  transport=FixtureTransport(plan);journal=Journal(root,identity,os.getuid(),root);transport.pendingJournal=root/'writer-fence.json';adapter=WriterFenceAdapter(identity,plan,transport,journal);return identity,plan,transport,journal,adapter
 def test_durable_stop_and_explicit_resume(self):
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);i,p,tr,j,a=self.setup_fixture(root)
   try:
    a.blockAllWrites(i);self.assertTrue(tr.assertion);self.assertEqual(j.value['state'],'writes-held');self.assertEqual(len(a.callbacks()),7)
    with self.assertRaisesRegex(RuntimeError,'ACCEPTANCE'):a.resumeWrites(i)
    tr.acceptance={'identity':i,'sourceRevision':i['sourceRevision'],'result':'accepted','evidenceSha256':'f'*64,'observedAt':time.time()};a.bindAcceptanceEvidence(tr.acceptance);a.resumeWrites(i);a.verifyWritesResumed(i);self.assertEqual(j.value['state'],'writes-resumed');self.assertEqual(tr.hold['state'],'held')
   finally:j.close()
 def test_every_writer_family_remaining_active_fails(self):
  for family in FAMILIES:
   with self.subTest(family=family),tempfile.TemporaryDirectory() as t:
    root=pathlib.Path(t);root.chmod(0o700);i,p,tr,j,a=self.setup_fixture(root)
    try:
     a.blockAllWrites(i);tr.snapshot['writers'][family]['state']='running'
     with self.assertRaisesRegex(RuntimeError,'WRITER_STILL_RUNNING'):a.verifyWritesBlocked(i)
     a.recordWriteStateReconciliationRequired(i);self.assertEqual(j.value['state'],'write-state-reconciliation-required');self.assertEqual(tr.hold['state'],'held')
    finally:j.close()
 def test_competing_privileged_db_sessions_and_unknown_processes(self):
  for kind in ('database','process','container','prepared','automation','peer'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as t:
    root=pathlib.Path(t);root.chmod(0o700);i,p,tr,j,a=self.setup_fixture(root)
    try:
     a.blockAllWrites(i);db=DATABASES[0]
     if kind=='database':tr.snapshot['databases'][db]['sessions']=[{'role':'privileged','clientIdentity':'foreign','transactionMode':'read-write','backendType':'client backend'}]
     elif kind=='process':tr.snapshot['unclassifiedProcesses']=[{'pid':999}]
     elif kind=='container':tr.snapshot['unclassifiedContainers']=['foreign']
     elif kind=='prepared':tr.snapshot['databases'][db]['preparedTransactions']=[{'gid':'unknown'}]
     elif kind=='automation':tr.snapshot['automationUnits']['deploy.timer']='active'
     else:tr.snapshot['databases'][db]['peer']={'resourceId':'foreign'}
     with self.assertRaises(RuntimeError):a.verifyWritesBlocked(i)
     self.assertEqual(tr.hold['state'],'held')
    finally:j.close()
 def test_response_lost_restart_reconciliation_retains_hold(self):
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);i,p,tr,j,a=self.setup_fixture(root);tr.fail='pause-writer'
   with self.assertRaisesRegex(RuntimeError,'RESPONSE_LOST'):a.blockAllWrites(i)
   self.assertEqual(j.value['state'],'write-state-unknown');j.close();j=Journal(root,i,os.getuid(),root);a=WriterFenceAdapter(i,p,tr,j)
   try:
    with self.assertRaises(RuntimeError):a.verifyWritesBlocked(i)
    a.recordWriteStateReconciliationRequired(i);self.assertEqual(tr.hold['state'],'held');self.assertEqual(j.value['events'][-1]['lockDisposition'],'retain')
   finally:j.close()
 def test_database_recovery_required_has_no_image_rollback_or_hold_clear(self):
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);i,p,tr,j,a=self.setup_fixture(root)
   try:
    a.blockAllWrites(i);a.recordDatabaseRecoveryRequired(i);self.assertTrue(j.value['databaseRecoveryRequired']);self.assertEqual(j.value['events'][-1]['databases'],list(DATABASES));self.assertEqual(tr.hold['state'],'held')
    tr.acceptance={'identity':i,'sourceRevision':i['sourceRevision'],'result':'accepted','evidenceSha256':'f'*64,'observedAt':time.time()};a.bindAcceptanceEvidence(tr.acceptance)
    with self.assertRaisesRegex(RuntimeError,'RECOVERY'):a.resumeWrites(i)
    self.assertNotIn('clearMaintenanceHold',a.callbacks())
   finally:j.close()
 def test_unclassified_session_blocks_termination(self):
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);i,p,tr,j,a=self.setup_fixture(root);tr.snapshot['databases'][DATABASES[1]]['sessions']=[{'role':'unknown-admin'}]
   try:
    with self.assertRaisesRegex(RuntimeError,'UNCLASSIFIED_DATABASE_WRITER'):a.blockAllWrites(i)
    self.assertFalse(any(x['kind']=='terminate-writer-sessions' for x in tr.actions));self.assertEqual(tr.hold['state'],'held')
   finally:j.close()
 def test_stale_stored_acceptance_cannot_resume(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);i,p,tr,j,a=self.setup_fixture(root)
   try:
    a.blockAllWrites(i);now=time.time();tr.acceptance={'identity':i,'sourceRevision':i['sourceRevision'],'result':'accepted','evidenceSha256':'f'*64,'observedAt':now};a.bindAcceptanceEvidence(tr.acceptance);count=len(tr.actions)
    with patch('time.time',return_value=now+400),self.assertRaisesRegex(RuntimeError,'ACCEPTANCE_IDENTITY'):a.resumeWrites(i)
    self.assertEqual(len(tr.actions),count);self.assertEqual(tr.hold['state'],'held')
   finally:j.close()
 def test_prior_stopped_and_paused_states_preserved(self):
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);i,p,tr,j,a=self.setup_fixture(root);tr.snapshot['writers']['http']['state']='stopped';tr.snapshot['writers']['socket']['state']='paused'
   try:
    a.blockAllWrites(i);self.assertFalse(any(x['kind']=='pause-writer' and x['key'] in ('http','socket') for x in tr.actions));tr.acceptance={'identity':i,'sourceRevision':i['sourceRevision'],'result':'accepted','evidenceSha256':'f'*64,'observedAt':time.time()};a.resumeWrites(i);a.verifyWritesResumed(i);self.assertEqual(tr.snapshot['writers']['http']['state'],'stopped');self.assertEqual(tr.snapshot['writers']['socket']['state'],'paused')
   finally:j.close()
if __name__=='__main__':unittest.main()
