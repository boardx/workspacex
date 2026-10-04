"""Pure profile binder; no installation, connection or credential mutation.

Metadata is a protected-file observation, not authority. A source-owned verifier
must validate the existing provider/transport exception with the canonical
transport implementation. No bool, JSON approval flag or echoed profile grants
that authority. Default verifier refuses because Python cannot replace the
compiled canonical existing-transport validator.
"""
import copy,hashlib,json,re
from cn_backup_package import APP,BASE,ECS,RDS,validate,exact
from cn_backup_channel import query_table,mutation_table
from writer_fence import DATABASES,require

class ExistingTransportAuthority:
 def verify(self,host,configuration_bytes):
  raise RuntimeError('BACKUP_CANONICAL_TRANSPORT_VERIFIER_NOT_CONNECTED')


def protected(reference,files,mode):
 exact(reference,('path','sha256'),'BACKUP_PROFILE_REFERENCE')
 path=reference['path']
 require(type(path) is str and path.startswith('/') and '..' not in path.split('/') and
         type(reference['sha256']) is str and re.fullmatch('[a-f0-9]{64}',reference['sha256']),
         'BACKUP_PROFILE_REFERENCE_FORMAT')
 require(path in files,'BACKUP_PROFILE_ACTUAL_FILE_MISSING')
 f=files[path]
 exact(f,('bytes','uid','gid','mode','links','regular','symlink','parentsProtected'), 'BACKUP_PROFILE_FILE_METADATA')
 require(type(f['bytes']) is bytes and type(f['uid']) is int and type(f['gid']) is int and
         type(f['links']) is int and (f['uid'],f['gid'],f['links'])==(0,0,1) and
         f['mode']==mode and f['regular'] is True and f['symlink'] is False and
         f['parentsProtected'] is True and hashlib.sha256(f['bytes']).hexdigest()==reference['sha256'],
         'BACKUP_PROFILE_FILE_TRUST')
 return f['bytes']


