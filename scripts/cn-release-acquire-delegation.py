#!/usr/bin/env python3
"""Fixed release approval -> reviewed acquire generator. No cloud or execution.

The only CLI argument is release approval SHA256. The driver library seam takes
trusted root-read bytes; it never turns runner-supplied paths into authority.
"""
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

APPROVALS=Path('/etc/workspacex-cn/release-approvals')
INPUTS=Path('/var/lib/workspacex-cn/release-inputs')
OUTPUTS=Path('/var/lib/workspacex-cn/release-generated')
CONTROL_ROOT=Path('/usr/local/lib/workspacex-cn/release-control')
STATE=Path('/var/lib/workspacex-cn')
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}
TEMPLATE_ROOT='.harness/scripts/vm/cn-runtime-continuation/acquire/'
TEMPLATES=('consumer.py','consume-launcher.py','materialize-publication.py','stage-runtime.py','transport-runtime.py','deadline-runtime.py')
CODE=('scripts/cn-release-acquire-delegation.py','scripts/cn-release-continuation-acquire.py','scripts/cn-release-continuation-bind.py','.harness/scripts/vm/cn-release-advance.py')+tuple(TEMPLATE_ROOT+n for n in TEMPLATES)
IDENTITY={'sourceRevision','baselineRevision','controlRevision','publicationAttemptId','attemptId','requestedAt','deadlineAt'}
MAX=1048576


def need(v,code):
    if not v:raise ValueError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def encode(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def parse(raw):
    def pairs(values):
        out={}
        for key,value in values:need(key not in out,'DUPLICATE_KEY');out[key]=value
        return out
    return json.loads(raw,object_pairs_hook=pairs)


def instant(value):
    result=dt.datetime.fromisoformat(value.replace('Z','+00:00'));need(result.tzinfo is not None,'TIMEZONE');return result


def root_read(path,maximum=MAX):
    path=Path(path)
    for p in (*path.parents,):
        s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        st=os.fstat(f.fileno());need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode) in (0o600,0o700) and 0<st.st_size<=maximum,'ROOT_FILE')
        raw=f.read(maximum+1);after=os.fstat(f.fileno());visible=path.lstat()
        signature=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        need(len(raw)<=maximum and signature(st)==signature(after)==signature(visible),'ROOT_FILE_CHANGED');return raw


