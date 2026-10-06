"""Candidate-project canonical consumer; no legacy names/network or source patching."""
import copy,datetime,hashlib,json,pathlib,re,time,stat,ipaddress
from writer_fence import require,digest
from candidate_readonly_docker import invoke_readonly_docker
from candidate_stage_host import candidate_stage_profile_sha256
APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0'
BASE='ba6343199f3c834d6a198f83d0c771614292c82b'
SERVICES={'web','api','agent','sandbox','sandbox-sessions'}


# Moby v24/v27/v28 daemon/container_operations.go: cleanOperationalData and
# buildEndpointDNSNames. Clearing NetworkID/Aliases/DNSNames is NOT that contract.
_OPERATIONAL_EMPTY={'EndpointID':'','Gateway':'','IPAddress':'','IPPrefixLen':0,'IPv6Gateway':'','GlobalIPv6Address':'','GlobalIPv6PrefixLen':0,'MacAddress':''}
def _dedup_names(values):
    require(all(type(v) is str and v for v in values),'CANDIDATE_CANONICAL_DNS_SOURCE')
    return list(dict.fromkeys(values))
def _expected_dns(container,aliases):
    require(type(container.get('Name')) is str and container['Name'].startswith('/') and type(container.get('Id')) is str and re.fullmatch('[a-f0-9]{64}',container['Id']) and type(container['Config'].get('Hostname')) is str,'CANDIDATE_CANONICAL_DNS_SOURCE')
    names=[container['Name'][1:],*aliases,container['Id'][:12]]
    if container['Config']['Hostname']:names.append(container['Config']['Hostname'])
    return _dedup_names(names)
