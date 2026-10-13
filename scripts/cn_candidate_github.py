"""Protected-policy GitHub artifact revalidation. No builds, cloud writes or tokens exported.

run() requires a protected policy with exact provider IDs, input hashes, producer
workflow hash and this verifier closure. gh uses its existing authentication;
missing access fails. Public APIs and unauthenticated URL fallbacks do not exist.
"""
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import stat
import subprocess
import tempfile
import time
import zipfile
import cn_image_archive as a
import cn_image_candidate as c
import cn_candidate_revalidation as rv

from cn_candidate_revalidation import REPO, WORKFLOW, FILES, validate_policy, fresh_policy, artifact_name

def private_read(path, limit, expected=None, private=True):
    """Pin trusted path segments and a private current-owner file; no links."""
    path = Path(path)
    a.require(path.is_absolute() and '..' not in path.parts, 'REVALIDATION_PATH')
    parent = os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            os.close(parent);parent=child;st=os.fstat(parent)
            a.require(st.st_uid in (0,os.geteuid()) and not st.st_mode & 0o022,'REVALIDATION_PARENT_TRUST')
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb') as stream:
            st=os.fstat(fd)
            a.require(stat.S_ISREG(st.st_mode) and st.st_uid in (0,os.geteuid()) and st.st_nlink == 1
                      and not st.st_mode & (0o077 if private else 0o022) and 0 < st.st_size <= limit,'REVALIDATION_FILE_TRUST')
            raw=stream.read(limit+1);after=os.fstat(fd);named=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
            identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            a.require(len(raw)<=limit and identity(st)==identity(after)==identity(named),'REVALIDATION_FILE_CHANGED')
            if expected is not None:a.require(a.sha(raw)==expected,'REVALIDATION_FILE_HASH')
            return raw
    finally:os.close(parent)


def write_private(path, raw):
    with path.open('xb') as stream:
        os.chmod(path,0o600);stream.write(raw);stream.flush();os.fsync(stream.fileno())


class Github:
    def __init__(self, binary, deadline):
        self.binary=binary;self.deadline=deadline

    def fetch(self, path, target, maximum):
        a.require(path.startswith('/repos/'+REPO+'/') and '..' not in path and '\n' not in path,
                  'GITHUB_FIXED_ENDPOINT')
        environment=dict(os.environ)
        for key in ('GH_DEBUG','DEBUG','GH_HOST','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN'):
            environment.pop(key,None)
        environment['GH_HOST']='github.com';environment['GH_PROMPT_DISABLED']='1'
        process=subprocess.Popen([self.binary,'api','--hostname','github.com',path],stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL,env=environment)
        try:
            count=0
            while True:
                remaining=self.deadline-time.monotonic()
                a.require(remaining>0,'GITHUB_DOWNLOAD_DEADLINE')
                readable,_,_=select.select([process.stdout],[],[],min(remaining,1))
                if not readable:continue
                block=os.read(process.stdout.fileno(),min(1024*1024,maximum-count+1))
                if not block:break
                count+=len(block);a.require(count<=maximum,'GITHUB_DOWNLOAD_SIZE');target.write(block)
            a.require(process.wait(timeout=max(0.01,self.deadline-time.monotonic()))==0,'GITHUB_READ_FAILED')
            return count
        finally:
            if process.poll() is None:process.kill()
            process.wait();process.stdout.close()

    def json(self,path):
        import io
        out=io.BytesIO();self.fetch(path,out,4*1024*1024)
        return a.decode(out.getvalue())


