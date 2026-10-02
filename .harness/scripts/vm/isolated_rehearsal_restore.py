#!/usr/bin/env python3
"""Three-database CMS stream restore, target pinned through container host mapping.
Adapted from reviewed round-one target-restore-main.py stream/cleanup pattern.
"""
import signal
import hashlib,json,os,stat,subprocess,sys,threading,uuid
from pathlib import Path
from isolated_rehearsal import DBS,validate_binding,private_json,trusted_bytes
CLIENT=r'''set -euo pipefail
umask 077
read -r PGHOST; read -r PGDATABASE; read -r PGUSER; read -r password; read -r PGSSLMODE
export PGHOST PGDATABASE PGUSER PGSSLMODE PGPORT=5432 PGCONNECT_TIMEOUT=5 PGPASSFILE=/run/wsx/pgpass
escape(){ local v=$1; v=${v//\\/\\\\}; v=${v//:/\\:}; printf '%s' "$v"; }
{ escape "$PGHOST"; printf ':5432:'; escape "$PGDATABASE"; printf ':'; escape "$PGUSER"; printf ':'; escape "$password"; printf '\n'; } > "$PGPASSFILE"
unset password; chmod 600 "$PGPASSFILE"; trap 'rm -f "$PGPASSFILE"' EXIT
export PGOPTIONS='-c statement_timeout=300000 -c lock_timeout=5000'
test "$(psql -XAt --no-password -c 'SELECT current_database() || chr(124) || current_user')" = "$PGDATABASE|$PGUSER"
test "$(psql -XAt --no-password -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'")" = 0
pg_restore --exit-on-error --single-transaction --no-password --dbname="$PGDATABASE"
'''
def capture(args):return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=True,timeout=30).stdout
def hashfile(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(131072),b''):h.update(block)
 return h.hexdigest()
