#!/usr/bin/env python3
"""Reviewed root adapter: Aliyun metadata/RPC and hash-bound isolated stage processes.
No clone purchase operation. Never read production database credentials.
"""
import signal
import base64,datetime,hashlib,hmac,json,os,re,subprocess,sys,urllib.parse,urllib.request,urllib.error,uuid
from pathlib import Path
from isolated_rehearsal import validate_binding,created,private_json,UnknownOutcome,ProcessAdapter,SAFE_PROVIDER_CODES

class ProviderError(ValueError):
 def __init__(self,code):self.code=code;super().__init__('PROVIDER_REJECTED')
def cleanup_template(b):
 deadline=datetime.datetime.fromtimestamp(created(b)+6900,datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
 return {'FormatVersion':'OOS-2019-06-01','RamRole':b['cleanupRole'],'Tasks':[{'Name':'waitUntilDeadline','Action':'ACS::Sleep','Properties':{'EndDate':deadline}},{'Name':'deleteExactIsolatedClone','Action':'ACS::ExecuteAPI','Properties':{'Service':'RDS','API':'DeleteDBInstance','Parameters':{'RegionId':'cn-shanghai','DBInstanceId':b['targetInstanceId']}}}]}
def enc(v):return urllib.parse.quote(str(v),safe='~')
def credential(role):
 op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 r=urllib.request.Request('http://100.100.100.200/latest/api/token',method='PUT',headers={'X-aliyun-ecs-metadata-token-ttl-seconds':'300'})
 with op.open(r,timeout=5) as response:token=response.read().decode()
 r=urllib.request.Request('http://100.100.100.200/latest/meta-data/ram/security-credentials/'+role,headers={'X-aliyun-ecs-metadata-token':token})
 with op.open(r,timeout=5) as response:c=json.load(response)
 if c.get('Code')!='Success' or any(not c.get(k) for k in ('AccessKeyId','AccessKeySecret','SecurityToken')):raise ValueError('IMDS_INVALID')
 return c

def rpc(service,action,params,c):
 versions={'rds':'2014-08-15','oos':'2019-06-01','ram':'2015-05-01'}
 allowed={'rds':{'DescribeDBInstanceAttribute','DescribeDBInstanceNetInfo','DescribeDBInstanceSSL','CreateAccount','DescribeAccounts','DeleteDBInstance'},'oos':{'StartExecution','ListExecutions','CancelExecution','GetExecutionTemplate'},'ram':{'GetRole','GetPolicy','GetPolicyVersion','ListPoliciesForRole','ListEntitiesForPolicy','DetachPolicyFromRole','DeletePolicy','DeleteRole'}}
 if action not in allowed[service]:raise ValueError('RPC_ACTION')
 q=dict(params,Action=action,Version=versions[service],Format='JSON',AccessKeyId=c['AccessKeyId'],SecurityToken=c['SecurityToken'],SignatureMethod='HMAC-SHA1',SignatureVersion='1.0',SignatureNonce=str(uuid.uuid4()),Timestamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
 canonical='&'.join(enc(k)+'='+enc(v) for k,v in sorted(q.items()))
 sign=base64.b64encode(hmac.new((c['AccessKeySecret']+'&').encode(),('POST&%2F&'+enc(canonical)).encode(),hashlib.sha1).digest()).decode()
 endpoint='https://ram.aliyuncs.com/' if service=='ram' else 'https://'+service+'.cn-shanghai.aliyuncs.com/'
 r=urllib.request.Request(endpoint,data=(canonical+'&Signature='+enc(sign)).encode(),headers={'Content-Type':'application/x-www-form-urlencoded'},method='POST')
 try:
  with urllib.request.urlopen(r,timeout=30) as response:z=json.load(response)
 except urllib.error.HTTPError as error:
  try:z=json.loads(error.read(65536))
  except ValueError:raise ValueError('PROVIDER_REJECTED') from None
 if z.get('Code'):raise ProviderError(z['Code'])
 return z

def policy_document(raw):
 try:return json.loads(raw)
 except json.JSONDecodeError:return json.loads(urllib.parse.unquote(raw))
def iam_binding(b,c,remove=False):
 spec=b['cleanupIam'];role=spec['role'];policy=spec['policy'];attempt=b['attemptId'].replace('-','')[:16]
 if role!=b['cleanupRole'] or not role.startswith('WSXCNIsolatedCleanup') or attempt not in role or not policy.startswith('WSXCNIsolated') or attempt not in policy:raise ValueError('IAM_NAME_BINDING')
 get=lambda action,params:rpc('ram',action,params,c)
 roledata=get('GetRole',{'RoleName':role})['Role'];policydata=get('GetPolicy',{'PolicyName':policy,'PolicyType':'Custom'})['Policy']
 if not roledata['Arn'].startswith('acs:ram::'+b['accountId']+':role/'):raise ValueError('IAM_ACCOUNT_BINDING')
 trust=policy_document(roledata['AssumeRolePolicyDocument']);document=policy_document(get('GetPolicyVersion',{'PolicyName':policy,'PolicyType':'Custom','VersionId':policydata['DefaultVersion']})['PolicyVersion']['PolicyDocument'])
 expected_trust={'Version':'1','Statement':[{'Effect':'Allow','Action':'sts:AssumeRole','Principal':{'Service':['oos.aliyuncs.com']}}]}
 if trust!=expected_trust:raise ValueError('IAM_OOS_TRUST_SCOPE')
 digest=lambda x:hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 if digest(trust)!=spec['roleTrustCanonicalSha256'] or digest(document)!=spec['policyCanonicalSha256']:raise ValueError('IAM_DOCUMENT_HASH')
 statements=document.get('Statement',[])
 if not statements or any(s.get('Effect')!='Allow' or s.get('Resource')!=['acs:rds:cn-shanghai:'+b['accountId']+':dbinstance/'+b['targetInstanceId']] or s.get('Action')!=['rds:DeleteDBInstance'] for s in statements):raise ValueError('IAM_EXACT_DELETE_SCOPE')
 attached=get('ListPoliciesForRole',{'RoleName':role});entities=get('ListEntitiesForPolicy',{'PolicyName':policy,'PolicyType':'Custom'})
 if attached.get('IsTruncated') or entities.get('IsTruncated'):raise ValueError('IAM_INCOMPLETE_PAGE')
 policies=attached.get('Policies',{}).get('Policy',[])
 roles=entities.get('Roles',{}).get('Role',[])
 if len(policies)!=1 or policies[0]['PolicyName']!=policy or policies[0]['PolicyType']!='Custom' or len(roles)!=1 or roles[0]['RoleName']!=role or entities.get('Users',{}).get('User') or entities.get('Groups',{}).get('Group'):raise ValueError('IAM_NOT_EXCLUSIVELY_OWNED')
 if remove:
  get('DetachPolicyFromRole',{'PolicyName':policy,'PolicyType':'Custom','RoleName':role})
  # Additional versions or attachments are genuine failures, not silently removed.
  get('DeletePolicy',{'PolicyName':policy})
  get('DeleteRole',{'RoleName':role})
 return {'exactIamBinding':True}
def run(operation,p):
 b=p['binding'];validate_binding(b);target=b['targetInstanceId'];c=credential(b['ecsRole'])
 def rds(action,extra=None):return rpc('rds',action,dict(DBInstanceId=target,RegionId='cn-shanghai',**(extra or {})),c)
 if operation=='observe':
  attrs=rds('DescribeDBInstanceAttribute')['Items']['DBInstanceAttribute'];net=rds('DescribeDBInstanceNetInfo')['DBInstanceNetInfos']['DBInstanceNetInfo']
  if len(attrs)!=1 or attrs[0]['DBInstanceId']!=target or attrs[0]['CreationTime']!=b['providerCreatedUtc'] or attrs[0].get('DBInstanceDescription')!=b['providerDescription']:raise ValueError('PROVIDER_ID_TIME')
  endpoints=[x for x in net if x.get('ConnectionString')==b['host'] and str(x.get('Port'))=='5432']
  if len(endpoints)!=1 or endpoints[0].get('IPAddress')!=b['peer']:raise ValueError('PROVIDER_PEER')
  ssl=rds('DescribeDBInstanceSSL')
  if b['tls']['sslmode']=='disable' and ssl.get('SSLEnabled') not in ('No','Disabled','off'):raise ValueError('TLS_EXCEPTION_NOT_ACTUAL')
  return dict(targetInstanceId=attrs[0]['DBInstanceId'],peer=endpoints[0]['IPAddress'],providerCreatedUtc=attrs[0]['CreationTime'],providerDescription=attrs[0]['DBInstanceDescription'],accountId=b['accountId'],regionId=b['regionId'],observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),host=endpoints[0]['ConnectionString'],port=int(endpoints[0]['Port']),attemptId=b['attemptId'],peerSha256=hashlib.sha256(endpoints[0]['IPAddress'].encode()).hexdigest(),providerVerified=True,engine=attrs[0].get('Engine'),engineVersion=attrs[0].get('EngineVersion'))
 if operation=='account-create':
  s=p['secret']
  if s.get('user')!='migration_admin' or s.get('port')!=5432 or any(s.get(k)!=b[k] for k in ('targetInstanceId','attemptId','host','peer','tls')) or not re.fullmatch(r'Aa1![A-Za-z0-9_-]{28}',s.get('password','')):raise ValueError('ACCOUNT_SECRET_BINDING')
  if rds('DescribeAccounts').get('Accounts',{}).get('DBInstanceAccount'):raise ValueError('ACCOUNT_NOT_EMPTY')
  s=p['secret'];rds('CreateAccount',{'AccountName':s['user'],'AccountPassword':s['password'],'AccountType':'Super','AccountDescription':'Isolated rehearsal '+b['attemptId']})
  return {'submitted':True,'targetInstanceId':target}
 if operation=='account-readback':
  rows=rds('DescribeAccounts').get('Accounts',{}).get('DBInstanceAccount',[]);matches=[x for x in rows if x.get('AccountName')==p['secret']['user'] and x.get('AccountType')=='Super' and x.get('AccountStatus')=='Available']
  return {'exists':len(matches)==1,'user':p['secret']['user'],'targetInstanceId':target}
 if operation=='cleanup-register':
  # Role/policy must be independently installed and reviewed before this entry.
  iam_binding(b,c)
  template=cleanup_template(b)
  x=rpc('oos','StartExecution',{'RegionId':'cn-shanghai','ClientToken':'wsx-cleanup-'+b['attemptId'],'Mode':'Automatic','TemplateContent':json.dumps(template,separators=(',',':')),'Description':'wsx-isolated-'+b['attemptId']},c)
  return {'executionId':x['Execution']['ExecutionId'],'targetInstanceId':target}
 if operation in ('cleanup-readback','cleanup-registration-remove'):
  rows=[];token=None;seen=set()
  for _ in range(100):
   params={'RegionId':'cn-shanghai','Description':'wsx-isolated-'+b['attemptId'],'MaxResults':100}
   if token:params['NextToken']=token
   page=rpc('oos','ListExecutions',params,c)
   rows.extend(e for e in page.get('Executions',[]) if e.get('Description')=='wsx-isolated-'+b['attemptId'])
   token=page.get('NextToken')
   if not token:break
   if token in seen:raise ValueError('OOS_PAGINATION_LOOP')
   seen.add(token)
  else:raise ValueError('OOS_PAGINATION_INCOMPLETE')
  if not rows:return {'registered':False,'terminal':True,'absent':True}
  if len(rows)!=1:raise ValueError('OOS_EXECUTION_NOT_UNIQUE')
  e=rows[0]
  observed=rpc('oos','GetExecutionTemplate',{'RegionId':'cn-shanghai','ExecutionId':e['ExecutionId']},c)
  if json.loads(observed['Content'])!=cleanup_template(b):raise ValueError('EXACT_OOS_TEMPLATE_READBACK_REQUIRED')
  expected={'executionId':e['ExecutionId'],'targetInstanceId':target,'attemptId':b['attemptId'],'deleteBeginEpoch':created(b)+6900,'providerTemplateVerified':True}
  if operation=='cleanup-registration-remove':
   if e.get('Status') in ('Cancelled','Success','Failed'):return dict(expected,terminal=True,cancelSubmitted=False)
   rpc('oos','CancelExecution',{'RegionId':'cn-shanghai','ExecutionId':e['ExecutionId']},c);return dict(expected,cancelSubmitted=True)
  return dict(expected,registered=e.get('Status') in ('Started','Running','Waiting','Queued'),terminal=e.get('Status') in ('Cancelled','Success','Failed'))
 if operation=='cleanup-iam-remove':
  iam_binding(b,c,remove=True);return {'removedSubmitted':True,'targetInstanceId':target}
 if operation=='cleanup-registration-readback-removed':
  result=run('cleanup-readback',p)
  # Cancellation readback must use a terminal OOS status, not the registration flag alone.
  spec=b['cleanupIam'];missing=[]
  for action,key,name,code in [('GetRole','RoleName',spec['role'],'EntityNotExist.Role'),('GetPolicy','PolicyName',spec['policy'],'EntityNotExist.Policy')]:
   params={key:name}
   if action=='GetPolicy':params['PolicyType']='Custom'
   try:rpc('ram',action,params,c)
   except ProviderError as error:
    if error.code!=code:raise
    missing.append(action)
  return {'removed':len(missing)==2 and result.get('terminal') is True,'targetInstanceId':target,'attemptId':b['attemptId']}
 if operation=='cleanup':
  try:
   attrs=rds('DescribeDBInstanceAttribute')['Items']['DBInstanceAttribute']
   if len(attrs)!=1 or attrs[0]['DBInstanceId']!=target or attrs[0]['CreationTime']!=b['providerCreatedUtc'] or attrs[0].get('DBInstanceDescription')!=b['providerDescription']:raise ValueError('DELETE_ACTUAL_OWNERSHIP_FAILED')
   rds('DeleteDBInstance')
  except ProviderError as error:
   if error.code not in ('InvalidDBInstanceId.NotFound','InvalidDBInstanceName.NotFound'):raise
  return {'deleteSubmitted':True,'targetInstanceId':target}
 if operation=='cleanup-readback-deleted':
  try:rds('DescribeDBInstanceAttribute')
  except ProviderError as error:
   if error.code in ('InvalidDBInstanceId.NotFound','InvalidDBInstanceName.NotFound'):return {'notFound':True,'targetInstanceId':target}
   raise
  return {'notFound':False,'targetInstanceId':target}
 stage=b.get('stages',{}).get(operation)
 if not stage:raise ValueError('REVIEWED_STAGE_NOT_CONFIGURED')
 path=Path(stage['path'])
 if hashlib.sha256(path.read_bytes()).hexdigest()!=stage['sha256']:raise ValueError('STAGE_HASH')
 return ProcessAdapter(path,stage['sha256'],stage['timeoutSeconds'],stage.get('modules',{}))(None,dict(p,operation=operation))
def terminated(_signum,_frame):raise RuntimeError('TERMINATED')
if __name__=='__main__':
 signal.signal(signal.SIGTERM,terminated)
 try:
  if os.geteuid()!=0 or len(sys.argv)!=2:raise ValueError('ROOT_OPERATION')
  print(json.dumps(run(sys.argv[1],json.load(sys.stdin))))
 except ProviderError as error:
  if isinstance(error.code,str) and error.code in SAFE_PROVIDER_CODES:print(json.dumps({'providerErrorCode':error.code}))
  print('ISOLATED_ADAPTER_FAILED',file=sys.stderr);sys.exit(1)
 except UnknownOutcome as error:
  marker=str(error);code=marker.removeprefix('PROVIDER_REJECTED:')
  if marker.startswith('PROVIDER_REJECTED:') and code in SAFE_PROVIDER_CODES:print(json.dumps({'providerErrorCode':code}))
  print('ISOLATED_ADAPTER_FAILED',file=sys.stderr);sys.exit(1)
 except BaseException:print('ISOLATED_ADAPTER_FAILED',file=sys.stderr);sys.exit(1)
