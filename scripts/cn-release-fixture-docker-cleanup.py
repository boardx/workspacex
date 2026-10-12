"""Owned local Docker fixture cleanup; no global prune or provider operation."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import shutil
import stat
import subprocess
import time


def command(argv,deadline=None):
    if deadline is not None and time.monotonic()>=deadline:raise RuntimeError("DOCKER_DEADLINE_EXHAUSTED")
    p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    selector=selectors.DefaultSelector();streams={p.stdout:bytearray(),p.stderr:bytearray()}
    for pipe in streams:selector.register(pipe,selectors.EVENT_READ)
    end=min(time.monotonic()+10,deadline)if deadline is not None else time.monotonic()+10
    try:
        while selector.get_map():
            if time.monotonic()>=end:raise RuntimeError('DOCKER_RESPONSE_UNKNOWN')
            for key,_ in selector.select(.1):
                block=os.read(key.fileobj.fileno(),4096)
                if not block:selector.unregister(key.fileobj);continue
                streams[key.fileobj].extend(block)
                if sum(map(len,streams.values()))>16384:raise RuntimeError('DOCKER_RESPONSE_LIMIT')
        p.wait(timeout=max(.01,end-time.monotonic()))
        if p.returncode:raise RuntimeError('DOCKER_RESPONSE_FAILED')
        return bytes(streams[p.stdout]).decode('ascii',errors='strict').strip()
    finally:
        selector.close()
        if p.poll() is None:p.kill()
        p.wait(timeout=5)
        for stream in streams:stream.close()


def durable(directory,name,value):
    raw=(json.dumps(value,sort_keys=True)+'\n').encode()
    fd=os.open(directory/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


class Owner:
    def __init__(self,output,run_id,round_id,registry_name="api-container-owner"):
        if registry_name not in REGISTRY_NAMES:raise ValueError("DOCKER_REGISTRY_REJECTED")
        if os.geteuid()!=0 or not re.fullmatch('[1-9][0-9]*',run_id or '') or not re.fullmatch('round-[0-9]{2}',round_id):raise ValueError('DOCKER_OWNER_IDENTITY_REQUIRED')
        info=output.lstat()
        if output.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:raise ValueError('DOCKER_OWNER_PRIVATE_DIRECTORY_REQUIRED')
        self.directory=output/registry_name;self.directory.mkdir(mode=0o700)
        self.token=secrets.token_hex(32)[:32];self.docker=shutil.which('docker')
        if not self.docker:raise RuntimeError('DOCKER_CLI_REQUIRED')
        self.identity=(self.directory.stat().st_dev,self.directory.stat().st_ino)
        durable(self.directory,'owner.json',dict(kind='cn-api-fixture-owner-v1',token=self.token,runId=run_id,roundId=round_id))
        if self.list_ids():raise RuntimeError('DOCKER_OWNER_COLLISION')
    @property
    def environment(self):return {'CN_API_STARTUP_OWNER_TOKEN':self.token,'CN_API_STARTUP_OWNER_DIR':str(self.directory)}
    def call(self,argv):
        deadline=getattr(self,"deadline",None)
        return command(argv,deadline=deadline)if deadline is not None else command(argv)
    def list_ids(self):
        values=self.call([self.docker,'ps','--all','--quiet','--no-trunc','--filter','label=cn-startup-fixture='+self.token]).splitlines()
        if len(values)>4 or len(set(values))!=len(values) or any(not re.fullmatch('[a-f0-9]{64}',v)for v in values):raise RuntimeError('DOCKER_OWNER_LIST_INVALID')
        return values
    def read(self,name):
        try:fd=os.open(self.directory/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        except FileNotFoundError:return None
        with os.fdopen(fd,'rb')as stream:
            info=os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077 or info.st_nlink!=1 or info.st_size>8192:raise RuntimeError('DOCKER_OWNER_RECORD_INVALID')
            raw=stream.read(8193)
        if len(raw)>8192:raise RuntimeError('DOCKER_OWNER_RECORD_LIMIT')
        return json.loads(raw)
    def close(self,receipt_name="cleanup.json",deadline=None):
        self.deadline=deadline
        if receipt_name not in ("cleanup.json","recovery-cleanup.json"):raise ValueError("DOCKER_CLEANUP_NAME_REJECTED")
        info=self.directory.lstat()
        if self.directory.is_symlink() or (info.st_dev,info.st_ino)!=self.identity:raise RuntimeError('DOCKER_OWNER_DIRECTORY_CHANGED')
        intent=self.read('api-create-intent.json');receipt=self.read('api-create-receipt.json')
        for record in (intent,receipt):
            if record is not None and (record.get('token')!=self.token or not re.fullmatch('wsx-cn-api-[a-f0-9]{16}',record.get('containerName','')) or not re.fullmatch('sha256:[a-f0-9]{64}',record.get('imageId',''))):raise RuntimeError('DOCKER_OWNER_BINDING_CHANGED')
        if receipt is not None and (intent is None or any(receipt.get(k)!=intent.get(k)for k in ('token','containerName','imageId')) or not re.fullmatch('[a-f0-9]{64}',receipt.get('containerId',''))):raise RuntimeError('DOCKER_CREATE_RECEIPT_INVALID')
        removed=[]
        for cid in self.list_ids():
            if intent is None:raise RuntimeError('DOCKER_CONTAINER_WITHOUT_INTENT')
            observed=self.call([self.docker,'inspect','--format','{{.Id}} {{index .Config.Labels "cn-startup-fixture"}} {{.Image}} {{.Name}}',cid]).split()
            expected=[cid,self.token,intent['imageId'],'/'+intent['containerName']]
            if observed!=expected or receipt is not None and cid!=receipt['containerId']:raise RuntimeError('DOCKER_REMOVE_IDENTITY_MISMATCH')
            self.call([self.docker,'rm','--force',cid]);removed.append(cid)
        empty=not self.list_ids()
        verified=empty and not (intent is not None and receipt is None)
        value=dict(kind='cn-api-fixture-daemon-cleanup-v1',verified=verified,ownerToken=self.token,removedContainerIds=removed,daemonReadbackEmpty=empty,creationAcknowledged=receipt is not None,unacknowledgedCreate=intent is not None and receipt is None,intent=intent,receipt=receipt)
        prior=self.read(receipt_name)
        if prior is not None:
            if prior.get('kind')!='cn-api-fixture-daemon-cleanup-v1' or prior.get('ownerToken')!=self.token:raise RuntimeError('DOCKER_PRIOR_CLEANUP_INVALID')
            value['verified']=value['verified'] and prior.get('verified')is True
            value['priorRecoveryRetained']=True
        else:durable(self.directory,receipt_name,value)
        return value


REGISTRY_NAMES=('api-container-owner','application-recovery-owner')
def trusted_directory(directory):
    if directory.resolve(strict=True)!=directory:raise ValueError('DOCKER_RECOVERY_CANONICAL_REQUIRED')
    for parent in (directory,*directory.parents):
        info=parent.lstat()
        if not stat.S_ISDIR(info.st_mode)or info.st_uid!=0 or info.st_mode&0o022:raise ValueError('DOCKER_RECOVERY_ANCESTRY_REJECTED')
    if stat.S_IMODE(directory.stat().st_mode)!=0o700:raise ValueError('DOCKER_RECOVERY_PRIVATE_REQUIRED')

def restore(directory,run_id,round_id):
    directory=Path(directory)
    if directory.name not in REGISTRY_NAMES or directory.parent.name!=round_id or not re.fullmatch('round-(0[1-9]|10)',round_id):raise ValueError('DOCKER_RECOVERY_PATH_REJECTED')
    trusted_directory(directory)
    obj=Owner.__new__(Owner);obj.directory=directory;obj.identity=(directory.stat().st_dev,directory.stat().st_ino)
    record=obj.read('owner.json')
    if not isinstance(record,dict)or record.get('kind')!='cn-api-fixture-owner-v1' or record.get('runId')!=run_id or record.get('roundId')!=round_id or not re.fullmatch('[a-f0-9]{32}',record.get('token','')):raise ValueError('DOCKER_RECOVERY_OWNER_REJECTED')
    obj.token=record['token'];obj.docker=shutil.which('docker')
    if not obj.docker:raise RuntimeError('DOCKER_CLI_REQUIRED')
    return obj

def recover_all(output,run_id,outer_cleanup,deadline=None):
    deadline=min(time.monotonic()+120,deadline)if deadline is not None else time.monotonic()+120
    if not isinstance(outer_cleanup,dict)or outer_cleanup.get('verified')is not True or outer_cleanup.get('populated')!=0 or outer_cleanup.get('removed')is not True:raise ValueError('DOCKER_RECOVERY_OUTER_UNPROVEN')
    results={}
    for index in range(1,11):
        rid='round-%02d'%index
        for name in REGISTRY_NAMES:
            path=Path(output)/rid/name
            if not path.exists()and not path.is_symlink():continue
            try:results[rid+'/'+name]=restore(path,run_id,rid).close('recovery-cleanup.json',deadline=deadline)
            except Exception as error:results[rid+'/'+name]={'verified':False,'errorType':type(error).__name__}
    return {'verified':all(v.get('verified')is True for v in results.values()),'owners':results}
