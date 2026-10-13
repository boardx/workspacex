#!/usr/bin/env python3
"""Fixed publication readback. No push/pull/load/tag/remove or production file write.

Authentication and bounded subprocess handling are inherited from the reviewed
canonical host adapter. Only its own private Docker config/snapshot are temporary.
"""
import datetime as dt
import hashlib
import fcntl
import stat
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]
_spec=importlib.util.spec_from_file_location('consume_observer',ROOT/'scripts/cn-release-acquire-observer.py')
o=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(o)
need,sha,parse,encode=o.need,o.sha,o.parse,o.encode
APPROVALS=Path('/etc/workspacex-cn/publication-observers')
STAGE=Path('/etc/workspacex-cn/candidate-publish')
INBOX=Path('/var/lib/workspacex-cn/candidate-inbox')
PUBLISHED=Path('/var/lib/workspacex-cn/archive-published')
TOOLS=Path('/usr/local/lib/workspacex-cn')
SELF=Path(__file__).resolve()
FILES=('approval.json','candidate-plan.json','publication-intent.json','immutable-provider-response.json','candidate-revalidation.json','candidate-revalidation-policy.json')
PHASES=('publication-stage','check-plan','publish')
CHECK_MARKER=b'CN_CANDIDATE_PLAN_VALIDATED publicationSideEffects=false\n'


