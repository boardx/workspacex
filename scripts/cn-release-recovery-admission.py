#!/usr/bin/env python3
"""Fixed recovery admission. Local process completion never proves remote completion."""
import argparse
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
ETC=Path('/etc/workspacex-cn')
VAR=Path('/var/lib/workspacex-cn')
SELF='scripts/cn-release-recovery-admission.py'
CODE={'entry':'.harness/scripts/vm/cn-release-advance.py','reader':'scripts/cn-release-runtime-readback.py',
      'runtimeObserver':'scripts/cn-release-runtime-observe.py','finalizer':'scripts/cn-release-continuation-finalize.py','rds':'scripts/cn-release-rds-backup.py'}
TEMPLATE='.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py'
HOLD=Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py')
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}


def need(value,code):
    if not value:raise ValueError(code)


def module(path):
    s=importlib.util.spec_from_file_location('admission_'+path.stem,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m


def private(path):
    import stat
    for p in path.parents:
        s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as f:
        s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o077 and s.st_size<=1048576,'ROOT_FILE');return f.read()


def closure(a,read=private):
    import hashlib
    for name in [SELF,*CODE.values(),TEMPLATE]:need(hashlib.sha256(read(ROOT/name)).hexdigest()==a['codeFiles'][name],'RECOVERY_CODE_PIN')
    return {k:module(ROOT/name)for k,name in CODE.items()}


def preflight(a):
    """Before hold: prove installed closure/host scope, without a failure intent."""
    need(a['kind']=='cn-fixed-release-approval-v1' and a['target']==TARGET,'RELEASE_SCOPE')
    modules=closure(a);rb=modules['reader'];reader=rb.Reader()
    root=Path(a['runtimeStage']['remoteRoot'])
    need(root.parent==VAR/'runtime' and re.fullmatch('upgrade-f0eb-[a-z0-9-]{1,64}',root.name),'CANONICAL_RUNTIME_SCOPE')
    # Existing role and both read APIs are independently checked; no Create call.
    modules['rds'].preflight(a,reader)
    need(rb.sha(reader.file(HOLD,modes=(0o600,0o700)))==a['rds']['holdHelperSha256'],'HOLD_HELPER_PIN')
    return {'kind':'cn-recovery-capability-v1','heldPhases':['stop','backup','rds-backup','switch'],
            'postClear':'REHOLD_APPROVAL_REQUIRED','unknownAction':'MANUAL_RECONCILIATION','cloudMutation':False}


def fresh_sessions_source(raw):
    """Fresh recovery authority replaces only the normal-release expiry guard.
    Original binding bytes/clock and all real stop/session checks stay unchanged.
    """
    old="assert b['draft'] is False and datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(b['expiresAt'])"
    text=raw.decode();need(text.count(old)==1,'SESSION_TEMPLATE_SHAPE')
    result=text.replace(old,"assert b['draft'] is False",1);compile(result,'<fresh-readonly-session-check>','exec');return result


def run_read(argv):
    p=subprocess.run(argv,capture_output=True,timeout=120,env={'PATH':'/usr/bin:/bin','LANG':'C'},cwd='/')
    need(p.returncode==0 and 0<len(p.stdout)<=1048576,'READONLY_OBSERVER_UNPROVEN');return p.stdout


