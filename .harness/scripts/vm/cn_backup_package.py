"""Source-owned backup command/lease protocol; no standalone mutation CLI.

Host adapters must supply live SQL/provider/process facts and protected approvals.
This module never installs tools, changes PUBLIC ACL, stops writers or restores DBs.
Its receipts prove three independent database snapshots, not a held release epoch.
"""
import datetime
import re
import time
from writer_fence import DATABASES, require, digest

APP = '9b25bfa65662b96c0826fe67506b562ea46aa6d0'
BASE = 'ba6343199f3c834d6a198f83d0c771614292c82b'
RDS = 'pgm-uf6rg214cp381l49'
ECS = 'i-uf6ga92ewloganobbln6'
IMAGE = 'sha256:eac621400b7b7ff52493883e41e930e3d104695fea5b68cc0c42370cf7880067'
ROLE = 'wsx_release_backup_ro'
FUNCTIONS = {
 'kernel_org_is_writable':'164ddbcd0df077e661bc939c9d1de2807fdbe131ade3aa2f5e0647ab76d9bfdd',
 'kernel_project_is_writable':'63c05c19c1dcf7b2a0a37e524d208f423d1f0887de996dbdb11b836996816e1b',
 'kernel_stale_queued_agent_run_orgs':'2e74ce8664072dc14b0c53ba3f11d0c7678b1ec5578dc45d99e22ebfa16c1ba2',
 'kernel_user_org_ids':'cee2ff04af48344945369a525212c859e20c300a3d8b05155c5537c3e62bbad0',
 'wave2_skill_file_insert_before_publish':'5615f8e6cfed1c4b9296dc7d8973ceaa4c6d6c7f9a62678039754461cad64a7d',
}

# No secret or caller-controlled SQL in argv. Fields arrive over private stdin.
# psql precheck is a separate closed read-only transaction; pg_dump owns its own
# serializable read-only snapshot. Thus precheck PID is never the dump PID proof.
EXPORT = r'''set -euo pipefail
umask 077
read -r PGDATABASE; read -r password; read -r PGAPPNAME
case "$PGDATABASE" in workspacex|workspacex_agent|workspacex_memory) ;; *) exit 1;; esac
PGHOST=192.168.100.44
export PGHOST PGDATABASE PGAPPNAME PGUSER=wsx_release_backup_ro PGPORT=5432 PGSSLMODE=disable PGCONNECT_TIMEOUT=5 PGPASSFILE=/run/wsx/pgpass
escape(){ local v=$1;v=${v//\\/\\\\};v=${v//:/\\:};printf '%s' "$v"; }
{ escape "$PGHOST";printf ':5432:';escape "$PGDATABASE";printf ':wsx_release_backup_ro:';escape "$password";printf '\n'; } > "$PGPASSFILE"
unset password;chmod 600 "$PGPASSFILE";trap 'rm -f "$PGPASSFILE"' EXIT
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=300000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=300000'
test "$(psql -XAt --no-password -c "BEGIN TRANSACTION READ ONLY; SELECT current_database() || chr(124) || current_user || chr(124) || current_setting('transaction_read_only'); ROLLBACK;" | sed -n '/|/p')" = "$PGDATABASE|wsx_release_backup_ro|on"
exec timeout --signal=TERM --kill-after=5s 330s pg_dump --format=custom --serializable-deferrable --lock-wait-timeout=5000 --no-password
'''


def exact(value, keys, code):
 require(type(value) is dict and set(value) == set(keys), code)


def identifier(value):
 require(type(value) is str and value and '\x00' not in value and len(value.encode()) <= 63,
         'BACKUP_SQL_IDENTIFIER')
 return '"' + value.replace('"', '""') + '"'


