"""GitHub-only historical candidate byte preflight. No network, builds or publication."""
import argparse,hashlib,importlib.util,json,os,platform,re,shutil,stat,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts'))
import cn_image_candidate as candidate
import cn_candidate_github as github

def load_module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
preserve=load_module('fixed_original_preservation',ROOT/'scripts/preserve-cn-f0eb-originals.py')
PLAN_SHA='2298ed8b0223888b4926a70728464ea46641c746dc3c9d981cff6bb935738f8e'
SET_SHA='17dfdcc38f3d665b631cbeba001928856af6b9c9e4bda14e07abf72470bee193'
SERVICES=('agent','api','postgres','sandbox','web')
need=candidate.require
sha=lambda b:hashlib.sha256(b).hexdigest()
def decode(raw):
 def pairs(items):
  out={}
  for k,v in items:need(k not in out,'DUPLICATE_FIELD');out[k]=v
  return out
 return json.loads(raw,object_pairs_hook=pairs)
def validate_selection(v):
 need(type(v)is dict and set(v)=={'kind','sourceRevision','controlRevision','preservationRunId','artifacts'},'SELECTION_FIELDS')
 need(v['kind']=='isolated-f0eb-preserved-selection-v1' and v['sourceRevision']==preserve.SOURCE,'ISOLATION_SELECTION')
 need(type(v['controlRevision'])is str and re.fullmatch('[a-f0-9]{40}',v['controlRevision']),'CONTROL_SHA')
 need(type(v['preservationRunId'])is int and v['preservationRunId']>0,'PRESERVATION_RUN')
 need(type(v['artifacts'])is dict and set(v['artifacts'])==set(preserve.SPECS),'EXACT_SEVEN')
 for name,r in v['artifacts'].items():
  need(type(r)is dict and set(r)=={'artifactId','wrapperBytes','wrapperSha256','file'},'WRAPPER_FIELDS')
  need(type(r['artifactId'])is int and r['artifactId']>0,'WRAPPER_ID')
  need(type(r['wrapperBytes'])is int and 0<r['wrapperBytes']<=preserve.SPECS[name]['zipBytes']+1048576,'WRAPPER_SIZE')
  need(type(r['wrapperSha256'])is str and re.fullmatch('[a-f0-9]{64}',r['wrapperSha256'])and r['file']==name+'.zip','WRAPPER_HASH_PATH')
 need(len({r['artifactId']for r in v['artifacts'].values()})==7,'WRAPPER_DUPLICATE_ID')
 return v

def private_dir(path):
 s=path.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==os.geteuid()and not s.st_mode&0o077,'PRIVATE_DIRECTORY')
def read_file(path,limit):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_size<=limit,'INPUT_FILE')
  with os.fdopen(os.dup(fd),'rb')as f:raw=f.read(limit+1)
  after=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
  sig=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(len(raw)<=limit and sig(before)==sig(after)==sig(named),'INPUT_CHANGED');return raw
 finally:os.close(fd)
def copy_verified(source,target,size,expected,deadline):
 fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size==size,'WRAPPER_FILE')
  h=hashlib.sha256();count=0
  with os.fdopen(os.dup(fd),'rb')as src,target.open('xb')as out:
   os.chmod(target,0o600)
   while True:
    need(time.monotonic()<deadline,'PREFLIGHT_DEADLINE');b=src.read(1024*1024)
    if not b:break
    count+=len(b);need(count<=size,'WRAPPER_LIMIT');h.update(b);out.write(b)
   out.flush();os.fsync(out.fileno())
  need(count==size and h.hexdigest()==expected,'WRAPPER_BYTES')
 finally:os.close(fd)
def resource_observation(base,meminfo):
 m=re.search(r'^MemTotal:\s+(\d+) kB$',meminfo,re.M);need(m,'MEMTOTAL_REQUIRED')
 total=int(m[1])*1024;free=shutil.disk_usage(base).free
 return {'memTotalBytes':total,'diskFreeBytes':free,'originalServiceCapsBytes':int(12.5*1024**3),'originalCapsWithHeadroomFit':total>=16*1024**3,'minimumBytePreflightMemoryFit':total>=2*1024**3,'diskFit':free>=30*1024**3,'cpuCount':os.cpu_count()}