def extract(zip_path, folder, limits):
    """Exact flat names only; no ZIP links, duplicate names, bombs or extraction API."""
    with zipfile.ZipFile(zip_path) as archive:
        items=archive.infolist()
        a.require(len(items)==len(limits) and {i.filename for i in items}==set(limits),'GITHUB_ZIP_MEMBERS')
        for item in items:
            mode=item.external_attr >> 16
            a.require(not item.is_dir() and (stat.S_IFMT(mode) in (0,stat.S_IFREG))
                      and not item.flag_bits & 1 and 0<item.file_size<=limits[item.filename], 'GITHUB_ZIP_FILE')
        for item in items:
            with archive.open(item) as source,(folder/item.filename).open('xb') as out:
                os.chmod(out.name,0o600);total=0
                while True:
                    block=source.read(min(1024*1024,limits[item.filename]-total+1))
                    if not block:break
                    total+=len(block);a.require(total<=limits[item.filename],'GITHUB_ZIP_SIZE');out.write(block)
                a.require(total==item.file_size,'GITHUB_ZIP_TRUNCATED');out.flush();os.fsync(out.fileno())




def download(github,p,service,directory,limits):
    fresh_policy(p)
    artifact=github.json('/repos/'+REPO+'/actions/artifacts/'+str(p['artifactIds'][service]))
    metadata_raw=a.json_bytes(artifact)
    write_private(directory/'provider-metadata.json',metadata_raw)
    binding=artifact.get('workflow_run',{})
    a.require(artifact.get('id')==p['artifactIds'][service] and artifact.get('name')==artifact_name(service,p)
              and artifact.get('expired') is False and binding.get('id')==p['runId']
              and binding.get('repository_id')==p['repositoryId'] and binding.get('head_repository_id')==p['repositoryId']
              and binding.get('head_sha')==p['controlRevision'],'GITHUB_ARTIFACT_BINDING')
    digest=artifact.get('digest');size=artifact.get('size_in_bytes')
    a.require(isinstance(digest,str) and a.re.fullmatch('sha256:[a-f0-9]{64}',digest)
              and type(size) is int and 0<size<=sum(limits.values())+1024*1024,'GITHUB_ARTIFACT_DIGEST_SIZE')
    archive=directory/'provider.zip'
    with archive.open('xb') as out:
        os.chmod(out.name,0o600)
        actual=github.fetch('/repos/'+REPO+'/actions/artifacts/'+str(artifact['id'])+'/zip',out,size)
        out.flush();os.fsync(out.fileno())
    a.require(actual==size and a.file_digest(archive,size)[1]==digest[7:],'GITHUB_ARTIFACT_BYTES')
    extract(archive,directory,limits)
    fresh_policy(p)
    return {'artifactId':artifact['id'],'name':artifact['name'],'providerDigest':digest,'zipSha256':digest[7:],'zipBytes':size,'providerMetadataSha256':a.sha(metadata_raw)}


