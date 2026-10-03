#!/usr/bin/env python3
"""Post-DDL readonly Cloud Assistant producer/consumer; never synthesize provider output."""
import os,sys,json,stat,re,hashlib,subprocess,time,base64,pathlib
ROOT='/usr/local/lib/workspacex-cn'
def require(value,code):
 if not value:raise RuntimeError(code)
def protected(path,mode,limit=3*1024*1024):
 p=pathlib.Path(path);require(p.is_absolute() and '..' not in p.parts,'PATH_INVALID')
 for parent in p.parents:
  st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and st.st_gid==0 and not st.st_mode&0o022,'PARENT_TRUST')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  before=os.fstat(f.fileno());require(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_gid==0 and before.st_nlink==1 and stat.S_IMODE(before.st_mode)==mode,'FILE_TRUST')
  raw=f.read(limit+1);after=os.fstat(f.fileno());named=p.lstat()
  require(len(raw)<=limit and (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns) and (before.st_dev,before.st_ino)==(named.st_dev,named.st_ino),'FILE_CHANGED')
  return raw
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def validate_plan(plan,source,attempt,plan_hash):
 required={'schemaVersion','identity','toolRevision','readonlyCollectionAuthorized','ecsInstanceId','regionId','accountId','aliyunProfile','aliyunBinarySha256','credentialsSha256','queryArtifactSha256','nodeBinarySha256','querySha256'}
 require(type(plan)is dict and set(plan)==required and plan['schemaVersion']==1 and plan['readonlyCollectionAuthorized']is True,'READONLY_COLLECTION_NOT_AUTHORIZED')
 require(plan['identity']['sourceRevision']==source and plan['identity']['attemptId']==attempt and plan['identity']['migrationPlanSha256']==plan_hash and plan['ecsInstanceId']=='i-uf6ga92ewloganobbln6' and plan['regionId']=='cn-shanghai' and plan['accountId']=='1177216024653153','COLLECTOR_IDENTITY')
 require(re.fullmatch('[A-Za-z0-9_-]{1,64}',plan['aliyunProfile'])is not None,'CLI_PROFILE')
 for key in ('aliyunBinarySha256','credentialsSha256','queryArtifactSha256','nodeBinarySha256','querySha256'):require(re.fullmatch('[a-f0-9]{64}',plan[key])is not None,'HASH_BINDING')
def collect(plan,cli,now=time.monotonic,pause=time.sleep):
 # This exact installed query performs only a bounded readonly transaction.
 content='/usr/local/lib/workspacex-cn/cn-migration-snapshot-query.cjs --readonly-ledger '+plan['identity']['sourceRevision']+' '+plan['identity']['attemptId']
 script='/usr/bin/node '+content+'\n'
 require(sha(script.encode())==plan['querySha256'],'QUERY_COMMAND_HASH')
 account=cli(['sts','GetCallerIdentity']);require(account.get('AccountId')==plan['accountId'],'CREDENTIAL_ACCOUNT_MISMATCH')
 response=cli(['ecs','RunCommand','--RegionId',plan['regionId'],'--Type','RunShellScript','--Content',base64.b64encode(script.encode()).decode(),'--InstanceId.1',plan['ecsInstanceId'],'--Timeout','120','--WorkingDir',ROOT,'--Username','root','--Name','wsx-readonly-ledger-'+plan['identity']['attemptId']])
 require(type(response.get('InvokeId'))is str and type(response.get('CommandId'))is str,'PROVIDER_START_RESPONSE')
 invocation=response['InvokeId'];command=response['CommandId'];deadline=now()+180
 while True:
  raw=cli(['ecs','DescribeInvocationResults','--RegionId',plan['regionId'],'--InvokeId',invocation,'--InstanceId',plan['ecsInstanceId']],raw=True)
  value=json.loads(raw);require(not value.get('NextToken'),'PROVIDER_PARTIAL')
  outer=value.get('Invocation',{});items=outer.get('InvocationResults',{}).get('InvocationResult',[])
  require(not outer.get('NextToken') and type(items)is list and len(items)<=1,'PROVIDER_PARTIAL')
  if items:
   result=items[0];require(result.get('InvokeId')==invocation and result.get('CommandId')==command and result.get('InstanceId')==plan['ecsInstanceId'],'PROVIDER_IDENTITY')
   status=result.get('InvocationStatus')
   if status=='Success':
    require(outer.get('TotalCount')==1 and result.get('ExitCode')==0 and result.get('Dropped')==0,'PROVIDER_INCOMPLETE')
    return raw,{'ecsInstanceId':plan['ecsInstanceId'],'invokeId':invocation,'commandId':command,'querySha256':plan['querySha256']}
   require(status in ('Pending','Running','Stopping','Scheduled','Timeout','Failed','Cancelled'),'PROVIDER_STATUS')
   if status in ('Timeout','Failed','Cancelled'):raise RuntimeError('PROVIDER_QUERY_FAILED')
  require(now()<deadline,'PROVIDER_QUERY_DEADLINE');pause(2)
