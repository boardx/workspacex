"""Existing retained host readback adapter. No clients, subprocesses or SQL at import.

Fixed offline staging requires the exact root-approved APP Compose emitter,
source refs, trusted Docker authority and existing closed retained actor.
"""
import copy
import hashlib,json,os,pathlib,re,stat
from candidate_writer import APP
from candidate_completion_contract import verify_completion
from candidate_stage_actions import DOCKER_PREFIX,SERVICES
from fixed_probes import FixedProbes
from writer_fence import require, digest

def candidate_stage_profile_sha256(profile):
    """Bind every stage authority except the one receipt-dependent late input.

    Canonical acceptance names this snapshot's hash, so its root-approved input
    cannot participate in that hash. The dispatcher separately verifies its
    exact protected path and bytes before execution. No other authority or input
    is excluded, and each operation still rechecks the full raw profile.
    """
    require(type(profile) is dict,'CANDIDATE_STAGE_PROFILE_SCHEMA')
    frozen=copy.deepcopy(profile)
    entry=frozen.get('maintenanceSourceOperations')
    if entry is not None:
        require(type(entry) is dict and type(entry.get('inputs')) is dict,
                'CANDIDATE_STAGE_PROFILE_INPUT_SCHEMA')
        entry['inputs'].pop('canonical-candidate-acceptance',None)
    return digest(frozen)

def verify_none_endpoint(container,source_none,allow_unallocated=False):
    """Actual builtin null-driver identity plus closed endpoint isolation facts."""
    require(type(source_none) is dict and source_none.get('Name')=='none' and source_none.get('Driver')=='null' and
        source_none.get('Scope')=='local' and re.fullmatch('[a-f0-9]{64}',source_none.get('Id','')) and
        type(source_none.get('Containers')) is dict,'CANDIDATE_STAGE_NONE_DRIVER')
    require(type(allow_unallocated) is bool and type(container) is dict and
        type(container.get('Id')) is str and re.fullmatch('[a-f0-9]{64}',container['Id']) and
        set(container.get('NetworkSettings',{}).get('Networks',{}))=={'none'} and
        type(container.get('State',{}).get('Running')) is bool and type(container.get('State',{}).get('Paused')) is bool,
        'CANDIDATE_STAGE_NONE_CONTAINER')
    endpoint=container['NetworkSettings']['Networks']['none'];container_id=container['Id']
    required={'IPAMConfig','Links','Aliases','MacAddress','NetworkID','EndpointID','Gateway','IPAddress','IPPrefixLen',
        'IPv6Gateway','GlobalIPv6Address','GlobalIPv6PrefixLen','DNSNames'}
    require(type(endpoint) is dict and required<=set(endpoint) and
        set(endpoint)<=required|{'DriverOpts','GwPriority'},'CANDIDATE_STAGE_NONE_ENDPOINT_SCHEMA')
    require(all(endpoint[k]=='' for k in ('MacAddress','Gateway','IPAddress','IPv6Gateway','GlobalIPv6Address')) and
        all(type(endpoint[k]) is int and endpoint[k]==0 for k in ('IPPrefixLen','GlobalIPv6PrefixLen')) and
        all(endpoint[k] is None or endpoint[k]==[] for k in ('Links','Aliases','DNSNames')) and
        endpoint['IPAMConfig'] is None and (endpoint.get('DriverOpts') is None or endpoint['DriverOpts']=={}) and
        type(endpoint.get('GwPriority',0)) is int and endpoint.get('GwPriority',0)==0,
        'CANDIDATE_STAGE_NONE_ENDPOINT_ISOLATION')
    owner=source_none['Containers'].get(container_id)
    unallocated=(allow_unallocated and container.get('State',{}).get('Running') is False and
        container.get('State',{}).get('Paused') is False and endpoint['NetworkID']=='' and
        endpoint['EndpointID']=='' and owner is None)
    require(endpoint['NetworkID']==source_none['Id'] or unallocated,'CANDIDATE_STAGE_NONE_NETWORK_IDENTITY')
    owner=source_none['Containers'].get(container_id)
    if owner is None:
        require(container['State']['Running'] is False and container['State']['Paused'] is False and
            endpoint['EndpointID']=='','CANDIDATE_STAGE_NONE_ENDPOINT_OWNER')
    else:
        require(type(owner) is dict and re.fullmatch('[a-f0-9]{64}',owner.get('EndpointID','')) and
            endpoint['EndpointID']==owner['EndpointID'] and owner.get('MacAddress','')=='' and
            owner.get('IPv4Address','')=='' and owner.get('IPv6Address','')=='',
            'CANDIDATE_STAGE_NONE_ENDPOINT_OWNER')
    return True