def produce(p, policy_sha, github, work, policy_raw):
    """Internal algorithm; public root entry constructs the real authenticated adapter."""
    validate_policy(p);started=datetime.now(timezone.utc)
    run=github.json('/repos/'+REPO+'/actions/runs/'+str(p['runId'])+'/attempts/'+str(p['runAttempt']))
    a.require(run.get('id')==p['runId'] and run.get('run_attempt')==p['runAttempt']
              and run.get('head_sha')==p['controlRevision'] and run.get('head_branch')=='main'
              and run.get('path')==WORKFLOW and run.get('event')=='workflow_dispatch'
              and run.get('status')=='completed' and run.get('conclusion')=='success'
              and run.get('repository',{}).get('id')==p['repositoryId']
              and run.get('repository',{}).get('full_name')==REPO,'GITHUB_PRODUCER_BINDING')
    run_raw=a.json_bytes(run);write_private(work/'provider-run.json',run_raw)
    source=github.json('/repos/'+REPO+'/contents/'+WORKFLOW+'?ref='+p['controlRevision'])
    a.require(source.get('encoding')=='base64' and a.sha(base64.b64decode(source['content'],validate=False))==p['producerWorkflowSha256'],
              'GITHUB_WORKFLOW_BINDING')
    workflow_raw=a.json_bytes(source);write_private(work/'provider-workflow.json',workflow_raw)
    records={}
    for name,limits in [('plan',{'cn-candidate-plan.json':16384}),('set',{'candidate-plan.json':16384,'candidate-set.json':256*1024})]:
        directory=work/name;directory.mkdir(mode=0o700);records[name]=download(github,p,name,directory,limits)
    plan_raw=(work/'plan/cn-candidate-plan.json').read_bytes();set_raw=(work/'set/candidate-set.json').read_bytes()
    a.require(a.sha(plan_raw)==p['candidatePlanRawSha256'] and a.sha(set_raw)==p['candidateSetRawSha256']
              and (work/'set/candidate-plan.json').read_bytes()==plan_raw,'GITHUB_ORIGINAL_BYTES')
    plan=c.validate_plan(a.decode(plan_raw));a.require(plan['controlRevision']==p['controlRevision'],'GITHUB_CONTROL_BINDING')
    receipt=c.validate_historical_receipt(set_raw,plan,p['candidateSetRawSha256'])
    a.require(receipt['planRawSha256']==a.sha(plan_raw) and set(receipt['images'])==set(a.REPOSITORIES),'GITHUB_COMPLETE_FIVE')
    total=0
    for s,e in receipt['images'].items():
        a.require(type(e) is dict and type(e.get('size')) is int and 0<e['size']<=plan['maxArchiveBytes'],'GITHUB_DECLARED_SIZE')
        total+=e['size']
    a.require(total<=plan['maxTotalBytes'] and shutil.disk_usage(work).free>=total*2+plan['storageMarginBytes'], 'REVALIDATION_CAPACITY')
    bundle=work/'bundle';bundle.mkdir(mode=0o700);fragments={};issued=[];expires=[]
    for service in a.REPOSITORIES:
        directory=work/service;directory.mkdir(mode=0o700)
        records[service]=download(github,p,service,directory,{'candidate-plan.json':16384,'candidate-fragment.json':256*1024,service+'.tar':receipt['images'][service]['size']})
        a.require((directory/'candidate-plan.json').read_bytes()==plan_raw,'GITHUB_FRAGMENT_PLAN')
        raw=(directory/'candidate-fragment.json').read_bytes();fragments[service]=a.sha(raw)
        fragment=c.verify_historical_bundle(directory,plan,raw,a.sha(raw),a.sha(plan_raw),complete=False)
        a.require(set(fragment['images'])=={service} and fragment['images'][service]==receipt['images'][service], 'GITHUB_FRAGMENT_BINDING')
        issued.append(a.timestamp(fragment['producedAt']));expires.append(a.timestamp(fragment['expiresAt']))
        os.rename(directory/(service+'.tar'),bundle/(service+'.tar'))
    a.require(a.timestamp(receipt['producedAt'])==min(issued) and a.timestamp(receipt['expiresAt'])==min(expires), 'GITHUB_COLLECTION_TIMES')
    c.verify_historical_bundle(bundle,plan,set_raw,a.sha(set_raw),a.sha(plan_raw))
    a.require(a.timestamp(receipt['producedAt'])<=started,'GITHUB_FUTURE_RECEIPT')
    write_private(bundle/'candidate-plan.json',plan_raw);write_private(bundle/'candidate-set.json',set_raw)
    fresh_policy(p);verified=datetime.now(timezone.utc)
    proof=dict(kind='candidate-revalidation-v1',schemaVersion=1,audience=p['audience'],purpose=p['purpose'],verificationId=p['verificationId'],policyRawSha256=policy_sha,
               verifierRevision=p['verifierRevision'],verifierFiles=p['verifierFiles'],verifiedStartedAt=started.isoformat(),
               verifiedAt=verified.isoformat(),expiresAt=min(verified+timedelta(hours=1),a.timestamp(p['expiresAt'])).isoformat(),
               originalExpiresAt=receipt['expiresAt'],candidatePlanRawSha256=a.sha(plan_raw),candidateSetRawSha256=a.sha(set_raw),
               candidateIdentity=c.identity(plan),**{k:plan[k] for k in ('sourceRevision','controlRevision','attemptId')},
               images=receipt['images'],fragmentSha256=fragments,
               github=dict(repository=REPO,repositoryId=p['repositoryId'],runId=p['runId'],runAttempt=p['runAttempt'],
                           workflow=WORKFLOW,producerWorkflowSha256=p['producerWorkflowSha256'],artifacts=records,runMetadataSha256=a.sha(run_raw),workflowMetadataSha256=a.sha(workflow_raw)),
               releaseReady=False,productionReady=False)
    raw=a.json_bytes(proof);rv.admit(raw,a.sha(raw),policy_sha,policy_raw).verify_bundle(bundle,plan,set_raw,a.sha(set_raw),a.sha(plan_raw))
    return raw


