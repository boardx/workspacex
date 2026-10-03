import copy,hashlib,json,unittest
from cn_backup_profile import bind_backup_profile,ExistingTransportAuthority
from cn_backup_channel import query_table,mutation_table
from test_cn_backup_package import fixture
from cn_backup_package import APP,ECS,RDS
from writer_fence import DATABASES

class FixtureAuthority(ExistingTransportAuthority):
 def verify(self,h,cfg):
  return dict(kind='canonical-existing-transport-verified',identity=h['identity'],
              configurationSha256=h['backup']['configurationSha256'],providerEvidenceSha256='9'*64)

def inputs():
 p,objects=fixture();p['providerBindingSha256']='9'*64;files={}
 def file(path,value,mode):
  raw=value if type(value)is bytes else json.dumps(value,sort_keys=True).encode()
  sha=hashlib.sha256(raw).hexdigest()
  files[path]=dict(bytes=raw,uid=0,gid=0,mode=mode,links=1,regular=True,symlink=False,parentsProtected=True)
  return dict(path=path,sha256=sha)
 node=file('/usr/bin/node',b'fixture node','0755')
 pg=file('/usr/local/lib/workspacex-cn/node_modules/pg/index.js',b'fixture pg','0644')
 helper=file('/usr/local/lib/workspacex-cn/backup_connection.cjs',b'fixture helper','0700')
 table=file('/usr/local/lib/workspacex-cn/backup-queries.json',query_table(),'0700')
 exception={'allowedCidrs':['192.168.100.40/32']}
 cfg=file(f'/etc/workspacex-cn/maintenance-host/{APP}/{p["identity"]["attemptId"]}/approved-baseline-deployment.json',
          {'environment':{'profile':'production','ecsInstanceId':ECS,'rdsInstanceId':RDS,'rdsTlsException':exception}},'0600')
 p['configurationSha256']=cfg['sha256']
 runtime=dict(nodePath=node['path'],nodeSha256=node['sha256'],pgModulePath=pg['path'],files={pg['path']:pg['sha256']})
 migrator=file('/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs',b'fixture compiled canonical verifier','0700')
 approvals={}
 for key,hashkey,name in (('roleApproval','roleApprovalSha256','role'),('publicCapabilityApproval','publicCapabilityApprovalSha256','public-capability')):
  approval={k:p['authorization'][k] for k in ('action','identity','notBefore','expiresAt','rdsInstanceId','ecsInstanceId')}
  approval.update(schemaVersion=1,role='wsx_release_backup_ro',functions=p['functionBodies'],allowedPublicTemp=[])
  approvals[key]=file(f'/etc/workspacex-cn/backup-approvals/{p["identity"]["attemptId"]}/{name}.json',approval,'0600')
  p['authorization'][hashkey]=approvals[key]['sha256']
 transports={db:dict(identity=p['identity'],toolRevision=p['toolRevision'],configurationPath=cfg['path'],
  configurationSha256=cfg['sha256'],source=dict(database=db,user='migration_admin',sslMode='disable',dbInstanceId=RDS),
  approvedRdsTlsException=exception,notBefore=p['authorization']['notBefore']-1,
  expiresAt=p['authorization']['expiresAt']+120,librarySha256=migrator['sha256']) for db in DATABASES}
 host=dict(**approvals,identity=p['identity'],backup=p,objectScope=objects,queryTable=table,
           statements=mutation_table(p,objects),connection=dict(runtime=runtime,helper=helper,transport=transports))
 ref=file(f'/etc/workspacex-cn/maintenance-backup/{APP}/{p["identity"]["attemptId"]}/host-plan.json',host,'0600')
 profile=dict(toolRevision=p['toolRevision'],maintenanceNodeRuntime=node,
  installedFilesSha256={helper['path']:helper['sha256'],table['path']:table['sha256'],
                      migrator['path']:migrator['sha256']})
 return profile,ref,files

class Tests(unittest.TestCase):
 def test_compile_preserves_profile_without_writes(self):
  profile,ref,files=inputs();before=copy.deepcopy(profile)
  bound=bind_backup_profile(profile,ref,files,FixtureAuthority())
  self.assertEqual(profile,before);self.assertEqual(bound['backupHostPlan'],ref)
  self.assertEqual(bound['existingProductionTransport']['privateAddress'],'192.168.100.44')
 def test_absent_real_authority_or_json_flag_or_echo_denied(self):
  for authority in (None,True,{'verified':True},ExistingTransportAuthority()):
   profile,ref,files=inputs()
   with self.assertRaises(RuntimeError):bind_backup_profile(profile,ref,files,authority)
  class Echo(FixtureAuthority):
   def verify(self,host,cfg):return host
  profile,ref,files=inputs()
  with self.assertRaises(RuntimeError):bind_backup_profile(profile,ref,files,Echo())
 def test_root_mode_hash_runtime_and_existing_transport_drift(self):
  for variant in ('mode','hash','uid','parent','runtime','transport'):
   profile,ref,files=inputs()
   if variant=='mode':files[ref['path']]['mode']='0644'
   if variant=='hash':files[ref['path']]['bytes']+=b' '
   if variant=='uid':files['/usr/bin/node']['uid']=1
   if variant=='parent':files['/usr/bin/node']['parentsProtected']=False
   if variant=='runtime':profile['maintenanceNodeRuntime']['sha256']='0'*64
   if variant=='transport':profile['existingProductionTransport']={'allowedCidrs':['0.0.0.0/0']}
   with self.assertRaises(RuntimeError):bind_backup_profile(profile,ref,files,FixtureAuthority())

if __name__=='__main__':unittest.main()
