#!/usr/bin/env python3
"""Offline packaging of retained evidence. Outputs proposals, never installs authority."""
import argparse,importlib.util,json,os
from pathlib import Path
s=importlib.util.spec_from_file_location('portal',Path(__file__).with_name('cn-release-mvp-evidence.py'));E=importlib.util.module_from_spec(s);s.loader.exec_module(E)
def prepare(mode,payload,originals,installed_approval=None):
    E.selector(mode,payload);pin=E.sha(E.encode(payload));root=E.ROOT
    required={'approval','binding'} if mode=='approval' else {'receipts','binding'}|{'evidence-'+stage for stage in E.module().STAGES}
    E.need(set(originals)==required and all(isinstance(b,bytes)and 0<len(b)<=65536 for b in originals.values()),'ORIGINAL_CLOSURE')
    refs={};files={};readable={}
    for key,raw in originals.items():
        name=E.sha(raw)+'.json';refs[key]={'name':name,'sha256':E.sha(raw)}
        files['objects/'+name]=raw;readable[root/'objects'/name]=raw
    record=E.encode({'kind':'cn-mvp-root-evidence-record-v1','selector':payload,'files':refs})
    files[pin+'.json']=record;files['selectors/'+pin+'.json']=E.encode(payload);readable[root/(pin+'.json')]=record
    if mode=='approval':
        E.need(isinstance(installed_approval,bytes) and installed_approval==originals['approval'],'ORIGINAL_INSTALLED_APPROVAL_REQUIRED')
        readable[Path('/etc/workspacex-cn/release-approvals')/(E.sha(installed_approval)+'.json')]=installed_approval
    verified=E.resolve(mode,payload,pin,readable.__getitem__,root,structural_only=True)
    report={'kind':'cn-mvp-evidence-package-proposal-v1','mode':mode,'selectorSha256':pin,
            'files':{name:E.sha(raw) for name,raw in files.items()},'authorityGranted':False,
            'installed':False,'liveProviderProvenanceVerified':False,'productionAccepted':False,
            'validatedResultKind':verified['kind']}
    return files,report
def write_proposal(folder,files,report):
    folder=Path(folder);folder.mkdir(mode=0o700,parents=False,exist_ok=False)
    for name,raw in dict(files,**{'proposal.json':E.encode(report)}).items():
        path=folder/name;path.parent.mkdir(mode=0o700,exist_ok=True)
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
def main():
    p=argparse.ArgumentParser();p.add_argument('mode',choices=('approval','terminal'));p.add_argument('--selector',required=True);p.add_argument('--original-manifest',required=True);p.add_argument('--installed-approval');p.add_argument('--output',required=True);args=p.parse_args()
    try:
        manifest=json.loads(Path(args.original_manifest).read_bytes());originals={}
        for name,ref in manifest.items():
            raw=Path(ref['path']).read_bytes();E.need(E.sha(raw)==ref['sha256'],'ORIGINAL_BYTES_CHANGED');originals[name]=raw
        approved=Path(args.installed_approval).read_bytes()if args.installed_approval else None
        files,report=prepare(args.mode,json.loads(Path(args.selector).read_bytes()),originals,approved)
        # This proposal command is unprivileged; no production directory output.
        E.need(os.geteuid()!=0,'OFFLINE_UNPRIVILEGED_ONLY')
        write_proposal(args.output,files,report);print(json.dumps(report,sort_keys=True));return 0
    except (ValueError,KeyError,OSError,TypeError):
        print('{"status":"REJECTED","authorityGranted":false,"installed":false}');return 20
if __name__=='__main__':raise SystemExit(main())
