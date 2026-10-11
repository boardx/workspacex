#!/usr/bin/env python3
"""Fixed privileged readback and complete runtime closure checks; no cloud calls."""
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import time
import stat
import subprocess

ROOT=Path(__file__).resolve().parents[1]
ETC=Path('/etc/workspacex-cn')
VAR=Path('/var/lib/workspacex-cn')
TOOLS=Path('/opt/workspacex-cn/release-tools')
FIELDS=('sourceRevision','baselineRevision','controlRevision','publicationAttemptId','attemptId','requestedAt','deadlineAt')
TEMPLATE='.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py'
BROWSER='.harness/scripts/vm/cn-maintenance-browser.cjs'

def need(v,c):
    if not v:raise ValueError(c)

def sha(raw):return hashlib.sha256(raw).hexdigest()
def enc(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def parse(raw):
    def pairs(items):
        out={}
        for k,v in items:need(k not in out,'DUPLICATE_JSON');out[k]=v
        return out
    return json.loads(raw,object_pairs_hook=pairs)
def stamp(v):
    t=dt.datetime.fromisoformat(v.replace('Z','+00:00'));need(t.tzinfo is not None,'TIMEZONE');return t

class Reader:
    def __init__(self,owner=0,trust=Path('/')):self.owner=owner;self.trust=trust
    def directory(self,path):
        need(path.is_absolute() and '..'not in path.parts and (path==self.trust or self.trust in path.parents),'PATH_SCOPE')
        for p in (path,*path.parents):
            s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==self.owner and not s.st_mode&0o022,'UNTRUSTED_PARENT')
            if p==self.trust:break
    def file(self,path,limit=1048576,private=True):
        self.directory(path.parent);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,'rb')as f:
            s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==self.owner and s.st_nlink==1 and not s.st_mode&(0o077 if private else 0o022) and s.st_size<=limit,'UNTRUSTED_FILE')
            raw=f.read(limit+1);after=os.fstat(f.fileno());need(len(raw)==s.st_size and (s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'FILE_CHANGED');return raw
    def pinned(self,path,pin,limit=1048576,private=True):
        raw=self.file(path,limit,private);need(sha(raw)==pin,'FILE_PIN');return raw
    def tree(self,path,pins):
        self.directory(path);need(type(pins)is dict and pins,'TREE_EMPTY');actual={}
        for p in path.rglob('*'):
            s=p.lstat();need(not stat.S_ISLNK(s.st_mode),'TREE_SYMLINK')
            if stat.S_ISDIR(s.st_mode):self.directory(p)
            else:actual[str(p.relative_to(path))]=sha(self.file(p,256*1024*1024,False))
        need(actual==pins,'TREE_CLOSURE')


def preflight(a,reader=None):
    reader=reader or Reader();cfg=a['business'];identity=a['identity']
    need(set(cfg)=={'runtimeProfileSha256','planSha256','testDataScopeSha256','recoveryPlanSha256','recoveryTestDataScopeSha256','stableWindowSeconds'},'BUSINESS_CONFIG')
    need(type(cfg['stableWindowSeconds'])is int and 30<=cfg['stableWindowSeconds']<=300,'STABILITY_WINDOW')
    for name in ('scripts/cn-release-business-observer.py','scripts/cn-release-business-state.py','scripts/cn-release-business-recovery.py',TEMPLATE,BROWSER):
        reader.pinned(ROOT/name,a['codeFiles'][name])
    profile=parse(reader.pinned(ETC/'business-runtime.json',cfg['runtimeProfileSha256']))
    need(set(profile)=={'schemaVersion','toolRevision','nodeSha256','pythonSha256','pythonPath','dockerSha256','holdHelperSha256','chromiumPath','chromiumSha256','chromiumRoot','chromiumFilesSha256','runtimeRoot','filesSha256','entryRelative','playwrightRelative','sourcePins'},'RUNTIME_PROFILE_FIELDS')
    need(profile['schemaVersion']==1 and re.fullmatch('[a-f0-9]{40}',profile['toolRevision']),'RUNTIME_PROFILE')
    runtime=Path(profile['runtimeRoot']);need(runtime==TOOLS/profile['toolRevision']/'business','RUNTIME_SCOPE')
    for key in ('entryRelative','playwrightRelative'):need(type(profile[key])is str and profile[key] and not Path(profile[key]).is_absolute() and '..'not in Path(profile[key]).parts,'RUNTIME_RELATIVE')
    need(profile['entryRelative']=='scripts/cn-release-business-entry.mjs','ENTRY_PATH')
    reader.tree(runtime,profile['filesSha256'])
    required={'scripts/cn-release-business-entry.ts','scripts/cn-release-business-runner.ts',BROWSER,
        'packages/cloud-deploy/src/cn-release-browser-contract.ts','packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract.ts'}
    need(set(profile['sourcePins'])==required,'BUILD_SOURCE_CLOSURE')
    for name,pin in profile['sourcePins'].items():
        need(a['codeFiles'][name]==pin,'BUILD_SOURCE_APPROVAL');reader.pinned(ROOT/name,pin)
    need(re.fullmatch(r'/usr/bin/python3\.[0-9]+',profile['pythonPath']),'PYTHON_PATH')
    for path,key in [('/usr/bin/node','nodeSha256'),(profile['pythonPath'],'pythonSha256'),('/usr/bin/docker','dockerSha256'),('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','holdHelperSha256')]:reader.pinned(Path(path),profile[key],256*1024*1024,False)
    chrome_root=Path(profile['chromiumRoot']);need(chrome_root==TOOLS/profile['toolRevision']/'chromium','CHROME_ROOT');reader.tree(chrome_root,profile['chromiumFilesSha256'])
    chrome=Path(profile['chromiumPath']);need(chrome.parent==chrome_root and chrome.name=='chrome','CHROME_PATH');reader.pinned(chrome,profile['chromiumSha256'],512*1024*1024,False)
    def read_plan(version,plan_pin,scope_pin):
        planroot=ETC/'maintenance-activation'/version/identity['attemptId']
        plan=parse(reader.pinned(planroot/'browser-plan.json',plan_pin,65536))
        scope=parse(reader.pinned(planroot/'test-data-scope.json',scope_pin,65536))
        need(set(scope)=={'kind','identity','runtimeRevision','publicOrigin','email','agentId','threadId','feedbackId','githubIssueNumber','skillVersionId','skillPromptSha256','pdfPromptSha256','audioSha256'},'TEST_SCOPE_FIELDS')
        need(scope['kind']=='cn-release-test-data-scope-v1' and scope['identity']==identity and scope['runtimeRevision']==version and scope['publicOrigin']=='https://app.boardx.com.cn/'==plan['publicUrl'],'TEST_SCOPE_IDENTITY')
        for k in ('email','agentId','threadId','feedbackId','githubIssueNumber','skillVersionId','audioSha256'):need(scope[k]==plan[k],'TEST_SCOPE_'+k)
        for k in ('skillPrompt','pdfPrompt'):need(sha(plan[k].encode())==scope[k+'Sha256'],'TEST_PROMPT_SCOPE')
        need(plan['playwrightModule']==str(runtime/profile['playwrightRelative']) and plan['browserExecutable']==str(chrome),'PLAN_RUNTIME')
        need(Path(plan['audioPath'])==planroot/'audio.wav','AUDIO_SCOPE');reader.pinned(Path(plan['audioPath']),plan['audioSha256'],16*1024*1024)
        return plan,scope
    plan,scope=read_plan(identity['sourceRevision'],cfg['planSha256'],cfg['testDataScopeSha256'])
    recovery_plan,recovery_scope=read_plan(identity['baselineRevision'],cfg['recoveryPlanSha256'],cfg['recoveryTestDataScopeSha256'])
    # Require the existing runner in the installed bundle layout, byte-for-byte.
    need(profile['filesSha256'].get(BROWSER)==profile['sourcePins'][BROWSER],'CANONICAL_BROWSER_LAYOUT')
    return {'profile':profile,'plan':plan,'scope':scope,'recoveryPlan':recovery_plan,'recoveryScope':recovery_scope}



def invoke(argv,limit=1048576):
    # Fixed read commands only. A higher outer cgroup deadline remains required.
    p=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True,
        pass_fds=(9,),env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'});out=b'';end=time.monotonic()+30
    try:
        while True:
            need(time.monotonic()<end,'LIVE_READ_TIMEOUT')
            ready,_,_=select.select([p.stdout],[],[],min(.2,max(.001,end-time.monotonic())))
            if not ready:continue
            chunk=os.read(p.stdout.fileno(),min(65536,limit+1-len(out)))
            if not chunk:break
            out+=chunk;need(len(out)<=limit,'LIVE_READ_BOUND')
        need(p.wait(timeout=max(.01,end-time.monotonic()))==0,'LIVE_READ_FAILED');return out
    finally:
        try:os.killpg(p.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        finally:
            try:p.wait(timeout=5)
            finally:p.stdout.close()



def load_status_validator(a,reader):
    raw=reader.pinned(ROOT/TEMPLATE,a['codeFiles'][TEMPLATE]);tree=ast.parse(raw)
    nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='validate_status'];need(len(nodes)==1,'CANONICAL_STATUS_SHAPE')
    scope={};exec(compile(ast.Module(body=nodes,type_ignores=[]),'<pinned-canonical-status>','exec'),scope);return scope['validate_status']


def read_public(a,release_sha,prepared,reader=None,call=invoke,now=None,read_only=False):
    reader=reader or Reader();identity=a['identity'];now=now or dt.datetime.now(dt.timezone.utc)
    need(stamp(identity['requestedAt'])<=now and (read_only or now<stamp(identity['deadlineAt'])),'RELEASE_DEADLINE')
    root=Path(a['runtimeStage']['remoteRoot']);need(root.parent==VAR/'runtime' and re.fullmatch('upgrade-[a-z0-9-]{1,100}',root.name),'RUNTIME_ROOT')
    binding_raw=reader.file(root/'binding.json');b=parse(binding_raw)
    expected=reader.file(VAR/'release-generated'/release_sha/'runtime'/'switch'/'binding.json');need(binding_raw==expected,'LIVE_BINDING')
    for key in FIELDS:
        if key!='publicationAttemptId':need(b[key]==identity[key],'BINDING_IDENTITY')
    need(b['draft']is False and b['holdHelperSha256']==prepared['profile']['holdHelperSha256'],'BINDING_EXECUTABLE')
    switch_raw=reader.file(root/'switch-result.json');need(parse(switch_raw)=={'exactFiveRunning':True,'holdRetained':True,'businessAcceptancePassed':False},'SWITCH_RESULT')
    need(parse(reader.file(root/'switch-intent.json'))=={'bindingSha256':sha(binding_raw),'holdGeneration':b['hold']['generation']},'SWITCH_INTENT')
    # Complete original clear action/observation/receipt linkage, never mere exists.
    state=VAR/'continuation'/identity['attemptId'];prefix=state/'15-clear-hold'
    receipt=parse(reader.file(Path(str(prefix)+'.receipt.json')));clear_raw=reader.file(Path(str(prefix)+'.evidence.json'));clear=parse(clear_raw)
    terminal_raw=reader.file(Path(str(prefix)+'.terminal-observation.json'))
    for key in FIELDS:
        if key!='publicationAttemptId':need(receipt[key]==identity[key],'CLEAR_RECEIPT_IDENTITY')
    need(receipt['stage']=='clear-hold' and receipt['mode']in ('advance','reconcile') and receipt['evidenceSha256']==sha(clear_raw) and receipt['terminalObservationSha256']==sha(terminal_raw),'CLEAR_RECEIPT_LINK')
    request_sha=receipt['requestSha256'];need(re.fullmatch('[a-f0-9]{64}',request_sha),'CLEAR_REQUEST_SHA')
    request_root=ETC/'continuation-requests'/request_sha
    manifest_raw=reader.pinned(request_root/'manifest.json',request_sha);manifest=parse(manifest_raw)
    need(manifest['stage']=='clear-hold' and manifest['previousReceiptSha256']==receipt['previousReceiptSha256'],'CLEAR_REQUEST_LINK')
    for key in FIELDS:
        if key!='publicationAttemptId':need(manifest[key]==identity[key],'CLEAR_MANIFEST_IDENTITY')
    need(manifest['authorizationEvidenceSha256']==release_sha,'CLEAR_RELEASE_AUTHORITY')
    action=reader.pinned(request_root/'action.sh',manifest['actionSha256'])
    for name,key in [('observe.sh','observerSha256'),('verify.py','verifierSha256')]:reader.pinned(request_root/name,manifest[key])
    reader.pinned(request_root/'authorization.json',release_sha)
    prev_raw=reader.file(state/'14-acceptance.receipt.json');need(sha(prev_raw)==receipt['previousReceiptSha256'],'CLEAR_PREVIOUS')
    previous=parse(prev_raw);held_raw=reader.file(state/'14-acceptance.evidence.json')
    need(previous['evidenceSha256']==sha(held_raw),'HEALTH_RECEIPT_HASH')
    pointer=parse(reader.file(ETC/'writer-resume-approvals'/'by-release'/(release_sha+'.json')));need(set(pointer)=={'approvalSha256'} and re.fullmatch('[a-f0-9]{64}',pointer['approvalSha256']),'A5_POINTER')
    approval_raw=reader.pinned(ETC/'writer-resume-approvals'/(pointer['approvalSha256']+'.json'),pointer['approvalSha256'],16384);w=parse(approval_raw)
    need(w['identity']==identity and w['releaseSha256']==release_sha and w['testDataScopeSha256']==a['business']['testDataScopeSha256'],'A5_IDENTITY_SCOPE')
    need(w['bindingSha256']==sha(binding_raw) and w['switchReceiptSha256']==sha(switch_raw) and w['holdGeneration']==b['hold']['generation'],'A5_RUNTIME')
    provenance=parse(reader.file(VAR/'release-generated'/release_sha/'terminal'/'writer-resume'/'writer-resume-provenance.json'))
    need(provenance['kind']=='cn-writer-resume-materialization-v1' and provenance['releaseSha256']==release_sha and provenance['writerApprovalSha256']==pointer['approvalSha256'] and provenance['testDataScopeSha256']==w['testDataScopeSha256'] and provenance['identity']==identity,'A5_PROVENANCE')
    materialized=VAR/'release-generated'/release_sha/'terminal'/'writer-resume'
    need(type(provenance['files'])is dict and provenance['files'],'A5_FILES')
    for name,pin in provenance['files'].items():
        need(Path(name).name==name and name not in ('.','..'),'A5_FILE_NAME');reader.pinned(materialized/name,pin)
    need(sha(held_raw)==w['heldHealthSha256'],'A5_ACTUAL_HEALTH')
    parameters=parse(reader.file(materialized/'parameters.json'))
    import base64
    need(parameters['ContentEncoding']=='PlainText','A5_COMMAND_ENCODING');command=parameters['CommandContent'].encode()
    # Router action is precisely the reviewed original clear command; no suffix.
    need(action==command or action==command+b'\n','A5_EXECUTED_COMMAND')
    for key,wkey in [('binding','bindingSha256'),('switchReceipt','switchReceiptSha256'),('status','heldHealthSha256'),('hold','holdRawSha256'),('testDataScope','testDataScopeSha256'),('userAuthorization','userAuthorizationEvidenceSha256')]:need(provenance['inputHashes'][key]==w[wkey],'A5_INPUT_LINK')
    need(clear['kind']=='f0eb-hold-cleared-v1' and clear['actualHoldCleared']is True and clear['businessAcceptancePassed']is False and clear['generation']==w['holdGeneration'] and clear['identity']==b['hold']['identity'] and clear['bindingSha256']==sha(binding_raw) and clear['statusSha256']==w['heldHealthSha256'],'ACTUAL_CLEAR')
    helper=[prepared['profile']['pythonPath'],'-I','-S','-B','/usr/local/lib/workspacex-cn/cn_maintenance_hold.py','read',str(VAR/'runtime')]
    hold=parse(call(helper));need(hold=={**b['hold'],'state':'cleared'},'LIVE_CLEAR_HOLD')
    for f in b['composeFiles']+b['envFiles']:reader.pinned(Path(f['path']),f['sha256'])
    xs=parse(call(['/usr/bin/docker','--host','unix:///run/docker.sock','inspect',*b['expectedContainers']]))
    observed=load_status_validator(a,reader)(b,root,xs)
    need(parse(call(helper))==hold,'HOLD_CHANGED')
    state={'identity':identity,'boundary':{'phase':'production-public','lockRetained':True,'writesHeld':False,'testDataScopeApproved':True,'publicResumeAuthorized':True},
        'runtimeRevision':identity['sourceRevision'],'runtimeInventorySha256':sha(enc(observed)),'deploymentMarker':prepared['plan']['deploymentMarker'],'bindingSha256':sha(binding_raw),'switchReceiptSha256':sha(switch_raw),
        'holdGeneration':hold['generation'],'observedAt':now.isoformat(timespec='milliseconds').replace('+00:00','Z'),'clearReceiptSha256':sha(clear_raw),'runtimeHealthy':True,
        'writerResumeApprovalSha256':pointer['approvalSha256'],'testDataScopeSha256':w['testDataScopeSha256']}
    return state,{'approvalSha256':pointer['approvalSha256'],'raw':approval_raw.decode()}
