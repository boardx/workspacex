#!/usr/bin/env python3
"""Fixed installed owner adapter. Inert unless independent root profile/config exist.

No unit installation, policy creation, stop/restart or cloud action is provided.
Unknown startup is reconciled readonly; the canonical bundle validates terminal.
"""
import datetime
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

PROFILE='/etc/workspacex-cn/trusted-tool-binding.json'
SELF='/usr/local/lib/workspacex-cn/cn-release-migration-owner-native.py'
LAUNCHER='/usr/local/lib/workspacex-cn/cn-maintenance-host-launcher.py'
TEMPLATE='/etc/systemd/system/workspacex-cn-migration@.service'
SYSTEMCTL='/usr/bin/systemctl'
ROOT='/var/lib/workspacex-cn/migration-owner'
SOURCE='scripts/cn-release-migration-owner-native.py'


def need(ok,code):
    if not ok:raise RuntimeError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def encode(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def parse(raw):
    def pairs(items):
        result={}
        for k,v in items:
            need(k not in result,'DUPLICATE_KEY');result[k]=v
        return result
    return json.loads(raw,object_pairs_hook=pairs)


def stamp(st):return (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_mode,st.st_uid,st.st_gid,st.st_nlink)


def private_directory(path):
    p=Path(path)
    for parent in (p,*p.parents):
        st=parent.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==st.st_gid==0 and not st.st_mode&0o022,'DIRECTORY_TRUST')
    st=p.lstat();need(stat.S_IMODE(st.st_mode)==0o700,'DIRECTORY_MODE');return st


def protected(path,mode,limit=1048576):
    p=Path(path);need(p.is_absolute() and '..' not in p.parts,'PATH_INVALID')
    for parent in p.parents:
        s=parent.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022,'PARENT_TRUST')
    before=p.lstat();fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==mode and stamp(before)==stamp(s),'FILE_TRUST')
        with os.fdopen(os.dup(fd),'rb') as stream:raw=stream.read(limit+1)
        need(len(raw)<=limit and stamp(os.fstat(fd))==stamp(s)==stamp(p.lstat()),'FILE_CHANGED')
        return raw
    finally:os.close(fd)


def unit_bytes():
    return ('[Unit]\nDescription=Reviewed canonical migration owner\n'
            '[Service]\nType=exec\nUser=root\nGroup=root\nRestart=no\nKillMode=control-group\n'
            'ExecStart=/usr/bin/python3 -I '+SELF+' --own %i\n'
            'TimeoutStopSec=10s\n').encode()


def dispatch_spec(config):
    return {'schemaVersion':1,'kind':'migration-owner-start-v1','releaseSha256':config['releaseSha256'],
            'planSha256':config['originalPlanSha256'],'launcherSha256':config['launcherSha256'],
            'unitSha256':config['unitSha256'],'unit':'workspacex-cn-migration@'+config['releaseSha256']+'.service'}