def observe_phase(phase,a,release,f,modules,b,braw,reader,hold_reader,*,now):
    rb=modules['reader'];root=Path(f['runtimeRoot'])
    if phase=='stop':
        raw=reader.file(root/'sessions-after-stop.py');need(rb.sha(raw)==b['sessionsHelperSha256'],'SESSION_CODE_PIN')
        return run_read(['/usr/bin/python3','-I','-S','-B','-c',fresh_sessions_source(raw),str(root),rb.sha(braw)])
    if phase=='backup':
        approval=dict(kind='cn-runtime-backup-readback-approval-v1',remoteRoot=str(root),bindingSha256=rb.sha(braw),
            identity={k:b[k]for k in rb.IDENTITY},holdGeneration=b['hold']['generation'],issuedAt=f['issuedAt'],expiresAt=f['expiresAt'],
            observerSha256=a['codeFiles'][CODE['reader']],upgradeSha256=b['scriptSha256'],backupHelperSha256=b['backupHelperSha256'],holdHelperSha256=b['holdHelperSha256'],maxSeconds=120)
        return rb.observe(approval,runtime_root=VAR/'runtime',reader=reader,hold_reader=hold_reader,now=now)
    if phase=='rds-backup':
        # Original observer checks actual dispatch JobId, provider terminal task,
        # unique matching successful snapshot and retained original receipt.
        return run_read(['/usr/bin/python3','-I','-S','-B',str(ROOT/CODE['rds']),'observe',release])
    template=reader.file(ROOT/TEMPLATE);need(rb.sha(template)==a['codeFiles'][TEMPLATE],'STATUS_CODE_PIN')
    source=modules['finalizer'].specialize(template,b['sourceRevision'])
    switch=reader.file(root/'switch-result.json')
    need(rb.parse(switch)=={'exactFiveRunning':True,'holdRetained':True,'businessAcceptancePassed':False},'SWITCH_RESULT_UNKNOWN')
    config=dict(mode='status',root=str(root),bindingSha256=rb.sha(braw),hold=b['hold'],switchReceiptSha256=rb.sha(switch),issuedAt=f['issuedAt'],expiresAt=f['expiresAt'])
    runtime=rb.trusted_module(source.replace(b'__CONFIG__',repr(config).encode()),'recovery_status')
    return (json.dumps(runtime['run'](config),sort_keys=True)+'\n').encode()


