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


def command(argv):
    p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    selector=selectors.DefaultSelector();streams={p.stdout:bytearray(),p.stderr:bytearray()}
    for pipe in streams:selector.register(pipe,selectors.EVENT_READ)
    end=time.monotonic()+10
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
    def __init__(self,output,run_id,round_id):
        if os.geteuid()!=0 or not re.fullmatch('[1-9][0-9]*',run_id or '') or not re.fullmatch('round-[0-9]{2}',round_id):raise ValueError('DOCKER_OWNER_IDENTITY_REQUIRED')
        info=output.lstat()
        if output.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:raise ValueError('DOCKER_OWNER_PRIVATE_DIRECTORY_REQUIRED')
        self.directory=output/'api-container-owner';self.directory.mkdir(mode=0o700)
        self.token=secrets.token_hex(32)[:32];self.docker=shutil.which('docker')
        if not self.docker:raise RuntimeError('DOCKER_CLI_REQUIRED')
        self.identity=(self.directory.stat().st_dev,self.directory.stat().st_ino)
        durable(self.directory,'owner.json',dict(kind='cn-api-fixture-owner-v1',token=self.token,runId=run_id,roundId=round_id))
        if self.list_ids():raise RuntimeError('DOCKER_OWNER_COLLISION')
    @property
    def environment(self):return {'CN_API_STARTUP_OWNER_TOKEN':self.token,'CN_API_STARTUP_OWNER_DIR':str(self.directory)}
    def list_ids(self):
        values=command([self.docker,'ps','--all','--quiet','--no-trunc','--filter','label=cn-startup-fixture='+self.token]).splitlines()
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
    def close(self):
        info=self.directory.lstat()
        if self.directory.is_symlink() or (info.st_dev,info.st_ino)!=self.identity:raise RuntimeError('DOCKER_OWNER_DIRECTORY_CHANGED')
        intent=self.read('api-create-intent.json');receipt=self.read('api-create-receipt.json')
        for record in (intent,receipt):
            if record is not None and (record.get('token')!=self.token or not re.fullmatch('wsx-cn-api-[a-f0-9]{16}',record.get('containerName','')) or not re.fullmatch('sha256:[a-f0-9]{64}',record.get('imageId',''))):raise RuntimeError('DOCKER_OWNER_BINDING_CHANGED')
        if receipt is not None and (intent is None or any(receipt.get(k)!=intent.get(k)for k in ('token','containerName','imageId')) or not re.fullmatch('[a-f0-9]{64}',receipt.get('containerId',''))):raise RuntimeError('DOCKER_CREATE_RECEIPT_INVALID')
        removed=[]
        for cid in self.list_ids():
            if intent is None:raise RuntimeError('DOCKER_CONTAINER_WITHOUT_INTENT')
            observed=command([self.docker,'inspect','--format','{{.Id}} {{index .Config.Labels "cn-startup-fixture"}} {{.Image}} {{.Name}}',cid]).split()
            expected=[cid,self.token,intent['imageId'],'/'+intent['containerName']]
            if observed!=expected or receipt is not None and cid!=receipt['containerId']:raise RuntimeError('DOCKER_REMOVE_IDENTITY_MISMATCH')
            command([self.docker,'rm','--force',cid]);removed.append(cid)
        empty=not self.list_ids()
        verified=empty and not (intent is not None and receipt is None)
        value=dict(kind='cn-api-fixture-daemon-cleanup-v1',verified=verified,ownerToken=self.token,removedContainerIds=removed,daemonReadbackEmpty=empty,creationAcknowledged=receipt is not None,unacknowledgedCreate=intent is not None and receipt is None,intent=intent,receipt=receipt)
        durable(self.directory,'cleanup.json',value)
        return value
