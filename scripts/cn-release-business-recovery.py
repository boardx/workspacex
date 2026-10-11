#!/usr/bin/env python3
"""Read-only baseline runtime proof. Never restores data or clears a hold."""
import datetime as dt
from pathlib import Path
import re

SERVICES=('api','web','agent','sandbox','sandbox-sessions')
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}


def baseline_inventory(b,root,operation,xs):
    """Exact old images/config and actual health; abort additionally pins old IDs."""
    def need(v,c):
        if not v:raise ValueError(c)
    need(operation in ('rollback','abort-original'),'RECOVERY_OPERATION')
    names={'/workspacex-cn-'+s+'-1'for s in SERVICES}
    need(len(xs)==5 and {x['Name']for x in xs}==names and set(b['rollbackImages'])==set(SERVICES),'BASELINE_FIVE')
    rows=[]
    for x in xs:
        labels=x['Config']['Labels'];service=labels['com.docker.compose.service']
        need(service in SERVICES and x['Name']=='/workspacex-cn-'+service+'-1','BASELINE_SERVICE')
        need(x['Config']['Image']==b['rollbackImages'][service],'BASELINE_IMAGE')
        need(labels['com.docker.compose.project']=='workspacex-cn' and labels['com.docker.compose.project.working_dir']==b['workingDir'],'BASELINE_PROJECT')
        configs=[f['path']for f in b['composeFiles']]
        if operation=='rollback':configs+=[str(root/'rollback-images.json')]
        else:need(x['Id']==b['expectedContainers'][x['Name']]['id'],'ORIGINAL_CONTAINER_ID')
        need(labels['com.docker.compose.project.config_files'].split(',')==configs,'BASELINE_COMPOSE')
        s=x['State'];health=s.get('Health',{}).get('Status')
        need(s['Running']is True and s['Restarting']is False and s['Status']=='running' and health in (None,'healthy'),'BASELINE_HEALTH')
        need(type(x['RestartCount'])is int and x['RestartCount']>=0,'BASELINE_RESTART_COUNT')
        rows.append({'name':x['Name'],'id':x['Id'],'service':service,'image':x['Config']['Image'],'health':health,'restartCount':x['RestartCount']})
    return sorted(rows,key=lambda x:x['name'])


