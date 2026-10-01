#!/usr/bin/env python3
"""Post-migration CMS snapshot and digest-only archive-to-live-data recovery proof.
Uses the reviewed round-one pg_dump/CMS and COPY/sequence fidelity engines.
Never connects to source production, restores over a database, or stores plaintext archives.
"""
import hashlib,json,os,signal,stat,subprocess,sys,tempfile,threading,uuid
from pathlib import Path
from isolated_rehearsal import DBS,validate_binding,trusted_bytes,exclusive
from isolated_rehearsal_sql_stage import capture
EXPORT=r'''set -euo pipefail
umask 077
read -r PGHOST;read -r PGDATABASE;read -r PGUSER;read -r password;read -r PGSSLMODE
export PGHOST PGDATABASE PGUSER PGSSLMODE PGPORT=5432 PGCONNECT_TIMEOUT=5 PGPASSFILE=/run/wsx/pgpass
escape(){ local v=$1;v=${v//\\/\\\\};v=${v//:/\\:};printf '%s' "$v"; }
{ escape "$PGHOST";printf ':5432:';escape "$PGDATABASE";printf ':';escape "$PGUSER";printf ':';escape "$password";printf '\n'; } > "$PGPASSFILE"
unset password;chmod 600 "$PGPASSFILE";trap 'rm -f "$PGPASSFILE"' EXIT
export PGOPTIONS='-c statement_timeout=300000 -c lock_timeout=5000'
test "$(psql -XAt --no-password -c 'SELECT current_database() || chr(124) || current_user')" = "$PGDATABASE|$PGUSER"
timeout --signal=TERM --kill-after=5s 330s pg_dump --format=custom --serializable-deferrable --lock-wait-timeout=5000 --no-password
'''
def filehash(path):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);h=hashlib.sha256();size=0
 with os.fdopen(fd,'rb') as f:
  st=os.fstat(f.fileno())
  if not __import__('stat').S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_mode&0o077:raise ValueError('PRIVATE_CIPHER')
  for x in iter(lambda:f.read(131072),b''):h.update(x);size+=len(x)
 return h.hexdigest(),size

def private_key(ref):
 path=Path(ref['path']);st=path.lstat()
 if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or stat.S_IMODE(st.st_mode)!=0o600:raise ValueError('PRIVATE_KEY_MODE')
 return trusted_bytes(ref['path'],ref['sha256'])

def write_baseline_proof(root,db,result):
 if db not in DBS:raise ValueError('DATABASE_SCOPE')
 out=root/(db+'.restored-fidelity.json');exclusive(out,result)
 return {'path':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}

def image(identity,source=None):
 x=json.loads(capture(['image','inspect',identity]).stdout)
 if len(x)!=1 or x[0]['Id']!=identity or x[0]['Os']!='linux' or x[0]['Architecture']!='amd64':raise ValueError('IMMUTABLE_CLIENT')
 if source and x[0]['Config']['Labels'].get('org.opencontainers.image.revision')!=source:raise ValueError('CLIENT_SOURCE')
 for env in x[0]['Config'].get('Env',[]):
  key,_,value=env.partition('=')
  if value and any(q in key.upper() for q in ('PASSWORD','SECRET','TOKEN','API_KEY','DATABASE_URL')):raise ValueError('BAKED_SECRET')

