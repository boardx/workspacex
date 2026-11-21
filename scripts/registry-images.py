#!/usr/bin/env python3
"""GitHub-hosted ACR producer; shares Dockerfiles with the existing CN producer."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time

spec = importlib.util.spec_from_file_location('hosted_release', Path(__file__).with_name('hosted-release.py'))
hosted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)
SERVICES = hosted.SERVICES
SHA = re.compile(r'[a-f0-9]{40}')
TAG = re.compile(r'(?:[a-f0-9]{40}-)?[1-9][0-9]*-[1-9][0-9]*')
LEGACY_TAG = re.compile(r'[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*')
# Numeric-only namespace remains compatible with installed short/legacy-tag
# consumers. It restricts this producer/plan; it is not signed flavor evidence.
AIDT_ATTEMPT_PREFIX = '9000000000000000000'
PREFIX = re.compile(r'[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9]+(?:[._-][a-z0-9]+)*')
MAX_BUILD_METADATA_BYTES = 2*1024*1024
API_AIDT_FLAGS = ('ENABLE_AIDT_MODULE','ENABLE_PROJECT_MEMBER_CHAT')
# Reviewed, complete release input. This mode activates configuration of this
# application source, rather than claiming to rebuild it from the control SHA.
ACTIVATION_PARENT_SHA256 = 'e2422ce0260fa39101bd5464e975baadd4992e3e7991e4c83801faba7fc3412b'
ACTIVATION_PARENT_PATH = Path(__file__).resolve().parents[1]/'docs/evidence/aidt-native/registry-diagnostics-20261117/activation-parent-release.json'

def need(ok, code):
    if not ok: raise ValueError(code)

def coordinates(prefix, tag):
    need(isinstance(prefix,str) and PREFIX.fullmatch(prefix), 'INVALID_REGISTRY_PREFIX')
    need(isinstance(tag,str) and TAG.fullmatch(tag), 'INVALID_RELEASE_TAG')
    return prefix, tag

def is_aidt_tag(tag):
    return bool(isinstance(tag,str) and TAG.fullmatch(tag) and tag.rsplit('-',1)[-1].startswith(AIDT_ATTEMPT_PREFIX))

def release_tag(source, run, attempt, enable_aidt=False):
    need(SHA.fullmatch(source) and re.fullmatch('[1-9][0-9]*',run) and re.fullmatch('[1-9][0-9]*',attempt), 'INVALID_BUILD_IDENTITY')
    need(not attempt.startswith(AIDT_ATTEMPT_PREFIX),'RESERVED_AIDT_ATTEMPT')
    return run+'-'+attempt

def select_build_services(selection, build_only, existing_tag):
    if selection.strip() == 'all':
        return list(SERVICES)
    requested = [item.strip() for item in selection.split(',')]
    need(all(item in SERVICES for item in requested), 'INVALID_BUILD_SERVICE')
    need(len(requested) == len(set(requested)), 'DUPLICATE_BUILD_SERVICE')
    need(not existing_tag, 'BUILD_SERVICE_WITH_EXISTING_TAG')
    need(build_only or len(requested) == len(SERVICES), 'PARTIAL_BUILD_REQUIRES_BUILD_ONLY')
    return [role for role in SERVICES if role in requested]


def changed_build_services(baseline, source):
    need(SHA.fullmatch(baseline), 'INVALID_BUILD_BASELINE')
    # Compare complete trees so merges, deletions and non-linear history work.
    changed = run(['git', 'diff', '--no-renames', '--name-only', '-z', baseline, source, '--']).split('\0')
    changed = {path for path in changed if path}
    shared = ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
              'patches', 'packages', 'shared', 'skills/localizations', '.dockerignore')
    inputs = {
        'web': (*shared, 'apps/web', 'skills/aidt-methods-candidates', 'tests/fixtures/cn-six-business'),
        'api': (*shared, 'apps/api', 'apps/local-asr-gateway', 'apps/skill-sandbox',
                'apps/deep-agent-service/langgraph.json', 'skills/starter-packs',
                'requirements/work-stack-v2/workflows', 'deploy/aliyun/images/api.tsconfig.json'),
    }

    def touches(path, roots):
        return any(path == root or path.startswith(root + '/') for root in roots)

    if any(touches(path, ('scripts/registry-images.py', 'scripts/hosted-release.py',
                          '.github/workflows/image-release.yml')) for path in changed):
        return list(SERVICES)
    return [
        role for role, (_, dockerfile, context, _) in SERVICES.items()
        if any(touches(path, (*inputs.get(role, (context,)), dockerfile, dockerfile + '.dockerignore'))
               for path in changed)
    ]


def build_source(default, override, build_only):
    need(isinstance(default,str) and SHA.fullmatch(default), 'INVALID_BUILD_SOURCE')
    need(isinstance(override,str) and (not override or SHA.fullmatch(override)), 'INVALID_BUILD_SOURCE')
    need(not override or build_only is True, 'SOURCE_OVERRIDE_REQUIRES_BUILD_ONLY')
    return override or default

def aidt_plan_flag(value, target, existing_tag):
    # All new releases include AIDT. Existing immutable images retain their bytes.
    return '1'


def aidt_web_build_args(role):
    release=os.environ.get('AIDT_RELEASE_ENABLED','0')
    need(release in ('0','1'),'INVALID_AIDT_BUILD_FLAG')
    names=('NEXT_PUBLIC_ENABLE_AIDT','NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT')
    values=[os.environ.get(name,'0') for name in names]
    need(all(value in ('0','1') for value in values),'INVALID_AIDT_BUILD_FLAG')
    need(values[0]==values[1],'AIDT_BUILD_FLAGS_MISMATCH')
    need(values[0]=='0' or role=='web','AIDT_WEB_BUILD_ONLY')
    need(role!='web' or values[0]==release,'AIDT_BUILD_FLAGS_MISMATCH')
    if role=='api':
        # API defaults follow the admitted release flavor, never host runtime env.
        return [arg for name in API_AIDT_FLAGS for arg in ('--build-arg',name+'='+release)]
    return [arg for name,value in zip(names,values) for arg in ('--build-arg',name+'='+value)] if role=='web' else []

def safe_diagnostics(raw):
    for key,value in os.environ.items():
        if value and len(value)>=4 and (re.search(r'TOKEN|PASSWORD|SECRET|ACCESS_KEY',key) or key=='ACR_USERNAME'):
            raw=raw.replace(value,'[redacted]')
    raw=re.sub(r'(https?://)[^/\s]*@',r'\1[redacted]@',raw,flags=re.I)
    raw=re.sub(r'(?i)(authorization:\s*(?:bearer|basic)\s+)\S+',r'\1[redacted]',raw)
    # Registry exporters can return signed URLs with vendor-specific query keys.
    # Preserve the endpoint/path, but never relay any URL's query string.
    raw=re.sub(r'https?://[^\s<>"\']+',lambda m:m[0].split('?',1)[0]+'?[redacted]' if '?' in m[0] else m[0],raw,flags=re.I)
    raw=re.sub(r'(?i)([?&](?:token|password|secret|access[_-]?key|_state|signature|accesskeyid)=)[^&\s]+',r'\1[redacted]',raw)
    return '\n'.join(raw.splitlines()[-100:])[-12000:]

def registry_login(registry, username, password):
    """Retry transport failures only; credentials remain on stdin, diagnostics redacted."""
    for attempt in range(3):
        try:
            result=subprocess.run(['docker','login',registry,'--username',username,'--password-stdin'],
                                  input=password,text=True,capture_output=True,timeout=60)
            if result.returncode==0: return
            raw=result.stdout+'\n'+result.stderr
        except subprocess.TimeoutExpired:
            raw='ACR login timeout after 60 seconds'
        permanent=re.search(r'unauthorized|authentication required|denied|incorrect.*password|invalid.*credential|\b40[13]\b',raw,re.I)
        transient=re.search(r'timeout|timed out|connection reset|connection refused|unexpected EOF|\bEOF\b|temporary failure|too many requests|\b(?:429|500|502|503|504)\b|service unavailable',raw,re.I)
        print('ACR login attempt '+str(attempt+1)+'/3 failed: '+safe_diagnostics(raw.replace(username,'[redacted]').replace(password,'[redacted]')),file=sys.stderr)
        if permanent or not transient or attempt==2:
            raise ValueError('ACR_LOGIN_FAILED')
        time.sleep((2,5)[attempt])


def run(args, timeout=3600, retry_transient=False):
    if retry_transient:
        position=3 if len(args)>2 and args[1]=='--config' else 1
        need(len(args)>position and args[position]=='pull','RETRY_REQUIRES_PULL')
    attempts=3 if retry_transient else 1
    for attempt in range(attempts):
        result=subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        if result.returncode==0: return result.stdout
        raw=result.stdout+'\n'+result.stderr
        transient=re.search(r'connection reset by peer|TLS handshake timeout|i/o timeout|unexpected EOF|context deadline exceeded|connection timed out',raw,re.I)
        permanent=re.search(r'unauthorized:|denied:|manifest unknown|not found',raw,re.I)
        if not transient or permanent or attempt+1==attempts:
            print(safe_diagnostics(raw),file=sys.stderr)
            raise ValueError('COMMAND_FAILED_'+Path(args[0]).name.upper())
        print('Transient registry pull transport failure; retry '+str(attempt+2)+'/'+str(attempts),file=sys.stderr)
        time.sleep((2,5)[attempt])

def resolve(docker, prefix, tag, role, pull=True, expected_source=None, expected_api_flags=None):
    coordinates(prefix,tag)
    need(role in SERVICES,'INVALID_SERVICE')
    repository=prefix+'/'+SERVICES[role][0]
    reference=repository+':'+tag
    command=[docker] if isinstance(docker,str) else list(docker)
    if pull: run(command+['pull','--platform','linux/amd64',reference],retry_transient=True)
    values=json.loads(run(command+['image','inspect',reference]))
    need(len(values)==1,'IMAGE_INSPECT')
    value=values[0]
    need(value['Os']=='linux' and value['Architecture']=='amd64','IMAGE_PLATFORM')
    if expected_api_flags is not None:
        need(role=='api' and expected_api_flags in ('0','1'),'INVALID_API_FLAG_EXPECTATION')
        config=value.get('Config')
        need(type(config) is dict,'API_IMAGE_FLAGS_MISMATCH')
        environment=config.get('Env')
        environment=[] if environment is None else environment
        need(type(environment) is list and all(type(entry) is str for entry in environment),'API_IMAGE_FLAGS_MISMATCH')
        for name in API_AIDT_FLAGS:
            matches=[entry for entry in environment if entry.partition('=')[0]==name]
            need(matches==[name+'='+expected_api_flags] or expected_api_flags=='0' and not matches,
                 'API_IMAGE_FLAGS_MISMATCH')
    labels=value.get('Config',{}).get('Labels',{}) or {}
    source=labels.get('org.opencontainers.image.revision','')
    need(isinstance(source,str) and SHA.fullmatch(source),'IMAGE_SOURCE_MISMATCH')
    if expected_source is not None:
        # Fresh producer results must carry both exact labels; historical alias
        # compatibility remains available only to existing non-producer callers.
        need(source==expected_source,'IMAGE_SOURCE_MISMATCH')
        need(labels.get('io.boardx.workspacex.release-tag')==tag,'IMAGE_BUILD_IDENTITY')
    if LEGACY_TAG.fullmatch(tag):
        need(source==tag[:40],'IMAGE_SOURCE_MISMATCH')
    elif 'io.boardx.workspacex.release-tag' in labels:
        need(labels['io.boardx.workspacex.release-tag']==tag,'IMAGE_BUILD_IDENTITY')
    else:
        # Historical images may acquire a short alias only for the identical
        # immutable legacy image; never infer a source revision from a short tag.
        legacy=resolve(docker,prefix,source+'-'+tag,role,pull)
        need(legacy['imageId']==value['Id'] and legacy['image'] in value.get('RepoDigests',[]),'ALIAS_IDENTITY')
    need(re.fullmatch(r'sha256:[a-f0-9]{64}',value['Id']),'IMAGE_ID')
    digests=[v for v in value.get('RepoDigests',[]) if re.fullmatch(re.escape(repository)+r'@sha256:[a-f0-9]{64}',v)]
    need(len(set(digests))==1,'IMAGE_DIGEST')
    return {'service':role,'sourceRevision':source,'tag':tag,'image':digests[0],'imageId':value['Id']}

def run_release_stage(role, stage, args, timeout):
    started=time.monotonic()
    print(f'IMAGE_RELEASE_STAGE service={role} stage={stage} status=started timeout_seconds={timeout}', flush=True)
    # A file lets subprocess.run keep its timeout/process ownership while a reader
    # publishes complete, redacted lines immediately instead of buffering the job.
    with tempfile.TemporaryFile() as output:
        stop=threading.Event()
        def follow():
            offset=0; pending=b''; discarding=False; heartbeat=time.monotonic()
            while True:
                chunk=os.pread(output.fileno(),65536,offset)
                if chunk:
                    offset+=len(chunk); pending+=chunk
                    while b'\n' in pending:
                        line,pending=pending.split(b'\n',1)
                        if discarding: discarding=False
                        else: print(safe_diagnostics(line.decode(errors='replace')),flush=True)
                    if len(pending)>65536:
                        pending=b''; discarding=True
                        print('IMAGE_RELEASE_LOG oversized line omitted',flush=True)
                now=time.monotonic()
                if now-heartbeat>=15:
                    print(f'IMAGE_RELEASE_STAGE service={role} stage={stage} status=running elapsed_seconds={int(now-started)}',flush=True)
                    heartbeat=now
                if stop.is_set() and not chunk:
                    if pending and not discarding: print(safe_diagnostics(pending.decode(errors='replace')),flush=True)
                    break
                if not chunk: stop.wait(.1)
        reader=threading.Thread(target=follow,daemon=True);reader.start()
        try:
            result=subprocess.run(args,stdout=output,stderr=subprocess.STDOUT,timeout=timeout,text=True)
        except subprocess.TimeoutExpired:
            print(f'IMAGE_RELEASE_STAGE service={role} stage={stage} status=failed code=timeout elapsed_seconds={int(time.monotonic()-started)}',flush=True)
            raise ValueError(f'{stage.upper()}_TIMEOUT_{role.upper()}') from None
        finally:
            stop.set();reader.join()
        # CompletedProcess.stdout is populated by command-port test doubles only.
        if result.stdout: print(safe_diagnostics(result.stdout),flush=True)
        if result.stderr: print(safe_diagnostics(result.stderr),file=sys.stderr,flush=True)
        state='completed' if result.returncode==0 else 'failed'
        print(f'IMAGE_RELEASE_STAGE service={role} stage={stage} status={state} elapsed_seconds={int(time.monotonic()-started)}',flush=True)
        need(result.returncode==0,'COMMAND_FAILED_'+Path(args[0]).name.upper())
        output.seek(max(0,output.seek(0,os.SEEK_END)-65536))
        return result.stdout or output.read().decode(errors='replace')


def buildkit_identity(path):
    """Read only the bounded identity fields, never publish exporter metadata."""
    try:
        need(not path.is_symlink() and path.is_file(), 'BUILD_METADATA_INVALID')
        with path.open('rb') as stream:
            raw=stream.read(MAX_BUILD_METADATA_BYTES+1)
        need(0<len(raw)<=MAX_BUILD_METADATA_BYTES, 'BUILD_METADATA_INVALID')
        value=json.loads(raw)
        need(type(value) is dict, 'BUILD_METADATA_INVALID')
        config=value.get('containerimage.config.digest')
        manifest=value.get('containerimage.digest')
        need(type(config) is str and re.fullmatch(r'sha256:[a-f0-9]{64}',config) and
             type(manifest) is str and re.fullmatch(r'sha256:[a-f0-9]{64}',manifest), 'BUILD_METADATA_INVALID')
        return config,manifest
    except (OSError,ValueError,TypeError):
        raise ValueError('BUILD_METADATA_INVALID') from None


def activation_selected():
    value=os.environ.get('AIDT_CONFIG_ACTIVATION','0')
    need(value in ('0','1'),'INVALID_ACTIVATION_FLAG')
    return value=='1'


def activation_parent(prefix, source, tag, target, enabled, build_only, selected, existing=''):
    """Admit only the pinned five-image DevApp configuration activation."""
    need(target=='devapp' and enabled=='1','ACTIVATION_REQUIRES_AIDT_DEVAPP')
    need(build_only is True and selected=='all' and not existing,'ACTIVATION_REQUIRES_NEW_FULL_BUILD_ONLY')
    need(os.environ.get('SOURCE_OVERRIDE')==source and os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch','ACTIVATION_REQUIRES_EXPLICIT_SOURCE_DISPATCH')
    need(not os.environ.get('ACTIVATION_PARENT_MANIFEST') and not os.environ.get('ACTIVATION_PARENT_SHA256'),'ACTIVATION_PARENT_OVERRIDE_FORBIDDEN')
    coordinates(prefix,tag)
    need(is_aidt_tag(tag),'ACTIVATION_REQUIRES_AIDT_TAG')
    need(tag==os.environ['GITHUB_RUN_ID']+'-'+AIDT_ATTEMPT_PREFIX+os.environ['GITHUB_RUN_ATTEMPT'],'RERUN_ALL_JOBS_REQUIRED')
    try:
        path=ACTIVATION_PARENT_PATH
        need(not path.is_symlink() and path.is_file(),'ACTIVATION_PARENT_INVALID')
        with path.open('rb') as stream: raw=stream.read(MAX_BUILD_METADATA_BYTES+1)
        need(0<len(raw)<=MAX_BUILD_METADATA_BYTES and hashlib.sha256(raw).hexdigest()==ACTIVATION_PARENT_SHA256,'ACTIVATION_PARENT_INVALID')
        parent=json.loads(raw)
        need(type(parent) is dict and set(parent)=={'kind','sourceRevision','tag','platform','images'},'ACTIVATION_PARENT_INVALID')
        need(parent['kind']=='registry-images-v1' and parent['platform']=='linux/amd64' and parent['sourceRevision']==source,'ACTIVATION_PARENT_INVALID')
        parent_tag=parent['tag']
        coordinates(prefix,parent_tag)
        need(parent_tag!=tag and is_aidt_tag(parent_tag),'ACTIVATION_PARENT_INVALID')
        need(type(parent['images']) is dict and set(parent['images'])==set(SERVICES),'ACTIVATION_PARENT_INVALID')
        for role,row in parent['images'].items():
            need(type(row) is dict and set(row)=={'service','sourceRevision','tag','image','imageId'},'ACTIVATION_PARENT_INVALID')
            need(row['service']==role and row['sourceRevision']==source and row['tag']==parent_tag,'ACTIVATION_PARENT_INVALID')
            need(type(row['image']) is str and re.fullmatch(re.escape(prefix+'/'+SERVICES[role][0])+r'@sha256:[a-f0-9]{64}',row['image']),'ACTIVATION_PARENT_INVALID')
            need(type(row['imageId']) is str and re.fullmatch(r'sha256:[a-f0-9]{64}',row['imageId']),'ACTIVATION_PARENT_INVALID')
        return parent
    except (OSError,ValueError,TypeError,KeyError):
        raise ValueError('ACTIVATION_PARENT_INVALID') from None


def activation_json(args):
    raw=run(args,timeout=60)
    need(len(raw.encode())<=MAX_BUILD_METADATA_BYTES,'ACTIVATION_READBACK_INVALID')
    try: return json.loads(raw)
    except (ValueError,TypeError): raise ValueError('ACTIVATION_READBACK_INVALID') from None


def activation_snapshot(reference, source, tag, config_digest):
    values=activation_json(['docker','image','inspect',reference])
    need(type(values) is list and len(values)==1 and type(values[0]) is dict,'ACTIVATION_READBACK_INVALID')
    value=values[0]
    need(value.get('Id')==config_digest and value.get('Os')=='linux' and value.get('Architecture')=='amd64','ACTIVATION_READBACK_INVALID')
    need(type(value.get('RepoDigests')) is list and reference in value['RepoDigests'],'ACTIVATION_READBACK_INVALID')
    config=value.get('Config');rootfs=value.get('RootFS')
    need(type(config) is dict and type(config.get('Labels')) is dict,'ACTIVATION_READBACK_INVALID')
    need(config['Labels'].get('org.opencontainers.image.revision')==source and config['Labels'].get('io.boardx.workspacex.release-tag')==tag,'ACTIVATION_READBACK_INVALID')
    need(type(rootfs) is dict and rootfs.get('Type')=='layers' and type(rootfs.get('Layers')) is list,'ACTIVATION_READBACK_INVALID')
    need(all(type(v) is str and re.fullmatch(r'sha256:[a-f0-9]{64}',v) for v in rootfs['Layers']),'ACTIVATION_READBACK_INVALID')
    manifest=activation_json(['docker','manifest','inspect',reference])
    need(type(manifest) is dict and manifest.get('schemaVersion')==2 and manifest.get('mediaType') in (
        'application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json'),'ACTIVATION_READBACK_INVALID')
    descriptor=manifest.get('config')
    need(type(descriptor) is dict and descriptor.get('digest')==config_digest and type(descriptor.get('size')) is int and descriptor['size']>0 and
         descriptor.get('mediaType') in ('application/vnd.docker.container.image.v1+json','application/vnd.oci.image.config.v1+json'),'ACTIVATION_READBACK_INVALID')
    layers=manifest.get('layers')
    need(type(layers) is list and len(layers)<=1000,'ACTIVATION_READBACK_INVALID')
    for layer in layers:
        need(type(layer) is dict and set(layer)=={'mediaType','size','digest'} and
             layer['mediaType'] in ('application/vnd.docker.image.rootfs.diff.tar.gzip','application/vnd.oci.image.layer.v1.tar+gzip','application/vnd.oci.image.layer.v1.tar','application/vnd.oci.image.layer.v1.tar+zstd') and
             type(layer['size']) is int and layer['size']>=0 and type(layer['digest']) is str and re.fullmatch(r'sha256:[a-f0-9]{64}',layer['digest']),'ACTIVATION_READBACK_INVALID')
    need(len(rootfs['Layers'])==len(layers),'ACTIVATION_READBACK_INVALID')
    return config,rootfs,layers


def verify_activation(role, before, row):
    # Child was freshly pulled by resolve; bind the comparison to its digest.
    child=activation_snapshot(row['image'],row['sourceRevision'],row['tag'],row['imageId'])
    need(before[1:]==child[1:],'ACTIVATION_FILESYSTEM_CHANGED')
    before_config=dict(before[0]);child_config=dict(child[0])
    before_labels=dict(before_config.pop('Labels'));child_labels=dict(child_config.pop('Labels'))
    before_labels.pop('io.boardx.workspacex.release-tag');child_labels.pop('io.boardx.workspacex.release-tag')
    need(before_labels==child_labels,'ACTIVATION_CONFIG_CHANGED')
    if role=='api':
        for config in (before_config,child_config):
            env=config.get('Env')
            need(type(env) is list and all(type(entry) is str for entry in env),'ACTIVATION_CONFIG_CHANGED')
        for name in API_AIDT_FLAGS:
            need([entry for entry in child_config['Env'] if entry.partition('=')[0]==name]==[name+'=1'],'ACTIVATION_CONFIG_CHANGED')
        for config in (before_config,child_config):
            config['Env']=[entry for entry in config['Env'] if entry.partition('=')[0] not in API_AIDT_FLAGS]
    need(before_config==child_config,'ACTIVATION_CONFIG_CHANGED')


def build_activation(role,prefix,tag,output,source,parent):
    repository=prefix+'/'+SERVICES[role][0]
    probe=subprocess.run(['docker','manifest','inspect',repository+':'+tag],capture_output=True,text=True,timeout=60)
    need(probe.returncode!=0,'IMMUTABLE_TAG_ALREADY_EXISTS')
    need(re.search(r'manifest unknown|no such manifest|MANIFEST_UNKNOWN',probe.stderr,re.I) and
         not re.search(r'unauthorized|denied|forbidden|TLS|timeout|connection|certificate',probe.stderr,re.I),'TAG_EXISTENCE_UNVERIFIED')
    previous=parent['images'][role]
    run(['docker','pull','--platform','linux/amd64',previous['image']],retry_transient=True)
    before=activation_snapshot(previous['image'],source,previous['tag'],previous['imageId'])
    # FROM can execute inherited ONBUILD instructions. Refuse them before any
    # child build, even when a trigger could leave no filesystem difference.
    need(before[0].get('OnBuild') in (None,[]),'ACTIVATION_ONBUILD_FORBIDDEN')
    with tempfile.TemporaryDirectory(prefix='registry-activation-') as directory:
        context=Path(directory);dockerfile=context/'Dockerfile';metadata=context/'result.json'
        # All interpolated values have strict coordinate/hash validation. There
        # are no caller-provided Dockerfile instructions, COPY, RUN or build args.
        text='FROM '+parent['images'][role]['image']+'\n'
        text+='LABEL org.opencontainers.image.revision='+source+'\n'
        text+='LABEL io.boardx.workspacex.release-tag='+tag+'\n'
        if role=='api': text+='ENV ENABLE_AIDT_MODULE=1 ENABLE_PROJECT_MEMBER_CHAT=1\n'
        dockerfile.write_text(text)
        fd=os.open(metadata,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
        args=['docker','buildx','build','--output=type=registry,oci-mediatypes=false','--provenance=false','--network=none','--platform','linux/amd64',
              '--file',str(dockerfile),'--tag',repository+':'+tag,'--metadata-file',str(metadata),'--progress=plain',str(context)]
        run_release_stage(role,'build',args,3120)
        config_digest,manifest_digest=buildkit_identity(metadata)
        row=publication_row(role,prefix,tag,source,config_digest,manifest_digest,True)
        verify_activation(role,before,row)
        write(output,row)


def vpc_registry(registry):
    name, separator, domain = registry.partition('.')
    need(separator and name.endswith('-registry') and domain.endswith('.cr.aliyuncs.com'),
         'INVALID_ACR_VPC_REGISTRY')
    return name+'-vpc.'+domain


def build(role, prefix, tag, output, source):
    coordinates(prefix,tag)
    need(role in SERVICES,'INVALID_SERVICE')
    need(isinstance(source,str) and SHA.fullmatch(source),'INVALID_SOURCE_REVISION')
    module_args=aidt_web_build_args(role)
    enabled=os.environ.get('AIDT_RELEASE_ENABLED','0')=='1'
    activation=activation_selected()
    parent=activation_parent(prefix,source,tag,os.environ.get('TARGET_ENVIRONMENT'), '1' if enabled else '0',
                             os.environ.get('BUILD_ONLY')=='true',os.environ.get('BUILD_SERVICE') or 'all',os.environ.get('EXISTING_TAG','')) if activation else None
    need(run(['git','rev-parse','HEAD']).strip()==source,'SOURCE_CHECKOUT_MISMATCH')
    if activation:
        build_activation(role,prefix,tag,output,source,parent)
        return
    canonical_prefix=prefix
    use_vpc=os.environ.get('USE_ACR_VPC')=='1'
    if use_vpc:
        registry, namespace=prefix.split('/',1)
        prefix=vpc_registry(registry)+'/'+namespace
    repository,dockerfile,context,bases=SERVICES[role]
    cn=use_vpc or os.environ.get('TARGET_ENVIRONMENT')=='cn'
    reference=prefix+'/'+repository+':'+tag
    exporter='--load' if cn else '--output=type=registry,oci-mediatypes=false'
    args=['docker','buildx','build',exporter,'--provenance=false','--platform','linux/amd64','--file',dockerfile,'--tag',prefix+'/'+repository+':'+tag,
          '--label','org.opencontainers.image.revision='+source,'--label','io.boardx.workspacex.release-tag='+tag,'--build-arg','SOURCE_REVISION='+source]+module_args
    mapping={'node':'NODE_IMAGE','python':'PYTHON_IMAGE','postgres':'PGVECTOR_IMAGE'}
    for base in bases:
        name=mapping[base];value=os.environ.get(name,'')
        need(re.fullmatch(r'[a-z0-9][a-zA-Z0-9.:/_-]*@sha256:[a-f0-9]{64}',value),'MISSING_PINNED_'+name)
        args+=['--build-arg',name+'='+value]
    if role=='agent' and (uv_image:=os.environ.get('UV_IMAGE')):
        need(re.fullmatch(r'[a-z0-9][a-zA-Z0-9.:/_-]*@sha256:[a-f0-9]{64}',uv_image),'INVALID_PINNED_UV_IMAGE')
        args+=['--build-arg','UV_IMAGE='+uv_image]
    # Package mirrors are shared with the existing producer's default contract.
    for name,key in {'NPM_REGISTRY':'npmRegistry','PYPI_INDEX_URL':'pypiIndexUrl','APT_MIRROR':'aptMirror','AGE_REPOSITORY':'ageRepository'}.items():
        value=hosted.DEFAULT_SOURCES[key]
        # The Shanghai Sandbox cold build must use the regional Debian mirror.
        # Keep Dockerfile package pins and APT signature verification unchanged.
        if cn and role=='sandbox' and name=='APT_MIRROR':
            value='https://mirrors.aliyun.com'
        if cn and role in ('agent','sandbox') and name=='PYPI_INDEX_URL':
            value=os.environ.get('WSX_CN_PYPI_INDEX_URL') or value
            need(re.fullmatch(r'https://[a-zA-Z0-9.-]+(?::[0-9]+)?/[a-zA-Z0-9._/-]*',value),'INVALID_CN_PYPI_INDEX')
        args+=['--build-arg',name+'='+value]
    cache_repository=os.environ.get('WSX_CN_AGENT_CACHE_REPOSITORY','')
    if cn and role=='agent' and cache_repository:
        need(re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*',cache_repository),'INVALID_AGENT_CACHE_REPOSITORY')
        cache_ref=prefix+'/'+cache_repository+':buildkit-linux-amd64'
    elif use_vpc and role=='sandbox':
        cache_ref=prefix+'/'+repository+':buildkit-cache-linux-amd64'
    else:
        cache_ref=None
    if cache_ref:
        args+=['--cache-from','type=registry,ref='+cache_ref,
               '--cache-to','type=registry,mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true,ref='+cache_ref]
    run_id, _, planned_attempt = tag.rpartition('-')
    current_attempt = os.environ['GITHUB_RUN_ATTEMPT']
    need(run_id==os.environ['GITHUB_RUN_ID'] and not is_aidt_tag(tag)
         and 0<int(planned_attempt)<=int(current_attempt),'INVALID_PLANNED_BUILD_TAG')
    probe=subprocess.run(['docker','manifest','inspect',prefix+'/'+repository+':'+tag],capture_output=True,text=True,timeout=60)
    if probe.returncode==0:
        need(int(planned_attempt)<int(current_attempt),'IMMUTABLE_TAG_ALREADY_EXISTS')
        api_flags=('1' if enabled else '0') if role=='api' else None
        row=resolve('docker',prefix,tag,role,expected_source=source,expected_api_flags=api_flags)
        row['image']=canonical_prefix+row['image'][len(prefix):]
        write(output,row)
        return
    need(re.search(r'manifest unknown|no such manifest|MANIFEST_UNKNOWN',probe.stderr,re.I),'TAG_EXISTENCE_UNVERIFIED')
    if cn:
        prewarm = role == 'sandbox' and os.environ.get('BUILD_ONLY') == 'true' and os.environ.get('BUILD_SERVICE') == 'sandbox'
        build_timeout = 5400 if prewarm else 2400
        deadline=time.monotonic()+build_timeout+720
        run_release_stage(role,'build',args+['--progress=plain',context],build_timeout)
        config_digest=run(['docker','image','inspect','--format','{{.Id}}',reference],timeout=30).strip()
        need(re.fullmatch(r'sha256:[a-f0-9]{64}',config_digest),'IMAGE_ID')
        remaining=int(deadline-time.monotonic())
        need(remaining>0,f'PUSH_TIMEOUT_{role.upper()}')
        pushed=run_release_stage(role,'push',['docker','push',reference],remaining)
        digests=re.findall(r'^'+re.escape(tag)+r': digest: (sha256:[a-f0-9]{64}) size: [0-9]+\s*$',pushed,re.M)
        need(len(digests)==1,'IMAGE_PUSH_DIGEST')
        verify_publication(role,prefix,tag,output,source,config_digest,digests[0],enabled,canonical_prefix=canonical_prefix)
        return

    with tempfile.TemporaryDirectory(prefix='registry-build-metadata-') as directory:
        metadata=Path(directory)/'result.json'
        fd=os.open(metadata,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        os.close(fd)
        # Bound the single build+registry export to 52 minutes. The existing
        # 60-minute job leaves 480 nominal seconds shared by setup, readback,
        # cleanup and artifacts; this is not a separate readback deadline.
        # No daemon push, fallback or additional upload retry follows it.
        run_release_stage(role, 'build', args+['--metadata-file',str(metadata),'--progress=plain', context], 3120)
        config_digest,manifest_digest=buildkit_identity(metadata)
        verify_publication(role,prefix,tag,output,source,config_digest,manifest_digest,enabled)


def verify_publication(role,prefix,tag,output,source,config_digest,manifest_digest,enabled,canonical_prefix=None):
    row=publication_row(role,prefix,tag,source,config_digest,manifest_digest,enabled)
    if canonical_prefix and canonical_prefix != prefix:
        row['image']=canonical_prefix+row['image'][len(prefix):]
    write(output,row)


def publication_row(role,prefix,tag,source,config_digest,manifest_digest,enabled):
    expected_api_flags=('1' if enabled else '0') if role=='api' else None
    row=resolve('docker',prefix,tag,role,expected_source=source,expected_api_flags=expected_api_flags)
    repository=SERVICES[role][0]
    need(row['imageId']==config_digest,'IMAGE_CONFIG_MISMATCH')
    need(row['image']==prefix+'/'+repository+'@'+manifest_digest,'IMAGE_MANIFEST_MISMATCH')
    return row


def aggregate(directory, source, tag, prefix):
    coordinates(prefix,tag)
    need(isinstance(source,str) and SHA.fullmatch(source),'INVALID_SOURCE_REVISION')
    need(not LEGACY_TAG.fullmatch(tag) or source==tag[:40],'SOURCE_TAG_MISMATCH')
    files=list(directory.glob('*.json'));need(len(files)==len(SERVICES),'INCOMPLETE_IMAGE_SET')
    images={}
    for path in files:
        row=json.loads(path.read_text());role=row['service']
        need(role in SERVICES and role not in images,'INVALID_SERVICE_SET')
        need(row['sourceRevision']==source and row['tag']==tag,'MIXED_BUILD_IDENTITY')
        need(re.fullmatch(re.escape(prefix+'/'+SERVICES[role][0])+r'@sha256:[a-f0-9]{64}',row['image']),'INVALID_IMAGE_DIGEST')
        need(re.fullmatch(r'sha256:[a-f0-9]{64}',row['imageId']),'INVALID_IMAGE_ID')
        images[role]=row
    need(set(images)==set(SERVICES),'INCOMPLETE_IMAGE_SET')
    return {'kind':'registry-images-v1','sourceRevision':source,'tag':tag,'platform':'linux/amd64','images':images}

def resolve_bases():
    sources={'NODE_IMAGE':('apps/skill-sandbox/Dockerfile','NODE_IMAGE'),
             'PYTHON_IMAGE':('apps/deep-agent-service/Dockerfile','PYTHON_IMAGE'),
             'PGVECTOR_IMAGE':('apps/api/docker/postgres-age/Dockerfile','PGVECTOR_IMAGE')}
    values={}
    for name,(path,argument) in sources.items():
        value=os.environ.get(name,'')
        if not value:
            match=re.search(r'^ARG '+argument+r'=([^\s]+)$',Path(path).read_text(),re.M)
            need(match,'BASE_DEFAULT_MISSING')
            default=match[1]
            report=run(['docker','buildx','imagetools','inspect',default])
            digest=re.search(r'^Digest:\s+(sha256:[a-f0-9]{64})\s*$',report,re.M)
            need(digest,'BASE_DIGEST_UNAVAILABLE')
            value=default+'@'+digest[1]
        need(re.fullmatch(r'[a-z0-9][a-zA-Z0-9.:/_-]*@sha256:[a-f0-9]{64}',value),'INVALID_PINNED_BASE')
        values[name.lower()]=value
    # Older diagnostic source revisions still hardcode the uv image.
    uv = re.search(r'^ARG UV_IMAGE=(\S+)$',Path('apps/deep-agent-service/Dockerfile').read_text(),re.M)
    if uv:
        need(re.fullmatch(r'ghcr\.io/astral-sh/uv:[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}',uv[1]),'INVALID_PINNED_UV_IMAGE')
        values['uv_image']=uv[1]
    values['buildkit_repository']=SERVICES['sandbox'][0]
    return values

def write(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x') as stream: json.dump(value,stream,indent=2);stream.write('\n')

def main():
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='operation',required=True)
    sub.add_parser('login')
    source=sub.add_parser('source');source.add_argument('--default',required=True)
    plan=sub.add_parser('plan');plan.add_argument('--source',required=True);plan.add_argument('--resolve-bases',action='store_true')
    for op in ('build','aggregate'):
        command=sub.add_parser(op)
        for name in ('prefix','tag','output','source'): command.add_argument('--'+name,required=True)
        command.add_argument('--service' if op=='build' else '--directory',required=True)
    args=parser.parse_args()
    if args.operation=='source':
        value=build_source(args.default,os.environ.get('SOURCE_OVERRIDE',''),os.environ.get('BUILD_ONLY')=='true')
        with open(os.environ['GITHUB_OUTPUT'],'a') as output: output.write('source='+value+'\n')
    elif args.operation=='login':
        prefix=os.environ.get('REGISTRY_PREFIX','');registry=os.environ.get('REGISTRY','')
        need(PREFIX.fullmatch(prefix) and registry==prefix.split('/')[0] and '-vpc.' not in registry,'PUBLIC_REGISTRY_REQUIRED')
        username=os.environ.get('ACR_USERNAME','');password=os.environ.get('ACR_PASSWORD','')
        need(username and password and not any(c in username+password for c in '\r\n\x00'),'ACR_CREDENTIALS_REQUIRED')
        if os.environ.get('USE_ACR_VPC')=='1':
            registry=vpc_registry(registry)
        registry_login(registry,username,password)
    elif args.operation=='plan':
        event=os.environ['GITHUB_EVENT_NAME'];branch=os.environ['GITHUB_REF_NAME']
        build_only=os.environ.get('BUILD_ONLY')=='true'
        requested=os.environ.get('TARGET_ENVIRONMENT') or 'auto'
        need(event=='workflow_dispatch' and os.environ.get('GITHUB_REF_TYPE','branch')=='branch','RELEASE_EVENT_NOT_ALLOWED')
        expected={'develop':'devapp','main':'cn','main-us':'us'}.get(branch)
        target=expected if requested=='auto' else requested
        need(target in ('devapp','cn','us'),'INVALID_ENVIRONMENT')
        existing=os.environ.get('EXISTING_TAG','')
        aidt=aidt_plan_flag(os.environ.get('ENABLE_AIDT','false'),target,existing)
        tag=existing or (os.environ['GITHUB_RUN_ID']+'-'+AIDT_ATTEMPT_PREFIX+os.environ['GITHUB_RUN_ATTEMPT'] if activation_selected() else release_tag(args.source,os.environ['GITHUB_RUN_ID'],os.environ['GITHUB_RUN_ATTEMPT']))
        need(TAG.fullmatch(tag),'INVALID_RELEASE_TAG')
        selected=os.environ.get('BUILD_SERVICE') or 'all'
        services=[] if selected == 'auto' else select_build_services(selected,build_only,existing)
        baseline=os.environ.get('BUILD_BASELINE','')
        need(selected != 'auto' or baseline,'AUTO_BUILD_BASELINE_REQUIRED')
        detected=None
        if baseline:
            need(build_only and not existing and not activation_selected(),'BUILD_BASELINE_REQUIRES_BUILD_ONLY')
            detected=changed_build_services(baseline,args.source)
            services=[role for role in SERVICES if role in detected or
                      (selected != 'auto' and role in services)]
        activation=activation_selected()
        if activation:
            activation_parent(os.environ.get('REGISTRY_PREFIX',''),args.source,tag,target,aidt,build_only,selected,existing)
        lane={'devapp':('devapp','workspacex','workspacex-devapp-deploy'),
              'cn':('production-cn','workspacex-cn-production','workspacex-cn-production-deploy'),
              'us':('production-us','workspacex-us-production','workspacex-us-production-deploy')}[target]
        runner=['self-hosted','linux','x64',lane[1]]
        with open(os.environ['GITHUB_OUTPUT'],'a') as output:
            values={'source':args.source,'tag':tag,'services':json.dumps(services),'fullset':'true' if len(services)==len(SERVICES) else 'false','target':target,'environment':lane[0],
                    'runner':json.dumps(runner),'build':'true' if services and not existing else 'false','group':lane[2],'aidt_web_enabled':aidt}
            if args.resolve_bases and services and not existing and not activation: values.update(resolve_bases())
            for key,value in values.items(): output.write(key+'='+value+'\n')
        summary=os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with open(summary,'a') as output:
                mode='Reuse existing images (skip build)' if existing else ('Build and publish new images' if services else 'No changed build inputs')
                output.write('## Image release plan\n\nImage tag: `'+tag+'`\n\nEnvironment: `'+target+'`\n\nMode: '+mode+'\n\n')
                if detected is not None:
                    output.write('Comparison baseline: `'+baseline+'`\n\nDetected services: '+(', '.join(detected) or 'none')+'\n\n')
                if not existing:
                    output.write('Services: '+', '.join(services)+'\n\n')
                if existing:
                    output.write('Reused tag: AIDT build-time flags are not attested by this plan.\n\n')
                else:
                    output.write('AIDT Web build opt-in: `'+aidt+'` (API runtime flags and schema admission remain separate).\n\n')
                output.write('Copy the tag above after the build succeeds. Rerunning only deployment keeps the original built tag; it does not create a new image tag.\n')
    elif args.operation=='build': build(args.service,args.prefix,args.tag,args.output,args.source)
    else: write(args.output,aggregate(Path(args.directory),args.source,args.tag,args.prefix))

if __name__=='__main__':
    try: main()
    except Exception as error:
        print('REGISTRY_RELEASE_FAILED: '+(str(error) if isinstance(error,ValueError) else type(error).__name__),file=sys.stderr)
        raise SystemExit(1)
