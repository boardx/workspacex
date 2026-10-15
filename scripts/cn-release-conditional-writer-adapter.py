#!/usr/bin/env python3
"""Fixed-root, default-disabled conditional A5 materialization adapter.

No policy issuance, cloud operation, writer resume or RPC callback injection.
Lock order is store release lock -> original entry lock, held until pointer
publication. Only root-installed, independently approved raw policy files enable
this path; old static approvals are neither replaced nor consumed here.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types

ROOT = Path('/usr/local/lib/workspacex-cn/release-control')
APPROVALS = Path('/etc/workspacex-cn/release-approvals')
POLICIES = Path('/etc/workspacex-cn/conditional-writer-policies')
STATE = Path('/var/lib/workspacex-cn/conditional-writer-policy-state')
WRITERS = Path('/etc/workspacex-cn/writer-resume-approvals')
GENERATED = Path('/var/lib/workspacex-cn/release-generated')
INPUTS = Path('/var/lib/workspacex-cn/release-inputs')
PUBLISHED = Path('/var/lib/workspacex-cn/archive-published')
MODULES = {'terminal':'scripts/cn-release-terminal-delegation.py',
           'entry':'.harness/scripts/vm/cn-release-advance.py',
           'policy':'scripts/cn-release-conditional-writer-policy.py',
           'store':'scripts/cn-release-conditional-writer-store.py',
           'journal':'scripts/cn-release-continuation-journal.py'}
SELF = 'scripts/cn-release-conditional-writer-adapter.py'


def need(v, code):
    if not v: raise ValueError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def decode(raw):
    def pairs(values):
        out={}
        for k,v in values:
            need(k not in out,'DUPLICATE_KEY');out[k]=v
        return out
    return json.loads(raw,object_pairs_hook=pairs)


def private(path):
    for parent in path.parents:
        s=parent.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_PARENT')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        s=os.fstat(f.fileno())
        need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o077
             and s.st_size<=1048576,'ROOT_FILE')
        raw=f.read(1048577);after=os.fstat(f.fileno());named=path.lstat()
        fields=('st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns','st_nlink')
        need(tuple(getattr(s,k) for k in fields)==tuple(getattr(after,k) for k in fields)==
             tuple(getattr(named,k) for k in fields) and len(raw)==s.st_size,'ROOT_FILE_CHANGED');return raw


def closure(a,p):
    required=set(MODULES.values())|{SELF}
    need(required<=set(a['codeFiles']) and required<=set(p['codeFiles']),'CONDITIONAL_CLOSURE_MISSING')
    need(all(a['codeFiles'].get(k)==v for k,v in p['codeFiles'].items()),'POLICY_RELEASE_CODE_PINS')
    raw={}
    for name,pin in a['codeFiles'].items():
        part=Path(name);need(not part.is_absolute() and '..' not in part.parts,'CODE_PATH')
        data=private(ROOT/part);need(sha(data)==pin,'CODE_CHANGED');raw[name]=data
    return raw


def load(snapshot):
    modules={}
    for key,name in MODULES.items():
        module=types.ModuleType('conditional_fixed_'+key);module.__file__=str(ROOT/name)
        exec(compile(snapshot[name],str(ROOT/name),'exec'),module.__dict__)
        modules[key]=module
    return modules


def _execute(release_raw, policy_raw, pointer_raw, modules, paths, read, check_closure, *, clock):
    """Internal integration seam for fixture filesystem, never exposed via CLI."""
    t,e,p,s,j=(modules[k] for k in ('terminal','entry','policy','store','journal'))
    a,release=t.release(release_raw);policy=p.parse(policy_raw);identity=a['identity']
    policies,state,writers,generated,inputs,published=paths
    store=s._Store(policies,state,writers,e.OWNER)
    with store.lock(release):
        with t.writer_lock(e,identity) as capability:
            def facts():
                root=t.owned_writer_root(capability,e,identity)
                observations=t.chain(e,root,identity,a['writerResume']['stageVerifierSha256'],14)
                switch_status=t.parse(observations['switch'][1])
                switch=read(Path(a['writerResume']['remoteRoot'])/'switch-result.json')
                need(sha(switch)==switch_status['switchReceiptSha256'],'EXACT_SWITCH_RECEIPT')
                values={'binding':read(generated/release/'runtime/switch/binding.json'),
                        'hold':observations['hold'][1], 'switchReceipt':switch,
                        'status':observations['acceptance'][0],
                        'userAuthorization':read(inputs/release/'writer-authorization.json'),
                        'testDataScope':read(inputs/release/'test-data-scope.json')}
                original=read(published/identity['sourceRevision']/identity['publicationAttemptId']/'published.json')
                pub=t.parse(j.publication_input(original,*observations['publish'][:2]))
                need(pub['sourceRevision']==identity['sourceRevision'],'PUBLICATION_SOURCE')
                images=pub['images'];need(set(images)==p.IMAGES|{'redis'},'PUBLICATION_IMAGE_SET')
                digests={}
                for key in p.IMAGES:
                    image=images[key]['image'];need(type(image)is str and re.fullmatch(r'[^\s@]+@sha256:[0-9a-f]{64}',image),'PUBLICATION_DIGEST')
                    digests[key]=image.rsplit('@',1)[1]
                status=t.parse(values['status']);hold=t.parse(values['hold'])
                observation=p.enc(dict(kind='cn-verified-writer-chain-projection-v1',releaseSha256=release,
                    identity=identity,target=t.TARGET,observedAt=status['observedAt'],
                    holdGeneration=hold['generation'],inputHashes={k:sha(v) for k,v in values.items()},imageDigests=digests))
                codes=check_closure()
                proposal=p.derive_proposal(policy_raw,release_raw,observation,values,
                    approved_policy_sha256=sha(policy_raw),verified_observation_sha256=sha(observation),
                    observed_code_hashes={k:codes[k] for k in policy['codeFiles']},consumed_policy_ids=(),now=clock(),enabled=True)
                return observation,values,proposal
            observation,values,proposal=facts()
            claim=dict(kind='cn-writer-policy-claim-v1',policyId=proposal['policyId'],policySha256=sha(policy_raw),
                       releaseSha256=release,observationSha256=sha(observation),inputHashes=proposal['inputHashes'],
                       writerApprovalSha256=proposal['writerApprovalSha256'],state='claimed-no-redispatch')
            with store.directory(state/'claims') as directory:
                directory.exclusive('release-'+release+'.json',p.enc(claim))
                directory.exclusive(proposal['policyId']+'.json',p.enc(claim))
            # The durable claim precedes original materializer filesystem writes.
            result=t.derive_writer_resume_locked(release_raw,proposal['writerApprovalRaw'],values,e,
                generated/release/'terminal/conditional-writer-resume',capability,now=clock())
            need(result['status']=='MATERIALIZED_A5' and result['intentCreated']is False,'TERMINAL_RECHECK')
            again,new_values,_=facts()
            need(again==observation and new_values==values,'FRESH_FACTS_CHANGED')
            need(read(policies/'by-release'/(release+'.json'))==pointer_raw and
                 read(policies/(sha(policy_raw)+'.json'))==policy_raw,'POLICY_REVOKED')
            # Time is revalidated by facts() immediately before publication. Entry
            # and release locks are both still owned; no unlocked callback occurs.
            t.owned_writer_root(capability,e,identity)
            raw=proposal['writerApprovalRaw'];approval_sha=sha(raw)
            with store.directory(writers) as directory:directory.publish(approval_sha+'.json',raw)
            with store.directory(writers/'by-release') as directory:
                directory.publish(release+'.json',p.enc({'approvalSha256':approval_sha}))
            decision=dict(kind='cn-writer-policy-decision-v1',claimSha256=sha(p.enc(claim)),policyId=proposal['policyId'],
                          releaseSha256=release,writerApprovalSha256=approval_sha,state='published-terminal-reverified',writerResumed=False)
            with store.directory(state/'decisions') as directory:
                directory.publish(proposal['policyId']+'.json',p.enc(decision))
            return decision


def materialize(release, *, enabled=False):
    need(enabled is True,'POLICY_DISABLED');need(os.geteuid()==0,'ROOT_REQUIRED')
    need(type(release)is str and re.fullmatch('[0-9a-f]{64}',release),'RELEASE_HASH')
    pointer=POLICIES/'by-release'/(release+'.json')
    try: pointer_raw=private(pointer)
    except FileNotFoundError:return {'status':'WAITING_FOR_WRITER_APPROVAL','intentCreated':False,'cloudCalls':0}
    anchor=decode(pointer_raw);need(set(anchor)=={'policySha256'} and re.fullmatch('[0-9a-f]{64}',anchor['policySha256']),'POLICY_POINTER')
    policy_raw=private(POLICIES/(anchor['policySha256']+'.json'));need(sha(policy_raw)==anchor['policySha256'],'POLICY_HASH')
    release_raw=private(APPROVALS/(release+'.json'));need(sha(release_raw)==release,'RELEASE_HASH')
    a,p=decode(release_raw),decode(policy_raw)
    snapshot=closure(a,p);modules=load(snapshot)
    def check():
        need(closure(a,p)==snapshot,'CODE_CHANGED')
        need(private(APPROVALS/(release+'.json'))==release_raw,'RELEASE_REVOKED')
        return {k:sha(v) for k,v in snapshot.items()}
    return _execute(release_raw,policy_raw,pointer_raw,modules,
                    (POLICIES,STATE,WRITERS,GENERATED,INPUTS,PUBLISHED),private,check,
                    clock=lambda:dt.datetime.now(dt.timezone.utc))


def _disposition(release, paths, read, *, clock):
    policies,state,writers=paths
    try: raw=read(state/'claims'/('release-'+release+'.json'))
    except FileNotFoundError: return 'UNCLAIMED'
    claim=decode(raw)
    need(set(claim)=={'kind','policyId','policySha256','releaseSha256','observationSha256',
                     'inputHashes','writerApprovalSha256','state'} and
         claim['kind']=='cn-writer-policy-claim-v1' and claim['releaseSha256']==release and
         re.fullmatch('[0-9a-f]{32}',claim['policyId']) and
         re.fullmatch('[0-9a-f]{64}',claim['policySha256']) and
         re.fullmatch('[0-9a-f]{64}',claim['writerApprovalSha256']) and
         claim['state']=='claimed-no-redispatch','CONDITIONAL_CLAIM_INVALID')
    try:
        need(read(state/'claims'/(claim['policyId']+'.json'))==raw,'CONDITIONAL_CLAIM_CONFLICT')
        decision=decode(read(state/'decisions'/(claim['policyId']+'.json')))
        need(decision=={'kind':'cn-writer-policy-decision-v1','claimSha256':sha(raw),
            'policyId':claim['policyId'],'releaseSha256':release,'writerApprovalSha256':claim['writerApprovalSha256'],
            'state':'published-terminal-reverified','writerResumed':False},'CONDITIONAL_DECISION_INVALID')
        need(decode(read(writers/'by-release'/(release+'.json')))=={'approvalSha256':claim['writerApprovalSha256']},'CONDITIONAL_POINTER_CHANGED')
        need(sha(read(writers/(claim['writerApprovalSha256']+'.json')))==claim['writerApprovalSha256'],'CONDITIONAL_APPROVAL_CHANGED')
        need(decode(read(policies/'by-release'/(release+'.json')))=={'policySha256':claim['policySha256']},'CONDITIONAL_POLICY_CHANGED')
        policy_raw=read(policies/(claim['policySha256']+'.json'));need(sha(policy_raw)==claim['policySha256'],'CONDITIONAL_POLICY_CHANGED')
        policy=decode(policy_raw)
        need(policy['policyId']==claim['policyId'] and policy['releaseSha256']==release,'CONDITIONAL_POLICY_CHANGED')
        issued=dt.datetime.fromisoformat(policy['issuedAt'].replace('Z','+00:00'))
        expires=dt.datetime.fromisoformat(policy['expiresAt'].replace('Z','+00:00'))
        need(issued<=clock()<expires,'CONDITIONAL_POLICY_EXPIRED')
    except FileNotFoundError:
        raise ValueError('CONDITIONAL_CONSUMPTION_UNKNOWN') from None
    return 'PUBLISHED'


def disposition(release, *, enabled=False):
    need(enabled is True,'POLICY_DISABLED');need(os.geteuid()==0,'ROOT_REQUIRED')
    need(type(release)is str and re.fullmatch('[0-9a-f]{64}',release),'RELEASE_HASH')
    return _disposition(release,(POLICIES,STATE,WRITERS),private,
                        clock=lambda:dt.datetime.now(dt.timezone.utc))
