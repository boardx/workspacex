"""Candidate only: run in reviewed immutable Python image with exact source mounted readonly.
stdin JSON carries target-only independent role configs; never shell env or argv passwords.
External root supervisor owns exact container/network cleanup and <=180s deadline.
"""
import sys,json,os,hashlib,importlib.util,datetime
TARGET=HOST=ATTEMPT=PEER=None
def config(c,role):
 assert c.get('instanceId')==TARGET and c.get('attemptId')==ATTEMPT and c.get('host')==HOST and c.get('port')==5432 and c.get('user')==role and c.get('sslmode')==data['binding']['tls']['sslmode'] and (c.get('sslmode')=='verify-full' or c.get('transportException')=='aliyun-postgresql-serverless-no-tls') and isinstance(c.get('password'),str) and len(c['password'])>=16
 return c
try:
 import psycopg
 from psycopg.conninfo import make_conninfo,conninfo_to_dict
 data=json.load(sys.stdin);binding=data['binding'];plan=data['plan'];assert plan['frozen'] is True and plan['prepared'] is True and plan['candidateSha']==binding['candidateSha'];TARGET=binding['targetInstanceId'];HOST=binding['host'];ATTEMPT=binding['attemptId'];PEER=binding['peerSha256'];assert TARGET!=binding['sourceInstanceId'] and HOST==TARGET+'.rwlb.rds.aliyuncs.com';assert data['sourceSha']==binding['candidateSha']

 # These are real prior evidence bytes mounted by the root supervisor, not synthesized receipts.
 evidence={
  'canonicalSetupSourceSha256':('/probe/canonical-source-manifest.json',data['canonicalSetupSourceSha256']),
  'canonicalMigrationExtractorReceiptSha256':('/probe/canonical-extractor.json',data['canonicalMigrationExtractorReceiptSha256']),
 }
 provenance={}
 for key,(path,expected) in evidence.items():
  with open(path,'rb') as f:raw=f.read()
  assert hashlib.sha256(raw).hexdigest()==expected
  provenance[key]=expected
 sourceManifest=json.loads(open(evidence['canonicalSetupSourceSha256'][0]).read())
 extractor=json.loads(open(evidence['canonicalMigrationExtractorReceiptSha256'][0]).read())
 assert sourceManifest['sourceSha']==data['sourceSha']==extractor['candidateSha']
 assert extractor['sourceQueriesAttempted']==0 and extractor['networkConnectionsAttempted']==0
 import importlib.metadata
 for package,version in extractor['packageVersions'].items():assert importlib.metadata.version(package)==version
 for relative,digest in sourceManifest['filesSha256'].items():
  assert relative.startswith('apps/deep-agent-service/') and '..' not in relative.split('/')
  with open('/exact/'+relative,'rb') as f:assert hashlib.sha256(f.read()).hexdigest()==digest

 # Full immutable runtime manifest is bound in stdin by the reviewed root launcher.
 runtimePath='/probe/python-runtime-manifest.json'
 with open(runtimePath,'rb') as f:runtimeBytes=f.read()
 runtimeHash=hashlib.sha256(runtimeBytes).hexdigest()
 assert len(data['pythonRuntimeManifestSha256'])==64 and runtimeHash==data['pythonRuntimeManifestSha256']
 runtimeManifest=json.loads(runtimeBytes)
 assert runtimeManifest['schemaVersion']==1 and runtimeManifest['networkConnectionsAttempted']==0 and runtimeManifest['sourceQueriesAttempted']==0
 import re
 installed=[]
 for dist in importlib.metadata.distributions():
  name=dist.metadata['Name'];version=dist.version;assert name and version
  installed.append({'name':name,'normalizedName':re.sub(r'[-_.]+','-',name).lower(),'version':version})
 installed.sort(key=lambda row:row['normalizedName'])
 assert len({row['normalizedName'] for row in installed})==len(installed)
 assert runtimeManifest['distributionCount']==len(installed) and runtimeManifest['distributions']==installed
 provenance['pythonRuntimeManifestSha256']=runtimeHash
 provenance['canonicalMigrationExtractorInvokeId']=data['canonicalMigrationExtractorInvokeId']
 provenance['dependencyImageId']=data['dependencyImageId'];assert re.fullmatch('sha256:[a-f0-9]{64}',data['dependencyImageId'])
 assert data['dependencyImageId']==provenance['dependencyImageId']
 # Fail before any SQL when target independent credentials are unavailable.
 def provider():
  v=data['provider'];assert v['accountId']=='1177216024653153' and v['regionId']=='cn-shanghai' and v['instanceId']==TARGET and v['attemptId']==ATTEMPT and v['host']==HOST and v['port']==5432 and v['peerSha256']==PEER and v['providerVerified'] is True
  age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(v['observedUtc'].replace('Z','+00:00'))).total_seconds();assert 0<=age<=120
 provider()
 owner=config(data['memoryOwner'],'memory_owner');runtime=config(data['memoryRuntime'],'memory_rw');graph=config(data['checkpointOwner'],'graph_owner')
 exact='/exact/apps/deep-agent-service/src/deep_agent_service/'
 hashes={name:plan['canonicalSourceFiles'][name] for name in ['memory_deployment.py','postgres_checkpointer.py']}
 for name,digest in hashes.items():
  with open(exact+name,'rb') as f:assert hashlib.sha256(f.read()).hexdigest()==digest
 original=psycopg.Connection.connect.__func__;connections=0
 def bound(cls,conninfo='',**kw):
  global connections
  parsed=conninfo_to_dict(conninfo,**{k:v for k,v in kw.items() if k in ['host','port','dbname','user','password','sslmode','sslrootcert']})
  roles={'workspacex_memory':{'memory_owner','memory_rw'},'workspacex_agent':{'graph_owner'}}
  assert parsed.get('host')==HOST and str(parsed.get('port'))=='5432' and parsed.get('user') in roles.get(parsed.get('dbname'),set()) and parsed.get('sslmode')==binding['tls']['sslmode']
  c=original(cls,conninfo,**kw)
  try:
   assert hashlib.sha256(c.pgconn.hostaddr.decode().encode()).hexdigest()==PEER
   if binding['tls']['sslmode']=='verify-full':assert parsed.get('sslrootcert')=='/probe/rds-ca.pem' and c.pgconn.ssl_in_use
   with c.cursor() as cur:
    cur.execute('BEGIN READ ONLY');cur.execute("SELECT current_database(),current_user,current_setting('transaction_read_only')");row=cur.fetchone()
    if isinstance(row,dict):row=tuple(row.values())
    assert row==(parsed['dbname'],parsed['user'],'on');cur.execute('ROLLBACK')
   connections+=1;return c
  except BaseException:c.close();raise
 psycopg.Connection.connect=classmethod(bound)
 # psycopg.connect may be a previously bound alias; route it through guarded classmethod too.
 psycopg.connect=lambda *a,**kw:psycopg.Connection.connect(*a,**kw)
 def dsn(c,db):return make_conninfo(host=HOST,port=5432,dbname=db,user=c['user'],password=c['password'],sslmode=binding['tls']['sslmode'],**({'sslrootcert':'/probe/rds-ca.pem'} if binding['tls']['sslmode']=='verify-full' else {}))
 os.environ.clear();os.environ['MEMORY_STORE_DATABASE_URL']=dsn(runtime,'workspacex_memory');os.environ['MEMORY_STORE_MIGRATION_DATABASE_URL']=dsn(owner,'workspacex_memory');os.environ['MEMORY_STORE_SCHEMA']='workspacex_memory'
 def load(name):
  s=importlib.util.spec_from_file_location('isolated_'+name,exact+name+'.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
 memory=load('memory_deployment');provider();r1=memory.prepare_memory_store();provider();r2=memory.prepare_memory_store();assert r1['memoryPrepared'] and r2['memoryPrepared']
 checkpoint=load('postgres_checkpointer');provider();provider();saver=checkpoint.AsyncCompatiblePostgresSaver.connect(dsn(graph,'workspacex_agent'));saver.close();provider();saver=checkpoint.AsyncCompatiblePostgresSaver.connect(dsn(graph,'workspacex_agent'));saver.close()
 print(json.dumps(dict(provenance, schemaVersion=1,attemptId=ATTEMPT,targetInstanceId=TARGET,candidateSha=data['sourceSha'],finishedAtMs=int(datetime.datetime.now(datetime.timezone.utc).timestamp()*1000),allCanonicalSetupsAccepted=True,force=False,seed=False,sourceMutation=False,memoryPreparedTwice=True,memoryRuntimeReadinessVerified=True,checkpointSetupTwice=True,connectionPeerIdentityChecks=connections,productionReady=False,fullAgentRuntimeBootstrapVerified=False)))
except BaseException:
 print(json.dumps({'ok':False,'reason':'ISOLATED_PYTHON_STATE_SETUP_FAILED','productionReady':False}),file=sys.stderr);sys.exit(1)
