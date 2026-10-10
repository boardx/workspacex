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


def run(policy_path, expected_policy_sha, output_parent):
    """Current-owner private policy/output; downstream approval separately binds hashes."""
    raw=private_read(policy_path,256*1024,expected_policy_sha);policy=validate_policy(a.decode(raw))
    for name,expected in policy['verifierFiles'].items():private_read(Path(__file__).parent/name,1024**2,expected,private=False)
    binary_raw=private_read(policy['ghExecutable'],128*1024**2,policy['ghSha256'],private=False)
    parent=Path(output_parent)
    st=os.lstat(parent)
    a.require(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and not st.st_mode & 0o077, 'REVALIDATION_OUTPUT_TRUST')
    # Traverse via private_read by requiring the policy to be directly within the output parent.
    a.require(parent==Path(policy_path).parent,'REVALIDATION_OUTPUT_PARENT')
    final=parent/policy['verificationId'];a.require(not final.exists() and not final.is_symlink(),'REVALIDATION_DESTINATION_EXISTS')
    with tempfile.TemporaryDirectory(prefix='.revalidate-',dir=parent) as temp:
        work=Path(temp);binary=work/'gh-verified';binary.write_bytes(binary_raw);binary.chmod(0o700)
        proof=produce(policy,expected_policy_sha,Github(str(binary),time.monotonic()+3600),work,raw)
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
    return {'proofSha256':a.sha(proof),'verificationId':policy['verificationId'],'productionReady':False}