def approval(raw,now=None):
    v=parse(raw);now=now or dt.datetime.now(dt.timezone.utc)
    # Other fixed-driver domains may be added by the shared release schema;
    # acquire authority is solely these pinned fields, never those extensions.
    need(v['kind']=='cn-fixed-release-approval-v1' and type(v['schemaVersion']) is int and v['schemaVersion']==1,'RELEASE_KIND')
    need(v['target']==TARGET and set(v['identity'])==IDENTITY,'RELEASE_TARGET_IDENTITY')
    ident=v['identity']
    for key in ('sourceRevision','baselineRevision','controlRevision'):need(re.fullmatch('[a-f0-9]{40}',ident[key]),'RELEASE_REVISION')
    for key in ('publicationAttemptId','attemptId'):need(re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',ident[key]),'RELEASE_ATTEMPT')
    start,end=instant(ident['requestedAt']),instant(ident['deadlineAt'])
    need(start<=now<end and 0<(end-start).total_seconds()<=1800,'RELEASE_DEADLINE')
    need(start<=instant(v['issuedAt'])<=now<instant(v['expiresAt'])<=end,'RELEASE_APPROVAL_EXPIRY')
    acquire=v['acquire'];need(set(acquire)=={'requests','templateFiles','consumeEntryCode'} and set(acquire['requests'])=={'consume','publication'},'ACQUIRE_SCHEMA')
    need(set(acquire['consumeEntryCode'])=={'observerSha256','verifierSha256'} and all(re.fullmatch('[a-f0-9]{64}',x) for x in acquire['consumeEntryCode'].values()),'CONSUME_ENTRY_CODE')
    need(set(acquire['templateFiles'])==set(TEMPLATES),'TEMPLATE_CLOSURE')
    need(set(CODE)<=set(v['codeFiles']),'CODE_CLOSURE')
    for name in CODE:need(re.fullmatch('[a-f0-9]{64}',v['codeFiles'][name]),'CODE_SHA')
    for name in TEMPLATES:need(acquire['templateFiles'][name]==v['codeFiles'][TEMPLATE_ROOT+name],'TEMPLATE_CODE_BINDING')
    for phase,request in acquire['requests'].items():
        need(request['phase']==phase,'ACQUIRE_PHASE')
        for key in ('sourceRevision','controlRevision','requestedAt','deadlineAt'):need(request[key]==ident[key],'ACQUIRE_RELEASE_IDENTITY')
        need(request['attemptId']==ident['publicationAttemptId'],'ACQUIRE_PUBLICATION_ATTEMPT')
        need(set(request['inputs']) <= {'plan','set','proof','policy','tools','canonical','provider','redis','binaries'},'INPUT_NAMES')
        for h in request['inputs'].values():need(re.fullmatch('[a-f0-9]{64}',h),'INPUT_SHA')
    consume,pub=(acquire['requests'][k] for k in ('consume','publication'))
    for key in ('repositoryId','runId','runAttempt','producerWorkflowSha256','release','launcher'):need(consume[key]==pub[key],'ACQUIRE_SHARED_BINDING')
    for key in ('plan','set','proof','policy'):need(consume['inputs'][key]==pub['inputs'][key],'ACQUIRE_ORIGINAL_BYTES')
    return v


def receipt_path(release):
    raw=encode(release['acquire']['requests']['consume'])
    return STATE/('hk-'+sha(raw)[:32])/'promoted-receipt.json'


def verify_receipt(raw,release,inputs,now=None):
    """Root-generated consumption evidence binding, not a second image admission."""
    v=parse(raw);request=release['acquire']['requests']['consume'];now=now or dt.datetime.now(dt.timezone.utc)
    need(v['kind']=='cn-hk-consumed-revalidated-bundle-v1','CONSUME_RECEIPT_KIND')
    for key in ('sourceRevision','controlRevision'):need(v[key]==request[key],'CONSUME_RECEIPT_IDENTITY')
    expected='/var/lib/workspacex-cn/candidate-inbox/'+request['sourceRevision']+'/'+request['attemptId']
    need(v['bundle']==expected and v['root']==str(receipt_path(release).parent),'CONSUME_RECEIPT_LOCATION')
    need(v['promotedToExactPublisherInbox'] is True and v['originalZipsPreserved'] is True and v['proofGenerated'] is False and v['publicationExecuted'] is False and v['productionReady'] is False and v['cloudWrites']==0,'CONSUME_RECEIPT_SCOPE')
    for key,name in (('proofSha256','proof'),('policySha256','policy')):need(v[key]==request['inputs'][name]==sha(inputs[name]),'CONSUME_RECEIPT_RAW_HASH')
    need(instant(request['requestedAt'])<=instant(v['finishedAt'])<=now<instant(request['deadlineAt']) and now<instant(v['expiresAt']),'CONSUME_RECEIPT_TIME')
    need(v['images']==parse(inputs['set'])['images'],'CONSUME_RECEIPT_IMAGES')
    need(v['storageAdmission']['admitted'] is True,'CONSUME_STORAGE_ADMISSION')
    return v


def verify_completion(chain,release,release_sha,runtime_raw,entry):
    need(type(chain) is dict and set(chain)=={'manifest','receipt','evidence','terminalObservation','parameters','delegation'},'NORMAL_CONSUME_COMPLETION_REQUIRED')
    need(all(type(raw) is bytes and 0<len(raw)<=MAX for raw in chain.values()),'CONSUME_CHAIN_BYTES')
    manifest,receipt,prior,params=(parse(chain[n]) for n in ('manifest','receipt','delegation','parameters'))
    need(prior['releaseSha256']==release_sha and prior['phase']=='consume' and prior['requestSha256']==sha(encode(release['acquire']['requests']['consume'])),'CONSUME_DELEGATION_BINDING')
    need(prior['files']['parameters.json']==sha(chain['parameters']),'CONSUME_PARAMETERS_CHANGED')
    need(manifest['actionSha256']==sha(params['CommandContent'].encode()),'CONSUME_ACTION_CHANGED')
    for value in (manifest,receipt):
        for key in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt'):need(value[key]==release['identity'][key],'CONSUME_ENTRY_IDENTITY')
        need(value['stage']=='consume' and value['scope']=='runtime-only-reviewed-continuation' and value['previousReceiptSha256'] is None,'CONSUME_ENTRY_SCOPE')
    need(receipt['mode'] in ('advance','reconcile') and receipt['withinTotalBudget'] is True,'NORMAL_CONSUME_COMPLETION_REQUIRED')
    need(receipt['requestSha256']==sha(chain['manifest']),'CONSUME_ENTRY_MANIFEST_HASH')
    need(receipt['evidenceSha256']==sha(chain['evidence']),'CONSUME_ENTRY_EVIDENCE_HASH')
    if receipt['mode']=='advance':
        need(sha(chain['evidence'])==sha(runtime_raw),'CONSUME_ENTRY_EVIDENCE_HASH')
    else:
        need(chain['evidence']==chain['terminalObservation'],'CONSUME_RECONCILE_OBSERVATION_CHANGED')
        observation=parse(chain['evidence'])
        need(observation.get('runtimeReceiptSha256')==sha(runtime_raw),'CONSUME_PHYSICAL_RECEIPT_CHANGED')
        need(observation.get('requestSha256')==prior['requestSha256'],'CONSUME_RECONCILE_REQUEST_CHANGED')
    need(receipt['terminalObservationSha256']==sha(chain['terminalObservation']),'CONSUME_TERMINAL_OBSERVER_HASH')
    need(instant(receipt['finishedAt'])<=instant(release['identity']['deadlineAt']),'CONSUME_ENTRY_LATE')
    for key,value in release['acquire']['consumeEntryCode'].items():need(manifest[key]==value,'CONSUME_VERIFIER_OR_OBSERVER_CHANGED')
    # Reuse the existing protected loader and exact original/terminal verifier.
    loaded,files=entry.load_package(receipt['requestSha256'],release['identity']['attemptId'])
    need(loaded==manifest,'CONSUME_ENTRY_PACKAGE_CHANGED')
    path=entry.STATE/release['identity']['attemptId']/'00-consume.receipt.json'
    need(entry.read(path)==chain['receipt'],'CONSUME_ENTRY_RECEIPT_CHANGED')
    entry.verify_historical_receipt(path,receipt,manifest)
    return {n:sha(raw) for n,raw in chain.items()}


def load_generator(code_root,release,reader=None):
    reader=reader or (lambda p:p.read_bytes())
    for name in CODE:need(sha(reader(Path(code_root)/name))==release['codeFiles'][name],'CODE_HASH_'+name)
    spec=importlib.util.spec_from_file_location('approved_acquire',Path(code_root)/'scripts/cn-release-continuation-acquire.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def load_entry(code_root):
    spec=importlib.util.spec_from_file_location('approved_entry',Path(code_root)/'.harness/scripts/vm/cn-release-advance.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def derive(release_raw,phase,inputs,code_root,repository,output,runtime_receipt_raw=None,*,consume_completion=None,now=None):
    """Trusted driver seam. CLI obtains release/inputs/receipt through root_read."""
    release=approval(release_raw,now);need(phase in ('consume','publication'),'PHASE')
    request=release['acquire']['requests'][phase]
    need(set(inputs)==set(request['inputs']),'PHASE_INPUTS')
    for n,raw in inputs.items():need(0<len(raw)<=MAX and sha(raw)==request['inputs'][n],'INPUT_HASH_'+n)
    generator=load_generator(code_root,release)
    if phase=='publication':
        need(runtime_receipt_raw is not None,'LIVE_CONSUME_RECEIPT_REQUIRED');verify_receipt(runtime_receipt_raw,release,inputs,now)
        verify_completion(consume_completion,release,sha(release_raw),runtime_receipt_raw,load_entry(code_root))
    else:need(runtime_receipt_raw is None and consume_completion is None,'UNEXPECTED_RUNTIME_RECEIPT')
    request_raw=encode(request)
    delegated=encode({'kind':'cn-continuation-acquire-approval-v1','requestSha256':sha(request_raw),'issuedAt':release['issuedAt'],'expiresAt':release['expiresAt'],'templateFiles':release['acquire']['templateFiles']})
    output=Path(output);need(not output.exists(),'GENERATION_EXISTS_RECONCILE_NO_RETRY')
    result=generator.materialize(request_raw,delegated,inputs,repository,output,now=now)
    content={p.name:p.read_bytes() for p in output.iterdir()}
    if phase=='publication':
        ordered=generator.validate_order(content,request)['steps']
    else:ordered=[{'operation':'consume','parameters':'parameters.json','sha256':sha(content['parameters.json'])}]
    actions=[]
    for step in ordered:
        raw=content[step['parameters']];need(sha(raw)==step['sha256'],'GENERATED_PARAMETER_HASH');params=parse(raw)
        need(params['RegionId']==TARGET['region'] and params['InstanceId.1']==TARGET['ecsInstanceId'],'GENERATED_TARGET')
        remaining=int((instant(request['deadlineAt'])-(now or dt.datetime.now(dt.timezone.utc))).total_seconds());need(remaining>=1,'GENERATION_BUDGET_EXHAUSTED')
        actions.append({'operation':step['operation'],'parameters':step['parameters'],'parametersSha256':sha(raw),'commandSha256':sha(params['CommandContent'].encode()),'timeoutSeconds':min(int(params['Timeout']),remaining),'independentObserverRequired':True})
    evidence={'kind':'cn-fixed-acquire-delegation-v1','releaseSha256':sha(release_raw),'phase':phase,'requestSha256':sha(request_raw),'delegatedApprovalSha256':sha(delegated),'requestedAt':request['requestedAt'],'deadlineAt':request['deadlineAt'],'actions':actions,'files':{n:sha(raw) for n,raw in content.items()},'consumeCompletionFiles':{n:sha(raw) for n,raw in consume_completion.items()} if consume_completion else None,'runtimeReceiptSha256':sha(runtime_receipt_raw) if runtime_receipt_raw else None,'expectedConsumeReceiptPath':str(receipt_path(release)),'canonicalAdmissionReused':True,'cloudCalls':0,'dispatchAuthorizedByGenerator':False,'retryAllowed':False}
    extra={'delegation.json':encode(evidence),'request.json':request_raw,'delegated-approval.json':delegated}
    if runtime_receipt_raw is not None:
        extra['consume-runtime-receipt.json']=runtime_receipt_raw
        extra.update({'consume-entry-'+n+'.json':raw for n,raw in consume_completion.items()})
    for name,raw in extra.items():
        with (output/name).open('xb') as f:os.chmod(f.name,0o600);f.write(raw);f.flush();os.fsync(f.fileno())
    return evidence


def main():
    need(len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]),'ONLY_RELEASE_SHA_ACCEPTED')
    release_sha=sys.argv[1];raw=root_read(APPROVALS/(release_sha+'.json'));need(sha(raw)==release_sha,'RELEASE_RAW_HASH');release=approval(raw)
    need(Path(__file__).resolve()==CONTROL_ROOT/'scripts/cn-release-acquire-delegation.py','FIXED_INSTALLED_ENTRY_REQUIRED')
    load_generator(CONTROL_ROOT,release,root_read)
    physical=receipt_path(release);receipt=None
    try:receipt=root_read(physical,65536)
    except FileNotFoundError:pass
    phase='publication' if receipt is not None else 'consume'
    request=release['acquire']['requests'][phase];inputs={n:root_read(INPUTS/release_sha/(n+'.json')) for n in request['inputs']}
    parent=OUTPUTS/release_sha/'acquire'
    # Parent is installed by the fixed driver, never inferred from runner paths.
    for directory in (parent,*parent.parents):
        st=directory.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'FIXED_OUTPUT_PARENT')
    need(stat.S_IMODE(parent.lstat().st_mode)==0o700,'FIXED_OUTPUT_MODE')
    chain=None
    if phase=='publication':
        journal=STATE/'continuation'/release['identity']['attemptId']
        chain={n:root_read(journal/('00-consume.'+suffix+'.json')) for n,suffix in (('receipt','receipt'),('evidence','evidence'),('terminalObservation','terminal-observation'))}
        request_sha=parse(chain['receipt'])['requestSha256'];need(re.fullmatch('[a-f0-9]{64}',request_sha),'ENTRY_REQUEST_SHA')
        chain['manifest']=root_read(Path('/etc/workspacex-cn/continuation-requests')/request_sha/'manifest.json')
        for n,file in (('parameters','parameters.json'),('delegation','delegation.json')):chain[n]=root_read(parent/'consume'/file)
    print(json.dumps(derive(raw,phase,inputs,CONTROL_ROOT,CONTROL_ROOT,parent/phase,receipt,consume_completion=chain),sort_keys=True))

if __name__=='__main__':main()
