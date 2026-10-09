#!/usr/bin/env python3
"""Offline staging only; this does not install production files or prepare a host."""
import argparse
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

spec=importlib.util.spec_from_file_location('reviewed_handoff_validator',Path(__file__).with_name('verify-hosted-handoff.py'))
v=importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

def publish_new_directory(source,target):
    # Linux atomic publication with NOREPLACE: an existing target is never adopted.
    libc=ctypes.CDLL(None,use_errno=True)
    rename=getattr(libc,'renameat2',None)
    v.require(rename is not None,'ATOMIC_NOREPLACE_UNAVAILABLE')
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    rename.restype=ctypes.c_int
    if rename(-100,os.fsencode(source),-100,os.fsencode(target),1)!=0:
        code=ctypes.get_errno()
        raise OSError(code,os.strerror(code))

def stage(plan,sealed_directory,expected,control,control_sha256,staging_directory):
    destination=Path(staging_directory).absolute()
    v.require(destination.is_relative_to(Path(__file__).resolve().parents[1]) and destination.parent.resolve().is_relative_to(Path(__file__).resolve().parents[1]),'SCRATCH_STAGING_ONLY')
    v.require(not destination.exists() and not destination.is_symlink(),'NEW_STAGING_DIRECTORY_REQUIRED')
    v.require(destination.parent.is_dir() and not destination.parent.is_symlink(),'STAGING_PARENT_REQUIRED')
    evidence=v.verify(plan,sealed_directory,expected,control_path=control,control_sha256=control_sha256)
    root=Path(sealed_directory)
    payload={name:v.load(root/name)[1] for name in ('release.json','release.sealed.json')}
    v.require(v.sha(payload['release.json'])==evidence['manifestSha256'] and v.sha(payload['release.sealed.json'])==evidence['sealSha256'],'POST_VALIDATION_ARTIFACT_CHANGED')
    temporary=Path(tempfile.mkdtemp(prefix='.offline-import-',dir=destination.parent))
    try:
        for name,data in payload.items():
            with (temporary/name).open('xb') as handle:
                handle.write(data);handle.flush();os.fsync(handle.fileno())
            (temporary/name).chmod(0o600)
        receipt={'schemaVersion':1,'stage':'offline-hosted-artifact-staging','offlineImported':True,'handoffValidated':True,'prepared':False,'productionActivated':False,'cloudVerified':False,'productionInstallAuthorized':False,'trustScope':'verified local staging only; protected installer and live preactivate still required','sourceRevision':evidence['sourceRevision'],'release':evidence['release'],'attemptId':evidence['attemptId'],'platform':evidence['platform'],'manifestSha256':evidence['manifestSha256'],'sealSha256':evidence['sealSha256'],'expectedInputSha256':evidence['expectedInputSha256'],'canonicalControlSha256':evidence['canonicalControlSha256'],'canonicalVerifierSha256':evidence['canonicalVerifierSha256'],'canonicalNodeSha256':evidence['canonicalNodeSha256'],'handoffEvidenceSha256':v.sha(json.dumps(evidence,sort_keys=True,separators=(',',':')).encode()),'stagingToolSha256':v.sha(Path(__file__).read_bytes()),'validatedAt':evidence['validatedAt']}
        with (temporary/'offline-import.json').open('x',encoding='utf8') as handle:
            handle.write(json.dumps(receipt,sort_keys=True,indent=2)+'\n');handle.flush();os.fsync(handle.fileno())
        (temporary/'offline-import.json').chmod(0o600)
        descriptor=os.open(temporary,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
        publish_new_directory(temporary,destination)
        descriptor=os.open(destination.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
        return receipt
    finally:
        if temporary.exists():shutil.rmtree(temporary)

def main():
    parser=argparse.ArgumentParser()
    for name in ('plan','sealed-dir','expected','control','control-sha256','staging-dir'):
        parser.add_argument('--'+name,required=True)
    a=parser.parse_args()
    stage(a.plan,a.sealed_dir,a.expected,a.control,a.control_sha256,a.staging_dir)
    print('HOSTED_ARTIFACTS_STAGED_OFFLINE_ONLY')

if __name__=='__main__':
    try:main()
    except (ValueError,OSError,TypeError,KeyError,AttributeError,v.subprocess.SubprocessError):
        print('HOSTED_ARTIFACT_OFFLINE_STAGING_FAILED',file=sys.stderr);sys.exit(1)