def health(a,release_sha,fresh_raw,prepared,state,*,reader=None,call=None,now=None,cleared=False,read_only=False):
    """Caller holds canonical lock. Inputs come from fixed private roots only."""
    reader=reader or state.Reader();call=call or state.invoke;now=now or dt.datetime.now(dt.timezone.utc)
    f=state.parse(fresh_raw);identity=a['identity'];n=state.need
    n(f['kind']=='cn-release-fresh-recovery-delegation-v1' and f['releaseSha256']==release_sha and f['identity']==identity and f['target']==TARGET,'RECOVERY_AUTHORITY')
    n(f['operation']in ('rollback','abort-original'),'RECOVERY_OPERATION')
    n(state.stamp(f['issuedAt'])<=now and (read_only or now<state.stamp(f['expiresAt'])) and dt.timedelta(0)<state.stamp(f['expiresAt'])-state.stamp(f['issuedAt'])<=dt.timedelta(minutes=30),'RECOVERY_FRESH_WINDOW')
    root=Path(f['runtimeRoot']);n(root==Path(a['runtimeStage']['remoteRoot']) and root.parent==state.VAR/'runtime' and re.fullmatch('upgrade-[a-z0-9-]{1,100}',root.name),'RECOVERY_ROOT')
    binding_raw=reader.pinned(root/'binding.json',f['originalBindingSha256']);b=state.parse(binding_raw)
    for key in state.FIELDS:
        if key!='publicationAttemptId':n(b[key]==identity[key],'RECOVERY_BINDING_IDENTITY')
    n(b['draft']is False and all(b[k]==v for k,v in TARGET.items()),'RECOVERY_BINDING_TARGET')
    reader.pinned(root/'upgrade-draft.py',f['upgradeSha256']);n(b['scriptSha256']==f['upgradeSha256'],'RECOVERY_RUNTIME_PIN')
    recovery_raw=reader.file(root/'recovery-binding.json');recovery=state.parse(recovery_raw)
    n(recovery['kind']=='f0eb-fresh-recovery-v1' and recovery['authorizationEvidenceSha256']==state.sha(fresh_raw) and recovery['originalBindingSha256']==state.sha(binding_raw) and recovery['operation']==f['operation'],'RECOVERY_BINDING_AUTH')
    for key in ('attemptId','sourceRevision','baselineRevision','hold'):n(recovery[key]==b[key],'RECOVERY_BINDING_DRIFT')
    n(recovery['issuedAt']==f['issuedAt'] and recovery['expiresAt']==f['expiresAt'],'RECOVERY_WINDOW_DRIFT')
    rec_raw=reader.pinned(root/'recovery-reconciliation.json',recovery['reconciliationSha256']);rec=state.parse(rec_raw)
    n(f['inputHashes']['binding']==state.sha(binding_raw) and f['inputHashes']['reconciliation']==state.sha(rec_raw),'RECOVERY_INPUTS')
    n(rec['priorInvocationTerminal']is True and rec['activeCloudCommands']==[] and rec['hold']==b['hold'] and rec['attemptId']==b['attemptId'],'PRIOR_RECOVERY_TERMINAL')
    # Earlier authorization's observed time is checked against its issue time,
    # not restamped during readback after the original operation completed.
    n(dt.timedelta(0)<=state.stamp(f['issuedAt'])-state.stamp(rec['observedAt'])<=dt.timedelta(minutes=10),'RECOVERY_RECONCILIATION_STALE')
    op=f['operation'];result_raw=reader.file(root/(op+'-result.json'));result=state.parse(result_raw)
    expected={'oldExactFiveRunning':True,'holdRetained':True,'businessAcceptancePassed':False}if op=='abort-original'else{'exactFiveRunning':True,'holdRetained':True,'businessAcceptancePassed':False}
    n(result==expected,'ACTUAL_BASELINE_RESULT')
    n(state.parse(reader.file(root/(op+'-intent.json')))=={'bindingSha256':state.sha(binding_raw),'holdGeneration':b['hold']['generation']},'ACTUAL_BASELINE_INTENT')
    if op=='abort-original':n(not(root/'switch-intent.json').exists(),'ABORT_AFTER_SWITCH')
    else:
        reader.file(root/'switch-intent.json')
        n(state.parse(reader.file(root/'rollback-images.json'))=={'services':{k:{'image':v}for k,v in b['rollbackImages'].items()}},'ROLLBACK_OVERRIDE')
    for ref in b['composeFiles']+b['envFiles']:reader.pinned(Path(ref['path']),ref['sha256'])
    n(b['holdHelperSha256']==prepared['profile']['holdHelperSha256'],'RECOVERY_HELPER_PIN')
    helper=[prepared['profile']['pythonPath'],'-I','-S','-B','/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','read',str(state.VAR/'runtime')]
    actual=state.parse(call(helper));expected_hold={**b['hold'],'state':'cleared'if cleared else'held'};n(actual==expected_hold,'RECOVERY_HOLD')
    for image in sorted(set(b['rollbackImages'].values())):
        xs=state.parse(call(['/usr/bin/docker','--host','unix:///run/docker.sock','image','inspect',image]));n(len(xs)==1 and xs[0]['Os']=='linux' and xs[0]['Architecture']=='amd64' and image in xs[0].get('RepoDigests',[]),'BASELINE_IMAGE_DIGEST')
    xs=state.parse(call(['/usr/bin/docker','--host','unix:///run/docker.sock','inspect',*b['expectedContainers']]))
    inventory=baseline_inventory(b,root,op,xs)
    n(state.parse(call(helper))==actual and reader.file(root/'binding.json')==binding_raw and reader.file(root/(op+'-result.json'))==result_raw,'RECOVERY_LIVE_DRIFT')
    return {'kind':'cn-baseline-runtime-health-v1','releaseSha256':release_sha,'identity':identity,'runtimeRevision':identity['baselineRevision'],
        'freshRecoveryApprovalSha256':state.sha(fresh_raw),'bindingSha256':state.sha(binding_raw),'runtimeRecoveryReceiptSha256':state.sha(result_raw),
        'hold':actual,'containers':inventory,'runtimeInventorySha256':state.sha(state.enc(inventory)),'runtimeHealthy':True,
        'observedAt':now.isoformat(timespec='milliseconds').replace('+00:00','Z'),'businessAcceptancePassed':False,'dataRestored':False}


