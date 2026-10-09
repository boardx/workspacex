#!/usr/bin/env python3
"""候选五镜像构建/收集；无 registry push、Redis 拉取或生产操作。"""
import argparse
from datetime import datetime,timedelta,timezone
import importlib.util
import io
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

def load(path,expected):
    p=Path(path);c.require(p.is_file() and not p.is_symlink() and p.stat().st_size<=16384,'CANDIDATE_PLAN_FILE')
    raw=p.read_bytes();c.require(a.sha(raw)==expected,'CANDIDATE_PLAN_RAW_HASH');return c.validate_plan(a.decode(raw)),raw

def control(p,command=h.run):
    root=Path(__file__).resolve().parent.parent
    c.require(command(['git','rev-parse','HEAD'],root).decode().strip()==p['controlRevision'],'CANDIDATE_CONTROL_SHA')
    c.require(not command(['git','status','--porcelain','--untracked-files=all'],root).strip(),'CANDIDATE_CONTROL_DIRTY')
    for f in ('scripts/cn_image_candidate.py','scripts/build-cn-image-candidates.py','scripts/cn_image_archive.py','scripts/hosted-release.py','scripts/export-cn-image-archives.py'):
        c.require((root/f).read_bytes()==command(['git','show',p['controlRevision']+':'+f],root),'CANDIDATE_CONTROL_BYTES')

def normalize(saved,target,p,service):
    c.require(Path(saved).stat().st_size<=p['maxArchiveBytes'],'CANDIDATE_SAVE_LIMIT')
    with tarfile.open(saved,'r:') as source:
        ix=a.members(source);c.require('manifest.json' in ix,'CANDIDATE_MANIFEST')
        m=a.decode(a.small_member(source,ix['manifest.json']));c.require(type(m) is list and len(m)==1,'CANDIDATE_ONE_IMAGE')
        v=m[0];c.require(type(v) is dict and set(v)=={'Config','RepoTags','Layers'} and v['RepoTags']==[c.tag(p,service)] and type(v['Layers']) is list,'CANDIDATE_SAVE_MANIFEST')
        names=[v['Config'],*v['Layers']];c.require(1<len(names)<=129 and len(names)==len(set(names)),'CANDIDATE_SAVE_LAYERS')
        for n in names:a.safe_name(n);c.require(n in ix and ix[n].isfile(),'CANDIDATE_SAVE_MEMBER')
        with open(target,'xb') as stream,tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT) as out:
            for n in names:
                header=tarfile.TarInfo(n);header.size=ix[n].size;header.mode=0o644
                with source.extractfile(ix[n]) as payload:out.addfile(header,payload)
            raw=a.json_bytes(m);header=tarfile.TarInfo('manifest.json');header.size=len(raw);header.mode=0o644;out.addfile(header,io.BytesIO(raw))
    return c.inspect(target,p,service)

def produce(p,raw,source,output,service,command=h.run):
    c.validate_plan(p);c.require(service in c.hosted.SERVICES,'CANDIDATE_SERVICE');control(p,command)
    source=Path(source);c.require(command(['git','rev-parse','HEAD'],source).decode().strip()==c.SOURCE,'CANDIDATE_SOURCE_SHA')
    c.require(not command(['git','status','--porcelain','--untracked-files=all'],source).strip(),'CANDIDATE_SOURCE_DIRTY')
    command(['git','merge-base','--is-ancestor',c.SOURCE,'origin/main'],source)
    for v in p['sourceContracts'].values():c.require(a.sha(command(['git','show',c.SOURCE+':'+v['dockerfile']],source))==v['dockerfileSha256'],'CANDIDATE_DOCKERFILE_HASH')
    out=Path(output);c.require(not out.exists() and not out.is_symlink() and out.parent.is_dir(),'CANDIDATE_OUTPUT_EXISTS')
    c.require(shutil.disk_usage(out.parent).free>=4*p['maxArchiveBytes']+p['storageMarginBytes'] and os.statvfs(out.parent).f_favail>=4096,'CANDIDATE_CAPACITY')
    out.mkdir(mode=0o700)
    try:
        with tempfile.TemporaryDirectory(prefix='wsx-candidate-',dir=out.parent) as td:
            root=Path(td);savedsource=root/'source.tar';command(['git','archive','--format=tar','--output',str(savedsource),c.SOURCE],source)
            checkout=root/'source';checkout.mkdir()
            with tarfile.open(savedsource,'r:') as t:t.extractall(checkout,filter='data')
            v=p['sourceContracts'][service];argv=['docker','buildx','build','--load','--platform',p['platform'],'--label','org.opencontainers.image.revision='+c.SOURCE,'--label',c.LABEL+'='+c.identity(p),'-f',str(checkout/v['dockerfile']),'-t',c.tag(p,service)]
            for base in v['bases']:argv+=['--build-arg',{'node':'NODE_IMAGE','python':'PYTHON_IMAGE','postgres':'PGVECTOR_IMAGE'}[base]+'='+p['baseImages'][base]]
            argv+=['--build-arg','SOURCE_REVISION='+c.SOURCE,str(checkout/v['context'])];command(argv)
            saved=root/'save.tar';command(['docker','image','save','--output',str(saved),c.tag(p,service)])
            target=out/(service+'.tar');meta=normalize(saved,target,p,service);size,digest=a.file_digest(target,p['maxArchiveBytes'])
        now=datetime.now(timezone.utc);receipt={'kind':c.KIND,'schemaVersion':2,'planRawSha256':a.sha(raw),'planSha256':a.sha(a.json_bytes(p)),'identity':c.identity(p),'attemptId':p['attemptId'],'producedAt':now.isoformat(),'expiresAt':(now+timedelta(hours=1)).isoformat(),'images':{service:{'file':service+'.tar','size':size,'sha256':digest,**meta}},'releaseReady':False,'productionReady':False}
        (out/'candidate-plan.json').write_bytes(raw);(out/'candidate-fragment.json').write_bytes(a.json_bytes(receipt));return receipt
    except BaseException:
        shutil.rmtree(out);raise