def run(p):
 b=p['binding'];s=p['secret'];validate_binding(b)
 if any(s[k]!=b[k] for k in ('targetInstanceId','attemptId','host','peer')):raise ValueError('SECRET_BINDING')
 spec=b['restore'];image=spec['clientImage'];metadata=json.loads(capture(['docker','image','inspect',image]))
 if len(metadata)!=1 or metadata[0]['Id']!=image or metadata[0]['Os']!='linux' or metadata[0]['Architecture']!='amd64':raise ValueError('ACTUAL_CLIENT_IMAGE')
 network=json.loads(capture(['docker','network','inspect',spec['isolatedNetwork']]))
 if len(network)!=1 or network[0]['Id']!=spec['isolatedNetwork'] or network[0]['Driver']!='bridge' or network[0].get('Labels',{}).get('wsx.rehearsal.owner')!=b['attemptId']:raise ValueError('ISOLATED_NETWORK_OWNER')
 if b['tls']['sslmode']=='verify-full':
  ca=b['tls']['ca'];trusted_bytes(ca['path'],ca['sha256'])
  spec=dict(spec,caCertificatePath=ca['path'],caCertificateSha256=ca['sha256'])
 # Source snapshots are immutable externally hashed manifests, not new guessed values.
 cert=Path(spec['recipientCertificatePath']);key=Path(spec['recipientKeyPath'])
 for path in (cert,key):
  st=path.lstat()
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_mode&0o077:raise ValueError('PRIVATE_RECIPIENT')
 if hashfile(cert)!=spec['recipientCertificateSha256']:raise ValueError('RECIPIENT_HASH')
 if capture(['openssl','pkey','-in',str(key),'-pubout'])!=capture(['openssl','x509','-in',str(cert),'-pubkey','-noout']):raise ValueError('RECIPIENT_PAIR')
 # Parameterized reviewed round-one database preparation verifies actual TCP peer.
 helper=Path(spec['databasePreparationPath'])
 helper_bytes=trusted_bytes(helper,spec['databasePreparationSha256'])
 api=spec['apiClientImage'];meta=json.loads(capture(['docker','image','inspect',api]))
 if spec['apiClientSourceSha']!=b['candidateSha'] or len(meta)!=1 or meta[0]['Id']!=api or meta[0]['Os']!='linux' or meta[0]['Architecture']!='amd64' or meta[0]['Config']['Labels'].get('org.opencontainers.image.revision')!=b['candidateSha']:raise ValueError('API_CLIENT_SOURCE')
 for env in meta[0]['Config'].get('Env',[]):
  name,_,value=env.partition('=')
  if value and any(x in name.upper() for x in ('PASSWORD','SECRET','TOKEN','API_KEY','DATABASE_URL')):raise ValueError('BAKED_SECRET')
 prepname='wsx-isolated-prepare-'+uuid.uuid4().hex
 args=['docker','run','--rm','--pull=never','--name',prepname,'--label','wsx.rehearsal.owner='+prepname,'-i','--network',spec['isolatedNetwork'],'--add-host',b['host']+':'+b['peer'],'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=256m','--pids-limit=64']
 if b['tls']['sslmode']=='verify-full':args+=['--mount','type=bind,src='+spec['caCertificatePath']+',dst=/run/ca.pem,readonly']
 process=None
 try:
  process=subprocess.Popen(args+['--entrypoint','node',api,'-e',helper_bytes.decode()],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
  output,_=process.communicate(json.dumps(p).encode(),timeout=120)
  if process.returncode!=0 or len(output)>65536:raise ValueError('DATABASE_PREPARATION_FAILED')
  prepared=json.loads(output)
  if prepared.get('targetId')!=b['targetInstanceId'] or len(prepared.get('databases',[]))!=3:raise ValueError('DATABASE_PREPARATION_RECEIPT')
 finally:
  if process and process.poll() is None:process.kill();process.wait(timeout=15)
  result=subprocess.run(['docker','inspect',prepname],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15)
  if result.returncode==0:
   item=json.loads(result.stdout)
   if len(item)!=1 or item[0]['Config']['Labels'].get('wsx.rehearsal.owner')!=prepname:raise ValueError('PREPARE_CLEANUP_OWNER')
   capture(['docker','rm','-f',item[0]['Id']])
 for db in DBS:
  backup=spec['databases'][db];receipt=private_json(Path(backup['receiptPath']))
  if hashfile(Path(backup['receiptPath']))!=backup['receiptSha256'] or receipt['database']!=db or receipt['sourceRdsInstanceId']!=b['sourceInstanceId'] or not receipt['cleanupVerified'] or receipt['dumpExit']!=0 or receipt['encryptionExit']!=0 or receipt['recipientCertificateSha256']!=spec['recipientCertificateSha256']:raise ValueError('IMMUTABLE_BACKUP_BINDING')
  cipher=Path(backup['ciphertextPath']);st=cipher.lstat()
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_mode&0o077 or hashfile(cipher)!=receipt['ciphertextSha256'] or st.st_size!=receipt['bytes']:raise ValueError('CIPHER_HASH')
  name='wsx-isolated-restore-'+uuid.uuid4().hex;processes=[];errors=[];thread=None
  try:
   args=['docker','run','--rm','--pull=never','--name',name,'--label','wsx.rehearsal.owner='+name,'-i','--network',spec['isolatedNetwork'],'--add-host',b['host']+':'+b['peer'],'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=512m','--pids-limit=128','--tmpfs','/run/wsx:rw,noexec,nosuid,nodev,size=16m,mode=0700']
   if b['tls']['sslmode']=='verify-full':args+=['--mount','type=bind,src='+spec['caCertificatePath']+',dst=/run/ca.pem,readonly','--env','PGSSLROOTCERT=/run/ca.pem']
   consumer=subprocess.Popen(args+['--entrypoint','bash',image,'-c',CLIENT],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);processes.append(consumer)
   fields=[s['host'],db,s['user'],s['password'],b['tls']['sslmode']]
   if any(any(c in v for c in '\r\n\0') for v in fields):raise ValueError('CLIENT_INPUT_SHAPE')
   consumer.stdin.write(('\n'.join(fields)+'\n').encode());consumer.stdin.flush()
   decrypt=subprocess.Popen(['openssl','cms','-decrypt','-binary','-inform','DER','-in',str(cipher),'-recip',str(cert),'-inkey',str(key)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL);processes.append(decrypt)
   def pump():
    try:
     for block in iter(lambda:decrypt.stdout.read(131072),b''):consumer.stdin.write(block)
     consumer.stdin.close()
    except BaseException:errors.append(True);decrypt.kill()
   thread=threading.Thread(target=pump,daemon=True);thread.start()
   if consumer.wait(timeout=900)!=0:raise ValueError('RESTORE_FAILED')
   thread.join(timeout=30)
   if thread.is_alive() or errors or decrypt.wait(timeout=30)!=0:raise ValueError('DECRYPT_STREAM_FAILED')
  finally:
   for proc in processes:
    if proc.poll() is None:proc.kill()
   for proc in processes:proc.wait(timeout=15)
   if thread:thread.join(timeout=15)
   result=subprocess.run(['docker','inspect',name],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15)
   if result.returncode==0:
    item=json.loads(result.stdout)
    if len(item)!=1 or item[0]['Config']['Labels'].get('wsx.rehearsal.owner')!=name:raise ValueError('OWNED_CLEANUP_ONLY')
    capture(['docker','rm','-f',item[0]['Id']])
   if capture(['docker','ps','-aq','--filter','name=^/'+name+'$']).strip():raise ValueError('CONTAINER_CLEANUP_FAILED')
 # Restore the role-membership baseline before any ACL/conservation acceptance.
 cleanupname='wsx-isolated-membership-'+uuid.uuid4().hex;process=None
 cleanup_args=['docker','run','--rm','--pull=never','--name',cleanupname,'--label','wsx.rehearsal.owner='+cleanupname,'-i','--network',spec['isolatedNetwork'],'--add-host',b['host']+':'+b['peer'],'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=256m','--pids-limit=64']
 if b['tls']['sslmode']=='verify-full':cleanup_args+=['--mount','type=bind,src='+spec['caCertificatePath']+',dst=/run/ca.pem,readonly']
 try:
  process=subprocess.Popen(cleanup_args+['--entrypoint','node',api,'-e',helper_bytes.decode()],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
  raw,_=process.communicate(json.dumps(dict(p,operation='remove-temporary-memberships',preparationReceipt=prepared)).encode(),timeout=120)
  if process.returncode!=0 or len(raw)>65536:raise ValueError('TEMPORARY_MEMBERSHIP_CLEANUP_FAILED')
  cleanup=json.loads(raw)
  if cleanup.get('temporaryMembershipsRemoved') is not True or cleanup.get('targetId')!=b['targetInstanceId'] or cleanup.get('attemptId')!=b['attemptId']:raise ValueError('MEMBERSHIP_CLEANUP_RECEIPT')
 finally:
  if process and process.poll() is None:process.kill();process.wait(timeout=15)
  result=subprocess.run(['docker','inspect',cleanupname],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15)
  if result.returncode==0:
   item=json.loads(result.stdout)
   if len(item)!=1 or item[0]['Config']['Labels'].get('wsx.rehearsal.owner')!=cleanupname:raise ValueError('MEMBERSHIP_CLEANUP_OWNER')
   capture(['docker','rm','-f',item[0]['Id']])
  if capture(['docker','ps','-aq','--filter','name=^/'+cleanupname+'$']).strip():raise ValueError('MEMBERSHIP_CONTAINER_CLEANUP')
 # Preserve the actual restore-to-baseline proof, not only pg_restore exit status.
 from isolated_rehearsal_aliyun import run as observe_provider
 from isolated_rehearsal_snapshot import run as verify_restored
 observed=observe_provider('observe',p)
 fidelity=verify_restored(dict(p,operation='restore-fidelity',providerObservation=observed))
 if set(fidelity.get('baselineProofRefs',{}))!=set(DBS):raise ValueError('RESTORED_FIDELITY_CLOSURE')
 return dict(accepted=True,stage='restore',databases=list(DBS),baselineProofRefs=fidelity['baselineProofRefs'],**{k:b[k] for k in ('attemptId','targetInstanceId','candidateSha')})
def terminated(_signum,_frame):raise RuntimeError('TERMINATED')
if __name__=='__main__':
 signal.signal(signal.SIGTERM,terminated)
 try:
  if os.geteuid()!=0:raise ValueError('ROOT_ONLY')
  print(json.dumps(run(json.load(sys.stdin))))
 except BaseException:print('ISOLATED_RESTORE_FAILED',file=sys.stderr);sys.exit(1)
