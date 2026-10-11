#!/usr/bin/env python3
"""Read-only host-backup verification; stdout is original backup-result bytes.

No Docker/cloud calls and no success synthesis. This proves backup file hashes
and current hold only. Entry's process/cgroup and independent provider observers
remain responsible for their respective terminal-state proofs.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

APPROVALS=Path('/etc/workspacex-cn/runtime-readback-approvals')
RUNTIME=Path('/var/lib/workspacex-cn/runtime')
HOLD_HELPER=Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py')
IDENTITY=('sourceRevision','baselineRevision','controlRevision','attemptId')


def need(v,code):
    if not v:raise ValueError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def parse(raw):
    def pairs(items):
        result={}
        for k,v in items:need(k not in result,'DUPLICATE_JSON_KEY');result[k]=v
        return result
    return json.loads(raw,object_pairs_hook=pairs)


def timestamp(value):
    t=dt.datetime.fromisoformat(value.replace('Z','+00:00'));need(t.tzinfo is not None,'TIMEZONE_REQUIRED');return t


class Reader:
    def __init__(self,owner=0,trust_root=Path('/'),max_seconds=120):
        self.owner=owner;self.trust_root=Path(trust_root);self.deadline=time.monotonic()+max_seconds;self.snapshots=[]
    def tick(self):need(time.monotonic()<self.deadline,'READBACK_DEADLINE')
    def directory(self,path):
        path=Path(path);need(path.is_absolute() and '..'not in path.parts,'PATH_ESCAPE')
        need(path==self.trust_root or self.trust_root in path.parents,'OUTSIDE_TRUST_ROOT')
        for parent in (path,*path.parents):
            s=parent.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid in (0,self.owner)
                and not s.st_mode&0o022,'UNTRUSTED_DIRECTORY')
            if parent==self.trust_root:break
    def opened(self,path,modes=(0o600,)):
        self.tick();path=Path(path);self.directory(path.parent)
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==self.owner and s.st_nlink==1
                and stat.S_IMODE(s.st_mode)in modes,'UNTRUSTED_FILE')
            return fd,s
        except BaseException:os.close(fd);raise
    def file(self,path,limit=1048576,modes=(0o600,)):
        fd,before=self.opened(path,modes)
        try:
            need(before.st_size<=limit,'FILE_LIMIT');raw=b''
            while True:
                self.tick();chunk=os.read(fd,min(65536,limit+1-len(raw)))
                if not chunk:break
                raw+=chunk;need(len(raw)<=limit,'FILE_LIMIT')
            after=os.fstat(fd);self.unchanged(before,after);need(len(raw)==before.st_size,'SHORT_READ')
            return raw
        finally:os.close(fd)
    @staticmethod
    def unchanged(before,after):
        need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==
             (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'FILE_CHANGED')
    def digest_file(self,path,expected_bytes):
        need(type(expected_bytes)is int and expected_bytes>=0,'FILE_BYTES')
        fd,before=self.opened(path)
        try:
            need(before.st_size==expected_bytes,'FILE_SIZE');h=hashlib.sha256();count=0
            while True:
                self.tick();raw=os.read(fd,1048576)
                if not raw:break
                count+=len(raw);need(count<=expected_bytes,'FILE_GREW');h.update(raw)
            self.unchanged(before,os.fstat(fd));need(count==expected_bytes,'SHORT_READ')
            self.snapshots.append((Path(path),before));return h.hexdigest()
        finally:os.close(fd)


def approved(approval,now):
    fields={'kind','remoteRoot','bindingSha256','identity','holdGeneration','issuedAt','expiresAt',
            'observerSha256','upgradeSha256','backupHelperSha256','holdHelperSha256','maxSeconds'}
    need(set(approval)==fields and approval['kind']=='cn-runtime-backup-readback-approval-v1','APPROVAL_SCHEMA')
    need(set(approval['identity'])==set(IDENTITY),'APPROVAL_IDENTITY')
    for key in IDENTITY[:3]:need(re.fullmatch('[a-f0-9]{40}',approval['identity'][key]),'REVISION')
    need(re.fullmatch('[a-z0-9-]{1,64}',approval['identity']['attemptId']),'ATTEMPT')
    for key in ('bindingSha256','observerSha256','upgradeSha256','backupHelperSha256','holdHelperSha256'):
        need(re.fullmatch('[a-f0-9]{64}',approval[key]),'PIN')
    start,end=timestamp(approval['issuedAt']),timestamp(approval['expiresAt'])
    need(start<=now<end and end-start<=dt.timedelta(minutes=30),'APPROVAL_EXPIRED')
    need(type(approval['maxSeconds'])is int and 1<=approval['maxSeconds']<=120,'TIME_LIMIT')


def trusted_module(raw,name):
    """Only byte-pinned root-owned source reaches this function, never candidate code."""
    namespace={'__name__':'readback_'+name,'__file__':'<reviewed-'+name+'>'}
    exec(compile(raw,'<reviewed-'+name+'>','exec'),namespace)
    return namespace


def observe(approval,*,runtime_root=RUNTIME,reader=None,hold_reader=None,now=None):
    now=now or dt.datetime.now(dt.timezone.utc);approved(approval,now)
    reader=reader or Reader(max_seconds=approval['maxSeconds'])
    root=Path(approval['remoteRoot']);need(root.parent==runtime_root and
        re.fullmatch('upgrade-f0eb-[a-z0-9-]{1,64}',root.name),'RUNTIME_SCOPE')
    reader.directory(root)
    fd,s=reader.opened(runtime_root/'release.lock')
    try:
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('CANONICAL_RELEASE_BUSY')from None
        binding_raw=reader.file(root/'binding.json');need(sha(binding_raw)==approval['bindingSha256'],'BINDING_HASH')
        b=parse(binding_raw);need({k:b[k]for k in IDENTITY}==approval['identity'],'BINDING_IDENTITY')
        need(b['hold']['state']=='held' and b['hold']['generation']==approval['holdGeneration'],'HOLD_BINDING')
        code=reader.file(root/'upgrade-draft.py')
        need(sha(code)==b['scriptSha256']==approval['upgradeSha256'],'UPGRADE_PIN')
        trusted_module(code,'upgrade')['validate_binding'](b)
        helper=reader.file(root/'backup-host.py')
        need(sha(helper)==b['backupHelperSha256']==approval['backupHelperSha256'],'BACKUP_HELPER_PIN')
        backup=trusted_module(helper,'backup')
        need(b['holdHelperSha256']==approval['holdHelperSha256'],'HOLD_HELPER_PIN')
        if hold_reader is None:
            raw=reader.file(HOLD_HELPER,modes=(0o600,0o700));need(sha(raw)==approval['holdHelperSha256'],'HOLD_HELPER_PIN')
            def hold_reader():
                reader.tick()
                p=subprocess.run(['/usr/bin/python3','-I','-S','-B',str(HOLD_HELPER),'read',str(runtime_root)],
                    capture_output=True,timeout=min(15,max(.01,reader.deadline-time.monotonic())),
                    env={'PATH':'/usr/bin:/bin','LANG':'C'},pass_fds=(fd,))
                need(p.returncode==0 and len(p.stdout)<=65536,'HOLD_READ_FAILED');return parse(p.stdout)
        need(hold_reader()==b['hold'],'CURRENT_HOLD_CHANGED')
        intent_raw=reader.file(root/'backup-intent.json');intent=parse(intent_raw)
        need(intent=={'bindingSha256':approval['bindingSha256'],'holdGeneration':approval['holdGeneration']},'BACKUP_INTENT')
        result_raw=reader.file(root/'backup-result.json');result=parse(result_raw)
        need(set(result)=={'actual','holdGeneration'} and result['holdGeneration']==approval['holdGeneration'],'BACKUP_RESULT')
        actual=result['actual'];need(set(actual)=={'path','manifestSHA256','scope','restoreTested'},'BACKUP_SUMMARY')
        destination=root/'host-backup';need(actual['path']==str(destination) and actual['scope']==b['backupScope']
            and actual['restoreTested']is False,'BACKUP_SUMMARY_MISMATCH')
        manifest_raw=reader.file(destination/'manifest.json');need(backup['digest'](manifest_raw)==actual['manifestSHA256'],'MANIFEST_HASH')
        manifest=parse(manifest_raw)
        need(set(manifest)=={'scope','configFiles','dataArchives','ephemeralSocketsExcluded','restoreTested',
                             'databaseBackup','redisBackup','ossBackup'},'MANIFEST_FIELDS')
        need(type(manifest['ephemeralSocketsExcluded'])is int and manifest['ephemeralSocketsExcluded']>=0,'SOCKET_COUNT')
        need(manifest['scope']==b['backupScope'] and all(manifest[k]is False for k in
            ('restoreTested','databaseBackup','redisBackup','ossBackup')),'MANIFEST_SCOPE')
        expected={}
        for item in b['composeFiles']+b['envFiles']:
            path=item['path'];need(Path(path).is_absolute() and '..'not in Path(path).parts,'CONFIG_PATH')
            need(path not in expected or expected[path]==item['sha256'],'CONFIG_DUPLICATE_CONFLICT');expected[path]=item['sha256']
        configs=manifest['configFiles'];need(type(configs)is list and len(configs)==len(expected),'CONFIG_COUNT')
        for index,(original,expected_hash)in enumerate(sorted(expected.items())):
            item=configs[index]
            name='%03d-%s'%(index,Path(original).name)
            need(set(item)=={'originalPath','backupFile','sha256','bytes'} and item['originalPath']==original
                 and item['backupFile']==name and item['sha256']==expected_hash,'CONFIG_MANIFEST')
            need(reader.digest_file(destination/'config'/name,item['bytes'])==expected_hash,'CONFIG_HASH')
        paths=sorted(b['backupPaths']);need(len(paths)==2 and set(paths)=={str(Path(b['workingDir'])/'sandbox'),str(Path(b['workingDir'])/'sessions')},'ARCHIVE_SCOPE')
        archives=manifest['dataArchives'];need(type(archives)is list and len(archives)==2,'ARCHIVE_COUNT')
        for original,item in zip(paths,archives):
            name=Path(original).name+'.tar'
            need(set(item)=={'originalPath','backupFile','sha256','bytes'} and item['originalPath']==original
                 and item['backupFile']==name and re.fullmatch('[a-f0-9]{64}',item['sha256']),'ARCHIVE_MANIFEST')
            need(reader.digest_file(destination/name,item['bytes'])==item['sha256'],'ARCHIVE_HASH')
        # Detect changes across the complete check, including replaced metadata.
        for path,raw in [(root/'binding.json',binding_raw),(root/'backup-intent.json',intent_raw),
                         (root/'backup-result.json',result_raw),(destination/'manifest.json',manifest_raw)]:
            need(reader.file(path)==raw,'METADATA_CHANGED')
        for path,before in reader.snapshots:
            checkfd,after=reader.opened(path)
            try:reader.unchanged(before,after)
            finally:os.close(checkfd)
        need(hold_reader()==b['hold'],'CURRENT_HOLD_CHANGED');reader.tick()
        need(dt.datetime.now(dt.timezone.utc)<timestamp(approval['expiresAt']),'APPROVAL_EXPIRED')
        return result_raw
    finally:os.close(fd)


def verify_backup_receipt(raw,approval,**live_options):
    """Perform independent live readback; never accept a caller's verified flag."""
    need(raw==observe(approval,**live_options),'RAW_BACKUP_RECEIPT_MISMATCH')
    return True


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--approval-sha256',required=True);args=p.parse_args()
    need(os.geteuid()==0 and re.fullmatch('[a-f0-9]{64}',args.approval_sha256),'ROOT_APPROVAL_REQUIRED')
    reader=Reader();raw=reader.file(APPROVALS/(args.approval_sha256+'.json'))
    need(sha(raw)==args.approval_sha256,'APPROVAL_HASH');a=parse(raw)
    need(sha(reader.file(Path(__file__).resolve(),modes=(0o600,0o700)))==a['observerSha256'],'OBSERVER_PIN')
    sys.stdout.buffer.write(observe(a))


if __name__=='__main__':
    try:main()
    except Exception:
        print('{"status":"BLOCKED","code":"BACKUP_READBACK_NOT_PROVEN"}',file=sys.stderr);sys.exit(1)
