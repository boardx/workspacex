#!/usr/bin/env python3
"""Consume-only physical/canonical observer; no SDK, cloud mutation or extraction.

Terminal verification is valid only for the exact approved GET-only consume
command, after the outer entry has independently proven its execution tree empty.
This is not a generic Docker/provider terminal observer.
"""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

APPROVALS=Path('/etc/workspacex-cn/acquire-observers')
STATE=Path('/var/lib/workspacex-cn')
CODE=Path('/usr/local/lib/workspacex-cn/candidate-download-code')
MODULES=('cn_candidate_revalidation.py','cn_image_candidate.py','cn_image_archive.py','hosted-release.py','canonical_control.py')
SELF=Path(__file__).resolve()
MAX=1048576


def need(v,code):
    if not v:raise ValueError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def encode(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()


def parse(raw):
    def pairs(items):
        value={}
        for k,v in items:need(k not in value,'DUPLICATE_KEY');value[k]=v
        return value
    return json.loads(raw,object_pairs_hook=pairs)


def stamp(v):
    out=dt.datetime.fromisoformat(v.replace('Z','+00:00'));need(out.tzinfo is not None,'TIMEZONE');return out


def signature(s):return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)


def directory(path):
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in Path(path).parts[1:]:
            new=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=new;s=os.fstat(fd)
            need(s.st_uid==s.st_gid==0 and not s.st_mode&0o022,'UNTRUSTED_DIRECTORY')
        return fd
    except BaseException:os.close(fd);raise


class Reader:
    """Hold nofollow descriptors; every inode is rechecked after canonical reads."""
    def __init__(self):self.handles=[]
    def read(self,path,maximum,expected=None,keep=True,mode=0o600):
        path=Path(path);parent=directory(path.parent)
        try:fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        except BaseException:os.close(parent);raise
        s=os.fstat(fd)
        self.handles.append((fd,parent,path.name,signature(s)))
        need(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode) in ((mode,) if type(mode) is int else mode) and 0<s.st_size<=maximum,'UNTRUSTED_FILE')
        h=hashlib.sha256();size=0;parts=[]
        while True:
            raw=os.read(fd,min(1048576,maximum-size+1))
            if not raw:break
            size+=len(raw);need(size<=maximum,'FILE_LIMIT');h.update(raw)
            if keep:parts.append(raw)
        need(size==s.st_size and (expected is None or h.hexdigest()==expected),'FILE_HASH')
        self.stable()
        return b''.join(parts) if keep else {'bytes':size,'sha256':h.hexdigest()}
    def stable(self):
        for fd,parent,name,expected in self.handles:need(signature(os.fstat(fd))==expected==signature(os.stat(name,dir_fd=parent,follow_symlinks=False)),'FILE_CHANGED_DURING_OBSERVATION')
    def close(self):
        for fd,parent,_,_ in reversed(self.handles):os.close(fd);os.close(parent)
        self.handles=[]