def run(policy_path, expected_policy_sha, output_parent, *, cache_manifest_path=None, cache_manifest_sha=None):
    """Current-owner private policy/output; downstream approval separately binds hashes."""
    raw=private_read(policy_path,256*1024,expected_policy_sha);policy=validate_policy(a.decode(raw))
    for name,expected in policy['verifierFiles'].items():private_read(Path(__file__).parent/name,1024**2,expected,private=False)
    binary_raw=private_read(policy['ghExecutable'],128*1024**2,policy['ghSha256'],private=False)
    manifest=None
    if cache_manifest_path is not None:
        manifest=validate_cache_manifest(private_read(cache_manifest_path,256*1024,cache_manifest_sha),cache_manifest_sha,policy)
    else:a.require(cache_manifest_sha is None,'CACHE_MODE')
    parent=Path(output_parent)
    st=os.lstat(parent)
    a.require(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and not st.st_mode & 0o077, 'REVALIDATION_OUTPUT_TRUST')
    # Traverse via private_read by requiring the policy to be directly within the output parent.
    a.require(parent==Path(policy_path).parent,'REVALIDATION_OUTPUT_PARENT')
    final=parent/policy['verificationId'];a.require(not final.exists() and not final.is_symlink(),'REVALIDATION_DESTINATION_EXISTS')
    with tempfile.TemporaryDirectory(prefix='.revalidate-',dir=parent) as temp:
        work=Path(temp);binary=work/'gh-verified';binary.write_bytes(binary_raw);binary.chmod(0o700)
        github=Github(str(binary),time.monotonic()+3600)
        if manifest is None:proof=produce(policy,expected_policy_sha,github,work,raw)
        else:proof=produce_cached(policy,expected_policy_sha,github,work,raw,manifest,cache_manifest_sha)
        binary.unlink()
        out=work/'candidate-revalidation.json'
        with out.open('xb') as stream:
            os.chmod(out,0o600);stream.write(proof);stream.flush();os.fsync(stream.fileno())
        import ctypes
        import sys
        libc=ctypes.CDLL(None,use_errno=True)
        parent_fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            st=os.fstat(parent_fd)
            a.require(st.st_uid==os.geteuid() and not st.st_mode & 0o077, 'REVALIDATION_OUTPUT_TRUST')
            fd=os.open(work,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:os.fsync(fd)
            finally:os.close(fd)
            if sys.platform=='linux':
                result=libc.renameat2(parent_fd,os.fsencode(work.name),parent_fd,os.fsencode(final.name),1)
            elif sys.platform=='darwin':
                result=libc.renameatx_np(parent_fd,os.fsencode(work.name),parent_fd,os.fsencode(final.name),4)
            else:
                raise a.Rejected('REVALIDATION_PLATFORM_UNSUPPORTED')
            a.require(result==0,'REVALIDATION_DESTINATION_COLLISION');os.fsync(parent_fd)
        finally:os.close(parent_fd)
    result={'proofSha256':a.sha(proof),'verificationId':policy['verificationId'],'productionReady':False}
    if manifest is not None:result.update(mode='prefetched-untrusted-zip',acquisitionManifestRawSha256=cache_manifest_sha)
    return result


CACHE_KIND='candidate-untrusted-provider-cache-v1'


def validate_cache_manifest(raw, expected_sha, policy):
    """A hash pins selected input bytes; it never makes a cached ZIP authoritative."""
    a.require(type(raw) is bytes and len(raw)<=256*1024 and a.sha(raw)==expected_sha,'CACHE_MANIFEST_HASH')
    value=a.decode(raw)
    fields={'kind','schemaVersion','repositoryId','runId','runAttempt','controlRevision',
            'candidatePlanRawSha256','candidateSetRawSha256','artifacts','productionReady'}
    a.require(type(value) is dict and set(value)==fields and value['kind']==CACHE_KIND
              and type(value['schemaVersion']) is int and value['schemaVersion']==1 and value['productionReady'] is False,'CACHE_MANIFEST_FIELDS')
    for key in ('repositoryId','runId','runAttempt','controlRevision','candidatePlanRawSha256','candidateSetRawSha256'):
        a.require(type(value[key]) is type(policy[key]) and value[key]==policy[key],'CACHE_MANIFEST_BINDING')
    a.require(type(value['artifacts']) is dict and set(value['artifacts'])==set(policy['artifactIds']),'CACHE_COMPLETE_SEVEN')
    for name,record in value['artifacts'].items():
        a.require(type(record) is dict and set(record)=={'artifactId','path','zipBytes','zipSha256'},'CACHE_RECORD_FIELDS')
        a.require(type(record['artifactId']) is int and record['artifactId']==policy['artifactIds'][name]
                  and type(record['zipBytes']) is int and 0<record['zipBytes']<=5*1024**3
                  and a.hex_string(record['zipSha256'],64),'CACHE_RECORD_BINDING')
        path=Path(record['path']);a.require(path.is_absolute() and '..' not in path.parts,'CACHE_PATH')
    a.require(sum(r['zipBytes'] for r in value['artifacts'].values())<=10*1024**3,'CACHE_TOTAL_LIMIT')
    return value


def copy_cache_zip(record,target,maximum,deadline):
    """Private pinned FD, streaming hash, stable identity and exact destination bounds."""
    path=Path(record['path']);parent=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in path.parts[1:-1]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            os.close(parent);parent=child;st=os.fstat(parent)
            a.require(st.st_uid in (0,os.geteuid()) and not st.st_mode&0o022,'CACHE_PARENT_TRUST')
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb') as stream:
            before=os.fstat(fd)
            a.require(stat.S_ISREG(before.st_mode) and before.st_uid==os.geteuid() and before.st_nlink==1
                      and not before.st_mode&0o077 and before.st_size==record['zipBytes']<=maximum,'CACHE_FILE_TRUST')
            digest=hashlib.sha256();count=0
            while True:
                a.require(time.monotonic()<deadline,'CACHE_DEADLINE')
                block=stream.read(min(1024*1024,maximum-count+1))
                if not block:break
                count+=len(block);a.require(count<=maximum,'CACHE_SIZE');digest.update(block);target.write(block)
            after=os.fstat(fd);named=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
            identity=lambda st:(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
            a.require(identity(before)==identity(after)==identity(named) and count==record['zipBytes']
                      and digest.hexdigest()==record['zipSha256'],'CACHE_BYTES_CHANGED')
            return count
    finally:os.close(parent)


class CachedGithub:
    """Only exact seven ZIP reads use cache; every metadata read uses real gh."""
    def __init__(self, github, manifest):
        self.github=github;self.deadline=github.deadline
        self.paths={'/repos/'+REPO+'/actions/artifacts/'+str(r['artifactId'])+'/zip':r for r in manifest['artifacts'].values()}
        self.metadata={}
    def json(self,path):
        value=self.github.json(path)
        self.metadata[path]=a.json_bytes(value)
        return value
    def fetch(self,path,target,maximum):
        a.require(path in self.paths,'CACHE_FIXED_ZIP_ENDPOINT')
        return copy_cache_zip(self.paths[path],target,maximum,self.deadline)
    def verify_after(self,p,work):
        fresh_policy(p)
        for index,(path,prior) in enumerate(self.metadata.items()):
            current=self.github.json(path);raw=a.json_bytes(current)
            # Exact snapshots also reject benign changes: conservative, never a fallback.
            a.require(raw==prior,'CACHE_PROVIDER_CHANGED')
            if '/actions/artifacts/' in path:
                a.require(current.get('expired') is False,'CACHE_PROVIDER_EXPIRED')
            write_private(work/('provider-after-'+str(index)+'.json'),raw)
        fresh_policy(p)


def produce_cached(p,policy_sha,github,work,policy_raw,manifest,manifest_sha):
    adapter=CachedGithub(github,manifest)
    raw=produce(p,policy_sha,adapter,work,policy_raw)
    adapter.verify_after(p,work)
    value=a.decode(raw);verified=datetime.now(timezone.utc)
    value['verifiedAt']=verified.isoformat()
    value['expiresAt']=min(verified+timedelta(hours=1),a.timestamp(p['expiresAt'])).isoformat()
    raw=a.json_bytes(value)
    rv.admit(raw,a.sha(raw),policy_sha,policy_raw).verify_bundle(work/'bundle',c.validate_plan(a.decode((work/'bundle/candidate-plan.json').read_bytes())),
        (work/'bundle/candidate-set.json').read_bytes(),p['candidateSetRawSha256'],p['candidatePlanRawSha256'])
    # This independently hashed observation makes the acquisition method explicit.
    write_private(work/'cache-verification-observation.json',a.json_bytes(dict(
        kind='candidate-cache-verification-observation-v1',mode='prefetched-untrusted-zip',
        acquisitionManifestRawSha256=manifest_sha,proofRawSha256=a.sha(raw),
        freshDownloadClaimed=False,authenticatedMetadataBeforeAndAfter=True,productionReady=False)))
    return raw


SELECTION_FIELDS={'repositoryId','runId','runAttempt','controlRevision','producerWorkflowSha256',
                  'candidatePlanRawSha256','candidateSetRawSha256','artifactIds'}


def validate_acquisition(request):
    fields={'kind','schemaVersion','acquisitionId','selection','artifacts','reusePaths','verifierRevision',
            'verifierFiles','ghExecutable','ghSha256','maxSeconds','workers','networkAcquisitionAuthorized','previousDownloadStopped'}
    a.require(type(request) is dict and set(request)==fields and request['kind']=='candidate-byte-acquisition-request-v1'
              and type(request['schemaVersion']) is int and request['schemaVersion']==1
              and request['networkAcquisitionAuthorized'] is True and request['previousDownloadStopped'] is True,'ACQUISITION_FIELDS')
    a.require(isinstance(request['acquisitionId'],str) and a.re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',request['acquisitionId'])
              and type(request['maxSeconds']) is int and 0<request['maxSeconds']<=14400
              and type(request['workers']) is int and 1<=request['workers']<=4,'ACQUISITION_BOUNDS')
    p=request['selection'];a.require(type(p) is dict and set(p)==SELECTION_FIELDS,'ACQUISITION_SELECTION')
    for key in ('repositoryId','runId','runAttempt'):a.require(type(p[key]) is int and p[key]>0,'ACQUISITION_PROVIDER_ID')
    a.require(a.hex_string(p['controlRevision'],40) and a.hex_string(request['verifierRevision'],40),'ACQUISITION_REVISION')
    for key in ('producerWorkflowSha256','candidatePlanRawSha256','candidateSetRawSha256'):a.require(a.hex_string(p[key],64),'ACQUISITION_HASH')
    a.require(a.hex_string(request['ghSha256'],64) and type(request['verifierFiles']) is dict
              and set(request['verifierFiles'])==FILES and all(a.hex_string(v,64) for v in request['verifierFiles'].values()),'ACQUISITION_CLOSURE')
    a.require(type(p['artifactIds']) is dict and set(p['artifactIds'])=={'plan','set',*a.REPOSITORIES}
              and all(type(v) is int and v>0 for v in p['artifactIds'].values())
              and len(set(p['artifactIds'].values()))==7,'ACQUISITION_IDS')
    a.require(type(request['artifacts']) is dict and set(request['artifacts'])==set(p['artifactIds']),'ACQUISITION_ARTIFACTS')
    for record in request['artifacts'].values():
        a.require(type(record) is dict and set(record)=={'zipBytes','zipSha256'} and type(record['zipBytes']) is int
                  and 0<record['zipBytes']<=5*1024**3 and a.hex_string(record['zipSha256'],64),'ACQUISITION_RECORD')
    a.require(sum(r['zipBytes'] for r in request['artifacts'].values())<=10*1024**3,'ACQUISITION_TOTAL')
    a.require(type(request['reusePaths']) is dict and set(request['reusePaths'])<=set(p['artifactIds']),'ACQUISITION_REUSE')
    for path in request['reusePaths'].values():
        a.require(isinstance(path,str) and Path(path).is_absolute() and '..' not in Path(path).parts,'ACQUISITION_REUSE_PATH')
    return request


def acquisition_metadata(github,p,name,record):
    value=github.json('/repos/'+REPO+'/actions/artifacts/'+str(p['artifactIds'][name]));binding=value.get('workflow_run',{})
    a.require(value.get('id')==p['artifactIds'][name] and value.get('name')==artifact_name(name,p)
              and value.get('expired') is False and binding.get('id')==p['runId']
              and binding.get('repository_id')==p['repositoryId'] and binding.get('head_repository_id')==p['repositoryId']
              and binding.get('head_sha')==p['controlRevision'] and type(value.get('size_in_bytes')) is int
              and value['size_in_bytes']==record['zipBytes'] and value.get('digest')=='sha256:'+record['zipSha256'],'ACQUISITION_PROVIDER_BINDING')
    return a.json_bytes(value)


def seal_cache_file(directory,old,new):
    import ctypes
    import sys
    fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        libc=ctypes.CDLL(None,use_errno=True)
        if sys.platform=='darwin':result=libc.renameatx_np(fd,os.fsencode(old),fd,os.fsencode(new),4)
        elif sys.platform=='linux':result=libc.renameat2(fd,os.fsencode(old),fd,os.fsencode(new),1)
        else:raise a.Rejected('ACQUISITION_PLATFORM')
        a.require(result==0,'ACQUISITION_COLLISION');os.fsync(fd)
    finally:os.close(fd)


def acquire_one(request,github,name,work):
    """Exactly one GET or an explicit complete-byte adoption; never a retry."""
    p=request['selection'];record=request['artifacts'][name]
    before=acquisition_metadata(github,p,name,record);write_private(work/(name+'-before.json'),before)
    path=work/(name+'.zip')
    partial=work/(name+'.zip.partial')
    with partial.open('xb') as target:
        os.chmod(partial,0o600)
        if name in request['reusePaths']:
            actual=copy_cache_zip(dict(record,path=request['reusePaths'][name]),target,record['zipBytes'],github.deadline)
        else:
            actual=github.fetch('/repos/'+REPO+'/actions/artifacts/'+str(p['artifactIds'][name])+'/zip',target,record['zipBytes'])
        target.flush();os.fsync(target.fileno())
    a.require(actual==record['zipBytes'] and a.file_digest(partial,record['zipBytes'])[1]==record['zipSha256'],'ACQUISITION_BYTES')
    after=acquisition_metadata(github,p,name,record);a.require(after==before,'ACQUISITION_PROVIDER_CHANGED')
    write_private(work/(name+'-after.json'),after)
    seal_cache_file(work,partial.name,path.name)
    return dict(record,artifactId=p['artifactIds'][name],path=str(path))


def acquire(request_path,expected_sha,output_parent):
    """Long byte acquisition has no revalidation policy, proof, or refreshed TTL."""
    from concurrent.futures import ThreadPoolExecutor,as_completed
    raw=private_read(request_path,256*1024,expected_sha);request=validate_acquisition(a.decode(raw))
    for name,digest in request['verifierFiles'].items():private_read(Path(__file__).parent/name,1024**2,digest,private=False)
    binary_raw=private_read(request['ghExecutable'],128*1024**2,request['ghSha256'],private=False)
    parent=Path(output_parent);a.require(parent==Path(request_path).parent,'ACQUISITION_PARENT')
    st=os.lstat(parent);a.require(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and not st.st_mode&0o077,'ACQUISITION_PARENT_TRUST')
    # Budget covers ZIP copies plus headroom; no tar extraction occurs here.
    a.require(shutil.disk_usage(parent).free>=sum(r['zipBytes'] for r in request['artifacts'].values())+2*1024**3,'ACQUISITION_CAPACITY')
    work=parent/request['acquisitionId'];work.mkdir(mode=0o700)
    binary=work/'gh-verified';write_private(binary,binary_raw);binary.chmod(0o700)
    github=Github(str(binary),time.monotonic()+request['maxSeconds']);p=request['selection']
    try:
        run_path='/repos/'+REPO+'/actions/runs/'+str(p['runId'])+'/attempts/'+str(p['runAttempt'])
        run=github.json(run_path)
        a.require(run.get('id')==p['runId'] and run.get('run_attempt')==p['runAttempt'] and run.get('head_sha')==p['controlRevision']
                  and run.get('head_branch')=='main' and run.get('path')==WORKFLOW and run.get('event')=='workflow_dispatch'
                  and run.get('status')=='completed' and run.get('conclusion')=='success'
                  and run.get('repository',{}).get('id')==p['repositoryId'] and run.get('repository',{}).get('full_name')==REPO,'ACQUISITION_RUN')
        source_path='/repos/'+REPO+'/contents/'+WORKFLOW+'?ref='+p['controlRevision'];source=github.json(source_path)
        a.require(source.get('encoding')=='base64' and a.sha(base64.b64decode(source['content']))==p['producerWorkflowSha256'],'ACQUISITION_WORKFLOW')
        write_private(work/'run.json',a.json_bytes(run));write_private(work/'workflow.json',a.json_bytes(source))
        records={}
        # Explicit reuse happens first. If it fails, no large network download starts.
        for name in request['reusePaths']:records[name]=acquire_one(request,github,name,work)
        with ThreadPoolExecutor(max_workers=request['workers']) as pool:
            futures={pool.submit(acquire_one,request,github,name,work):name for name in p['artifactIds'] if name not in records}
            try:
                for future in as_completed(futures):records[futures[future]]=future.result()
            except BaseException:
                # Global deadline stops all active pipes; join before the tool exits.
                github.deadline=time.monotonic()
                for future in futures:future.cancel()
                raise
        a.require(github.json(run_path)==run and github.json(source_path)==source,'ACQUISITION_PRODUCER_CHANGED')
        manifest=dict(kind=CACHE_KIND,schemaVersion=1,**{key:p[key] for key in ('repositoryId','runId','runAttempt','controlRevision','candidatePlanRawSha256','candidateSetRawSha256')},artifacts=records,productionReady=False)
        manifest_raw=a.json_bytes(manifest);validate_cache_manifest(manifest_raw,a.sha(manifest_raw),p)
        write_private(work/'acquisition-manifest.json',manifest_raw)
        receipt=dict(kind='candidate-byte-acquisition-result-v1',requestRawSha256=expected_sha,manifestRawSha256=a.sha(manifest_raw),
                     mode='untrusted-bytes-only',proofGenerated=False,productionReady=False)
        write_private(work/'acquisition-result.json',a.json_bytes(receipt));return receipt
    finally:binary.unlink()
