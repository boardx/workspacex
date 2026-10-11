#!/usr/bin/env python3
"""Fixed observer/verifier dispatch for root-derived stage packages.

Caller selects only a literal stage. Identity comes from the durable active
entry's immutable request and its once-approved release, not boundary JSON.
"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]

def module(path,name):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

e=module(ROOT/'.harness/scripts/vm/cn-release-advance.py','contract_entry')
APPROVALS=Path('/etc/workspacex-cn/release-approvals')
GENERATED=Path('/var/lib/workspacex-cn/release-generated')
MODULES={'consume':'scripts/cn-release-acquire-observer.py','publication':'scripts/cn-release-publication-observer.py',
         'runtime':'scripts/cn-release-runtime-observe.py','rds':'scripts/cn-release-rds-backup.py',
         'business':'scripts/cn-release-business-observer.py'}


def context(stage,manifest=None):
    e.need(stage in e.STAGES,'STAGE')
    if manifest is None:
        attempt=e.decode(e.read(e.STATE/'active-attempt.json'));e.need(e.ATTEMPT.fullmatch(attempt),'ACTIVE_ATTEMPT')
        prefix=e.STATE/attempt/('%02d-%s'%(e.STAGES.index(stage),stage))
        intent=e.decode(e.read(Path(str(prefix)+'.intent.json')))
        manifest,_=e.load_package(intent['requestSha256'],attempt)
        request=intent['requestSha256']
    else:
        request=e.digest(e.encode(manifest));original,_=e.load_package(request,manifest['attemptId'])
        e.need(original==manifest,'MANIFEST_CHANGED')
    release=manifest['authorizationEvidenceSha256'];raw=e.read(APPROVALS/(release+'.json'))
    e.need(e.digest(raw)==release,'AUTHORIZATION_HASH');a=e.decode(raw)
    e.need(a['kind']=='cn-fixed-release-approval-v1' and manifest['stage']==stage,'AUTHORIZATION_SCOPE')
    for k in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt'):
        e.need(manifest[k]==a['identity'][k],'IDENTITY')
    # Verify the whole approved closure before dynamically importing any helper.
    for name,h in a['codeFiles'].items():
        p=Path(name);e.need(not p.is_absolute() and '..' not in p.parts,'CODE_PATH')
        e.need(e.digest(e.read(ROOT/p,1048576))==h,'CODE_PIN')
    folder=GENERATED/release/'stages'/stage
    record=e.decode(e.read(folder/'generated.json'));rawctx=e.read(folder/'observer-context.json')
    e.need(record['releaseSha256']==release and record['stage']==stage and record['requestSha256']==request
           and record['observerContextSha256']==e.digest(rawctx),'GENERATION_CONTEXT')
    return a,e.decode(rawctx),manifest,release


def load(key):return module(ROOT/MODULES[key],'stage_'+key)


def run_readonly(key,release):
    p=subprocess.run(['/usr/bin/python3','-I','-B',str(ROOT/MODULES[key]),'observe' if key=='rds' else 'readback',release],
        capture_output=True,timeout=115,env=e.ENV,cwd='/')
    e.need(p.returncode==0 and 0<len(p.stdout)<=e.MAX,'LIVE_OBSERVER_FAILED');return p.stdout


def staged(ctx):
    root=Path(ctx['remoteRoot']);e.need(root.parent==Path('/var/lib/workspacex-cn/runtime'),'RUNTIME_ROOT')
    snapshots={}
    for name,h in ctx['filesSha256'].items():
        e.need(Path(name).name==name,'STAGE_FILE');raw=e.read(root/name,1048576)
        e.need(e.digest(raw)==h,'STAGED_FILE_CHANGED');snapshots[name]=raw
    for pin in (ctx['bindingSha256'],ctx['expectedOldBindingSha256']):
        if pin is None:continue
        e.need(isinstance(pin,str) and e.HEX.fullmatch(pin),'BINDING_VERSION_PIN')
        name='bindings/'+pin+'.json';raw=e.read(root/name,1048576)
        e.need(e.digest(raw)==pin,'BINDING_VERSION_CHANGED');snapshots[name]=raw
    # Repeat root-protected raw comparisons to detect replacement during scan.
    for name,raw in snapshots.items():e.need(e.read(root/name,1048576)==raw,'STAGE_CHANGED_DURING_OBSERVATION')
    return e.encode({'phase':ctx['phase'],'bindingSha256':ctx['bindingSha256'],
        'oldBindingSha256':ctx['expectedOldBindingSha256'],'originalBindingsPreserved':True,
        'runtimeMutation':False,'holdChanged':False})


def observe(stage):
    a,ctx,m,release=context(stage)
    if stage=='consume':return load('consume').observe(ctx['requestSha256'])
    if stage in ('publication-stage','check-plan','publish'):return load('publication').observe(ctx['requestSha256'],stage)
    if stage.endswith('-stage'):return staged(ctx)
    if stage in ('hold','stop','sessions','backup','switch','acceptance','clear-hold'):
        helper=load('runtime');raw=e.read(helper.APPROVALS/(ctx['approvalSha256']+'.json'))
        e.need(e.digest(raw)==ctx['approvalSha256'],'OBSERVER_APPROVAL');return helper.observe(e.decode(raw))
    return run_readonly('rds'if stage=='rds-backup'else 'business',release)


def verify(stage,raw,manifest,previous,mode):
    a,ctx,m,release=context(stage,manifest)
    e.need(mode in ('advance','reconcile','terminal'),'NORMAL_CONTRACT_ONLY')
    if stage=='consume':return load('consume').verify(raw,m,previous,mode,ctx['requestSha256'])
    if stage in ('publication-stage','check-plan','publish'):return load('publication').verify(raw,m,previous,mode,ctx['requestSha256'])
    if stage.endswith('-stage'):
        # Staging is local-only under the outer cgroup. Compare exact installed
        # content with the approved generator; this does not attest remote work.
        actual=staged(ctx);e.need(e.decode(raw)==e.decode(actual),'STAGE_EVIDENCE_CHANGED')
        return {'externalWritesTerminal':True}if mode=='terminal'else True
    if stage in ('hold','stop','sessions','backup','switch','acceptance','clear-hold'):
        return load('runtime').verify(raw,m,previous,mode,{'approvalSha256':ctx['approvalSha256']})
    # Entry passes the decoded predecessor; provider adapters deliberately use
    # its raw canonical digest. Entry has already verified the stored bytes.
    previous_sha=e.digest(e.encode(previous)) if previous is not None else None
    result=load('rds'if stage=='rds-backup'else 'business').verify(raw,m,previous_sha,mode,release)
    if stage=='rds-backup':
        e.need(isinstance(result,dict) and result.get('valid')is True
               and result.get('externalWritesTerminal')is True
               and result.get('backupReceiptSha256')==e.digest(raw),'RDS_RESULT_CONTRACT')
        return {'externalWritesTerminal':True} if mode=='terminal' else True
    e.need(result=={'externalWritesTerminal':True} if mode=='terminal' else result is True,
           'BUSINESS_RESULT_CONTRACT')
    return result


if __name__=='__main__':
    try:
        e.need(os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1]=='observe','FIXED_OBSERVER_ONLY')
        sys.stdout.buffer.write(observe(sys.argv[2]))
    except Exception:
        print('{"status":"BLOCKED","code":"STAGE_OBSERVATION_UNPROVEN"}',file=sys.stderr);sys.exit(1)