def validate(plan, now=None):
 now = time.time() if now is None else now
 exact(plan, ('identity','toolRevision','clientImage','configurationSha256',
              'providerBindingSha256','objectScopeSha256','functionBodies','authorization',
              'recipientCertificate','recipientKey','outputRoot','timeoutSeconds'), 'BACKUP_PLAN')
 i = plan['identity']
 exact(i, ('sourceRevision','baselineRevision','migrationPlanSha256','attemptId'), 'BACKUP_IDENTITY')
 require(i['sourceRevision'] == APP and i['baselineRevision'] == BASE and
         re.fullmatch('[a-f0-9]{64}', i['migrationPlanSha256']) and
         re.fullmatch('[A-Za-z0-9-]{1,32}', i['attemptId']), 'BACKUP_FIXED_IDENTITY')
 require(re.fullmatch('[a-f0-9]{40}', plan['toolRevision']) and plan['clientImage'] == IMAGE,
         'BACKUP_TOOL_IDENTITY')
 require(all(type(plan[k]) is str and re.fullmatch('[a-f0-9]{64}', plan[k]) for k in
             ('configurationSha256','providerBindingSha256','objectScopeSha256')), 'BACKUP_SOURCE_HASHES')
 require(plan['functionBodies'] == FUNCTIONS, 'BACKUP_FUNCTION_BODY_DRIFT')
 a = plan['authorization']
 exact(a, ('identity','action','roleApprovalSha256','publicCapabilityApprovalSha256',
           'notBefore','expiresAt','rdsInstanceId','ecsInstanceId'), 'BACKUP_AUTHORIZATION')
 require(a['identity'] == i and a['action'] == 'bounded-three-db-backup-read' and
         a['rdsInstanceId'] == RDS and a['ecsInstanceId'] == ECS, 'BACKUP_AUTHORIZATION_BINDING')
 require(all(type(a[k]) is str and re.fullmatch('[a-f0-9]{64}', a[k]) for k in
             ('roleApprovalSha256','publicCapabilityApprovalSha256')), 'BACKUP_EXPLICIT_PUBLIC_DELTA')
 require(all(type(a[k]) in (int,float) and __import__('math').isfinite(a[k]) for k in
             ('notBefore','expiresAt')) and a['notBefore'] <= now < a['expiresAt'] and
         0 < a['expiresAt'] - a['notBefore'] <= 3600, 'BACKUP_LEASE')
 require(type(plan['timeoutSeconds']) is int and 1 <= plan['timeoutSeconds'] <= 1080 and
         now + plan['timeoutSeconds'] + 120 < a['expiresAt'], 'BACKUP_CLEANUP_RESERVE')
 for key in ('recipientCertificate','recipientKey'):
  exact(plan[key], ('path','sha256'), 'BACKUP_RECIPIENT_REFERENCE')
  p = plan[key]['path']
  require(type(p) is str and (p.startswith('/etc/workspacex-cn/backup-recipients/') or p == {'recipientCertificate':'/etc/workspacex-cn/rehearsal/backup-recipient.pem','recipientKey':'/etc/workspacex-cn/rehearsal/keys/backup-key.pem'}[key]) and
          not any(x in p for x in ('..','\x00','\n',',')) and
          re.fullmatch('[a-f0-9]{64}', plan[key]['sha256']), 'BACKUP_RECIPIENT_PATH')
 require(plan['recipientKey']['path'] != plan['recipientCertificate']['path'], 'BACKUP_RECIPIENT_PAIR')
 require(plan['outputRoot'] == '/var/lib/workspacex-cn/backups/' + i['attemptId'], 'BACKUP_OUTPUT_ROOT')
 return i


