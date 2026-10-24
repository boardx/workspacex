#!/usr/bin/env python3
"""Replay the running baseline's migrations in a disposable, internal PG16.
Only schema/catalog evidence is persisted; production data is never read here.
"""
import hashlib,json,os,pathlib,re,secrets,signal,stat,subprocess,sys,time
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from cn_auto_prepare import private,require,require_lock,NotReady
from cn_auto_prepare_provider import require_capacity
DOCKER=['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config','/nonexistent']
def run(args,data=None,timeout=120):
 p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout)
 require(p.returncode==0 and len(p.stdout)<=16*1024*1024,'BASELINE_SCHEMA_COMMAND');return p.stdout
def digest(v):return hashlib.sha256(v).hexdigest()
def write(path,raw):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
def directory(path):
 require(path.is_absolute() and '..' not in path.parts,'BASELINE_DIRECTORY_PATH')
 for parent in path.parents:
  s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and s.st_gid==0 and not s.st_mode&0o022,'BASELINE_DIRECTORY_PARENT')
 path.mkdir(mode=0o700,exist_ok=True);s=path.lstat()
 require(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,0,0o700),'BASELINE_DIRECTORY')
INVENTORY="""const fs=require('fs'),crypto=require('crypto');const p=process.cwd()+'/migrations';const rows=fs.readdirSync(p).filter(n=>n.endsWith('.sql')).sort().map(name=>({name,checksum:crypto.createHash('sha256').update(fs.readFileSync(p+'/'+name)).digest('hex')}));console.log(JSON.stringify(rows));"""
CAPTURE="""import {createRequire} from 'node:module';import {Client} from 'pg';import {migrationConfig} from './src/infrastructure/db/pg-config.ts';let input='';for await(const c of process.stdin)input+=c;const v=JSON.parse(input),Module=createRequire(import.meta.url)('node:module'),m=new Module('/tmp/contract.cjs');m._compile(v.contract,'/tmp/contract.cjs');const db=new Client(migrationConfig());await db.connect();try{console.log(JSON.stringify(await m.exports.capture(db,v.identity)));}finally{await db.end();}"""
def produce(source,attempt,runner=run,schema_root=pathlib.Path('/etc/workspacex-cn/baseline-schemas'),work_root=pathlib.Path('/var/lib/workspacex-cn/auto-baseline-schema')):
 require(re.fullmatch('[a-f0-9]{40}',source) and re.fullmatch('gha-[0-9]+-[0-9]+',attempt),'BASELINE_SCHEMA_IDENTITY')
 policy=json.loads(private('/etc/workspacex-cn/auto-preparation-policy.json'));pg_image=policy['environment']['postgresImage']
 require(re.fullmatch(r'(?:[^\s]+@)?sha256:[a-f0-9]{64}',pg_image),'BASELINE_POSTGRES_IMAGE')
 inspect=json.loads(runner(DOCKER+['inspect',*[f'workspacex-cn-{s}-1' for s in ('api','web','agent','sandbox')]]))
 require(len(inspect)==4 and all(v['State']['Running'] and v['Config']['Labels'].get('org.opencontainers.image.revision')==source for v in inspect),'BASELINE_RUNTIME_SOURCE')
 api=inspect[0];image=json.loads(runner(DOCKER+['image','inspect',api['Image']]))[0]
 require(image['Id']==api['Image'] and image['Config']['Labels'].get('org.opencontainers.image.revision')==source,'BASELINE_API_SOURCE')
 inventory=json.loads(runner(DOCKER+['exec','workspacex-cn-api-1','node','-e',INVENTORY]))
 require(inventory and all(re.fullmatch('[a-f0-9]{64}',v['checksum']) for v in inventory),'BASELINE_INVENTORY')
 inventory_hash=digest(json.dumps(inventory,separators=(',',':')).encode())
 output=schema_root/(source+'.json')
 if output.exists():
  old=json.loads(private(str(output)));require(old['baselineSha']==source and old['sourceInventorySha256']==inventory_hash,'BASELINE_SCHEMA_REPLAY_IDENTITY');return
 root=work_root;directory(root)
 # Apply the same conservative host headroom gate before even schema-only
 # containers start; later backup admission cannot protect this earlier stage.
 require_capacity(root)
 name='wsx-autob-'+digest((source+attempt).encode())[:20];owner=digest((source+attempt).encode())
 work=root/name;require(not work.exists() and not work.is_symlink(),'BASELINE_RECONCILIATION_REQUIRED');directory(work)
 password=secrets.token_hex(32);env=work/'postgres.env';jobenv=work/'migration.env'
 write(env,('POSTGRES_PASSWORD='+password+'\n').encode())
 write(jobenv,('\n'.join(['PGHOST=postgres','PGPORT=5432','PGDATABASE=workspacex','PGSSLMODE=disable','MIGRATION_DB_USER=postgres','MIGRATION_DB_PASSWORD='+password,'WORKSPACEX_DEPLOY_PROFILE=starter'])+'\n').encode())
 def d(*args,data=None,timeout=120):return runner(DOCKER+list(args),data,timeout)
 network=name+'-net'
 try:
  d('network','create','--internal','--label','wsx.auto.baseline='+owner,network)
  d('run','-d','--pull=never','--name',name+'-pg','--label','wsx.auto.baseline='+owner,'--network',network,'--network-alias','postgres','--memory','1536m','--cpus','1','--pids-limit','128','--env-file',str(env),pg_image)
  deadline=time.monotonic()+60
  while True:
   try:d('exec',name+'-pg','pg_isready','-h','127.0.0.1','-U','postgres',timeout=5);break
   except NotReady:require(time.monotonic()<deadline,'BASELINE_PG_NOT_READY');time.sleep(.25)
  d('exec','-i',name+'-pg','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres',data=b'CREATE ROLE app_rw LOGIN; CREATE ROLE app_diag_ro LOGIN; CREATE DATABASE workspacex;')
  command=['run','--rm','--pull=never','-i','--name',name+'-api','--label','wsx.auto.baseline='+owner,'--network',network,'--memory','1536m','--cpus','1','--pids-limit','128','--env-file',str(jobenv),'--entrypoint','node',api['Image'],'--import','tsx']
  d(*command,'src/infrastructure/db/migrate-cli.ts',timeout=600)
  contract=private('/usr/local/lib/workspacex-cn/cn-baseline-schema-contract.cjs',0o755).decode()
  envelope=json.loads(d(*command,'--input-type=module','-e',CAPTURE,data=json.dumps({'contract':contract,'identity':{'baselineSha':source,'sourceInventorySha256':inventory_hash}}).encode(),timeout=60))
  require(envelope['baselineSha']==source and envelope['sourceInventorySha256']==inventory_hash and envelope['scope']=='schema-only-isolated-baseline','BASELINE_SCHEMA_CAPTURE')
 finally:
  for cid in d('ps','-aq','--filter','label=wsx.auto.baseline='+owner).decode().split():
   v=json.loads(d('inspect',cid))[0];require(v['Config']['Labels'].get('wsx.auto.baseline')==owner,'BASELINE_CLEANUP_OWNER');d('rm','-f','-v',cid)
  require(not d('ps','-aq','--filter','label=wsx.auto.baseline='+owner).strip(),'BASELINE_CONTAINER_REMAINS')
  for net in d('network','ls','-q','--filter','label=wsx.auto.baseline='+owner).decode().split():
   v=json.loads(d('network','inspect',net))[0];require(v.get('Labels',{}).get('wsx.auto.baseline')==owner and not v.get('Containers'),'BASELINE_NETWORK_OWNER');d('network','rm',net)
  for f in (env,jobenv):f.unlink(missing_ok=True)
  work.rmdir()
 directory(output.parent);write(output,(json.dumps(envelope,separators=(',',':'))+'\n').encode())
if __name__=='__main__':
 try:
  require(os.geteuid()==0 and sys.platform=='linux' and len(sys.argv)==3,'BASELINE_SCHEMA_USAGE');require_lock()
  def interrupted(signum,frame):raise NotReady('BASELINE_SCHEMA_INTERRUPTED')
  for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,interrupted)
  produce(*sys.argv[1:]);print('CN_BASELINE_SCHEMA_REPLAYED')
 except BaseException:print('CN_BASELINE_SCHEMA_NOT_READY',file=sys.stderr);sys.exit(3)
