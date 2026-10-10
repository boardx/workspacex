#!/usr/bin/env python3
"""候选五镜像构建/收集；无 registry push、Redis 拉取或生产操作。"""
import argparse
from datetime import datetime,timedelta,timezone
import importlib.util
import io
import gzip
import zlib
import os
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cn_image_candidate as c
import cn_image_archive as a
spec=importlib.util.spec_from_file_location('candidate_export_helpers',Path(__file__).with_name('export-cn-image-archives.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

# Diagnostics contain only audited constants and OS return codes, never argv/output.
import json
import selectors
import signal
import subprocess
import time
STAGE='CLI_INPUT'
SAFE_CODES=frozenset(('ARCHIVE_BUDGET_INVALID', 'ARCHIVE_CONTENT_MISMATCH', 'ARCHIVE_DUPLICATE_OR_PAX', 'ARCHIVE_ENTRY_FIELDS', 'ARCHIVE_FILENAME_MISMATCH', 'ARCHIVE_IMAGE_METADATA_MISMATCH', 'ARCHIVE_JSON_TOO_LARGE', 'ARCHIVE_LINK_OR_SPECIAL_FILE', 'ARCHIVE_MEMBER_LIMIT', 'ARCHIVE_MEMBER_MISSING', 'ARCHIVE_PATH_INVALID', 'ARCHIVE_SET_EXPIRED', 'ARCHIVE_SET_FIELDS', 'ARCHIVE_SET_HASH_MISMATCH', 'ARCHIVE_SET_IDENTITY_MISMATCH', 'ARCHIVE_SET_PLAN_MISMATCH', 'ARCHIVE_SET_PRIVILEGE', 'ARCHIVE_SIZE_INVALID', 'ARCHIVE_SIZE_LIMIT', 'ARCHIVE_TOTAL_LIMIT', 'ARCHIVE_TRUNCATED', 'ASSEMBLY_BINDING', 'ASSEMBLY_COMPLETE_FIVE', 'ASSEMBLY_FIELDS', 'ASSEMBLY_INPUTS', 'ASSEMBLY_INPUT_FILE', 'ASSEMBLY_RAW_HASH', 'ASSEMBLY_REDIS_REFERENCE', 'ASSEMBLY_RELEASE', 'ATTEMPT_INVALID', 'BASE_SET_INVALID', 'BUILD_PLAN_FIELDS', 'BUILD_PLAN_SCHEMA', 'CANDIDATE_ATTEMPT', 'CANDIDATE_BASES', 'CANDIDATE_BASE_DIGEST', 'CANDIDATE_BUILD_INPUTS', 'CANDIDATE_CAPACITY', 'CANDIDATE_COLLECTION_CAPACITY', 'CANDIDATE_COLLECTION_FILESYSTEM', 'CANDIDATE_COLLECTION_FIVE', 'CANDIDATE_COLLECTION_PATH', 'CANDIDATE_COLLECTION_TOTAL', 'CANDIDATE_COMPLETE_FIVE', 'CANDIDATE_CONFIG_BINDING', 'CANDIDATE_CONTRACT_FIELDS', 'CANDIDATE_CONTRACT_SET', 'CANDIDATE_CONTROL_BYTES', 'CANDIDATE_CONTROL_DIRTY', 'CANDIDATE_CONTROL_SHA', 'CANDIDATE_DIFF_IDS', 'CANDIDATE_DOCKERFILE_HASH', 'CANDIDATE_EXACT_SHA', 'CANDIDATE_EXPIRED', 'CANDIDATE_FILE_TRUST', 'CANDIDATE_FIXED_BUDGET', 'CANDIDATE_FRAGMENT_DIRECTORY', 'CANDIDATE_FRAGMENT_FILES', 'CANDIDATE_FRAGMENT_METADATA', 'CANDIDATE_FRAGMENT_SERVICE', 'CANDIDATE_IMAGE_FIELDS', 'CANDIDATE_IMAGE_PLATFORM', 'CANDIDATE_LABELS', 'CANDIDATE_LAYERS', 'CANDIDATE_MANIFEST', 'CANDIDATE_MEMBERS', 'CANDIDATE_NON_AUTHORIZING', 'CANDIDATE_ONE_IMAGE', 'CANDIDATE_ORIGINAL_PLAN_BINDING', 'CANDIDATE_OUTPUT_EXISTS', 'CANDIDATE_OUTPUT_REQUIRED', 'CANDIDATE_PLAN_FIELDS', 'CANDIDATE_PLAN_FILE', 'CANDIDATE_PLAN_ORIGINAL_BYTES', 'CANDIDATE_PLAN_RAW_HASH', 'CANDIDATE_PLATFORM', 'CANDIDATE_RECEIPT_FIELDS', 'CANDIDATE_RECEIPT_IDENTITY', 'CANDIDATE_RECEIPT_RAW_HASH', 'CANDIDATE_SAVE_LAYERS', 'CANDIDATE_SAVE_LIMIT', 'CANDIDATE_SAVE_MANIFEST', 'CANDIDATE_SAVE_MEMBER', 'CANDIDATE_SCHEMA', 'CANDIDATE_SERVICE', 'CANDIDATE_SERVICE_SET', 'CANDIDATE_SIZE', 'CANDIDATE_SOURCE_CONTRACT', 'CANDIDATE_SOURCE_DIRTY', 'CANDIDATE_SOURCE_SHA', 'CANDIDATE_TAG', 'CANDIDATE_TAR_HASH', 'CANDIDATE_TOTAL', 'COMPLETE_FIVE_IMAGES_REQUIRED', 'DOCKER_MANIFEST_FIELDS', 'DOCKER_MANIFEST_MISSING', 'DUPLICATE_JSON_KEY', 'EXACT_SHA_REQUIRED', 'EXISTING_REDIS_DIGEST_REQUIRED', 'FILE_SIZE_LIMIT', 'IMAGE_BUILD_BINDING_MISMATCH', 'IMAGE_LABELS_MISSING', 'IMAGE_PLATFORM_MISMATCH', 'IMAGE_ROOTFS_INVALID', 'IMAGE_SOURCE_MISMATCH', 'IMMUTABILITY_RAW_BINDING', 'IMMUTABILITY_RAW_COMPLETE', 'IMMUTABILITY_RAW_EXPIRED', 'IMMUTABILITY_RAW_FIELDS', 'IMMUTABILITY_RAW_IDENTITY', 'IMMUTABILITY_RAW_NOT_PROVEN', 'IMMUTABILITY_RAW_TARGET', 'INVALID_TIMESTAMP', 'LAYER_DIFF_ID_MISMATCH', 'LAYER_SET_INVALID', 'LAYER_SIZE_INVALID', 'ONE_IMAGE_REQUIRED', 'PLATFORM_NOT_SUPPORTED', 'PUBLIC_BASE_DIGEST_REQUIRED', 'RELEASE_INVALID', 'SERVICE_INVALID', 'STAGING_TAG_MISMATCH', 'STORAGE_MARGIN_INVALID', 'TIMEZONE_REQUIRED', 'TRANSPORT_APPROVAL_REQUIRED', 'TRANSPORT_BUCKET_INVALID', 'TRANSPORT_DUPLICATE_KEY', 'TRANSPORT_ENDPOINT_INVALID', 'TRANSPORT_FIELD_INVALID', 'TRANSPORT_OBJECT_FIELDS', 'TRANSPORT_OBJECT_HASH', 'TRANSPORT_OBJECT_SCOPE', 'TRANSPORT_OBJECT_SET', 'TRANSPORT_PREFIX_INVALID', 'TRANSPORT_REGION_INVALID', 'TRANSPORT_VERSION_INVALID', 'UNREFERENCED_ARCHIVE_MEMBER'))
def stage(value):
    global STAGE
    STAGE=value
class CommandFailure(Exception):
    def __init__(self,category,code,returncode=None):
        self.category=category;self.code=code;self.returncode=returncode

def command_category(argv):
    for prefix,category in ((['git','rev-parse'],'GIT_IDENTITY'),(['git','status'],'GIT_STATUS'),(['git','show'],'GIT_CONTRACT'),(['git','merge-base'],'GIT_ANCESTRY'),(['git','archive'],'GIT_ARCHIVE'),(['docker','buildx','build'],'DOCKER_BUILD'),(['docker','image','save'],'DOCKER_SAVE')):
        if argv[:len(prefix)]==prefix:return category
    return 'OTHER_COMMAND'

def run(argv,cwd=None,*,stdout_file=None,stdout_limit=None):
    category=command_category(argv)
    if stdout_file is not None:
        c.require(type(stdout_limit) is int and 0<stdout_limit<=4*1024**3,'CANDIDATE_SAVE_LIMIT')
    stdout_size=0
    env={'PATH':'/usr/bin:/bin','LANG':'C','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_REPLACE_OBJECTS':'1','GIT_NO_LAZY_FETCH':'1'}
    with tempfile.TemporaryDirectory(prefix='wsx-candidate-home-') as home:
        env['HOME']=home
        try:process=subprocess.Popen(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        except OSError:raise CommandFailure(category,'COMMAND_START_FAILED') from None
        selector=selectors.DefaultSelector();buffers={};deadline=time.monotonic()+3600
        try:
            for stream in (process.stdout,process.stderr):buffers[stream]=bytearray();selector.register(stream,selectors.EVENT_READ)
            while selector.get_map():
                if time.monotonic()>=deadline:raise CommandFailure(category,'COMMAND_TIMEOUT')
                for key,_ in selector.select(.2):
                    data=os.read(key.fileobj.fileno(),8192)
                    if not data:selector.unregister(key.fileobj);continue
                    if key.fileobj is process.stdout and stdout_file is not None:
                        stdout_size+=len(data)
                        c.require(stdout_size<=stdout_limit,'CANDIDATE_SAVE_LIMIT')
                        stdout_file.write(data);continue
                    if len(buffers[key.fileobj])+len(data)>8*1024**2:raise CommandFailure(category,'COMMAND_OUTPUT_LIMIT')
                    buffers[key.fileobj].extend(data)
            try:rc=process.wait(timeout=1)
            except subprocess.TimeoutExpired:raise CommandFailure(category,'COMMAND_TIMEOUT') from None
            if rc!=0:raise CommandFailure(category,'COMMAND_NONZERO',rc)
            return bytes(buffers[process.stdout])
        finally:
            if process.poll() is None:os.killpg(process.pid,signal.SIGKILL)
            process.wait();selector.close();process.stdout.close();process.stderr.close()

def diagnostic(error):
    result={'kind':'CN_IMAGE_CANDIDATE_REJECTED','stage':STAGE,'code':'OPERATION_FAILED'}
    if isinstance(error,CommandFailure):
        result.update(code=error.code if type(error.code) is str and error.code in {'COMMAND_START_FAILED','COMMAND_TIMEOUT','COMMAND_OUTPUT_LIMIT','COMMAND_NONZERO'} else 'OPERATION_FAILED',subcommand=error.category if type(error.category) is str and error.category in {'GIT_IDENTITY','GIT_STATUS','GIT_CONTRACT','GIT_ANCESTRY','GIT_ARCHIVE','DOCKER_BUILD','DOCKER_SAVE','OTHER_COMMAND'} else 'OTHER_COMMAND',returncode=error.returncode if type(error.returncode) is int and -255<=error.returncode<=255 else None)
    elif isinstance(error,a.Rejected) and len(error.args)==1 and type(error.args[0]) is str and error.args[0] in SAFE_CODES:result['code']=error.args[0]
    return result

def load(path,expected):
    stage('PLAN_LOAD')
    p=Path(path);c.require(p.is_file() and not p.is_symlink() and p.stat().st_size<=16384,'CANDIDATE_PLAN_FILE')
    raw=p.read_bytes();c.require(a.sha(raw)==expected,'CANDIDATE_PLAN_RAW_HASH');return c.validate_plan(a.decode(raw)),raw

def control(p,command=run):
    stage('CONTROL_VERIFY')
    root=Path(__file__).resolve().parent.parent
    c.require(command(['git','rev-parse','HEAD'],root).decode().strip()==p['controlRevision'],'CANDIDATE_CONTROL_SHA')
    c.require(not command(['git','status','--porcelain','--untracked-files=all'],root).strip(),'CANDIDATE_CONTROL_DIRTY')
    for f in ('scripts/cn_image_candidate.py','scripts/build-cn-image-candidates.py','scripts/cn_image_archive.py','scripts/hosted-release.py','scripts/export-cn-image-archives.py'):
        c.require((root/f).read_bytes()==command(['git','show',p['controlRevision']+':'+f],root),'CANDIDATE_CONTROL_BYTES')

SAFE_CODES=SAFE_CODES|{'CANDIDATE_NORMALIZE_LIMIT','CANDIDATE_LAYER_COMPRESSION',
    'CANDIDATE_SAVE_ENTRY_TYPE','CANDIDATE_SAVE_FIELDS','CANDIDATE_SAVE_TAGS',
    'CANDIDATE_METADATA_REQUIRED','CANDIDATE_METADATA_DIRECTORY','CANDIDATE_METADATA_FILES','CANDIDATE_METADATA_SIZE','CANDIDATE_METADATA_IDENTITY','CANDIDATE_METADATA_CHANGED','CANDIDATE_SAVE_LAYER_COUNT','CANDIDATE_SAVE_PATH_COLLISION','CANDIDATE_SAVE_LAYERS_TYPE','CANDIDATE_SAVE_CONFIG_TYPE','CANDIDATE_SAVE_LAYER_SOURCES','CANDIDATE_SAVE_PARENT'}

def normalize(saved,target,p,service):
    created=[]
    try:return _normalize(saved,target,p,service,created)
    except BaseException:
        if created:
            try:Path(target).unlink()
            except OSError:pass  # Preserve primary failure; never unlink another writer's file.
        raise

def _normalize(saved,target,p,service,created):
    stage('ARCHIVE_NORMALIZE')
    c.require(Path(saved).stat().st_size<=p['maxArchiveBytes'],'CANDIDATE_SAVE_LIMIT')
    with tarfile.open(saved,'r:') as source:
        ix=a.members(source);c.require('manifest.json' in ix,'CANDIDATE_MANIFEST')
        m=a.decode(a.small_member(source,ix['manifest.json']));c.require(type(m) is list and len(m)==1,'CANDIDATE_ONE_IMAGE')
        v=m[0];c.require(type(v) is dict,'CANDIDATE_SAVE_ENTRY_TYPE')
        required={'Config','RepoTags','Layers'}
        # Moby's save format permits LayerSources metadata. It is never used
        # for retrieval or identity: only embedded payloads are inspected.
        c.require(required<=set(v)<=required|{'LayerSources','Parent'},'CANDIDATE_SAVE_FIELDS')
        c.require('LayerSources' not in v or type(v['LayerSources']) is dict,'CANDIDATE_SAVE_LAYER_SOURCES')
        c.require('Parent' not in v or (type(v['Parent']) is str and
                  v['Parent'].startswith('sha256:') and a.hex_string(v['Parent'][7:],64)),'CANDIDATE_SAVE_PARENT')
        expected=c.tag(p,service)
        # Classic Moby and containerd emit familiar references; retain exact tag.
        c.require(type(v['RepoTags']) is list and len(v['RepoTags'])==1 and
                  v['RepoTags'][0]==expected,'CANDIDATE_SAVE_TAGS')
        c.require(type(v['Config']) is str,'CANDIDATE_SAVE_CONFIG_TYPE')
        c.require(type(v['Layers']) is list and all(type(n) is str for n in v['Layers']),'CANDIDATE_SAVE_LAYERS_TYPE')
        # Emit the strict three-field candidate format, preserving config bytes.
        v={'Config':v['Config'],'RepoTags':[expected],'Layers':v['Layers']};m=[v]
        c.require(0<len(v['Layers'])<=128,'CANDIDATE_SAVE_LAYER_COUNT')
        names=[v['Config'],*v['Layers']]
        c.require(v['Config'] not in v['Layers'] and 'manifest.json' not in names,'CANDIDATE_SAVE_PATH_COLLISION')
        for n in names:a.safe_name(n);c.require(n in ix and ix[n].isfile(),'CANDIDATE_SAVE_MEMBER')
        # Exporters may reference one stored blob at multiple logical positions.
        # Preserve every occurrence/order; strict output still has unique members.
        output_names=[v['Config'],*[f'layers/{i:04d}.tar' for i in range(len(v['Layers']))]]
        c.require(len(output_names)==len(set(output_names)),'CANDIDATE_SAVE_PATH_COLLISION')
        v['Layers']=output_names[1:]
        # Preserve config bytes; only layer payloads may be decompressed.
        # Stage in private temporary files, stream with a cumulative bound, then
        # compute the exact USTAR record size before creating the final archive.
        with tempfile.TemporaryDirectory(prefix='wsx-normalize-',dir=Path(target).parent) as td:
            payloads=[];total=0
            for i,n in enumerate(names):
                f=Path(td)/str(i);size=0
                with source.extractfile(ix[n]) as original,open(f,'xb') as staged:
                    magic=original.read(2);original.seek(0)
                    compressed=i>0 and magic==b'\x1f\x8b'
                    reader=gzip.GzipFile(fileobj=original) if compressed else original
                    try:
                        while True:
                            # Read at most one byte beyond the remaining budget.
                            data=reader.read(min(1024**2,p['maxArchiveBytes']-total+1))
                            if not data:break
                            total+=len(data);size+=len(data)
                            c.require(total<=p['maxArchiveBytes'],'CANDIDATE_NORMALIZE_LIMIT')
                            staged.write(data)
                    except (gzip.BadGzipFile,EOFError,zlib.error):
                        raise a.Rejected('CANDIDATE_LAYER_COMPRESSION') from None
                    finally:
                        if compressed:reader.close()
                payloads.append((output_names[i],f,size))
            raw=a.json_bytes(m)
            # USTAR end blocks and Python tarfile's 10240-byte record padding.
            logical=sum(512+((size+511)//512)*512 for _,_,size in payloads)+512+((len(raw)+511)//512)*512+1024
            c.require(((logical+10239)//10240)*10240<=p['maxArchiveBytes'],'CANDIDATE_NORMALIZE_LIMIT')
            with open(target,'xb') as stream:
                created.append(True)
                with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT) as out:
                    for n,f,size in payloads:
                        header=tarfile.TarInfo(n);header.size=size;header.mode=0o644
                        with open(f,'rb') as payload:out.addfile(header,payload)
                    header=tarfile.TarInfo('manifest.json');header.size=len(raw);header.mode=0o644;out.addfile(header,io.BytesIO(raw))
    return c.inspect(target,p,service)

def capacity(directory,required):
    c.require(shutil.disk_usage(directory).free>=required and os.statvfs(directory).f_favail>=4096,'CANDIDATE_CAPACITY')

def produce(p,raw,source,output,service,command=run):
    stage('BUILD_INPUTS')
    c.validate_plan(p);c.require(service in c.hosted.SERVICES,'CANDIDATE_SERVICE');control(p,command)
    stage('SOURCE_VERIFY')
    source=Path(source);c.require(command(['git','rev-parse','HEAD'],source).decode().strip()==p['sourceRevision'],'CANDIDATE_SOURCE_SHA')
    c.require(not command(['git','status','--porcelain','--untracked-files=all'],source).strip(),'CANDIDATE_SOURCE_DIRTY')
    command(['git','merge-base','--is-ancestor',p['sourceRevision'],'origin/main'],source)
    for v in p['sourceContracts'].values():c.require(a.sha(command(['git','show',p['sourceRevision']+':'+v['dockerfile']],source))==v['dockerfileSha256'],'CANDIDATE_DOCKERFILE_HASH')
    stage('OUTPUT_PREFLIGHT')
    out=Path(output);c.require(not out.exists() and not out.is_symlink() and out.parent.is_dir(),'CANDIDATE_OUTPUT_EXISTS')
    capacity(out.parent,4*p['maxArchiveBytes']+p['storageMarginBytes'])
    out.mkdir(mode=0o700)
    try:
        with tempfile.TemporaryDirectory(prefix='wsx-candidate-',dir=out.parent) as td:
            stage('SOURCE_ARCHIVE');root=Path(td);savedsource=root/'source.tar';command(['git','archive','--format=tar','--output',str(savedsource),p['sourceRevision']],source)
            checkout=root/'source';checkout.mkdir()
            with tarfile.open(savedsource,'r:') as t:t.extractall(checkout,filter='data')
            v=p['sourceContracts'][service];argv=['docker','buildx','build','--load','--platform',p['platform'],'--label','org.opencontainers.image.revision='+p['sourceRevision'],'--label',c.LABEL+'='+c.identity(p),'-f',str(checkout/v['dockerfile']),'-t',c.tag(p,service)]
            for base in v['bases']:argv+=['--build-arg',{'node':'NODE_IMAGE','python':'PYTHON_IMAGE','postgres':'PGVECTOR_IMAGE'}[base]+'='+p['baseImages'][base]]
            argv+=['--build-arg','SOURCE_REVISION='+p['sourceRevision'],str(checkout/v['context'])];stage('DOCKER_BUILD');command(argv)
            # Build/cache usage is not bounded by the archive budget. Recheck actual free space.
            capacity(out.parent,3*p['maxArchiveBytes']+p['storageMarginBytes'])
            stage('DOCKER_SAVE');saved=root/'save.tar'
            with saved.open('xb') as stream:
                command(['docker','image','save',c.tag(p,service)],stdout_file=stream,stdout_limit=p['maxArchiveBytes'])
            c.require(0<saved.stat().st_size<=p['maxArchiveBytes'],'CANDIDATE_SAVE_LIMIT')
            capacity(out.parent,2*p['maxArchiveBytes']+p['storageMarginBytes'])
            target=out/(service+'.tar');meta=normalize(saved,target,p,service);size,digest=a.file_digest(target,p['maxArchiveBytes'])
        stage('FRAGMENT_WRITE')
        now=datetime.now(timezone.utc);receipt={'kind':c.KIND,'schemaVersion':2,'planRawSha256':a.sha(raw),'planSha256':a.sha(a.json_bytes(p)),'identity':c.identity(p),'attemptId':p['attemptId'],'producedAt':now.isoformat(),'expiresAt':(now+timedelta(hours=1)).isoformat(),'images':{service:{'file':service+'.tar','size':size,'sha256':digest,**meta}},'releaseReady':False,'productionReady':False}
        (out/'candidate-plan.json').write_bytes(raw);(out/'candidate-fragment.json').write_bytes(a.json_bytes(receipt));return receipt
    except BaseException:
        try:shutil.rmtree(out)
        except Exception:pass  # Preserve the primary rejection, never publish a receipt.
        raise

def check_fragments(p,raw,folder,check_capacity=False):
    """Admission before tar downloads; declaration checks do not replace byte verification."""
    c.validate_plan(p);root=Path(folder)
    c.require(root.is_dir() and not root.is_symlink(),'CANDIDATE_METADATA_DIRECTORY')
    c.require({x.name for x in root.iterdir()}==set(c.hosted.SERVICES),'CANDIDATE_COLLECTION_FIVE')
    total=0
    for service in c.hosted.SERVICES:
        directory=root/service
        c.require(directory.is_dir() and not directory.is_symlink(),'CANDIDATE_METADATA_DIRECTORY')
        c.require({x.name for x in directory.iterdir()}=={'candidate-plan.json','candidate-fragment.json'},'CANDIDATE_METADATA_FILES')
        for name,limit in [('candidate-plan.json',16384),('candidate-fragment.json',256*1024)]:
            file=directory/name
            c.require(file.is_file() and not file.is_symlink() and file.stat().st_size<=limit,'CANDIDATE_FRAGMENT_METADATA')
        c.require((directory/'candidate-plan.json').read_bytes()==raw,'CANDIDATE_PLAN_ORIGINAL_BYTES')
        fragment=(directory/'candidate-fragment.json').read_bytes()
        value=c.validate_receipt(fragment,p,a.sha(fragment))
        c.require(value['planRawSha256']==a.sha(raw),'CANDIDATE_ORIGINAL_PLAN_BINDING')
        c.require(set(value['images'])=={service},'CANDIDATE_FRAGMENT_SERVICE')
        entry=value['images'][service]
        c.require(type(entry) is dict and set(entry)=={'file','size','sha256','configSha256','imageId','layers','stagingTag'},'CANDIDATE_IMAGE_FIELDS')
        c.require(entry['file']==service+'.tar' and type(entry['size']) is int and 0<entry['size']<=p['maxArchiveBytes'],'CANDIDATE_METADATA_SIZE')
        c.require(a.hex_string(entry['sha256'],64) and a.hex_string(entry['configSha256'],64) and entry['imageId']=='sha256:'+entry['configSha256'] and entry['stagingTag']==c.tag(p,service),'CANDIDATE_METADATA_IDENTITY')
        c.require(type(entry['layers']) is list and 0<len(entry['layers'])<=128,'CANDIDATE_LAYERS')
        total+=entry['size']
    c.require(total<=p['maxTotalBytes'],'CANDIDATE_COLLECTION_TOTAL')
    if check_capacity:
        capacity(root.parent,total+p['storageMarginBytes'])
    return {'kind':'cn-candidate-download-admission-v1','planRawSha256':a.sha(raw),'identity':c.identity(p),'attemptId':p['attemptId'],'declaredTotalBytes':total,'releaseReady':False,'productionReady':False}

def collect(p,raw,folder,output,metadata=None):
    stage('COLLECTION_VERIFY')
    control(p);stage('COLLECTION_VERIFY');root=Path(folder);out=Path(output)
    c.require(root.is_dir() and not root.is_symlink() and not out.exists() and not out.is_symlink() and out.parent.is_dir(),'CANDIDATE_COLLECTION_PATH')
    c.require(root.stat().st_dev==out.parent.stat().st_dev,'CANDIDATE_COLLECTION_FILESYSTEM')
    c.require(shutil.disk_usage(out.parent).free>=p['storageMarginBytes'] and os.statvfs(out.parent).f_favail>=4096,'CANDIDATE_COLLECTION_CAPACITY')
    c.require({x.name for x in root.iterdir()}==set(c.hosted.SERVICES),'CANDIDATE_COLLECTION_FIVE')
    c.require('budgetProfile' not in p or metadata is not None,'CANDIDATE_METADATA_REQUIRED')
    if metadata is not None:
        check_fragments(p,raw,metadata)
    images={};issued=[];expires=[]
    for service in c.hosted.SERVICES:
        directory=root/service;c.require(directory.is_dir() and not directory.is_symlink(),'CANDIDATE_FRAGMENT_DIRECTORY')
        c.require({x.name for x in directory.iterdir()}=={service+'.tar','candidate-plan.json','candidate-fragment.json'},'CANDIDATE_FRAGMENT_FILES')
        for name,limit in [('candidate-plan.json',16384),('candidate-fragment.json',256*1024)]:
            f=directory/name;c.require(f.is_file() and not f.is_symlink() and f.stat().st_size<=limit,'CANDIDATE_FRAGMENT_METADATA')
        c.require((directory/'candidate-plan.json').read_bytes()==raw,'CANDIDATE_PLAN_ORIGINAL_BYTES')
        if metadata is not None:
            for name in ('candidate-plan.json','candidate-fragment.json'):
                c.require((directory/name).read_bytes()==(Path(metadata)/service/name).read_bytes(),'CANDIDATE_METADATA_CHANGED')
        fragment=(directory/'candidate-fragment.json').read_bytes();v=c.verify_bundle(directory,p,fragment,a.sha(fragment),a.sha(raw),complete=False)
        c.require(set(v['images'])=={service},'CANDIDATE_FRAGMENT_SERVICE')
        images.update(v['images']);issued.append(a.timestamp(v['producedAt']));expires.append(a.timestamp(v['expiresAt']))
    receipt={'kind':c.KIND,'schemaVersion':2,'planRawSha256':a.sha(raw),'planSha256':a.sha(a.json_bytes(p)),'identity':c.identity(p),'attemptId':p['attemptId'],'producedAt':min(issued).isoformat(),'expiresAt':min(expires).isoformat(),'images':images,'releaseReady':False,'productionReady':False}
    c.require(sum(x['size'] for x in images.values())<=p['maxTotalBytes'],'CANDIDATE_COLLECTION_TOTAL')
    stage('COLLECTION_WRITE');out.mkdir(mode=0o700);moved=[]
    try:
        for service in images:src=root/service/(service+'.tar');dst=out/(service+'.tar');os.rename(src,dst);moved.append((src,dst))
        data=a.json_bytes(receipt);c.verify_bundle(out,p,data,a.sha(data),a.sha(raw))
        (out/'candidate-plan.json').write_bytes(raw);(out/'candidate-set.json').write_bytes(data);return receipt
    except BaseException:
        for src,dst in reversed(moved):
            if dst.exists():os.rename(dst,src)
        for name in ('candidate-plan.json','candidate-set.json'):
            f=out/name
            if f.exists():f.unlink()
        out.rmdir();raise

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--plan',required=True);parser.add_argument('--plan-sha256',required=True)
    modes=parser.add_mutually_exclusive_group(required=True);modes.add_argument('--service',choices=list(c.hosted.SERVICES));modes.add_argument('--collect');modes.add_argument('--check',action='store_true');modes.add_argument('--check-fragments');modes.add_argument('--assembly')
    parser.add_argument('--metadata');parser.add_argument('--source');parser.add_argument('--output');parser.add_argument('--candidate');parser.add_argument('--candidate-sha256');parser.add_argument('--assembly-sha256');args=parser.parse_args();p,raw=load(args.plan,args.plan_sha256)
    if args.check:result={'kind':c.KIND,'identity':c.identity(p),'releaseReady':False,'productionReady':False,'buildStarted':False}
    elif args.check_fragments:result=check_fragments(p,raw,args.check_fragments,check_capacity=True)
    elif args.assembly:
        stage('ASSEMBLY_VERIFY')
        c.require(args.candidate and args.candidate_sha256 and args.assembly_sha256,'ASSEMBLY_INPUTS');candidate=Path(args.candidate);assembly=Path(args.assembly)
        for f,limit in [(candidate,256*1024),(assembly,16384)]:c.require(f.is_file() and not f.is_symlink() and f.stat().st_size<=limit,'ASSEMBLY_INPUT_FILE')
        result=c.offline_assembly(p,candidate.read_bytes(),args.candidate_sha256,assembly.read_bytes(),args.assembly_sha256,candidate.parent,args.plan_sha256)
    elif args.collect:c.require(args.output,'CANDIDATE_OUTPUT_REQUIRED');result=collect(p,raw,args.collect,args.output,args.metadata)
    else:c.require(args.source and args.output,'CANDIDATE_BUILD_INPUTS');result=produce(p,raw,args.source,args.output,args.service)
    print(__import__('json').dumps(result,sort_keys=True));return 2 if result.get('status')=='NOT_READY' else 0
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as error:print(json.dumps(diagnostic(error),sort_keys=True),file=sys.stderr);sys.exit(1)
