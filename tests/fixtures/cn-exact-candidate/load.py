"""Load verified historical bytes into an otherwise idle GitHub fixture daemon only."""
import argparse,importlib.util,json,os,re,resource,shutil,stat,subprocess,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('exact_preflight',Path(__file__).with_name('preflight.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
import cn_candidate_publication as publication
need=p.need

def run(docker,args,deadline,*,stdin=None,output=None,limit=1024*1024):
 remaining=deadline-time.monotonic();need(remaining>0,'LOAD_DEADLINE')
 env={'PATH':'/usr/bin:/bin','HOME':str(Path.home()),'LANG':'C','DOCKER_CONFIG':str(Path('/nonexistent/wsx-no-docker-config'))}
 def bounds():resource.setrlimit(resource.RLIMIT_FSIZE,(limit,limit))
 # All children inherit the required outer CI cgroup. No new sessions or process escape.
 result=subprocess.run([docker,*args],stdin=stdin if stdin else subprocess.DEVNULL,stdout=output if output else subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,timeout=min(remaining,300),check=False,preexec_fn=bounds)
 need(result.returncode==0,'DOCKER_OPERATION_FAILED')
 if output:return None
 need(len(result.stdout)<=limit,'DOCKER_OUTPUT_LIMIT');return result.stdout

def load(root,expected):
 p.private_dir(root);raw=p.read_file(root/'preflight.json',262144);need(p.sha(raw)==expected,'PREFLIGHT_RAW_SHA');r=p.decode(raw)
 need(r.get('kind')=='isolated-f0eb-byte-preflight-v1'and r.get('historicalBytesVerified')is True and r.get('imageLoaded')is False,'BYTE_PREFLIGHT_REQUIRED')
 p.environment({'controlRevision':r.get('controlRevision')});need(r.get('githubRunId')==os.environ['GITHUB_RUN_ID'],'SAME_GITHUB_JOB_RUN')
 # Load is distinct from capacity admission for starting seven services.
 need(shutil.disk_usage(root).free>=12*1024**3,'LOAD_DISK')
 plan_raw=p.read_file(root/'plan/cn-candidate-plan.json',16384);set_raw=p.read_file(root/'set/candidate-set.json',262144)
 need(p.sha(plan_raw)==p.PLAN_SHA and p.sha(set_raw)==p.SET_SHA,'ORIGINAL_METADATA_SHA')
 plan=p.candidate.validate_plan(p.decode(plan_raw));receipt=p.candidate.verify_historical_bundle(root/'bundle',plan,set_raw,p.SET_SHA,p.PLAN_SHA)
 docker=shutil.which('docker');need(docker and Path(docker).is_file(),'DOCKER_REQUIRED');docker=str(Path(docker).resolve());binary_sha=p.sha(Path(docker).read_bytes())
 deadline=time.monotonic()+1200
 need(run(docker,['--host','unix:///var/run/docker.sock','ps','-aq'],deadline).strip()==b'','IDLE_FIXTURE_DAEMON_REQUIRED')
 docker_root=p.decode(run(docker,['--host','unix:///var/run/docker.sock','info','--format','{{json .DockerRootDir}}'],deadline))
 need(type(docker_root)is str and Path(docker_root).is_absolute()and Path(docker_root).is_dir(),'DOCKER_ROOT_REQUIRED')
 need(shutil.disk_usage(docker_root).free>=12*1024**3,'DAEMON_DISK')
 # Serialize all loads. Any failed/unknown call leaves this claim; never retry it.
 p.preserve.private_file(root/'load-claim.json',p.preserve.canonical({'kind':'isolated-candidate-load-claim-v1','preflightRawSha256':expected,'dockerSha256':binary_sha,'githubRunId':os.environ['GITHUB_RUN_ID']}))
 directory_fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(directory_fd)
 finally:os.close(directory_fd)
 loaded={}
 for service in p.SERVICES:
  entry=receipt['images'][service];tag=entry['stagingTag']
  existing=run(docker,['--host','unix:///var/run/docker.sock','image','ls','-q','--no-trunc',tag],deadline)
  need(existing.strip()==b'','CANDIDATE_TAG_ALREADY_PRESENT')
  need(p.sha(Path(docker).read_bytes())==binary_sha,'DOCKER_BINARY_DRIFT')
  path=root/'bundle'/entry['file'];fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  with os.fdopen(fd,'rb')as source:
   s=os.fstat(source.fileno());need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size==entry['size'],'TAR_FILE')
   # Rehash the held FD immediately before the one irreversible load attempt.
   h=p.hashlib.sha256()
   while True:
    b=source.read(1024*1024)
    if not b:break
    h.update(b)
   need(h.hexdigest()==entry['sha256'],'TAR_DRIFT');source.seek(0)
   run(docker,['--host','unix:///var/run/docker.sock','image','load'],deadline,stdin=source)
  observed=p.decode(run(docker,['--host','unix:///var/run/docker.sock','image','inspect',tag],deadline));need(type(observed)is list and len(observed)==1,'LOADED_ONE_IMAGE');image=observed[0]
  archive=None
  if image.get('Id')!=entry['imageId']:
   need(type(image.get('Id'))is str and re.fullmatch('sha256:[a-f0-9]{64}',image['Id']),'STORE_ID')
   archive=root/(service+'-store.tar')
   with archive.open('xb')as out:
    os.chmod(archive,0o600)
    run(docker,['--host','unix:///var/run/docker.sock','image','save',image['Id']],deadline,output=out,limit=entry['size']*2+16*1024**2)
   publication.image_matches(image,entry,plan,store_archive=archive);archive.unlink()
  else:publication.image_matches(image,entry,plan)
  reread=p.decode(run(docker,['--host','unix:///var/run/docker.sock','image','inspect',tag],deadline));need(reread==observed,'LOADED_IMAGE_CHANGED')
  loaded[service]={'tag':tag,'daemonImageId':image['Id'],'originalConfigId':entry['imageId'],'originalTarSha256':entry['sha256']}
 result={'kind':'isolated-f0eb-loaded-v1','preflightRawSha256':expected,'controlRevision':r['controlRevision'],'applicationRevision':p.preserve.SOURCE,'githubRunId':os.environ['GITHUB_RUN_ID'],'dockerSha256':binary_sha,'images':loaded,'exactImagesLoaded':True,'servicesStarted':False,'sixBusinessesVerified':False,'productionReady':False}
 p.preserve.private_file(root/'loaded.json',p.preserve.canonical(result));return result

def main():
 a=argparse.ArgumentParser();a.add_argument('--root',type=Path,required=True);a.add_argument('--preflight-sha',required=True);v=a.parse_args()
 try:print(json.dumps(load(v.root,v.preflight_sha)));return 0
 except Exception:print(json.dumps({'status':'LOAD_FAILED_OR_UNKNOWN_NO_RETRY','servicesStarted':False,'productionReady':False}));return 1
if __name__=='__main__':raise SystemExit(main())