def _verify_network_transition(actual,frozen,candidate,approved=None,source_none=None):
    live=actual['NetworkSettings']['Networks'];old=frozen['NetworkSettings']['Networks']
    require(type(live) is dict and type(old) is dict and set(live)==set(old),'CANDIDATE_CANONICAL_NETWORK_DRIFT')
    if 'Name' in frozen:require(actual.get('Name')==frozen['Name'],'CANDIDATE_CANONICAL_NAME_DRIFT')
    sandbox=actual['HostConfig']['NetworkMode']=='none'
    if sandbox:
        from candidate_stage_host import verify_none_endpoint
        require(set(live)==set(old)=={'none'} and source_none is not None,'CANDIDATE_CANONICAL_SANDBOX_NETWORK')
        verify_none_endpoint(actual,source_none,allow_unallocated=False)
        require(actual['HostConfig'].get('PortBindings') in (None,{}) and actual['HostConfig'].get('PublishAllPorts') is False and actual['NetworkSettings'].get('Ports') in (None,{}),'CANDIDATE_CANONICAL_NONE_PORTS')
        before=old['none'];value=live['none']
        require(set(value)==set(before) and all(value[k]==before[k] for k in set(value)-{'NetworkID','EndpointID'}),'CANDIDATE_CANONICAL_NONE_STATIC_DRIFT')
        require(before['NetworkID'] in ('',source_none['Id']) and (before['EndpointID']=='' or re.fullmatch('[a-f0-9]{64}',before['EndpointID'])),'CANDIDATE_CANONICAL_NONE_SNAPSHOT_ID')
        if before['NetworkID']=='':require(before['EndpointID']=='' and frozen['State']['Running'] is False and frozen['State']['Paused'] is False,'CANDIDATE_CANONICAL_NONE_UNALLOCATED')
        if actual['State']['Running'] is True:
            require((not candidate or actual['State']['Paused'] is False) and re.fullmatch('[a-f0-9]{64}',value['EndpointID']),'CANDIDATE_CANONICAL_NONE_RUNNING')
            if actual['State']['Paused'] is True:require(value==before,'CANDIDATE_CANONICAL_NONE_PAUSED_DRIFT')
        elif actual['State']['Paused'] is False:require(value['EndpointID']=='','CANDIDATE_CANONICAL_NONE_STOPPED')
        else:require(value==before,'CANDIDATE_CANONICAL_NONE_PAUSED_DRIFT')
        return
    stopped=actual['State']['Running'] is False and actual['State']['Paused'] is False
    if candidate:require(actual['State']['Running'] is True and actual['State']['Paused'] is False and set(live)=={approved['Name']},'CANDIDATE_CANONICAL_NETWORK_RUNNING')
    for name,value in live.items():
        before=old[name];require(type(value) is dict and type(before) is dict,'CANDIDATE_CANONICAL_ENDPOINT_SCHEMA')
        if candidate:
            require(value.get('NetworkID')==approved['Id'] and before.get('NetworkID') in ('',approved['Id']),'CANDIDATE_CANONICAL_NETWORK_ID')
            aliases=before.get('Aliases') or [];actual_aliases=value.get('Aliases') or []
            require(type(aliases) is list and type(actual_aliases) is list and all(type(v) is str and v for v in aliases),'CANDIDATE_CANONICAL_ALIASES_SCHEMA')
            dns=value.get('DNSNames');old_dns=before.get('DNSNames')
            if actual_aliases!=aliases:
                # v24 adds only short ID/hostname to source-owned aliases.
                require(dns is None and old_dns is None and actual_aliases==_dedup_names([*aliases,frozen['Id'][:12],*([frozen['Config']['Hostname']] if frozen['Config'].get('Hostname') else [])]),'CANDIDATE_CANONICAL_ALIASES_DRIFT')
            if dns!=old_dns:
                require(old_dns in (None,[]) and dns==_expected_dns(frozen,aliases),'CANDIDATE_CANONICAL_DNS_DRIFT')
        else:
            # Known Docker stop cleanup retains network identity and names. A
            # host that clears those needs a separately evidenced engine policy.
            require(all(value.get(k)==before.get(k) for k in ('NetworkID','Aliases','DNSNames')),'CANDIDATE_CANONICAL_BASELINE_NETWORK_STATIC')
        static=set(value)|set(before)
        static-=set(_OPERATIONAL_EMPTY)|{'NetworkID','Aliases','DNSNames'}
        require(all(k in value and k in before and value[k]==before[k] for k in static),'CANDIDATE_CANONICAL_NETWORK_CONFIG_DRIFT')
        if not candidate:
            if stopped:
                for key,empty in _OPERATIONAL_EMPTY.items():
                    if key in value or key in before:require(value.get(key,empty)==empty and type(value.get(key,empty)) is type(empty),'CANDIDATE_CANONICAL_BASELINE_ENDPOINT_NOT_CLEARED')
            else:require(value==before,'CANDIDATE_CANONICAL_PAUSED_NETWORK_DRIFT')
        else:
            # Startup may allocate only known operational fields. Configured IPAM
            # remains exact above; dynamic addresses must be in approved subnets.
            for key in ('EndpointID','MacAddress'):
                if key in value:
                    require(type(value[key]) is str and bool(re.fullmatch('[a-f0-9]{64}' if key=='EndpointID' else r'[a-f0-9]{2}(?::[a-f0-9]{2}){5}',value[key])),'CANDIDATE_CANONICAL_ENDPOINT_ALLOCATION')
            for addr,prefix,gateway in [('IPAddress','IPPrefixLen','Gateway'),('GlobalIPv6Address','GlobalIPv6PrefixLen','IPv6Gateway')]:
                if addr not in value:continue
                require(type(value[addr]) is str and type(value.get(prefix)) is int,'CANDIDATE_CANONICAL_ENDPOINT_ADDRESS')
                if value[addr]:
                    ip=ipaddress.ip_address(value[addr]);configs=approved['IPAM'].get('Config',[])
                    matches=[c for c in configs if c.get('Subnet') and ip in ipaddress.ip_network(c['Subnet'])]
                    require(len(matches)==1 and value[prefix]==ipaddress.ip_network(matches[0]['Subnet']).prefixlen and value.get(gateway)==matches[0].get('Gateway',''),'CANDIDATE_CANONICAL_ENDPOINT_SUBNET')
                else:require(value[prefix]==0 and value.get(gateway,'')=='','CANDIDATE_CANONICAL_EMPTY_ADDRESS')

