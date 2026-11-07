#!/usr/bin/env python3
"""Private PostgreSQL dump on the host retention disk. No passwords in argv/logs."""
import importlib.util,json,os,subprocess,sys,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('consumer',HERE/'deploy-registry-images.py');consumer=importlib.util.module_from_spec(spec);spec.loader.exec_module(consumer)
spec=importlib.util.spec_from_file_location('release_process',HERE/'unified-release-process.py');process=importlib.util.module_from_spec(spec);spec.loader.exec_module(process)
def backup(root):
 root=Path(root);cfg=json.loads(consumer.trusted(root/'config/release.json',private=True).read_bytes())
 consumer.trusted(cfg['migrationEnvFile'],private=True)
 directory=consumer.trusted(root/'backup',directory=True,private=True)
 target=directory/('database-'+uuid.uuid4().hex+'.dump');temporary=target.with_suffix('.partial')
 docker=cfg.get('docker','/usr/bin/docker');worker='wsx-unified-backup-'+uuid.uuid4().hex
 command=[docker,'run','--rm','--name',worker,'--network',cfg['network'],'--env-file',cfg['migrationEnvFile']]
 db=cfg['database']
 for name,value in [('HOST',db['host']),('PORT',db['port']),('NAME',db['name']),('USER',db['migrationUser'])]:command+=['--env','WSX_EXPECTED_'+name+'='+str(value)]
 for mount in cfg.get('databaseCertificateMounts',[]):
  consumer.trusted(mount['source'],directory=Path(mount['source']).is_dir())
  command+=['--mount','type=bind,source='+mount['source']+',target='+mount['target']+',readonly']
 image=cfg['backupImage'];consumer.registry.need('@sha256:' in image or consumer.engine.image_id(image),'BACKUP_IMAGE_DIGEST_REQUIRED')
 command+=['--entrypoint','/bin/sh',image,'-ec',
  'test "$PGHOST" = "$WSX_EXPECTED_HOST"; test "${PGPORT:-5432}" = "$WSX_EXPECTED_PORT"; test "$PGDATABASE" = "$WSX_EXPECTED_NAME"; test "$MIGRATION_DB_USER" = "$WSX_EXPECTED_USER"; export PGUSER="$MIGRATION_DB_USER" PGPASSWORD="$MIGRATION_DB_PASSWORD"; exec pg_dump --format=custom --no-password']
 try:
  fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'wb') as out:
   checked=process.run(command,stdout=out,stderr=subprocess.DEVNULL,timeout=600,env={'PATH':'/usr/bin:/bin:/usr/local/bin'})
   consumer.registry.need(checked.returncode==0,'DATABASE_BACKUP_FAILED');out.flush();os.fsync(out.fileno())
  consumer.registry.need(temporary.stat().st_size>0,'DATABASE_BACKUP_EMPTY');os.rename(temporary,target)
  fd=os.open(directory,os.O_RDONLY)
  try:os.fsync(fd)
  finally:os.close(fd)
  return {'status':'COMPLETE','path':str(target),'bytes':target.stat().st_size}
 finally:
  if temporary.exists():temporary.unlink()
  process.cleanup_container(docker,worker)
if __name__=='__main__':
 os.umask(0o077)
 try:print(json.dumps(backup('/srv/workspacex')))
 except Exception:print(json.dumps({'status':'FAILED','code':'DATABASE_BACKUP_FAILED'}));sys.exit(1)
