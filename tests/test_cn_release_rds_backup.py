"""Offline boundaries only; no SDK, credentials, Docker or cloud calls."""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('rds',ROOT/'scripts/cn-release-rds-backup.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Provider:
 def __init__(self):self.calls=[];self.fail=False;self.rows=[];self.job={'BackupJobId':'123','BackupId':'456','BackupStatus':'Finished','JobMode':'Manual'}
 def call(self,action,params):
  self.calls.append((action,params))
  if self.fail:raise TimeoutError('synthetic credential must not be rendered')
  if action=='CreateBackup':return m.encode({'BackupJobId':'123','RequestId':'request-1'})
  if action=='DescribeBackupTasks':return m.encode({'RequestId':'task-read','Items':{'BackupJob':[self.job]}})
  return m.encode({'RequestId':'read','TotalRecordCount':str(len(self.rows)),'PageNumber':str(params['PageNumber']),'PageRecordCount':str(len(self.rows[(params['PageNumber']-1)*100:params['PageNumber']*100])),'Items':{'Backup':self.rows[(params['PageNumber']-1)*100:params['PageNumber']*100]}})
class Tests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup);self.root=Path(self.t.name);self.root.chmod(0o700);(self.root/'inputs').mkdir(mode=0o700)
  self.time=dt.datetime.now(dt.timezone.utc);self.clock=lambda:self.time
  stamp=lambda sec:(self.time+dt.timedelta(seconds=sec)).isoformat()
  self.hold={'state':'held','generation':'g','identity':{'attemptId':'attempt','sourceRevision':'a'*40}}
  self.stop={'knownFiveStopped':True,'otherDatabaseClientSessions':0,'finishedAt':stamp(-10),'holdGeneration':'g'}
  ident={'publicationAttemptId':'publication-attempt','attemptId':'attempt','sourceRevision':'a'*40,'deadlineAt':stamp(600)}
  perm={'kind':'cn-approved-rds-capability-v1','roleName':m.ROLE,'accountId':m.ACCOUNT,'region':m.REGION,'dbInstanceId':m.DB,'actions':['rds:CreateBackup','rds:DescribeBackups','rds:DescribeBackupTasks'],'approved':True,'observedAt':stamp(-5)}
  self.put('permission.json',perm)
  self.a={'kind':'cn-fixed-release-approval-v1','target':m.TARGET,'identity':ident,'expiresAt':stamp(600),'rds':{'dbInstanceId':m.DB,'roleName':m.ROLE,'permissionEvidence':{'path':str(self.root/'permission.json'),'sha256':m.sha((self.root/'permission.json').read_bytes())}}}
  self.put('inputs/stop.json',self.stop);self.put('inputs/hold.json',self.hold)
  self.put('rds-request.json',{'identity':ident,'inputHashes':{'stop':m.sha((self.root/'inputs/stop.json').read_bytes()),'hold':m.sha((self.root/'inputs/hold.json').read_bytes())}})
  self.reader=m.r.Reader(owner=os.getuid(),trust_root=self.root);self.p=Provider()
  self.row={'DBInstanceId':m.DB,'BackupId':'456','BackupMethod':'Snapshot','BackupType':'FullBackup','BackupMode':'Manual','BackupStatus':'Success','MetaStatus':'OK','BackupStartTime':stamp(0),'BackupEndTime':stamp(0)}
  self.p.rows=[self.row]
 def put(self,name,v):
  p=self.root/name;p.write_bytes(m.encode(v));p.chmod(0o600)
 def runop(self,mode):return m._execute(mode,self.a,self.root,self.p,self.reader,lambda:self.hold,self.clock)
 def test_create_once_unknown_does_not_retry(self):
  self.p.fail=True
  with self.assertRaises(TimeoutError):self.runop('action')
  with self.assertRaises(FileExistsError):self.runop('action')
  self.assertEqual(len(self.p.calls),1);self.assertTrue((self.root/'intent.json').exists())
 def test_preflight_checks_both_read_apis(self):
  v=m.preflight(self.a,self.reader,self.p,self.time);self.assertTrue(v['readCapabilityVerified'])
  self.assertEqual([x[0]for x in self.p.calls],['DescribeBackups','DescribeBackupTasks'])
 def test_permission_missing_blocks_before_cloud(self):
  self.a['rds']['permissionEvidence']['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'PERMISSION_HASH'):m.preflight(self.a,self.reader,self.p,self.time)
  self.assertEqual(self.p.calls,[])
 def test_wrong_input_hash_blocks_create(self):
  self.put('inputs/stop.json',{**self.stop,'otherDatabaseClientSessions':1})
  with self.assertRaisesRegex(ValueError,'INPUT_IDENTITY'):self.runop('action')
  self.assertEqual(self.p.calls,[])
 def test_exact_job_mapping_and_independent_observer(self):
  raw=self.runop('action');self.assertEqual(self.runop('observe'),raw)
  v=m.parse(raw);self.assertFalse(v['isolatedRestoreTested']);self.assertEqual(v['backupId'],'456');self.assertEqual(v['requestedBackupJobId'],'123')
  self.assertTrue((self.root/('task-'+v['originalEvidenceSha256']['task']+'.json')).exists())
 def test_other_success_snapshot_does_not_match_job(self):
  self.p.rows=[{**self.row,'BackupId':'999'}]
  with self.assertRaisesRegex(ValueError,'UNIQUE_CURRENT'):self.runop('action')
 def test_wrong_job_response_reject(self):
  self.p.job['BackupJobId']='999'
  with self.assertRaisesRegex(ValueError,'JOB_IDENTITY'):self.runop('action')
 def test_pending_and_failed_observer_reject(self):
  self.runop('action')
  for status in ('Uploading','Failed'):
   self.p.job['BackupStatus']=status
   with self.assertRaises(ValueError):self.runop('observe')
 def test_paginated_original_responses_preserved(self):
  old={**self.row,'BackupStartTime':(self.time-dt.timedelta(days=1)).isoformat()}
  self.p.rows=[{**old,'BackupId':str(i)}for i in range(100)]+[self.row]
  v=m.parse(self.runop('action'));self.assertEqual(len(v['originalEvidenceSha256']['pages']),2)
 def test_absent_dispatch_cannot_be_reconciled_from_other_snapshot(self):
  self.p.fail=True
  with self.assertRaises(TimeoutError):self.runop('action')
  self.p.fail=False;self.p.rows=[self.row]
  with self.assertRaises(FileNotFoundError):self.runop('observe')
  self.assertEqual(len(self.p.calls),1)
 def test_action_polls_reads_without_second_create(self):
  self.p.job['BackupStatus']='Uploading'
  def advance(seconds):
   self.time+=dt.timedelta(seconds=seconds);self.p.job['BackupStatus']='Finished'
  v=m.parse(m._execute('action',self.a,self.root,self.p,self.reader,lambda:self.hold,self.clock,sleep=advance))
  self.assertEqual(v['backupId'],'456');self.assertEqual(sum(x[0]=='CreateBackup'for x in self.p.calls),1)
  self.assertEqual(sum(x[0]=='DescribeBackupTasks'for x in self.p.calls),2)
 def test_pending_at_deadline_stops_no_retry(self):
  self.p.job['BackupStatus']='Uploading';self.a['expiresAt']=(self.time+dt.timedelta(seconds=3)).isoformat()
  with self.assertRaisesRegex(ValueError,'RELEASE_EXPIRED'):self.runop('action')
  self.assertEqual(sum(x[0]=='CreateBackup'for x in self.p.calls),1)
 def test_malformed_job_missing_backup_id_rejected(self):
  self.p.job.pop('BackupId')
  with self.assertRaisesRegex(ValueError,'JOB_BACKUP_ID'):self.runop('action')
 def test_fixed_verifier_rechecks_observer_and_manifest(self):
  from unittest.mock import patch
  import subprocess
  self.a['rds']['adapterSha256']=m.sha(Path(m.__file__).read_bytes())
  raw_approval=m.encode(self.a);release=m.sha(raw_approval);self.put(release+'.json',self.a)
  manifest={'authorizationEvidenceSha256':release,'stage':'rds-backup','previousReceiptSha256':'prev',**{k:v for k,v in self.a['identity'].items()if k!='publicationAttemptId'}}
  destination=self.root/release/'rds-backup';destination.mkdir(parents=True);(destination/'rds-request.json').write_bytes(m.encode({'identity':self.a['identity']}))
  class Read:
   def __init__(self,**kw):pass
   def file(self,path,**kw):return Path(path).read_bytes()
  with patch.object(m,'BASE',self.root),patch.object(m,'APPROVALS',self.root),patch.object(m.os,'geteuid',return_value=0),patch.object(m.r,'Reader',Read),patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'receipt',b'')) as run:
   self.assertTrue(m.verify(b'receipt',manifest,'prev','normal',release)['externalWritesTerminal'])
   self.assertEqual(run.call_args.args[0][-2:],['observe',release])
   with self.assertRaisesRegex(ValueError,'MANIFEST_IDENTITY'):m.verify(b'receipt',{**manifest,'sourceRevision':'f'*40},'prev','normal',release)
   self.assertEqual(run.call_count,1)
   with self.assertRaisesRegex(ValueError,'INDEPENDENT_RDS'):m.verify(b'changed',manifest,'prev','normal',release)
 def test_saved_receipt_flags_and_evidence_tamper_reject(self):
  raw=self.runop('action');original=m.parse(raw)
  for key in ('isolatedRestoreTested','redisBackup','ossBackup'):
   changed={**original,key:True};self.put('backup-receipt.json',changed)
   with self.assertRaisesRegex(ValueError,'BACKUP_RECEIPT_CHANGED'):self.runop('observe')
  changed=m.parse(raw);changed['originalEvidenceSha256']['task']='0'*64;self.put('backup-receipt.json',changed)
  with self.assertRaises(FileNotFoundError):self.runop('observe')
  self.put('backup-receipt.json',original)
  task=self.root/('task-'+original['originalEvidenceSha256']['task']+'.json');task.write_bytes(b'{}')
  with self.assertRaisesRegex(ValueError,'RAW_EVIDENCE_CHANGED'):self.runop('observe')
 def test_same_second_precision_and_minute_upper_bound(self):
  # Provider second precision is lower than locally recorded fractional intent.
  self.row['BackupStartTime']=self.time.replace(microsecond=0).isoformat()
  self.row['BackupEndTime']=self.time.replace(microsecond=0).isoformat()
  self.runop('action')
  params=next(p for a,p in self.p.calls if a=='DescribeBackups')
  self.assertGreater(m.instant(params['EndTime']),self.time)
  self.assertLessEqual(m.instant(params['StartTime']),self.time)
 def test_cross_minute_completion(self):
  self.time=self.time.replace(second=59,microsecond=900000)
  self.stop['finishedAt']=(self.time-dt.timedelta(seconds=1)).isoformat();self.put('inputs/stop.json',self.stop)
  req=m.parse((self.root/'rds-request.json').read_bytes());req['inputHashes']['stop']=m.sha((self.root/'inputs/stop.json').read_bytes());self.put('rds-request.json',req)
  self.row['BackupStartTime']=self.time.replace(microsecond=0).isoformat();self.p.job['BackupStatus']='Uploading'
  def advance(seconds):
   self.time+=dt.timedelta(seconds=seconds);self.p.job['BackupStatus']='Finished';self.row['BackupEndTime']=self.time.replace(microsecond=0).isoformat()
  result=m.parse(m._execute('action',self.a,self.root,self.p,self.reader,lambda:self.hold,self.clock,sleep=advance))
  self.assertEqual(result['backupId'],'456')
 def test_provider_counts_reject_bool_negative_and_nondecimal(self):
  for v in (True,-1,'-1','1.0','9999999999'):
   with self.assertRaises(ValueError):m.count(v)
 def test_minute_precision_backup_start(self):
  self.row['BackupStartTime']=self.time.strftime('%Y-%m-%dT%H:%MZ');self.row['BackupEndTime']=self.row['BackupStartTime']
  self.assertEqual(m.parse(self.runop('action'))['backupId'],'456')
 def test_action_budget_uses_original_deadline_not_fixed_120(self):
  self.assertEqual(m.reader_budget('action',self.a,self.time),600)
  self.assertEqual(m.reader_budget('action',self.a,self.time+dt.timedelta(seconds=130)),470)
  self.assertEqual(m.reader_budget('observe',self.a,self.time+dt.timedelta(seconds=700)),120)
  with self.assertRaisesRegex(ValueError,'RELEASE_EXPIRED'):m.reader_budget('action',self.a,self.time+dt.timedelta(seconds=601))
 def test_backup_pending_after_120_seconds_can_finish_once(self):
  self.p.job['BackupStatus']='Uploading';polls=[]
  def advance(seconds):
   self.time+=dt.timedelta(seconds=seconds);polls.append(seconds)
   if len(polls)==27:self.p.job['BackupStatus']='Finished';self.row['BackupEndTime']=self.time.isoformat()
  v=m.parse(m._execute('action',self.a,self.root,self.p,self.reader,lambda:self.hold,self.clock,sleep=advance))
  self.assertEqual(v['backupId'],'456');self.assertEqual(sum(polls),135);self.assertEqual(sum(x[0]=='CreateBackup'for x in self.p.calls),1)
 def test_stale_stop_blocks_before_intent(self):
  self.time+=dt.timedelta(minutes=11)
  with self.assertRaisesRegex(ValueError,'STOP_STALE'):self.runop('action')
  self.assertFalse((self.root/'intent.json').exists())
if __name__=='__main__':unittest.main()