def bind_backup_profile(existing,host_reference,files,authority=None):
 """Compile data from source-owned actual file captures. Does not write profile.
 Captures must be obtained using root-private nofollow readers at installation;
 this pure function cannot establish truth of caller-supplied metadata itself.
 """
 host=json.loads(protected(host_reference,files,'0600'));p=host['backup'];identity=validate(p)
 require(host['identity']==identity and existing['toolRevision']==p['toolRevision'], 'BACKUP_PROFILE_IDENTITY')
 require(host_reference['path']==f'/etc/workspacex-cn/maintenance-backup/{APP}/{identity["attemptId"]}/host-plan.json',
         'BACKUP_PROFILE_HOST_PATH')
 for key,approval_hash in (('roleApproval','roleApprovalSha256'),('publicCapabilityApproval','publicCapabilityApprovalSha256')):
  ref=host[key]
  expected_path=f'/etc/workspacex-cn/backup-approvals/{identity["attemptId"]}/'+('role' if key=='roleApproval' else 'public-capability')+'.json'
  require(ref['path']==expected_path and ref['sha256']==p['authorization'][approval_hash], 'BACKUP_PROFILE_APPROVAL_REFERENCE')
  approval=json.loads(protected(ref,files,'0600'))
  exact(approval,('action','allowedPublicTemp','ecsInstanceId','expiresAt','functions','identity','notBefore','rdsInstanceId','role','schemaVersion'),'BACKUP_PROFILE_APPROVAL_SCHEMA')
  require(approval['schemaVersion']==1 and approval['identity']==identity and approval['role']=='wsx_release_backup_ro' and
          approval['functions']==p['functionBodies'] and approval['action']==p['authorization']['action'] and
          all(approval[k]==p['authorization'][k] for k in ('ecsInstanceId','rdsInstanceId','notBefore','expiresAt')) and
          type(approval['allowedPublicTemp']) is list and len(set(approval['allowedPublicTemp']))==len(approval['allowedPublicTemp']) and
          (approval['allowedPublicTemp']==[] or (key=='publicCapabilityApproval' and approval['allowedPublicTemp']==list(DATABASES))),
          'BACKUP_PROFILE_APPROVAL_SCOPE')
 runtime=host['connection']['runtime']
 exact(runtime,('nodePath','nodeSha256','pgModulePath','files'),'BACKUP_PROFILE_RUNTIME_SCHEMA')
 require(runtime['nodePath']=='/usr/bin/node' and runtime['pgModulePath'] in runtime['files'] and
         type(runtime['files']) is dict and runtime['files'],'BACKUP_PROFILE_RUNTIME_CLOSURE')
 protected({'path':runtime['nodePath'],'sha256':runtime['nodeSha256']},files,'0755')
 require(existing.get('maintenanceNodeRuntime')=={'path':runtime['nodePath'],'sha256':runtime['nodeSha256']},
         'BACKUP_PROFILE_EXISTING_NODE_DRIFT')
 for path,sha in runtime['files'].items():
  require(path.startswith('/usr/local/lib/workspacex-cn/') and '..' not in path.split('/'), 'BACKUP_PROFILE_PG_PATH')
  protected({'path':path,'sha256':sha},files,'0644')
 for key,mode in (('helper','0700'),):
  ref=host['connection'][key]
  require(ref['path']=='/usr/local/lib/workspacex-cn/backup_connection.cjs' and
          existing['installedFilesSha256'].get(ref['path'])==ref['sha256'],'BACKUP_PROFILE_HELPER_CLOSURE')
  protected(ref,files,mode)
 table=host['queryTable'];raw=protected(table,files,'0700')
 require(existing['installedFilesSha256'].get(table['path'])==table['sha256'] and
         json.loads(raw)==query_table() and host['statements']==mutation_table(p,host['objectScope']),
         'BACKUP_PROFILE_FIXED_OPERATIONS')
 cfg_hash=p['configurationSha256'];config_path=f'/etc/workspacex-cn/maintenance-host/{APP}/{identity["attemptId"]}/approved-baseline-deployment.json'
 cfg=protected({'path':config_path,'sha256':cfg_hash},files,'0600');environment=json.loads(cfg)['environment']
 require(environment['profile']=='production' and environment['ecsInstanceId']==ECS and
         environment['rdsInstanceId']==RDS,'BACKUP_PROFILE_PRODUCTION_CONFIGURATION')
 expected={'allowedCidrs':['192.168.100.40/32'],'configurationSha256':cfg_hash,
           'ecsInstanceId':ECS,'privateAddress':'192.168.100.44','rdsInstanceId':RDS}
 require(existing.get('existingProductionTransport') in (None,expected),'BACKUP_PROFILE_TRANSPORT_DRIFT')
 exact(host['connection']['transport'],DATABASES,'BACKUP_PROFILE_THREE_TRANSPORTS')
 for db,a in host['connection']['transport'].items():
  require(a['identity']==identity and a['toolRevision']==p['toolRevision'] and
          a['configurationPath']==config_path and a['configurationSha256']==cfg_hash and
          a['source']['database']==db and a['source']['user']=='migration_admin' and
          a['source']['sslMode']=='disable' and a['source']['dbInstanceId']==RDS and
          a['approvedRdsTlsException']==environment['rdsTlsException'] and
          a['approvedRdsTlsException']['allowedCidrs']==expected['allowedCidrs'] and
          a['notBefore']<=p['authorization']['notBefore'] and
          a['expiresAt']>=p['authorization']['expiresAt']+120,
          'BACKUP_PROFILE_TRANSPORT_BINDING')
  require(existing['installedFilesSha256'].get('/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs')==a['librarySha256'],
          'BACKUP_PROFILE_TRANSPORT_LIBRARY_PIN')
 migrator='/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs'
 protected({'path':migrator,'sha256':existing['installedFilesSha256'][migrator]},files,'0700')
 require(isinstance(authority,ExistingTransportAuthority),'BACKUP_PROFILE_SOURCE_AUTHORITY_REQUIRED')
 # Canonical verifier must raise on denial; success is a typed evidence object,
 # never a bool or the requested transport/profile echoed back.
 evidence=authority.verify(copy.deepcopy(host),cfg)
 exact(evidence,('kind','identity','configurationSha256','providerEvidenceSha256'),'BACKUP_PROFILE_AUTHORITY_EVIDENCE')
 require(evidence['kind']=='canonical-existing-transport-verified' and evidence['identity']==identity and
         evidence['configurationSha256']==cfg_hash and type(evidence['providerEvidenceSha256']) is str and
         re.fullmatch('[a-f0-9]{64}',evidence['providerEvidenceSha256']) and
         evidence['providerEvidenceSha256']==p['providerBindingSha256'], 'BACKUP_PROFILE_AUTHORITY_EVIDENCE')
 result=copy.deepcopy(existing)
 for key,value in (('backupHostPlan',host_reference),('backupRuntime',runtime),('existingProductionTransport',expected)):
  require(key not in result or result[key]==value,'BACKUP_PROFILE_EXISTING_BINDING_DRIFT')
  result[key]=copy.deepcopy(value)
 return result