class CandidateStageHost:
    def __init__(self, host, journal):
        require(journal.value['identity']==host.plan['identity'],'CANDIDATE_STAGE_JOURNAL_BINDING')
        self.host,self.journal=host,journal
    def require_lock(self): self.host.require_lock()
    def observe_hold(self):
        self.require_lock();v=self.host.read_hold()
        require(v['identity']==self.host.plan['identity'] and v['generation']==self.host.plan['holdGeneration'],
                'CANDIDATE_STAGE_HOLD_BINDING')
        return dict(schemaVersion=v['schemaVersion'],state=v['state'],generation=v['generation'],
                    identity=v['identity'],host=copy.deepcopy(self.host.plan['host']))
    def observe_admission(self):
        self.require_lock();result,_=FixedProbes(self.host).admission()
        return result['login']
    def observe_baseline(self):
        self.require_lock();inventory=self._trusted_inventory();index={c['Id']:c for c in inventory}
        require(len(index)==len(inventory),'CANDIDATE_STAGE_INVENTORY_DUPLICATE')
        selected=[];projects=set()
        for writer in self.host.plan['writers']:
            b=writer['binding'];c=index.get(b['containerId'])
            require(c is not None and c['Image']==b['imageId'] and digest(c['Config'])==b['configSha256'],
                    'CANDIDATE_STAGE_BASELINE_DRIFT')
            labels=c['Config']['Labels']
            require(labels.get('com.docker.compose.service')==b['service'] and
                    labels.get('com.docker.compose.project.config_files')==b['composePath'],
                    'CANDIDATE_STAGE_BASELINE_COMPOSE')
            projects.add(labels.get('com.docker.compose.project'));selected.append(copy.deepcopy(c))
        require(len(projects)==1 and None not in projects and selected,'CANDIDATE_STAGE_BASELINE_PROJECT')
        return dict(projectName=projects.pop(),containers=selected)
    def inspect_stage(self,project):
        self.require_lock()
        require(type(project) is str and project,'CANDIDATE_STAGE_PROJECT')
        return [copy.deepcopy(c) for c in self._trusted_inventory()
                if c['Config'].get('Labels',{}).get('com.docker.compose.project')==project]
    def _trusted_inventory(self):
        self.require_lock();raw,_,e=self._profile()
        socket=self._socket(e);fd=self._open_executable(e['dockerPath'],e['dockerSha256'],0o755)
        prefix='/proc/'+str(os.getpid())+'/fd/'+str(fd)
        try:
            ids=self.host.run([prefix,*DOCKER_PREFIX,'ps','-aq','--no-trunc']).decode().splitlines()
            require(len(ids)==len(set(ids)) and len(ids)<=1024 and all(re.fullmatch('[a-f0-9]{64}',v) for v in ids),
                'CANDIDATE_STAGE_DOCKER_INVENTORY_IDS')
            rows=[]
            for cid in ids:
                value=json.loads(self.host.run([prefix,*DOCKER_PREFIX,'inspect',cid]))
                require(type(value) is list and len(value)==1 and value[0]['Id']==cid,'CANDIDATE_STAGE_DOCKER_INVENTORY_BINDING')
                rows.append(value[0])
        finally:os.close(fd)
        require(self._profile()[0]==raw and self._socket(e)==socket,'CANDIDATE_STAGE_INVENTORY_AUTHORITY_DRIFT')
        return rows
    def _profile(self):
        from host_transport import private
        raw=private('/etc/workspacex-cn/trusted-tool-binding.json');p=json.loads(raw)
        entry=p.get('candidateComposeEmitter')
        require(type(entry) is dict and set(entry)=={'schemaVersion','path','sha256','nodePath','nodeSha256',
            'sourceClosureRef','configRef','optionsRef','dockerPath','dockerSha256','dockerSocket'},'CANDIDATE_STAGE_SOURCE_CAPABILITY')
        require(entry['schemaVersion']==1 and p['toolRevision']==self.host.plan['toolRevision'] and
            entry['dockerPath']=='/usr/bin/docker','CANDIDATE_STAGE_SOURCE_PROFILE')
        require(entry['nodePath']=='/usr/bin/node' or
            re.fullmatch('/opt/workspacex/releases/[a-f0-9]{40}/release-tools/node',entry['nodePath']),
            'CANDIDATE_STAGE_NODE_PATH')
        for refname in ('sourceClosureRef','configRef','optionsRef'):
            r=entry[refname];require(type(r) is dict and set(r)=={'path','sha256'} and
                r['path'].startswith('/etc/workspacex-cn/') and '..' not in pathlib.Path(r['path']).parts,
                'CANDIDATE_STAGE_PROFILE_REFERENCE')
        return raw,p,entry
    def _read_ref(self,r):
        from host_transport import private
        raw=private(r['path']);require(hashlib.sha256(raw).hexdigest()==r['sha256'],'CANDIDATE_STAGE_SOURCE_HASH')
        return raw
    def _open_executable(self,path,sha,mode):
        p=pathlib.Path(path);require(p.is_absolute() and '..' not in p.parts,'CANDIDATE_STAGE_EXEC_PATH')
        for ancestor in p.parents:
            s=ancestor.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'CANDIDATE_STAGE_EXEC_PARENT')
        fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            s=os.fstat(fd);require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and
                stat.S_IMODE(s.st_mode)==mode,'CANDIDATE_STAGE_EXEC_TRUST')
            h=hashlib.sha256()
            while True:
                raw=os.read(fd,1024*1024)
                if not raw:break
                h.update(raw)
            require(h.hexdigest()==sha,'CANDIDATE_STAGE_EXEC_HASH');os.lseek(fd,0,os.SEEK_SET)
            return fd
        except BaseException:
            os.close(fd);raise
    def _recheck(self):
        raw,_,entry=self._profile();require(raw==self.profile_raw,'CANDIDATE_STAGE_PROFILE_DRIFT')
        for r,b in self.source_reads:require(self._read_ref(r)==b,'CANDIDATE_STAGE_SOURCE_DRIFT')
        return entry
    def verify_frozen_compose(self,inputs,manifest):
        self.require_lock();raw,profile,e=self._profile();self.profile_raw=raw;self.source_reads=[]
        def read(r):
            b=self._read_ref(r);self.source_reads.append((copy.deepcopy(r),b));return json.loads(b)
        closure=read(e['sourceClosureRef'])
        require(closure['schemaVersion']==1 and closure['sourceRevision']==APP and
            closure['bundleSha256']==e['sha256'] and type(closure['sources']) is dict and
            type(closure['dependencies']) is dict and
            set(closure)=={'schemaVersion','sourceRevision','compiler','sources','dependencies','lockfileSha256','bundleSha256','bundledInputs'},'CANDIDATE_STAGE_EMITTER_CLOSURE')
        native=('compose.ts','config.ts','storage-config.ts','release.ts','image-reference.ts','runtime-bundle.ts')
        require(all('packages/cloud-deploy/src/'+name in closure['sources'] for name in native),
            'CANDIDATE_STAGE_NATIVE_SOURCE_CLOSURE')
        for path,value in closure['sources'].items():
            require(profile['filesSha256'].get(path)==value['sha256'],'CANDIDATE_STAGE_ROOT_SOURCE_CLOSURE')
        for path,value in closure['dependencies'].items():
            require(profile['filesSha256'].get(path)==value,'CANDIDATE_STAGE_DEPENDENCY_CLOSURE')
        require(profile['filesSha256'].get('pnpm-lock.yaml')==closure['lockfileSha256'] and
            set(closure['bundledInputs'])<=set(closure['sources'])|set(closure['dependencies']),
            'CANDIDATE_STAGE_LOCK_AND_BUNDLE_CLOSURE')
        config=read(e['configRef']);options=read(e['optionsRef'])
        require(type(options) is dict and set(options)=={'projectName','runtimeDirectory','runtimeFiles','manifestRef','composeRef','networkRef'},
            'CANDIDATE_STAGE_OPTIONS_SCHEMA')
        require(options['projectName']!=self.observe_baseline()['projectName'] and
            options['runtimeDirectory'].startswith('/etc/workspacex-cn/') and
            '..' not in pathlib.Path(options['runtimeDirectory']).parts,'CANDIDATE_STAGE_RUNTIME_PATH')
        require(options['manifestRef']==inputs['manifest'] and options['composeRef']==inputs['compose'],
            'CANDIDATE_STAGE_ROOT_INPUT_REFS')
        self.approved_network=read(options['networkRef'])
        require(set(self.approved_network)=={'Id','Name','Driver','Internal','IPAM','Options'} and
            self.approved_network['Name']==options['projectName']+'-runtime' and
            self.approved_network['Driver']=='bridge' and self.approved_network['Internal'] is False,
            'CANDIDATE_STAGE_SOURCE_NETWORK')
        require(type(options['runtimeFiles']) is dict,'CANDIDATE_STAGE_RUNTIME_FILES')
        self.runtime_files={}
        for path,ref in options['runtimeFiles'].items():
            require(path==ref['path'] and path.startswith(options['runtimeDirectory']+'/') and
                '..' not in pathlib.Path(path).parts,'CANDIDATE_STAGE_RUNTIME_FILE_PATH')
            b=self._read_ref(ref);self.source_reads.append((copy.deepcopy(ref),b));self.runtime_files[path]=b
        request=dict(schemaVersion=1,sourceRevision=APP,config=config,manifest=manifest,
            options={k:options[k] for k in ('projectName','runtimeDirectory')})
        nodefd=self._open_executable(e['nodePath'],e['nodeSha256'],0o755)
        try:
            sourcefd=self._open_executable(e['path'],e['sha256'],0o700)
            try:
                prefix='/proc/'+str(os.getpid())+'/fd/'
                output=self.host.run([prefix+str(nodefd),prefix+str(sourcefd)],input_raw=json.dumps(request).encode())
            finally:os.close(sourcefd)
        finally:os.close(nodefd)
        compose=json.loads(output);require(set(compose)=={'name','services','networks'},'CANDIDATE_STAGE_EMITTER_OUTPUT')
        require(compose['name']==options['projectName'] and compose['networks']=={'default':{'external':True,
            'name':options['projectName']+'-runtime'}},'CANDIDATE_STAGE_EMITTER_OPTIONS')
        require(set(compose['services'])==set(SERVICES),'CANDIDATE_STAGE_EMITTER_SERVICES')
        self.runtime_directory=options['runtimeDirectory']
        for cfg in compose['services'].values():
            for option in cfg.get('security_opt',[]):
                if option.startswith('seccomp='):require(option[8:] in self.runtime_files,'CANDIDATE_STAGE_SECCOMP_SOURCE_FILE')
            for item in cfg.get('env_file',[]):require(item['path'] in self.runtime_files,'CANDIDATE_STAGE_ENV_SOURCE_FILE')
        self.compose=copy.deepcopy(compose);self.inputs=copy.deepcopy(inputs);self.manifest=copy.deepcopy(manifest)
        self.intent_recorded=False;self.image_configs={};self.network_before=None
        self._recheck();return compose
    def _socket(self,e):
        expected=e['dockerSocket'];require(type(expected) is dict and set(expected)=={'device','inode','uid','gid','mode'},
            'CANDIDATE_STAGE_SOCKET_SCHEMA')
        p=pathlib.Path('/run/docker.sock')
        for a in p.parents:
            s=a.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'CANDIDATE_STAGE_SOCKET_PARENT')
        s=p.lstat();actual=dict(device=s.st_dev,inode=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode))
        require(stat.S_ISSOCK(s.st_mode) and actual==expected and s.st_uid==0 and s.st_gid==0 and
            not s.st_mode&0o007,'CANDIDATE_STAGE_SOCKET_AUTHORITY')
        cfg=pathlib.Path('/etc/workspacex-cn/docker-offline');c=cfg.lstat()
        require(stat.S_ISDIR(c.st_mode) and c.st_uid==0 and c.st_gid==0 and stat.S_IMODE(c.st_mode)==0o700 and
            list(cfg.iterdir())==[],'CANDIDATE_STAGE_OFFLINE_DOCKER_CONFIG')
        return actual
    def run_docker(self,args):
        require(type(args) is list and tuple(args[:len(DOCKER_PREFIX)])==DOCKER_PREFIX,'CANDIDATE_STAGE_DOCKER_FIXED_PREFIX')
        require(hasattr(self,'compose'),'CANDIDATE_STAGE_COMPOSE_SOURCE_REQUIRED');self.require_lock();e=self._recheck()
        tail=args[len(DOCKER_PREFIX):];project=self.compose['name']
        images={v['image'] for v in self.compose['services'].values()}
        image= len(tail)==3 and tail[:2]==['image','inspect'] and tail[2] in images
        network=tail==['network','inspect',project+'-runtime']
        none=tail==['network','inspect','none']
        create=tail==['compose','--project-name',project,'--file',self.inputs['compose']['path'],
            'create','--no-build','--pull','never','--no-deps',*SERVICES]
        require(image or network or none or create,'CANDIDATE_STAGE_DOCKER_COMMAND')
        if create:
            require(self.intent_recorded and self.network_before is not None,'CANDIDATE_STAGE_DURABLE_INTENT_REQUIRED')
            require(self.observe_hold()['state']=='held' and all(v is False for roles in self.observe_admission().values()
                for v in roles.values()),'CANDIDATE_STAGE_MUTATION_ADMISSION')
        sock=self._socket(e);fd=self._open_executable(e['dockerPath'],e['dockerSha256'],0o755)
        try:
            out=self.host.run(['/proc/'+str(os.getpid())+'/fd/'+str(fd),*args])
        finally:os.close(fd)
        require(self._socket(e)==sock,'CANDIDATE_STAGE_SOCKET_DRIFT');self._recheck()
        if create:return None
        data=json.loads(out);require(type(data) is list and len(data)==1,'CANDIDATE_STAGE_INSPECT_ONE')
        if image:self.image_configs[tail[2]]=copy.deepcopy(data[0]['Config'])
        if none:
            require(data[0].get('Name')=='none' and data[0].get('Driver')=='null' and data[0].get('Scope')=='local' and
                re.fullmatch('[a-f0-9]{64}',data[0].get('Id','')) and type(data[0].get('Containers')) is dict,
                'CANDIDATE_STAGE_NONE_DRIVER')
        if network:
            require(data[0]['Name']==project+'-runtime' and data[0]['Driver']=='bridge' and data[0]['Internal'] is False,
                'CANDIDATE_STAGE_PREEXISTING_NETWORK')
            fact={k:data[0][k] for k in ('Id','Name','Driver','Internal','IPAM','Options')}
            require(fact==self.approved_network,'CANDIDATE_STAGE_SOURCE_NETWORK_DRIFT')
            if self.network_before is None:self.network_before=fact
            else:require(fact==self.network_before,'CANDIDATE_STAGE_NETWORK_DRIFT')
        return data
    def record_stage_intent(self,bound,intent):
        require(bound['identity']==self.host.plan['identity'] and bound['host']==self.host.plan['host']
                and bound['holdGeneration']==self.host.plan['holdGeneration'],'CANDIDATE_STAGE_INTENT_BINDING')
        self._recheck();require(intent==dict(compose=self.inputs['compose'],manifest=self.inputs['manifest'],
            projectName=self.compose['name']),'CANDIDATE_STAGE_INTENT_SOURCE')
        item=dict(binding=copy.deepcopy(bound),refs=copy.deepcopy(intent),sourceProfileSha256=hashlib.sha256(self.profile_raw).hexdigest())
        previous=self.journal.value.get('candidateStageIntent')
        require(previous is None or previous==item,'CANDIDATE_STAGE_INTENT_CONFLICT')
        self.journal.value['candidateStageIntent']=item
        self.journal.record('candidate-stage-intent',candidateStageIntent=item);self.intent_recorded=True
    def verify_stage_configuration(self,service,cfg,c):
        self._recheck();require(cfg==self.compose['services'][service],'CANDIDATE_STAGE_SOURCE_SERVICE')
        base=self.image_configs[cfg['image']];actual=c['Config'];hc=c['HostConfig']
        env={}
        for entry in base.get('Env') or []:
            k,sep,v=entry.partition('=');require(sep,'CANDIDATE_STAGE_IMAGE_ENV');env[k]=v
        for f in cfg.get('env_file',[]):
            require(set(f)=={'path','format'} and f['format']=='raw' and f['path'] in self.runtime_files,'CANDIDATE_STAGE_NATIVE_ENV_FILE')
            text=self.runtime_files[f['path']].decode();require('\x00' not in text,'CANDIDATE_STAGE_ENV_NUL')
            for line in text.splitlines():
                if not line or line.startswith('#'):continue
                k,sep,v=line.partition('=');require(sep and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',k),'CANDIDATE_STAGE_RAW_ENV');env[k]=v
        env.update({k:str(v) for k,v in cfg.get('environment',{}).items()})
        observed={}
        for entry in actual.get('Env') or []:
            k,sep,v=entry.partition('=');require(sep and k not in observed,'CANDIDATE_STAGE_ENV_DUPLICATE');observed[k]=v
        require(observed==env and actual.get('User','')==cfg.get('user',base.get('User','')) and
            actual.get('Entrypoint')==base.get('Entrypoint') and actual.get('Cmd')==base.get('Cmd') and
            actual.get('WorkingDir','')==base.get('WorkingDir',''),'CANDIDATE_STAGE_CONFIG_DRIFT')
        require(hc.get('Privileged') is False and hc.get('ReadonlyRootfs')==cfg.get('read_only',False) and
            set(hc.get('CapDrop') or [])==set(cfg['cap_drop']) and not hc.get('CapAdd') and
            set(hc.get('SecurityOpt') or [])==set(cfg['security_opt']) and hc.get('Init')==cfg['init'] and
            hc.get('PidsLimit')==cfg['pids_limit'] and hc.get('RestartPolicy',{}).get('Name')==cfg['restart'] and
            hc.get('NetworkMode')==('none' if service in ('sandbox','sandbox-sessions') else self.compose['name']+'-runtime'),
            'CANDIDATE_STAGE_HOST_CONFIG_DRIFT')
        units={'g':1024**3,'m':1024**2}
        def size(v):return int(v[:-1])*units[v[-1]]
        require(hc.get('Memory')==size(cfg['mem_limit']) and hc.get('NanoCpus')==int(cfg['cpus']*10**9) and
            ('memswap_limit' not in cfg or hc.get('MemorySwap')==size(cfg['memswap_limit'])) and
            hc.get('LogConfig')==cfg['logging'],'CANDIDATE_STAGE_RESOURCE_DRIFT')
        tmpfs={}
        for item in cfg.get('tmpfs',[]):
            target,sep,opts=item.partition(':');require(sep,'CANDIDATE_STAGE_TMPFS_SOURCE');tmpfs[target]=opts
        require((hc.get('Tmpfs') or {})==tmpfs and hc.get('PublishAllPorts') is False and
            hc.get('AutoRemove') is False and not hc.get('GroupAdd') and not hc.get('Sysctls') and
            not hc.get('Dns') and not hc.get('DnsSearch') and not hc.get('DnsOptions') and
            hc.get('PidMode','')=='' and hc.get('CgroupnsMode') in ('private',''),
            'CANDIDATE_STAGE_EXTRA_HOST_CONFIG')
        expected_mounts={v['target']:(v['source'],not v.get('read_only',False)) for v in cfg.get('volumes',[])}
        mounts={}
        for m in c['Mounts']:
            if m['Type']=='tmpfs':
                require(m['Destination'] in tmpfs and m.get('Source','')=='' and m['RW'] is True,
                    'CANDIDATE_STAGE_TMPFS_MOUNT')
                continue
            require(m['Type']=='bind' and m['Destination'] not in mounts,'CANDIDATE_STAGE_MOUNT_TYPE')
            mounts[m['Destination']]=(m['Source'],m['RW'])
        require(mounts==expected_mounts and not hc.get('VolumesFrom') and not hc.get('Devices') and
            not hc.get('DeviceRequests') and not hc.get('ExtraHosts') and not hc.get('Links'), 'CANDIDATE_STAGE_MOUNT_DRIFT')
        ports={}
        for p in cfg.get('ports',[]):
            ip,hport,cport=p.split(':');ports[cport+'/tcp']=[dict(HostIp=ip,HostPort=hport)]
        require((hc.get('PortBindings') or {})==ports,'CANDIDATE_STAGE_PORT_BINDINGS')
        nets=c['NetworkSettings'].get('Networks',{})
        require(set(nets)==({'none'} if service in ('sandbox','sandbox-sessions') else {self.compose['name']+'-runtime'}),
            'CANDIDATE_STAGE_NETWORK_SETTINGS')
        if service in ('sandbox','sandbox-sessions'):
            source_none=self.run_docker([*DOCKER_PREFIX,'network','inspect','none'])[0]
            verify_none_endpoint(c,source_none,allow_unallocated=True)
        if service=='agent':require('agent' in (nets[self.compose['name']+'-runtime'].get('Aliases') or []),
            'CANDIDATE_STAGE_AGENT_NETWORK_ALIAS')
        self._recheck();return True

    def verify_current_epoch(self,refs,bound):
        # Fixed root profile, schema-2 raw input, source policy, all five existing
        # publications. This repeats qualification; it cannot publish artifacts.
        import json,hashlib,pathlib
        import current_epoch_qualification as q
        from host_transport import private
        exact=q.exact;need=q.need
        exact(refs,('collection','manifest'),'CANDIDATE_EPOCH_REFS')
        self.require_lock()
        attempt=bound['identity']['attemptId'];root=pathlib.Path('/etc/workspacex-cn/maintenance-evidence')/q.APP/attempt
        profile_raw=private('/etc/workspacex-cn/trusted-tool-binding.json')
        profile=json.loads(profile_raw)
        entry=profile.get('currentEpochQualification')
        exact(entry,('schemaVersion','sourcePath','sha256','input','sourcePolicy','executablePins'),'CANDIDATE_EPOCH_CAPABILITY')
        need(entry['schemaVersion']==2 and entry['sourcePath']=='.harness/scripts/vm/current_epoch_qualification.py' and
             entry['sha256']==hashlib.sha256(pathlib.Path(q.__file__).read_bytes()).hexdigest() and
             profile['filesSha256'].get(entry['sourcePath'])==entry['sha256'] and
             entry['input']['path']==str(root/'qualification-input.json') and
             refs['manifest']['path']==str(root/'qualified-current-epoch/epoch.json'),'CANDIDATE_EPOCH_SOURCE_BINDING')
        reader=q.recovery.ProtectedArtifacts(root)
        p=reader.json(entry['input']);need(p['schemaVersion']==2 and
             all(p['binding'][k]==bound[k] for k in bound) and
             p['binding']['toolRevision']==profile['toolRevision'] and
             p['collection']==refs['collection'] and p['outputRoot']==str(root/'qualified-current-epoch'),
             'CANDIDATE_EPOCH_INPUT_BINDING')
        policy=reader.json(entry['sourcePolicy'])
        for path,ref in policy['sources'].items():
            need(profile['filesSha256'].get(path)==ref['sha256'],'CANDIDATE_EPOCH_ROOT_SOURCE_CLOSURE')
        source_pins={}
        for source,ref in policy['sources'].items():
            expected=str(pathlib.Path('/usr/local/lib/workspacex-cn')/source.removeprefix('.harness/scripts/vm/'))
            need(ref['path']==expected and ref['sha256']==profile['filesSha256'].get(source),'CANDIDATE_EPOCH_INSTALLED_SOURCE_PIN')
            source_pins[source]=dict(path=expected,sha256=ref['sha256'])
        code_authority=q.QualificationCodeAuthority(source_pins,entry['executablePins'])
        verified=q.verify_existing_qualification(p,reader,entry['sourcePolicy'],code_authority=code_authority)
        need(verified['epoch']==refs['manifest'],'CANDIDATE_EPOCH_MANIFEST_HASH')
        acceptance=self.host.plan['acceptanceEvidence']
        acceptance_raw=private(acceptance['path']);actual=json.loads(acceptance_raw)
        need(hashlib.sha256(acceptance_raw).hexdigest()==acceptance['sha256'] and
             actual['identity']==bound['identity'],'CANDIDATE_EPOCH_ACCEPTANCE_BINDING')
        reader.finish();self.require_lock()
        need(private('/etc/workspacex-cn/trusted-tool-binding.json')==profile_raw and
             private(acceptance['path'])==acceptance_raw,'CANDIDATE_EPOCH_AUTHORITY_DRIFT')
        need(self.observe_hold()==dict(schemaVersion=1,state='held',identity=bound['identity'],
             host=bound['host'],generation=bound['holdGeneration']),'CANDIDATE_EPOCH_HOLD_DRIFT')
        return dict(**bound,kind='retained-current-epoch-verified',collectionSha256=refs['collection']['sha256'],
                    epochManifestSha256=refs['manifest']['sha256'],recoveryEvidenceSha256=p['recoveryEvidence']['sha256'],
                    acceptanceEvidenceSha256=acceptance['sha256'])

    def verify_snapshot_binding(self,bound,stage_binding):
        """Requalify the manifest binding; an epoch-looking caller hash is insufficient."""
        self.require_lock();self._recheck()
        _,profile,_=self._profile()
        entry=profile.get('currentEpochQualification')
        require(type(entry) is dict and type(entry.get('input')) is dict,
                'CANDIDATE_STAGE_QUALIFICATION_INPUT')
        qualification=json.loads(self._read_ref(entry['input']))
        semantic_fields=('identity','toolRevision','host','epoch','holdGeneration')
        binding=qualification.get('binding') if type(qualification) is dict else None
        require(type(bound) is dict and set(bound)==set(semantic_fields) and
            type(binding) is dict and set(binding)==set(semantic_fields)|{'targetInstanceId','providerBindingSha256'} and
            all(binding[k]==bound[k] for k in semantic_fields),
                'CANDIDATE_STAGE_QUALIFICATION_BINDING')
        manifest=dict(path='/etc/workspacex-cn/maintenance-evidence/'+APP+'/'+
            bound['identity']['attemptId']+'/qualified-current-epoch/epoch.json',sha256=stage_binding['epoch'])
        verified=self.verify_current_epoch(dict(collection=qualification['collection'],manifest=manifest),bound)
        require(verified.get('epochManifestSha256')==stage_binding['epoch'],
                'CANDIDATE_STAGE_QUALIFIED_MANIFEST')
        self._recheck();return True

    def persist_stage_snapshot(self,bound,containers):
        self.require_lock();self._recheck()
        require(all(bound[k]==self.host.plan[k] for k in ('identity','toolRevision','host','holdGeneration')),
                'CANDIDATE_STAGE_SNAPSHOT_BINDING')
        require(containers==self.inspect_stage(self.compose['name']),'CANDIDATE_STAGE_SNAPSHOT_RACE')
        require(len(containers)==len(SERVICES),'CANDIDATE_STAGE_SNAPSHOT_CLOSURE')
        baseline=self.observe_baseline()['containers']
        result=dict(schemaVersion=1,kind='source-inspected-candidate-stage-snapshot',binding=copy.deepcopy(bound),
            sourceProfileSha256=candidate_stage_profile_sha256(json.loads(self.profile_raw)),composeRef=self.inputs['compose'],
            manifestRef=self.inputs['manifest'],containers=copy.deepcopy(containers+baseline),
            candidateContainerIds=[c['Id'] for c in containers],baselineContainerIds=[c['Id'] for c in baseline])
        for c in containers:
            service=c['Config']['Labels']['com.docker.compose.service']
            require(service in SERVICES and c['State']['Running'] is False and c['State']['Paused'] is False,
                'CANDIDATE_STAGE_SNAPSHOT_STOPPED')
            self.verify_stage_configuration(service,self.compose['services'][service],c)
        path=pathlib.Path('/etc/workspacex-cn/maintenance-candidate')/APP/bound['identity']['attemptId']/'stage-snapshot.json'
        raw=json.dumps(result,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
        parent=path.parent
        for a in (parent,*parent.parents):
            s=a.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,
                'CANDIDATE_STAGE_SNAPSHOT_PARENT')
        require(stat.S_IMODE(parent.stat().st_mode)==0o700,'CANDIDATE_STAGE_SNAPSHOT_PRIVATE_PARENT')
        if path.exists():
            from host_transport import private
            require(private(str(path))==raw,'CANDIDATE_STAGE_SNAPSHOT_CONFLICT')
        else:
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            try:
                with os.fdopen(fd,'wb',closefd=False) as f:f.write(raw);f.flush();os.fsync(fd)
            finally:os.close(fd)
            dfd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(dfd)
            finally:os.close(dfd)
        require(containers==self.inspect_stage(self.compose['name']) and baseline==self.observe_baseline()['containers'],
            'CANDIDATE_STAGE_SNAPSHOT_LATE_RACE')
        self._recheck();return dict(path=str(path),sha256=hashlib.sha256(raw).hexdigest())

    def observe_retained_sessions(self,bound):
        from control_connection import verify_bound_transport
        from host_transport import proc_binding
        self.require_lock();require(all(self.host.plan[k]==bound[k] for k in ('identity','host','holdGeneration','toolRevision')),
            'CANDIDATE_STAGE_RUNTIME_BINDING')
        result={}
        for mode,attr in (('control','control_connections'),('diagnostic','diagnostic_connections')):
            group=getattr(self.host,attr);require(set(group)==set(self.host.plan['databasePeers']),'CANDIDATE_STAGE_SIX_HELPERS')
            result[mode]={}
            for db,c in group.items():
                require(c.process.poll() is None and c.binding==self.host.plan['controlSessions' if mode=='control' else 'diagnosticSessions'][db],
                    'CANDIDATE_STAGE_RETAINED_SESSION_DRIFT')
                verify_bound_transport(self.host.plan,db,mode,c.binding)
                p=proc_binding(c.process.pid);expected=next((v for v in self.host.plan['runtimeHelperProcesses'] if v['pid']==p['pid']),None)
                require(expected is not None and all(p[k]==v for k,v in expected.items() if k not in ('parentPid','state')),
                    'CANDIDATE_STAGE_HELPER_PROCESS_DRIFT')
                result[mode][db]=copy.deepcopy(c.binding)
        return result
    def verify_runtime_seal(self,ref,bound):
        require(ref['path']=='/var/lib/workspacex-cn/runtime/'+bound['identity']['attemptId']+'/sealed-writer-runtime.json',
            'CANDIDATE_STAGE_RUNTIME_PATH')
        raw=self._read_ref(ref);value=json.loads(raw);sessions=self.observe_retained_sessions(bound)
        require(value['schemaVersion']==1 and value['kind']=='sealed-maintenance-writer-runtime' and
            value['identity']==bound['identity'] and value['toolRevision']==bound['toolRevision'] and
            value['runtimePlan']==self.host.plan and value['runtimePlanSha256']==digest(self.host.plan) and
            value['sessionsSha256']==digest(sessions) and value['ready'] is False and
            value['productionAvailabilityProven'] is False,'CANDIDATE_STAGE_RUNTIME_SEAL')
        require(self._read_ref(ref)==raw,'CANDIDATE_STAGE_RUNTIME_REF_DRIFT');return value

    def observe_stage(self,bound):
        from candidate_stage_actions import safe_inspection
        self.require_lock();self._recheck()
        require(self.observe_hold()==dict(schemaVersion=1,state='held',identity=bound['identity'],host=bound['host'],
            generation=bound['holdGeneration']),'CANDIDATE_STAGE_PRODUCER_HOLD')
        candidate=self.inspect_stage(self.compose['name']);baseline=self.observe_baseline()['containers']
        require(len(candidate)==len(SERVICES),'CANDIDATE_STAGE_PRODUCER_SERVICE_CLOSURE')
        seen=set()
        for c in candidate:
            service=c['Config']['Labels']['com.docker.compose.service']
            require(service in SERVICES and service not in seen and c['State']['Running'] is False and
                c['State']['Paused'] is False,'CANDIDATE_STAGE_PRODUCER_STOPPED')
            seen.add(service);self.verify_stage_configuration(service,self.compose['services'][service],c)
        maps={self.inputs['compose']['path']:self.inputs['compose']['sha256']}
        for w in self.host.plan['writers']:
            ref=dict(path=w['binding']['composePath'],sha256=w['binding']['composeSha256'])
            self._read_ref(ref);maps[ref['path']]=ref['sha256']
        require(candidate==self.inspect_stage(self.compose['name']) and baseline==self.observe_baseline()['containers'],
            'CANDIDATE_STAGE_PRODUCER_OBSERVATION_RACE')
        self._recheck();return dict(**bound,kind='candidate-staged-container-inspection',
            containers=safe_inspection(candidate+baseline),composeSha256=maps)

    def observe_completion(self,bound):
        from control_connection import verify_bound_transport
        self.require_lock();receipt=copy.deepcopy(self.journal.value.get('migrationCompletionReceipt'))
        expected='/etc/workspacex-cn/migration-completion-inputs/'+APP+'/'+bound['identity']['attemptId']+'.completed.json'
        require(type(receipt) is dict and set(receipt)=={'path','sha256'} and receipt['path']==expected and
            receipt==self.journal.value.get('migrationCompletionIntent') and any(e['state']=='migration-completion-durable' and
            e.get('receipt')==receipt and e.get('holdGeneration')==bound['holdGeneration'] for e in self.journal.value['events']),
            'CANDIDATE_STAGE_DURABLE_COMPLETION_REQUIRED')
        raw=self._read_ref(receipt);completed=json.loads(raw)
        c=self.host.diagnostic_connections['workspacex']
        require(c.binding==self.host.plan['diagnosticSessions']['workspacex'],'CANDIDATE_STAGE_LEDGER_SESSION')
        verify_bound_transport(self.host.plan,'workspacex','diagnostic',c.binding)
        value=c.query('migration-ledger')
        require(type(value) is dict and set(value)=={'ledger','rowCount'} and type(value['rowCount']) is int and
            value['rowCount']==len(value['ledger']) and len({r['name'] for r in value['ledger']})==len(value['ledger']),
            'CANDIDATE_STAGE_LEDGER_PROTOCOL')
        rows=[]
        for r in value['ledger']:
            require(type(r['name']) is str and re.fullmatch('[A-Za-z0-9_.-]+',r['name']) and
                type(r['checksum']) is str and re.fullmatch('[a-f0-9]{64}',r['checksum']),'CANDIDATE_STAGE_LEDGER_ROW')
            rows.append(dict(name=r['name'],checksum=r['checksum']))
        verify_completion(completed,bound,rows)
        ledger=dict(**bound,kind='retained-live-migration-ledger',connection=copy.deepcopy(c.binding),
            rowCount=len(rows),ledger=sorted(rows,key=lambda r:r['name']))
        require(self._read_ref(receipt)==raw and self.journal.value.get('migrationCompletionReceipt')==receipt and
            self.observe_hold()==dict(schemaVersion=1,state='held',identity=bound['identity'],host=bound['host'],
                generation=bound['holdGeneration']),'CANDIDATE_STAGE_COMPLETION_RACE')
        self.require_lock();return dict(completion=receipt,ledger=ledger)

    def publish_late_evidence(self,bound):
        """Source-owned immutable safe stage/ledger receipts for late producer."""
        self.require_lock();stage=self.observe_stage(bound);completion=self.observe_completion(bound)
        outputs={}
        for name,value in (('stage-inspection',stage),('live-ledger',completion['ledger'])):
            p=pathlib.Path('/etc/workspacex-cn/maintenance-candidate')/APP/bound['identity']['attemptId']/(name+'.json')
            for a in (p.parent,*p.parent.parents):
                s=a.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and s.st_gid==0 and not s.st_mode&0o022,
                    'CANDIDATE_STAGE_EVIDENCE_PARENT')
            require(os.geteuid()==0 and os.getegid()==0 and stat.S_IMODE(p.parent.stat().st_mode)==0o700,
                'CANDIDATE_STAGE_EVIDENCE_PRIVATE_PARENT')
            raw=json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
            if p.exists():
                from host_transport import private
                require(private(str(p))==raw,'CANDIDATE_STAGE_EVIDENCE_CONFLICT')
            else:
                fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                try:
                    with os.fdopen(fd,'wb',closefd=False) as f:f.write(raw);f.flush();os.fsync(fd)
                finally:os.close(fd)
                dfd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                try:os.fsync(dfd)
                finally:os.close(dfd)
            outputs['stageInspection' if name=='stage-inspection' else 'liveLedger']=dict(path=str(p),sha256=hashlib.sha256(raw).hexdigest())
        require(self.observe_stage(bound)==stage and self.observe_completion(bound)==completion,'CANDIDATE_STAGE_EVIDENCE_LATE_RACE')
        return dict(**outputs,completion=completion['completion'])