def public(a,release_sha,fresh_raw,prepared,state,*,reader=None,call=None,now=None,read_only=False):
    """Read already cleared baseline; never executes clear or a browser."""
    reader=reader or state.Reader();n=state.need;fresh_sha=state.sha(fresh_raw)
    directory=state.ETC/'recovery-writer-resume-approvals'
    pointer=state.parse(reader.file(directory/'by-recovery'/(fresh_sha+'.json')))
    n(set(pointer)=={'approvalSha256'} and re.fullmatch('[a-f0-9]{64}',pointer['approvalSha256']),'RECOVERY_WRITER_POINTER')
    raw=reader.pinned(directory/(pointer['approvalSha256']+'.json'),pointer['approvalSha256']);approval=state.parse(raw)
    fields={'kind','scope','releaseSha256','identity','target','issuedAt','expiresAt','bindingSha256','runtimeRecoveryReceiptSha256','heldHealthSha256','holdRawSha256','holdGeneration','userAuthorizationEvidenceSha256','testDataScopeSha256','publicOrigin','recoveryApprovalSha256'}
    n(set(approval)==fields and approval['kind']=='cn-recovery-writer-resume-approval-v1' and approval['scope']=='resume-baseline-writers-and-scoped-business-observation','RECOVERY_WRITER_SCHEMA')
    f=state.parse(fresh_raw);current=now or dt.datetime.now(dt.timezone.utc)
    n(approval['identity']==a['identity'] and approval['target']==TARGET and approval['releaseSha256']==release_sha and approval['recoveryApprovalSha256']==fresh_sha,'RECOVERY_WRITER_IDENTITY')
    n(approval['publicOrigin']=='https://app.boardx.com.cn/' and approval['testDataScopeSha256']==a['business']['recoveryTestDataScopeSha256'],'RECOVERY_TEST_SCOPE')
    n(state.stamp(f['issuedAt'])<=state.stamp(approval['issuedAt'])<=current and (read_only or current<state.stamp(approval['expiresAt'])) and state.stamp(approval['issuedAt'])<state.stamp(approval['expiresAt'])<=state.stamp(f['expiresAt']),'RECOVERY_WRITER_WINDOW')
    for key in fields:
        if key.endswith('Sha256'):n(bool(re.fullmatch('[a-f0-9]{64}',approval[key])),'RECOVERY_WRITER_HASH')
    h=health(a,release_sha,fresh_raw,prepared,state,reader=reader,call=call,now=current,cleared=True,read_only=read_only)
    n(approval['bindingSha256']==h['bindingSha256'] and approval['runtimeRecoveryReceiptSha256']==h['runtimeRecoveryReceiptSha256'] and approval['holdGeneration']==h['hold']['generation'],'RECOVERY_WRITER_BASELINE')
    root=state.VAR/'release-generated'/release_sha/'terminal'/'recovery-writer-resume'
    clear_raw=reader.file(root/'recovery-clear-result.json');clear=state.parse(clear_raw)
    n(clear['kind']=='cn-recovery-hold-cleared-v1' and clear['approvalSha256']==state.sha(raw) and clear['recoveryApprovalSha256']==fresh_sha and clear['hold']==h['hold'] and clear['businessAcceptancePassed']is False and clear['dataRestored']is False,'RECOVERY_ACTUAL_CLEAR')
    for key in ('releaseSha256','identity','bindingSha256','runtimeRecoveryReceiptSha256','heldHealthSha256','holdRawSha256','testDataScopeSha256'):n(clear[key]==approval[key],'RECOVERY_CLEAR_LINK')
    helper_raw=reader.pinned(root/'recovery-clear-helper.json',clear['helperResultSha256']);n(state.parse(helper_raw)==h['hold'],'RECOVERY_CLEAR_HELPER_BYTES')
    links={k:clear[k]for k in ('releaseSha256','identity','bindingSha256','runtimeRecoveryReceiptSha256','heldHealthSha256','holdRawSha256','testDataScopeSha256','approvalSha256','recoveryApprovalSha256')}
    n(state.parse(reader.file(root/'recovery-clear-intent.json'))=={'kind':'cn-recovery-hold-clear-intent-v1',**links},'RECOVERY_CLEAR_INTENT')
    held=state.parse(reader.pinned(root/'held-health.json',approval['heldHealthSha256']));hold=state.parse(reader.pinned(root/'held-hold.json',approval['holdRawSha256']))
    reader.pinned(root/'user-authorization.json',approval['userAuthorizationEvidenceSha256']);reader.pinned(root/'test-data-scope.json',approval['testDataScopeSha256'])
    n(held['containers']==h['containers'] and held['runtimeInventorySha256']==h['runtimeInventorySha256'] and held['hold']==hold and {**hold,'state':'cleared'}==h['hold'],'RECOVERY_CLEAR_BASELINE_DRIFT')
    return {'identity':a['identity'],'boundary':{'phase':'production-public','lockRetained':True,'writesHeld':False,'testDataScopeApproved':True,'publicResumeAuthorized':True},
        'runtimeRevision':a['identity']['baselineRevision'],'runtimeInventorySha256':h['runtimeInventorySha256'],'deploymentMarker':prepared['recoveryPlan']['deploymentMarker'],
        'bindingSha256':h['bindingSha256'],'switchReceiptSha256':h['runtimeRecoveryReceiptSha256'],'holdGeneration':h['hold']['generation'],'observedAt':h['observedAt'],
        'clearReceiptSha256':state.sha(clear_raw),'runtimeHealthy':True,'writerResumeApprovalSha256':state.sha(raw),'testDataScopeSha256':approval['testDataScopeSha256']}, {'approvalSha256':state.sha(raw),'raw':raw.decode()}