def run(p):
 b=p['binding'];validate_binding(b);s=p['secret'];op=p['operation']
 if os.geteuid()!=0 or op not in ('snapshot','recovery-verify','restore-fidelity') or any(s.get(k)!=b[k] for k in ('targetInstanceId','attemptId','host','peer')):raise ValueError('TARGET_BINDING')
 o=p['providerObservation']
 if o.get('providerVerified') is not True or any(o.get(k)!=b[k] for k in ('targetInstanceId','peer','providerCreatedUtc')):raise ValueError('ACTUAL_PROVIDER')
 manifest=json.loads(trusted_bytes(b['stageManifestPath'],b['stageManifestSha256']))
 if manifest.get('prepared') is not True or manifest.get('candidateSha')!=b['candidateSha']:raise ValueError('FROZEN_MANIFEST')
 e=manifest['stages'][op];image(e['clientImage']);image(e['apiImage'],e['apiSourceSha'])
 if o.get('engine')!='PostgreSQL' or not str(o.get('engineVersion','')).split('.')[0].isdigit() or not str(e['clientVersion']).split('.')[0].isdigit() or int(str(e['clientVersion']).split('.')[0])<int(str(o['engineVersion']).split('.')[0]):raise ValueError('CLIENT_SERVER_COMPATIBILITY')
 for name in ('pg_dump','pg_restore'):
  text=capture(['run','--rm','--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--entrypoint',name,e['clientImage'],'--version']).stdout.decode().strip()
  prefix=name+' (PostgreSQL) '+e['clientVersion']
  if text!=prefix and not text.startswith(prefix+' '):raise ValueError('ACTUAL_CLIENT_VERSION')
 certbytes=trusted_bytes(e['certificate']['path'],e['certificate']['sha256']);keybytes=private_key(e['privateKey'])
 verifier=trusted_bytes(e['verifier']['path'],e['verifier']['sha256']).decode()
 root=Path(b['privateRoot'])
 if str(root)!='/var/lib/workspacex-cn/rehearsal/isolated-rds/'+b['attemptId']:raise ValueError('OUTPUT_ROOT')
 temporary=tempfile.TemporaryDirectory(prefix='wsx-snapshot-',dir='/run');work=Path(temporary.name);cert=work/'recipient.pem';key=work/'key.pem';cert.write_bytes(certbytes);key.write_bytes(keybytes);cert.chmod(0o600);key.chmod(0o600)
 def tool(argv):return subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=True,timeout=15).stdout
 if tool(['openssl','pkey','-in',str(key),'-pubout'])!=tool(['openssl','x509','-in',str(cert),'-pubkey','-noout']):raise ValueError('RECIPIENT_PAIR')
 ca=None
 if b['tls']['sslmode']=='verify-full':
  ca=work/'ca.pem';ca.write_bytes(trusted_bytes(b['tls']['ca']['path'],b['tls']['ca']['sha256']));ca.chmod(0o600)
 owner='wsx-snapshot-'+uuid.uuid4().hex;network=None;names=[];processes=[];threads=[];errors=[];proofs={}
 def dockerargs(name,img,live):
  names.append(name);args=['/usr/bin/docker','run','--rm','--pull=never','--name',name,'--label','wsx.rehearsal.owner='+owner,'-i','--network',network if live else 'none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=0:0','--cpus=1','--memory=768m','--pids-limit=128','--tmpfs','/run/wsx:rw,noexec,nosuid,nodev,size=256m,mode=0700']
  if live:args+=['--add-host',b['host']+':'+b['peer']]
  if ca:args+=['--mount','type=bind,src='+str(ca)+',dst=/run/ca.pem,readonly','--env','PGSSLROOTCERT=/run/ca.pem']
  return args
 def start(args,**kw):
  c=subprocess.Popen(args,stderr=subprocess.DEVNULL,**kw);processes.append(c);return c
 def bridge(source,dest,drain=False):
  def pump():
   try:
    discard=False
    for chunk in iter(lambda:source.read(65536),b''):
     if discard:continue
     try:dest.write(chunk)
     except BrokenPipeError:
      if drain:discard=True
      else:raise
    try:dest.close()
    except BrokenPipeError:
     if not drain:raise
   except BaseException:errors.append(True)
  t=threading.Thread(target=pump,daemon=True);threads.append(t);t.start();return t
 def archive(cipher,args):
  dec=start(['openssl','cms','-decrypt','-binary','-inform','DER','-in',str(cipher),'-recip',str(cert),'-inkey',str(key)],stdout=subprocess.PIPE)
  pg=start(dockerargs('wsx-archive-'+uuid.uuid4().hex,e['clientImage'],False)+['--entrypoint','pg_restore',e['clientImage'],*args],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
  bridge(dec.stdout,pg.stdin,drain=args==['--list']);return pg
 try:
  network=capture(['network','create','--driver=bridge','--label','wsx.rehearsal.owner='+owner,owner]).stdout.decode().strip()
  n=json.loads(capture(['network','inspect',network]).stdout)[0]
  if n['Id']!=network or n.get('Labels',{}).get('wsx.rehearsal.owner')!=owner or n.get('Containers'):raise ValueError('OWNED_NETWORK')
  for db in DBS:
   cipher=root/(db+'.post-migration.cms')
   if op=='restore-fidelity':cipher=Path(b['restore']['databases'][db]['ciphertextPath'])
   if op=='snapshot':
    fd=os.open(cipher,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as output:
     dump=start(dockerargs('wsx-dump-'+uuid.uuid4().hex,e['clientImage'],True)+['--entrypoint','bash',e['clientImage'],'-c',EXPORT],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
     enc=start(['openssl','cms','-encrypt','-binary','-aes256','-stream','-outform','DER','-recip',str(cert)],stdin=subprocess.PIPE,stdout=output)
     fields=[s['host'],db,s['user'],s['password'],b['tls']['sslmode']]
     if any(any(c in v for c in '\n\r\0') for v in fields):raise ValueError('CREDENTIAL_SHAPE')
     dump.stdin.write(('\n'.join(fields)+'\n').encode());dump.stdin.close();bridge(dump.stdout,enc.stdin)
     if dump.wait(timeout=360) or enc.wait(timeout=30):raise ValueError('SNAPSHOT_PIPELINE')
     output.flush();os.fsync(output.fileno())
    digest,size=filehash(cipher);proofs[db]={'path':str(cipher),'ciphertextSha256':digest,'bytes':size,'recipientCertificateSha256':e['certificate']['sha256']}
   else:
    if op=='restore-fidelity':
     backup=b['restore']['databases'][db];ref={'path':backup['receiptPath'],'sha256':backup['receiptSha256']};expected=json.loads(trusted_bytes(ref['path'],ref['sha256']))
     if expected.get('sourceRdsInstanceId')!=b['sourceInstanceId'] or expected.get('database')!=db or not expected.get('cleanupVerified') or expected.get('dumpExit')!=0 or expected.get('encryptionExit')!=0:raise ValueError('SOURCE_BACKUP_BINDING')
    else:
     ref=p['previousReceipts']['snapshot'];previous=json.loads(trusted_bytes(ref['path'],ref['sha256']))
     if any(previous.get(k)!=b[k] for k in ('targetInstanceId','attemptId','candidateSha')) or previous.get('accepted') is not True:raise ValueError('SNAPSHOT_RECEIPT_BINDING')
     expected=previous['snapshots'][db]
     if str(cipher)!=expected['path']:raise ValueError('SNAPSHOT_PATH')
    digest,size=filehash(cipher)
    if digest!=expected['ciphertextSha256'] or size!=expected['bytes'] or expected['recipientCertificateSha256']!=e['certificate']['sha256']:raise ValueError('CIPHERTEXT_BINDING')
    pg=archive(cipher,['--list']);toc=pg.stdout.read(1048577)
    if len(toc)>1048576 or pg.wait(timeout=300):raise ValueError('RESTORE_TOC')
    pg=archive(cipher,['--data-only','--file=-'])
    metadata={'schemaVersion':1,'targetBindingVerified':True,'targetRdsInstanceId':b['targetInstanceId'],'targetSecret':{'host':s['host'],'port':5432,'user':s['user'],'password':s['password'],'database':db},'database':db,'sourceHost':b['sourceInstanceId']+'.rwlb.rds.aliyuncs.com','targetPeerAddressSha256':b['peerSha256'],'targetPeerPort':5432,'sslmode':b['tls']['sslmode'],'targetTlsExceptionVerified':b['tls']['sslmode']=='disable','toc':toc.decode(),'backupReceiptSha256':ref['sha256'],'ciphertextSha256':digest}
    if ca:metadata['caPem']=ca.read_text()
    verifierproc=start(dockerargs('wsx-verify-'+uuid.uuid4().hex,e['apiImage'],True)+['--env','WSX_FIDELITY_RUN=1','--entrypoint','node',e['apiImage'],'-e',verifier],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    verifierproc.stdin.write((json.dumps(metadata)+'\n').encode());verifierproc.stdin.flush();bridge(pg.stdout,verifierproc.stdin)
    output=verifierproc.stdout.read(1048577)
    if len(output)>1048576 or verifierproc.wait(timeout=900):raise ValueError('ACTUAL_FIDELITY')
    result=json.loads(output)
    if not result.get('dataFidelityVerified') or not result.get('readOnly') or not result.get('rollbackComplete') or result.get('database')!=db or result.get('targetRdsInstanceId')!=b['targetInstanceId'] or result.get('ciphertextSha256')!=digest:raise ValueError('Fidelity_PROOF_BINDING')
    result.update(targetInstanceId=b['targetInstanceId'],attemptId=b['attemptId'],candidateSha=b['candidateSha'])
    proofs[db]=result
  for c in processes:
   if c.wait(timeout=30):raise ValueError('PIPELINE_EXIT')
  for t in threads:
   t.join(timeout=30)
   if t.is_alive():raise ValueError('PIPELINE_THREAD')
  if errors:raise ValueError('PIPELINE_BRIDGE')
 finally:
  for c in processes:
   if c.poll() is None:c.kill();c.wait(timeout=15)
  for name in names:
   found=capture(['inspect',name],False)
   if found.returncode==0:
    c=json.loads(found.stdout)
    if len(c)!=1 or c[0]['Config'].get('Labels',{}).get('wsx.rehearsal.owner')!=owner:raise ValueError('FOREIGN_CONTAINER')
    capture(['rm','-f',c[0]['Id']])
   if capture(['ps','-aq','--filter','name=^/'+name+'$']).stdout.strip():raise ValueError('CONTAINER_CLEANUP')
  if network:
   n=json.loads(capture(['network','inspect',network]).stdout)[0]
   if n['Id']!=network or n.get('Labels',{}).get('wsx.rehearsal.owner')!=owner or n.get('Containers'):raise ValueError('FOREIGN_NETWORK')
   capture(['network','rm',network])
   if capture(['network','ls','-q','--no-trunc','--filter','id='+network]).stdout.strip():raise ValueError('NETWORK_CLEANUP_NOT_VERIFIED')
  temporary.cleanup()
 refs={}
 if op=='restore-fidelity':
  for db,result in proofs.items():
   refs[db]=write_baseline_proof(root,db,result)
 return {'baselineProofRefs':refs,'accepted':True,'targetInstanceId':b['targetInstanceId'],'attemptId':b['attemptId'],'candidateSha':b['candidateSha'],'databases':list(DBS),'snapshots':proofs,'plaintextArchiveCreated':False,'ownedCleanupVerified':True}
if __name__=='__main__':
 signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(TimeoutError('SNAPSHOT_TERMINATED')))
 try:print(json.dumps(run(json.load(sys.stdin))))
 except BaseException:print('ISOLATED_SNAPSHOT_REJECTED',file=sys.stderr);sys.exit(1)
