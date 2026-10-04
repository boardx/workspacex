#!/usr/bin/env python3
"""Retained-session backup protocol boundary; existing helper cannot acquire yet.
No constructor opens DBs. No import/CLI runs SQL, backup, replay or collection.
"""
import copy,time
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
 def __init__(self,channel,db,host_plan,expected_binding):
  self.channel=channel;self.database=db;self.host=host_plan
  self.pinned=copy.deepcopy(expected_binding)
  require(channel.binding==self.pinned and channel.mode=='control','RETAINED_BACKUP_SESSION_BINDING')
  self.protocol={'kind':PROTOCOL,'identity':host_plan['backup']['identity'],
    'toolRevision':host_plan['backup']['toolRevision'],'database':db,
    'queriesSha256':digest(query_table()),'mutationsSha256':digest(mutation_table(host_plan['backup'],host_plan['objectScope']))}
  require(getattr(channel,'retained_backup_protocol',None)==self.protocol,'RETAINED_BACKUP_PROTOCOL_NOT_INSTALLED')
 def cursor(self):return Cursor(self)
 def request(self,message):
  require(self.channel.binding==self.pinned,'RETAINED_BACKUP_CHANNEL_CHANGED')
  require(message.get('operation') in ('query','mutation'),'RETAINED_BACKUP_FIXED_OPERATION')
  if message['operation']=='query':
   require(set(message)=={'operation','queryId'} and message['queryId'] in query_table(),'RETAINED_BACKUP_QUERY_ALLOWLIST')
  else:
   action=message.get('action');require(action in {'login',*self.host['statements'][self.database]},'RETAINED_BACKUP_MUTATION_ALLOWLIST')
   if action=='login':require(set(message)=={'operation','action','password'} and type(message['password']) is str and 32<=len(message['password'])<=128,'RETAINED_BACKUP_CREDENTIAL_STDIN')
   else:require(set(message)=={'operation','action','statement'} and type(message['statement']) is int and 0<=message['statement']<len(self.host['statements'][self.database][action]),'RETAINED_BACKUP_STATEMENT_INDEX')
  reply=self.channel.request({'operation':'retained-fixed-backup','protocol':self.protocol,'request':message})
  require(self.channel.binding==self.pinned and reply.get('connection')==self.pinned and type(reply.get('fields')) is list and type(reply.get('rows')) is list,'RETAINED_BACKUP_RESPONSE_BINDING')
  return reply

class RetainedEpochAcquisition:
 """Source-owned boundary around the existing all-writer actor and six sessions.
 Exposes executable blocked observations, a fixed compiled protocol recipe and
 fail-closed acquisition admission. Does not accept an opaque backup callback.
 """
 def __init__(self,backup_plan,approved_host_plan,actor,epoch_binding,runtime_sessions):
  self.backup=copy.deepcopy(backup_plan);self.host=copy.deepcopy(approved_host_plan)
  self.actor=actor;self.b=binding(epoch_binding);self.sessions=copy.deepcopy(runtime_sessions)
  require(validate(self.backup)==self.b['identity'] and self.backup['toolRevision']==self.b['toolRevision'],'RETAINED_BACKUP_FIXED_IDENTITY')
  require(self.host['backup']==self.backup and self.host['statements']==mutation_table(self.backup,self.host['objectScope']),'RETAINED_BACKUP_APPROVED_PLAN')
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
  sql=compile_role_sql(self.backup,self.host['objectScope']);owner=digest(self.b)[:32]
  return {'fixedQueries':query_table(),'fixedMutations':self.host['statements'],'sqlSha256':digest(sql),
    'dumpCommands':{db:dump_command(self.backup,db,'wsx-backup-'+owner,owner) for db in DATABASES},
    'encryptCommand':encrypt_command(self.backup),'ready':False,'blockers':list(BLOCKERS)}
 def acquire(self):
  # Cannot reuse BackupLease host: verify_inputs opens new admins; export's fork
  # opens another admin observer; watchdog cleanup also reconnects. Existing
  # retained helper has no fixed query rows/backup authority. Do not execute it.
  self.check_retained()
  raise RuntimeError('RETAINED_EPOCH_ACQUISITION_PROTOCOL_REQUIRED:'+','.join(BLOCKERS))
 def collect_complete_refs(self,payload,reader,large_reader):
  require(all(payload[k]==self.b[k] for k in self.b),'RETAINED_COLLECTION_BINDING')
  self.check_retained();return produce(payload,reader,large_reader)