def bundle(request_raw,contents,identity,actions,observer_files):
    request=parse(request_raw);need(request['phase']=='publication','PUBLICATION_REQUEST')
    need(set(actions)==set(PHASES),'PUBLICATION_ACTIONS')
    need(set(observer_files)=={'cn-release-publication-observer.py','cn-release-acquire-observer.py'},'OBSERVER_CODE_CLOSURE')
    for h in (*actions.values(),*observer_files.values()):need(re.fullmatch('[a-f0-9]{64}',h),'CODE_SHA')
    for key in ('sourceRevision','controlRevision','requestedAt','deadlineAt'):need(identity[key]==request[key],'PUBLICATION_IDENTITY')
    need(re.fullmatch('[a-f0-9]{40}',request['sourceRevision']) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',request['attemptId']),'FIXED_PATH_IDENTITY')
    record={'kind':'cn-publication-observer-approval-v1','requestSha256':sha(request_raw),'entryIdentity':identity,'actionSha256':actions,'observerFiles':observer_files,'publicationFiles':{n:sha(contents[n]) for n in FILES}}
    return {'approval.json':encode(record),'request.json':request_raw}


def validate_stage(contents,set_raw,inbox,h,c,rv,pub,a):
    """Canonical validation only; never invokes host.run's snapshot/publication path."""
    approval=parse(contents['approval.json']);plan=c.validate_plan(parse(contents['candidate-plan.json']))
    h.validate_approval(approval,plan['sourceRevision'],plan['attemptId'])
    need(approval['candidatePlanRawSha256']==sha(contents['candidate-plan.json']) and approval['candidateSetRawSha256']==sha(set_raw),'STAGE_ORIGINAL_BYTES')
    cap=rv.admit(contents['candidate-revalidation.json'],approval['revalidationRawSha256'],approval['revalidationPolicyRawSha256'],contents['candidate-revalidation-policy.json'])
    images=cap.verify_bundle(inbox,plan,set_raw,sha(set_raw),sha(contents['candidate-plan.json']))['images']
    intent=pub.validate_intent(contents['publication-intent.json'],approval['publicationIntentRawSha256'],plan,set_raw,sha(set_raw),sha(contents['candidate-plan.json']),revalidation=cap)
    a.validate_immutable_evidence(parse(contents['immutable-provider-response.json']),approval['immutableEvidence'])
    return approval,plan,cap,images,intent


def readonly_adapter_type(host,archive,references):
    """No second auth implementation: gate every command of original adapter."""
    class ReadOnly(host.Commands):
        def command(self,argv,stdin=None,accepted=(),timeout=300):
            common=['--region','cn-shanghai','--mode','EcsRamRole','--ram-role-name',host.legacy.ROLE,'--read-timeout','4','--connect-timeout','2','--retry-count','0']
            auth=[host.legacy.ALIYUN,'sts','GetCallerIdentity',*common]
            token=[host.legacy.ALIYUN,'cr','GetAuthorizationToken','--InstanceId',archive.INSTANCE,*common]
            login=(len(argv)==6 and argv[:4]==[self.docker,'login',archive.HOST,'--username'] and argv[5]=='--password-stdin' and stdin is not None)
            inspect=(len(argv)==6 and argv[:5]==[self.docker,'buildx','imagetools','inspect','--raw'] and argv[5] in references)
            need(argv==auth or argv==token or login or inspect,'OBSERVER_COMMAND_NOT_READ_ONLY')
            need(not accepted,'OBSERVER_NO_ACCEPTED_FAILURE')
            return super().command(argv,stdin=stdin,accepted=(),timeout=min(timeout,30))
    return ReadOnly


def remote_readback(adapter,images,published,intent,archive):
    need(set(published)=={'api','web','agent','sandbox','postgres','redis'},'SIX_PUBLISHED_IMAGES')
    result={}
    for service,item in published.items():
        need(set(item)=={'image'},'PUBLISHED_IMAGE_FIELDS');reference=item['image']
        repository='base-redis' if service=='redis' else archive.REPOSITORIES[service]
        need(re.fullmatch(re.escape(archive.PREFIX+'/'+repository)+'@sha256:[a-f0-9]{64}',reference),'APPROVED_REGISTRY_REFERENCE')
        if service=='redis':need(reference==intent['redisImage'],'REDIS_INTENT_DIGEST')
        adapter.check_validity()
        raw=adapter.command([adapter.docker,'buildx','imagetools','inspect','--raw',reference],timeout=30)
        need(type(raw)is bytes and sha(raw)==reference.split('@sha256:')[1],'REMOTE_MANIFEST_DIGEST')
        manifest=parse(raw)
        need(manifest.get('schemaVersion')==2 and manifest.get('mediaType') in ('application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json'),'REMOTE_SINGLE_PLATFORM_REQUIRED')
        config=manifest.get('config',{}).get('digest');need(isinstance(config,str) and re.fullmatch('sha256:[a-f0-9]{64}',config),'REMOTE_CONFIG_DIGEST')
        if service!='redis':need(config==images[service]['imageId'],'REMOTE_CONFIG_MISMATCH')
        result[service]={'reference':reference,'rawManifestSha256':sha(raw),'configDigest':config}
    return result


def published_binding(receipt,manifest_raw,seal_raw,approval_raw,plan,images,intent):
    need(receipt['receiptKind']=='cn-candidate-published-v2','PUBLISHED_RECEIPT_KIND')
    for key in ('sourceRevision','controlRevision','attemptId'):need(receipt[key]==plan[key],'PUBLISHED_IDENTITY')
    approval=parse(approval_raw)
    for key in ('candidatePlanRawSha256','candidateSetRawSha256','publicationIntentRawSha256','revalidationRawSha256'):need(receipt[key]==approval[key],'PUBLISHED_INPUT_BINDING')
    need(receipt['hostApprovalRawSha256']==sha(approval_raw) and receipt['manifestSha256']==sha(manifest_raw) and receipt['sealSha256']==sha(seal_raw),'PUBLISHED_FILE_BINDING')
    need(receipt['release']==intent['release'] and receipt['redisImage']==intent['redisImage'],'PUBLISHED_INTENT')
    need(receipt['runtimeHostIdentity']['ecsInstanceId']=='i-uf6ga92ewloganobbln6' and receipt['runtimeHostIdentity']['region']=='cn-shanghai','PUBLISHED_HOST')


def observe(request_sha,phase):
    need(re.fullmatch('[a-f0-9]{64}',request_sha) and phase in PHASES,'FIXED_OBSERVER_ARGUMENTS');reader=o.Reader();lock=None
    try:
        record=parse(reader.read(APPROVALS/request_sha/'approval.json',o.MAX));request_raw=reader.read(APPROVALS/request_sha/'request.json',o.MAX,request_sha);request=parse(request_raw)
        need(record['kind']=='cn-publication-observer-approval-v1' and record['requestSha256']==request_sha,'OBSERVER_APPROVAL')
        for name,digest in record['observerFiles'].items():
            need(name in ('cn-release-publication-observer.py','cn-release-acquire-observer.py'),'OBSERVER_CODE_NAME');reader.read(SELF.parent/name,o.MAX,digest,mode=(0o600,0o700))
        need(set(record['observerFiles'])=={'cn-release-publication-observer.py','cn-release-acquire-observer.py'},'OBSERVER_CODE_CLOSURE')
        source=request['sourceRevision'];attempt=request['attemptId'];need(re.fullmatch('[a-f0-9]{40}',source) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',attempt),'FIXED_PATH_IDENTITY')
        directory=STAGE/source/attempt;inbox=INBOX/source/attempt
        contents={n:reader.read(directory/n,o.MAX,record['publicationFiles'][n]) for n in FILES}
        need(parse(bundle(request_raw,contents,record['entryIdentity'],record['actionSha256'],record['observerFiles'])['approval.json'])==record,'OBSERVER_RECORD_BINDING')
        approval=parse(contents['approval.json'])
        for name,digest in approval['installedToolSha256'].items():
            need(re.fullmatch(r'[a-zA-Z0-9_-]+\.py',name),'HOST_CODE_NAME');reader.read(TOOLS/name,2*o.MAX,digest,mode=(0o600,0o700))
        # Same root-owned code closure the canonical importer loads. No ambient SDK.
        for name in ('canonical_control','cn_image_archive','cn_image_candidate','cn_candidate_revalidation','cn_candidate_host','cn_candidate_publication'):sys.modules.pop(name,None)
        sys.path.insert(0,str(TOOLS))
        import cn_candidate_host as h,cn_image_candidate as c,cn_candidate_revalidation as rv,cn_candidate_publication as pub,cn_image_archive as a,canonical_control as canonical
        parent=o.directory(o.STATE/'runtime')
        try:lock=os.open('release.lock',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        finally:os.close(parent)
        st=os.fstat(lock);need(stat.S_ISREG(st.st_mode) and st.st_uid==st.st_gid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600,'RELEASE_LOCK')
        fcntl.flock(lock,fcntl.LOCK_SH|fcntl.LOCK_NB)
        set_raw=reader.read(inbox/'candidate-set.json',256*1024,approval['candidateSetRawSha256'])
        for service,item in parse(set_raw)['images'].items():
            need(service in a.REPOSITORIES and item['file']==service+'.tar','INBOX_SERVICE');reader.read(inbox/(service+'.tar'),item['size'],item['sha256'],keep=False)
        approval,plan,cap,images,intent=validate_stage(contents,set_raw,inbox,h,c,rv,pub,a)
        canonical_path=h.admit_canonical(directory,approval)
        canonical_config=parse(reader.read(canonical_path,256*1024,approval['canonicalConfigurationSha256']))
        reader.read(canonical_config['nodeExecutable'],128*1024**2,canonical_config['nodeSha256'],keep=False,mode=0o700)
        for name,digest in canonical_config['fileSha256'].items():
            reader.read(Path(canonical_config['checkoutDirectory'])/name,64*1024**2,digest,keep=False)
        for binary in approval['binaries'].values():reader.read(binary['path'],256*1024**2,binary['sha256'],keep=False,mode=0o755)
        now=dt.datetime.now(dt.timezone.utc);remaining=int((o.stamp(request['deadlineAt'])-now).total_seconds());need(remaining>0,'OBSERVATION_DEADLINE')
        result={'kind':'cn-publication-readonly-observation-v1','requestSha256':request_sha,'phase':phase,'entryIdentity':record['entryIdentity'],'actionSha256':record['actionSha256'][phase],'publicationFiles':record['publicationFiles'],'candidateSetSha256':sha(set_raw),'images':images,'canonicalConfigurationSha256':approval['canonicalConfigurationSha256'],'productionWrites':False}
        if phase=='publish':
            folder=PUBLISHED/source/attempt
            manifest=reader.read(folder/'release.json',256*1024);seal=reader.read(folder/'release.sealed.json',256*1024);receipt_raw=reader.read(folder/'published.json',256*1024);receipt=parse(receipt_raw)
            published_binding(receipt,manifest,seal,contents['approval.json'],plan,images,intent)
            # Private scratch is scoped to this invocation; original adapters alone
            # acquire temporary credentials. No credentials enter output or argv.
            os.umask(0o077)
            with tempfile.TemporaryDirectory(prefix='cn-publication-readback-') as tmp:
                refs={x['image'] for x in receipt['images'].values()}
                adapter=readonly_adapter_type(h,a,refs)(approval,a,canonical,canonical_path,Path(tmp));adapter.archive_expiry=cap.expires_at;adapter.deadline=time.monotonic()+min(120,remaining)
                adapter.authenticate()
                result['remoteReadback']=remote_readback(adapter,images,receipt['images'],intent,a)
                with canonical.canonical_snapshot(canonical_path,approval['canonicalConfigurationSha256']) as snapshot:
                    argv=[snapshot['nodeExecutable'],'--import',str(Path(snapshot['directory'])/'node_modules/tsx/dist/loader.mjs'),str(Path(snapshot['directory'])/'packages/cloud-deploy/src/release-candidate-cli.ts'),'validate',str(folder/'release.json'),str(folder/'release.sealed.json'),source]
                    done=subprocess.run(argv,env=canonical.canonical_environment({'PATH':'/usr/bin:/bin','HOME':tmp,'TSX_DISABLE_CACHE':'1'}),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=max(1,min(30,int(adapter.deadline-time.monotonic()))))
                    need(done.returncode==0,'CANONICAL_SEAL_REJECTED')
                result['publishedReceiptSha256']=sha(receipt_raw);result['manifestSha256']=sha(manifest);result['sealSha256']=sha(seal)
        reader.stable();need(o.signature(os.fstat(lock))==o.signature((o.STATE/'runtime/release.lock').lstat()),'RELEASE_LOCK_CHANGED');need(dt.datetime.now(dt.timezone.utc)<o.stamp(request['deadlineAt']),'OBSERVATION_AFTER_DEADLINE');raw=encode(result);need(len(raw)<=65536,'OBSERVER_OUTPUT_LIMIT');return raw
    finally:
        if lock is not None:os.close(lock)
        reader.close()


def verify(raw,manifest,previous,mode,request_sha):
    phase=manifest['stage'];need(phase in PHASES and manifest['scope']=='runtime-only-reviewed-continuation','PUBLICATION_STAGE_SCOPE')
    observed_raw=observe(request_sha,phase);v=parse(observed_raw)
    need(manifest['actionSha256']==v['actionSha256'],'UNKNOWN_PUBLICATION_ACTION')
    for key,value in v['entryIdentity'].items():need(manifest[key]==value,'PUBLICATION_ENTRY_IDENTITY')
    if mode in ('terminal','reconcile'):
        need(raw==observed_raw,'PUBLICATION_OBSERVATION_CHANGED')
        return {'externalWritesTerminal':True} if mode=='terminal' else True
    need(mode=='advance','UNSUPPORTED_PUBLICATION_VERIFY')
    if phase=='check-plan':return raw==CHECK_MARKER
    if phase=='publication-stage':
        value=parse(raw);return value.get('ok') is True and value.get('staged')==6 and value.get('approvalSha256')==v['publicationFiles']['approval.json'] and value.get('publisherCalled') is False and value.get('canonicalModified') is False
    prefix=b'CN_CANDIDATE_PUBLISHED=';need(raw.startswith(prefix),'PUBLISH_STDOUT_PREFIX')
    # Original canonical json_bytes output is followed by print's extra newline.
    need(raw.endswith(b'\n\n') and not raw.endswith(b'\n\n\n'),'PUBLISH_STDOUT_SHAPE')
    return sha(raw[len(prefix):-1])==v['publishedReceiptSha256']


def main():
    need(len(sys.argv)==3,'ONLY_REQUEST_SHA_AND_FIXED_PHASE');sys.stdout.buffer.write(observe(sys.argv[1],sys.argv[2]))

if __name__=='__main__':main()
