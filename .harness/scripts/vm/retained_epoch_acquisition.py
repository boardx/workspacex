#!/usr/bin/env python3
"""Retained-session backup protocol boundary; existing helper cannot acquire yet.
No constructor opens DBs. No import/CLI runs SQL, backup, replay or collection.
"""
import copy,time,math
from cn_backup_package import BackupLease,validate,compile_role_sql,dump_command,encrypt_command
from cn_backup_channel import Cursor,query_table,mutation_table
from writer_fence import DATABASES,digest,require
from current_held_epoch_evidence_producer import binding,write_collection,produce

PROTOCOL='retained-fixed-backup-v1'
BLOCKERS=('retained-control-fixed-backup-query-row-protocol',
          'retained-control-bound-backup-mutation-protocol',
          'parent-owned-backend-observer-relay-without-fork-channel-use',
          'retained-control-cleanup-without-new-admin-watchdog',
          'source-owned-object-and-isolated-recovery-acquisition')

class RetainedBackupChannel:
 """Fixed Cursor protocol over an ALREADY retained channel, never BackupChannel.
 Existing control_connection.cjs rejects this operation; negotiated capability
 is mandatory. No fallback, constructor factory, reconnect, close or raw SQL.
 """
 def __init__(self,channel,db,host_plan,expected_binding,*,expected_identity):
  self.channel=channel;self.database=db;self.host=host_plan
  self.pinned=copy.deepcopy(expected_binding)
  require(channel.binding==self.pinned and channel.mode=='control','RETAINED_BACKUP_SESSION_BINDING')
  self.protocol={'kind':PROTOCOL,'identity':host_plan['backup']['identity'],
    'toolRevision':host_plan['backup']['toolRevision'],'database':db,
    'queriesSha256':digest(query_table()),'mutationsSha256':digest(mutation_table(host_plan['backup'],host_plan['objectScope'],expected_identity=expected_identity))}
  require(getattr(channel,'retained_backup_protocol',None)==self.protocol,'RETAINED_BACKUP_PROTOCOL_NOT_INSTALLED')
 def cursor(self):return Cursor(self)
 def request(self,message,deadline_seconds=10):
  require(type(deadline_seconds) in (int,float) and math.isfinite(deadline_seconds) and 0<deadline_seconds<=10,'RETAINED_BACKUP_REQUEST_DEADLINE')
  require(self.channel.binding==self.pinned,'RETAINED_BACKUP_CHANNEL_CHANGED')
  require(message.get('operation') in ('query','mutation','verify-backup-transport'),'RETAINED_BACKUP_FIXED_OPERATION')
  if message['operation']=='query':
   require(set(message)=={'operation','queryId'} and message['queryId'] in query_table(),'RETAINED_BACKUP_QUERY_ALLOWLIST')
  elif message['operation']=='verify-backup-transport':
   require(set(message)=={'operation','facts'} and type(message['facts']) is dict,'RETAINED_BACKUP_TRANSPORT_FACTS')
  else:
   action=message.get('action');require(action in {'login',*self.host['statements'][self.database]},'RETAINED_BACKUP_MUTATION_ALLOWLIST')
   if action=='login':require(set(message)=={'operation','action','password'} and type(message['password']) is str and 32<=len(message['password'])<=128,'RETAINED_BACKUP_CREDENTIAL_STDIN')
   else:require(set(message)=={'operation','action','statement'} and type(message['statement']) is int and 0<=message['statement']<len(self.host['statements'][self.database][action]),'RETAINED_BACKUP_STATEMENT_INDEX')
  reply=self.channel.request({'operation':'retained-fixed-backup','protocol':self.protocol,'request':message},deadline_seconds=deadline_seconds)
  require(self.channel.binding==self.pinned and reply.get('connection')==self.pinned and type(reply.get('fields')) is list and type(reply.get('rows')) is list,'RETAINED_BACKUP_RESPONSE_BINDING')
  return reply

 def verify_backup_transport(self,facts,deadline_seconds=10):
  reply=self.request({'operation':'verify-backup-transport','facts':facts},deadline_seconds=deadline_seconds)
  require(reply['rows']==[{'verified':True}],'RETAINED_BACKUP_TRANSPORT_UNPROVEN');return True

