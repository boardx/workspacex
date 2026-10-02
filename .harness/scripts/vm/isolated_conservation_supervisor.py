"""Actual immutable Docker execution adapted from reviewed conservation launcher."""
import hashlib,json,os,signal,stat,subprocess,sys,tempfile,uuid
from pathlib import Path
DOCKER='/usr/bin/docker'
class OwnedTermination(BaseException):pass
def install_termination_handler():
 # First termination interrupts work so finally runs; subsequent termination cannot
 # interrupt owned cleanup. The parent still enforces a finite SIGKILL deadline.
 def terminate(signum,frame):
  signal.signal(signal.SIGTERM,signal.SIG_IGN)
  signal.signal(signal.SIGINT,signal.SIG_IGN)
  raise OwnedTermination()
 signal.signal(signal.SIGTERM,terminate)
 signal.signal(signal.SIGINT,terminate)
def capture(args,timeout=15,check=True):
 r=subprocess.run([DOCKER,*args],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'})
 if check and r.returncode:raise ValueError('DOCKER_REJECTED')
 if len(r.stdout)>1048576:raise ValueError('OUTPUT_BOUND')
 return r
def verified(ref):
 path=Path(ref['path']);assert path.is_absolute()
 for parent in path.parents:
  x=parent.lstat();assert stat.S_ISDIR(x.st_mode) and x.st_uid==x.st_gid==0 and not x.st_mode&0o022
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as f:
  x=os.fstat(f.fileno());assert stat.S_ISREG(x.st_mode) and x.st_uid==x.st_gid==0 and stat.S_IMODE(x.st_mode)==0o600 and 0<x.st_size<=32*1024*1024
  raw=f.read(32*1024*1024+1)
 assert hashlib.sha256(raw).hexdigest()==ref['sha256']
 return raw
def main(p):
 b=p['binding'];e=p['entry'];code=p['engineBytes'];image=e['immutableRuntimeId']
 assert os.geteuid()==0 and hashlib.sha256(code.encode()).hexdigest()==e['sha256']
 x=json.loads(capture(['image','inspect',image]).stdout);assert len(x)==1 and x[0]['Id']==image and x[0]['Os']=='linux' and x[0]['Architecture']=='amd64'
 assert x[0]['Config']['Labels']['org.opencontainers.image.revision']==e['runtimeSourceSha']
 for v in x[0]['Config'].get('Env',[]):
  k,_,value=v.partition('=');assert not(value and any(q in k.upper() for q in ['PASSWORD','SECRET','TOKEN','API_KEY','DATABASE_URL']))
 assert e['language'] in ['node','python']
 mounts=[];temporary=None
 owner='wsx-conservation-'+uuid.uuid4().hex;network=None;proc=None;proof=None
 try:
  network=capture(['network','create','--driver=bridge','--label','wsx.rehearsal.owner='+owner,'--opt','com.docker.network.bridge.enable_icc=false',owner]).stdout.decode().strip()
  n=json.loads(capture(['network','inspect',network]).stdout)[0];assert n['Id']==network and n['Labels'].get('wsx.rehearsal.owner')==owner and not n.get('Containers')
  s=p['secret'];tls=s['tls'];assert tls==b['tls'];ca=None
  if tls.get('sslmode')=='verify-full':ca=verified(tls['ca']);assert b'BEGIN CERTIFICATE' in ca
  else:
   sslproof=tls.get('providerSslEvidence',{});assert tls.get('sslmode')=='disable' and tls.get('approvedException')=='aliyun-postgresql-serverless-no-tls' and sslproof.get('targetInstanceId')==b['targetInstanceId'] and sslproof.get('providerCreatedUtc')==b['providerCreatedUtc'] and sslproof.get('sslEnabled') is False
  oldsecret={'instanceId':s['targetInstanceId'],'attemptId':s['attemptId'],'host':s['host'],'port':s['port'],'user':s['user'],'password':s['password'],'sslmode':tls['sslmode'],**({'tlsCaPem':ca.decode(),'tlsCaSha256':tls['ca']['sha256']} if ca else {'transportException':'aliyun-postgresql-serverless-no-tls'})}
  planbytes=json.dumps(p['plan'],separators=(',',':'),ensure_ascii=False)
  runtime=[*[DOCKER,'run','--rm','--pull=never','--name',owner,'--label','wsx.rehearsal.owner='+owner,'-i','--network',network,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=0:0','--cpus=1','--memory=768m','--pids-limit=128','--tmpfs','/run/wsx:rw,noexec,nosuid,nodev,size=256m,mode=0700','--env','WSX_CONSERVATION_RUN=1','--entrypoint','node',image,'-e',code] ]
  if e['language']=='python':
   temporary=tempfile.TemporaryDirectory(prefix='wsx-canonical-mounts-',dir='/run')
   root=Path(temporary.name);exact=root/'exact';probe=root/'probe';exact.mkdir(mode=0o700);probe.mkdir(mode=0o700)
   expectedProbe={'canonical-source-manifest.json','canonical-extractor.json','python-runtime-manifest.json'}
   resources=e['resources'];assert set(resources)=={'exact','probe'} and set(resources['probe'])==expectedProbe
   source=verified(resources['probe']['canonical-source-manifest.json']);manifest=json.loads(source);assert manifest['sourceSha']==b['candidateSha']
   assert set(resources['exact'])==set(manifest['filesSha256'])
   for relative,ref in resources['exact'].items():
    assert relative.startswith('apps/deep-agent-service/') and '..' not in relative.split('/') and not relative.startswith('/')
    raw=verified(ref);assert hashlib.sha256(raw).hexdigest()==manifest['filesSha256'][relative]
    out=exact/relative;out.parent.mkdir(mode=0o700,parents=True,exist_ok=True);out.write_bytes(raw);out.chmod(0o600)
   for name,ref in resources['probe'].items():
    raw=verified(ref);out=probe/name;out.write_bytes(raw);out.chmod(0o600)
   if ca:(probe/'rds-ca.pem').write_bytes(ca);(probe/'rds-ca.pem').chmod(0o600)
   script=probe/'engine.py';script.write_text(code);script.chmod(0o600)
   roles=s['roles']
   def role(name):
    r=roles[name];assert r['user']==name and all(r[k]==b[k] for k in ['accountId','regionId','targetInstanceId','attemptId','host','peer','peerSha256','providerCreatedUtc','tls'])
    return {'instanceId':r['targetInstanceId'],'attemptId':r['attemptId'],'host':r['host'],'port':r['port'],'user':name,'password':r['password'],'sslmode':tls['sslmode'],**({'tlsCaPem':ca.decode(),'tlsCaSha256':tls['ca']['sha256']} if ca else {'transportException':'aliyun-postgresql-serverless-no-tls'})}
   observation=p['providerObservation'];assert all(observation.get(k)==b[k] for k in ['targetInstanceId','peer','providerCreatedUtc'])
   provider={**observation,'instanceId':observation['targetInstanceId'],'peerSha256':b['peerSha256'],'host':b['host'],'port':5432}
   payload={'binding':b,'plan':p['plan'],'sourceSha':b['candidateSha'],'provider':provider,'memoryOwner':role('memory_owner'),'memoryRuntime':role('memory_rw'),'checkpointOwner':role('graph_owner'),'canonicalSetupSourceSha256':resources['probe']['canonical-source-manifest.json']['sha256'],'canonicalMigrationExtractorReceiptSha256':resources['probe']['canonical-extractor.json']['sha256'],'pythonRuntimeManifestSha256':resources['probe']['python-runtime-manifest.json']['sha256'],'canonicalMigrationExtractorInvokeId':e['canonicalMigrationExtractorInvokeId'],'dependencyImageId':image}
   # Preserve all immutable isolation flags; add readonly exact sources/evidence only.
   runtime=runtime[:runtime.index('--entrypoint')]+['--mount','type=bind,src='+str(exact)+',dst=/exact,readonly','--mount','type=bind,src='+str(probe)+',dst=/probe,readonly','--entrypoint','python',image,'-I','/probe/engine.py']
  else:
   request=dict(p['request']);request.update({'targetCaSha256':tls['ca']['sha256']} if ca else {'tlsExceptionVerified':True})
   payload={'request':request,'secret':oldsecret,'baseline':p['baseline'],'before':p['before'],'canonicalPlan':p.get('canonicalPlan'),'frozenPlanBytes':planbytes,'frozenPlanSha256':hashlib.sha256(planbytes.encode()).hexdigest()}
  proc=subprocess.Popen(runtime,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'})
  raw,_=proc.communicate(json.dumps(payload).encode(),timeout=e['timeoutSeconds']);assert proc.returncode==0 and len(raw)<1048576
  proof=json.loads(raw);assert ((proof.get('readOnly') and proof.get('rollbackComplete')) if e['language']=='node' else (proof.get('allCanonicalSetupsAccepted') and proof.get('connectionPeerIdentityChecks',0)>=4)) and proof['targetInstanceId']==b['targetInstanceId'] and proof['candidateSha']==b['candidateSha'] and proof['attemptId']==b['attemptId']
 finally:
  if proc and proc.poll() is None:proc.kill();proc.wait(timeout=15)
  found=capture(['inspect',owner],check=False)
  if found.returncode==0:
   c=json.loads(found.stdout);assert len(c)==1 and c[0]['Config']['Labels'].get('wsx.rehearsal.owner')==owner;capture(['rm','-f',c[0]['Id']],30)
  assert not capture(['ps','-aq','--filter','name=^/'+owner+'$']).stdout.strip()
  # Signal can arrive after create succeeds but before its ID is assigned. Reconcile
  # only this run's random owner, then prove ownership before any removal.
  found_network=capture(['network','inspect',network or owner],check=False)
  if found_network.returncode==0:
   networks=json.loads(found_network.stdout);assert len(networks)==1
   n=networks[0];assert (network is None or n['Id']==network) and n['Labels'].get('wsx.rehearsal.owner')==owner and not n.get('Containers')
   capture(['network','rm',n['Id']]);assert not capture(['network','ls','-q','--no-trunc','--filter','id='+n['Id']]).stdout.strip()
  assert not capture(['network','ls','-q','--no-trunc','--filter','name=^'+owner+'$']).stdout.strip()
  if temporary:temporary.cleanup()
 assert proof is not None
 proof.update(engineSha256=e['sha256'],ownedCleanupVerified=True,actualSqlPeerVerified=True)
 return proof
if __name__=='__main__':
 install_termination_handler()
 try:print(json.dumps(main(json.load(sys.stdin))))
 except BaseException:print('CONSERVATION_SUPERVISOR_REJECTED',file=sys.stderr);sys.exit(1)
