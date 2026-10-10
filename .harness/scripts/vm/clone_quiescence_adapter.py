"""Fixed immutable Agent-image executor; no cloud API and no resource lifecycle ownership."""
import json,subprocess,uuid,time,math
from isolated_rehearsal import trusted_bytes,validate_binding
DOCKER='/usr/bin/docker'
def capture(args,check=True):
 r=subprocess.run([DOCKER,*args],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30)
 if len(r.stdout)>1048576 or (check and r.returncode):raise ValueError('QUIESCENCE_DOCKER_READBACK')
 return r

def remaining(p):
 values=(p['deadlineEpoch'],p['monotonicDeadline'])
 if not all(type(v)in(int,float) and math.isfinite(v) for v in values):raise ValueError('ADMISSION_DEADLINE')
 left=min(values[0]-time.time(),values[1]-time.monotonic())
 if left<=0:raise ValueError('ADMISSION_EXPIRED')
 return left
def invoke(p):
 remaining(p)
 b=validate_binding(p['binding']);spec=b['quiescenceRuntime'];engine=trusted_bytes(spec['engine']['path'],spec['engine']['sha256']).decode()
 image=spec['imageId'];meta=json.loads(capture(['image','inspect',image]).stdout)
 if len(meta)!=1 or meta[0]['Id']!=image or meta[0]['Os']!='linux' or meta[0]['Architecture']!='amd64' or meta[0]['Config']['Labels'].get('org.opencontainers.image.revision')!=b['candidateSha']:raise ValueError('QUIESCENCE_IMAGE_IDENTITY')
 for env in meta[0]['Config'].get('Env',[]):
  k,_,v=env.partition('=')
  if v and any(x in k.upper() for x in ('PASSWORD','SECRET','TOKEN','API_KEY','DATABASE_URL')):raise ValueError('QUIESCENCE_BAKED_SECRET')
 network=b['restore']['isolatedNetwork'];n=json.loads(capture(['network','inspect',network]).stdout)
 if len(n)!=1 or n[0]['Id']!=network or n[0]['Driver']!='bridge' or n[0].get('Labels',{}).get('wsx.rehearsal.owner')!=b['attemptId']:raise ValueError('QUIESCENCE_NETWORK_OWNER')
 name='wsx-clone-quiescence-'+uuid.uuid4().hex;process=None;proof=None
 try:
  args=['run','--rm','--pull=never','--name',name,'--label','wsx.rehearsal.owner='+name,'-i','--network',network,'--add-host',b['host']+':'+b['peer'],'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=512m','--pids-limit=64','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777','--entrypoint','python',image,'-I','-B','-c',engine]
  remaining(p)
  process=subprocess.Popen([DOCKER,*args],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
  out,_=process.communicate(json.dumps(p).encode(),timeout=min(90,remaining(p)))
  if process.returncode or len(out)>65536:raise ValueError('QUIESCENCE_ENGINE_UNKNOWN_OR_REJECTED')
  proof=json.loads(out)
 finally:
  if process and process.poll() is None:process.kill();process.wait(timeout=15)
  found=capture(['inspect',name],False)
  if found.returncode==0:
   c=json.loads(found.stdout)
   if len(c)!=1 or c[0]['Config'].get('Labels',{}).get('wsx.rehearsal.owner')!=name:raise ValueError('QUIESCENCE_CONTAINER_OWNER')
   capture(['rm','-f',c[0]['Id']])
  if capture(['ps','-aq','--filter','name=^/'+name+'$']).stdout.strip():raise ValueError('QUIESCENCE_CONTAINER_REMAINS')
 if proof is None:raise ValueError('QUIESCENCE_NO_RECEIPT')
 return proof
