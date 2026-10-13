"""One-shot publication metadata directory exchange proposal; no publisher call.
Production scheduling requires reviewed, independently bound config SHA and tree inventory.
"""
import base64,ctypes,datetime as dt,fcntl,hashlib,json,os,re,shutil,stat,sys
from pathlib import Path
SIX={'approval.json','candidate-plan.json','publication-intent.json','immutable-provider-response.json','candidate-revalidation.json','candidate-revalidation-policy.json'}
ROOT=Path('/etc/workspacex-cn/candidate-publish')
LOCK=Path('/var/lib/workspacex-cn/runtime/release.lock')

def need(v,c):
 if not v:raise ValueError(c)
def sha(v):return hashlib.sha256(v).hexdigest()
def identity(s):return s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns

def read(path,owner,limit=256*1024*1024):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==owner and s.st_nlink==1 and not s.st_mode&0o022 and s.st_size<=limit,'FILE_TRUST')
  chunks=[]
  while True:
   raw=os.read(fd,1024*1024)
   if not raw:break
   chunks.append(raw)
  need(identity(s)==identity(os.fstat(fd))==identity(path.lstat()),'FILE_CHANGED');return b''.join(chunks),stat.S_IMODE(s.st_mode)
 finally:os.close(fd)
def inventory(root,owner):
 result={}
 for path in [root,*root.rglob('*')]:
  s=path.lstat();need(s.st_uid==owner and not s.st_mode&0o022 and not stat.S_ISLNK(s.st_mode),'TREE_TRUST')
  if stat.S_ISDIR(s.st_mode):continue
  raw,mode=read(path,owner);result[str(path.relative_to(root))]={'sha256':sha(raw),'bytes':len(raw),'mode':mode}
 return result
def put(path,raw,mode=0o600):
 with path.open('xb')as f:os.chmod(path,mode);f.write(raw);f.flush();os.fsync(f.fileno())
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def exchange(a,b):
 need(sys.platform=='linux','LINUX_RENAME_EXCHANGE_REQUIRED')
 libc=ctypes.CDLL(None,use_errno=True);fn=libc.renameat2;fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];fn.restype=ctypes.c_int
 if fn(-100,os.fsencode(a),-100,os.fsencode(b),2)!=0:raise OSError(ctypes.get_errno(),'RENAME_EXCHANGE_FAILED')
def swap(config,*,base=ROOT,lockpath=LOCK,owner=0,exchanger=exchange,admit=None):
 need(re.fullmatch('[a-f0-9]{40}',config['source']) and re.fullmatch('[a-z0-9-]{1,64}',config['attempt']) and re.fullmatch('[a-z0-9-]{1,48}',config['generation']),'IDENTITY')
 current=base/config['source']/config['attempt'];parent=current.parent
 # All ancestors must be stable owner-controlled directories; no symlink traversal.
 for path in [parent,*parent.parents]:
  s=path.lstat();need(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid in (0,owner) and not s.st_mode&0o022,'PARENT_TRUST')
 fd=os.open(lockpath,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==owner and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'LOCK_TRUST');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  need(identity(s)==identity(lockpath.lstat()),'LOCK_CHANGED')
  oldtree=inventory(current,owner);need(oldtree==config['oldTree'],'OLD_TREE_CAS')
  need(SIX<=set(oldtree) and set(config['newFiles'])==SIX,'SIX_FILES')
  data={k:base64.b64decode(v['base64'],validate=True)for k,v in config['newFiles'].items()}
  need(all(sha(raw)==config['newFiles'][k]['sha256']for k,raw in data.items()),'NEW_HASH')
  old=json.loads(read(current/'approval.json',owner)[0]);new=json.loads(data['approval.json'])
  changed={'issuedAt','expiresAt','publicationIntentRawSha256','immutableEvidence','binaries','revalidationRawSha256','revalidationPolicyRawSha256'}
  need(set(old)==set(new) and all(old[k]==new[k]for k in old if k not in changed),'AUTHORITY_CHANGED')
  need(new['sourceRevision']==config['source'] and new['attemptId']==config['attempt'] and new['publishAuthorized']is True,'APPROVAL_IDENTITY')
  start=dt.datetime.fromisoformat(new['issuedAt']);end=dt.datetime.fromisoformat(new['expiresAt']);need(start<=dt.datetime.now(dt.timezone.utc)<end,'NEW_APPROVAL_EXPIRED')
  need(data['candidate-plan.json']==read(current/'candidate-plan.json',owner)[0],'PLAN_CHANGED')
  # Admission callback must be a reviewed fixed caller: actual canonical rv.admit +
  # cap.verify_bundle against existing inbox, and original host approval validator.
  need(admit is not None,'CANONICAL_ADMISSION_REQUIRED');admit(data,new)
  history=parent/(config['attempt']+'.history-'+config['generation']);saved=parent/(config['attempt']+'.old-six-'+config['generation']);journal=parent/(config['attempt']+'.swap-'+config['generation']+'.json')
  need(not history.exists() and not saved.exists() and not journal.exists(),'GENERATION_EXISTS_NO_RETRY')
  size=sum(v['bytes']for v in oldtree.values())+sum(len(x)for x in data.values());need(shutil.disk_usage(parent).free>size+64*1024*1024,'STAGING_CAPACITY')
  saved.mkdir(mode=0o700)
  for name in SIX:put(saved/name,read(current/name,owner)[0])
  sync(saved);sync(parent)
  history.mkdir(mode=0o700)
  for rel,record in oldtree.items():
   target=history/rel;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   raw=read(current/rel,owner)[0];need(sha(raw)==record['sha256'],'COPY_CAS');put(target,data[rel]if rel in SIX else raw,record['mode'])
  for folder in sorted((p for p in history.rglob('*')if p.is_dir()),key=lambda p:len(p.parts),reverse=True):sync(folder)
  sync(history);sync(parent)
  expected={k:({'sha256':sha(data[k]),'bytes':len(data[k]),'mode':v['mode']}if k in SIX else v)for k,v in oldtree.items()}
  need(inventory(current,owner)==oldtree and inventory(history,owner)==expected,'PRE_EXCHANGE_CAS')
  need(dt.datetime.now(dt.timezone.utc)<end,'NEW_APPROVAL_EXPIRED')
  intent={'kind':'cn-proof-approval-directory-exchange-v1','oldTree':oldtree,'newTree':expected,'current':str(current),'history':str(history),'oldSix':str(saved),'automaticRetry':False}
  put(journal,(json.dumps(intent,sort_keys=True)+'\n').encode());sync(parent)
  exchanger(current,history);sync(parent)
  need(inventory(current,owner)==expected and inventory(history,owner)==oldtree,'EXCHANGE_UNCERTAIN_RECONCILE_ONLY')
  receipt={'exchanged':True,'publisherCalled':False,'oldApprovalSha256':oldtree['approval.json']['sha256'],'newApprovalSha256':expected['approval.json']['sha256']}
  put(parent/(journal.name+'.done'),(json.dumps(receipt,sort_keys=True)+'\n').encode());sync(parent);return receipt
 finally:os.close(fd)