def main(args):
 require(os.geteuid()==0 and os.getegid()==0 and sys.platform=='linux','ROOT_LINUX_REQUIRED')
 require(len(args)==4 and args[0] in ('--maintenance-completion','--preflight-completion') and re.fullmatch('[a-f0-9]{40}',args[1])and re.fullmatch('[A-Za-z0-9-]{1,128}',args[2])and re.fullmatch('[a-f0-9]{64}',args[3]),'USAGE')
 source,attempt,plan_hash=args[1:];directory='/etc/workspacex-cn/maintenance-migration/'+source+'/'+attempt
 plan=json.loads(protected(directory+'/collector.json',0o600));validate_plan(plan,source,attempt,plan_hash)
 profile=json.loads(protected('/etc/workspacex-cn/trusted-tool-binding.json',0o600))
 require(profile['toolRevision']==plan['toolRevision'],'TOOL_REVISION')
 require(profile['filesSha256']['.harness/scripts/vm/collect-cn-migration-snapshot.py']==sha(protected(ROOT+'/collect-cn-migration-snapshot.py',0o700)),'COLLECTOR_SOURCE')
 require(sha(protected('/usr/local/bin/aliyun',0o755,256*1024*1024))==plan['aliyunBinarySha256'] and sha(protected('/root/.aliyun/config.json',0o600))==plan['credentialsSha256'],'CLI_IDENTITY')
 require(sha(protected('/usr/bin/node',0o755,256*1024*1024))==plan['nodeBinarySha256'] and sha(protected(ROOT+'/cn-migration-snapshot-query.cjs',0o700))==plan['queryArtifactSha256'],'QUERY_CLOSURE')
 query=json.loads(protected(directory+'/query.json',0o600));require(query.get('readonlyCollectionAuthorized')is True and query.get('toolRevision')==plan['toolRevision'] and query.get('identity')==plan['identity'] and query.get('querySha256')==plan['querySha256'],'QUERY_INPUT_BINDING')
 require(sha(protected(directory+'/diagnostic-config.json',0o600))==query.get('configSha256'),'DIAGNOSTIC_CONFIG_HASH')
 binary='/usr/local/bin/aliyun';verified=os.open(binary,os.O_RDONLY|os.O_NOFOLLOW)
 st=os.fstat(verified);require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_gid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o755,'CLI_FD_TRUST')
 with os.fdopen(os.dup(verified),'rb') as stream:require(sha(stream.read(256*1024*1024+1))==plan['aliyunBinarySha256'],'CLI_FD_HASH')
 def cli(arguments,raw=False):
  value=subprocess.run(['/proc/self/fd/'+str(verified),'--profile',plan['aliyunProfile'],*arguments],pass_fds=(verified,),stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30,env={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8'})
  require(value.returncode==0 and len(value.stdout)<=2*1024*1024,'CLI_RESPONSE')
  return value.stdout if raw else json.loads(value.stdout)
 if args[0]=='--preflight-completion':
  require(cli(['sts','GetCallerIdentity']).get('AccountId')==plan['accountId'],'CREDENTIAL_ACCOUNT_MISMATCH')
  print(json.dumps({'schemaVersion':1,'kind':'migration-collector-preflight','identity':plan['identity'],'toolRevision':plan['toolRevision'],'querySha256':plan['querySha256'],'ready':False}));return
 response,cloud=collect(plan,cli)
 # Full original provider bytes are preserved; Node verifier validates all fields
 # and constructs private completion only from this response and intended inputs.
 output={'schemaVersion':1,'providerResponseBase64':base64.b64encode(response).decode(),'providerResponseSha256':sha(response),'cloud':cloud}
 print(json.dumps(output,sort_keys=True))
if __name__=='__main__':
 try:main(sys.argv[1:])
 except BaseException:print('CN_MIGRATION_COLLECTION_REJECTED',file=sys.stderr);sys.exit(1)
