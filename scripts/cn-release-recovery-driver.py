#!/usr/bin/env python3
"""Fixed durable recovery stages; explicit run/resume and read-only reconcile.
No cloud dispatch, caller command, implicit rollback, retry or credential input.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import stat
import sys

ROOT=Path(__file__).resolve().parents[1]
ETC=Path('/etc/workspacex-cn');VAR=Path('/var/lib/workspacex-cn')
SELF='scripts/cn-release-recovery-driver.py'
CONTRACT='scripts/cn-release-recovery-contract.py'
BUSINESS='scripts/cn-release-business-observer.py'
WRITER='scripts/cn-release-recovery-writer.py'
ADMISSION='scripts/cn-release-recovery-admission.py'
ENTRY='.harness/scripts/vm/cn-release-advance.py'
STAGES=('runtime','clear','business')
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}

def need(v,c):
    if not v:raise ValueError(c)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def enc(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def parse(raw):
    def pairs(xs):
        d={}
        for k,v in xs:need(k not in d,'DUPLICATE_KEY');d[k]=v
        return d
    return json.loads(raw,object_pairs_hook=pairs)
def stamp(v):
    t=dt.datetime.fromisoformat(v.replace('Z','+00:00'));need(t.tzinfo is not None,'TIMEZONE');return t

def private(path,limit=1048576):
    for p in path.parents:
        s=p.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'ROOT_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb')as f:
        s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=limit,'ROOT_FILE')
        raw=f.read(limit+1);a=os.fstat(f.fileno());need(len(raw)==s.st_size and (s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(a.st_ino,a.st_mtime_ns,a.st_ctime_ns),'FILE_CHANGED');return raw

def module(name):
    spec=importlib.util.spec_from_file_location(Path(name).stem,ROOT/name);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def capability(a):
    required=(SELF,CONTRACT,BUSINESS,WRITER,ADMISSION,ENTRY,'scripts/cn-release-business-state.py','scripts/cn-release-business-recovery.py')
    need(all(name in a['codeFiles']for name in required),'RECOVERY_CODE_CLOSURE')
    for name,pin in a['codeFiles'].items():
        path=Path(name);need(not path.is_absolute()and '..'not in path.parts and str(path)==name,'CODE_PATH')
        need(sha(private(ROOT/path))==pin,'RECOVERY_CODE_PIN')
    return {'kind':'cn-recovery-driver-capability-v1','stages':list(STAGES),'unknownReplayAllowed':False,'productionInstalled':False}

def load(release,fresh):
    need(all(re.fullmatch('[a-f0-9]{64}',x)for x in (release,fresh)),'AUTHORITY_HASH')
    raw=private(ETC/'release-approvals'/(release+'.json'),65536);need(sha(raw)==release,'RELEASE_HASH');a=parse(raw);capability(a)
    fraw=private(ETC/'release-recovery-approvals'/(fresh+'.json'),65536);need(sha(fraw)==fresh,'FRESH_HASH');f=parse(fraw)
    need(a['kind']=='cn-fixed-release-approval-v1'and a['target']==TARGET and f['kind']=='cn-release-fresh-recovery-delegation-v1'and f['releaseSha256']==release and f['identity']==a['identity']and f['target']==TARGET,'RECOVERY_IDENTITY')
    pointer=parse(private(ETC/'release-recovery-approvals'/'by-failed-request'/(f['failedRequestSha256']+'.json'),65536));need(pointer=={'approvalSha256':fresh},'FRESH_RECOVERY_POINTER')
    need(f['operation']in ('rollback','abort-original')and dt.timedelta(0)<stamp(f['expiresAt'])-stamp(f['issuedAt'])<=dt.timedelta(minutes=30),'RECOVERY_SCOPE')
    return raw,a,fraw,f

def coordinate(root,authority,ops,e,mode='run'):
    """Testable durable state machine. ops is fixed by production bootstrap only."""
    need(mode in ('run','reconcile','status'),'MODE')
    for index,stage in enumerate(STAGES):
        prefix=root/('%02d-%s'%(index,stage));receipt=Path(str(prefix)+'.receipt.json');intent=Path(str(prefix)+'.intent.json')
        evidence=Path(str(prefix)+'.evidence.json');process=Path(str(prefix)+'.process.json')
        if receipt.exists():
            v=parse(e.read(receipt));need(v['authority']==authority and v['stage']==stage and v['evidenceSha256']==sha(e.read(evidence)),'RECOVERY_CHECKPOINT_CHANGED');continue
        if intent.exists():
            need(parse(e.read(intent))=={'authority':authority,'stage':stage},'RECOVERY_INTENT_CHANGED')
            if mode!='reconcile':return {'status':'UNKNOWN_RECONCILE_REQUIRED','stage':stage,'mutationRetried':False}
            need(process.exists(),'RECOVERY_PROCESS_UNPROVEN');proc=parse(e.read(process));need(proc['authority']==authority and proc['stage']==stage and e.execution_terminal(proc),'RECOVERY_PROCESS_UNPROVEN')
            raw=ops.observe(stage)
            if evidence.exists():need(e.read(evidence)==raw,'PARTIAL_EVIDENCE_CHANGED')
            else:e.create(evidence,raw)
            e.create(receipt,enc({'authority':authority,'stage':stage,'evidenceSha256':sha(raw)}))
            # Reconcile may resolve one known action; it never starts a later one.
            return {'status':'RECONCILED','stage':stage,'mutationRetried':False}
        if mode!='run':return {'status':'NOT_STARTED','stage':stage,'mutationRetried':False}
        ops.window()
        if stage=='clear'and not ops.writer_available():return {'status':'WAITING_FOR_BASELINE_WRITER_APPROVAL','stage':stage,'intentCreated':False}
        ops.prepare(stage)
        ops.window()
        e.KillDomain.preflight()
        e.create(intent,enc({'authority':authority,'stage':stage}))
        reason,code,output,pid=e.run_command(ops.command(stage),ops.remaining(),lambda p,isolation:e.create(process,enc({'pid':p,'isolation':isolation,'authority':authority,'stage':stage})))
        e.create(Path(str(prefix)+'.terminal.json'),enc({'reason':reason,'exitCode':code,'outputSha256':sha(output),'processGroupStillPresent':e.alive(pid)}))
        need(reason=='EXITED'and code==0 and not e.alive(pid),'RECOVERY_UNKNOWN_NO_RETRY')
        ops.window();raw=ops.observe(stage);ops.window()
        e.create(evidence,raw);e.create(receipt,enc({'authority':authority,'stage':stage,'evidenceSha256':sha(raw)}))
    result=ops.final()
    final=root/'final.json';raw=enc(result)
    if final.exists():need(e.read(final)==raw,'FINAL_RECOVERY_CHANGED')
    else:
        need(mode=='run','FINAL_RECORD_NOT_CREATED');e.create(final,raw)
    return {'status':'RECOVERY_VERIFIED','result':result,'finalSha256':sha(raw)}

class Operations:
    def __init__(self,release,fresh,a,f,e):self.release=release;self.fresh=fresh;self.a=a;self.f=f;self.e=e
    def window(self):need(stamp(self.f['issuedAt'])<=dt.datetime.now(dt.timezone.utc)<stamp(self.f['expiresAt']),'RECOVERY_EXPIRED')
    def remaining(self):return max(.01,min(1200,(stamp(self.f['expiresAt'])-dt.datetime.now(dt.timezone.utc)).total_seconds()))
    def writer_available(self):return (ETC/'recovery-writer-resume-approvals'/'by-recovery'/(self.fresh+'.json')).exists()
    def command(self,stage):
        if stage=='runtime':
            root=Path(self.f['runtimeRoot']);raw=private(root/'recovery-binding.json')
            argv=['/usr/bin/python3','-I','-S','-B',str(root/'upgrade-draft.py'),str(root),self.f['originalBindingSha256'],self.f['operation'],sha(raw)]
        elif stage=='clear':argv=['/usr/bin/python3','-I','-B',str(ROOT/WRITER),'--release-sha256',self.release,'--recovery-approval-sha256',self.fresh]
        else:argv=['/usr/bin/python3','-I','-B',str(ROOT/BUSINESS),'rollback',self.release,self.fresh]
        return ('#!/bin/bash\nset -euo pipefail\nexec '+shlex.join(argv)+'\n').encode()
    def prepare(self,stage):
        if stage!='runtime':return
        # Recheck actual original remote termination before any rollback action.
        result=module(ADMISSION).observe(self.release,self.fresh)
        need(result['safeToRecover']is True and result['externalWritesTerminal']is True,'PRE_RECOVERY_UNPROVEN')
        root=Path(self.f['runtimeRoot']);need(root==Path(self.a['runtimeStage']['remoteRoot'])and root.parent==VAR/'runtime'and re.fullmatch('upgrade-f0eb-[a-z0-9-]{1,64}',root.name),'RUNTIME_ROOT')
        need(sha(private(root/'upgrade-draft.py'))==self.f['upgradeSha256'],'RUNTIME_CODE_PIN')
        generated=VAR/'release-generated'/self.release/'terminal'/('recovery-'+self.fresh)
        provenance=parse(private(generated/'provenance.json'));need(provenance['releaseSha256']==self.release and provenance['freshApprovalSha256']==self.fresh,'RECOVERY_MATERIALIZATION')
        values={name:private(generated/name)for name in ('recovery-binding.json','recovery-reconciliation.json')}
        binding=parse(private(root/'binding.json'));need(sha(private(root/'binding.json'))==self.f['originalBindingSha256'],'BASE_BINDING')
        rec=parse(values['recovery-binding.json']);need(rec['authorizationEvidenceSha256']==self.fresh and rec['originalBindingSha256']==self.f['originalBindingSha256']and rec['reconciliationSha256']==sha(values['recovery-reconciliation.json']),'RECOVERY_MATERIALIZATION_PINS')
        lock=VAR/'runtime'/'release.lock';private(lock);fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            if self.f['operation']=='rollback':values['rollback-images.json']=enc({'services':{k:{'image':v}for k,v in binding['rollbackImages'].items()}})
            for name,raw in values.items():
                if (root/name).exists():need(private(root/name)==raw,'RECOVERY_STAGE_EXISTS_DIFFERENT')
                else:self.e.create(root/name,raw)
        finally:os.close(fd)
    def observe(self,stage):
        business=module(BUSINESS)
        if stage=='runtime':return self.baseline_readback(business)
        if stage=='business':return enc(business.execute(self.a,self.release,'rollback-readback',self.fresh))
        # Independent live clear proof, without launching a browser or clear.
        state=business.state_module(self.a);prepared=business.preflight(self.a)
        lock=VAR/'runtime'/'release.lock';state.Reader().file(lock);fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            if fd!=9:os.dup2(fd,9);os.close(fd)
            fd=9;os.set_inheritable(fd,True)
            business.recovery_module(self.a).public(self.a,self.release,private(ETC/'release-recovery-approvals'/(self.fresh+'.json')),prepared,state,read_only=True)
            return private(VAR/'release-generated'/self.release/'terminal'/'recovery-writer-resume'/'recovery-clear-result.json')
        finally:os.close(fd)
    def baseline_readback(self,business):
        state=business.state_module(self.a);prepared=business.preflight(self.a)
        lock=VAR/'runtime'/'release.lock';state.Reader().file(lock);fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            if fd!=9:os.dup2(fd,9);os.close(fd)
            fd=9;os.set_inheritable(fd,True)
            health=business.recovery_module(self.a).health(self.a,self.release,private(ETC/'release-recovery-approvals'/(self.fresh+'.json')),prepared,state,read_only=True)
            # Stable original facts, so loss after writing evidence can reconcile
            # without minting a changed observedAt and overwriting prior bytes.
            health.pop('observedAt');return enc(health)
        finally:os.close(fd)
    def final(self):
        raw=self.observe('business');v=parse(raw)
        need(v['kind']=='cn-independent-business-acceptance-v1'and v['mode']=='rollback'and v['runtimeRevision']==self.a['identity']['baselineRevision']and v['recoveryApprovalSha256']==self.fresh,'FINAL_BASELINE_BUSINESS')
        need(set(v['checks'])=={'login','hello','asr','githubFeedbackRead','skillTool','pdfDownload'}and all(x is True for x in v['checks'].values()),'FINAL_SIX')
        clear=self.observe('clear')
        return {'kind':'cn-complete-runtime-recovery-v1','releaseSha256':self.release,'recoveryApprovalSha256':self.fresh,'identity':self.a['identity'],'businessReceiptSha256':sha(raw),'clearReceiptSha256':sha(clear),'baselineBusinessAccepted':True,'holdCleared':True,'externalWritesTerminal':True,'dataRestored':False}

def sealed_result(root,authority,ops,e):
    for index,stage in enumerate(STAGES):
        prefix=root/('%02d-%s'%(index,stage));v=parse(e.read(Path(str(prefix)+'.receipt.json')))
        need(v['authority']==authority and v['stage']==stage and v['evidenceSha256']==sha(e.read(Path(str(prefix)+'.evidence.json'))),'RECOVERY_CHECKPOINT_CHANGED')
    actual=ops.final();need(e.read(root/'final.json')==enc(actual),'FINAL_RECOVERY_CHANGED');return actual


def seal_payload(release,fresh,raw,a,f,e):
    original,_=e.load_package(f['failedRequestSha256'],a['identity']['attemptId'])
    need(original['stage']==f['failedStage']and original['scope']=='runtime-only-reviewed-continuation'and e.STAGES.index(f['failedStage'])>=e.STAGES.index('stop'),'FAILED_PACKAGE')
    for key in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt'):need(original[key]==a['identity'][key],'ORIGINAL_IDENTITY')
    command=('#!/bin/bash\nset -euo pipefail\nexec '+shlex.join(['/usr/bin/python3','-I','-B',str(ROOT/CONTRACT),'observe',release,fresh])+'\n').encode()
    verifier=('import importlib.util,hashlib\nfrom pathlib import Path\np='+repr(str(ROOT/CONTRACT))+'\nassert hashlib.sha256(Path(p).read_bytes()).hexdigest()=='+repr(a['codeFiles'][CONTRACT])+'\ns=importlib.util.spec_from_file_location("recovery_contract",p)\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndef verify(raw,manifest,previous,mode):\n return m.verify(raw,manifest,previous,mode,'+repr(release)+','+repr(fresh)+')\n').encode()
    manifest={**original,'scope':'runtime-only-reviewed-recovery','recoveryOf':f['failedRequestSha256'],'issuedAt':f['issuedAt'],'expiresAt':f['expiresAt'],'timeoutSeconds':120,'actionSha256':sha(command),'observerSha256':sha(command),'verifierSha256':sha(verifier),'authorizationEvidenceSha256':release}
    values={'manifest.json':enc(manifest),'action.sh':command,'observe.sh':command,'verify.py':verifier,'authorization.json':raw}
    return manifest,values

def prepare_seal(release,fresh,raw,a,f,e):
    manifest,values=seal_payload(release,fresh,raw,a,f,e)
    request=sha(enc(manifest));root=e.REQUESTS/request;e.directory(e.REQUESTS)
    if root.exists():
        need({p.name for p in root.iterdir()}==set(values),'SEAL_PACKAGE_PARTIAL')
        for name,value in values.items():need(e.read(root/name)==value,'SEAL_PACKAGE_CHANGED')
    else:
        root.mkdir(mode=0o700);e.fsync_dir(root.parent)
        for name,value in values.items():e.create(root/name,value)
    return {'kind':'cn-readonly-recovery-seal-package-v1','requestSha256':request,'attemptId':a['identity']['attemptId'],'entryMode':'recover','runtimeMutation':False,'requestedAt':a['identity']['requestedAt'],'deadlineAt':a['identity']['deadlineAt']}

def main():
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['run','reconcile','status','readback','prepare-seal','seal','seal-reconcile']);p.add_argument('release');p.add_argument('fresh');args=p.parse_args();need(os.geteuid()==0,'ROOT_REQUIRED')
    raw,a,fraw,f=load(args.release,args.fresh);e=module(ENTRY);ops=Operations(args.release,args.fresh,a,f,e)
    root=VAR/'release-generated'/args.release/('recovery-driver-'+args.fresh)
    e.directory(root.parent);e.directory(e.STATE)
    seal_mode=None
    fd=os.open(e.STATE/'entry.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        info=os.fstat(fd);need(stat.S_ISREG(info.st_mode)and info.st_uid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600,'ENTRY_LOCK')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        need(parse(e.read(e.STATE/'active-attempt.json'))==a['identity']['attemptId'],'ACTIVE_ATTEMPT')
        if args.mode=='readback':result=sealed_result(root,{'releaseSha256':args.release,'recoveryApprovalSha256':args.fresh,'identity':a['identity']},ops,e)
        elif args.mode in ('prepare-seal','seal','seal-reconcile'):
            if args.mode!='seal-reconcile':ops.window()
            sealed_result(root,{'releaseSha256':args.release,'recoveryApprovalSha256':args.fresh,'identity':a['identity']},ops,e)
            if args.mode=='seal-reconcile':
                manifest,_=seal_payload(args.release,args.fresh,raw,a,f,e);request=sha(enc(manifest));e.load_package(request,a['identity']['attemptId']);result={'requestSha256':request}
            else:result=prepare_seal(args.release,args.fresh,raw,a,f,e)
            if args.mode!='prepare-seal':seal_mode='reconcile-recovery'if args.mode=='seal-reconcile'else'recover'
        else:
            if not root.exists():
                if args.mode!='run':print(enc({'status':'NOT_STARTED'}).decode(),end='');return 0 if args.mode=='status'else 2
                root.mkdir(mode=0o700);e.fsync_dir(root.parent)
            e.directory(root);result=coordinate(root,{'releaseSha256':args.release,'recoveryApprovalSha256':args.fresh,'identity':a['identity']},ops,e,args.mode)
    finally:os.close(fd)
    # No nested entry lock. Entry rechecks identity/owner/package and the actual
    # read-only contract after acquiring its own lock; a concurrent change blocks.
    if seal_mode:result=e.entry(seal_mode,result['requestSha256'],a['identity']['attemptId'])
    sys.stdout.buffer.write(enc(result))
    if args.mode in ('run','reconcile'):return 0 if result.get('status')=='RECOVERY_VERIFIED'else 2
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        print('{"status":"RECOVERY_BLOCKED_OR_UNKNOWN","automaticRetry":false}',file=sys.stderr);sys.exit(1)
