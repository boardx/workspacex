"""Two owned local fixture containers, no Compose/network/volume creation or cloud I/O.
Caller holds the port lease and an outer process Domain. Host networking is NOT
an egress policy. All external application protocols remain explicit fixtures.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import selectors
import subprocess
import stat
import time
_spec=importlib.util.spec_from_file_location('six_docker_primitives',Path(__file__).with_name('cn-release-fixture-docker-cleanup.py'))
_mod=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_mod)
def command(argv,deadline=None):
    end=min(time.monotonic()+10,deadline)if deadline is not None else time.monotonic()+10
    if time.monotonic()>=end:raise TimeoutError('SIX_COMMAND_DEADLINE')
    p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    selector=selectors.DefaultSelector();streams={p.stdout:bytearray(),p.stderr:bytearray()}
    for pipe in streams:selector.register(pipe,selectors.EVENT_READ)
    try:
        while selector.get_map():
            if time.monotonic()>=end:raise TimeoutError('SIX_COMMAND_DEADLINE')
            for key,_ in selector.select(min(.1,max(0,end-time.monotonic()))):
                block=os.read(key.fileobj.fileno(),4096)
                if not block:selector.unregister(key.fileobj);continue
                streams[key.fileobj].extend(block)
                if sum(map(len,streams.values()))>16384:raise RuntimeError('SIX_COMMAND_OUTPUT_LIMIT')
        p.wait(timeout=max(.001,end-time.monotonic()))
        if p.returncode:raise RuntimeError('SIX_COMMAND_FAILED')
        return bytes(streams[p.stdout]).decode('ascii',errors='strict').strip()
    finally:
        selector.close()
        if p.poll()is None:p.kill()
        p.wait(timeout=5) # bounded kill/reap grace, separate from command deadline
        for pipe in streams:pipe.close()

durable=_mod.durable
ROLES=('postgres','redis')
LIMITS={'postgres':{'memory':1073741824,'tmpfs':{'/var/lib/postgresql/data':'rw,nosuid,size=536870912'},'shm':134217728},'redis':{'memory':268435456,'tmpfs':{'/data':'rw,nosuid,size=134217728'},'shm':67108864}}
FIELDS='{"Id":{{json .Id}},"Image":{{json .Image}},"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"Cmd":{{json .Config.Cmd}},"HostConfig":{{json .HostConfig}},"Mounts":{{json .Mounts}},"State":{{json .State}}}'


class Owner:
    def __init__(self,output,run_id,round_id,commit,images,ports,db_name,deadline=None):
        self.deadline=deadline
        if os.geteuid()!=0 or not re.fullmatch('[1-9][0-9]*',run_id or '')or not re.fullmatch('round-[0-9]{2}',round_id or '')or not re.fullmatch('[a-f0-9]{40}',commit or ''):raise ValueError('SIX_OWNER_IDENTITY')
        info=output.lstat()
        if output.is_symlink()or not stat.S_ISDIR(info.st_mode)or info.st_uid!=0 or info.st_mode&0o077:raise ValueError('SIX_PRIVATE_OUTPUT')
        if set(images)!=set(ROLES)or set(ports)!=set(ROLES)or any(not re.fullmatch('sha256:[a-f0-9]{64}',images[r])for r in ROLES)or any(type(ports[r])is not int or not 1024<ports[r]<65536 for r in ROLES)or len(set(ports.values()))!=2 or not re.fullmatch('wsx_[a-f0-9]{20}',db_name):raise ValueError('SIX_FIXED_INPUTS')
        self.directory=output/'six-infra-owner';self.directory.mkdir(mode=0o700)
        self.identity=(self.directory.stat().st_dev,self.directory.stat().st_ino)
        self.token=secrets.token_hex(16);self.project='wsx-six-'+secrets.token_hex(8);self.docker=shutil.which('docker')
        if not self.docker:raise RuntimeError('DOCKER_CLI_REQUIRED')
        self.records={r:dict(imageId=images[r],port=ports[r],containerName=self.project+'-'+r,command=(['postgres','-c','listen_addresses=127.0.0.1','-c','shared_preload_libraries=age','-p',str(ports[r])]if r=='postgres'else['redis-server','--bind','127.0.0.1','--port',str(ports[r]),'--save','','--appendonly','no']))for r in ROLES}
        self.owner=dict(kind='cn-six-infra-owner-v1',ownerToken=self.token,runId=run_id,roundId=round_id,sourceCommit=commit,project=self.project,dbName=db_name,roles=self.records,resourceLimits=LIMITS,egressIsolated=False)
        durable(self.directory,'owner.json',self.owner)
        if self.list_ids():raise RuntimeError('SIX_OWNER_COLLISION')
    def call(self,args):
        deadline=getattr(self,'deadline',None)
        # Shared bounded CLI allows 10s response plus at most5s kill/reap.
        if deadline is not None and time.monotonic()>=deadline:raise TimeoutError('SIX_DAEMON_PHASE_DEADLINE')
        return command(args,deadline=deadline)
    def check_directory(self):
        i=self.directory.lstat()
        if self.directory.is_symlink()or(i.st_dev,i.st_ino)!=self.identity:raise RuntimeError('SIX_OWNER_REPLACED')
    def read(self,name):
        self.check_directory()
        try:fd=os.open(self.directory/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        except FileNotFoundError:return None
        with os.fdopen(fd,'rb')as f:
            i=os.fstat(f.fileno())
            if not stat.S_ISREG(i.st_mode)or i.st_uid!=0 or i.st_mode&0o077 or i.st_nlink!=1 or i.st_size>16384:raise RuntimeError('SIX_RECORD_INVALID')
            raw=f.read(16385)
        if len(raw)>16384:raise RuntimeError('SIX_RECORD_LIMIT')
        return json.loads(raw)
    def list_ids(self):
        values=self.call([self.docker,'ps','--all','--quiet','--no-trunc','--filter','label=cn-six-fixture='+self.token]).splitlines()
        if len(values)>2 or len(set(values))!=len(values)or any(not re.fullmatch('[a-f0-9]{64}',x)for x in values):raise RuntimeError('SIX_OWNER_LIST_INVALID')
        return values
    def inspect(self,cid,role):
        v=json.loads(self.call([self.docker,'inspect','--format',FIELDS,cid]));r=self.records[role];h=v.get('HostConfig',{})
        labels=v.get('Labels')or{};limit=LIMITS[role]
        if v.get('Id')!=cid or v.get('Image')!=r['imageId']or v.get('Name')!='/'+r['containerName']or v.get('Cmd')!=r['command']or any(labels.get(k)!=val for k,val in {'cn-six-fixture':self.token,'cn-six-project':self.project,'cn-six-role':role}.items()):raise RuntimeError('SIX_CONTAINER_BINDING')
        if h.get('NetworkMode')!='host'or h.get('Binds')or h.get('PortBindings')or h.get('Privileged')or h.get('Tmpfs')!=limit['tmpfs']or h.get('Memory')!=limit['memory']or h.get('ShmSize')!=limit['shm']or any(m.get('Type')!='tmpfs'for m in v.get('Mounts',[])):raise RuntimeError('SIX_CONTAINER_RESOURCES')
        return v
    def start(self,deadline=None):
        self.check_directory();self.deadline=min(time.monotonic()+120,deadline)if deadline is not None else time.monotonic()+120
        # Validate both images before creating either container. Unknown declared
        # volumes are rejected, never silently mounted as daemon-owned storage.
        for role in ROLES:
            r=self.records[role];v=json.loads(self.call([self.docker,'image','inspect','--format','{"Id":{{json .Id}},"Config":{"Volumes":{{json .Config.Volumes}}}}',r['imageId']]))
            if v.get('Id')!=r['imageId']or set((v.get('Config',{}).get('Volumes')or{}))-set(LIMITS[role]['tmpfs']):raise RuntimeError('SIX_IMAGE_VOLUME_CONTRACT')
        receipts={}
        for role in ROLES:
            r=self.records[role];limit=LIMITS[role]
            intent=dict(ownerToken=self.token,role=role,**r)
            durable(self.directory,role+'-create-intent.json',intent)
            args=[self.docker,'create','--pull','never','--name',r['containerName'],'--network','host','--memory',str(limit['memory']),'--shm-size',str(limit['shm'])]
            for k,v in {'cn-six-fixture':self.token,'cn-six-project':self.project,'cn-six-role':role}.items():args+=['--label',k+'='+v]
            for path,options in limit['tmpfs'].items():args+=['--tmpfs',path+':'+options]
            if role=='postgres':args+=['--env','POSTGRES_PASSWORD=postgres_dev','--env','POSTGRES_USER=postgres','--env','POSTGRES_DB=postgres','--env','PGPORT='+str(r['port'])]
            cid=self.call(args+[r['imageId']]+r['command'])
            if not re.fullmatch('[a-f0-9]{64}',cid):raise RuntimeError('SIX_CREATE_UNKNOWN')
            self.inspect(cid,role)
            receipt=dict(**intent,containerId=cid);durable(self.directory,role+'-create-receipt.json',receipt);receipts[role]=receipt
            durable(self.directory,role+'-start-intent.json',dict(containerId=cid,ownerToken=self.token))
            self.call([self.docker,'start',cid])
            if self.inspect(cid,role).get('State',{}).get('Running')is not True:raise RuntimeError('SIX_NOT_RUNNING')
        pg=receipts['postgres']['containerId'];port=str(self.records['postgres']['port']);deadline=min(self.deadline,time.monotonic()+60)
        while True:
            try:
                self.call([self.docker,'exec',pg,'pg_isready','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres']);break
            except RuntimeError:
                if time.monotonic()>=deadline:raise RuntimeError('SIX_PG_NOT_READY')
                time.sleep(.2)
        redis=receipts['redis']['containerId']
        if self.call([self.docker,'exec',redis,'redis-cli','-h','127.0.0.1','-p',str(self.records['redis']['port']),'ping'])!='PONG':raise RuntimeError('SIX_REDIS_NOT_READY')
        durable(self.directory,'database-create-intent.json',dict(containerId=pg,dbName=self.owner['dbName'],ownerToken=self.token))
        self.call([self.docker,'exec','--env','PGPASSWORD=postgres_dev',pg,'createdb','-U','postgres','-h','127.0.0.1','-p',port,self.owner['dbName']])
        observed=self.call([self.docker,'exec','--env','PGPASSWORD=postgres_dev',pg,'psql','-U','postgres','-h','127.0.0.1','-p',port,'-d',self.owner['dbName'],'-At','-c',"SELECT current_database() || '|' || current_setting('shared_preload_libraries')"])
        if observed!=self.owner['dbName']+'|age':raise RuntimeError('SIX_DATABASE_READBACK')
        result={k:self.owner[k]for k in ('ownerToken','runId','roundId','sourceCommit','project','dbName')};result.update(kind='cn-six-infra-v1',postgres=receipts['postgres'],redis=receipts['redis'],resourceLimits=LIMITS,egressIsolated=False)
        durable(self.directory,'infra-receipt.json',result);return result
    @property
    def environment(self):
        return {'CN_SIX_INFRA_RECEIPT':str(self.directory/'infra-receipt.json'),'CN_SIX_ROUND_ID':self.owner['roundId'],'CN_SIX_SOURCE_COMMIT':self.owner['sourceCommit'],'COMPOSE_PROJECT_NAME':self.project,'WORKSPACEX_DB':self.owner['dbName'],'PGHOST':'127.0.0.1','PGDATABASE':self.owner['dbName'],'PGPORT':str(self.records['postgres']['port']),'REDIS_PORT':str(self.records['redis']['port']),'NEXT_TELEMETRY_DISABLED':'1'}
    def close(self,receipt_name='cleanup.json',deadline=None):
        if receipt_name not in ('cleanup.json','recovery-cleanup.json'):raise ValueError('SIX_FIXED_CLEANUP_RECEIPT')
        self.check_directory();self.deadline=min(time.monotonic()+60,deadline)if deadline is not None else time.monotonic()+60
        records={};unknown=False
        for role in ROLES:
            intent=self.read(role+'-create-intent.json');receipt=self.read(role+'-create-receipt.json');expected=dict(ownerToken=self.token,role=role,**self.records[role])
            if intent is not None and intent!=expected:raise RuntimeError('SIX_INTENT_CHANGED')
            if receipt is not None and(intent is None or {k:v for k,v in receipt.items()if k!='containerId'}!=expected or not re.fullmatch('[a-f0-9]{64}',receipt.get('containerId',''))):raise RuntimeError('SIX_RECEIPT_CHANGED')
            unknown|=intent is not None and receipt is None;records[role]=(intent,receipt)
        previous=self.read(receipt_name)if receipt_name=='recovery-cleanup.json'else None
        if previous is not None and(previous.get('kind')!='cn-six-infra-cleanup-v1'or previous.get('ownerToken')!=self.token):raise RuntimeError('SIX_PRIOR_RECOVERY_INVALID')
        removed=[]
        live=self.list_ids()
        if previous is not None and live:raise RuntimeError('SIX_RECOVERED_CONTAINER_REAPPEARED')
        for cid in live:
            candidates=[]
            for role,(intent,receipt)in records.items():
                if intent is None or receipt is not None and receipt['containerId']!=cid:continue
                try:self.inspect(cid,role);candidates.append(role)
                except RuntimeError:continue
            if len(candidates)!=1:raise RuntimeError('SIX_REMOVE_IDENTITY_UNPROVEN')
            self.call([self.docker,'rm','--force',cid]);removed.append(cid)
        empty=not self.list_ids();value=dict(kind='cn-six-infra-cleanup-v1',ownerToken=self.token,verified=empty and not unknown,unacknowledgedCreate=unknown,daemonReadbackEmpty=empty,removedContainerIds=removed,egressIsolated=False)
        if previous is not None:
            value['verified']=value['verified']and previous.get('verified')is True;value['priorRecoveryRetained']=True
        else:durable(self.directory,receipt_name,value)
        return value


def restore(directory,run_id,round_id,commit):
    """Read only an exact CI-owned registry; never search daemon resources broadly."""
    if os.geteuid()!=0 or directory.name!='six-infra-owner' or directory.parent.name!=round_id or not re.fullmatch('round-(0[1-9]|10)',round_id):raise ValueError('SIX_RECOVERY_SCOPE')
    for path in (directory,*directory.parents):
        info=path.lstat()
        if not stat.S_ISDIR(info.st_mode)or path.is_symlink()or info.st_uid!=0 or info.st_mode&0o022:raise RuntimeError('SIX_RECOVERY_PARENT_UNTRUSTED')
    obj=Owner.__new__(Owner);obj.directory=directory;obj.identity=(directory.stat().st_dev,directory.stat().st_ino)
    owner=obj.read('owner.json')
    if not owner or owner.get('kind')!='cn-six-infra-owner-v1' or owner.get('runId')!=run_id or owner.get('roundId')!=round_id or owner.get('sourceCommit')!=commit or not re.fullmatch('[1-9][0-9]*',run_id)or not re.fullmatch('[a-f0-9]{40}',commit):raise RuntimeError('SIX_RECOVERY_IDENTITY')
    token=owner.get('ownerToken','');project=owner.get('project','');roles=owner.get('roles',{})
    if not re.fullmatch('[a-f0-9]{32}',token)or not re.fullmatch('wsx-six-[a-f0-9]{16}',project)or not re.fullmatch('wsx_[a-f0-9]{20}',owner.get('dbName',''))or set(roles)!=set(ROLES)or owner.get('resourceLimits')!=LIMITS:raise RuntimeError('SIX_RECOVERY_MANIFEST')
    for role,r in roles.items():
        port=r.get('port');expected=['postgres','-c','listen_addresses=127.0.0.1','-c','shared_preload_libraries=age','-p',str(port)]if role=='postgres'else['redis-server','--bind','127.0.0.1','--port',str(port),'--save','','--appendonly','no']
        if type(port)is not int or not 1024<port<65536 or not re.fullmatch('sha256:[a-f0-9]{64}',r.get('imageId',''))or r.get('containerName')!=project+'-'+role or r.get('command')!=expected:raise RuntimeError('SIX_RECOVERY_ROLE')
    if roles['postgres']['port']==roles['redis']['port']:raise RuntimeError('SIX_RECOVERY_PORT_COLLISION')
    obj.owner=owner;obj.records=roles;obj.token=token;obj.project=project;obj.docker=shutil.which('docker')
    if not obj.docker:raise RuntimeError('DOCKER_CLI_REQUIRED')
    return obj


def recover_all(root,run_id,commit,outer_cleanup,deadline=None):
    # Called from CI finally AFTER the actual enclosing Domain.close result.
    # A caller-supplied boolean is not permission to kill arbitrary containers:
    # exact independent root records and live image/name/labels still bind each.
    if not isinstance(outer_cleanup,dict)or outer_cleanup.get('verified')is not True or outer_cleanup.get('populated')!=0 or outer_cleanup.get('removed')is not True:raise RuntimeError('SIX_OUTER_DOMAIN_CLEANUP_UNPROVEN')
    results=[]
    if not root.exists():return dict(verified=True,rounds=[],kind='cn-six-recovery-v1')
    for path in (root,*root.parents):
        st=path.lstat()
        if path.is_symlink()or not stat.S_ISDIR(st.st_mode)or st.st_uid!=0 or st.st_mode&0o022:raise RuntimeError('SIX_RECOVERY_ROOT_UNTRUSTED')
    allowed={'round-%02d'%i for i in range(1,11)}
    if any(p.name not in allowed for p in root.iterdir()):raise RuntimeError('SIX_RECOVERY_UNKNOWN_ROUND')
    for rid in sorted(allowed):
        folder=root/rid
        if not folder.exists():continue
        directory=folder/'six-infra-owner'
        if directory.exists():
            owner=restore(directory,run_id,rid,commit)
            results.append(dict(roundId=rid,cleanup=owner.close('recovery-cleanup.json',deadline=deadline)))
        else:
            # Session cannot have issued a Docker create before this durable
            # owner exists. A malformed/symlink record is never treated absent.
            if directory.is_symlink():raise RuntimeError('SIX_RECOVERY_OWNER_SYMLINK')
    return dict(kind='cn-six-recovery-v1',verified=all(r['cleanup']['verified']for r in results),rounds=results)
