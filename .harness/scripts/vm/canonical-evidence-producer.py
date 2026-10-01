"""Pinned-image offline extractor. No credentials, no network, no SQL target."""
import hashlib,json,os,stat,subprocess,sys,tempfile,uuid
from pathlib import Path
from isolated_conservation_supervisor import verified,capture,DOCKER

def produce(p):
 assert os.geteuid()==0 and set(p)=={'candidateSha','imageId','runtimeSourceSha','sourceManifest','extractor','runtimeExtractor','privateRoot','sourceFiles'}
 image=p['imageId'];meta=json.loads(capture(['image','inspect',image]).stdout);assert len(meta)==1 and meta[0]['Id']==image and meta[0]['Os']=='linux' and meta[0]['Config']['Labels']['org.opencontainers.image.revision']==p['runtimeSourceSha']
 raw=verified(p['sourceManifest']);manifest=json.loads(raw);assert manifest['sourceSha']==p['candidateSha']
 assert set(manifest['expectedPackageVersions'])=={'psycopg','langgraph','langgraph-checkpoint-postgres'}
 root=Path(p['privateRoot']);assert root.is_absolute()
 for parent in [root,*root.parents]:
  info=parent.lstat();assert stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==0 and not info.st_mode&0o022
 assert stat.S_IMODE(root.lstat().st_mode)==0o700
 expected={'apps/deep-agent-service/src/deep_agent_service/'+n for n in ['memory_deployment.py','postgres_checkpointer.py','self_hosted_runtime.py']}|{'apps/deep-agent-service/pyproject.toml','apps/deep-agent-service/uv.lock'}
 assert set(manifest['filesSha256'])==set(p['sourceFiles'])==expected
 for relative,ref in p['sourceFiles'].items():assert hashlib.sha256(verified(ref)).hexdigest()==manifest['filesSha256'][relative]
 results={}
 for name,key in [('canonical-extractor','extractor'),('python-runtime-manifest','runtimeExtractor')]:
  code=verified(p[key]);owner='wsx-canonical-evidence-'+uuid.uuid4().hex
  with tempfile.TemporaryDirectory(prefix=owner+'-',dir='/run') as temporary:
   probe=Path(temporary);(probe/'canonical-source-manifest.json').write_bytes(raw);(probe/'extract.py').write_bytes(code)
   for f in probe.iterdir():f.chmod(0o600)
   proc=None
   try:
    proc=subprocess.Popen([DOCKER,'run','--rm','--pull=never','--name',owner,'--label','wsx.rehearsal.owner='+owner,'-i','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=0:0','--cpus=1','--memory=768m','--pids-limit=128','--mount','type=bind,src='+str(probe)+',dst=/probe,readonly','--entrypoint','python',image,'-I','/probe/extract.py'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'})
    result,_=proc.communicate(json.dumps({'candidateSha':p['candidateSha']}).encode(),timeout=180);assert proc.returncode==0 and len(result)<4*1024*1024
    proof=json.loads(result);assert proof['sourceQueriesAttempted']==0 and proof['networkConnectionsAttempted']==0
    assert proof['candidateSha']==p['candidateSha'] and proof['candidateUvLockSha256']==manifest['filesSha256']['apps/deep-agent-service/uv.lock'] and proof['packageVersions']==manifest['expectedPackageVersions']
   finally:
    if proc and proc.poll() is None:proc.kill();proc.wait(timeout=15)
    found=capture(['inspect',owner],check=False)
    if found.returncode==0:
     c=json.loads(found.stdout);assert len(c)==1 and c[0]['Config']['Labels'].get('wsx.rehearsal.owner')==owner;capture(['rm','-f',c[0]['Id']],30)
    assert not capture(['ps','-aq','--filter','name=^/'+owner+'$']).stdout.strip()
   out=root/(name+'.json');fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,'wb') as f:f.write(result);f.flush();os.fsync(f.fileno())
   results[name]={'path':str(out),'sha256':hashlib.sha256(result).hexdigest()}
 return {'candidateSha':p['candidateSha'],'sourceManifestSha256':hashlib.sha256(raw).hexdigest(),'imageId':image,'runtimeSourceSha':p['runtimeSourceSha'],'releaseSourceSha':p['candidateSha'],'proofRefs':results,'networkNone':True,'ownedCleanupVerified':True,'prepared':False}
if __name__=='__main__':
 try:print(json.dumps(produce(json.load(sys.stdin))))
 except BaseException:print('CANONICAL_EVIDENCE_PRODUCER_REJECTED',file=sys.stderr);sys.exit(1)