def candidate_canonical_receipt(transport,binding,now=time.time,*,expected_identity):
    # Root FD closure supplies exact compiled helper bytes. It is used solely for
    # protected file/source reads and pinned Node execution, not legacy layout ops.
    import compiled_maintenance_activation as source
    require(type(binding) is dict and set(binding)=={'identity','candidateConfig','candidateNginx','stageInspection','browserPlan','nodeBinary'},'CANDIDATE_CANONICAL_BINDING')
    identity=binding['identity'];plan=transport.plan
    require(identity==expected_identity and identity==plan['identity'] and type(identity['sourceRevision']) is str and re.fullmatch('[a-f0-9]{40}',identity['sourceRevision']) and identity['baselineRevision']==BASE,'CANDIDATE_CANONICAL_IDENTITY')
    transport.require_lock();transport._guard(copy.deepcopy(plan))
    stages=[]
    def read(ref,expected=None):
        require(type(ref) is dict and set(ref)=={'path','sha256'} and type(ref['path']) is str and ref['path'].startswith('/etc/workspacex-cn/') and '..' not in pathlib.Path(ref['path']).parts and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'CANDIDATE_CANONICAL_REF')
        require(expected is None or ref['path']==expected,'CANDIDATE_CANONICAL_PATH')
        raw=transport.private(ref['path']);require(type(raw) is bytes and len(raw)<=1024*1024 and hashlib.sha256(raw).hexdigest()==ref['sha256'],'CANDIDATE_CANONICAL_REF_HASH');return raw
    stages.append('identity-lock')
    config=read(binding['candidateConfig'],'/etc/workspacex-cn/deployment.json');stages.append('candidate-config')
    # Nginx is a fixed protected path outside the configuration tree.
    ref=binding['candidateNginx'];require(type(ref) is dict and set(ref)=={'path','sha256'} and ref['path']=='/etc/nginx/conf.d/workspacex-cn.conf' and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'CANDIDATE_CANONICAL_NGINX_REF')
    nginx=source.private(ref['path'],ref['sha256']);stages.append('candidate-nginx')
    stage=json.loads(read(binding['stageInspection'],f"/etc/workspacex-cn/maintenance-candidate/{identity['sourceRevision']}/{identity['attemptId']}/stage-snapshot.json"))
    require(type(stage) is dict and set(stage)=={'schemaVersion','kind','binding','sourceProfileSha256','composeRef','manifestRef','containers','candidateContainerIds','baselineContainerIds'} and stage['schemaVersion']==1 and stage['kind']=='source-inspected-candidate-stage-snapshot' and type(stage['containers']) is list,'CANDIDATE_CANONICAL_STAGE_PROOF')
    expected_bound=dict(identity=identity,toolRevision=transport.host.plan['toolRevision'],host=plan['host'],epoch=plan['epoch'],holdGeneration=plan['holdGeneration'])
    require(stage['binding']==expected_bound,'CANDIDATE_CANONICAL_STAGE_BINDING')
    profile_raw=source.private('/etc/workspacex-cn/trusted-tool-binding.json');profile=json.loads(profile_raw)
    require(stage['sourceProfileSha256']==candidate_stage_profile_sha256(profile) and profile['toolRevision']==expected_bound['toolRevision'],'CANDIDATE_CANONICAL_STAGE_PROFILE')
    emitter=profile['candidateComposeEmitter'];options=json.loads(read(emitter['optionsRef']))
    require(options['composeRef']==stage['composeRef'] and options['manifestRef']==stage['manifestRef'],'CANDIDATE_CANONICAL_STAGE_REFS')
    compose=json.loads(read(stage['composeRef']));read(stage['manifestRef'])
    approved=json.loads(read(options['networkRef']))
    require(set(approved)=={'Id','Name','Driver','Internal','IPAM','Options'} and approved['Name']==options['projectName']+'-runtime' and approved['Driver']=='bridge' and approved['Internal'] is False and compose['name']==options['projectName'] and compose['networks']=={'default':{'external':True,'name':approved['Name']}},'CANDIDATE_CANONICAL_SOURCE_NETWORK')
    network=json.loads(invoke_readonly_docker(source,profile_raw,'network-inspect',network_name=approved['Name']))
    require(type(network) is list and len(network)==1 and {k:network[0][k] for k in approved}==approved,'CANDIDATE_CANONICAL_LIVE_NETWORK')
    source_none=json.loads(invoke_readonly_docker(source,profile_raw,'network-inspect',network_name='none'))
    require(type(source_none) is list and len(source_none)==1,'CANDIDATE_CANONICAL_NONE_DRIVER_INSPECT');source_none=source_none[0]
    candidate_ids={w['binding']['containerId'] for w in plan['candidateWriters']};baseline_ids={w['binding']['containerId'] for w in plan['baselineWriters']}
    require(type(stage['candidateContainerIds']) is list and type(stage['baselineContainerIds']) is list and len(stage['candidateContainerIds'])==len(candidate_ids) and len(stage['baselineContainerIds'])==len(baseline_ids) and set(stage['candidateContainerIds'])==candidate_ids and set(stage['baselineContainerIds'])==baseline_ids and candidate_ids.isdisjoint(baseline_ids),'CANDIDATE_CANONICAL_STAGE_IDS')
    snapshots={v['Id']:v for v in stage['containers']};require(len(snapshots)==len(stage['containers']) and set(snapshots)==candidate_ids|baseline_ids,'CANDIDATE_CANONICAL_STAGE_DUPLICATE')
    live=transport.docker_inventory();index={v['Id']:v for v in live};require(len(index)==len(live),'CANDIDATE_CANONICAL_INVENTORY_DUPLICATE')
    writers=transport._inventory(copy.deepcopy(plan));candidate_projects=set();baseline_projects=set();apis=[]
    for w in plan['candidateWriters']+plan['baselineWriters']:
        b=w['binding'];actual=index.get(b['containerId']);frozen=snapshots.get(b['containerId'])
        require(actual is not None and frozen is not None and actual['Image']==frozen['Image']==b['imageId'] and digest(actual['Config'])==digest(frozen['Config'])==b['configSha256'],'CANDIDATE_CANONICAL_FULL_CONFIG')
        require(digest(actual['HostConfig'])==digest(frozen['HostConfig']) and digest(actual['Mounts'])==digest(frozen['Mounts']),'CANDIDATE_CANONICAL_HOST_CONFIG')
        labels=actual['Config']['Labels'];require(labels.get('com.docker.compose.service')==b['service'] and labels.get('com.docker.compose.project.config_files')==b['composePath'] and hashlib.sha256(transport.private(b['composePath'])).hexdigest()==b['composeSha256'],'CANDIDATE_CANONICAL_COMPOSE')
        _verify_network_transition(actual,frozen,w in plan['candidateWriters'],approved,source_none)
        if w in plan['candidateWriters']:
            require(b['composePath']==stage['composeRef']['path'] and b['composeSha256']==stage['composeRef']['sha256'],'CANDIDATE_CANONICAL_CANDIDATE_COMPOSE_REF')
            require(writers[w['key']]['state']=='running','CANDIDATE_CANONICAL_NOT_RUNNING');candidate_projects.add(labels.get('com.docker.compose.project'))
            require(actual['Config']['Labels'].get('org.opencontainers.image.revision')==identity['sourceRevision'],'CANDIDATE_CANONICAL_IMAGE_SOURCE')
            if b['service']=='api':apis.append(b)
            if b['service'] in ('sandbox','sandbox-sessions'):require(actual['HostConfig']['NetworkMode']=='none' and set(actual['NetworkSettings']['Networks'])=={'none'},'CANDIDATE_CANONICAL_SANDBOX_NETWORK')
        else:
            require(writers[w['key']]['state'] in ('paused','stopped'),'CANDIDATE_CANONICAL_BASELINE_RUNNING');baseline_projects.add(labels.get('com.docker.compose.project'))
    require({w['binding']['service'] for w in plan['candidateWriters']}==SERVICES and len(candidate_projects)==len(baseline_projects)==1 and None not in candidate_projects|baseline_projects and candidate_projects.isdisjoint(baseline_projects) and len(apis)==1 and candidate_projects=={options['projectName']},'CANDIDATE_CANONICAL_PROJECT_ALIAS')
    require(hashlib.sha256(transport.private(transport.artifact['path'])).hexdigest()==plan['artifactSha256'],'CANDIDATE_CANONICAL_ARTIFACT');stages.append('candidate-frozen-runtime')
    transport._guard(copy.deepcopy(plan));stages.append('baseline-frozen')
    api=apis[0];api_id=api['containerId']
    for script,fields,label in [('scripts/data-readiness.ts',('ok','database','migrations','redis'),'candidate-data'),('scripts/cloud-service-readiness.ts',('ok','web','api','agentGraphs'),'candidate-services')]:
        # Existing fixed APP scripts execute inside exact candidate API. They use
        # that runtime's actual Compose network/env; no job/new network/container.
        raw=invoke_readonly_docker(source,profile_raw,'data-readiness' if script=='scripts/data-readiness.ts' else 'service-readiness',api_id=api_id)
        require(type(raw) is bytes and len(raw)<=1024*1024,'CANDIDATE_CANONICAL_SCRIPT_BOUND');value=json.loads(raw)
        require(type(value) is dict and all(value.get(k) is True for k in fields),'CANDIDATE_CANONICAL_SCRIPT_REJECTED');stages.append(label)
    browser=json.loads(read(binding['browserPlan']))
    require(binding['nodeBinary']=={'path':'/usr/bin/node','sha256':profile['maintenanceBrowserRuntime']['nodeSha256']},'CANDIDATE_CANONICAL_NODE_PROFILE')
    code=source.installed_code('cn-maintenance-canonical.cjs').decode()+"\nlet raw='';process.stdin.on('data',b=>{raw+=b;if(Buffer.byteLength(raw)>1048576)process.exit(1)});process.stdin.on('end',()=>module.exports.publicReadiness(JSON.parse(raw)).then(v=>process.stdout.write(JSON.stringify(v))).catch(()=>process.exit(1)));"
    result=json.loads(source.invoke({'binaries':{'node':binding['nodeBinary']}},'node',['-e',code],json.dumps({'publicUrl':browser['publicUrl'],'deploymentMarker':browser['deploymentMarker']}).encode()))
    require(result=={'publicReadOnlyVerified':True} and result['publicReadOnlyVerified'] is True,'CANDIDATE_CANONICAL_PUBLIC_REJECTED');stages.append('candidate-public')
    # Recollect the bound runtime after probes; no legacy workspacex-cn names.
    transport._guard(copy.deepcopy(plan));require(transport._inventory(copy.deepcopy(plan))==writers,'CANDIDATE_CANONICAL_RUNTIME_CHANGED')
    require(read(binding['candidateConfig'])==config and source.private(ref['path'],ref['sha256'])==nginx,'CANDIDATE_CANONICAL_POINTER_CHANGED')
    none_after=json.loads(invoke_readonly_docker(source,profile_raw,'network-inspect',network_name='none'));require(none_after==[source_none],'CANDIDATE_CANONICAL_NONE_DRIVER_CHANGED')
    require(source.private('/etc/workspacex-cn/trusted-tool-binding.json')==profile_raw,'CANDIDATE_CANONICAL_PROFILE_CHANGED')
    require(len(stages)==8,'CANDIDATE_CANONICAL_STAGE_COUNT')
    return dict(schemaVersion=1,kind='canonical-acceptance-completed',identity=identity,deploymentMarker=browser['deploymentMarker'],observedAt=datetime.datetime.fromtimestamp(now(),datetime.timezone.utc).isoformat().replace('+00:00','Z'),ownedAcceptanceRunIds=[],checks=dict(status='passed',lockRetained=True,passedStages=8))

def persist_candidate_canonical_receipt(transport,binding,now=time.time,*,expected_identity):
    from acceptance_receipt_store import publish_receipt
    return publish_receipt(binding['identity'],'canonical',candidate_canonical_receipt(transport,binding,now,expected_identity=expected_identity),expected_identity=expected_identity)
