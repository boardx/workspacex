"""Isolated PG adapter using the unmodified durable entry execution algorithm.

Not installed by the production CLI. No cloud target or production acceptance.
"""
import argparse
from contextlib import contextmanager
import base64
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import re
import stat
import sys
import time
import uuid
import tempfile


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def verifier_source(expected_sequence=1, expected_previous=None, expected_epoch=None, expected_seed=None):
    return ('EXPECTED_SEQUENCE=%r\nEXPECTED_PREVIOUS=%r\nEXPECTED_EPOCH=%r\nEXPECTED_SEED=%r\n' % (expected_sequence,expected_previous,expected_epoch,expected_seed)).encode() + b'''import base64,hashlib,json

def verify(raw,manifest,previous,mode):
    value=json.loads(raw)
    assert value['kind']=='isolated-pg-phase-receipt-v1'
    assert value['scope']=='fixture-only' and value['phase']==manifest['stage']
    assert value['verified'] is True and value['terminal'] is True
    assert isinstance(value['epoch'],str) and len(value['epoch'])==36
    assert value['sequence']==EXPECTED_SEQUENCE and value['previousPhaseSha256']==EXPECTED_PREVIOUS
    assert EXPECTED_EPOCH is None or value['epoch']==EXPECTED_EPOCH
    assert value['seed']==EXPECTED_SEED
    assert value['expectedFaultScenario'] == (manifest['stage'] in ('migration-fault','startup-fault','postclear-fault'))
    for item in value['journalRecords']:
        data=base64.b64decode(item['rawBase64'],validate=True)
        assert hashlib.sha256(data).hexdigest()==item['sha256']
        observed=json.loads(data)
        assert observed['kind']=='synthetic-pg-lifecycle-event-v1'
        assert observed['epoch']==value['epoch'] and observed['seed']==EXPECTED_SEED
    return {'externalWritesTerminal':True} if mode=='terminal' else True
'''