def collect(p,raw,folder,output):
    control(p);root=Path(folder);out=Path(output)
    c.require(root.is_dir() and not root.is_symlink() and not out.exists() and not out.is_symlink() and out.parent.is_dir(),'CANDIDATE_COLLECTION_PATH')
    c.require(root.stat().st_dev==out.parent.stat().st_dev,'CANDIDATE_COLLECTION_FILESYSTEM')
    c.require(shutil.disk_usage(out.parent).free>=p['storageMarginBytes'] and os.statvfs(out.parent).f_favail>=4096,'CANDIDATE_COLLECTION_CAPACITY')
    c.require({x.name for x in root.iterdir()}==set(c.hosted.SERVICES),'CANDIDATE_COLLECTION_FIVE')
    images={};issued=[];expires=[]
    for service in c.hosted.SERVICES:
        directory=root/service;c.require(directory.is_dir() and not directory.is_symlink(),'CANDIDATE_FRAGMENT_DIRECTORY')
        c.require({x.name for x in directory.iterdir()}=={service+'.tar','candidate-plan.json','candidate-fragment.json'},'CANDIDATE_FRAGMENT_FILES')
        for name,limit in [('candidate-plan.json',16384),('candidate-fragment.json',256*1024)]:
            f=directory/name;c.require(f.is_file() and not f.is_symlink() and f.stat().st_size<=limit,'CANDIDATE_FRAGMENT_METADATA')
        c.require((directory/'candidate-plan.json').read_bytes()==raw,'CANDIDATE_PLAN_ORIGINAL_BYTES')
        fragment=(directory/'candidate-fragment.json').read_bytes();v=c.verify_bundle(directory,p,fragment,a.sha(fragment),a.sha(raw),complete=False)
        c.require(set(v['images'])=={service},'CANDIDATE_FRAGMENT_SERVICE')
        images.update(v['images']);issued.append(a.timestamp(v['producedAt']));expires.append(a.timestamp(v['expiresAt']))
    receipt={'kind':c.KIND,'schemaVersion':2,'planRawSha256':a.sha(raw),'planSha256':a.sha(a.json_bytes(p)),'identity':c.identity(p),'attemptId':p['attemptId'],'producedAt':min(issued).isoformat(),'expiresAt':min(expires).isoformat(),'images':images,'releaseReady':False,'productionReady':False}
    c.require(sum(x['size'] for x in images.values())<=p['maxTotalBytes'],'CANDIDATE_COLLECTION_TOTAL')
    out.mkdir(mode=0o700);moved=[]
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
    modes=parser.add_mutually_exclusive_group(required=True);modes.add_argument('--service',choices=list(c.hosted.SERVICES));modes.add_argument('--collect');modes.add_argument('--check',action='store_true');modes.add_argument('--assembly')
    parser.add_argument('--source');parser.add_argument('--output');parser.add_argument('--candidate');parser.add_argument('--candidate-sha256');parser.add_argument('--assembly-sha256');args=parser.parse_args();p,raw=load(args.plan,args.plan_sha256)
    if args.check:result={'kind':c.KIND,'identity':c.identity(p),'releaseReady':False,'productionReady':False,'buildStarted':False}
    elif args.assembly:
        c.require(args.candidate and args.candidate_sha256 and args.assembly_sha256,'ASSEMBLY_INPUTS');candidate=Path(args.candidate);assembly=Path(args.assembly)
        for f,limit in [(candidate,256*1024),(assembly,16384)]:c.require(f.is_file() and not f.is_symlink() and f.stat().st_size<=limit,'ASSEMBLY_INPUT_FILE')
        result=c.offline_assembly(p,candidate.read_bytes(),args.candidate_sha256,assembly.read_bytes(),args.assembly_sha256,candidate.parent,args.plan_sha256)
    elif args.collect:c.require(args.output,'CANDIDATE_OUTPUT_REQUIRED');result=collect(p,raw,args.collect,args.output)
    else:c.require(args.source and args.output,'CANDIDATE_BUILD_INPUTS');result=produce(p,raw,args.source,args.output,args.service)
    print(__import__('json').dumps(result,sort_keys=True));return 2 if result.get('status')=='NOT_READY' else 0
if __name__=='__main__':
    try:sys.exit(main())
    except Exception:print('CN_IMAGE_CANDIDATE_REJECTED',file=sys.stderr);sys.exit(1)
