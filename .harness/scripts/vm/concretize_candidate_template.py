"""Source-owned late candidate template; no placeholder Docker identities."""
import copy,hashlib,json,re
from candidate_writer import validate,APP,BASELINE
from candidate_stage_actions import SERVICES
from candidate_plan_producer import BIND
from writer_fence import require,digest,DATABASES
from candidate_stage_host import candidate_stage_profile_sha256


def concretize(bound,source,snapshot_ref,stage_binding=None):
    source.require_lock();_,profile,_=source._profile()
    expected_stage=bound if stage_binding is None else stage_binding
    require(type(expected_stage) is dict and set(expected_stage)==set(bound) and
        all(expected_stage[k]==bound[k] for k in bound if k!='epoch') and
        type(expected_stage.get('epoch')) is str and re.fullmatch('[a-f0-9]{64}',expected_stage['epoch']),
        'CANDIDATE_TEMPLATE_STAGE_BINDING_SCHEMA')
    if stage_binding is not None:
        require(source.verify_snapshot_binding(bound,stage_binding) is True,
                'CANDIDATE_TEMPLATE_UNQUALIFIED_STAGE_BINDING')
    recipe=profile.get('candidateTemplateRecipe')
    require(type(recipe) is dict and set(recipe)=={'blueprintRef','runtimeRef'},'CANDIDATE_TEMPLATE_SOURCE_RECIPE')
    raw=source._read_ref(recipe['blueprintRef']);blueprint=json.loads(raw)
    require(set(blueprint)=={*BIND,'kind','plan'} and blueprint['kind']=='source-approved-candidate-blueprint' and
        all(blueprint[k]==bound[k] for k in BIND),'CANDIDATE_TEMPLATE_BLUEPRINT_BINDING')
    runtime=source.verify_runtime_seal(recipe['runtimeRef'],bound)
    snapshot_raw=source._read_ref(snapshot_ref);snapshot=json.loads(snapshot_raw)
    require(set(snapshot)=={'schemaVersion','kind','binding','sourceProfileSha256','composeRef','manifestRef','containers',
        'candidateContainerIds','baselineContainerIds'} and snapshot['schemaVersion']==1,'CANDIDATE_TEMPLATE_SNAPSHOT_SCHEMA')
    require(snapshot['kind']=='source-inspected-candidate-stage-snapshot' and snapshot['binding']==expected_stage and
        snapshot['composeRef']==source.inputs['compose'] and snapshot['manifestRef']==source.inputs['manifest'] and
        snapshot['sourceProfileSha256']==candidate_stage_profile_sha256(profile),
        'CANDIDATE_TEMPLATE_STAGE_SOURCE_BINDING')
    actual=source.inspect_stage(source.compose['name']);baseline=source.observe_baseline()['containers']
    require(snapshot['containers']==actual+baseline and snapshot['candidateContainerIds']==[c['Id'] for c in actual] and
        snapshot['baselineContainerIds']==[c['Id'] for c in baseline],'CANDIDATE_TEMPLATE_ACTUAL_STAGE')
    plan=copy.deepcopy(blueprint['plan']);writers=plan['candidateWriters']
    require(type(writers) is list and len(writers)==len(SERVICES) and
        {w.get('service') for w in writers}==set(SERVICES),'CANDIDATE_TEMPLATE_SERVICE_CLOSURE')
    by_service={c['Config']['Labels']['com.docker.compose.service']:c for c in actual}
    require(set(by_service)==set(SERVICES),'CANDIDATE_TEMPLATE_ACTUAL_SERVICE_CLOSURE')
    result=[]
    for w in writers:
        require(set(w)=={'key','service','families'},'CANDIDATE_TEMPLATE_RECIPE_SCHEMA')
        c=by_service[w['service']];labels=c['Config']['Labels']
        require(c['State']['Running'] is False and c['State']['Paused'] is False and
            labels['com.docker.compose.project.config_files']==source.inputs['compose']['path'],
            'CANDIDATE_TEMPLATE_STOPPED_SOURCE')
        source.verify_stage_configuration(w['service'],source.compose['services'][w['service']],c)
        result.append(dict(key=w['key'],families=copy.deepcopy(w['families']),binding=dict(kind='container',
            containerId=c['Id'],imageId=c['Image'],configSha256=digest(c['Config']),service=w['service'],
            composePath=source.inputs['compose']['path'],composeSha256=source.inputs['compose']['sha256'])))
    plan['candidateWriters']=result
    require(plan['identity']==bound['identity'] and plan['host']==bound['host'] and
        plan['baselineRevision']==BASELINE and plan['baselineWriters']==source.host.plan['writers'] and
        plan['databasePeers']==runtime['runtimePlan']['databasePeers'] and
        all(set(plan['fencedRoles'][db])==set(source.host.plan['databaseWriterRoles'][db]) for db in DATABASES),
        'CANDIDATE_TEMPLATE_RETAINED_SOURCE_BINDING')
    validate(plan,bound['identity'])
    source.require_lock();source._recheck()
    require(source._read_ref(recipe['blueprintRef'])==raw and source._read_ref(snapshot_ref)==snapshot_raw and
        source.inspect_stage(source.compose['name'])==actual and source.observe_baseline()['containers']==baseline and
        source.verify_runtime_seal(recipe['runtimeRef'],bound)==runtime,'CANDIDATE_TEMPLATE_LATE_RACE')
    return plan


def concretize_and_write(bound,source,snapshot_ref,stage_binding=None):
    """Fixed private native template; exact retries reuse only identical bytes."""
    import os,pathlib,stat
    from host_transport import private
    plan=concretize(bound,source,snapshot_ref,stage_binding=stage_binding)
    path=pathlib.Path('/etc/workspacex-cn/maintenance-candidate')/APP/bound['identity']['attemptId']/'candidate-template.json'
    require(os.geteuid()==0 and os.getegid()==0,'CANDIDATE_TEMPLATE_ROOT_REQUIRED')
    for parent in (path.parent,*path.parent.parents):
        s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and s.st_gid==0 and not s.st_mode&0o022,
            'CANDIDATE_TEMPLATE_TRUSTED_PARENT')
    require(stat.S_IMODE(path.parent.stat().st_mode)==0o700,'CANDIDATE_TEMPLATE_PRIVATE_PARENT')
    raw=json.dumps(plan,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    if path.exists():require(private(str(path))==raw,'CANDIDATE_TEMPLATE_RETRY_CONFLICT')
    else:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            with os.fdopen(fd,'wb',closefd=False) as f:f.write(raw);f.flush();os.fsync(fd)
        finally:os.close(fd)
        dfd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(dfd)
        finally:os.close(dfd)
    require(concretize(bound,source,snapshot_ref,stage_binding=stage_binding)==plan,'CANDIDATE_TEMPLATE_PUBLICATION_RACE')
    return dict(path=str(path),sha256=hashlib.sha256(raw).hexdigest())
