#!/usr/bin/env python3
"""Exact-instance, single-intent RDS snapshot and independent read-only observer.
No permission provisioning, automatic CreateBackup retry, or restore claim.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
DB='pgm-uf6rg214cp381l49'; REGION='cn-shanghai'; ACCOUNT='1177216024653153'
ROLE='WorkspacexCnProductionEcsRole'
BASE=Path('/var/lib/workspacex-cn/release-generated')
SDK_ROOT=Path('/usr/local/lib/workspacex-cn/rds-sdk')
APPROVALS=Path('/etc/workspacex-cn/release-approvals')
TARGET={'accountId':ACCOUNT,'region':REGION,'ecsInstanceId':'i-uf6ga92ewloganobbln6'}
CREATE={'RegionId':REGION,'DBInstanceId':DB,'BackupMethod':'Snapshot'}

def need(v,c):
    if not v:raise ValueError(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def encode(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def parse(b):
    def pairs(xs):
        d={}
        for k,v in xs:need(k not in d,'DUPLICATE_JSON');d[k]=v
        return d
    return json.loads(b,object_pairs_hook=pairs)
def now():return dt.datetime.now(dt.timezone.utc)
def instant(v):
    t=dt.datetime.fromisoformat(v.replace('Z','+00:00'));need(t.tzinfo is not None,'TIMEZONE');return t

def count(v,maximum=10000):
    need(type(v)is int or (type(v)is str and re.fullmatch('[0-9]{1,9}',v)),'PROVIDER_COUNT_TYPE')
    n=int(v);need(0<=n<=maximum,'PROVIDER_COUNT_RANGE');return n

def floor_precision(t,provider_time):
    return t.replace(second=0,microsecond=0) if re.search(r'T[0-9]{2}:[0-9]{2}(?:Z|[+-])',provider_time) else t.replace(microsecond=0)

def module(path,name):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

r=module(ROOT/'scripts/cn-release-runtime-readback.py','rds_reader')

def store(root,name,raw):
    fd=os.open(root/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        d=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(d)
        finally:os.close(d)
    except BaseException:raise

def retain(root,kind,raw,reader):
    name=kind+'-'+sha(raw)+'.json'
    if (root/name).exists():need(reader.file(root/name,limit=2*1024*1024)==raw,'RAW_EVIDENCE_CHANGED')
    else:store(root,name,raw)

def permission(approval,reader,clock):
    need(approval['kind']=='cn-fixed-release-approval-v1' and approval['target']==TARGET,'APPROVAL_SCOPE')
    cfg=approval['rds'];need(cfg['dbInstanceId']==DB and cfg['roleName']==ROLE,'RDS_SCOPE')
    ref=cfg['permissionEvidence'];raw=reader.file(Path(ref['path']));need(sha(raw)==ref['sha256'],'PERMISSION_HASH')
    p=parse(raw)
    need(p.get('kind')=='cn-approved-rds-capability-v1' and p.get('roleName')==ROLE and p.get('accountId')==ACCOUNT
         and p.get('region')==REGION and p.get('dbInstanceId')==DB and p.get('actions')==['rds:CreateBackup','rds:DescribeBackups','rds:DescribeBackupTasks']
         and p.get('approved') is True,'RDS_CAPABILITY_NOT_APPROVED')
    need(dt.timedelta(0)<=clock-instant(p['observedAt'])<=dt.timedelta(hours=1),'RDS_CAPABILITY_STALE')
    return cfg

class Provider:
    """Preinstalled hash-complete SDK; IMDSv2 only, no credential-file chain."""
    def __init__(self,cfg,reader):
        sdk=Path(cfg['sdkRoot']);need(sdk==SDK_ROOT,'SDK_FIXED_ROOT');reader.directory(sdk)
        files=cfg['sdkFiles'];need(isinstance(files,dict) and files,'SDK_CLOSURE')
        actual={str(p.relative_to(sdk)) for p in sdk.rglob('*') if not p.is_dir()}
        need(actual==set(files),'SDK_EXTRA_OR_MISSING_FILES')
        for name,digest in files.items():
            need(not Path(name).is_absolute() and '..' not in Path(name).parts,'SDK_PATH')
            need(sha(reader.file(sdk/name,limit=32*1024*1024))==digest,'SDK_HASH')
        sys.dont_write_bytecode=True;sys.path.insert(0,str(sdk))
        # Root-installed release closure pins this existing host/HTTP policy.
        sys.path.insert(0,str(ROOT/'scripts'))
        import cn_candidate_authenticated_oss as auth
        auth.verify_host()
        from alibabacloud_credentials.client import Client
        from alibabacloud_credentials.models import Config
        from aliyunsdkcore.client import AcsClient
        from aliyunsdkcore.auth.credentials import StsTokenCredential
        from aliyunsdkcore.request import CommonRequest
        from requests.adapters import HTTPAdapter
        c=Client(Config(type='ecs_ram_role',role_name=ROLE,disable_imds_v1=True,timeout=2000,connect_timeout=2000)).get_credential()
        credential=StsTokenCredential(c.access_key_id,c.access_key_secret,c.security_token)
        self.client=AcsClient(region_id=REGION,credential=credential,auto_retry=False,connect_timeout=5,timeout=10,verify=True,proxy={})
        auth.pin_session(self.client.session,'rds.cn-shanghai.aliyuncs.com',{'POST'})
        self.client.session.mount('https://',HTTPAdapter(max_retries=0));self.Request=CommonRequest
        sts=AcsClient(region_id=REGION,credential=credential,auto_retry=False,connect_timeout=5,timeout=10,verify=True,proxy={})
        auth.pin_session(sts.session,'sts.cn-shanghai.aliyuncs.com',{'POST'});sts.session.mount('https://',HTTPAdapter(max_retries=0))
        q=CommonRequest();q.set_domain('sts.cn-shanghai.aliyuncs.com');q.set_version('2015-04-01');q.set_action_name('GetCallerIdentity');q.set_protocol_type('https');q.set_method('POST')
        ident=parse(sts.do_action_with_exception(q))
        need(str(ident.get('AccountId'))==ACCOUNT and ident.get('Arn')==cfg['principalArn'],'RDS_PRINCIPAL')
    def call(self,action,params):
        need(action in ('CreateBackup','DescribeBackups','DescribeBackupTasks'),'RDS_ACTION')
        q=self.Request();q.set_domain('rds.cn-shanghai.aliyuncs.com');q.set_version('2014-08-15');q.set_action_name(action);q.set_protocol_type('https');q.set_method('POST');q.set_accept_format('json')
        for k,v in params.items():q.add_query_param(k,str(v))
        raw=self.client.do_action_with_exception(q);need(len(raw)<=2*1024*1024,'PROVIDER_SIZE');return raw

def preflight(approval,reader=None,provider=None,clock=None):
    reader=reader or r.Reader();clock=clock or now();cfg=permission(approval,reader,clock)
    provider=provider or Provider(cfg,reader)
    raw=provider.call('DescribeBackups',{'RegionId':REGION,'DBInstanceId':DB,'PageSize':30,'PageNumber':1})
    p=parse(raw);need(p.get('RequestId') and 'Items'in p and 'TotalRecordCount'in p,'RDS_READ_CAPABILITY_FAILED')
    tasks=parse(provider.call('DescribeBackupTasks',{'RegionId':REGION,'DBInstanceId':DB,'BackupMode':'Manual'}))
    need(tasks.get('RequestId') and isinstance(tasks.get('Items',{}).get('BackupJob'),list),'RDS_TASK_CAPABILITY_FAILED')
    return {'readCapabilityVerified':True,'createPermissionApprovalSha256':cfg['permissionEvidence']['sha256'],'cloudWrites':0}

def inputs(approval,root,reader,hold_reader,clock,fresh):
    cfg=approval['rds'];request=parse(reader.file(root/'rds-request.json'));stop_raw=reader.file(root/'inputs/stop.json');hold_raw=reader.file(root/'inputs/hold.json')
    need(request['inputHashes']=={'stop':sha(stop_raw),'hold':sha(hold_raw)} and request['identity']==approval['identity'],'INPUT_IDENTITY')
    stop,hold=parse(stop_raw),parse(hold_raw)
    need(hold['state']=='held' and hold['identity']['attemptId']==approval['identity']['attemptId'] and hold['identity']['sourceRevision']==approval['identity']['sourceRevision'],'HOLD_IDENTITY')
    need(stop['knownFiveStopped'] is True and stop['otherDatabaseClientSessions']==0 and stop['holdGeneration']==hold['generation'],'STOP_ZERO_REQUIRED')
    need(hold_reader()==hold,'CURRENT_HOLD_CHANGED')
    if fresh:need(dt.timedelta(0)<=clock-instant(stop['finishedAt'])<=dt.timedelta(minutes=10),'STOP_STALE')
    return stop,hold,{'stopReceiptSha256':sha(stop_raw),'holdReceiptSha256':sha(hold_raw)}

def execute(mode,approval,root,provider,reader,hold_reader,clock=now):
    if mode=='action':preflight(approval,reader,provider,clock())
    return _execute(mode,approval,root,provider,reader,hold_reader,clock)

def _execute(mode,approval,root,provider,reader,hold_reader,clock=now,sleep=time.sleep):
    """Protocol fixture core; public mutation entry always requires preflight."""
    need(mode in ('action','observe'),'MODE');reader.directory(root)
    fd=os.open(root/'operation.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        stamp=clock();stop,hold,refs=inputs(approval,root,reader,hold_reader,stamp,mode=='action')
        if mode=='action':
            need(stamp<instant(approval['expiresAt'])<=instant(approval['identity']['deadlineAt']),'RELEASE_EXPIRED')
            permission(approval,reader,stamp)
            intent={'createdAt':stamp.isoformat(),'request':CREATE,'holdGeneration':hold['generation'],'attemptId':approval['identity']['attemptId'],**refs}
            # Existing intent, including a crash before response persistence, always blocks another Create.
            need(hold_reader()==hold,'CURRENT_HOLD_CHANGED')
            need(clock()<instant(approval['expiresAt']),'RELEASE_EXPIRED')
            store(root,'intent.json',encode(intent))
            raw=provider.call('CreateBackup',CREATE)
            store(root,'dispatch.json',raw)
            dispatch=parse(raw);need(dispatch.get('BackupJobId') and dispatch.get('RequestId'),'CREATE_UNKNOWN')
        intent_raw=reader.file(root/'intent.json');intent=parse(intent_raw)
        need(intent['request']==CREATE and intent['holdGeneration']==hold['generation'] and intent['attemptId']==approval['identity']['attemptId'] and all(intent[k]==v for k,v in refs.items()),'INTENT_IDENTITY')
        need(instant(intent['createdAt'])>=instant(stop['finishedAt']),'CREATE_BEFORE_STOP')
        # An absent/unknown create response cannot be converted into terminal success by timestamp correlation.
        dispatch_raw=reader.file(root/'dispatch.json');dispatch=parse(dispatch_raw)
        need(dispatch.get('BackupJobId') and dispatch.get('RequestId'),'CREATE_UNKNOWN')
        job_id=str(dispatch['BackupJobId']);need(re.fullmatch('[0-9]{1,30}',job_id),'BACKUP_JOB_ID')
        while True:
            reader.tick()
            if mode=='action':need(clock()<instant(approval['expiresAt']),'RELEASE_EXPIRED')
            task_raw=provider.call('DescribeBackupTasks',{'RegionId':REGION,'DBInstanceId':DB,'BackupJobId':job_id,'BackupMode':'Manual'})
            task=parse(task_raw);need(task.get('RequestId'),'TASK_REQUEST_ID')
            jobs=task.get('Items',{}).get('BackupJob');need(isinstance(jobs,list) and len(jobs)==1,'EXACT_JOB_REQUIRED')
            job=jobs[0];need(str(job.get('BackupJobId'))==job_id and job.get('JobMode')=='Manual','JOB_IDENTITY')
            retain(root,'task',task_raw,reader)
            status=job.get('BackupStatus')
            need(status!='Failed','BACKUP_JOB_FAILED')
            if status=='Finished':
                backup_id=str(job.get('BackupId',''));need(re.fullmatch('[0-9]{1,30}',backup_id),'JOB_BACKUP_ID');break
            need(status in ('NoStart','Checking','Preparing','Waiting','Uploading'),'JOB_STATUS_UNKNOWN')
            need(mode=='action','BACKUP_JOB_NOT_TERMINAL')
            need(clock()+dt.timedelta(seconds=5)<instant(approval['expiresAt']),'RELEASE_EXPIRED')
            sleep(5)
        end=clock();params={'RegionId':REGION,'DBInstanceId':DB,'StartTime':instant(intent['createdAt']).strftime('%Y-%m-%dT%H:%MZ'),'EndTime':(end.replace(second=0,microsecond=0)+dt.timedelta(minutes=1)).strftime('%Y-%m-%dT%H:%MZ'),'PageSize':100}
        pages=[];items=[];total=None
        for page in range(1,101):
            reader.tick();raw=provider.call('DescribeBackups',{**params,'PageNumber':page});v=parse(raw)
            need(v.get('RequestId'),'BACKUP_PAGE_REQUEST_ID');n=count(v['TotalRecordCount']);need(total is None or total==n,'PAGINATION_CHANGED');total=n
            need(count(v['PageNumber'],100)==page,'PAGE_NUMBER')
            rows=v['Items'];rows=rows['Backup'] if isinstance(rows,dict) else rows
            need(isinstance(rows,list) and len(rows)<=100 and count(v['PageRecordCount'],100)==len(rows),'PAGE_ITEMS');items.extend(rows);pages.append(raw);retain(root,'page',raw,reader)
            need(len(items)<=total,'PAGINATION_OVERFLOW')
            if len(items)==total:break
            need(rows,'PAGINATION_INCOMPLETE')
        need(len(items)==total and len({str(v['BackupId']) for v in items})==len(items),'ALL_PAGES_REQUIRED')
        candidates=[v for v in items if str(v.get('BackupId'))==backup_id and v.get('DBInstanceId')==DB and v.get('BackupMethod')=='Snapshot' and v.get('BackupType')=='FullBackup' and v.get('BackupMode')=='Manual' and instant(v['BackupStartTime'])>=floor_precision(instant(intent['createdAt']),v['BackupStartTime'])]
        need(len(candidates)==1,'UNIQUE_CURRENT_EPOCH_SNAPSHOT_REQUIRED');v=candidates[0]
        need(v.get('BackupStatus')=='Success' and v.get('MetaStatus')=='OK' and instant(v['BackupStartTime'])<=instant(v['BackupEndTime'])<=end,'BACKUP_NOT_COMPLETE')
        need(hold_reader()==hold,'CURRENT_HOLD_CHANGED')
        # Retain each original response, not only a synthesized flattened page.
        evidence={'intent':sha(intent_raw),'dispatch':sha(dispatch_raw),**refs,'pages':[sha(x) for x in pages],'task':sha(task_raw)}
        receipt={'createIntentCreatedAt':intent['createdAt'],'dbInstanceId':DB,'backupId':v['BackupId'],'backupStatus':'Success','metaStatus':'OK','backupStartTime':v['BackupStartTime'],'backupEndTime':v['BackupEndTime'],'holdGeneration':hold['generation'],'attemptId':intent['attemptId'],'requestedBackupJobId':dispatch['BackupJobId'],'providerRequestId':dispatch['RequestId'],'association':'DescribeBackupTasks exact BackupJobId returned Finished and BackupId; matching DescribeBackups current-epoch snapshot','originalEvidenceSha256':evidence,'isolatedRestoreTested':False,'redisBackup':False,'ossBackup':False}
        if mode=='action':
            result=encode(receipt);store(root,'backup-receipt.json',result);return result
        original=reader.file(root/'backup-receipt.json');saved=parse(original)
        need(set(saved)==set(receipt),'BACKUP_RECEIPT_SCHEMA')
        for key in receipt:
            if key!='originalEvidenceSha256':need(saved[key]==receipt[key],'BACKUP_RECEIPT_CHANGED')
        old=saved['originalEvidenceSha256'];need(set(old)==set(evidence),'EVIDENCE_SCHEMA')
        for key in ('intent','dispatch','stopReceiptSha256','holdReceiptSha256'):need(old[key]==evidence[key],'ORIGINAL_EVIDENCE_HASH')
        def original_provider(kind,digest):
            need(isinstance(digest,str) and re.fullmatch('[a-f0-9]{64}',digest),'EVIDENCE_HASH')
            raw=reader.file(root/(kind+'-'+digest+'.json'),limit=2*1024*1024)
            need(sha(raw)==digest,'ORIGINAL_PROVIDER_HASH');return parse(raw)
        oldtask=original_provider('task',old['task']);oldjobs=oldtask.get('Items',{}).get('BackupJob')
        need(oldtask.get('RequestId') and isinstance(oldjobs,list) and len(oldjobs)==1,'ORIGINAL_TASK')
        oj=oldjobs[0];need(str(oj.get('BackupJobId'))==job_id and oj.get('BackupStatus')=='Finished' and oj.get('JobMode')=='Manual' and str(oj.get('BackupId'))==backup_id,'ORIGINAL_TASK_MAPPING')
        need(isinstance(old['pages'],list) and 1<=len(old['pages'])<=100,'ORIGINAL_PAGES')
        oldrows=[];oldtotal=None
        for page_number,digest in enumerate(old['pages'],1):
            page=original_provider('page',digest);n=count(page['TotalRecordCount'])
            need(oldtotal is None or oldtotal==n,'ORIGINAL_PAGE_TOTAL');oldtotal=n
            need(count(page['PageNumber'],100)==page_number,'ORIGINAL_PAGE_NUMBER')
            rows=page['Items'];rows=rows['Backup']if isinstance(rows,dict)else rows
            need(isinstance(rows,list) and len(rows)<=100 and count(page['PageRecordCount'],100)==len(rows),'ORIGINAL_PAGE_ROWS');oldrows.extend(rows)
        need(len(oldrows)==oldtotal and len({str(v['BackupId'])for v in oldrows})==oldtotal,'ORIGINAL_ALL_PAGES')
        matched=[x for x in oldrows if str(x['BackupId'])==backup_id]
        need(len(matched)==1 and all(matched[0].get(k)==v.get(k)for k in ('DBInstanceId','BackupId','BackupStatus','MetaStatus','BackupMethod','BackupType','BackupMode','BackupStartTime','BackupEndTime')),'ORIGINAL_BACKUP_MAPPING')
        # Independent task and backup reads succeeded. Return the original action
        # receipt, while preserving new raw observations in content-addressed files.
        return original
    finally:os.close(fd)

def verify(raw,manifest,previous,mode,releaseSHA):
    """Fixed independent verifier: only the reviewed observer can establish terminal."""
    import subprocess
    need(os.geteuid()==0 and re.fullmatch('[a-f0-9]{64}',releaseSHA),'ROOT_RELEASE_REQUIRED')
    reader=r.Reader(max_seconds=120)
    approval_raw=reader.file(APPROVALS/(releaseSHA+'.json'));need(sha(approval_raw)==releaseSHA,'APPROVAL_HASH')
    approval=parse(approval_raw)
    need(approval['kind']=='cn-fixed-release-approval-v1' and approval['target']==TARGET,'APPROVAL_SCOPE')
    need(sha(reader.file(Path(__file__),limit=1048576,modes=(0o600,0o700)))==approval['rds']['adapterSha256'],'ADAPTER_HASH')
    need(mode in ('normal','terminal','reconcile','advance'),'VERIFIER_MODE')
    need(manifest['stage']=='rds-backup' and manifest['previousReceiptSha256']==previous,'STAGE_PREVIOUS')
    need(manifest['authorizationEvidenceSha256']==releaseSHA,'RELEASE_AUTHORIZATION_BINDING')
    for key,value in approval['identity'].items():
        if key!='publicationAttemptId':need(manifest[key]==value,'MANIFEST_IDENTITY')
    request=parse(reader.file(BASE/releaseSHA/'rds-backup/rds-request.json'))
    need(request['identity']==approval['identity'],'PUBLICATION_ATTEMPT_BINDING')
    need(len(raw)<=65536,'RECEIPT_SIZE')
    result=subprocess.run(['/usr/bin/python3.12','-I','-S','-B',str(Path(__file__).resolve()),'observe',releaseSHA],
        capture_output=True,timeout=120,env={'PATH':'/usr/bin:/bin','LANG':'C'})
    need(result.returncode==0 and result.stdout==raw,'INDEPENDENT_RDS_OBSERVATION_FAILED')
    return {'valid':True,'externalWritesTerminal':True,'backupReceiptSha256':sha(raw),'isolatedRestoreTested':False}

def reader_budget(mode,approval,clock):
    if mode!='action':return 120
    remaining=(min(instant(approval['expiresAt']),instant(approval['identity']['deadlineAt']))-clock).total_seconds()
    need(remaining>0,'RELEASE_EXPIRED');return min(1200,remaining)

def main():
    p=argparse.ArgumentParser();p.add_argument('mode',choices=('action','observe','preflight'));p.add_argument('release_sha256');a=p.parse_args()
    need(os.geteuid()==0 and re.fullmatch('[a-f0-9]{64}',a.release_sha256),'ROOT_RELEASE_REQUIRED')
    reader=r.Reader(max_seconds=120);raw=reader.file(APPROVALS/(a.release_sha256+'.json'));need(sha(raw)==a.release_sha256,'APPROVAL_HASH');approval=parse(raw)
    reader.deadline=time.monotonic()+reader_budget(a.mode,approval,now())
    cfg=permission(approval,reader,now())
    provider=Provider(cfg,reader)
    if a.mode=='preflight':sys.stdout.buffer.write(encode(preflight(approval,reader,provider)));return
    import subprocess
    helper=Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py');need(sha(reader.file(helper,modes=(0o600,0o700)))==cfg['holdHelperSha256'],'HOLD_HELPER_HASH')
    def hold():
        v=subprocess.run(['/usr/bin/python3','-I','-S','-B',str(helper),'read','/var/lib/workspacex-cn/runtime'],capture_output=True,timeout=15,env={'PATH':'/usr/bin:/bin','LANG':'C'})
        need(v.returncode==0 and len(v.stdout)<=65536,'HOLD_READ_FAILED');return parse(v.stdout)
    lock,unused=reader.opened(Path('/var/lib/workspacex-cn/runtime/release.lock'))
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        sys.stdout.buffer.write(execute(a.mode,approval,BASE/a.release_sha256/'rds-backup',provider,reader,hold))
    finally:os.close(lock)

if __name__=='__main__':
    try:main()
    except Exception:
        print('{"status":"RDS_BLOCKED_OR_UNKNOWN","automaticRetry":false}',file=sys.stderr);sys.exit(1)
