"""Fixed 9b25 offline Compose staging and retained held readback.

No command executes at import. No default host transport, startup, SQL text,
bootstrap container, image build/pull, pointer promotion or baseline mutation.
"""
import copy
import hashlib
import json
import pathlib
import re
from writer_fence import DATABASES, digest, require
from current_held_epoch_evidence_producer import binding
from isolated_conservation_plan import private_bytes
from writer_fence import admitted_release_identity

SERVICES=('web','api','agent','sandbox','sandbox-sessions')
DOCKER_PREFIX=('--config','/etc/workspacex-cn/docker-offline','--host','unix:///run/docker.sock')
PROBES=('held-candidate-schema','held-candidate-permissions','held-candidate-seed')


def exact(value,keys,code):
    require(type(value) is dict and set(value)==set(keys),code)


def guard(source,bound):
    source.require_lock()
    require(source.observe_hold()==dict(schemaVersion=1,state='held',identity=bound['identity'],
        host=bound['host'],generation=bound['holdGeneration']),'CANDIDATE_STAGE_HOLD_DRIFT')
    admission=source.observe_admission()
    require(set(admission)==set(DATABASES) and all(type(roles) is dict and roles and
        all(value is False for value in roles.values()) for roles in admission.values()),
        'CANDIDATE_STAGE_ROLE_ADMISSION_OPEN')
    return admission


def safe_inspection(containers):
    """Hash complete config in memory; never emit env/mount values in evidence."""
    keys=('com.docker.compose.service','com.docker.compose.project','com.docker.compose.project.config_files')
    return [dict(Id=c['Id'],Image=c['Image'],configSha256=digest(c['Config']),
        Config=dict(Labels={k:c['Config'].get('Labels',{}).get(k) for k in keys}),
        State={k:c['State'][k] for k in ('Running','Paused')},
        HostConfig=dict(NetworkMode=c['HostConfig']['NetworkMode'])) for c in containers]


