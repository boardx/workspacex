#!/usr/bin/env python3
"""Approved, cloud-only artifact carrier. Never invokes installer or credentials API."""
import ast,datetime as dt,hashlib,importlib.util,json,os,re,shutil,stat,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
POLICIES=Path('/etc/workspacex-cn/complete-runtime-carrier-approvals')
JOURNALS=Path('/var/lib/workspacex-cn/complete-runtime-carrier')
INBOX=Path('/var/lib/workspacex-cn/complete-runtime-inbox')
WORKFLOW='.github/workflows/cn-package-runtime.yml'
FILES=('cn-complete-runtime-carrier.py','install-cn-complete-runtime.py','install-cn-candidate-runtime.py','cn_candidate_github.py','cn_candidate_revalidation.py','cn_image_candidate.py','cn_image_archive.py','hosted-release.py','canonical_control.py')
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}
def need(ok,code):
 if not ok:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encode(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def decode(raw):
 def pairs(items):
  value={}
  for k,v in items:need(k not in value,'DUPLICATE_KEY');value[k]=v
  return value
 return json.loads(raw,object_pairs_hook=pairs)
def instant(value):
 value=dt.datetime.fromisoformat(value.replace('Z','+00:00'));need(value.tzinfo is not None,'TIMEZONE');return value

def bootstrap_from_commit(revision,read_git_blob):
 """Pure exact-Git-byte selection; no checkout, imports, network or writes."""
 need(re.fullmatch('[a-f0-9]{40}',revision),'BOOTSTRAP_REVISION')
 files={}
 for name in FILES:
  raw=read_git_blob(revision,'scripts/'+name);need(type(raw)is bytes and 0<len(raw)<=1048576,'BOOTSTRAP_FILE_LIMIT');ast.parse(raw)
  files[name]={'sha256':sha(raw),'bytes':len(raw),'mode':'0600'}
 return {'kind':'cn-complete-runtime-bootstrap-v1','revision':revision,'files':files,'installationAuthorized':False,'includesRuntimePayload':False}

def validate_policy(raw,pin,now):
 need(sha(raw)==pin,'CARRIER_POLICY_HASH');p=decode(raw)
 fields={'kind','target','producerRevision','eventRevision','controlRevision','sourceRevision','runId','runAttempt','event','headBranch','artifacts','summarySha256','archiveSha256','archiveBytes','issuedAt','expiresAt','githubProvider','bootstrapFiles','storageMarginBytes'}
 need(set(p)==fields and p['kind']=='cn-complete-runtime-carrier-policy-v1'and p['target']==TARGET,'CARRIER_POLICY_SCHEMA')
 for key in ('producerRevision','eventRevision','controlRevision','sourceRevision'):need(type(p[key])is str and re.fullmatch('[a-f0-9]{40}',p[key]),'CARRIER_REVISION')
 for key in ('summarySha256','archiveSha256'):need(type(p[key])is str and re.fullmatch('[a-f0-9]{64}',p[key]),'CARRIER_HASH')
 need(type(p['runId'])is int and p['runId']>0 and type(p['runAttempt'])is int and p['runAttempt']==1,'CARRIER_RUN')
 need(p['event']in ('pull_request','workflow_dispatch')and type(p['headBranch'])is str and 0<len(p['headBranch'])<=128,'CARRIER_TRIGGER')
 start,end=instant(p['issuedAt']),instant(p['expiresAt']);need(start<=now<end and 0<(end-start).total_seconds()<=1800,'CARRIER_WINDOW')
 need(type(p['archiveBytes'])is int and 0<p['archiveBytes']<=2147483648 and type(p['storageMarginBytes'])is int and 0<=p['storageMarginBytes']<=2147483648,'CARRIER_LIMIT')
 host=p['githubProvider'];need(set(host)=={'ghExecutable','ghSha256','authentication','ghConfigDirectory'}and host['authentication']=='existing-root-gh'and host['ghConfigDirectory']=='/root/.config/gh'and Path(host['ghExecutable']).is_absolute()and '..'not in Path(host['ghExecutable']).parts and re.fullmatch('[a-f0-9]{64}',host['ghSha256']),'CARRIER_EXISTING_ROOT_AUTH')
 need(set(p['bootstrapFiles'])==set(FILES)and all(re.fullmatch('[a-f0-9]{64}',v)for v in p['bootstrapFiles'].values()),'CARRIER_BOOTSTRAP_CLOSURE')
 need(set(p['artifacts'])=={'archive','summary'},'CARRIER_ARTIFACT_SET')
 for role,row in p['artifacts'].items():
  need(set(row)=={'id','zipSha256','zipBytes'}and type(row['id'])is int and row['id']>0 and re.fullmatch('[a-f0-9]{64}',row['zipSha256'])and type(row['zipBytes'])is int and 0<row['zipBytes']<=2148532224,'CARRIER_ARTIFACT_PIN')
 need(p['artifacts']['archive']['id']!=p['artifacts']['summary']['id'],'CARRIER_ARTIFACT_DISTINCT');return p

def modules():
 # Caller must have checked the complete protected bootstrap file map first.
 sys.path.insert(0,str(ROOT))
 try:
  import cn_candidate_github as github
 finally:sys.path.pop(0)
 spec=importlib.util.spec_from_file_location('carrier_installer_primitives',ROOT/'install-cn-candidate-runtime.py');old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
 return github,old

def artifact_name(p,role):return('linux-repository-package-'if role=='archive'else'linux-repository-package-summary-')+str(p['runId'])+'-1'
def validate_provider(p,run,record,role):
 need(type(run.get('id'))is int and run.get('id')==p['runId']and type(run.get('run_attempt'))is int and run.get('run_attempt')==1 and run.get('head_sha')==p['producerRevision']and run.get('head_branch')==p['headBranch']and run.get('event')==p['event']and run.get('path')==WORKFLOW and run.get('status')=='completed'and run.get('conclusion')=='success'and run.get('repository',{}).get('full_name')=='boardx/workspacex' and run.get('repository',{}).get('id')==1000328649,'CARRIER_PRODUCER_BINDING')
 row=p['artifacts'][role];binding=record.get('workflow_run',{})
 need(type(record.get('id'))is int and record.get('id')==row['id']and type(record.get('size_in_bytes'))is int and record.get('name')==artifact_name(p,role)and record.get('expired')is False and record.get('digest')=='sha256:'+row['zipSha256']and record.get('size_in_bytes')==row['zipBytes']and binding.get('id')==p['runId']and binding.get('head_sha')==p['producerRevision']and binding.get('repository_id')==1000328649 and binding.get('head_repository_id')==1000328649,'CARRIER_ARTIFACT_BINDING')

def file_hash(path):
 h=hashlib.sha256();size=0
 with Path(path).open('rb')as source:
  while True:
   block=source.read(1048576)
   if not block:break
   size+=len(block);h.update(block)
 return size,h.hexdigest()

def carry(p,pin,github,*,base=JOURNALS,inbox=INBOX,clock=lambda:dt.datetime.now(dt.timezone.utc),extract=None,publish=None):
 """Provider seam reads real metadata/ZIP bytes. No claimed-success callback."""
 if extract is None or publish is None:
  G,old=modules();extract=extract or G.extract;publish=publish or old.no_replace
 need(instant(p['issuedAt'])<=clock()<instant(p['expiresAt']),'CARRIER_WINDOW')
 work=Path(base)/pin;work.mkdir(mode=0o700) # Exclusive durable attempt; never retry.
 def save(name,value):
  fd=os.open(work/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb')as out:out.write(encode(value));out.flush();os.fsync(out.fileno())
  fd=os.open(work,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(fd)
  finally:os.close(fd)
 save('intent.json',{'policySha256':pin,'retryAllowed':False,'installerExecuted':False})
 fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
 need(shutil.disk_usage(work).free>=sum(r['zipBytes']for r in p['artifacts'].values())+p['archiveBytes']+p['storageMarginBytes'],'CARRIER_STORAGE')
 run=github.json(f'/repos/boardx/workspacex/actions/runs/{p["runId"]}/attempts/1');save('provider-run.json',run)
 payload=work/p['archiveSha256'];payload.mkdir(mode=0o700);records={}
 for role,row in p['artifacts'].items():
  endpoint=f'/repos/boardx/workspacex/actions/artifacts/{row["id"]}'
  record=github.json(endpoint);validate_provider(p,run,record,role);records[role]=record;save('provider-'+role+'.json',record)
  archive=work/(role+'.zip')
  with archive.open('xb')as output:
   os.chmod(archive,0o600);count=github.fetch(endpoint+'/zip',output,row['zipBytes']);output.flush();os.fsync(output.fileno())
  need(count==row['zipBytes']and file_hash(archive)==(row['zipBytes'],row['zipSha256']),'CARRIER_ZIP_BYTES')
  filename='runtime.tar.gz'if role=='archive'else'summary.json';limit=p['archiveBytes']if role=='archive'else 1048576
  extract(archive,payload,{filename:limit})
  need(github.json(endpoint)==record,'CARRIER_PROVIDER_CHANGED')
  need(clock()<instant(p['expiresAt']),'CARRIER_WINDOW')
 raw=(payload/'summary.json').read_bytes();need(sha(raw)==p['summarySha256'],'CARRIER_SUMMARY_HASH');summary=decode(raw)
 for key in ('producerRevision','eventRevision','controlRevision','sourceRevision','archiveSha256','archiveBytes'):need(summary.get(key)==p[key],'CARRIER_SUMMARY_IDENTITY')
 need(str(summary.get('runId'))==str(p['runId'])and str(summary.get('runAttempt'))=='1'and summary.get('platform')=='linux-x64'and summary.get('credentialsIncluded')is False,'CARRIER_SUMMARY_SCOPE')
 need(file_hash(payload/'runtime.tar.gz')==(p['archiveBytes'],p['archiveSha256']),'CARRIER_ARCHIVE_BYTES')
 need(github.json(f'/repos/boardx/workspacex/actions/runs/{p["runId"]}/attempts/1')==run,'CARRIER_RUN_CHANGED')
 need(clock()<instant(p['expiresAt']),'CARRIER_WINDOW')
 # No credential-bearing provider records enter the final installer inbox.
 src=os.open(work,os.O_RDONLY|os.O_DIRECTORY);dest=os.open(inbox,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  payload_fd=os.open(payload,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(payload_fd)
  finally:os.close(payload_fd)
  os.fsync(src);publish(dest,src,p['archiveSha256']);os.fsync(dest);os.fsync(src)
 finally:os.close(src);os.close(dest)
 report={'kind':'cn-complete-runtime-carrier-receipt-v1','policySha256':pin,'archiveSha256':p['archiveSha256'],'summarySha256':p['summarySha256'],'inbox':str(Path(inbox)/p['archiveSha256']),'installerExecuted':False,'sudoChanged':False,'retryAllowed':False}
 save('receipt.json',report);return report

def private_read(path):
 for parent in path.parents:
  s=parent.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'CARRIER_PRIVATE_PARENT')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as source:
  before=os.fstat(source.fileno());need(stat.S_ISREG(before.st_mode)and before.st_uid==0 and before.st_nlink==1 and stat.S_IMODE(before.st_mode)in(0o600,0o700)and 0<before.st_size<=1048576,'CARRIER_PRIVATE_FILE')
  raw=source.read(1048577);after=os.fstat(source.fileno());named=path.lstat();sig=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(sig(before)==sig(after)==sig(named),'CARRIER_PRIVATE_CHANGED');return raw

def verify_fixed_host(old):
 parent=old.directory('/var/lib/cloud/data')
 try:identity=old.read(parent,'instance-id',mode=0o644,maximum=128)
 finally:os.close(parent)
 need(identity.decode('ascii').strip()==TARGET['ecsInstanceId'],'CARRIER_HOST_IDENTITY')


def require_existing_home(environment):
 need(environment.get('HOME')=='/root','CARRIER_EXISTING_ROOT_HOME')


def main():
 need(len(sys.argv)==2 and os.geteuid()==os.getegid()==0 and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode and re.fullmatch('[a-f0-9]{64}',sys.argv[1]),'CARRIER_EXPLICIT_ROOT')
 pin=sys.argv[1];p=validate_policy(private_read(POLICIES/(pin+'.json')),pin,dt.datetime.now(dt.timezone.utc))
 for name,h in p['bootstrapFiles'].items():need(sha(private_read(ROOT/name))==h,'CARRIER_BOOTSTRAP_CHANGED')
 G,old=modules()
 verify_fixed_host(old)
 host=p['githubProvider'];G.private_read(host['ghExecutable'],134217728,host['ghSha256'],private=False)
 fd=old.directory('/root/.config/gh');os.close(fd) # Stat trust only, no credential content read.
 for key in ('GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN'):os.environ.pop(key,None)
 require_existing_home(os.environ)
 os.environ.update(GH_CONFIG_DIR='/root/.config/gh',GH_PROMPT_DISABLED='1')
 fd=old.directory(JOURNALS);old.trusted(fd,0o700);os.close(fd);fd=old.directory(INBOX);old.trusted(fd,0o700);os.close(fd)
 provider=G.Github(host['ghExecutable'],time.monotonic()+(instant(p['expiresAt'])-dt.datetime.now(dt.timezone.utc)).total_seconds())
 repository=provider.json('/repos/boardx/workspacex')
 need(repository.get('id')==1000328649 and repository.get('full_name')=='boardx/workspacex','CARRIER_EXISTING_AUTH_UNAVAILABLE')
 report=carry(p,pin,provider)
 print(json.dumps(report,sort_keys=True))
if __name__=='__main__':
 try:main()
 except Exception as error:
  code=str(error)if isinstance(error,ValueError)and re.fullmatch('[A-Z][A-Z0-9_]{1,80}',str(error))else'UNCLASSIFIED_FAILURE'
  print('CN_COMPLETE_RUNTIME_CARRIER_REJECTED:'+code,file=sys.stderr);raise SystemExit(20)
