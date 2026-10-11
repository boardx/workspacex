#!/usr/bin/env python3
"""Pinned host launcher template. Generated runtime performs GET-only consumption.
Offline materialization never runs this host-only code.
"""
import hashlib,json,os,stat,sys,tempfile,time,logging,re
from pathlib import Path

def need(ok):
 if not ok:raise ValueError('ECS_IDENTITY_PROBE_REJECTED')
def pinned_launcher():
 path=Path('/usr/local/lib/workspacex-cn/execute-cn-candidate-download.py')
 for parent in (path.parent,*path.parent.parents):
  s=parent.lstat();need(stat.S_ISDIR(s.st_mode) and (s.st_uid,s.st_gid)==(0,0) and not s.st_mode&0o022)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and (s.st_uid,s.st_gid)==(0,0) and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o700 and s.st_size<2*1024**2)
  raw=f.read(2*1024**2);need(hashlib.sha256(raw).hexdigest()==CODE[path.name])
 namespace={'__name__':'reviewed_download_entry','__file__':str(path)};exec(compile(raw,str(path),'exec'),namespace);return namespace

CONTROL=__CONTROL__
SDK_SHA=__SDK_SHA__
CODE=__CODE__
CONFIG=__CONFIG__
CONSUMER=__CONSUMER__
def main():
 boot=pinned_launcher();boot['verify_interpreter']();handles=[]
 try:
  tools=boot['directory']('/usr/local/lib/workspacex-cn');handles.append(tools)
  code=boot['directory']('/usr/local/lib/workspacex-cn/candidate-download-code/'+CONTROL,True);handles.append(code)
  sdk=boot['directory']('/usr/local/lib/workspacex-cn/python-oss-runtime/'+SDK_SHA,True);handles.append(sdk)
  state=boot['directory']('/var/lib/workspacex-cn',True);handles.append(state)
  manifest=boot['read'](sdk,'manifest.json');need(hashlib.sha256(manifest).hexdigest()==SDK_SHA)
  with tempfile.TemporaryDirectory(prefix='.hk-consumer-sdk-',dir='/var/lib/workspacex-cn')as folder:
   root=Path(folder)
   for name,expected in CODE.items():
    raw=boot['read'](tools if name=='execute-cn-candidate-download.py'else code,name,0o700,2*1024**2);need(hashlib.sha256(raw).hexdigest()==expected);(root/name).write_bytes(raw);(root/name).chmod(0o600)
   sys.path.insert(0,str(root));from cn_candidate_sdk_runtime import extract_wheels
   from cn_candidate_download_supervisor import supervise
   runtime=root/'sdk';runtime.mkdir(mode=0o700);extract_wheels(manifest,lambda name,size:boot['read'](sdk,name,maximum=size),runtime);sys.path.insert(0,str(runtime))
   ns={'__name__':'hk_consumer','CONFIG':CONFIG};exec(compile(CONSUMER,'hk_consumer','exec'),ns)
   result=supervise(lambda:ns['run'](CONFIG),CONFIG['maxSeconds']);print(json.dumps(result,sort_keys=True))
 finally:
  for fd in reversed(handles):os.close(fd)
try:main()
except Exception:
 print('{"ok":false,"code":"HK_CONSUMER_FAILED_RECONCILE_NO_RETRY"}');sys.exit(1)