def bundle(request_raw,config_raw,entry_identity,action_sha,observer_sha):
    """Pure record derivation, no authority installation or observation."""
    request,config=parse(request_raw),parse(config_raw)
    need(request['phase']=='consume','ONLY_CONSUME')
    for key in ('sourceRevision','controlRevision'):need(re.fullmatch('[a-f0-9]{40}',request[key]),'EXACT_REVISION')
    need(re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',request['attemptId']),'EXACT_ATTEMPT')
    need(set(config['objects'])=={'api','web','agent','sandbox','postgres','plan','set','proof','policy'},'NINE_ORIGINAL_OBJECTS')
    for name,obj in config['objects'].items():need(type(obj['bytes'])is int and 0<obj['bytes']<=(256*1024 if name in ('proof','policy') else 2*1024**3) and re.fullmatch('[a-f0-9]{64}',obj['sha256']),'BOUNDED_OBJECT')
    need(sum(x['bytes'] for x in config['objects'].values())<5*1024**3,'BOUNDED_OBJECT_TOTAL')
    for k in ('sourceRevision','controlRevision','attemptId'):need(request[k]==config[k],'CONFIG_REQUEST_IDENTITY')
    need(config['destinationName']=='hk-'+sha(encode(request))[:32],'CONFIG_DESTINATION')
    for k in ('requestedAt','deadlineAt','sourceRevision','controlRevision'):need(entry_identity[k]==request[k],'ENTRY_IDENTITY')
    for h in (action_sha,observer_sha):need(re.fullmatch('[a-f0-9]{64}',h),'CODE_SHA')
    for k in ('proof','policy'):need(config['objects'][k]['sha256']==request['inputs'][k],'CONFIG_PROOF_PIN')
    approval={'kind':'cn-consume-observer-approval-v1','requestSha256':sha(request_raw),'configSha256':sha(config_raw),'actionSha256':action_sha,'observerSha256':observer_sha,'entryIdentity':entry_identity,'codeFiles':{n:request['launcher']['code'][n] for n in MODULES}}
    return {'approval.json':encode(approval),'request.json':request_raw,'consumer-request.json':config_raw}


CANONICAL='''import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import cn_candidate_revalidation as rv
import cn_image_candidate as c
root=Path(sys.argv[2]);p=(root/'candidate-plan.json').read_bytes();s=(root/'candidate-set.json').read_bytes();proof=(root/'revalidation.json').read_bytes();policy=(root/'revalidation-policy.json').read_bytes();h=lambda x:hashlib.sha256(x).hexdigest()
cap=rv.admit(proof,sys.argv[3],sys.argv[4],policy);plan=c.validate_plan(json.loads(p));receipt=cap.verify_bundle(root,plan,s,h(s),h(p))
print(json.dumps({'images':receipt['images'],'expiresAt':cap.expires_at},sort_keys=True))
'''


def observe(request_sha):
    need(re.fullmatch('[a-f0-9]{64}',request_sha),'REQUEST_SHA');reader=Reader();lock=None
    try:
        root=APPROVALS/request_sha
        approval=parse(reader.read(root/'approval.json',MAX));request_raw=reader.read(root/'request.json',MAX,request_sha);request=parse(request_raw)
        config_raw=reader.read(root/'consumer-request.json',MAX,approval['configSha256']);config=parse(config_raw)
        expected=bundle(request_raw,config_raw,approval['entryIdentity'],approval['actionSha256'],approval['observerSha256'])
        need(parse(expected['approval.json'])==approval,'OBSERVER_APPROVAL_BINDING')
        reader.read(SELF,MAX,approval['observerSha256'],mode=(0o600,0o700))
        now=dt.datetime.now(dt.timezone.utc);need(stamp(request['requestedAt'])<=now<stamp(request['deadlineAt']),'OBSERVATION_DEADLINE')
        for name,digest in approval['codeFiles'].items():reader.read(CODE/request['controlRevision']/name,2*MAX,digest,keep=False,mode=0o700)
        # Shared lock coordinates with the original consumer/publisher exclusive lock.
        parent=directory(STATE/'runtime')
        try:lock=os.open('release.lock',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        finally:os.close(parent)
        st=os.fstat(lock);need(stat.S_ISREG(st.st_mode) and st.st_uid==st.st_gid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600,'RELEASE_LOCK')
        fcntl.flock(lock,fcntl.LOCK_SH|fcntl.LOCK_NB)
        consumed=STATE/config['destinationName'];inbox=STATE/'candidate-inbox'/request['sourceRevision']/request['attemptId'];facts={}
        for name,obj in config['objects'].items():
            ext='.json' if name in ('proof','policy') else '.zip'
            fact=reader.read(consumed/'original'/(name+ext),obj['bytes'],obj['sha256'],keep=False);need(fact['bytes']==obj['bytes'],'OBJECT_SIZE');facts['original/'+name+ext]=fact
        for name,key in (('candidate-plan.json','plan'),('candidate-set.json','set'),('revalidation.json','proof'),('revalidation-policy.json','policy')):
            raw=reader.read(inbox/name,MAX,request['inputs'][key]);facts['inbox/'+name]={'bytes':len(raw),'sha256':sha(raw)}
        set_raw=reader.read(inbox/'candidate-set.json',MAX,request['inputs']['set']);images=parse(set_raw)['images']
        for name,item in images.items():
            need(name in ('api','web','agent','sandbox','postgres') and item['file']==name+'.tar','TAR_NAME')
            facts['inbox/'+name+'.tar']=reader.read(inbox/(name+'.tar'),item['size'],item['sha256'],keep=False)
        receipt_raw=reader.read(consumed/'promoted-receipt.json',65536);receipt=parse(receipt_raw)
        need(receipt['sourceRevision']==request['sourceRevision'] and receipt['controlRevision']==request['controlRevision'] and receipt['bundle']==str(inbox) and receipt['root']==str(consumed),'PHYSICAL_RECEIPT_IDENTITY')
        need(receipt['images']==images and receipt['proofSha256']==request['inputs']['proof'] and receipt['policySha256']==request['inputs']['policy'],'PHYSICAL_RECEIPT_BYTES')
        timeout=min(120,int((stamp(request['deadlineAt'])-dt.datetime.now(dt.timezone.utc)).total_seconds()));need(timeout>0,'OBSERVATION_BUDGET')
        child=subprocess.run([sys.executable,'-I','-S','-B','-c',CANONICAL,str(CODE/request['controlRevision']),str(inbox),request['inputs']['proof'],request['inputs']['policy']],env={'PATH':'/usr/bin:/bin','LANG':'C'},capture_output=True,timeout=timeout)
        need(child.returncode==0 and len(child.stdout)<=65536,'CANONICAL_READBACK_REJECTED');canonical=parse(child.stdout);need(canonical['images']==images,'CANONICAL_IMAGES')
        reader.stable();need(signature(os.fstat(lock))==signature((STATE/'runtime/release.lock').lstat()),'LOCK_CHANGED')
        need(dt.datetime.now(dt.timezone.utc)<stamp(request['deadlineAt']),'OBSERVATION_AFTER_DEADLINE')
        value={'kind':'cn-consume-readonly-observation-v1','requestSha256':request_sha,'actionSha256':approval['actionSha256'],'entryIdentity':approval['entryIdentity'],'runtimeReceiptSha256':sha(receipt_raw),'files':facts,'canonicalImages':canonical['images'],'canonicalExpiresAt':canonical['expiresAt'],'codeFiles':approval['codeFiles'],'scope':'approved-get-only-consume-local-files','cloudCalls':0,'writesPerformed':False}
        raw=encode(value);need(len(raw)<=65536,'OBSERVATION_OUTPUT_LIMIT');return raw
    finally:
        if lock is not None:os.close(lock)
        reader.close()


def verify(raw,manifest,previous,mode,request_sha):
    """Pinned fixed verifier wrapper supplies request_sha, never the runner.

    entry.execution_terminal plus this exact GET-only action/local-file readback
    establish consume terminality. No equivalent claim applies to other stages.
    """
    need(manifest['stage']=='consume' and manifest['scope']=='runtime-only-reviewed-continuation' and previous is None,'ONLY_APPROVED_CONSUME_STAGE')
    observed_raw=observe(request_sha);observed=parse(observed_raw)
    need(manifest['actionSha256']==observed['actionSha256'],'UNKNOWN_REMOTE_ACTION')
    for k,v in observed['entryIdentity'].items():need(manifest[k]==v,'MANIFEST_REQUEST_IDENTITY')
    if mode=='advance':return sha(raw)==observed['runtimeReceiptSha256']
    need(mode in ('terminal','reconcile'),'UNSUPPORTED_VERIFICATION_MODE')
    need(raw==observed_raw,'OBSERVATION_CHANGED')
    return {'externalWritesTerminal':True} if mode=='terminal' else True


def main():
    need(len(sys.argv)==2,'ONLY_REQUEST_SHA_ACCEPTED');sys.stdout.buffer.write(observe(sys.argv[1]))

if __name__=='__main__':main()
