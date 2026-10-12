#!/usr/bin/env python3
"""Fixed canonical generator router; immutable generation before durable execution.

Generation journals are not mutation receipts. A partial generation blocks;
restarting the driver never creates a different request for the same stage.
"""
import importlib.util
import json
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

e=module(ROOT/'.harness/scripts/vm/cn-release-advance.py','router_entry')
OUTPUTS=Path('/var/lib/workspacex-cn/release-generated')
INPUTS=Path('/var/lib/workspacex-cn/release-inputs')
CONTROL=Path('/usr/local/lib/workspacex-cn/release-control')
MODULES={
 'acquire':'scripts/cn-release-acquire-delegation.py',
 'runtime':'scripts/cn-release-runtime-delegation.py',
 'stage':'scripts/cn-release-runtime-stage.py',
 'terminal':'scripts/cn-release-terminal-delegation.py',
 'recovery':'scripts/cn-release-recovery-admission.py',
 'recovery-driver':'scripts/cn-release-recovery-driver.py',
 'finalize':'scripts/cn-release-continuation-finalize.py',
 'rds':'scripts/cn-release-rds-backup.py',
 'business':'scripts/cn-release-business-observer.py',
 'consume-observer':'scripts/cn-release-acquire-observer.py',
 'publication-observer':'scripts/cn-release-publication-observer.py',
 'runtime-observer':'scripts/cn-release-runtime-observe.py',
 'journal':'scripts/cn-release-continuation-journal.py',
}
PHASES={'hold-stage':'hold','stop-stage':'stop','backup-stage':'backup','switch-stage':'switch'}


def render_contract(path,pin,stage):
    """Pure installed-path rendering shared by offline approval generation."""
    e.need(stage in e.STAGES and e.HEX.fullmatch(pin),'CONTRACT_SCOPE')
    observer=('/usr/bin/python3 -I -B '+str(path)+' observe '+stage+'\n').encode()
    verifier=("import hashlib\ndef verify(raw,manifest,previous,mode):\n"
        +" p="+repr(str(path))+"\n"
        +" with open(p,'rb') as f: source=f.read()\n"
        +" assert hashlib.sha256(source).hexdigest()=="+repr(pin)+"\n"
        +" ns={'__file__':p,'__name__':'stage_contract'};exec(compile(source,p,'exec'),ns)\n"
        +" return ns['verify']("+repr(stage)+",raw,manifest,previous,mode)\n").encode()
    return observer,verifier


