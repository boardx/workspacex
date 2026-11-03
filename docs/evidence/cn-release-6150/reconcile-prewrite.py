"""Reconcile ONE expired pre-writer refusal; never DDL, container mutation or intent deletion."""
from pathlib import Path
import ast,fcntl,hashlib,importlib.util,json,os,socket,stat,time
ROOT=Path('/var/lib/workspacex-image-release/cn')
ATTEMPT=ROOT/'attempt-176a7907791b408190dc1501e3ba35fc'
TOOLS=ROOT/'reviewed-tools-90e2e1b65'
TAG='41502993193-1'
def need(v,code):
 if not v:raise ValueError(code)
def private(path):
 p=Path(path)
 for q in (*reversed(p.parents),p):
  s=q.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'UNTRUSTED_PATH')
 need(p.is_file() and p.stat().st_nlink==1,'REGULAR_FILE_REQUIRED');return p
def sha(path):return hashlib.sha256(private(path).read_bytes()).hexdigest()
def read(path):return json.loads(private(path).read_bytes())
def load(name):
 p=private(TOOLS/(name+'.py'));s=importlib.util.spec_from_file_location('reconcile_'+name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def main():
 need(os.geteuid()==0 and socket.gethostname()=='workspacex-cn-prod','EXACT_CN_ROOT')
 fd=os.open('/var/lib/workspacex-cn/runtime/release.lock',os.O_RDONLY|os.O_NOFOLLOW)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  locked=os.fstat(fd)
  pending_path=private(ROOT/'pending.json');pending_hash=sha(pending_path);pending=read(pending_path)
  need(pending.get('attempt')==str(ATTEMPT) and pending.get('tag')==TAG and pending.get('route')=='schema-preparation','EXACT_PENDING')
  request=read(ATTEMPT/'schema-request.json');need(sha(ATTEMPT/'schema-request.json')==pending['requestSha256'] and request['tag']==TAG and request['environment']=='cn','EXACT_REQUEST')
  need(request['canonicalLock']=={'path':'/var/lib/workspacex-cn/runtime/release.lock','device':locked.st_dev,'inode':locked.st_ino},'ORIGINAL_LOCK_BINDING')
  old=read('/etc/workspacex-image-release/cn-reviewed-tag-release.json')
  need(type(old['expiresAt']) is int and old['expiresAt']<request['expiresAt']-600 and old['tag']!=TAG,'REFUSED_BEFORE_WRITER')
  cfg=read(ATTEMPT/'schema-config.json');need(sha(ATTEMPT/'schema-config.json')==request['config']['sha256'],'CONFIG_BINDING')
  for role in ('writer','verifier'):
   ref=cfg['schemaRelease'][role];need(sha(ref['path'])==ref['sha256'],'WRAPPER_DRIFT')
  need({'minimal-docker-release.py','schema-tag-prepare-cn.py','schema-tag-prepare.py','cn-reviewed-tag-release.py'}<=set(old['closurePins']),'MISSING_REQUIRED_CLOSURE')
  for name,pin in old['closurePins'].items():
   need(Path(name).name==name and sha(TOOLS/name)==pin,'ORIGINAL_CLOSURE_DRIFT')
  tree=ast.parse(private(TOOLS/'cn-reviewed-tag-release.py').read_text());constants={}
  for node in tree.body:
   if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and isinstance(node.value,ast.Constant):constants[node.targets[0].id]=node.value.value
  need(constants['TAG']==old['tag'] and constants['SOURCE']==old['source'],'FIXED_REFUSAL_BINDING')
  need(not any((ATTEMPT/n).exists() for n in ('policy.json','schema-result.json','cn-once-failure.json','stopped-backup')),'WRITER_EVIDENCE_PRESENT')
  need(not (ROOT/('cn-reviewed-'+TAG+'-once.json')).exists(),'WRITER_RESERVATION_PRESENT')
  need(read(ROOT/'current.json')==pending['previous'],'CURRENT_POINTER_CHANGED')
  previous=pending['previous'];need(sha(previous['path'])==previous['sha256'],'CURRENT_IMAGE_OVERRIDE')
  live_cfg=read('/etc/workspacex-image-release/cn.json');need(live_cfg['project']==cfg['project'] and live_cfg['lockFile']==cfg['lockFile'] and live_cfg['schemaRelease']==cfg['schemaRelease'] and live_cfg['stateDirectory']==str(ROOT),'LIVE_CONFIG_IDENTITY')
  d=load('minimal-docker-release').Docker('/usr/bin/docker');cn=load('schema-tag-prepare-cn');cn.bind_env(load('schema-tag-prepare'));metadata=cn.read_source(d)
  plan=read(ATTEMPT/'schema-plan.json');need(sha(ATTEMPT/'schema-plan.json')==request['schemaPlan']['sha256'],'ORIGINAL_PLAN')
  inventories=plan['baselineInventories']['api'];need(len(inventories)==1,'BASELINE_INVENTORY_SET');baseline=next(iter(inventories.values()))
  need(metadata['ledger']==baseline and len(baseline)==438,'DATABASE_NOT_BASELINE')
  images=read(previous['path'])['services'];actual={}
  for service in cfg['services']:
   rows=d.json(['inspect',cfg['project']+'-'+service+'-1']);need(len(rows)==1,'SERVICE_SET');r=rows[0]
   need(r['State']['Running'] and not r['State'].get('Restarting') and r['Image']==images[service]['image'],'BASELINE_RUNTIME_DRIFT');actual[service]={'containerId':r['Id'],'imageId':r['Image']}
  need(sha(pending_path)==pending_hash and read(ROOT/'current.json')==previous,'FINAL_CAS')
  record={'status':'PRE_WRITER_REFUSAL_RECONCILED','tag':TAG,'attempt':str(ATTEMPT),'pendingSha256':pending_hash,'requestSha256':pending['requestSha256'],'expiredFixedTag':old['tag'],'databaseLedgerCount':438,'databaseLedgerSha256':hashlib.sha256(json.dumps(baseline,sort_keys=True).encode()).hexdigest(),'runtime':actual,'productionDatabaseWriteAttempted':False,'createdAt':time.time()}
  proof=ATTEMPT/'prewrite-reconciliation-6150.json';f=os.open(proof,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(f,'w') as out:json.dump(record,out);out.flush();os.fsync(out.fileno())
  fs=os.open(ATTEMPT,os.O_RDONLY);os.fsync(fs);os.close(fs)
  archive=ROOT/('pending-reconciled-6150-'+ATTEMPT.name+'.json');need(not archive.exists(),'ARCHIVE_EXISTS');os.rename(pending_path,archive)
  fs=os.open(ROOT,os.O_RDONLY);os.fsync(fs);os.close(fs)
  print(json.dumps({'status':record['status'],'proof':str(proof),'pendingArchive':str(archive),'databaseWrites':False}))
 finally:os.close(fd)
if __name__=='__main__':main()
