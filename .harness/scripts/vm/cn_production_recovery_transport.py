"""Real subprocess transport; credentials travel through stdin, errors are redacted."""
import json,os,subprocess,hashlib,pathlib,threading,time,re
from cn_production_recovery_executor import require,DBS,PRODUCTION
from cn_production_recovery_stream import stream
def closed_role_restore_sql(raw,writer_plan,plan):
 """Admission-preserving subset only; never execute a supplied role dump.
 Existing fenced roles may only be reasserted NOLOGIN. CREATE, LOGIN, grants,
 passwords, other attributes, metacommands and procedural SQL are unsupported.
 """
 from writer_fence import validate_admission_plan,digest
 validate_admission_plan(writer_plan)
 require(writer_plan.get('identity')==plan['identity'] and digest(writer_plan)==plan['writerPlanCanonicalSha256'],'ROLE_RESTORE_WRITER_BINDING')
 targets=set().union(*[set(writer_plan['databaseWriterRoles'][db]) for db in DBS])
 require(all(targets<=set(item['completeClusterRoleNames']) for item in plan['databases'].values()),'ROLE_RESTORE_CLUSTER_SCOPE')
 require(type(raw) is bytes and 0<len(raw)<=65536,'ROLE_RESTORE_INPUT_BOUND')
 try:text=raw.decode('utf8')
 except UnicodeError:raise RuntimeError('ROLE_RESTORE_SQL_UNSUPPORTED') from None
 pattern=re.compile(r'\s*ALTER\s+ROLE\s+("(?:[^"\r\n\x00]|"")+")\s+(?:WITH\s+)?NOLOGIN\s*;',re.I)
 offset=0;seen=set()
 while text[offset:].strip():
  match=pattern.match(text,offset);require(match is not None,'ROLE_RESTORE_SQL_UNSUPPORTED')
  role=match[1][1:-1].replace('""','"')
  require(role in targets and role not in seen,'ROLE_RESTORE_ROLE_SCOPE')
  seen.add(role);offset=match.end()
 require(seen==targets,'ROLE_RESTORE_ROLE_CLOSURE')
 # Emit fixed statements; original SQL bytes never reach psql.
 return ''.join('ALTER ROLE "'+role.replace('"','""')+'" NOLOGIN;\n' for role in sorted(targets)).encode()