def environment(v):
 need(sys.platform=='linux'and platform.machine()in('x86_64','amd64'),'GITHUB_LINUX_AMD64_REQUIRED')
 need(os.environ.get('GITHUB_ACTIONS')=='true'and os.environ.get('GITHUB_REPOSITORY')==preserve.REPO,'GITHUB_ONLY')
 need(re.fullmatch('[0-9]+',os.environ.get('GITHUB_RUN_ID','')),'GITHUB_RUN_ID')
 head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,stderr=subprocess.DEVNULL,timeout=5).decode().strip()
 need(head==v['controlRevision'],'EXACT_CONTROL_CHECKOUT')
 need(not any(os.environ.get(k)for k in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')),'NO_REMOTE_DOCKER')
def preflight(selection_path,expected,input_dir,output):
 raw=read_file(selection_path,65536);need(sha(raw)==expected,'SELECTION_RAW_SHA');v=validate_selection(decode(raw));environment(v)
 private_dir(input_dir);private_dir(output.parent);output.mkdir(mode=0o700)
 observation=resource_observation(output,Path('/proc/meminfo').read_text());need(observation['minimumBytePreflightMemoryFit']and observation['diskFit'],'PREFLIGHT_CAPACITY')
 deadline=time.monotonic()+1200;records={}
 for name,r in v['artifacts'].items():
  directory=output/name;directory.mkdir(mode=0o700)
  wrapper=directory/'wrapper.zip';copy_verified(input_dir/r['file'],wrapper,r['wrapperBytes'],r['wrapperSha256'],deadline)
  spec=preserve.SPECS[name];github.extract(wrapper,directory,{'original.zip':spec['zipBytes'],'receipt.json':65536})
  size,digest=candidate.a.file_digest(directory/'original.zip',spec['zipBytes']);need(size==spec['zipBytes']and digest==spec['zipSha256'],'ORIGINAL_ZIP_BYTES')
  receipt=decode(read_file(directory/'receipt.json',65536))
  need(receipt.get('kind')=='cn-historical-original-zip-preservation-v1'and receipt.get('service')==name and receipt.get('sourceRevision')==preserve.SOURCE and receipt.get('producerControlRevision')==preserve.CONTROL and receipt.get('producerRunId')==preserve.RUN and receipt.get('producerRunAttempt')==1,'PRESERVATION_BINDING')
  need(receipt.get('zipSha256')==digest and receipt.get('zipBytes')==size,'PRESERVATION_BYTES')
  preserve.validate_metadata(receipt.get('originalMetadata'),name)
  records[name]={'wrapperArtifactId':r['artifactId'],'wrapperSha256':r['wrapperSha256'],'wrapperBytes':r['wrapperBytes'],'originalArtifactId':spec['id'],'originalZipSha256':digest,'originalZipBytes':size}
 github.extract(output/'plan/original.zip',output/'plan',{'cn-candidate-plan.json':16384})
 github.extract(output/'set/original.zip',output/'set',{'candidate-plan.json':16384,'candidate-set.json':262144})
 plan_raw=read_file(output/'plan/cn-candidate-plan.json',16384);set_raw=read_file(output/'set/candidate-set.json',262144)
 need(sha(plan_raw)==PLAN_SHA and sha(set_raw)==SET_SHA and read_file(output/'set/candidate-plan.json',16384)==plan_raw,'ORIGINAL_METADATA_SHA')
 plan=candidate.validate_plan(decode(plan_raw));receipt=candidate.validate_historical_receipt(set_raw,plan,SET_SHA)
 need(plan['sourceRevision']==preserve.SOURCE and plan['controlRevision']==preserve.CONTROL,'ORIGINAL_SOURCE_CONTROL')
 need(set(receipt['images'])==set(SERVICES),'FIVE_IMAGES')
 bundle=output/'bundle';bundle.mkdir(mode=0o700);issued=[];expires=[]
 for service in SERVICES:
  need(time.monotonic()<deadline,'PREFLIGHT_DEADLINE');directory=output/service;entry=receipt['images'][service]
  github.extract(directory/'original.zip',directory,{'candidate-plan.json':16384,'candidate-fragment.json':262144,service+'.tar':entry['size']})
  need(read_file(directory/'candidate-plan.json',16384)==plan_raw,'FRAGMENT_PLAN')
  fragment_raw=read_file(directory/'candidate-fragment.json',262144)
  fragment=candidate.verify_historical_bundle(directory,plan,fragment_raw,sha(fragment_raw),PLAN_SHA,complete=False)
  need(set(fragment['images'])=={service}and fragment['images'][service]==entry,'FRAGMENT_IMAGE')
  issued.append(candidate.a.timestamp(fragment['producedAt']));expires.append(candidate.a.timestamp(fragment['expiresAt']))
  os.rename(directory/(service+'.tar'),bundle/(service+'.tar'))
  records[service].update(tarSha256=entry['sha256'],tarBytes=entry['size'],imageConfigId=entry['imageId'])
 need(candidate.a.timestamp(receipt['producedAt'])==min(issued)and candidate.a.timestamp(receipt['expiresAt'])==min(expires),'COLLECTION_TIMES')
 result={'kind':'isolated-f0eb-byte-preflight-v1','selectionRawSha256':expected,'controlRevision':v['controlRevision'],'applicationRevision':preserve.SOURCE,'preservationRunId':v['preservationRunId'],'githubRunId':os.environ['GITHUB_RUN_ID'],'artifacts':records,'resources':observation,'historicalBytesVerified':True,'imageLoaded':False,'sixBusinessesVerified':False,'productionReady':False,'publicationAuthorized':False}
 preserve.private_file(output/'preflight.json',preserve.canonical(result));return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--selection',type=Path,required=True);p.add_argument('--selection-sha',required=True);p.add_argument('--input-dir',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
 try:r=preflight(args.selection,args.selection_sha,args.input_dir,args.output);print(json.dumps(r));return 0
 except Exception:print(json.dumps({'status':'PREFLIGHT_FAILED','imageLoaded':False,'productionReady':False}));return 1
if __name__=='__main__':raise SystemExit(main())
