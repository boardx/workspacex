#!/usr/bin/env python3
"""Real isolated canonical/transactional SQL stage in an immutable API container."""
import hashlib,json,os,signal,subprocess,sys,uuid
from pathlib import Path
from isolated_rehearsal import validate_binding,private_json,trusted_bytes
DOCKER='/usr/bin/docker'
def capture(argv,check=True):
 r=subprocess.run([DOCKER,*argv],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30)
 if check and r.returncode:raise ValueError('DOCKER_READBACK')
 if len(r.stdout)>1048576:raise ValueError('OUTPUT_BOUND')
 return r

def run(p):
 b=p['binding'];validate_binding(b);operation=p['operation']
 if operation not in ('migrate','canvas-audit'):raise ValueError('SQL_STAGE_OPERATION')
 raw=trusted_bytes(b['stageManifestPath'],b['stageManifestSha256']);spec=json.loads(raw)
 if spec.get('candidateSha')!=b['candidateSha'] or spec.get('prepared') is not True:raise ValueError('FROZEN_STAGE_MANIFEST')
 entry=spec['stages'][operation];plan=json.loads(trusted_bytes(entry['plan']['path'],entry['plan']['sha256']))
 if plan.get('candidateSha')!=b['candidateSha'] or plan.get('prepared') is not True:raise ValueError('FROZEN_PLAN')
 engine=trusted_bytes(entry['engine']['path'],entry['engine']['sha256']).decode()
 image=entry['immutableRuntimeId'];metadata=json.loads(capture(['image','inspect',image]).stdout)
 if len(metadata)!=1 or metadata[0]['Id']!=image or metadata[0]['Os']!='linux' or metadata[0]['Architecture']!='amd64' or metadata[0]['Config']['Labels'].get('org.opencontainers.image.revision')!=b['candidateSha']:raise ValueError('IMMUTABLE_SOURCE_IMAGE')
 for env in metadata[0]['Config'].get('Env',[]):
  key,_,value=env.partition('=')
  if value and any(x in key.upper() for x in ('PASSWORD','SECRET','TOKEN','API_KEY','DATABASE_URL')):raise ValueError('BAKED_SECRET')
 payload=dict(p,plan=plan)
 if b['tls']['sslmode']=='verify-full':payload['caPem']=trusted_bytes(b['tls']['ca']['path'],b['tls']['ca']['sha256']).decode()
 if operation=='canvas-audit':
  sql=trusted_bytes(entry['sql']['path'],entry['sql']['sha256']).decode()
  migration=trusted_bytes(entry['migration']['path'],entry['migration']['sha256']).decode()
  expected=next((x for x in plan['sourceSqlInventory'] if x['name']=='20261001160000_canvas_template_audit.sql'),None)
  if not expected or hashlib.sha256(migration.encode()).hexdigest()!=expected['sha256']:raise ValueError('CANVAS_MIGRATION_SOURCE')
  expanded=sql.replace('-- Migration replay injected by the hash-bound stage supervisor.',migration)
  payload.update(sql=expanded,sqlSha256=hashlib.sha256(expanded.encode()).hexdigest())
 owner='wsx-isolated-'+uuid.uuid4().hex;network=None;process=None;proof=None
 try:
  network=capture(['network','create','--driver=bridge','--label','wsx.rehearsal.owner='+owner,owner]).stdout.decode().strip()
  n=json.loads(capture(['network','inspect',network]).stdout)[0]
  if n['Id']!=network or n.get('Labels',{}).get('wsx.rehearsal.owner')!=owner or n.get('Containers'):raise ValueError('OWNED_NETWORK')
  invocation=engine+"\nlet raw='';process.stdin.on('data',x=>raw+=x);process.stdin.on('end',()=>main(JSON.parse(raw)).then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('SQL_STAGE_REJECTED');process.exitCode=1;}));"
  argv=[DOCKER,'run','--rm','--pull=never','--name',owner,'--label','wsx.rehearsal.owner='+owner,'-i','--network',network,'--add-host',b['host']+':'+b['peer'],'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=0:0','--cpus=1','--memory=768m','--pids-limit=128','--tmpfs','/run/wsx:rw,noexec,nosuid,nodev,size=32m,mode=0700','--entrypoint','node',image,'--import','tsx','-e',invocation]
  process=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
  raw,_=process.communicate(json.dumps(payload).encode(),timeout=entry['timeoutSeconds'])
  if process.returncode or len(raw)>1048576:raise ValueError('ACTUAL_SQL_STAGE_FAILED')
  proof=json.loads(raw)
  if proof.get('accepted') is not True or any(proof.get(k)!=b[k] for k in ('targetInstanceId','attemptId','candidateSha')):raise ValueError('ACTUAL_SQL_PROOF')
 finally:
  if process and process.poll() is None:process.kill();process.wait(timeout=15)
  found=capture(['inspect',owner],False)
  if found.returncode==0:
   c=json.loads(found.stdout)
   if len(c)!=1 or c[0]['Config'].get('Labels',{}).get('wsx.rehearsal.owner')!=owner:raise ValueError('FOREIGN_CONTAINER')
   capture(['rm','-f',c[0]['Id']])
  if capture(['ps','-aq','--filter','name=^/'+owner+'$']).stdout.strip():raise ValueError('CONTAINER_CLEANUP_NOT_VERIFIED')
  if network:
   n=json.loads(capture(['network','inspect',network]).stdout)[0]
   if n['Id']!=network or n.get('Labels',{}).get('wsx.rehearsal.owner')!=owner or n.get('Containers'):raise ValueError('FOREIGN_NETWORK')
   capture(['network','rm',network])
   if capture(['network','ls','-q','--no-trunc','--filter','id='+network]).stdout.strip():raise ValueError('NETWORK_CLEANUP_NOT_VERIFIED')
 if proof is None:raise ValueError('PROOF_REQUIRED')
 return dict(proof,ownedCleanupVerified=True,engineSha256=entry['engine']['sha256'])
if __name__=='__main__':
 signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(TimeoutError('SQL_STAGE_TERMINATED')))
 try:print(json.dumps(run(json.load(sys.stdin))))
 except BaseException:print('ISOLATED_SQL_STAGE_REJECTED',file=sys.stderr);sys.exit(1)
