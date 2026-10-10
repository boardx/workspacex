#!/usr/bin/env python3
# BEGIN GENERATED RELEASE IDENTITIES
def admitted_release_identity(identity):
    return type(identity) is dict and ((identity.get('sourceRevision') == '9b25bfa65662b96c0826fe67506b562ea46aa6d0' and identity.get('baselineRevision') == 'ba6343199f3c834d6a198f83d0c771614292c82b') or (identity.get('sourceRevision') == '5285bef9a6c91bbb9857ede42779aafa64b98f32' and identity.get('baselineRevision') == 'a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0'))
# END GENERATED RELEASE IDENTITIES
"""Seven writer/recovery callbacks for the existing maintenance controller."""
import os,json,stat,hashlib,time,pathlib,copy,fcntl
FAMILIES=('http','socket','queue','background','agent','checkpoint','memory','privileged')
DATABASES=('workspacex','workspacex_agent','workspacex_memory')
def require(ok,code):
 if not ok:raise RuntimeError(code)
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def validate_admission_plan(plan):
 roles=plan.get('databaseWriterRoles')
 require(type(roles) is dict and set(roles)==set(DATABASES),'WRITER_ROLE_DATABASE_CLOSURE')
 for mode in ('closedAdmission','originalAdmission'):
  value=plan.get(mode)
  require(type(value) is dict and set(value)=={'kind','login'} and value['kind']=='role-login-v1' and type(value['login']) is dict and set(value['login'])==set(DATABASES),'ROLE_ADMISSION_SCHEMA')
  for db in DATABASES:
   targets=roles[db];login=value['login'][db]
   require(type(targets) is list and targets and all(type(r) is str and r for r in targets) and len(set(targets))==len(targets) and plan['diagnosticRole'] not in targets,'WRITER_ROLE_TARGETS')
   require(type(login) is dict and set(login)==set(targets) and all(type(v) is bool for v in login.values()),'ROLE_ADMISSION_TARGET_CLOSURE')
   if mode=='closedAdmission':require(all(v is False for v in login.values()),'CLOSED_WRITER_ROLE_LOGIN_ENABLED')
 # PostgreSQL roles are cluster-wide: per-database views must not disagree.
 for i,db in enumerate(DATABASES):
  for other in DATABASES[:i]:
   a,b=plan['databasePeers'][db],plan['databasePeers'][other]
   if a.get('systemIdentifier') is not None and a.get('systemIdentifier')==b.get('systemIdentifier'):
    require(set(roles[db])==set(roles[other]) and all(plan[m]['login'][db]==plan[m]['login'][other] for m in ('closedAdmission','originalAdmission')),'CLUSTER_ROLE_ADMISSION_DIVERGENCE')