class RetainedEpochAcquisition:
 """Source-owned boundary around the existing all-writer actor and six sessions.
 Exposes executable blocked observations, a fixed compiled protocol recipe and
 fail-closed acquisition admission. Does not accept an opaque backup callback.
 """
 def __init__(self,backup_plan,approved_host_plan,actor,epoch_binding,runtime_sessions,approved_host_reference=None):
  self.backup=copy.deepcopy(backup_plan);self.host=copy.deepcopy(approved_host_plan);self.approved_host_reference=copy.deepcopy(approved_host_reference)
  self.actor=actor;self.b=binding(epoch_binding,expected_identity=actor.identity);self.sessions=copy.deepcopy(runtime_sessions)
  require(validate(self.backup,expected_identity=self.actor.identity)==self.b['identity'] and self.backup['toolRevision']==self.b['toolRevision'],'RETAINED_BACKUP_FIXED_IDENTITY')
  require(self.host['backup']==self.backup and self.host['statements']==mutation_table(self.backup,self.host['objectScope'],expected_identity=self.actor.identity),'RETAINED_BACKUP_APPROVED_PLAN')
  require(set(self.sessions)=={'control','diagnostic'} and all(set(v)==set(DATABASES) for v in self.sessions.values()),'RETAINED_SIX_SESSION_CLOSURE')
  transport=actor.transport;self.transport=transport
  require(actor.identity==self.b['identity'] and actor.plan['holdGeneration']==self.b['holdGeneration'],'RETAINED_ACTOR_IDENTITY')
  for mode in ('control','diagnostic'):
   channels=getattr(transport,mode+'_connections',None)
   require(type(channels) is dict and set(channels)==set(DATABASES),'RETAINED_CHANNELS_REQUIRED')
   for db,ch in channels.items():require(ch.binding==self.sessions[mode][db] and ch.mode==mode,'RETAINED_ACTUAL_SESSION_BINDING')
  require(len({(v['peer']['database'],v['pid'],v['backendStart']) for group in self.sessions.values() for v in group.values()})==6,'RETAINED_DISTINCT_SIX_SESSIONS')
 def check_retained(self):
  for mode in ('control','diagnostic'):
   for db,ch in getattr(self.transport,mode+'_connections').items():require(ch.binding==self.sessions[mode][db],'RETAINED_SESSION_DRIFT')
 def blocked_observation(self,phase,root):
  require(phase in ('before','after'),'RETAINED_OBSERVATION_PHASE');self.check_retained()
  held=self.actor.hold();observed=self.actor.observe();self.actor.assert_blocked(observed);self.check_retained()
  require(observed['host']==self.b['host'],'RETAINED_OBSERVATION_HOST')
  stamp=time.time();refs={}
  for name,facts in [('held',{'state':held['state'],'observedAt':stamp}),('drained',{'allWritersDrained':True,'observedAt':stamp,'observationSha256':digest(observed)})]:
   proof={**self.b,'kind':phase+'-'+name,'passed':True,'facts':facts}
   refs[name]=write_collection(str(root/(phase+'-'+name+'.json')),proof)
  return refs
 def fixed_recipe(self):
  """Uses exact existing compiler; recipes are instructions, never success proof."""
  sql=compile_role_sql(self.backup,self.host['objectScope'],expected_identity=self.actor.identity);owner=digest(self.b)[:32]
  return {'fixedQueries':query_table(),'fixedMutations':self.host['statements'],'sqlSha256':digest(sql),
    'dumpCommands':{db:dump_command(self.backup,db,'wsx-backup-'+owner,owner,expected_identity=self.actor.identity) for db in DATABASES},
    'encryptCommand':encrypt_command(self.backup,expected_identity=self.actor.identity),'ready':False,'blockers':list(BLOCKERS)}
 def acquire(self,journal=None):
  """Explicit source-only acquisition using the protected retained host reference."""
  self.check_retained()
  require(self.approved_host_reference is not None and journal is not None,'RETAINED_EPOCH_ACQUISITION_PROTOCOL_REQUIRED:PROTECTED_HOST_REFERENCE_AND_JOURNAL')
  from retained_backup_host import RetainedBackupHost
  host=RetainedBackupHost(self.approved_host_reference,self.actor)
  require(host.plan==self.backup and host.host==self.host,'RETAINED_EPOCH_APPROVED_HOST_DRIFT')
  return BackupLease(self.backup,host,journal,expected_identity=self.actor.identity).run()
 def collect_complete_refs(self,payload,reader,large_reader):
  require(all(payload[k]==self.b[k] for k in self.b),'RETAINED_COLLECTION_BINDING')
  self.check_retained();return produce(payload,reader,large_reader,expected_identity=self.actor.identity)
