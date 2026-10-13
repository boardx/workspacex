#!/usr/bin/env python3
"""Offline package/installation-plan producer. Never creates host authority."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cn_entry', ROOT/'.harness/scripts/vm/cn-release-advance.py')
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)


def command(path):
    value = e.decode(Path(path).read_bytes())
    expected = {'RegionId':'cn-shanghai','InstanceId.1':'i-uf6ga92ewloganobbln6',
                'Type':'RunShellScript','ContentEncoding':'PlainText','WorkingDir':'/',
                'Username':'root','RepeatMode':'Once','KeepCommand':'false','EnableParameter':'false'}
    e.need(set(value) == set(expected) | {'Name','CommandContent','Timeout'}, 'COMMAND_FIELDS')
    e.need(all(value[k] == v for k,v in expected.items()), 'COMMAND_TARGET_OR_SCOPE')
    e.need(isinstance(value['CommandContent'],str), 'COMMAND_CONTENT')
    raw=value['CommandContent'].encode()
    e.need(0 < len(raw) <= 18000 and '\x00' not in value['CommandContent'], 'COMMAND_LIMIT')
    e.need(isinstance(value['Timeout'],str) and value['Timeout'].isdigit() and 1 <= int(value['Timeout']) <= 1200, 'COMMAND_TIMEOUT')
    return raw,int(value['Timeout'])


def package(identity_path, action_path, observer_path, verifier_path, authorization_path, output):
    identity=e.decode(Path(identity_path).read_bytes())
    action,timeout=command(action_path)
    observer,observer_timeout=command(observer_path)
    e.need(observer_timeout <= 120, 'OBSERVER_TOO_LONG')
    verifier=Path(verifier_path).read_bytes();authorization=Path(authorization_path).read_bytes()
    e.need(len(verifier) <= e.MAX and len(authorization) <= e.MAX, 'PACKAGE_FILE_LIMIT')
    compile(verifier,'<reviewed-verifier>','exec')
    manifest={**identity,'timeoutSeconds':timeout,'actionSha256':e.digest(action),
              'observerSha256':e.digest(observer),'verifierSha256':e.digest(verifier),
              'authorizationEvidenceSha256':e.digest(authorization)}
    raw=e.encode(manifest);sha=e.digest(raw)
    output=Path(output);output.mkdir(mode=0o700)
    files={'manifest.json':raw,'action.sh':action,'observe.sh':observer,'verify.py':verifier,'authorization.json':authorization}
    for name,data in files.items():
        with (output/name).open('xb') as f:
            os.chmod(f.name,0o600);f.write(data)
    # Package production shape is checked again by the fixed root entry. Local
    # preparation confers no root authority, even when all hashes are valid.
    return {'requestSha256':sha,'files':{k:e.digest(v) for k,v in files.items()},
            'targetDirectory':'/etc/workspacex-cn/continuation-requests/'+sha,
            'rootInstallationRequired':True,'dispatchAuthorized':False,'cloudCalls':0}


def installation_plan(probe_path):
    """Exact new bytes, with explicitly unproven old-state CAS when not observed."""
    probe=e.decode(Path(probe_path).read_bytes())
    source=ROOT/'.harness/scripts/vm/cn-release-advance.py'
    sha=e.digest(source.read_bytes());target='/usr/local/bin/workspacex-cn-release-advance'
    observed=[v for v in probe.get('wrappers',probe.get('targets',[])) if v.get('path')==target]
    old=observed[0] if len(observed)==1 else None
    script_names=('cn-release-orchestrate.py','cn-release-continuation-bind.py','cn-release-continuation-acquire.py','cn-release-continuation-finalize.py','cn-release-derived-approval.py','cn-release-continuation-journal.py','cn-release-runtime-readback.py','cn-release-fixed-driver.py','cn-release-stage-router.py','cn-release-stage-contract.py','cn-release-generated-commands.py','cn-release-acquire-delegation.py','cn-release-acquire-observer.py','cn-release-publication-observer.py','cn-release-runtime-delegation.py','cn-release-runtime-stage.py','cn-release-runtime-observe.py','cn-release-terminal-delegation.py','cn-release-rds-backup.py','cn-release-business-observer.py','cn-release-business-state.py','cn-release-business-recovery.py','cn-release-recovery-writer.py','cn-release-recovery-admission.py','cn-release-recovery-driver.py','cn-release-recovery-contract.py')
    relative=[Path('scripts')/name for name in script_names]
    relative += [Path(n) for n in ('.harness/scripts/vm/cn-release-advance.py','packages/cloud-deploy/src/cn-release-browser-contract.ts','packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract.ts','.harness/scripts/vm/cn-maintenance-browser.cjs','scripts/cn-release-business-runner.ts','scripts/cn-release-business-entry.ts','scripts/build-cn-business-runtime.cjs')]
    relative += [p.relative_to(ROOT) for p in (ROOT/'.harness/scripts/vm/cn-runtime-continuation').rglob('*') if p.is_file() and '__pycache__' not in p.parts]
    inventory={str(p):e.digest((ROOT/p).read_bytes()) for p in sorted(relative)}
    bundle_sha=e.digest(e.encode(inventory))
    bundle_root='/usr/local/lib/workspacex-cn/continuation-control/'+bundle_sha
    driver_wrapper=('#!/bin/sh\nexec /usr/bin/python3 -I -B '+bundle_root+'/scripts/cn-release-fixed-driver.py \"$@\"\n').encode()
    recovery_wrapper=('#!/bin/sh\nexec /usr/bin/python3 -I -B '+bundle_root+'/scripts/cn-release-recovery-driver.py \"$@\"\n').encode()
    return {'schemaVersion':1,'kind':'cn-continuation-installation-plan-v1',
            'oldStateObservation':{'rawSha256':e.digest(Path(probe_path).read_bytes()),'observedAt':probe.get('observedAt')},
            'files':[{'source':str(source.relative_to(ROOT)),'target':target,'newSha256':sha,
                      'uid':0,'gid':0,'mode':'0700','expectedOldSha256':old.get('sha256') if old else None,
                      'oldStateVerified':bool(old and (old.get('hashStatus')=='HASHED' or old.get('exists') is False)),
                      'expectedOldAbsent':bool(old and old.get('exists') is False)}],
            'controlBundle':{'sha256':bundle_sha,'targetRoot':bundle_root,'expectedOldAbsent':True,'oldStateVerified':False,
                'files':[{'path':p,'sha256':h,'mode':'0600','uid':0,'gid':0} for p,h in inventory.items()]},
            'fixedDriver':{'target':'/usr/local/bin/workspacex-cn-fixed-release','sha256':e.digest(driver_wrapper),'bytesBase64':__import__('base64').b64encode(driver_wrapper).decode(),'uid':0,'gid':0,'mode':'0700','oldStateVerified':False,'expectedOldAbsent':None,'sudoRule':'ghrunner ALL=(root) NOPASSWD: /usr/local/bin/workspacex-cn-fixed-release *','rootApprovalRequired':True},
            'fixedRecoveryDriver':{'target':'/usr/local/bin/workspacex-cn-fixed-recovery','sha256':e.digest(recovery_wrapper),'bytesBase64':__import__('base64').b64encode(recovery_wrapper).decode(),'uid':0,'gid':0,'mode':'0700','oldStateVerified':False,'expectedOldAbsent':None,'sudoRule':'ghrunner ALL=(root) NOPASSWD: /usr/local/bin/workspacex-cn-fixed-recovery *','rootApprovalRequired':True,'freshRecoveryApprovalRequired':True},
            'externalClosures':{'rdsSdk':'Exact pinned private SDK and CreateBackup/DescribeBackups/DescribeBackupTasks capability approval required','businessRuntime':'Pinned Node, Python, Chromium, private Playwright tree and scoped test data/secret plan required','canonicalControlRepository':'Root-owned exact Git control checkout at /usr/local/lib/workspacex-cn/release-control required; no runner checkout import','approvalMaxBytes':65536,'finalPopulatedApprovalSizeVerified':False},
            'seal':{'target':'/etc/workspacex-cn/continuation-entry-install.json','mode':'0600',
                    'bytesBase64':__import__('base64').b64encode(e.encode({'schemaVersion':1,'entrySha256':sha})).decode()},
            'sudoRule':'ghrunner ALL=(root) NOPASSWD: /usr/local/bin/workspacex-cn-release-advance *',
            'sudoTarget':'/etc/sudoers.d/workspacex-cn-release-advance',
            'directories':['/etc/workspacex-cn/continuation-requests','/etc/workspacex-cn/continuation-approvals','/var/lib/workspacex-cn/continuation','/etc/workspacex-cn/release-approvals','/etc/workspacex-cn/runtime-readback-approvals','/etc/workspacex-cn/continuation-finalize-approvals','/var/lib/workspacex-cn/continuation-evidence','/var/lib/workspacex-cn/continuation-derived-requests','/var/lib/workspacex-cn/release-driver','/var/lib/workspacex-cn/release-generated','/var/lib/workspacex-cn/release-inputs','/etc/workspacex-cn/acquire-observers','/etc/workspacex-cn/publication-observers','/etc/workspacex-cn/runtime-observer-approvals','/etc/workspacex-cn/writer-resume-approvals','/etc/workspacex-cn/writer-resume-approvals/by-release','/etc/workspacex-cn/recovery-writer-resume-approvals','/etc/workspacex-cn/recovery-writer-resume-approvals/by-recovery','/etc/workspacex-cn/release-recovery-approvals','/etc/workspacex-cn/release-recovery-approvals/by-failed-request'],
            'processIsolation':{'kind':'cgroup-v2','root':'/sys/fs/cgroup/workspacex-cn-continuation','requiresCgroupKill':True,'runtimeCreationAndCleanupRequiresApproval':True},
            'ecsIamDelta':[],'oidcTrustDelta':[],
            'requiresSeparateApproval':True,'installationReady':False,
            'blockers':['REVIEW_EXACT_PACKAGE_AND_VERIFIER','FRESH_OLD_STATE_CAS_REQUIRED','APPROVED_INSTALLATION_REQUIRED','TOOL_CLOSURE_AND_RDS_CAPABILITY_READBACK_REQUIRED','LINUX_CGROUP_CAPABILITY_TEST_REQUIRED','REAL_EXTERNAL_TERMINAL_OBSERVERS_REQUIRED'],
            'cloudCalls':0}


def main():
    p=argparse.ArgumentParser(description=__doc__);commands=p.add_subparsers(dest='mode',required=True)
    q=commands.add_parser('package')
    for arg in ('identity','action','observer','verifier','authorization','output'):q.add_argument('--'+arg,required=True)
    q=commands.add_parser('installation-plan');q.add_argument('--probe',required=True)
    a=p.parse_args()
    try:
        result=installation_plan(a.probe) if a.mode=='installation-plan' else package(a.identity,a.action,a.observer,a.verifier,a.authorization,a.output)
        print(json.dumps(result,sort_keys=True));return 0
    except Exception:
        print('{"status":"REJECTED","dispatchAuthorized":false,"cloudCalls":0}');return 1


if __name__=='__main__':sys.exit(main())