class Journal:
 def __init__(self,directory,identity,uid=0,boundary=None):
  self.directory=pathlib.Path(directory);self.uid=uid
  for p in (self.directory,*self.directory.parents):
   s=p.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==uid and not s.st_mode&0o022,'JOURNAL_PARENT_TRUST')
   if boundary and p==pathlib.Path(boundary):break
  require(stat.S_IMODE(self.directory.stat().st_mode)==0o700,'JOURNAL_PRIVATE')
  self.fd=os.open(self.directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);self.path='writer-fence.json'
  try:
   f=os.open(self.path,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=self.fd)
  except FileNotFoundError:self.value={'schemaVersion':1,'identity':identity,'state':'new','ready':False,'events':[]}
  else:
   with os.fdopen(f,'rb') as stream:
    s=os.fstat(stream.fileno());require(stat.S_ISREG(s.st_mode) and s.st_uid==uid and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'JOURNAL_FILE_TRUST');self.value=json.load(stream)
   require(self.value['identity']==identity,'JOURNAL_IDENTITY')
  self.base=copy.deepcopy(self.value)
 def save(self):
  lockfd=os.open('.writer-fence.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600,dir_fd=self.fd)
  try:
   st=os.fstat(lockfd);require(stat.S_ISREG(st.st_mode) and st.st_uid==self.uid and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600,'JOURNAL_LOCK_TRUST')
   fcntl.flock(lockfd,fcntl.LOCK_EX)
   try:
    source=os.open(self.path,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=self.fd)
   except FileNotFoundError:current=copy.deepcopy(self.base)
   else:
    with os.fdopen(source,'rb') as stream:
     st=os.fstat(stream.fileno());require(stat.S_ISREG(st.st_mode) and st.st_uid==self.uid and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600,'JOURNAL_FILE_TRUST');current=json.load(stream)
   require(current['identity']==self.base['identity'],'JOURNAL_IDENTITY')
   require(self.value['events'][:len(self.base['events'])]==self.base['events'] and current['events'][:len(self.base['events'])]==self.base['events'],'JOURNAL_EVENT_DIVERGENCE')
   for key in set(self.value)|set(self.base):
    if key in ('events','state'):continue
    if self.value.get(key)!=self.base.get(key):
     require(current.get(key) in (self.base.get(key),self.value.get(key)),'JOURNAL_FIELD_CONFLICT:'+key)
     current[key]=copy.deepcopy(self.value.get(key))
   appended=self.value['events'][len(self.base['events']):];current['events'].extend(appended)
   if appended:current['state']=self.value['state']
   name='.writer-fence-'+os.urandom(16).hex();f=os.open(name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600,dir_fd=self.fd)
   with os.fdopen(f,'wb') as stream:stream.write((json.dumps(current,sort_keys=True)+'\n').encode());stream.flush();os.fsync(stream.fileno())
   os.replace(name,self.path,src_dir_fd=self.fd,dst_dir_fd=self.fd);os.fsync(self.fd)
   self.value=current;self.base=copy.deepcopy(current)
  finally:os.close(lockfd)
 def record(self,state,**data):self.value['state']=state;self.value['events'].append(dict(at=time.time(),state=state,**data));self.save()
 def close(self):os.close(self.fd)
class WriterFenceAdapter:
 def __init__(self,identity,plan,transport,journal):
  self.identity=identity;self.plan=plan;self.transport=transport;self.journal=journal
  validate_admission_plan(plan)
  require(plan['identity']==identity and plan['sourceEvidenceSha256'] and plan['host']['instanceId'],'PLAN_IDENTITY')
  require(set(plan['databasePeers'])==set(DATABASES),'THREE_DATABASE_PLAN')
  require({f for b in plan['writers'] for f in b['families']}==set(FAMILIES),'WRITER_FAMILY_CLOSURE')
  require(len({b['key'] for b in plan['writers']})==len(plan['writers']),'WRITER_DUPLICATE')
  if journal.value.get('planSha256') is not None:require(journal.value['planSha256']==digest(plan),'JOURNAL_PLAN_DRIFT')
  journal.value['planSha256']=digest(plan);journal.save()
 def bind(self,identity):require(identity==self.identity,'CALLBACK_IDENTITY');self.transport.require_lock()
 def hold(self):
  h=self.transport.read_hold();require(h['identity']==self.identity and h['generation']==self.plan['holdGeneration'] and h['state']=='held','HOLD_NOT_PROVEN');return h
 def observe(self,expected_admission=None):
  validate_admission_plan(self.plan)
  s=self.transport.observe(self.plan)
  require(s['host']==self.plan['host'] and 0<=time.time()-s['observedAt']<=30,'OBSERVATION_IDENTITY_FRESHNESS')
  require(set(s['scopes'])=={'host-proc','all-docker-containers','systemd-writer-units','three-db-sessions','database-admission'},'OBSERVATION_INCOMPLETE')
  require(set(s['databases'])==set(DATABASES),'THREE_DB_OBSERVATION')
  for db,value in s['databases'].items():require(value['peer']==self.plan['databasePeers'][db],'DATABASE_PEER_IDENTITY')
  require(s['admission']==(self.plan['closedAdmission'] if expected_admission is None else expected_admission),'DATABASE_ADMISSION_NOT_PROVEN')
  require(set(s['writers'])=={b['key'] for b in self.plan['writers']} and s['unclassifiedProcesses']==[] and s['unclassifiedContainers']==[],'UNCLASSIFIED_WRITER')
  for b in self.plan['writers']:require(s['writers'][b['key']]['binding']==b['binding'],'WRITER_LIVE_IDENTITY_DRIFT')
  return s
 def assert_blocked(self,s):
  validate_admission_plan(self.plan)
  require(s['admission']==self.plan['closedAdmission'] and all(v is False for login in s['admission']['login'].values() for v in login.values()),'LIVE_WRITER_ROLE_LOGIN_ENABLED')
  require(all(v['state'] in ('paused','stopped') for v in s['writers'].values()),'WRITER_STILL_RUNNING')
  require(s['automationUnits']=={u:'masked' for u in self.plan['automationUnits']},'COMPETING_AUTOMATION_ENABLED')
  for db,value in s['databases'].items():
   require(value['preparedTransactions']==[],'PREPARED_TRANSACTION_UNACCOUNTED')
   for session in value['sessions']:
    if session.get('clientIdentity')=='maintenance-control':
     bound=self.plan['controlSessions'][db];require(session['pid']==bound['pid'] and session['backendStart']==bound['backendStart'] and session['role']==bound['role'] and session['transactionMode']=='idle-controlled','CONTROL_SESSION_NOT_BOUND');continue
    require(session['role']==self.plan['diagnosticRole'] and session['clientIdentity']==self.plan['diagnosticClientIdentity'] and session['transactionMode']=='read-only' and session['backendType']=='client backend','DATABASE_WRITER_SESSION')
 def blockAllWrites(self,identity):
  self.bind(identity);self.hold();self.transport.verify_capabilities(self.plan)
  expected=self.plan['originalAdmission'] if self.journal.value.get('prior') is None else self.plan['closedAdmission']
  s=self.observe(expected);prior=self.journal.value.get('prior')
  if prior is None:self.journal.value['prior']=s;self.journal.record('prior-captured',hold=self.hold())
  else:require(prior['host']==s['host'],'PRIOR_HOST_DRIFT')
  actions=[{'kind':'close-database-admission','before':s['admission'],'after':self.plan['closedAdmission']}]
  actions += [{'kind':'mask-unit','unit':u} for u in self.plan['automationUnits']]
  actions += [{'kind':'pause-writer','key':b['key'],'binding':b['binding']} for b in self.plan['writers'] if s['writers'][b['key']]['state']=='running']
  for action in actions:
   self.journal.record('action-intent',action=action)
   try:self.transport.apply(action,self.plan)
   except BaseException:
    self.journal.record('write-state-unknown',stage='blockAllWrites',pendingAction=action,holdDisposition='retain');raise
   self.journal.record('action-response',action=action)
   if action['kind']=='close-database-admission':self.observe()
  drained=self.observe()
  for db,value in drained['databases'].items():
   sessions=[v for v in value['sessions'] if v['role']!=self.plan['diagnosticRole'] and v.get('clientIdentity')!='maintenance-control']
   if sessions:
    require(all(v['role'] in self.plan['databaseWriterRoles'][db] for v in sessions),'UNCLASSIFIED_DATABASE_WRITER')
    action={'kind':'terminate-writer-sessions','database':db,'peer':value['peer'],'sessions':sessions};self.journal.record('action-intent',action=action)
    try:self.transport.apply(action,self.plan)
    except BaseException:
     self.journal.record('write-state-unknown',stage='database-drain',pendingAction=action,holdDisposition='retain');raise
  self.verifyAllWritersDrained(identity)
 def verifyAllWritersDrained(self,identity):
  self.bind(identity);h=self.hold();s=self.observe();self.assert_blocked(s);self.journal.record('writes-held',observation=s)
  return {'schemaVersion':1,'kind':'maintenance-writers-held','identity':self.identity,'holdGeneration':h['generation'],'holdSha256':digest(h),'planSha256':digest(self.plan),'observedAt':s['observedAt'],'observationSha256':digest(s),'host':s['host'],'databasePeers':{db:value['peer'] for db,value in s['databases'].items()},'databaseSessionsSha256':digest({db:value['sessions'] for db,value in s['databases'].items()}),'families':list(FAMILIES),'ready':False}
 def verifyWritesBlocked(self,identity):return self.verifyAllWritersDrained(identity)
 def resumeWrites(self,identity):
  self.bind(identity);self.hold();s=self.observe();self.assert_blocked(s);prior=self.journal.value.get('prior');require(prior is not None,'PRIOR_STATE_MISSING')
  acceptance=self.transport.read_acceptance(self.identity)
  require(acceptance is not None,'ACCEPTANCE_NOT_BOUND')
  if self.journal.value.get('acceptanceEvidence') is not None:require(self.journal.value['acceptanceEvidence']==acceptance,'ACCEPTANCE_NOT_BOUND')
  self.bindAcceptanceEvidence(acceptance)  # Revalidate freshness on every attempt, including stored receipts.
  require(self.journal.value.get('databaseRecoveryRequired') is not True,'DATABASE_RECOVERY_NOT_PROVEN')
  for b in reversed(self.plan['writers']):
   if prior['writers'][b['key']]['state']=='running':
    action={'kind':'resume-writer','key':b['key'],'binding':b['binding']};self.journal.record('resume-intent',action=action);self.transport.apply(action,self.plan)
  for unit,state in prior['automationUnits'].items():
   action={'kind':'restore-unit','unit':unit,'state':state,'priorDetails':prior.get('automationUnitDetails',{}).get(unit)};self.journal.record('resume-intent',action=action);self.transport.apply(action,self.plan)
  action={'kind':'restore-database-admission','before':self.plan['closedAdmission'],'after':prior['admission']};self.journal.record('resume-intent',action=action);self.transport.apply(action,self.plan)
  self.journal.record('resume-awaiting-readback')
 def bindAcceptanceEvidence(self,evidence):
  require(evidence and evidence['identity']==self.identity and evidence['sourceRevision']==self.identity['sourceRevision'] and evidence['result']=='accepted' and isinstance(evidence.get('evidenceSha256'),str) and len(evidence['evidenceSha256'])==64 and type(evidence.get('observedAt')) in (int,float) and 0<=time.time()-evidence['observedAt']<=300,'ACCEPTANCE_IDENTITY')
  self.journal.value['acceptanceEvidence']=evidence;self.journal.record('acceptance-bound')
 def verifyWritesResumed(self,identity):
  self.bind(identity);self.hold();prior=self.journal.value['prior'];s=self.observe(prior['admission']);require(s['writers']==prior['writers'] and s['automationUnits']==prior['automationUnits'] and s.get('automationUnitDetails')==prior.get('automationUnitDetails'),'RESUME_STATE_UNPROVEN');self.journal.record('writes-resumed',observation=s)
 def recordWriteStateReconciliationRequired(self,identity):
  self.bind(identity);self.journal.record('write-state-reconciliation-required',holdDisposition='retain',lockDisposition='retain')
 def recordDatabaseRecoveryRequired(self,identity):
  self.bind(identity);self.hold();s=self.observe();self.assert_blocked(s);self.journal.value['databaseRecoveryRequired']=True;self.journal.record('database-recovery-required',holdDisposition='retain',recoveryPlanSha256=self.plan['threeDatabaseRecoveryPlanSha256'],databases=list(DATABASES),observation=s)
 def callbacks(self):return {name:getattr(self,name) for name in ('blockAllWrites','verifyAllWritersDrained','verifyWritesBlocked','resumeWrites','verifyWritesResumed','recordWriteStateReconciliationRequired','recordDatabaseRecoveryRequired')}


def approved_release(profile, expected_identity, read_private):
    """Resolve release only from the independent protected profile and pinned refs."""
    import re
    require(admitted_release_identity(expected_identity),'EPOCH_RELEASE_PAIR')
    entry=profile.get('candidateComposeEmitter')
    require(type(entry) is dict,'EPOCH_RELEASE_CAPABILITY')
    refs=[]
    def pinned(ref):
        require(type(ref) is dict and set(ref)=={'path','sha256'},'EPOCH_RELEASE_REF')
        require(type(ref['path']) is str and ref['path'].startswith('/etc/workspacex-cn/') and '..' not in pathlib.Path(ref['path']).parts and type(ref['sha256']) is str and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'EPOCH_RELEASE_REF')
        raw=read_private(ref['path'])
        require(hashlib.sha256(raw).hexdigest()==ref['sha256'],'EPOCH_RELEASE_PIN')
        refs.append((ref,raw));return json.loads(raw)
    options=pinned(entry['optionsRef']);manifest=pinned(options['manifestRef']);config=pinned(entry['configRef'])
    require(manifest.get('sourceRevision')==expected_identity['sourceRevision'] and type(manifest.get('release')) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}',manifest['release']) and type(config.get('provision')) is dict and config['provision'].get('release')==manifest['release'],'EPOCH_RELEASE_IDENTITY')
    for ref,raw in refs:require(read_private(ref['path'])==raw,'EPOCH_RELEASE_DRIFT')
    return manifest['release']
