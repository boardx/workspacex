#!/usr/bin/env python3
"""Execute the canonical publication chunk sequence once under the outer entry.

No discovery, retries or commands from the runner. Exact root generation hashes
bind every command and its original order; per-command intent precedes fork.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('generated_entry',ROOT/'.harness/scripts/vm/cn-release-advance.py');e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
BASE=Path('/var/lib/workspacex-cn/release-generated')
APPROVALS=Path('/etc/workspacex-cn/release-approvals')


def run(release,*,executor=subprocess.run):
    e.need(e.HEX.fullmatch(release),'RELEASE_SHA')
    raw=e.read(APPROVALS/(release+'.json'));e.need(e.digest(raw)==release,'APPROVAL_HASH');a=e.decode(raw)
    e.need(e.digest(e.read(Path(__file__).resolve(),1048576))==a['codeFiles']['scripts/cn-release-generated-commands.py'],'CODE_PIN')
    root=BASE/release;folder=root/'acquire/publication';delegation=e.decode(e.read(folder/'delegation.json',1048576))
    e.need(delegation['releaseSha256']==release and delegation['phase']=='publication','GENERATION_IDENTITY')
    actions=delegation['actions'];selected=[x for x in actions if x['operation'].startswith('stage-')]
    e.need(selected and actions[:len(selected)]==selected and selected[-1]['operation']=='stage-assemble','STAGE_ORDER')
    stage=root/'stages/publication-stage';intent=e.decode(e.read(stage/'intent.json'))
    e.need(intent['releaseSha256']==release and intent['stage']=='publication-stage','GENERATION_INTENT')
    # Validate the complete ordered set before the first side effect. A later
    # corrupt chunk must not be discovered only after earlier chunks ran.
    prepared=[]
    for item in selected:
        name=item['parameters'];e.need(Path(name).name==name and name.endswith('.json'),'PARAMETER_NAME')
        parameters=e.read(folder/name,1048576);e.need(e.digest(parameters)==item['parametersSha256'],'PARAMETER_HASH')
        p=e.decode(parameters);command=p['CommandContent'].encode()
        e.need(e.digest(command)==item['commandSha256'] and 0<len(command)<=18000,'COMMAND_HASH')
        e.need(p['RegionId']=='cn-shanghai' and p['InstanceId.1']=='i-uf6ga92ewloganobbln6' and p['Username']=='root' and p['RepeatMode']=='Once' and p['WorkingDir']=='/','TARGET')
        prepared.append((item,parameters,command))
    last=None
    for index,(item,parameters,command) in enumerate(prepared):
        e.need(e.read(folder/item['parameters'],1048576)==parameters,'PARAMETERS_CHANGED_AFTER_PREFLIGHT')
        remaining=(e.instant(a['identity']['deadlineAt'])-e.now()).total_seconds();e.need(remaining>0,'RELEASE_DEADLINE')
        prefix=stage/('command-%03d'%index)
        # Existing intent is never consumed as permission to retry, even when a
        # previous shell returned no stdout or a completed receipt was lost.
        e.create(Path(str(prefix)+'.intent.json'),e.encode({'releaseSha256':release,'index':index,'parametersSha256':e.digest(parameters)}))
        result=executor(['/bin/bash','-s'],input=command,capture_output=True,cwd='/',env=e.ENV,
                        timeout=min(float(item['timeoutSeconds']),remaining),check=False)
        e.need(result.returncode==0 and 0<len(result.stdout)<=e.MAX,'COMMAND_UNKNOWN_OR_FAILED')
        e.create(Path(str(prefix)+'.evidence.json'),result.stdout)
        e.create(Path(str(prefix)+'.receipt.json'),e.encode({'index':index,'parametersSha256':e.digest(parameters),'evidenceSha256':e.digest(result.stdout)}))
        last=result.stdout
    return last

if __name__=='__main__':
    try:
        e.need(os.geteuid()==0 and len(sys.argv)==2,'ROOT_RELEASE_REQUIRED');sys.stdout.buffer.write(run(sys.argv[1]))
    except Exception:
        print('{"status":"UNKNOWN_RECONCILE_REQUIRED","automaticRetry":false}',file=sys.stderr);sys.exit(1)