class Installed:
    def __init__(self,release):
        need(sys.platform=='linux' and os.geteuid()==os.getegid()==0,'ROOT_LINUX_REQUIRED')
        need(re.fullmatch('[0-9a-f]{64}',release),'RELEASE_HASH')
        self.profile_raw=protected(PROFILE,0o600);self.profile=parse(self.profile_raw)
        need(sha(protected(SELF,0o700))==self.profile['filesSha256'][SOURCE],'SELF_PIN')
        self.descriptor=self.profile.get('maintenanceMigrationOwner')
        need(type(self.descriptor)is dict and set(self.descriptor)=={'schemaVersion','releaseSha256','originalPlanSha256','configSha256'} and self.descriptor['schemaVersion']==1 and self.descriptor['releaseSha256']==release,'OWNER_NOT_INSTALLED')
        self.config_path='/etc/workspacex-cn/migration-owner/'+release+'.json'
        self.config_raw=protected(self.config_path,0o600);need(sha(self.config_raw)==self.descriptor['configSha256'],'CONFIG_PIN')
        self.c=parse(self.config_raw)
        need(set(self.c)=={'schemaVersion','scope','releaseSha256','originalPlanSha256','entryPlanPath','entryPlanSha256','launcherSha256','unitSha256','systemctlSha256','expiresAt'} and self.c['schemaVersion']==1 and self.c['scope']=='cn-reviewed-additive-migration-v1','CONFIG_SCHEMA')
        need(self.c['releaseSha256']==release and self.c['originalPlanSha256']==self.descriptor['originalPlanSha256'],'CONFIG_IDENTITY')
        for key in ['releaseSha256','originalPlanSha256','entryPlanSha256','launcherSha256','unitSha256','systemctlSha256']:
            need(type(self.c[key])is str and re.fullmatch('[0-9a-f]{64}',self.c[key]),'CONFIG_HASH')
        need(type(self.c['expiresAt'])is int,'CONFIG_TIME')
        need(self.c['entryPlanPath'].startswith('/etc/workspacex-cn/maintenance-host/') and '..' not in Path(self.c['entryPlanPath']).parts,'ENTRY_PATH')
        self.critical_closure()
        self.expected=dispatch_spec(self.c);self.root=Path(ROOT)/release

    def critical_closure(self):
        # Re-read approved bytes, including paths derived only from the pinned plan.
        need(sha(protected(SELF,0o700))==self.profile['filesSha256'][SOURCE],'SELF_PIN')
        entry_raw=protected(self.c['entryPlanPath'],0o600);need(sha(entry_raw)==self.c['entryPlanSha256'],'ENTRY_PIN')
        entry=parse(entry_raw)
        need(entry['productionActionsAuthorized']is True and entry['host']['writerPlanSha256']==self.c['originalPlanSha256'],'ORIGINAL_AUTHORITY_BINDING')
        writer=protected(entry['host']['writerPlanPath'],0o600);need(sha(writer)==self.c['originalPlanSha256'],'ORIGINAL_PLAN_PIN')
        need(parse(writer).get('releaseContinuation',{}).get('scope')==self.c['scope'],'MIGRATION_SCOPE_REQUIRED')
        need(sha(protected(LAUNCHER,0o700))==self.c['launcherSha256'],'LAUNCHER_PIN')
        template=protected(TEMPLATE,0o644);need(template==unit_bytes() and sha(template)==self.c['unitSha256'],'UNIT_PIN')
        need(sha(protected(SYSTEMCTL,0o755,67108864))==self.c['systemctlSha256'],'SYSTEMCTL_PIN')

    def fresh(self,write=False):
        need(protected(PROFILE,0o600)==self.profile_raw and protected(self.config_path,0o600)==self.config_raw,'INSTALLATION_CHANGED')
        if write:
            self.critical_closure()
            need(time.time()<self.c['expiresAt'],'OWNER_DEADLINE')

    def command(self,args):
        # Start has its own final gate; callers cannot rely on an earlier check.
        self.fresh(write=bool(args and args[0]=='start'));need(sha(protected(SYSTEMCTL,0o755,67108864))==self.c['systemctlSha256'],'SYSTEMCTL_PIN')
        return subprocess.run([SYSTEMCTL,'--no-pager','--no-ask-password',*args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C'})

    def show(self):
        result=self.command(['show','--property=FragmentPath,DropInPaths,NeedDaemonReload,MainPID,InvocationID,ActiveState,SubState,ControlGroup',self.expected['unit']])
        need(result.returncode==0 and len(result.stdout)<=16384,'UNIT_OBSERVATION_FAILED')
        rows=result.stdout.decode().splitlines();value={}
        for row in rows:
            key,sep,val=row.partition('=');need(sep and key not in value,'UNIT_RESPONSE');value[key]=val
        need(set(value)=={'FragmentPath','DropInPaths','NeedDaemonReload','MainPID','InvocationID','ActiveState','SubState','ControlGroup'},'UNIT_RESPONSE')
        need(value['FragmentPath']==TEMPLATE and value['DropInPaths']=='' and value['NeedDaemonReload']=='no','UNIT_CONFIGURATION_DRIFT')
        return value

    def private(self,name):return protected(str(self.root/name),0o600)

    def put(self,name,raw):
        st=private_directory(self.root)
        fd=os.open(self.root/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            with os.fdopen(os.dup(fd),'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        finally:os.close(fd)
        parent=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:need(os.fstat(parent).st_ino==st.st_ino,'JOURNAL_CHANGED');os.fsync(parent)
        finally:os.close(parent)

    def start(self):
        self.fresh(write=True)
        # Parent is installed; creating its one exact release journal is local IO.
        parent=private_directory(ROOT)
        try:self.root.mkdir(mode=0o700)
        except FileExistsError:pass
        d=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(d)
        finally:os.close(d)
        rs=private_directory(self.root)
        lock=os.open(self.root/'dispatch.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        try:
            st=os.fstat(lock);need(stat.S_ISREG(st.st_mode) and st.st_uid==st.st_gid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600,'LOCK_TRUST')
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            need(stamp(os.fstat(lock))==stamp((self.root/'dispatch.lock').lstat()) and private_directory(self.root).st_ino==rs.st_ino,'LOCK_CHANGED')
            try:claim=self.private('claim.json')
            except FileNotFoundError:claim=None
            if claim is not None:
                need(claim==encode(self.expected),'CLAIM_CONFLICT');return self.observe()
            value=self.show();need(value['MainPID']=='0' and value['InvocationID']=='' and value['ActiveState']=='inactive','PREEXISTING_OWNER')
            self.put('claim.json',encode(self.expected));self.fresh(write=True)
            try:result=self.command(['start',self.expected['unit']])
            except (subprocess.TimeoutExpired,OSError):return {'state':'unknown','retryAllowed':False}
            if result.returncode!=0:return {'state':'unknown','retryAllowed':False}
            return self.observe()
        finally:os.close(lock)

    def own(self):
        self.fresh(write=True);claim=self.private('claim.json');need(claim==encode(self.expected),'CLAIM_MISMATCH')
        invocation=os.environ.get('INVOCATION_ID','');need(re.fullmatch('[0-9a-f]{32}',invocation),'SYSTEMD_INVOCATION_REQUIRED')
        observed=self.show();need(observed['InvocationID']==invocation and observed['MainPID']==str(os.getpid()),'SYSTEMD_OWNER_IDENTITY')
        ticks=int(Path('/proc/self/stat').read_text().rsplit(') ',1)[1].split()[19]);boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.put('started.json',encode({'claimSha256':sha(claim),'invocationId':invocation,'pid':os.getpid(),'startTicks':ticks,'bootId':boot}))
        self.fresh(write=True)
        raw=protected(LAUNCHER,0o700);need(sha(raw)==self.c['launcherSha256'],'LAUNCHER_PIN')
        fd=os.open(LAUNCHER,os.O_RDONLY|os.O_NOFOLLOW);os.set_inheritable(fd,True)
        need(sha(os.read(fd,1048577))==self.c['launcherSha256'],'LAUNCHER_FD_PIN');os.lseek(fd,0,0)
        os.execve('/usr/bin/python3',['/usr/bin/python3','-I','/proc/self/fd/'+str(fd),'--launch-reviewed-controller',self.c['entryPlanPath'],self.c['entryPlanSha256']],{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'})

    def observe(self):
        self.fresh();need(self.private('claim.json')==encode(self.expected),'CLAIM_MISMATCH');unit=self.show()
        try:started=parse(self.private('started.json'))
        except FileNotFoundError:return {'state':'unknown','retryAllowed':False}
        need(started['claimSha256']==sha(encode(self.expected)) and unit['InvocationID']==started['invocationId'],'OWNER_INVOCATION_CHANGED')
        # Exact owner remains alive/held on ambiguity. This adapter never stops it.
        if unit['MainPID']!='0':
            need(unit['MainPID']==str(started['pid']) and started['bootId']==Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'OWNER_PROCESS_CHANGED')
            ticks=int(Path('/proc/'+str(started['pid'])+'/stat').read_text().rsplit(') ',1)[1].split()[19])
            need(ticks==started['startTicks'],'OWNER_PROCESS_CHANGED')
            return {'state':'owner-running','retryAllowed':False,'terminalVerified':False}
        try:self.private('terminal-seal.json')
        except FileNotFoundError:return {'state':'unknown','retryAllowed':False}
        controller=self.profile['maintenanceHostController'];node=self.profile['maintenanceNodeRuntime']
        need(controller['path']=='/usr/local/lib/workspacex-cn/cn-maintenance-host-controller.cjs' and self.profile['filesSha256'][controller['sourcePath']]==controller['sha256'],'CONTROLLER_DESCRIPTOR')
        need(sha(protected(controller['path'],0o700))==controller['sha256'] and sha(protected(node['path'],0o755,268435456))==node['sha256'],'OBSERVER_EXECUTABLE_PIN')
        result=subprocess.run([node['path'],controller['path'],'--verify-reviewed-owner-terminal',self.c['entryPlanPath'],self.c['entryPlanSha256']],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'})
        need(result.returncode==0 and len(result.stdout)<=16384,'ORIGINAL_TERMINAL_REJECTED')
        value=parse(result.stdout);need(set(value)=={'rawSha256','originalPlanSha256','epochSha256','completionSha256','candidateSha256','canonicalReceiptSha256','browserReceiptSha256','publicTranscriptSha256','claimSha256','startedSha256'},'ORIGINAL_TERMINAL_SCHEMA')
        need(all(type(v)is str and re.fullmatch('[0-9a-f]{64}',v)for v in value.values()) and value['claimSha256']==sha(self.private('claim.json')) and value['startedSha256']==sha(self.private('started.json')),'ORIGINAL_TERMINAL_BINDING')
        need(self.show()==unit,'UNIT_OBSERVATION_CHANGED');self.fresh()
        return {'state':'canonical-evidence-verified','retryAllowed':False,'evidence':value}


def main(args):
    need(len(args)==2 and args[0] in ('--start-once','--own','--observe'),'USAGE')
    owner=Installed(args[1]);result={'--start-once':owner.start,'--own':owner.own,'--observe':owner.observe}[args[0]]()
    print(json.dumps(result,separators=(',',':')))


if __name__=='__main__':
    try:main(sys.argv[1:])
    except BaseException:
        print('{"state":"rejected-or-unknown","retryAllowed":false}')
        raise SystemExit(1)