def prepare(inputs,source=None,reader=private_bytes,*,expected_identity):
    exact(inputs,('identity','toolRevision','host','epoch','holdGeneration','manifest','compose'),'CANDIDATE_STAGE_INPUT_SCHEMA')
    bound=binding(inputs,expected_identity=expected_identity)
    require(admitted_release_identity(bound['identity']),'CANDIDATE_STAGE_RELEASE_PAIR')
    methods=('approved_release','require_lock','observe_hold','observe_admission','observe_baseline','verify_frozen_compose',
             'run_docker','inspect_stage','verify_stage_configuration','record_stage_intent')
    require(source is not None and all(callable(getattr(source,k,None)) for k in methods),'CANDIDATE_STAGE_SOURCE_TRANSPORT_REQUIRED')
    admission=guard(source,bound);baseline=copy.deepcopy(source.observe_baseline())
    require(type(baseline) is dict and type(baseline.get('projectName')) is str and
            type(baseline.get('containers')) is list and baseline['containers'],'CANDIDATE_STAGE_BASELINE_FACTS')
    raws={}
    def read(name):
        ref=inputs[name];exact(ref,('path','sha256'),'CANDIDATE_STAGE_REFERENCE_SCHEMA')
        require(type(ref['path']) is str and ref['path'].startswith('/etc/workspacex-cn/') and
                '..' not in pathlib.Path(ref['path']).parts,'CANDIDATE_STAGE_REFERENCE_PATH')
        raw=reader(ref['path'],ref['sha256']);require(hashlib.sha256(raw).hexdigest()==ref['sha256'],'CANDIDATE_STAGE_REFERENCE_HASH')
        raws[name]=raw;return json.loads(raw)
    manifest=read('manifest');compose=read('compose')
    require(manifest.get('schemaVersion')==1 and manifest.get('sourceRevision')==bound['identity']['sourceRevision'] and
            manifest.get('release')==source.approved_release(bound['identity']) and manifest.get('platform')=='linux/amd64',
            'CANDIDATE_STAGE_OFFLINE_MANIFEST')
    require(source.verify_frozen_compose(copy.deepcopy(inputs),copy.deepcopy(manifest))==compose,
            'CANDIDATE_STAGE_FROZEN_COMPOSE_UNPROVEN')
    exact(compose,('name','services','networks'),'CANDIDATE_STAGE_COMPOSE_SCHEMA')
    require(compose['networks']=={'default':{'external':True,'name':compose['name']+'-runtime'}},'CANDIDATE_STAGE_NATIVE_NETWORK')
    project=compose['name'];require(type(project) is str and re.fullmatch('[a-z][a-z0-9_-]{0,40}',project) and
        project!=baseline['projectName'],'CANDIDATE_STAGE_BASELINE_PROJECT_ALIAS')
    exact(compose['services'],SERVICES,'CANDIDATE_STAGE_SERVICE_CLOSURE')
    images={}
    for service in SERVICES:
        cfg=compose['services'][service];key='sandbox' if service=='sandbox-sessions' else service
        image=manifest['images'][key]['image']
        require(type(image) is str and re.fullmatch(r'[a-z0-9][a-z0-9.:/_-]*@sha256:[a-f0-9]{64}',image) and
                cfg.get('image')==image and cfg.get('pull_policy')=='never' and cfg.get('platform')=='linux/amd64',
                'CANDIDATE_STAGE_IMAGE_BINDING')
        require('build' not in cfg and 'container_name' not in cfg,'CANDIDATE_STAGE_UNSAFE_OVERRIDE')
        if service in ('sandbox','sandbox-sessions'):
            require(cfg.get('network_mode')=='none' and cfg.get('read_only') is True and cfg.get('ports',[])==[],
                    'CANDIDATE_STAGE_SANDBOX_TOPOLOGY')
        else:
            require('network_mode' not in cfg and 'networks' not in cfg,'CANDIDATE_STAGE_BRIDGE_TOPOLOGY')
        expected_ports={'api':['127.0.0.1:3200:3200'],'web':['127.0.0.1:3000:3000']}
        require(cfg.get('ports',[])==expected_ports.get(service,[]),'CANDIDATE_STAGE_PORT_TOPOLOGY')
        if service=='api':require(cfg['environment']['KERNEL_DEEP_AGENT_BASE_URL']=='http://agent:8000','CANDIDATE_STAGE_AGENT_DNS')
        if image not in images:
            value=source.run_docker([*DOCKER_PREFIX,'image','inspect',image])
            require(type(value) is list and len(value)==1,'CANDIDATE_STAGE_LOCAL_IMAGE_CLOSURE')
            entry=value[0]
            require(image in entry.get('RepoDigests',[]) and entry['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==bound['identity']['sourceRevision']
                    and entry.get('Architecture')=='amd64' and entry.get('Os')=='linux' and
                    type(entry.get('Id')) is str and re.fullmatch('sha256:[a-f0-9]{64}',entry['Id']), 'CANDIDATE_STAGE_LOCAL_IMAGE_IDENTITY')
            images[image]=entry['Id']
    network=source.run_docker([*DOCKER_PREFIX,'network','inspect',project+'-runtime'])
    require(type(network) is list and len(network)==1 and network[0].get('Name')==project+'-runtime' and
            network[0].get('Driver')=='bridge' and network[0].get('Internal') is False,
            'CANDIDATE_STAGE_PREEXISTING_BRIDGE_NETWORK')
    guard(source,bound)
    require(source.observe_baseline()==baseline,'CANDIDATE_STAGE_BASELINE_DRIFT')
    command=[*DOCKER_PREFIX,'compose','--project-name',project,'--file',inputs['compose']['path'],
        'create','--no-build','--pull','never','--no-deps',*SERVICES]
    # Intent persists before an exclusive candidate mutation. A lost reply is unknown.
    source.record_stage_intent(copy.deepcopy(bound),dict(compose=inputs['compose'],manifest=inputs['manifest'],projectName=project))
    source.run_docker(command)
    network=source.run_docker([*DOCKER_PREFIX,'network','inspect',project+'-runtime'])
    require(type(network) is list and len(network)==1 and network[0].get('Name')==project+'-runtime' and
            network[0].get('Driver')=='bridge' and network[0].get('Internal') is False,'CANDIDATE_STAGE_LIVE_BRIDGE_NETWORK')
    observed=source.inspect_stage(project)
    require(type(observed) is list and len(observed)==len(SERVICES),'CANDIDATE_STAGE_CONTAINER_CLOSURE')
    require(all(type(c.get('Id')) is str and re.fullmatch('[a-f0-9]{64}',c['Id']) for c in observed) and
        len({c['Id'] for c in observed})==len(observed) and
        not ({c['Id'] for c in observed}&{c['Id'] for c in baseline['containers']}),'CANDIDATE_STAGE_BASELINE_CONTAINER_ALIAS')
    seen=set()
    for c in observed:
        labels=c['Config'].get('Labels',{});service=labels.get('com.docker.compose.service')
        require(service in SERVICES and service not in seen,'CANDIDATE_STAGE_INSPECT_SERVICE');seen.add(service)
        cfg=compose['services'][service]
        require(labels.get('com.docker.compose.project')==project and
                labels.get('com.docker.compose.project.config_files')==inputs['compose']['path'] and
                c['Image']==images[cfg['image']] and c['State']['Running'] is False and c['State']['Paused'] is False,
                'CANDIDATE_STAGE_STOPPED_IDENTITY')
        mode=c['HostConfig']['NetworkMode']
        require(mode==('none' if service in ('sandbox','sandbox-sessions') else project+'-runtime'),
                'CANDIDATE_STAGE_INSPECT_NETWORK')
        require(source.verify_stage_configuration(service,copy.deepcopy(cfg),copy.deepcopy(c)) is True,
                'CANDIDATE_STAGE_FULL_CONFIGURATION')
    require(source.inspect_stage(project)==observed and source.observe_baseline()==baseline,
            'CANDIDATE_STAGE_INSPECT_RACE')
    require(guard(source,bound)==admission,'CANDIDATE_STAGE_ADMISSION_DRIFT')
    for name,raw in raws.items():require(reader(inputs[name]['path'],inputs[name]['sha256'])==raw,'CANDIDATE_STAGE_REF_RACE')
    return dict(**bound,kind='candidate-staged-container-inspection',containers=safe_inspection(observed),
        composeSha256={inputs['compose']['path']:inputs['compose']['sha256']})


def start_paused(inputs,source=None):
    # Docker start followed by pause is not atomic: app code can write objects first.
    raise RuntimeError('CANDIDATE_STAGE_ATOMIC_START_PAUSED_NOT_IMPLEMENTED')


def held_readback(inputs,source=None,reader=private_bytes,*,expected_identity):
    exact(inputs,('identity','toolRevision','host','epoch','holdGeneration','expectedReadbackRef'),'CANDIDATE_HELD_READBACK_INPUT_SCHEMA')
    bound=binding(inputs,expected_identity=expected_identity)
    require(admitted_release_identity(bound['identity']),'CANDIDATE_STAGE_RELEASE_PAIR')
    require(source is not None and all(callable(getattr(source,k,None)) for k in
        ('approved_release','require_lock','observe_hold','observe_admission','retained_diagnostic_binding','retained_query','verify_expected_readback')),
        'CANDIDATE_HELD_READBACK_TRANSPORT_REQUIRED')
    admission=guard(source,bound);proofs={}
    ref=inputs['expectedReadbackRef'];exact(ref,('path','sha256'),'CANDIDATE_HELD_READBACK_EXPECTED_REF')
    require(ref['path']==f"/etc/workspacex-cn/maintenance-readback/{bound['identity']['sourceRevision']}/{bound['identity']['attemptId']}/expected.json",
            'CANDIDATE_HELD_READBACK_EXPECTED_PATH')
    raw=reader(ref['path'],ref['sha256']);require(hashlib.sha256(raw).hexdigest()==ref['sha256'],'CANDIDATE_HELD_READBACK_EXPECTED_HASH')
    expected=json.loads(raw)
    exact(expected,(*bound,'kind','qualificationEvidenceSha256','targets'),'CANDIDATE_HELD_READBACK_EXPECTED_SCHEMA')
    require(all(expected[k]==bound[k] for k in bound) and expected['kind']=='source-derived-held-candidate-readback'
            and type(expected['qualificationEvidenceSha256']) is str and re.fullmatch('[a-f0-9]{64}',expected['qualificationEvidenceSha256']),
            'CANDIDATE_HELD_READBACK_EXPECTED_BINDING')
    exact(expected['targets'],DATABASES,'CANDIDATE_HELD_READBACK_TARGET_DATABASES')
    for targets in expected['targets'].values():
        require(type(targets) is list and targets,
                'CANDIDATE_HELD_READBACK_TARGET_CLOSURE')
        seen=set()
        for target in targets:
            exact(target,('targetId','keyValues','expectedCount','expectedDigest'),'CANDIDATE_HELD_READBACK_TARGET_SCHEMA')
            require(type(target['targetId']) is str and re.fullmatch('[a-z][a-z0-9-]{0,63}',target['targetId']) and
                type(target['keyValues']) is dict and target['keyValues'] and
                all(type(k) is str and re.fullmatch('[a-z][a-zA-Z0-9]{0,63}',k) and type(v) is str and len(v)<=1024
                    and not any(c in v for c in ('\n','\r','\x00')) for k,v in target['keyValues'].items()) and
                type(target['expectedCount']) is int and target['expectedCount']>=0 and type(target['expectedDigest']) is str and
                re.fullmatch('[a-f0-9]{64}',target['expectedDigest']),'CANDIDATE_HELD_READBACK_TARGET_SCHEMA')
            key=(target['targetId'],json.dumps(target['keyValues'],sort_keys=True,separators=(',',':')))
            require(key not in seen,'CANDIDATE_HELD_READBACK_TARGET_DUPLICATE');seen.add(key)
    # The compiled source verifies qualified isolated readback and its closed target
    # allowlist. Private plan flags or caller-selected identifiers cannot substitute it.
    require(source.verify_expected_readback(copy.deepcopy(ref),copy.deepcopy(bound))==expected,
            'CANDIDATE_HELD_READBACK_EXPECTED_UNPROVEN')
    for db in DATABASES:
        connection=source.retained_diagnostic_binding(db)
        require(connection['peer']['database']==db and connection.get('backendType','client backend')=='client backend',
                'CANDIDATE_HELD_READBACK_CONNECTION')
        proofs[db]={}
        for probe in PROBES:
            value=source.retained_query(db,probe,dict(expectedReadbackSha256=ref['sha256']))
            exact(value,('identity','connection','probe','readOnlyTransaction','rollbackComplete','verified','evidenceSha256'),
                  'CANDIDATE_HELD_READBACK_SCHEMA')
            require(value['identity']==bound['identity'] and value['connection']==connection and value['probe']==probe and
                value['readOnlyTransaction'] is True and value['rollbackComplete'] is True and value['verified'] is True and
                type(value['evidenceSha256']) is str and re.fullmatch('[a-f0-9]{64}',value['evidenceSha256']),
                'CANDIDATE_HELD_READBACK_REJECTED')
            proofs[db][probe]=value
        require(source.retained_diagnostic_binding(db)==connection,'CANDIDATE_HELD_READBACK_SESSION_DRIFT')
    require(guard(source,bound)==admission,'CANDIDATE_HELD_READBACK_ADMISSION_DRIFT')
    require(reader(ref['path'],ref['sha256'])==raw,'CANDIDATE_HELD_READBACK_EXPECTED_RACE')
    return dict(**bound,kind='retained-held-candidate-readback',proofs=proofs,evidenceSha256=digest(proofs),ready=False)
