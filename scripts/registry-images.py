#!/usr/bin/env python3
"""GitHub-hosted ACR producer; shares Dockerfiles with the existing CN producer."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

spec = importlib.util.spec_from_file_location('hosted_release', Path(__file__).with_name('hosted-release.py'))
hosted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)
SERVICES = hosted.SERVICES
SHA = re.compile(r'[a-f0-9]{40}')
TAG = re.compile(r'(?:[a-f0-9]{40}-)?[1-9][0-9]*-[1-9][0-9]*')
LEGACY_TAG = re.compile(r'[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*')
PREFIX = re.compile(r'[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9]+(?:[._-][a-z0-9]+)*')

def need(ok, code):
    if not ok: raise ValueError(code)

def coordinates(prefix, tag):
    need(isinstance(prefix,str) and PREFIX.fullmatch(prefix), 'INVALID_REGISTRY_PREFIX')
    need(isinstance(tag,str) and TAG.fullmatch(tag), 'INVALID_RELEASE_TAG')
    return prefix, tag

def release_tag(source, run, attempt):
    need(SHA.fullmatch(source) and re.fullmatch('[1-9][0-9]*',run) and re.fullmatch('[1-9][0-9]*',attempt), 'INVALID_BUILD_IDENTITY')
    return run+'-'+attempt

def safe_diagnostics(raw):
    for key,value in os.environ.items():
        if value and len(value)>=4 and (re.search(r'TOKEN|PASSWORD|SECRET|ACCESS_KEY',key) or key=='ACR_USERNAME'):
            raw=raw.replace(value,'[redacted]')
    raw=re.sub(r'(https?://)[^/\s]*@',r'\1[redacted]@',raw)
    raw=re.sub(r'(?i)(authorization:\s*(?:bearer|basic)\s+)\S+',r'\1[redacted]',raw)
    raw=re.sub(r'(?i)([?&](?:token|password|secret|access[_-]?key)=)[^&\s]+',r'\1[redacted]',raw)
    return '\n'.join(raw.splitlines()[-100:])[-12000:]

def run(args, timeout=3600):
    result=subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode!=0:
        print(safe_diagnostics(result.stdout+'\n'+result.stderr),file=sys.stderr)
    need(result.returncode==0, 'COMMAND_FAILED_'+Path(args[0]).name.upper())
    return result.stdout

def resolve(docker, prefix, tag, role, pull=True):
    coordinates(prefix,tag)
    need(role in SERVICES,'INVALID_SERVICE')
    repository=prefix+'/'+SERVICES[role][0]
    reference=repository+':'+tag
    command=[docker] if isinstance(docker,str) else list(docker)
    if pull: run(command+['pull','--platform','linux/amd64',reference])
    values=json.loads(run(command+['image','inspect',reference]))
    need(len(values)==1,'IMAGE_INSPECT')
    value=values[0]
    need(value['Os']=='linux' and value['Architecture']=='amd64','IMAGE_PLATFORM')
    labels=value.get('Config',{}).get('Labels',{}) or {}
    source=labels.get('org.opencontainers.image.revision','')
    need(isinstance(source,str) and SHA.fullmatch(source),'IMAGE_SOURCE_MISMATCH')
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

def build(role, prefix, tag, output, source):
    coordinates(prefix,tag)
    need(role in SERVICES,'INVALID_SERVICE')
    need(isinstance(source,str) and SHA.fullmatch(source),'INVALID_SOURCE_REVISION')
    need(run(['git','rev-parse','HEAD']).strip()==source,'SOURCE_CHECKOUT_MISMATCH')
    repository,dockerfile,context,bases=SERVICES[role]
    args=['docker','buildx','build','--load','--platform','linux/amd64','--file',dockerfile,'--tag',prefix+'/'+repository+':'+tag,
          '--label','org.opencontainers.image.revision='+source,'--label','io.boardx.workspacex.release-tag='+tag,'--build-arg','SOURCE_REVISION='+source]
    mapping={'node':'NODE_IMAGE','python':'PYTHON_IMAGE','postgres':'PGVECTOR_IMAGE'}
    for base in bases:
        name=mapping[base];value=os.environ.get(name,'')
        need(re.fullmatch(r'[a-z0-9][a-zA-Z0-9.:/_-]*@sha256:[a-f0-9]{64}',value),'MISSING_PINNED_'+name)
        args+=['--build-arg',name+'='+value]
    # Package mirrors are shared with the existing producer's default contract.
    for name,key in {'NPM_REGISTRY':'npmRegistry','PYPI_INDEX_URL':'pypiIndexUrl','APT_MIRROR':'aptMirror','AGE_REPOSITORY':'ageRepository'}.items():
        args+=['--build-arg',name+'='+hosted.DEFAULT_SOURCES[key]]
    expected=release_tag(source,os.environ['GITHUB_RUN_ID'],os.environ['GITHUB_RUN_ATTEMPT'])
    need(tag==expected,'RERUN_ALL_JOBS_REQUIRED')
    probe=subprocess.run(['docker','manifest','inspect',prefix+'/'+repository+':'+tag],capture_output=True,text=True,timeout=60)
    need(probe.returncode!=0,'IMMUTABLE_TAG_ALREADY_EXISTS')
    need(re.search(r'manifest unknown|no such manifest|MANIFEST_UNKNOWN',probe.stderr,re.I),'TAG_EXISTENCE_UNVERIFIED')
    run(args+[context])
    run(['docker','push',prefix+'/'+repository+':'+tag])
    write(output,resolve('docker',prefix,tag,role))

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
    return values

def write(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x') as stream: json.dump(value,stream,indent=2);stream.write('\n')

def main():
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='operation',required=True)
    sub.add_parser('login')
    plan=sub.add_parser('plan');plan.add_argument('--source',required=True);plan.add_argument('--resolve-bases',action='store_true')
    for op in ('build','aggregate'):
        command=sub.add_parser(op)
        for name in ('prefix','tag','output','source'): command.add_argument('--'+name,required=True)
        command.add_argument('--service' if op=='build' else '--directory',required=True)
    args=parser.parse_args()
    if args.operation=='login':
        prefix=os.environ.get('REGISTRY_PREFIX','');registry=os.environ.get('REGISTRY','')
        need(PREFIX.fullmatch(prefix) and registry==prefix.split('/')[0] and '-vpc.' not in registry,'PUBLIC_REGISTRY_REQUIRED')
        username=os.environ.get('ACR_USERNAME','');password=os.environ.get('ACR_PASSWORD','')
        need(username and password and not any(c in username+password for c in '\r\n\x00'),'ACR_CREDENTIALS_REQUIRED')
        result=subprocess.run(['docker','login',registry,'--username',username,'--password-stdin'],input=password,text=True,capture_output=True,timeout=60)
        need(result.returncode==0,'ACR_LOGIN_FAILED')
    elif args.operation=='plan':
        event=os.environ['GITHUB_EVENT_NAME'];branch=os.environ['GITHUB_REF_NAME']
        build_only=os.environ.get('BUILD_ONLY')=='true'
        need(event=='push' and branch=='develop' or event=='workflow_dispatch' and (branch in ('main','develop') or build_only),'RELEASE_EVENT_NOT_ALLOWED')
        expected={'develop':'devapp','main':'cn'}.get(branch)
        requested=os.environ.get('TARGET_ENVIRONMENT') or 'auto'
        if event=='push':
            target=expected
        elif expected:
            need(requested in ('auto',expected),'BRANCH_ENVIRONMENT_MISMATCH')
            target=expected
        else:
            # Non-release branches are diagnostic builds only, never host deployments.
            target=requested
        need(target in ('devapp','cn'),'INVALID_ENVIRONMENT')
        existing=os.environ.get('EXISTING_TAG','') if event=='workflow_dispatch' else ''
        tag=existing or release_tag(args.source,os.environ['GITHUB_RUN_ID'],os.environ['GITHUB_RUN_ATTEMPT'])
        need(TAG.fullmatch(tag),'INVALID_RELEASE_TAG')
        selected=os.environ.get('BUILD_SERVICE') or 'all'
        need(selected=='all' or selected in SERVICES and os.environ.get('BUILD_ONLY')=='true','PARTIAL_BUILD_REQUIRES_BUILD_ONLY')
        services=list(SERVICES) if selected=='all' else [selected]
        runner=['self-hosted','linux','x64','workspacex' if target=='devapp' else 'workspacex-cn-production']
        with open(os.environ['GITHUB_OUTPUT'],'a') as output:
            values={'source':args.source,'tag':tag,'services':json.dumps(services),'fullset':'true' if selected=='all' else 'false','target':target,'environment':'devapp' if target=='devapp' else 'production-cn',
                    'runner':json.dumps(runner),'build':'false' if existing else 'true','group':'workspacex-devapp-deploy' if target=='devapp' else 'workspacex-cn-production-deploy'}
            if args.resolve_bases and not existing: values.update(resolve_bases())
            for key,value in values.items(): output.write(key+'='+value+'\n')
        summary=os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with open(summary,'a') as output:
                mode='Reuse existing images (skip build)' if existing else 'Build and publish new images'
                output.write('## Image release plan\n\nImage tag: `'+tag+'`\n\nEnvironment: `'+target+'`\n\nMode: '+mode+'\n\n')
                output.write('Copy the tag above after the build succeeds. Rerunning only deployment keeps the original built tag; it does not create a new image tag.\n')
    elif args.operation=='build': build(args.service,args.prefix,args.tag,args.output,args.source)
    else: write(args.output,aggregate(Path(args.directory),args.source,args.tag,args.prefix))

if __name__=='__main__':
    try: main()
    except Exception as error:
        print('REGISTRY_RELEASE_FAILED: '+(str(error) if isinstance(error,ValueError) else type(error).__name__),file=sys.stderr)
        raise SystemExit(1)