class Router:
    def __init__(self,release,approval,raw):
        e.need(e.digest(raw)==release,'APPROVAL_HASH');self.release=release;self.a=approval;self.raw=raw
        self.base=OUTPUTS/release;self.attempt=approval['identity']['attemptId'];self.modules={}
    def load(self,key):
        if key not in self.modules:
            relative=MODULES[key];path=ROOT/relative
            e.need(e.digest(e.read(path,1048576))==self.a['codeFiles'][relative],'GENERATOR_CODE_PIN')
            self.modules[key]=module(path,'fixed_'+key)
        return self.modules[key]
    def preflight(self,release):
        e.need(release==self.release,'RELEASE_CHANGED')
        e.need(self.a['runtimeStage']['remoteRoot']==self.a['writerResume']['remoteRoot'],'ONE_RUNTIME_ROOT')
        required=set(MODULES.values())|{'scripts/cn-release-stage-contract.py','scripts/cn-release-generated-commands.py',
            'scripts/cn-release-fixed-driver.py','scripts/cn-release-stage-router.py','.harness/scripts/vm/cn-release-advance.py',
            'scripts/cn-release-continuation-bind.py','scripts/cn-release-derived-approval.py',
            'scripts/cn-release-continuation-acquire.py','scripts/cn-release-runtime-readback.py',
            'scripts/cn-release-recovery-contract.py','scripts/cn-release-business-state.py','scripts/cn-release-business-recovery.py','scripts/cn-release-recovery-writer.py','scripts/cn-release-business-entry.ts','scripts/cn-release-business-runner.ts',
            '.harness/scripts/vm/cn-maintenance-browser.cjs','packages/cloud-deploy/src/cn-release-browser-contract.ts',
            'packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract.ts',
            '.harness/scripts/vm/cn-runtime-continuation/finalize/runtime.py'}
        e.need(required<=set(self.a['codeFiles']),'INCOMPLETE_CODE_CLOSURE')
        # All code in the declared closure must be trusted before any import or
        # generation; no absolute/parent traversal or runner-owned code.
        for name,h in self.a['codeFiles'].items():
            path=Path(name);e.need(not path.is_absolute() and '..' not in path.parts,'CODE_PATH')
            e.need(e.digest(e.read(ROOT/path,1048576))==h,'CODE_CLOSURE_CHANGED')
        contracts={stage:self.contract(stage) for stage in e.STAGES}
        for stage,(observer,verifier) in contracts.items():
            e.need(self.a['runtime']['stageObserverSha256'][stage]==e.digest(observer)
                   and self.a['runtime']['stageVerifierSha256'][stage]==e.digest(verifier)
                   and self.a['writerResume']['stageVerifierSha256'][stage]==e.digest(verifier),'STAGE_CONTRACT_PIN')
        co,cv=contracts['consume']
        e.need(self.a['acquire']['consumeEntryCode']=={'observerSha256':e.digest(co),'verifierSha256':e.digest(cv)},'CONSUME_CONTRACT_PIN')
        for key in MODULES:self.load(key)
        # These are genuine capability checks. A missing exact provider job
        # observer or held/public business lane blocks before consume/hold.
        self.load('rds').preflight(self.a)
        self.load('business').preflight(self.a)
        self.load('acquire').approval(self.raw)
        # A baseline browser/clear adapter is not proof that an uncertain prior
        # Docker/provider operation is safe to recover. No approval boolean can
        # replace the missing fixed independent recovery capability.
        capability=self.load('recovery').preflight(self.a)
        e.need(capability=={'kind':'cn-recovery-capability-v1','heldPhases':['stop','backup','rds-backup','switch'],
               'postClear':'REHOLD_APPROVAL_REQUIRED','unknownAction':'MANUAL_RECONCILIATION','cloudMutation':False},
               'RECOVERY_OBSERVATION_CAPABILITY_UNPROVEN')
        recovery_execution=self.load('recovery-driver').capability(self.a)
        e.need(recovery_execution=={'kind':'cn-recovery-driver-capability-v1',
               'stages':['runtime','clear','business'],'unknownReplayAllowed':False,'productionInstalled':False},
               'RECOVERY_EXECUTION_CAPABILITY_UNPROVEN')
        for directory in (OUTPUTS,INPUTS/self.release,e.REQUESTS,CONTROL,
                self.load('consume-observer').APPROVALS,self.load('publication-observer').APPROVALS,
                self.load('runtime-observer').APPROVALS,Path('/etc/workspacex-cn/writer-resume-approvals/by-release')):
            e.directory(directory)
    def contract(self,stage):
        e.need(stage in e.STAGES,'CONTRACT_STAGE')
        path=ROOT/'scripts/cn-release-stage-contract.py'
        source=e.read(path,1048576);pin=self.a['codeFiles']['scripts/cn-release-stage-contract.py']
        e.need(e.digest(source)==pin,'CONTRACT_CODE_PIN')
        return render_contract(path,pin,stage)
    def admission(self,release,stage):
        e.need(release==self.release,'RELEASE_CHANGED')
        if stage=='clear-hold':
            pointer=Path('/etc/workspacex-cn/writer-resume-approvals/by-release')/(release+'.json')
            if not pointer.exists():return 'WAITING_FOR_WRITER_APPROVAL'
            value=e.decode(e.read(pointer));e.need(set(value)=={'approvalSha256'} and e.HEX.fullmatch(value['approvalSha256']),'WRITER_APPROVAL_POINTER')
            raw=e.read(pointer.parent.parent/(value['approvalSha256']+'.json'));e.need(e.digest(raw)==value['approvalSha256'],'WRITER_APPROVAL_HASH')
        return None
    def lookup(self,release,stage):
        e.need(release==self.release and stage in e.STAGES,'ROUTE')
        folder=self.base/'stages'/stage
        if not folder.exists():return None
        record=folder/'generated.json'
        e.need(record.exists(),'GENERATION_UNKNOWN_REPAIR_REQUIRED')
        v=e.decode(e.read(record));e.need(v['releaseSha256']==release and v['stage']==stage,'GENERATION_IDENTITY')
        request=v['requestSha256'];manifest,files=e.load_package(request,self.attempt)
        e.need(manifest['stage']==stage and e.digest(e.read(folder/'intent.json'))==v['generationIntentSha256'],'GENERATION_CHANGED')
        e.need(files['authorization.json']==self.raw,'GENERATION_AUTHORITY_CHANGED')
        e.need(e.digest(e.read(folder/'observer-context.json'))==v['observerContextSha256'],'OBSERVER_CONTEXT_CHANGED')
        for n,h in v['packageFiles'].items():e.need(e.digest(e.read(e.REQUESTS/request/n))==h,'PACKAGE_CHANGED')
        return request
    def evidence(self,stage,terminal=False):
        i=e.STAGES.index(stage);suffix='terminal-observation' if terminal else 'evidence'
        prefix=e.STATE/self.attempt/('%02d-%s'%(i,stage))
        receipt=e.decode(e.read(Path(str(prefix)+'.receipt.json')))
        manifest,_=e.load_package(receipt['requestSha256'],self.attempt)
        e.verify_historical_receipt(Path(str(prefix)+'.receipt.json'),receipt,manifest)
        return e.read(Path(str(prefix)+'.'+suffix+'.json'))
    def acquire(self,phase):
        helper=self.load('acquire');folder=self.base/'acquire'/phase
        if folder.exists():
            v=e.decode(e.read(folder/'delegation.json',1048576))
            e.need(v['releaseSha256']==self.release and v['phase']==phase,'ACQUIRE_GENERATION_CHANGED')
            for name,h in v['files'].items():e.need(e.digest(e.read(folder/name,1048576))==h,'ACQUIRE_FILE_CHANGED')
            return folder,v
        inputs={n:e.read(INPUTS/self.release/(n+'.json'),1048576)for n in self.a['acquire']['requests'][phase]['inputs']}
        receipt=None;chain=None
        if phase=='publication':
            receipt=helper.consume_receipt(self.a,ROOT,reader=e.read);e.need(receipt is not None,'LIVE_CONSUME_RECEIPT_REQUIRED');prefix=e.STATE/self.attempt/'00-consume'
            chain={n:e.read(Path(str(prefix)+'.'+suffix+'.json'))for n,suffix in (('receipt','receipt'),('evidence','evidence'),('terminalObservation','terminal-observation'))}
            chain['manifest']=e.read(e.REQUESTS/e.decode(chain['receipt'])['requestSha256']/'manifest.json')
            for n,file in (('parameters','parameters.json'),('delegation','delegation.json')):chain[n]=e.read(self.base/'acquire/consume'/file,1048576)
        folder.parent.mkdir(mode=0o700,exist_ok=True)
        result=helper.derive(self.raw,phase,inputs,ROOT,CONTROL,folder,receipt,consume_completion=chain)
        return folder,result
    def action(self,stage):
        if stage in ('consume','publication-stage','check-plan','publish'):
            folder,v=self.acquire('consume' if stage=='consume' else 'publication')
            selected=[x for x in v['actions'] if (x['operation']==stage or stage=='publication-stage' and x['operation'].startswith('stage-'))]
            e.need(selected,'EMPTY_ACQUIRE_STAGE')
            commands=[];timeout=0
            for item in selected:
                raw=e.read(folder/item['parameters'],1048576);e.need(e.digest(raw)==item['parametersSha256'],'PARAMETERS_CHANGED')
                p=e.decode(raw);command=p['CommandContent'].encode();e.need(e.digest(command)==item['commandSha256'],'COMMAND_CHANGED')
                commands.append(command);timeout+=item['timeoutSeconds']
            # Preserve exact single action bytes for consume receipt linkage.
            # Chunk scripts already have exclusive sequential intents. set -e
            # stops the ordered stage at its first failed chunk without retry.
            action=commands[0] if len(commands)==1 else ('/usr/bin/python3 -I -B '+str(ROOT/'scripts/cn-release-generated-commands.py')+' '+self.release+'\n').encode()
            return action,min(1200,timeout)
        if stage in PHASES:
            phase=PHASES[stage];folder=self.base/'runtime'/phase
            folder.parent.mkdir(mode=0o700,exist_ok=True)
            static={n:e.read(INPUTS/self.release/(n+'.json'))for n in ('authorization','template','migrationDiff')}
            inputs={**static,'publication':self.publication_input()}
            if phase!='hold':inputs['hold']=self.evidence('hold',True)
            if phase in ('backup','switch'):inputs['stop']=self.evidence('sessions')
            if phase=='switch':inputs.update(hostBackup=self.evidence('backup',True),rdsBackup=self.evidence('rds-backup'))
            self.load('runtime').materialize(self.raw,phase,inputs,folder,e)
            files={p.name:e.read(p,1048576)for p in folder.iterdir()if p.is_file()}
            prior={}
            index=list(PHASES.values()).index(phase)
            if index:prior['previous-binding.json']=e.read(self.base/'runtime'/list(PHASES.values())[index-1]/'binding.json')
            for n,key in (('stop-receipt.json','stop'),('backup-result.json','hostBackup'),('rds-backup-receipt.json','rdsBackup')):
                if key in inputs:prior[n]=inputs[key]
            params=self.load('stage').generate_phase_actions(self.a,phase,files,prior)
            e.create(folder/'stage-actions.json',e.encode(params))
            value=params['stageParameters'];return value['CommandContent'].encode(),int(value['Timeout'])
        if stage in ('hold','stop','backup','switch','sessions'):
            phase='stop'if stage=='sessions'else stage
            data=e.decode(e.read(self.base/'runtime'/phase/'stage-actions.json'))
            value=data['sessionsParameters'if stage=='sessions'else 'actionParameters']
            return value['CommandContent'].encode(),int(value['Timeout'])
        if stage=='acceptance':
            inputs=self.terminal_inputs();folder=self.base/'terminal'/'held-health'
            folder.parent.mkdir(mode=0o700,exist_ok=True)
            self.load('terminal').derive_held_health(self.raw,inputs,e,self.load('finalize'),folder)
            value=e.decode(e.read(folder/'parameters.json'));return value['CommandContent'].encode(),int(value['Timeout'])
        if stage in ('rds-backup','observe'):
            name='rds' if stage=='rds-backup' else 'business';mode='action'if name=='rds'else stage
            # Fixed registered executable and hex-only argument, no runner env.
            return ('/usr/bin/python3 -I -B '+str(ROOT/MODULES[name])+' '+mode+' '+self.release+'\n').encode(),1200
        e.need(stage=='clear-hold','STAGE_UNSUPPORTED')
        inputs=self.terminal_inputs()
        inputs.update(status=self.evidence('acceptance'),
            userAuthorization=e.read(INPUTS/self.release/'writer-authorization.json'),
            testDataScope=e.read(INPUTS/self.release/'test-data-scope.json'))
        pointer=Path('/etc/workspacex-cn/writer-resume-approvals/by-release')/(self.release+'.json')
        approved=e.decode(e.read(pointer))['approvalSha256']
        fresh=e.read(pointer.parent.parent/(approved+'.json'));e.need(e.digest(fresh)==approved,'A5_APPROVAL_HASH')
        folder=self.base/'terminal'/'writer-resume'
        self.load('terminal').derive_writer_resume(self.raw,fresh,inputs,e,folder)
        value=e.decode(e.read(folder/'parameters.json'));return value['CommandContent'].encode(),int(value['Timeout'])
    def publication_input(self):
        ident=self.a['identity']
        path=Path('/var/lib/workspacex-cn/archive-published')/ident['sourceRevision']/ident['publicationAttemptId']/'published.json'
        original=e.read(path,262144)
        return self.load('journal').publication_input(original,self.evidence('publish'),self.evidence('publish',True))
    def terminal_inputs(self):
        status=e.decode(self.evidence('switch',True))
        raw=e.read(Path(self.a['writerResume']['remoteRoot'])/'switch-result.json')
        e.need(e.digest(raw)==status['switchReceiptSha256'],'EXACT_SWITCH_RECEIPT')
        return {'binding':e.read(self.base/'runtime/switch/binding.json'),
                'hold':self.evidence('hold',True),'switchReceipt':raw}
    def install_record(self,root,files):
        # Only this fixed root generator selects record destinations and bytes.
        # Existing partial/different records are never overwritten.
        if not root.exists():root.mkdir(mode=0o700);e.fsync_dir(root.parent)
        e.directory(root)
        for name,raw in files.items():
            e.need(Path(name).name==name,'RECORD_NAME')
            target=root/name
            if target.exists():e.need(e.read(target,1048576)==raw,'OBSERVER_RECORD_CHANGED')
            else:e.create(target,raw)
    def prepare_context(self,stage,action,observer):
        ident={k:self.a['identity'][k] for k in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt')}
        if stage=='consume':
            folder,_=self.acquire('consume');request=e.read(folder/'request.json');h=e.digest(request)
            helper=self.load('consume-observer')
            files=helper.bundle(request,e.read(folder/'consumer-request.json'),ident,e.digest(action),self.a['codeFiles'][MODULES['consume-observer']])
            self.install_record(helper.APPROVALS/h,files);return {'requestSha256':h}
        if stage in ('publication-stage','check-plan','publish'):
            folder,_=self.acquire('publication');request=e.read(folder/'request.json');h=e.digest(request)
            helper=self.load('publication-observer');contents={n:e.read(folder/n,1048576) for n in helper.FILES}
            actions={n:e.digest(self.action(n)[0]) for n in helper.PHASES}
            files=helper.bundle(request,contents,ident,actions,{Path(MODULES[k]).name:self.a['codeFiles'][MODULES[k]] for k in ('consume-observer','publication-observer')})
            self.install_record(helper.APPROVALS/h,files);return {'requestSha256':h}
        if stage in PHASES:
            phase=PHASES[stage];v=e.decode(e.read(self.base/'runtime'/phase/'stage-actions.json'))
            return {k:v[k] for k in ('bindingSha256','expectedOldBindingSha256','filesSha256')} | {'phase':phase,'remoteRoot':self.a['runtimeStage']['remoteRoot']}
        if stage=='rds-backup':
            root=self.base/'rds-backup';root.mkdir(mode=0o700);e.fsync_dir(self.base)
            inputs={'stop':self.evidence('sessions'),'hold':self.evidence('hold',True)}
            self.install_record(root/'inputs',{n+'.json':raw for n,raw in inputs.items()})
            e.create(root/'rds-request.json',e.encode({'identity':self.a['identity'],'inputHashes':{n:e.digest(raw) for n,raw in inputs.items()}}))
            return {'releaseSha256':self.release}
        if stage=='observe':return {'releaseSha256':self.release}
        phase='stop' if stage=='sessions' else 'switch' if stage in ('acceptance','clear-hold') else stage
        raw=e.read(self.base/'runtime'/phase/'binding.json');b=e.decode(raw)
        helper=self.load('runtime-observer')
        value={'kind':'cn-runtime-readonly-observer-approval-v1','mode':'switch' if stage=='acceptance' else stage,
            'remoteRoot':self.a['runtimeStage']['remoteRoot'],'bindingSha256':e.digest(raw),
            'identity':{k:ident[k] for k in ('sourceRevision','baselineRevision','controlRevision','attemptId')},
            'issuedAt':self.a['issuedAt'],'expiresAt':self.a['expiresAt'],'maxSeconds':120,
            'codeFiles':self.a['codeFiles'],'runtimePins':{k:b[k] for k in ('scriptSha256','sessionsHelperSha256','backupHelperSha256','holdHelperSha256')}}
        if stage=='clear-hold':
            pointer=Path('/etc/workspacex-cn/writer-resume-approvals/by-release')/(self.release+'.json')
            writer=e.decode(e.read(pointer))['approvalSha256']
            e.need(e.digest(e.read(pointer.parent.parent/(writer+'.json')))==writer,'WRITER_APPROVAL_HASH')
            value.update(releaseSha256=self.release,writerApprovalSha256=writer)
        raw=e.encode(value);h=e.digest(raw);self.install_record(helper.APPROVALS,{h+'.json':raw})
        return {'approvalSha256':h}
    def generate(self,release,stage,previous):
        e.need(release==self.release and stage in e.STAGES,'ROUTE')
        e.need(self.lookup(release,stage)is None,'GENERATION_EXISTS')
        if not self.base.exists():self.base.mkdir(mode=0o700);e.fsync_dir(self.base.parent)
        e.directory(self.base)
        parent=self.base/'stages';parent.mkdir(mode=0o700,exist_ok=True);e.directory(parent)
        folder=parent/stage;folder.mkdir(mode=0o700);e.fsync_dir(parent)
        intent=e.encode({'releaseSha256':release,'stage':stage,'previousReceiptSha256':previous})
        e.create(folder/'intent.json',intent)
        action,timeout=self.action(stage);observer,verifier=self.contract(stage)
        e.need(0<len(action)<=e.MAX,'ACTION_LIMIT')
        context=e.encode(self.prepare_context(stage,action,observer));e.create(folder/'observer-context.json',context)
        identity={k:self.a['identity'][k]for k in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt')}
        manifest=dict(schemaVersion=1,**identity,scope='runtime-only-reviewed-continuation',stage=stage,
            previousReceiptSha256=previous,issuedAt=self.a['issuedAt'],expiresAt=self.a['expiresAt'],timeoutSeconds=min(timeout,1200),
            actionSha256=e.digest(action),observerSha256=e.digest(observer),verifierSha256=e.digest(verifier),authorizationEvidenceSha256=e.digest(self.raw))
        raw=e.encode(manifest);request=e.digest(raw);target=e.REQUESTS/request;target.mkdir(mode=0o700);e.fsync_dir(e.REQUESTS)
        files={'manifest.json':raw,'action.sh':action,'observe.sh':observer,'verify.py':verifier,'authorization.json':self.raw}
        for n,data in files.items():e.create(target/n,data)
        e.load_package(request,self.attempt)
        record={'releaseSha256':release,'stage':stage,'requestSha256':request,'generationIntentSha256':e.digest(intent),'observerContextSha256':e.digest(context),'packageFiles':{n:e.digest(data)for n,data in files.items()}}
        e.create(folder/'generated.json',e.encode(record));return request