def classify(a,release,fresh_raw,modules,*,reader=None,hold_reader=None,phase_observer=None,now=None):
    rb=modules['reader'];e=modules['entry'];reader=reader or rb.Reader(max_seconds=120);now=now or dt.datetime.now(dt.timezone.utc)
    f=rb.parse(fresh_raw);identity=a['identity'];fresh_sha=rb.sha(fresh_raw)
    need(a['kind']=='cn-fixed-release-approval-v1' and a['target']==TARGET,'RELEASE_SCOPE')
    need(f['kind']=='cn-release-fresh-recovery-delegation-v1' and f['releaseSha256']==release and f['identity']==identity and f['target']==TARGET,'FRESH_RECOVERY_IDENTITY')
    need(rb.timestamp(f['issuedAt'])<=now<rb.timestamp(f['expiresAt']) and dt.timedelta(0)<rb.timestamp(f['expiresAt'])-rb.timestamp(f['issuedAt'])<=dt.timedelta(minutes=30),'FRESH_RECOVERY_WINDOW')
    root=Path(f['runtimeRoot']);need(str(root)==a['runtimeStage']['remoteRoot'] and root.parent==VAR/'runtime' and re.fullmatch('upgrade-f0eb-[a-z0-9-]{1,64}',root.name),'RUNTIME_SCOPE')
    inputs=VAR/'release-inputs'/release
    original_raw=reader.file(inputs/'recovery-original-binding.json');prior_observation=reader.file(inputs/'recovery-terminalObservation.json');reconciliation=reader.file(inputs/'recovery-reconciliation.json')
    need({k:rb.sha(v)for k,v in {'binding':original_raw,'terminalObservation':prior_observation,'reconciliation':reconciliation}.items()}==f['inputHashes'],'RECOVERY_INPUT_RAW_PINS')
    stage=f['failedStage'];need(stage in e.STAGES,'FAILED_STAGE');index=e.STAGES.index(stage)
    attempt=e.STATE/identity['attemptId'];need(e.decode(e.read(e.STATE/'active-attempt.json'))==identity['attemptId'],'ACTIVE_ATTEMPT')
    if index>=e.STAGES.index('clear-hold') or (attempt/'15-clear-hold.intent.json').exists():return {'status':'REHOLD_APPROVAL_REQUIRED','externalWritesTerminal':False,'safeToRecover':False}
    need(stage in ('stop','backup','rds-backup','switch'),'HELD_PHASE_UNSUPPORTED')
    previous_raw=None
    for i,prior_stage in enumerate(e.STAGES[:index]):
        path=attempt/('%02d-%s.receipt.json'%(i,prior_stage));raw=e.read(path);receipt=e.decode(raw)
        prior_manifest,_=e.load_package(receipt['requestSha256'],identity['attemptId']);e.verify_historical_receipt(path,receipt,prior_manifest)
        need(prior_manifest['authorizationEvidenceSha256']==release,'RECOVERY_PRIOR_RELEASE')
        need(receipt['stage']==prior_stage and receipt['previousReceiptSha256']==(rb.sha(previous_raw)if previous_raw else None),'RECOVERY_PRIOR_CHAIN')
        for k,v in identity.items():
            if k!='publicationAttemptId':need(receipt[k]==v,'RECOVERY_PRIOR_IDENTITY')
        previous_raw=raw
    allowed={('%02d-%s.intent.json'%(i,s))for i,s in enumerate(e.STAGES[:index+1])}
    need(all(p.name in allowed for p in attempt.glob('*.intent.json')),'OTHER_INVOCATION_UNKNOWN')
    prefix=attempt/('%02d-%s'%(index,stage));intent_raw=e.read(Path(str(prefix)+'.intent.json'));process_raw=e.read(Path(str(prefix)+'.process.json'))
    intent=e.decode(intent_raw);process=e.decode(process_raw)
    need(intent['requestSha256']==process['requestSha256']==f['failedRequestSha256'],'FAILED_REQUEST_LINK')
    need(e.execution_terminal(process),'LOCAL_INVOCATION_UNKNOWN')
    manifest,files=e.load_package(f['failedRequestSha256'],identity['attemptId'])
    need(manifest['previousReceiptSha256']==rb.sha(previous_raw),'FAILED_PREDECESSOR')
    need(manifest['stage']==stage and manifest['authorizationEvidenceSha256']==release and manifest['verifierSha256']==f['terminalVerifierSha256'],'FAILED_PACKAGE_LINK')
    for k,v in identity.items():
        if k!='publicationAttemptId':need(manifest[k]==v,'FAILED_IDENTITY')
    braw=reader.file(root/'binding.json');need(rb.sha(braw)==f['originalBindingSha256'] and braw==original_raw,'ORIGINAL_BINDING_PIN');b=rb.parse(braw)
    for k,v in identity.items():
        if k!='publicationAttemptId':need(b[k]==v,'ORIGINAL_CLOCK_IDENTITY')
    runtime=reader.file(root/'upgrade-draft.py');need(rb.sha(runtime)==f['upgradeSha256']==b['scriptSha256'],'ORIGINAL_RUNTIME_PIN')
    original=rb.trusted_module(runtime,'recovery_admission_upgrade');original['validate_binding'](b)
    recovery=dict(kind='f0eb-fresh-recovery-v1',operation=f['operation'],originalBindingSha256=f['originalBindingSha256'],
        **{k:b[k]for k in ('attemptId','sourceRevision','baselineRevision','hold')},issuedAt=f['issuedAt'],expiresAt=f['expiresAt'],
        authorizationEvidenceSha256=fresh_sha,reconciliationSha256=rb.sha(reconciliation))
    original['validate_recovery'](b,f['originalBindingSha256'],recovery,f['operation'],now,rb.parse(reconciliation))
    # Exact canonical action proves the original invocation had no additional
    # arbitrary cloud commands; completed cgroup is still only the local half.
    if stage!='rds-backup':
        expected=('/usr/bin/python3 -I -S -B '+str(root)+'/upgrade-draft.py '+str(root)+' '+rb.sha(braw)+' '+stage+'\n').encode()
        need(files['action.sh']==expected,'NONCANONICAL_ACTION_CLOSURE')
    else:
        expected=('/usr/bin/python3 -I -B '+str(ROOT/CODE['rds'])+' action '+release+'\n').encode()
        need(files['action.sh']==expected,'NONCANONICAL_RDS_ACTION_CLOSURE')
        generated=VAR/'release-generated'/release/'stages'/stage
        record=rb.parse(reader.file(generated/'generated.json'));need(record['requestSha256']==f['failedRequestSha256'] and record['releaseSha256']==release,'RDS_ACTION_CLOSURE')
        need(rb.sha(reader.file(ROOT/CODE['rds']))==a['codeFiles'][CODE['rds']]==a['rds']['adapterSha256'],'RDS_ADAPTER_PIN')
    need(rb.sha(reader.file(HOLD,modes=(0o600,0o700)))==b['holdHelperSha256'],'HOLD_CODE_PIN')
    if hold_reader is None:hold_reader=lambda:rb.parse(run_read(['/usr/bin/python3','-I','-S','-B',str(HOLD),'read',str(VAR/'runtime')]))
    first=hold_reader()
    if first.get('state')=='cleared':return {'status':'REHOLD_APPROVAL_REQUIRED','externalWritesTerminal':False,'safeToRecover':False}
    need(first==b['hold'] and first['state']=='held','HOLD_CHANGED')
    need(f['operation']==('rollback'if (root/'switch-intent.json').exists()else'abort-original'),'RECOVERY_OPERATION')
    observation=(phase_observer or observe_phase)(stage,a,release,f,modules,b,braw,reader,hold_reader,now=now)
    if stage=='rds-backup':need(prior_observation==observation,'RDS_RAW_OBSERVATION_CHANGED')
    else:
        canonical=None
        if stage=='switch':
            template=reader.file(ROOT/TEMPLATE);need(rb.sha(template)==a['codeFiles'][TEMPLATE],'STATUS_CODE_PIN')
            canonical=rb.trusted_module(template.replace(b'__CONFIG__',b'{}'),'recovery_compare_status')
        modules['runtimeObserver'].verify_observation(prior_observation,observation,{'mode':stage,'bindingSha256':rb.sha(braw)},b,now=now,canonical_final=canonical)
    need(hold_reader()==first and reader.file(root/'binding.json')==braw and e.read(Path(str(prefix)+'.intent.json'))==intent_raw
      and e.read(Path(str(prefix)+'.process.json'))==process_raw and e.execution_terminal(process),'RECOVERY_OBSERVATION_DRIFT')
    return {'kind':'cn-held-recovery-admission-v1','status':'PROVEN','externalWritesTerminal':True,'safeToRecover':True,
        'releaseSha256':release,'freshRecoveryApprovalSha256':fresh_sha,'identity':identity,'stage':stage,'failedRequestSha256':f['failedRequestSha256'],
        'terminalObservationSha256':rb.sha(prior_observation),'bindingSha256':rb.sha(braw),'holdGeneration':first['generation'],'observationSha256':rb.sha(observation),'observedAt':now.isoformat(),
        'scope':'known-reviewed-operation-only','allExternalWritersFenced':False}