@contextmanager
def isolated_cgroup(e):
    e.need(sys.platform=='linux' and os.geteuid()==0,'LINUX_ROOT_CGROUP_REQUIRED')
    rows=[line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::')]
    e.need(len(rows)==1 and rows[0].startswith('/') and '..' not in Path(rows[0]).parts,'CURRENT_CGROUP_REQUIRED')
    parent=Path('/sys/fs/cgroup')/rows[0].lstrip('/')
    e.need(parent.resolve(strict=True)==parent and (parent/'cgroup.procs').is_file(),'CURRENT_CGROUP_UNAVAILABLE')
    base=parent/('workspacex-ci-entry-'+uuid.uuid4().hex)
    base.mkdir(mode=0o700)
    st=base.lstat();identity=(st.st_dev,st.st_ino);old=e.CGROUP_BASE
    try:
        e.CGROUP_BASE=base;e.KillDomain.preflight()
        yield
    finally:
        e.CGROUP_BASE=old
        e.need(base.parent==parent and re.fullmatch('workspacex-ci-entry-[a-f0-9]{32}',base.name),'CGROUP_OWNERSHIP')
        current=base.lstat()
        e.need(stat.S_ISDIR(current.st_mode) and (current.st_dev,current.st_ino)==identity,'CGROUP_IDENTITY_CHANGED')
        fd=os.open(base/'cgroup.kill',os.O_WRONLY|os.O_NOFOLLOW)
        try:os.write(fd,b'1')
        finally:os.close(fd)
        deadline=time.monotonic()+5
        while 'populated 0' not in (base/'cgroup.events').read_text().splitlines() and time.monotonic()<deadline:time.sleep(.02)
        e.need('populated 0' in (base/'cgroup.events').read_text().splitlines(),'CGROUP_NOT_EMPTY')
        for child in base.iterdir():
            child_st=child.lstat();e.need(not stat.S_ISLNK(child_st.st_mode),'CGROUP_SYMLINK')
            if stat.S_ISDIR(child_st.st_mode):
                e.need(re.fullmatch('op-[a-f0-9]{32}',child.name) and 'populated 0' in (child/'cgroup.events').read_text().splitlines(),'CGROUP_CHILD_UNPROVEN')
                after=child.lstat();e.need((after.st_dev,after.st_ino)==(child_st.st_dev,child_st.st_ino),'CGROUP_CHILD_CHANGED');child.rmdir()
        current=base.lstat();e.need((current.st_dev,current.st_ino)==identity,'CGROUP_IDENTITY_CHANGED');base.rmdir()


def run(args):
    driver=module(Path(args.driver_source),'pg_fixture_fixed_driver')
    with isolated_cgroup(driver.e):return run_driver(args,driver)


def restore_failure_projection(e,root):
    """Read only fixed restore journals before the private temporary tree closes."""
    stem=root/'state'/'pg-lifecycle-fixture'/'02-restore'
    result={'kind':'pg-restore-terminal-diagnostic-v1','terminal':None,'process':None}
    try:
        value=e.decode(e.read(Path(str(stem)+'.terminal.json')))
        if (set(value)=={'reason','exitCode','stdoutSha256','processGroupStillPresent','finishedAt'}
            and value['reason'] in ('EXITED','TIMEOUT','OUTPUT_LIMIT','ISOLATION_UNPROVEN')
            and (value['exitCode'] is None or type(value['exitCode'])is int)
            and type(value['processGroupStillPresent'])is bool
            and re.fullmatch('[a-f0-9]{64}',value['stdoutSha256'])):
            result['terminal']={k:value[k]for k in ('reason','exitCode','stdoutSha256','processGroupStillPresent')}
    except Exception:pass
    try:
        value=e.decode(e.read(Path(str(stem)+'.process.json')))
        if set(value)=={'pid','isolation','requestSha256'} and type(value['pid'])is int and value['pid']>0 and re.fullmatch('[a-f0-9]{64}',value['requestSha256']):
            result['process']={'pid':value['pid'],'requestSha256':value['requestSha256']}
    except Exception:pass
    return result


def run_driver(args,driver):
    e = driver.e
    e.need(Path(args.entry_source).read_bytes() == Path(e.__file__).read_bytes(), 'ENTRY_SOURCE_CHANGED')
    config = Path(args.config).resolve(); cfg = json.loads(config.read_bytes())
    e.need(cfg['host'] == str(config.parent / 'socket') and cfg['user']=='fixture_owner'
           and cfg['database']=='postgres' and config.parent.name.startswith('wsx-pg-fixture-'), 'ISOLATED_PG_REQUIRED')
    for path in (args.node,args.loader,args.fixture):
        e.need(Path(path).is_absolute() and Path(path).is_file(), 'FIXTURE_FILE_REQUIRED')
    now = e.now(); end = now + dt.timedelta(minutes=10)
    identity = dict(sourceRevision=hashlib.sha1(Path(args.fixture).read_bytes()).hexdigest(),
                    baselineRevision='b'*40, controlRevision=hashlib.sha1(Path(args.entry_source).read_bytes()).hexdigest(),
                    attemptId='pg-lifecycle-fixture', requestedAt=now.isoformat(), deadlineAt=end.isoformat())
    approval = dict(kind='isolated-pg-driver-fixture-v1', identity={**identity,'publicationAttemptId':'fixture-no-publication'},
                    expiresAt=end.isoformat(),productionAccepted=False)
    authorization = e.encode(approval); release = e.digest(authorization)
    # Root Linux avoids sticky /tmp; production directory checks stay unchanged.
    with tempfile.TemporaryDirectory(prefix='wsx-pg-entry-',dir='/var/lib' if os.geteuid()==0 else str(Path.cwd())) as tmp:
        root=Path(tmp); (root/'requests').mkdir(mode=0o700); (root/'state').mkdir(mode=0o700)
        transport=e.IsolatedPostgresTransport(root,identity)
        requests={}
        class Router:
            def preflight(self,release_sha):
                e.need(release_sha==release,'FIXTURE_RELEASE_CHANGED')
                e.KillDomain.preflight()
            def admission(self,*_): return None
            def lookup(self,_,stage): return requests.get(stage)
            def generate(self,_,stage,previous):
                e.need(stage in transport.STAGES,'FIXTURE_PHASE')
                prefix=[args.node,'--import',args.loader,args.fixture,str(config)]
                index=transport.STAGES.index(stage); prior=None
                if index:
                    prior=e.read(root/'state'/identity['attemptId']/('%02d-%s.evidence.json'%(index-1,transport.STAGES[index-1])))
                files={'action.sh':('exec '+shlex.join(prefix+['--phase',stage])+'\n').encode(),
                       'observe.sh':('exec '+shlex.join(prefix+['--observe',stage])+'\n').encode(),
                       'verify.py':verifier_source(index+1,e.digest(prior) if prior else None,e.decode(prior)['epoch'] if prior else None,cfg['seed']),'authorization.json':authorization}
                manifest=dict(schemaVersion=1,**identity,scope=e.PG_SCOPE,stage=stage,previousReceiptSha256=previous,
                              issuedAt=now.isoformat(),expiresAt=end.isoformat(),timeoutSeconds=120)
                for filename,field in [('action.sh','actionSha256'),('observe.sh','observerSha256'),('verify.py','verifierSha256'),('authorization.json','authorizationEvidenceSha256')]:
                    manifest[field]=e.digest(files[filename])
                raw=e.encode(manifest); request=e.digest(raw); package=root/'requests'/request; package.mkdir(mode=0o700); e.fsync_dir(package.parent)
                for name,data in {**files,'manifest.json':raw}.items(): e.create(package/name,data)
                requests[stage]=request; return request
        router=Router()
        try:
            result=driver.coordinate(release,approval,router,transport=transport)
        except Exception:
            print('CN_PG_RESTORE_DIAGNOSTIC '+json.dumps(restore_failure_projection(e,root),sort_keys=True),file=sys.stderr,flush=True)
            raise
        e.need(result['status']=='CHAIN_COMPLETED','FIXTURE_CHAIN_INCOMPLETE')
        # Replay actual status/core checks, never dispatch SQL again.
        replay=driver.coordinate(release,approval,router,mode='status',transport=transport)
        e.need(replay==result,'FIXTURE_REPLAY_CHANGED')
        previous=None; epoch=None; raw_receipts=[]; evidence_sizes={}
        for index,phase in enumerate(transport.STAGES):
            stem=root/'state'/identity['attemptId']/('%02d-%s'% (index,phase))
            raw=e.read(Path(str(stem)+'.evidence.json')); value=e.decode(raw)
            evidence_sizes[phase]=len(raw); e.need(len(raw)<=e.MAX,'PHASE_EVIDENCE_LIMIT')
            e.need(value['previousPhaseSha256']==previous and value['sequence']==index+1,'PHASE_CHAIN_CHANGED')
            epoch=value['epoch'] if epoch is None else epoch; e.need(epoch==value['epoch'],'EPOCH_CHANGED')
            previous=e.digest(raw)
            receipt=e.read(Path(str(stem)+'.receipt.json'))
            raw_receipts.append(dict(phase=phase,sha256=e.digest(receipt),rawBase64=base64.b64encode(receipt).decode()))
        return dict(value['summary'],driverBridge=dict(status=result['status'],stages=result['completed'],
                     rawEntryReceipts=raw_receipts,scope=e.PG_SCOPE,productionMigrationImplemented=False,
                     actualDurableCore=True,readOnlyReplay=True,phaseEvidenceBytes=evidence_sizes,
                     maxPhaseEvidenceBytes=max(evidence_sizes.values()),phaseEvidenceLimitBytes=e.MAX))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ('config','node','loader','fixture','entry-source','driver-source'): parser.add_argument('--'+name,required=True)
    print(json.dumps(run(parser.parse_args()),sort_keys=True))
