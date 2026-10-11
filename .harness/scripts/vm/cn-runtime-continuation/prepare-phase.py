"""Local-only immutable phase materializer. No clocks invented, no cloud dispatch."""
import argparse,hashlib,json,re,importlib.util,datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('upgrade',ROOT/'upgrade-draft.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def raw(path):return Path(path).read_bytes()
def read(path):return json.loads(raw(path))
def hashfile(path):return hashlib.sha256(raw(path)).hexdigest()
def prepare(config):
 b=read(ROOT/'binding.template.json');a=read(config['authorization'])
 assert a['sourceRevision']==m.SOURCE and a['baselineRevision']==m.BASELINE
 assert a['scope']=='exact-five-runtime-upgrade-no-migration-no-dns-env-secret-topology-change'
 assert a['runtimeStartSideEffectsIncluded'] is True
 assert a.get('directUserEvidence'), 'DIRECT_TASK_AUTHORIZATION_EVIDENCE_REQUIRED'
 now=datetime.datetime.now(datetime.timezone.utc)
 assert datetime.datetime.fromisoformat(a['issuedAt'])<=now<datetime.datetime.fromisoformat(a['expiresAt']), 'FRESH_AUTHORIZATION_REQUIRED'
 assert a['issuedAt'] and a['expiresAt'] and re.fullmatch('[a-z0-9-]{1,64}',a['attemptId'])
 pub=read(config['publication']);assert pub['sourceRevision']==m.SOURCE
 images=pub['images'];assert {'api','web','agent','sandbox'}<=set(images)
 b['candidateImages']={s:images['sandbox'if s=='sandbox-sessions'else s]['image']for s in m.SERVICES}
 b.update(draft=False,authorizationEvidenceSha256=hashfile(config['authorization']),publicationReceiptSha256=hashfile(config['publication']),attemptId=a['attemptId'],issuedAt=a['issuedAt'],expiresAt=a['expiresAt'])
 evidence=ROOT.parent/'migration-diff-evidence.json';diff=read(evidence)
 assert diff['changedFiles']==[] and diff['sourceRevision']==m.SOURCE and diff['baselineRevision']==m.BASELINE and diff['schemaMigrationRequired'] is False
 b['migrationDiffEvidenceSha256']=hashfile(evidence)
 b['sessionsHelperSha256']=hashfile(ROOT/'sessions-after-stop.py');b['scriptSha256']=hashfile(ROOT/'upgrade-draft.py');b['backupHelperSha256']=hashfile(ROOT/'backup-host.DRAFT.py')
 phase=config['phase'];assert phase in ('hold','stop','backup','switch','rollback','abort-original')
 if phase!='hold':
  b['hold']=read(config['hold'])
  assert b['hold']['state']=='held' and b['hold']['identity']=={'sourceRevision':m.SOURCE,'baselineRevision':m.BASELINE,'attemptId':b['attemptId'],'migrationPlanSha256':b['migrationDiffEvidenceSha256']}
 if phase in ('backup','switch','rollback'):
  stop=read(config['stop']);assert stop['knownFiveStopped'] is True and stop['otherDatabaseClientSessions']==0 and stop['holdGeneration']==b['hold']['generation']
  b['stopReceiptSha256']=hashfile(config['stop'])
 if phase in ('switch','rollback'):
  host=read(config['hostBackup']);assert host['holdGeneration']==b['hold']['generation']
  b['hostBackupReceiptSha256']=hashfile(config['hostBackup'])
  provider=read(config['rdsBackup']);assert provider['holdGeneration']==b['hold']['generation'] and provider['backupStatus']=='Success' and provider['metaStatus']=='OK' and provider['dbInstanceId']=='pgm-uf6rg214cp381l49'
  assert datetime.datetime.fromisoformat(provider['backupStartTime'].replace('Z','+00:00'))>=datetime.datetime.fromisoformat(read(config['stop'])['finishedAt'].replace('Z','+00:00'))
  b['rdsBackupReceiptSha256']=hashfile(config['rdsBackup']);b['backupProviderObservationReviewed']=True
 m.validate_binding(b)
 out=Path(config['output']);out.mkdir(mode=0o700)
 values={'binding.json':b,'switch-images.json':{'services':{k:{'image':v}for k,v in b['candidateImages'].items()}},'rollback-images.json':{'services':{k:{'image':v}for k,v in b['rollbackImages'].items()}}}
 for name,value in values.items():
  p=out/name;p.write_text(json.dumps(value,sort_keys=True)+'\n');p.chmod(0o600)
 shell_raw=(ROOT/'sessions-after-stop.sh').read_bytes()
 assert b'FRESH_MIGRATION_ENV_SHA256_REQUIRED' not in shell_raw
 (out/'sessions-after-stop.sh').write_bytes(shell_raw);(out/'sessions-after-stop.sh').chmod(0o600)
 pins={'scriptSha256':hashfile(out/'sessions-after-stop.sh'),'bindingSha256':hashfile(out/'binding.json')}
 (out/'sessions-check-pins.json').write_text(json.dumps(pins,sort_keys=True)+'\n');(out/'sessions-check-pins.json').chmod(0o600)
 (out/'preparation.json').write_text(json.dumps({'phase':phase,'bindingSha256':hashfile(out/'binding.json'),'inputs':{k:hashfile(config[k])for k in ('authorization','publication')},'files':{n:hashfile(out/n)for n in values},'cloudCalls':0,'dispatchAuthorizedByGenerator':False},indent=2)+'\n')
 print(json.dumps({'phase':phase,'output':str(out),'bindingSha256':hashfile(out/'binding.json'),'cloudCalls':0}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('config');args=p.parse_args();prepare(read(args.config))