def compile_role_sql(plan, objects, now=None):
 """Exact reviewable GRANT/REVOKE lists from a fresh host-owned catalog capture.
 Does not read a password or execute SQL; password must use private host stdin.
 """
 validate(plan,now)
 exact(objects, DATABASES, 'BACKUP_DATABASE_CLOSURE')
 require(digest(objects) == plan['objectScopeSha256'], 'BACKUP_OBJECT_SCOPE_DRIFT')
 grants, revokes = {}, {}
 for db in DATABASES:
  item = objects[db]
  exact(item, ('schemas','tables','sequences','largeObjects'), 'BACKUP_OBJECT_SCHEMA')
  require(item['largeObjects'] == [], 'BACKUP_LARGE_OBJECT_SCOPE_REQUIRED')
  require(type(item['schemas']) is list and type(item['tables']) is list and
          type(item['sequences']) is list, 'BACKUP_OBJECT_LIST')
  grant = ['GRANT CONNECT ON DATABASE ' + identifier(db) + ' TO ' + identifier(ROLE) + ';']
  revoke = ['REVOKE CONNECT ON DATABASE ' + identifier(db) + ' FROM ' + identifier(ROLE) + ';']
  seen = set()
  for schema in item['schemas']:
   require(schema not in seen, 'BACKUP_DUPLICATE_SCHEMA'); seen.add(schema)
   grant.append('GRANT USAGE ON SCHEMA ' + identifier(schema) + ' TO ' + identifier(ROLE) + ';')
   revoke.append('REVOKE USAGE ON SCHEMA ' + identifier(schema) + ' FROM ' + identifier(ROLE) + ';')
  seen = set()
  for category, kind in (('tables','TABLE'),('sequences','SEQUENCE')):
   for obj in item[category]:
    exact(obj, ('schema','name'), 'BACKUP_OBJECT_NAME')
    require(obj['schema'] in item['schemas'], 'BACKUP_SCHEMA_COVERAGE')
    target = identifier(obj['schema']) + '.' + identifier(obj['name'])
    require((category,target) not in seen, 'BACKUP_DUPLICATE_OBJECT'); seen.add((category,target))
    grant.append('GRANT SELECT ON ' + kind + ' ' + target + ' TO ' + identifier(ROLE) + ';')
    revoke.append('REVOKE SELECT ON ' + kind + ' ' + target + ' FROM ' + identifier(ROLE) + ';')
  grants[db], revokes[db] = '\n'.join(grant), '\n'.join(revoke)
 expires = datetime.datetime.fromtimestamp(plan['authorization']['expiresAt'], datetime.timezone.utc).isoformat()
 create = ('CREATE ROLE ' + identifier(ROLE) + ' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE '
           "NOREPLICATION NOINHERIT BYPASSRLS CONNECTION LIMIT 1 VALID UNTIL '" + expires + "';")
 close = ('ALTER ROLE ' + identifier(ROLE) + ' NOLOGIN PASSWORD NULL NOBYPASSRLS CONNECTION LIMIT 0;')
 return {'create':create,'grants':grants,'close':close,'revokes':revokes}


def dump_command(plan, db, container_name, owner):
 validate(plan)
 require(db in DATABASES and re.fullmatch('wsx-backup-[a-f0-9]{32}', container_name) and
         re.fullmatch('[a-f0-9]{32}', owner), 'BACKUP_CONTAINER_OWNER')
 # Reuses existing host private source .40; no new network/whitelist is created.
 # Fixed numeric peer prevents DNS resolution after provider verification.
 return ['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config',
         '/nonexistent','run','--rm','--pull=never','--name',container_name,
         '--label','wsx.backup.owner='+owner,'-i','--network=host','--read-only',
         '--cap-drop=ALL','--security-opt=no-new-privileges','--user=0:0',
         '--cpus=1','--memory=768m','--pids-limit=128','--tmpfs',
         '/run/wsx:rw,noexec,nosuid,nodev,size=1m,mode=0700',
         '--entrypoint','bash',IMAGE,'-c',EXPORT]


def encrypt_command(plan):
 validate(plan)
 return ['/usr/bin/openssl','cms','-encrypt','-binary','-aes256','-stream',
         '-outform','DER','-recip',plan['recipientCertificate']['path']]


