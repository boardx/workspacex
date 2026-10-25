#!/usr/bin/env python3
"""Root-only additive tag upgrade, preserving installed environment adapters.

Run from a root-owned staged directory containing the reviewed registry-images.py.
Retains the old closure and config snapshots for operator recovery; changes no services.
"""
import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import socket
import tempfile


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def atomic(path,data,mode):
    fd,name=tempfile.mkstemp(dir=path.parent,prefix='.short-tag-')
    try:
        os.fchmod(fd,mode)
        with os.fdopen(fd,'wb') as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)


def install(environment):
    assert os.geteuid()==0
    expected={'devapp':'iZrj94o0jq479xfhoa83xoZ','cn':'workspacex-cn-prod'}
    assert socket.gethostname()==expected[environment], 'WRONG_HOST'
    config_path=Path('/etc/workspacex-image-release')/(environment+'.json')
    config=json.loads(config_path.read_bytes())
    assert config['environment']==environment
    wrapper=Path('/usr/local/bin/workspacex-image-release')
    text=wrapper.read_text()
    paths=[Path(v) for v in shlex.split(text.splitlines()[1]) if v.endswith('/deploy-registry-images.py')]
    assert len(paths)==1
    old=paths[0].parent
    new=old.parent/(environment+'-short-tags-5925-'+digest(Path(__file__).with_name('registry-images.py'))[:12])
    lock=os.open(config['lockFile'],os.O_RDONLY|os.O_NOFOLLOW)
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    assert not (Path(config['stateDirectory'])/'pending.json').exists(), 'PENDING_DEPLOYMENT'
    assert not new.exists(), 'ALREADY_STAGED_REVIEW_BEFORE_RETRY'
    shutil.copytree(old,new,ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copyfile(Path(__file__).with_name('registry-images.py'),new/'registry-images.py')
    consumer=new/'deploy-registry-images.py';code=consumer.read_text()
    assert code.count("'sourceRevision':tag[:40]")==2, 'UNEXPECTED_CONSUMER_VERSION'
    marker="        attempt=state/('attempt-'+uuid.uuid4().hex);attempt.mkdir(mode=0o700)"
    assert code.count(marker)==1
    source_check="\n".join([
        "        sources=[image.get('sourceRevision') for image in images.values()]",
        "        registry.need(all(isinstance(source,str) and registry.SHA.fullmatch(source) for source in sources) and len(set(sources))==1,'IMAGE_SOURCE_MISMATCH')",
        "        source=sources[0]",
    ])
    code=code.replace(marker,source_check+'\n'+marker).replace("'sourceRevision':tag[:40]","'sourceRevision':source")
    consumer.write_text(code)
    admission_old=Path(config['admissionCommand'][0])
    assert admission_old.is_relative_to(old), 'ADAPTER_OUTSIDE_CLOSURE'
    admission=new/admission_old.relative_to(old)
    code=admission.read_text()
    patterns=('[0-9a-f]{40}-[0-9]+-[0-9]+','[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*')
    changed=False
    for pattern in patterns:
        if pattern in code:
            code=code.replace(pattern,r'(?:[a-f0-9]{40}-)?[1-9][0-9]*-[1-9][0-9]*');changed=True
    assert changed, 'UNREVIEWED_ADMISSION_PATTERN'
    code=code.replace(str(old),str(new));admission.write_text(code)
    for path in new.glob('*.py'): ast.parse(path.read_text())
    for path in new.rglob('*'):
        assert not path.is_symlink(), 'CLOSURE_SYMLINK'
        if path.is_file(): os.chmod(path,0o755 if os.access(path,os.X_OK) else 0o644)
    policy_path=Path('/etc/workspacex-image-release')/(environment+'-admission.json')
    policy=json.loads(policy_path.read_bytes())
    def remap(value):
        if isinstance(value,list): return [remap(v) for v in value]
        if isinstance(value,dict):
            result={k:remap(v) for k,v in value.items()}
            if 'path' in result and 'sha256' in result and result['path'].startswith(str(new)+'/'):
                result['sha256']=digest(Path(result['path']))
            return result
        return value.replace(str(old),str(new)) if isinstance(value,str) else value
    policy=remap(policy);config=remap(config)
    backup=Path('/root')/(environment+'-short-tags-5925-backup');backup.mkdir(mode=0o700)
    for path in (wrapper,config_path,policy_path): shutil.copy2(path,backup/path.name)
    atomic(policy_path,(json.dumps(policy,indent=2)+'\n').encode(),0o600)
    for item in config.get('verificationFiles',[]):
        if item['path']==str(policy_path): item['sha256']=digest(policy_path)
    atomic(config_path,(json.dumps(config,indent=2)+'\n').encode(),0o600)
    atomic(wrapper,text.replace(str(old),str(new)).encode(),0o755)
    print(json.dumps({'status':'SHORT_TAG_CONSUMER_INSTALLED','environment':environment,'closure':str(new),'backup':str(backup)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('environment',choices=('cn','devapp'))
    install(parser.parse_args().environment)