def observe(release_sha,fresh_sha):
    need(os.geteuid()==0 and all(re.fullmatch('[a-f0-9]{64}',x)for x in (release_sha,fresh_sha)),'ROOT_AUTHORITY')
    import hashlib
    raw=private(ETC/'release-approvals'/(release_sha+'.json'));need(hashlib.sha256(raw).hexdigest()==release_sha,'RELEASE_HASH');a=json.loads(raw)
    modules=closure(a);fresh=private(ETC/'release-recovery-approvals'/(fresh_sha+'.json'))
    need(hashlib.sha256(fresh).hexdigest()==fresh_sha,'FRESH_HASH')
    return classify(a,release_sha,fresh,modules)


def verify(raw,manifest,previous,mode,context):
    """Fixed stage wrapper: independently read authority and actual terminal state.
    Input remains original observer bytes pinned before fresh approval, avoiding
    a circular fresh-approval/admission-summary hash dependency.
    """
    need(mode=='pre-recovery' and set(context)=={'releaseSha256','recoveryApprovalSha256'},'RECOVERY_VERIFY_SCOPE')
    result=observe(context['releaseSha256'],context['recoveryApprovalSha256'])
    need(result.get('status')=='PROVEN' and result.get('safeToRecover')is True,'RECOVERY_NOT_PROVEN')
    import hashlib
    digest=lambda value:hashlib.sha256(value).hexdigest()
    # Entry uses this same canonical serialization for immutable manifest bytes.
    request=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()
    need(digest(request)==result['failedRequestSha256'] and manifest['stage']==result['stage'],'RECOVERY_FAILED_MANIFEST')
    need(digest(raw)==result['terminalObservationSha256'],'RECOVERY_ORIGINAL_OBSERVATION')
    return {'externalWritesTerminal':True,'safeToRecover':True}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release-sha256',required=True);p.add_argument('--recovery-approval-sha256',required=True);args=p.parse_args()
    result=observe(args.release_sha256,args.recovery_approval_sha256)
    print(json.dumps(result,sort_keys=True));return 0 if result['safeToRecover'] else 2


if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        print('{"status":"UNKNOWN","externalWritesTerminal":false,"safeToRecover":false,"reason":"INDEPENDENT_TERMINAL_UNPROVEN"}');sys.exit(2)
