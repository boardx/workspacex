import copy,time,types,unittest,os,json,subprocess,tempfile
from pathlib import Path
from cn_backup_package import *


def fixture():
 now=time.time();i={'sourceRevision':APP,'baselineRevision':BASE,'migrationPlanSha256':'a'*64,'attemptId':'backup-test'}
 objects={d:{'schemas':['public'],'tables':[{'schema':'public','name':'items'}],
              'sequences':[{'schema':'public','name':'items_id_seq'}],'largeObjects':[]} for d in DATABASES}
 p={'identity':i,'toolRevision':'b'*40,'clientImage':IMAGE,'configurationSha256':'c'*64,
    'providerBindingSha256':'d'*64,'objectScopeSha256':digest(objects),'functionBodies':dict(FUNCTIONS),
    'authorization':{'identity':i,'action':'bounded-three-db-backup-read','roleApprovalSha256':'e'*64,
        'publicCapabilityApprovalSha256':'f'*64,'notBefore':now-10,'expiresAt':now+1200,
        'rdsInstanceId':RDS,'ecsInstanceId':ECS},
    'recipientCertificate':{'path':'/etc/workspacex-cn/backup-recipients/frozen/cert.pem','sha256':'1'*64},
    'recipientKey':{'path':'/etc/workspacex-cn/backup-recipients/frozen/key.pem','sha256':'2'*64},
    'outputRoot':'/var/lib/workspacex-cn/backups/backup-test','timeoutSeconds':900}
 return p,objects