class BackupLease:
 """Closed host obligations. No callback may merely echo the plan.

 verify_inputs must prove protected approvals, cached pg_dump16/pg_restore16,
 recipient pair + canary encrypt/decrypt/TOC path, existing private provider,
 exact PUBLIC/body capability and fresh object scope. It must NOT generate keys.
 export must attest actual owned container ID/process start and pg_dump backend
 PID/start/read-only/peer (not psql-precheck PID), stream directly to CMS, bound
 time/bytes, join both processes and persist only ciphertext. It must abort if
 identity cannot be observed. cleanup must join/remove only owned children,
 prove absence of role sessions, NOLOGIN/PASSWORD NULL/NOBYPASSRLS, exact REVOKE,
 zero owned credential files; recipient private key is retained, never deleted.
 """
 def __init__(self, plan, host, journal):
  self.plan, self.host, self.journal = plan, host, journal

 def run(self):
  identity = validate(self.plan)
  self.host.require_lock(identity)
  # All static/live input and approval checks before any role mutation.
  objects = self.host.verify_inputs(self.plan)
  sql = compile_role_sql(self.plan, objects)
  require(self.host.role_absent(ROLE), 'BACKUP_EXISTING_ROLE_REQUIRES_RECONCILIATION')
  attempted = False
  receipts = {}
  try:
   self.journal.record('backup-role-create-intent', sqlSha256=digest(sql))
   attempted = True # uncertain creation still requires reconciliation/cleanup
   self.host.create_role_and_grants(self.plan, sql)
   self.host.verify_effective_permissions(self.plan, objects)
   self.host.open_private_credential(self.plan)
   for db in DATABASES:
    validate(self.plan)
    self.host.recheck_inputs(self.plan, objects)
    self.journal.record('backup-export-intent', database=db)
    result = self.host.export_owned_ciphertext(self.plan, db)
    exact(result, ('database','ciphertextSha256','ciphertextBytes','dumpBytes','dumpExit',
                  'encryptionExit','ownedProcessesJoined','backendObserved','role',
                  'sourceAddress','peerAddress','readOnlyEvidence','applicationName',
                  'recipientCertificateSha256'), 'BACKUP_EXPORT_RECEIPT')
    exact(result['readOnlyEvidence'], ('kind','sqlObserved','imageId','exeSha256','contract'), 'BACKUP_READONLY_ATTESTATION')
    require(result['readOnlyEvidence']['contract'] == 'pg_dump serializable-deferrable read-only snapshot; precheck PID excluded', 'BACKUP_READONLY_CONTRACT')
    require(result['database'] == db and result['role'] == ROLE and
            result['sourceAddress'] == '192.168.100.40' and result['peerAddress'] == '192.168.100.44' and
            result['readOnlyEvidence'].get('kind') == 'pinned-pgdump16-implementation-attestation' and
            result['readOnlyEvidence'].get('sqlObserved') is False and
            result['readOnlyEvidence'].get('imageId') == IMAGE and
            re.fullmatch('[a-f0-9]{64}',result['readOnlyEvidence'].get('exeSha256','')) and
            result['backendObserved'] is True and
            result['ownedProcessesJoined'] is True and result['dumpExit'] == 0 and
            result['encryptionExit'] == 0 and
            result['applicationName'] == 'wsx-backup-'+identity['attemptId']+'-'+db and
            result['recipientCertificateSha256'] == self.plan['recipientCertificate']['sha256'] and
            re.fullmatch('[a-f0-9]{64}', result['ciphertextSha256']) and
            all(type(result[k]) is int and 0 < result[k] <= 16*1024**3 for k in
                ('ciphertextBytes','dumpBytes')), 'BACKUP_ACTUAL_EXPORT_BINDING')
    receipts[db] = result
    self.journal.record('backup-export-response', database=db, receiptSha256=digest(result))
  finally:
   if attempted:
    # Cleanup cannot depend on journal I/O: full disk must not leave LOGIN open.
    audit_error = None
    try:self.journal.record('backup-cleanup-intent')
    except BaseException as exc:audit_error = exc
    cleanup = self.host.cleanup_and_revoke(self.plan, sql)
    require(cleanup == {'ownedProcessesJoined':True,'ownedContainersAbsent':True,
             'roleSessionsAbsent':True,'noLogin':True,'passwordNull':True,'noBypassRls':True,
             'exactGrantsRevoked':True,'ownedCredentialsAbsent':True,
             'recipientKeyRetained':True}, 'BACKUP_CLEANUP_UNPROVEN')
    self.journal.record('backup-cleanup-verified')
    if audit_error is not None:raise RuntimeError('BACKUP_CLEANUP_AUDIT_FAILED') from None
  return {'identity':identity,'databases':receipts,'cleanupVerified':True,
          'consistencyScope':'three-independent-database-snapshots','currentEpochVerified':False,
          'productionReleaseReady':False}