class Transport:
 def __init__(self,protected,lockcheck):self.protected=protected;self.lockcheck=lockcheck
 def require_lock(self):self.lockcheck()
 def inherited(self):
  try:os.fstat(9);return (9,)
  except OSError:return ()
 def invoke(self,args,raw=None):
  return stream(['/bin/cat'],args,raw or b'',pass_fds=self.inherited())
 def guard(self,p):
  return json.loads(self.invoke(['/usr/bin/python3',p['writerTransport']['path'],'--apply-reviewed-fence',p['writerPlan']['path'],p['writerPlan']['sha256'],'verifyWritesBlocked']))
 def capability(self,p):
  for name in ('writerTransport','writerPlan','recipientCertificate','recipientKey','rolesSql','credential','fidelityRunner','catalogModule','fidelityModule','caCertificate','productionIdentityProbe'):
   self.protected.read(p[name]['path'],p[name]['sha256'],private=name in ('recipientKey','credential','rolesSql','writerPlan'))
  self.role_restore(p) # Validate the whole role input before any container/DB operation.
  for item in p['databases'].values():
   self.protected.bind_large(item['ciphertext']['path'],item['ciphertext']['sha256'],item['ciphertext']['bytes']);self.protected.read(item['sourceCatalog']['path'],item['sourceCatalog']['sha256'])
  image=json.loads(self.invoke(['/usr/bin/docker','image','inspect',p['clientImage']]))
  require(len(image)==1 and image[0]['Id']==p['clientImage'] and image[0]['Os']=='linux' and image[0]['Architecture']=='amd64','CLIENT_IMAGE_IDENTITY')
  credential=json.loads(self.protected.read(p['credential']['path'],private=True))
  require(credential['user']=='migration_admin' and type(credential['port']) is int and credential['port']==5432 and all('\n' not in str(v) and '\r' not in str(v) for v in credential.values()),'CREDENTIAL_FORMAT')
  require(credential['host']==p['production']['hostname'] and credential['instanceId']==PRODUCTION and credential['sslmode']=='verify-full','CREDENTIAL_IDENTITY')
  for binary in ('/usr/bin/docker','/usr/bin/openssl'):require(os.path.isfile(binary) and os.access(binary,os.X_OK),'TRANSPORT_UNAVAILABLE')
  require(image[0]['Config'].get('Labels',{})==p['clientImageLabels'],'CLIENT_SOURCE_LABELS')
  network=json.loads(self.invoke(['/usr/bin/docker','network','inspect',p['networkId']]))
  require(len(network)==1 and network[0]['Id']==p['networkId'] and network[0]['Driver']=='bridge','NETWORK_IDENTITY')
  certificate=self.invoke(['/usr/bin/openssl','x509','-in',p['recipientCertificate']['path'],'-pubkey','-noout'])
  key=self.invoke(['/usr/bin/openssl','pkey','-in',p['recipientKey']['path'],'-pubout'])
  require(certificate==key,'RECIPIENT_KEY_PAIR')
  probe="node -e 'const pg=require(\"pg\");const c=require(\"/opt/wsx/cn-production-recovery-catalog.cjs\");const f=require(\"/opt/wsx/cn-production-recovery-fidelity.cjs\");const r=require(\"/opt/wsx/recovery-readback.cjs\");if(typeof pg.Client!==\"function\"||typeof c.capture!==\"function\"||typeof f.main!==\"function\"||typeof r.run!==\"function\")process.exit(1);console.log(JSON.stringify({node:process.versions.node}))'; pg_restore --version; pg_dump --version; psql --version"
  lines=self.container(p,probe,self.secret(p,'postgres')).decode().splitlines()
  require(len(lines)==4 and int(json.loads(lines[0])['node'].split('.')[0])>=20,'NODE_RUNTIME_REQUIRED')
  import re
  versions=[re.fullmatch(r'(pg_restore|pg_dump|psql) \(PostgreSQL\) (\d+)(?:\.[0-9]+)*',x) for x in lines[1:]]
  require(all(versions),'POSTGRES_RUNTIME_REQUIRED')
  major=[int(m[2]) for m in versions]
  require(len(set(major))==1 and major[0]==p['clientPostgresMajor'] and all(major[0]>=int(v['serverVersionNum'])//10000 for v in p['databases'].values()),'POSTGRES_VERSION_INCOMPATIBLE')
  actual=json.loads(self.invoke(['/usr/bin/python3','-I',p['productionIdentityProbe']['path'],'--read-only',PRODUCTION]))
  require(actual['kind']=='actual-rds-identity' and actual['instanceId']==PRODUCTION and actual['connectionString']==p['production']['hostname'] and actual['regionId']==p['production']['regionId'] and actual['engine']=='PostgreSQL' and 0<=time.time()-actual['observedAt']<=30,'ACTUAL_PROVIDER_IDENTITY')
  self.protected.recheck()

 def container(self,p,command,raw,db=None,archive=None):
  # Secret JSON remains solely stdin. Private tmpfs pgpass is removed on EXIT.
  shell=r"""set -euo pipefail
umask 077
trap 'rm -f /run/wsx/pgpass' EXIT
IFS= read -r header
export PGHOST PGPORT PGUSER PGDATABASE PGSSLMODE PGSSLROOTCERT PGPASSFILE
readarray -t fields < <(printf '%s' "$header" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const v=JSON.parse(s);for(const k of ["host","port","user","database","sslmode"])console.log(v[k]);require("fs").writeFileSync("/run/wsx/pgpass",[v.host,v.port,"*",v.user,v.password].map(x=>String(x).replace(/\\/g,"\\\\").replace(/:/g,"\\:")).join(":"),{mode:384})})')
PGHOST=${fields[0]};PGPORT=${fields[1]};PGUSER=${fields[2]};PGDATABASE=${fields[3]};PGSSLMODE=${fields[4]};PGPASSFILE=/run/wsx/pgpass;PGSSLROOTCERT=/run/wsx/ca.pem
"""+command
  mounts=[]
  for key,target in [('caCertificate','/run/wsx/ca.pem'),('fidelityRunner','/opt/wsx/recovery-readback.cjs'),('catalogModule','/opt/wsx/cn-production-recovery-catalog.cjs'),('fidelityModule','/opt/wsx/cn-production-recovery-fidelity.cjs')]:
   mounts+=['--mount','type=bind,src='+p[key]['path']+',dst='+target+',readonly']
  if db:mounts+=['--mount','type=bind,src='+p['databases'][db]['sourceCatalog']['path']+',dst=/opt/wsx/source-catalog.json,readonly']
  name='wsx-production-recovery-'+os.urandom(16).hex()
  try:
   args=['/usr/bin/docker','run','--rm','--name',name,'-i','--network',p['networkId'],'--read-only','--tmpfs','/run/wsx:rw,noexec,nosuid,size='+str(p['spoolBytes']),*mounts,'--env','NODE_PATH=/app/node_modules',p['clientImage'],'bash','-c',shell]
   return self.pipeline(args,raw,p,archive) if archive else self.invoke(args,raw)
  finally:subprocess.run(['/usr/bin/docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30,pass_fds=self.inherited())
 def secret(self,p,db):
  c=json.loads(self.protected.read(p['credential']['path'],private=True));c['database']=db
  return (json.dumps(c,separators=(',',':'))+'\n').encode()
 def pipeline(self,args,prefix,p,db):
  a=p['databases'][db]['ciphertext'];self.protected.bind_large(a['path'],a['sha256'],a['bytes'])
  fd=os.open(a['path'],os.O_RDONLY|os.O_NOFOLLOW)
  try:return stream(['/usr/bin/openssl','cms','-decrypt','-binary','-inform','DER','-recip',p['recipientCertificate']['path'],'-inkey',p['recipientKey']['path']],args,prefix,producer_input=fd)
  finally:os.close(fd);self.protected.recheck()
 def role_restore(self,p):
  raw=self.protected.read(p['rolesSql']['path'],p['rolesSql']['sha256'],private=True)
  writer=json.loads(self.protected.read(p['writerPlan']['path'],p['writerPlan']['sha256'],private=True))
  return closed_role_restore_sql(raw,writer,p)
 def apply(self,kind,db,p):
  if kind=='restore-roles':
   sql=self.role_restore(p)
   self.container(p,'psql --no-password --set=ON_ERROR_STOP=1 --single-transaction --quiet >/dev/null',self.secret(p,'postgres')+sql)
  elif kind=='restore-database':
   require(db in DBS,'DATABASE_SCOPE')
   self.container(p,'pg_restore --no-password --exit-on-error --clean --if-exists --create --dbname=postgres >/dev/null',self.secret(p,'postgres'),archive=db)
  else:raise RuntimeError('ACTION_SCOPE')
 def fidelity(self,db,p):
  # Runner receives metadata/credentials and original archive privately over stdin.
  request={'schemaVersion':1,'plan':p,'database':db,'credential':json.loads(self.protected.read(p['credential']['path'],private=True))}
  raw=(json.dumps(request)+'\n').encode()
  return json.loads(self.container(p,'node /opt/wsx/recovery-readback.cjs',self.secret(p,db)+raw,db,archive=db))