class BackupPackageTests(unittest.TestCase):
 def test_fixed_no_secret_commands_and_preserved_acl(self):
  p,o=fixture();sql=compile_role_sql(p,o)
  self.assertIn('NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE',sql['create'])
  self.assertIn('BYPASSRLS CONNECTION LIMIT 1',sql['create'])
  self.assertIn('PASSWORD NULL NOBYPASSRLS',sql['close'])
  all_sql=str(sql);self.assertNotIn('PUBLIC',all_sql);self.assertNotIn('CASCADE',all_sql)
  self.assertNotIn('DROP ',all_sql);self.assertNotIn('DEFAULT PRIVILEGES',all_sql)
  cmd=dump_command(p,DATABASES[0],'wsx-backup-'+'a'*32,'b'*32)
  self.assertIn('--pull=never',cmd);self.assertIn('--network=host',cmd)
  self.assertIn('--serializable-deferrable',cmd[-1]);self.assertIn('default_transaction_read_only=on',cmd[-1])
  self.assertNotIn('--enable-row-security',cmd[-1]);self.assertNotIn('--jobs',cmd[-1])
  self.assertNotIn('key.pem',str(encrypt_command(p)))

 def test_exact_object_quoting_and_scope(self):
  p,o=fixture();o[DATABASES[0]]['tables'][0]['name']='quoted"table';p['objectScopeSha256']=digest(o)
  self.assertIn('"quoted""table"',compile_role_sql(p,o)['grants'][DATABASES[0]])
  o[DATABASES[0]]['tables'][0]['name']='new';self.assertRaisesRegex(RuntimeError,'SCOPE_DRIFT',compile_role_sql,p,o)

 def test_authorization_and_input_faults_before_mutation(self):
  faults=[lambda p:p['authorization'].pop('publicCapabilityApprovalSha256'),
          lambda p:p['authorization'].update(expiresAt=time.time()-1),
          lambda p:p.update(clientImage='postgres:16'),
          lambda p:p['functionBodies'].update(kernel_org_is_writable='0'*64),
          lambda p:p['recipientKey'].update(path='/etc/workspacex-cn/stable-secrets/key'),
          lambda p:p.update(timeoutSeconds=3600),
          lambda p:p['authorization'].update(ecsInstanceId='other')]
  for fault in faults:
   p,o=fixture();fault(p)
   with self.subTest(fault=fault),self.assertRaises((RuntimeError,KeyError,TypeError)):validate(p)

 def test_large_objects_require_new_exact_scope(self):
  p,o=fixture();o[DATABASES[0]]['largeObjects']=[123];p['objectScopeSha256']=digest(o)
  self.assertRaisesRegex(RuntimeError,'LARGE_OBJECT_SCOPE_REQUIRED',compile_role_sql,p,o)

 def run_case(self,fault=None):
  p,o=fixture();calls=[];events=[]
  def op(name):
   def call(*args):
    calls.append(name)
    if fault==name:raise RuntimeError(name)
   return call
  def export(p,db):
   calls.append(db)
   if fault=='second-db' and db==DATABASES[1]:raise RuntimeError('second-db')
   return {'database':db,'ciphertextSha256':'a'*64,'ciphertextBytes':100,'dumpBytes':80,
     'dumpExit':0,'encryptionExit':0,'ownedProcessesJoined':True,'backendObserved':True,
     'role':ROLE,'sourceAddress':'192.168.100.40','peerAddress':'192.168.100.44',
     'transactionReadOnly':True,'applicationName':'wsx-backup-backup-test-'+db,
     'recipientCertificateSha256':p['recipientCertificate']['sha256']}
  def cleanup(*args):
   calls.append('cleanup')
   return {'ownedProcessesJoined':fault!='cleanup','ownedContainersAbsent':True,
      'roleSessionsAbsent':True,'noLogin':True,'passwordNull':True,'noBypassRls':True,
      'exactGrantsRevoked':True,'ownedCredentialsAbsent':True,'recipientKeyRetained':True}
  host=types.SimpleNamespace(require_lock=op('lock'),verify_inputs=lambda p:o,
    role_absent=lambda r:fault!='existing-role',create_role_and_grants=op('create'),
    verify_effective_permissions=op('permissions'),open_private_credential=op('credential'),
    recheck_inputs=op('recheck'),export_owned_ciphertext=export,cleanup_and_revoke=cleanup)
  def record(state,**facts):
   events.append(state)
   if fault=='journal-cleanup' and state=='backup-cleanup-intent':raise OSError('fixture full disk')
  journal=types.SimpleNamespace(record=record)
  executor=BackupLease(p,host,journal)
  if fault:
   with self.assertRaises(RuntimeError):executor.run()
  else:
   r=executor.run();self.assertFalse(r['currentEpochVerified']);self.assertFalse(r['productionReleaseReady'])
   self.assertEqual(set(r['databases']),set(DATABASES));self.assertTrue(r['cleanupVerified'])
  return calls,events

 def test_success_serial_closure_cleanup_no_epoch_claim(self):
  calls,events=self.run_case();self.assertEqual([c for c in calls if c in DATABASES],list(DATABASES))
  self.assertEqual(calls[-1],'cleanup');self.assertEqual(events[-1],'backup-cleanup-verified')

 def test_unknown_create_permission_credential_export_always_cleanup(self):
  for fault in ('create','permissions','credential','recheck','second-db'):
   with self.subTest(fault=fault):
    calls,events=self.run_case(fault);self.assertEqual(calls[-1],'cleanup')
    if fault=='second-db':self.assertNotIn(DATABASES[2],calls)

 def test_foreign_role_not_modified(self):
  calls,events=self.run_case('existing-role');self.assertNotIn('create',calls);self.assertNotIn('cleanup',calls)

 def test_cleanup_not_skipped_if_journal_fails(self):
  calls,events=self.run_case('journal-cleanup');self.assertEqual(calls[-1],'cleanup')

 def test_export_actual_shell_argv_no_secret_echo(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);log=root/'args.json'
   # Stub network-capable tools; exercise the actual shell argument syntax.
   psql=root/'psql'
   psql.write_text('''#!/usr/bin/env python3
import sys,os,json
json.dump({'args':sys.argv[1:],'host':os.environ['PGHOST']},open(os.environ['BACKUP_ARG_LOG'],'w'))
print('workspacex|wsx_release_backup_ro|on')
''');psql.chmod(0o700)
   timeout=root/'timeout';timeout.write_text('#!/bin/sh\nexit 0\n');timeout.chmod(0o700)
   source=EXPORT.replace('/run/wsx/pgpass',str(root/'pgpass'))
   r=subprocess.run(['/bin/bash','-c',source],input=b'workspacex\nfixture-password\nwsx-backup-backup-test-workspacex\n',stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'PATH':str(root)+':'+os.environ['PATH'],'BACKUP_ARG_LOG':str(log)},timeout=5)
   self.assertEqual(r.returncode,0,r.stderr.decode());args=json.loads(log.read_text())
   self.assertEqual(args['host'],'192.168.100.44');self.assertEqual(len(args['args']),4)
   self.assertEqual(args['args'][:3],['-XAt','--no-password','-c'])
   self.assertTrue(args['args'][3].startswith('BEGIN TRANSACTION READ ONLY;'))
   self.assertNotIn(b'fixture-password',r.stdout+r.stderr)

 def test_unknown_cleanup_never_success(self):
  calls,events=self.run_case('cleanup');self.assertNotIn('backup-cleanup-verified',events)

if __name__=='__main__':unittest.main()