def canonical_admit(data,approval):
 tools=Path('/usr/local/lib/workspacex-cn')
 for name,digest in approval['installedToolSha256'].items():
  need(re.fullmatch(r'[A-Za-z0-9_-]+\.py',name),'TOOL_NAME');need(sha(read(tools/name,0,2*1024*1024)[0])==digest,'INSTALLED_TOOL_HASH')
 sys.dont_write_bytecode=True;sys.path.insert(0,str(tools))
 import cn_candidate_host as h
 import cn_candidate_revalidation as rv
 import cn_image_candidate as c
 import cn_candidate_publication as publication
 h.validate_approval(approval,approval['sourceRevision'],approval['attemptId'])
 proof=data['candidate-revalidation.json'];policy=data['candidate-revalidation-policy.json']
 cap=rv.admit(proof,approval['revalidationRawSha256'],approval['revalidationPolicyRawSha256'],policy)
 rawplan=data['candidate-plan.json'];need(sha(rawplan)==approval['candidatePlanRawSha256'],'PLAN_HASH')
 plan=c.validate_plan(json.loads(rawplan));inbox=Path('/var/lib/workspacex-cn/candidate-inbox')/approval['sourceRevision']/approval['attemptId']
 rawset=read(inbox/'candidate-set.json',0,256*1024)[0];need(sha(rawset)==approval['candidateSetRawSha256'],'SET_HASH')
 cap.verify_bundle(inbox,plan,rawset,approval['candidateSetRawSha256'],approval['candidatePlanRawSha256'])
 publication.validate_intent(data['publication-intent.json'],approval['publicationIntentRawSha256'],plan,rawset,approval['candidateSetRawSha256'],approval['candidatePlanRawSha256'],revalidation=cap)
 need(sha(data['immutable-provider-response.json'])==approval['immutableEvidence']['providerResponseSha256'],'PROVIDER_RAW_HASH')

def main():
 need(len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]) and os.geteuid()==0 and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode,'FIXED_ROOT_ENTRY')
 digest=sys.argv[1];raw=read(Path('/etc/workspacex-cn/proof-refresh-approvals')/(digest+'.json'),0,2*1024*1024)[0];need(sha(raw)==digest,'CONFIG_HASH')
 cfg=json.loads(raw);need(sha(read(Path(__file__),0,1024*1024)[0])==cfg['scriptSha256'],'SCRIPT_HASH')
 print(json.dumps(swap(cfg,admit=canonical_admit)))
if __name__=='__main__':
 try:main()
 except Exception:print('{"status":"APPROVAL_EXCHANGE_BLOCKED_OR_UNKNOWN","automaticRetry":false}');sys.exit(1)
