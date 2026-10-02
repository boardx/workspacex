"""Derive table/ledger expectations from fresh package migration evidence, not old SHA pins."""
import hashlib,json,re,os,sys
from pathlib import Path
from isolated_conservation_plan import private_bytes

def derive(source,extractor,runtime,source_hash,extractor_hash,runtime_hash,image):
 sha=source['sourceSha'];assert extractor['candidateSha']==sha and extractor['candidateUvLockSha256']==source['filesSha256']['apps/deep-agent-service/uv.lock']
 assert extractor['packageVersions']==source['expectedPackageVersions'] and extractor['sourceQueriesAttempted']==extractor['networkConnectionsAttempted']==0
 assert runtime['sourceQueriesAttempted']==runtime['networkConnectionsAttempted']==0
 versions={d['normalizedName']:d['version'] for d in runtime['distributions']};assert all(versions[n]==v for n,v in source['expectedPackageVersions'].items())
 plans={}
 for db,key,schema in [('workspacex_agent','checkpoint','public'),('workspacex_memory','memory','workspacex_memory')]:
  fact=extractor[key];migrations=fact['migrations'];texts=[m['sql'] for m in migrations]
  assert fact['migrationCount']==len(migrations)>0 and fact['expectedHistoryVersions']==list(range(len(migrations)))
  assert hashlib.sha256(json.dumps(texts,separators=(',',':')).encode()).hexdigest()==fact['orderedMigrationListSha256']
  tables=set()
  for i,m in enumerate(migrations):
   assert m['version']==i and hashlib.sha256(m['sql'].encode()).hexdigest()==m['sqlSha256']
   for match in re.finditer(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(',m['sql'],re.I):tables.add(match[1])
  history=fact['historyTable'];assert re.fullmatch('[a-z_][a-z0-9_]*',history);tables.add(history)
  assert tables
  plans[db]={'schemaVersion':1,'candidateSha':sha,'database':db,'runtimeManifestSha256':runtime_hash,'canonicalSetupSourceSha256':source_hash,'canonicalMigrationExtractorReceiptSha256':extractor_hash,'dependencyImageId':image,'orderedMigrationListSha256':fact['orderedMigrationListSha256'],'packageSetupSourceSha256':fact['setupSourceSha256'],'expectedCreatedTables':[{'schema':schema,'table':t,**({'mustBeEmpty':True} if t!=history else {})} for t in sorted(tables)],'ledgers':[{'schema':schema,'table':history,'versionColumn':'v','expectedVersions':[str(i) for i in range(len(migrations))]}]}
 return plans

def main(p):
 def read(name):
  r=p[name];raw=private_bytes(r['path'],r['sha256']);return json.loads(raw),r['sha256']
 source,sh=read('sourceManifest');extractor,eh=read('extractor');runtime,rh=read('runtime')
 plans=derive(source,extractor,runtime,sh,eh,rh,p['imageId']);out={}
 for db,plan in plans.items():
  raw=json.dumps(plan,separators=(',',':')).encode();path=Path(p['privateRoot'])/('canonical-plan-'+db+'.json');fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  out[db]={'path':str(path),'sha256':hashlib.sha256(raw).hexdigest()}
 return {'candidateSha':source['sourceSha'],'canonicalPlans':out,'prepared':False}
if __name__=='__main__':
 try:print(json.dumps(main(json.load(sys.stdin))))
 except BaseException:print('CANONICAL_PLAN_FACTORY_REJECTED',file=sys.stderr);sys.exit(1)
