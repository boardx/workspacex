"""Fixed existing source memory tool, clone-only fresh schema, no cloud lifecycle."""
import hashlib,json,os,sys,time,math,signal,tempfile
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
SOURCE='5285bef9a6c91bbb9857ede42779aafa64b98f32'
DEPLOYMENT_SHA='aadf8c7546baf5d361273d95519ee7a7b5753dfdcc7167c2db16f3d5b7ff2cda'
KEYS=('accountId','regionId','attemptId','candidateSha','targetInstanceId','providerCreatedUtc','peerSha256')
def need(ok,code):
 if not ok:raise ValueError(code)
def remaining(p):
 v=(p['deadlineEpoch'],p['monotonicDeadline']);need(all(type(x)in(int,float) and math.isfinite(x) for x in v),'DEADLINE')
 left=min(v[0]-time.time(),v[1]-time.monotonic());need(left>0,'EXPIRED');return left

def fingerprint(c):
 h=hashlib.sha256();n=0
 # Only hashes/counts leave this process; never output historical JSON or DSNs.
 with c.cursor() as cur:
  cur.execute('SELECT to_jsonb(t)::text FROM workspacex_memory.store t ORDER BY to_jsonb(t)::text')
  for row in cur:
   raw=row[0].encode();h.update(len(raw).to_bytes(8,'big'));h.update(raw);n+=1
 return n,h.hexdigest()

def execute(p,deployment):
 remaining(p);b=p['binding'];s=p['secret'];mode=p.get('mode','check');schema=p['schema']
 need(mode in ('check','prepare') and b['candidateSha']==SOURCE and b['targetInstanceId']!='pgm-uf6rg214cp381l49' and b['host']==b['targetInstanceId']+'.rwlb.rds.aliyuncs.com','TARGET')
 need(schema=='wsx_fixture_'+b['attemptId'].replace('-',''),'SCHEMA')
 need(all(s.get(k)==b[k] for k in ('host','targetInstanceId','attemptId','peer','peerSha256','providerCreatedUtc')) and type(s['ownerPassword'])is str and type(s['runtimePassword'])is str,'SECRET_BINDING')
 tls=b['tls'];need(tls['sslmode'] in ('verify-full','disable'),'TLS');ca=None
 kw=dict(host=b['host'],hostaddr=b['peer'],port=5432,dbname='workspacex_memory',sslmode=tls['sslmode'],connect_timeout=5,options='-c statement_timeout=5000 -c lock_timeout=5000')
 if tls['sslmode']=='verify-full':
  need(hashlib.sha256(p['caPem'].encode()).hexdigest()==tls['ca']['sha256'],'CA')
  ca=tempfile.NamedTemporaryFile(mode='w',delete=False);ca.write(p['caPem']);ca.close();kw['sslrootcert']=ca.name
 else:need(tls.get('approvedException')=='aliyun-postgresql-serverless-no-tls','TLS_EXCEPTION')
 oldenv=dict(os.environ)
 try:
  owner=make_conninfo(**kw,user='memory_owner',password=s['ownerPassword']);runtime=make_conninfo(**kw,user='memory_rw',password=s['runtimePassword'])
  with psycopg.connect(owner,autocommit=True) as c:
   actual=c.execute('SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port(),rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user').fetchone()
   need(actual==('workspacex_memory','memory_owner',b['peer'],5432,False,False,False),'ACTUAL_OWNER')
   # No implicit reuse or second schema after partial/unknown preparation.
   need(c.execute('SELECT count(*) FROM pg_namespace WHERE nspname=%s',(schema,)).fetchone()[0]==0,'SCHEMA_ALREADY_EXISTS')
   before=fingerprint(c)
   os.environ.clear();os.environ.update(MEMORY_STORE_DATABASE_URL=runtime,MEMORY_STORE_MIGRATION_DATABASE_URL=owner,MEMORY_STORE_SCHEMA=schema)
   with deployment._connect(runtime) as rc:
    identity=deployment._runtime_role(rc);need(identity['database']=='workspacex_memory' and identity['username']=='memory_rw','ACTUAL_RUNTIME')
   if mode=='prepare':
    remaining(p);deployment.prepare_memory_store();remaining(p)
    fresh=c.execute(sql.SQL('SELECT count(*) FROM {}.store').format(sql.Identifier(schema))).fetchone()[0];need(fresh==0,'FRESH_NOT_EMPTY')
    need(c.execute('SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=%s',(schema,)).fetchone()==('memory_owner',),'SCHEMA_OWNER')
   else:fresh=None
   after=fingerprint(c);need(before==after,'ORIGINAL_MEMORY_CHANGED');remaining(p)
   return {'kind':'clone-fresh-memory-result-v1','binding':{k:b[k] for k in KEYS},'schema':schema,'prepared':mode=='prepare','a3Accepted':False,'originalRows':before[0],'originalSha256':before[1],'freshRows':fresh}
 finally:
  os.environ.clear();os.environ.update(oldenv)
  if ca:os.unlink(ca.name)

def main():
 p=json.load(sys.stdin)
 # Immutable source image has src on PYTHONPATH, which -I correctly ignores.
 path=Path('/app/src/deep_agent_service/memory_deployment.py')
 need(hashlib.sha256(path.read_bytes()).hexdigest()==DEPLOYMENT_SHA,'EXACT_SOURCE_TOOL')
 sys.path.insert(0,'/app/src')
 from deep_agent_service import memory_deployment
 def expired(*args):raise TimeoutError('MEMORY_EXPIRED')
 signal.signal(signal.SIGALRM,expired);signal.signal(signal.SIGTERM,expired)
 signal.setitimer(signal.ITIMER_REAL,min(90,remaining(p)))
 try:print(json.dumps(execute(p,memory_deployment)))
 finally:signal.setitimer(signal.ITIMER_REAL,0)
if __name__=='__main__':
 try:main()
 except BaseException:print('CLONE_FRESH_MEMORY_REJECTED',file=sys.stderr);sys.exit(1)
