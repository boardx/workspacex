#!/usr/bin/env python3
"""Run isolated tests from a root-owned local clone of the exact CI checkout."""
import argparse
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile


def absolute_directory(value):
    path=Path(value)
    if not path.is_absolute() or path.resolve(strict=True)!=path or not path.is_dir():
        raise ValueError('CI_DIRECTORY_MUST_BE_CANONICAL_ABSOLUTE')
    return path


def execute(sha,rounds,seed):
    if not re.fullmatch('[a-f0-9]{40}',sha):raise ValueError('CI_EXACT_SHA_REQUIRED')
    if rounds not in (1,10):raise ValueError('CI_ROUNDS_REQUIRED')
    if sys.platform!='linux' or os.geteuid()!=0:raise ValueError('CI_LINUX_ROOT_REQUIRED')
    source=absolute_directory(os.environ['GITHUB_WORKSPACE'])
    temporary=absolute_directory(os.environ['RUNNER_TEMP'])
    if not (source/'.git').is_dir() or (source/'.git').is_symlink():raise ValueError('CI_LOCAL_CHECKOUT_REQUIRED')
    # No global Git configuration, cloud/GitHub credentials, hooks or network.
    owned=Path(tempfile.mkdtemp(prefix='wsx-cn-simulation-',dir='/var/lib'))
    try:
        owned.chmod(0o700);home=owned/'home';home.mkdir(mode=0o700)
        env={'PATH':os.environ.get('PATH',os.defpath),'HOME':str(home),'LANG':'C.UTF-8',
             'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null',
             'GIT_TERMINAL_PROMPT':'0','GIT_ALLOW_PROTOCOL':'file','PYTHONDONTWRITEBYTECODE':'1'}
        git=['/usr/bin/git','-c','safe.directory='+str(source),'-c','safe.directory='+str(source/'.git'),'-c','core.hooksPath=/dev/null']
        def read(*args):return subprocess.check_output([*git,*args],env=env,text=True,timeout=60).strip()
        if read('-C',str(source),'rev-parse','HEAD')!=sha:raise ValueError('CI_SOURCE_HEAD_CHANGED')
        if read('-C',str(source),'status','--porcelain','--untracked-files=all'):raise ValueError('CI_SOURCE_NOT_CLEAN')
        tree=read('-C',str(source),'rev-parse',sha+'^{tree}')
        checkout=owned/'checkout'
        subprocess.run([*git,'clone','--no-hardlinks','--no-checkout','--',str(source),str(checkout)],env=env,check=True,timeout=120)
        subprocess.run([*git,'-C',str(checkout),'checkout','--detach',sha],env=env,check=True,timeout=60)
        if read('-C',str(checkout),'rev-parse','HEAD')!=sha or read('-C',str(checkout),'rev-parse','HEAD^{tree}')!=tree:raise ValueError('CI_CLONE_IDENTITY_CHANGED')
        if read('-C',str(checkout),'status','--porcelain','--untracked-files=all'):raise ValueError('CI_CLONE_NOT_CLEAN')
        for parent in (checkout,*checkout.parents):
            info=parent.stat()
            if info.st_uid!=0 or info.st_gid!=0 or info.st_mode&0o022:raise ValueError('CI_CLONE_ANCESTOR_UNTRUSTED')
        for key in ('CN_ARCHIVE_TEST_NODE','CN_ARCHIVE_TEST_RUNTIME','CN_TEST_PLAYWRIGHT','CN_TEST_CHROMIUM','NODE_PATH','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'):
            if key in os.environ:env[key]=os.environ[key]
        return subprocess.run([sys.executable,'-I','-B',str(checkout/'scripts/cn-release-simulation.py'),
            '--output',str(temporary/'cn-simulation'),'--workers','3','--timeout-seconds','300',
            '--rounds',str(rounds),'--seed',str(seed)],cwd=checkout,env=env).returncode
    finally:
        # This invocation created exactly this root; never chown/chmod source.
        shutil.rmtree(owned)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sha',required=True);parser.add_argument('--rounds',type=int,choices=(1,10),default=1);parser.add_argument('--seed',type=int,default=0)
    args=parser.parse_args();return execute(args.sha,args.rounds,args.seed)


if __name__=='__main__':sys.exit(main())
