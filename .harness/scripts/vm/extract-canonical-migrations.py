"""Read-only package evidence extractor. Run in pinned image, network=none, no secrets mounts."""
import os,sys,json,hashlib,inspect,importlib.metadata,socket
data=json.load(sys.stdin);manifest=json.load(open('/probe/canonical-source-manifest.json'));assert manifest['sourceSha']==data['candidateSha'];os.environ.clear()
# Any import-time connect is a hard failure; no DSN or server credential is loaded.
class ImportConnectionForbidden(RuntimeError):pass
attempts={'sql':0,'network':0}
def denied_network(*args,**kwargs):attempts['network']+=1;raise ImportConnectionForbidden('NETWORK_FORBIDDEN')
def denied(*args,**kwargs):attempts['sql']+=1;raise ImportConnectionForbidden('SQL_FORBIDDEN')
socket.socket.connect=denied_network;socket.socket.connect_ex=denied_network;socket.create_connection=denied_network
import psycopg
psycopg.connect=denied;psycopg.Connection.connect=classmethod(denied);psycopg.AsyncConnection.connect=classmethod(denied)
from langgraph.store.postgres import PostgresStore
from langgraph.checkpoint.postgres import PostgresSaver
expected=manifest['expectedPackageVersions']
versions={n:importlib.metadata.version(n) for n in expected};assert versions==expected,'LOCK_VERSION_MISMATCH'
def digest(b):return hashlib.sha256(b).hexdigest()
def package(c,history):
 migrations=c.MIGRATIONS;assert isinstance(migrations,list) and all(isinstance(x,str) for x in migrations)
 source_files={}
 for obj in [c,c.setup]:
  p=inspect.getsourcefile(obj);assert p and p.endswith('.py')
  with open(p,'rb') as f:b=f.read()
  source_files[p]={'bytes':len(b),'sha256':digest(b)}
 sql=[{'version':i,'sql':text,'sqlUtf8Bytes':len(text.encode()),'sqlSha256':digest(text.encode())} for i,text in enumerate(migrations)]
 return {'className':c.__name__,'historyTable':history,'expectedHistoryVersions':list(range(len(sql))),'migrationCount':len(sql),'migrations':sql,'orderedMigrationListSha256':digest(json.dumps(migrations,separators=(',',':')).encode()),'setupSourceSha256':digest(inspect.getsource(c.setup).encode()),'sourceFiles':source_files,'indexConfig':None if c is PostgresStore else 'not-applicable'}
result={'schemaVersion':1,'candidateSha':data['candidateSha'],'candidateUvLockSha256':manifest['filesSha256']['apps/deep-agent-service/uv.lock'],'packageVersions':versions,'sourceQueriesAttempted':0,'networkConnectionsAttempted':0,'runtimeEnvironmentRead':False,'productionReady':False,'memory':package(PostgresStore,'store_migrations'),'checkpoint':package(PostgresSaver,'checkpoint_migrations')}
assert attempts=={'sql':0,'network':0},'IMPORT_SIDE_EFFECT_ATTEMPTED'
print(json.dumps(result,separators=(',',':')))
