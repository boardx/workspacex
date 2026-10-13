"""Root-pinned external lifecycle evidence. No cloud writes or credential creation."""
import datetime,hashlib,json,os,re,stat
from pathlib import Path

def cleanup_template(b):
 from isolated_rehearsal import created
 deadline=datetime.datetime.fromtimestamp(created(b)+6900,datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
 return {'FormatVersion':'OOS-2019-06-01','RamRole':b['cleanupRole'],'Tasks':[{'Name':'waitUntilDeadline','Action':'ACS::Sleep','Properties':{'EndDate':deadline}},{'Name':'deleteExactIsolatedClone','Action':'ACS::ExecuteAPI','Properties':{'Service':'RDS','API':'DeleteDBInstance','Parameters':{'RegionId':'cn-shanghai','DBInstanceId':b['targetInstanceId']}}}]}

MODE='external-owner-v1'
READS={'rds':{'DescribeDBInstanceAttribute','DescribeDBInstanceNetInfo','DescribeDBInstanceSSL','DescribeAccounts'},'oos':{'ListExecutions','GetExecutionTemplate'}}
OPERATIONS={'observe','external-lifecycle-readback'}
BINDING=('accountId','regionId','attemptId','candidateSha','targetInstanceId','providerCreatedUtc')

def need(ok,code):
 if not ok:raise ValueError(code)
def mode(b):
 if 'lifecycle' not in b:return False
 x=b['lifecycle'];need(type(x) is dict and set(x)=={'mode','owner','preparedReceipt','targetSecret'} and x['mode']==MODE and x['owner']=='mac-coordinator','EXTERNAL_LIFECYCLE_SCHEMA')
 for k in ('preparedReceipt','targetSecret'):ref(x[k])
 return True
def ref(x):
 need(type(x) is dict and set(x)=={'path','sha256'} and type(x['path']) is str and Path(x['path']).is_absolute() and '..' not in Path(x['path']).parts and type(x['sha256']) is str and re.fullmatch('[a-f0-9]{64}',x['sha256']),'EXTERNAL_REF')
 return x
def read(x):
 ref(x);path=Path(x['path'])
 for parent in path.parents:
  s=parent.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid in (0,os.geteuid()) and (not s.st_mode&0o022 or s.st_mode&stat.S_ISVTX),'EXTERNAL_PRIVATE_PARENT')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and stat.S_IMODE(s.st_mode)==0o600 and s.st_uid==os.geteuid() and s.st_nlink==1 and s.st_size<=1048576,'EXTERNAL_PRIVATE_REF')
  raw=f.read(1048577);after=os.fstat(f.fileno())
  need(len(raw)<=1048576 and (s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(after.st_size,after.st_mtime_ns,after.st_ctime_ns) and hashlib.sha256(raw).hexdigest()==x['sha256'],'EXTERNAL_REF_CHANGED')
 return json.loads(raw)
def request_id(x):need(type(x) is dict and type(x.get('RequestId')) is str and re.fullmatch('[A-Za-z0-9-]{1,128}',x['RequestId']),'EXTERNAL_PROVIDER_REQUEST')
def request_digest(service,action,parameters):return hashlib.sha256(json.dumps({'service':service,'action':action,'parameters':parameters},sort_keys=True,separators=(',',':')).encode()).hexdigest()
def verify_dispatch(record,name,intent,ack,request_sha,binding):
 need(type(record) is dict and set(record)=={'intent','dispatch','ack'} and record['intent']==intent and record['ack']==ack,'EXTERNAL_JOURNAL_REFS')
 value=read(record['dispatch'])
 need(value=={'schemaVersion':1,'kind':'isolated-owner-dispatch-v1','binding':binding,'operation':name,'intentSha256':intent['sha256'],'requestSha256':request_sha,'state':'acknowledged','ackSha256':ack['sha256']},'EXTERNAL_DISPATCH_BINDING')
def accounts_page(page,b,descriptions):
 request_id(page);rows=page.get('Accounts',{}).get('DBInstanceAccount')
 need(type(rows) is list and type(page.get('TotalRecordCount')) is int and page.get('PageNumber')==1 and page['TotalRecordCount']==len(rows) and len(rows)==len(descriptions) and not page.get('NextToken'),'EXTERNAL_ACCOUNT_PAGE')
 seen=set()
 for row in rows:
  name=row.get('AccountName');need(name in descriptions and name not in seen and row.get('DBInstanceId')==b['targetInstanceId'] and row.get('AccountType')==('Super' if name=='migration_admin' else 'Normal') and row.get('AccountStatus')=='Available' and row.get('AccountDescription')==descriptions[name],'EXTERNAL_ACCOUNT_IDENTITY');seen.add(name)
 return rows
def load(b):
 from isolated_rehearsal import ROLE_NAMES,role_intent,role_description,validate_secret
 need(mode(b),'EXTERNAL_MODE_REQUIRED');p=read(b['lifecycle']['preparedReceipt'])
 need(type(p) is dict and set(p)=={'schemaVersion','kind','binding','runnerInstanceId','ownerJournal','observedUtc','emptyAccounts','accounts','accountReadback','oos'} and p['schemaVersion']==1 and p['kind']=='isolated-external-lifecycle-prepared-v1','EXTERNAL_PREPARED_SCHEMA')
 need(p['binding']=={k:b[k] for k in BINDING} and p['runnerInstanceId']==b['runnerLifetime']['instanceId'],'EXTERNAL_PREPARED_BINDING')
 owner=read(p['ownerJournal']);need(type(owner) is dict and set(owner)=={'schemaVersion','kind','binding','owner','emptyAccounts','operations'} and owner['schemaVersion']==1 and owner['kind']=='isolated-owner-journal-projection-v1' and owner['binding']==p['binding'] and owner['owner']=='mac-coordinator' and owner['emptyAccounts']==p['emptyAccounts'] and type(owner['operations']) is dict and set(owner['operations'])=={'oos',*('account:'+n for n in ('migration_admin',*ROLE_NAMES))},'EXTERNAL_OWNER_JOURNAL')
 secret=read(b['lifecycle']['targetSecret']);validate_secret(secret,b)
 stamp=datetime.datetime.fromisoformat(p['observedUtc'].replace('Z','+00:00'));need(stamp.tzinfo is not None and stamp.timestamp()>=datetime.datetime.fromisoformat(b['providerCreatedUtc'].replace('Z','+00:00')).timestamp() and stamp.timestamp()<=datetime.datetime.now(datetime.timezone.utc).timestamp()+30,'EXTERNAL_OBSERVATION_TIME')
 empty=read(p['emptyAccounts']);need(type(empty) is dict and set(empty)=={'parameters','response'} and empty['parameters']=={'RegionId':b['regionId'],'DBInstanceId':b['targetInstanceId'],'PageNumber':1,'PageSize':100},'EXTERNAL_EMPTY_QUERY');accounts_page(empty['response'],b,{})
 need(type(p['accounts']) is dict and set(p['accounts'])=={'migration_admin',*ROLE_NAMES},'EXTERNAL_SEVEN_ACCOUNTS')
 descriptions={}
 for name,item in p['accounts'].items():
  need(type(item) is dict and set(item)=={'intent','ack'},'EXTERNAL_ACCOUNT_RECORD');intent=read(item['intent']);request_id(read(item['ack']))
  if name=='migration_admin':
   need(intent=={'kind':'isolated-admin-account-intent','accountType':'Super','role':name,**p['binding']},'EXTERNAL_ADMIN_INTENT');descriptions[name]='Isolated rehearsal '+b['attemptId']
  else:
   need(intent==role_intent(b,name,intent.get('bootstrapNonce')),'EXTERNAL_ROLE_INTENT');descriptions[name]=role_description(intent)
  account_secret=secret if name=='migration_admin' else secret['roles'][name]
  params={'RegionId':b['regionId'],'DBInstanceId':b['targetInstanceId'],'AccountName':name,'AccountType':'Super' if name=='migration_admin' else 'Normal','AccountDescription':descriptions[name],'AccountPassword':account_secret['password']}
  verify_dispatch(owner['operations']['account:'+name],'account:'+name,item['intent'],item['ack'],request_digest('rds','CreateAccount',params),p['binding'])
 accounts_page(read(p['accountReadback']),b,descriptions)
 o=p['oos'];need(type(o) is dict and set(o)=={'executionId','startIntent','startAck','template','readback','templateReadback'} and type(o['executionId']) is str and re.fullmatch('[A-Za-z0-9-]{1,128}',o['executionId']),'EXTERNAL_OOS_SCHEMA')
 template=read(o['template']);need(template==cleanup_template(b),'EXTERNAL_OOS_TEMPLATE')
 intent=read(o['startIntent']);need(intent=={'kind':'isolated-oos-start-intent','binding':p['binding'],'templateSha256':o['template']['sha256'],'clientToken':'wsx-cleanup-'+b['attemptId']},'EXTERNAL_OOS_INTENT')
 ack=read(o['startAck']);request_id(ack);need(ack.get('Execution',{}).get('ExecutionId')==o['executionId'],'EXTERNAL_OOS_ACK')
 params={'RegionId':b['regionId'],'ClientToken':'wsx-cleanup-'+b['attemptId'],'Mode':'Automatic','TemplateContent':json.dumps(template,separators=(',',':')),'Description':'wsx-isolated-'+b['attemptId']}
 verify_dispatch(owner['operations']['oos'],'oos',o['startIntent'],o['startAck'],request_digest('oos','StartExecution',params),p['binding'])
 verify_oos(read(o['readback']),read(o['templateReadback']),o['executionId'],template,b)
 return p,secret,descriptions,template
def verify_oos(page,detail,identity,template,b):
 request_id(page);request_id(detail);rows=page.get('Executions')
 need(type(rows) is list and len(rows)==1 and not page.get('NextToken'),'EXTERNAL_OOS_PAGE')
 row=rows[0];need(row.get('ExecutionId')==identity and row.get('Description')=='wsx-isolated-'+b['attemptId'] and row.get('Status') in ('Started','Running','Waiting','Queued'),'EXTERNAL_OOS_NOT_REGISTERED')
 need(type(detail.get('Content')) is str and json.loads(detail['Content'])==template,'EXTERNAL_OOS_TEMPLATE')
def observe(b,call):
 """call is a fixed, authenticated read-only RPC closure; no caller passed flags."""
 p,_,descriptions,template=load(b);target={'RegionId':b['regionId'],'DBInstanceId':b['targetInstanceId']}
 attrs=call('rds','DescribeDBInstanceAttribute',target);request_id(attrs);rows=attrs.get('Items',{}).get('DBInstanceAttribute',[])
 need(len(rows)==1 and rows[0].get('DBInstanceId')==b['targetInstanceId'] and rows[0].get('CreationTime')==b['providerCreatedUtc'] and rows[0].get('DBInstanceDescription')==b['providerDescription'],'EXTERNAL_LIVE_TARGET')
 accounts=call('rds','DescribeAccounts',dict(target,PageNumber=1,PageSize=100));accounts_page(accounts,b,descriptions)
 identity=p['oos']['executionId']
 page=call('oos','ListExecutions',{'RegionId':b['regionId'],'ExecutionId':identity,'MaxResults':10})
 detail=call('oos','GetExecutionTemplate',{'RegionId':b['regionId'],'ExecutionId':identity});verify_oos(page,detail,identity,template,b)
 return {'kind':'isolated-external-lifecycle-readback-v1','binding':p['binding'],'executionId':identity,'preparedReceiptSha256':b['lifecycle']['preparedReceipt']['sha256'],'providerRequestIds':[attrs['RequestId'],accounts['RequestId'],page['RequestId'],detail['RequestId']]}
def verify_result(result,b,p):
 need(type(result) is dict and set(result)=={'kind','binding','executionId','preparedReceiptSha256','providerRequestIds'} and result['kind']=='isolated-external-lifecycle-readback-v1' and result['binding']==p['binding'] and result['executionId']==p['oos']['executionId'] and result['preparedReceiptSha256']==b['lifecycle']['preparedReceipt']['sha256'],'EXTERNAL_LIVE_RECEIPT')
 need(type(result['providerRequestIds']) is list and len(result['providerRequestIds'])==4,'EXTERNAL_LIVE_REQUESTS')
 for rid in result['providerRequestIds']:request_id({'RequestId':rid})
