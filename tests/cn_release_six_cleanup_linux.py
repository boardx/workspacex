#!/usr/bin/env python3
"""Real local daemon counterexample, no cloud/pull/build; requires prepared images.
Kill the creator after durable exact receipts, close its actual Domain, recover
only its two containers, and prove a separate control owner's containers live.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
infra=load('real_six_infra','cn-release-six-infra.py');domains=load('six_cleanup_domains','cn_release_simulation_domain.py')
def worker(config):
 c=json.loads(Path(config).read_text());o=infra.Owner(Path(c['output']),c['runId'],c['roundId'],c['commit'],c['images'],c['ports'],c['dbName'],deadline=c['deadline']);o.start(deadline=c['deadline'])
 infra.durable(Path(c['output']),'ready.json',{'ready':True})
 while True:time.sleep(1)
def main():
 if sys.platform!='linux'or os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':print(json.dumps({'verified':False,'reason':'LINUX_ROOT_REQUIRED'}));return 2
 images={r:os.environ[k]for r,k in [('postgres','CN_API_STARTUP_PG_IMAGE'),('redis','CN_SIX_REDIS_IMAGE')]};run=os.environ['GITHUB_RUN_ID']
 commit=subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(ROOT),'rev-parse','HEAD'],cwd=ROOT,text=True,timeout=10).strip()
 root=Path(os.environ['CN_SIX_KILL_TARGET_ROOT']);control_root=Path(os.environ['CN_SIX_KILL_CONTROL_ROOT']);rid=os.environ['CN_SIX_ROUND_ID'];deadline=time.monotonic()+360
 if rid not in {'round-%02d'%i for i in range(1,11)}:raise RuntimeError('FIXED_ROUND_REQUIRED')
 for registry in (root,control_root):
  for parent in (registry,*registry.parents):
   info=parent.lstat()
   if parent.is_symlink()or not parent.is_dir()or info.st_uid!=0 or info.st_mode&0o022:raise RuntimeError('PRIVATE_REGISTERED_ROOT_REQUIRED')
 base=root/rid;base.mkdir(mode=0o700);domain=None;p=None;control=None;target_proof=None;verified=False;held=[]
 try:
  ports=[]
  for _ in range(4):
   s=socket.socket();s.bind(('127.0.0.1',0));s.listen();held.append(s);ports.append(s.getsockname()[1])
  target=base
  control_dir=control_root/rid;control_dir.mkdir(mode=0o700)
  control=infra.Owner(control_dir,run,rid,commit,images,dict(zip(infra.ROLES,ports[:2])),'wsx_'+'c'*20,deadline=deadline)
  held[0].close();held[1].close();control.start(deadline=deadline)
  cfg=dict(output=str(target),runId=run,roundId=rid,commit=commit,images=images,ports=dict(zip(infra.ROLES,ports[2:])),dbName='wsx_'+'d'*20,deadline=deadline)
  infra.durable(base,'config.json',cfg);held[2].close();held[3].close()
  domain=domains.Domain();p=domain.spawn([sys.executable,'-I','-B',str(Path(__file__).resolve()),'--worker',str(base/'config.json')],env={'PATH':os.environ['PATH'],'LANG':'C.UTF-8'},stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  end=min(deadline,time.monotonic()+180)
  while not(target/'ready.json').exists():
   if p.poll()is not None or time.monotonic()>=end:raise RuntimeError('SIX_CREATOR_NOT_READY')
   time.sleep(.1)
  # Direct owned Popen identity, no process-name or arbitrary PID kill.
  p.kill();p.wait(timeout=5);proof=domain.close(p);domain=None
  target_proof=infra.recover_all(root,run,commit,proof)
  if target_proof.get('verified')is not True:raise RuntimeError('SIX_ORPHAN_RECOVERY_UNPROVEN')
  for role in infra.ROLES:
   receipt=control.read(role+'-create-receipt.json')
   if control.inspect(receipt['containerId'],role).get('State',{}).get('Running')is not True:raise RuntimeError('SIX_CONTROL_NOT_PRESERVED')
  verified=True
 finally:
  for s in held:s.close()
  cleanup_errors=[]
  if domain is not None:
   try:
    proof=domain.close(p)
    target_proof=infra.recover_all(root,run,commit,proof)
   except Exception as exc:cleanup_errors.append(type(exc).__name__)
  if control is not None:
   try:
    cleanup=control.close()
    if cleanup.get('verified')is not True:cleanup_errors.append('CONTROL_CLEANUP_UNPROVEN')
   except Exception as exc:cleanup_errors.append(type(exc).__name__)
  if cleanup_errors:verified=False
  # Keep exact owner records for independent CI finally readback/recovery.
 if not verified:raise RuntimeError('SIX_REAL_CLEANUP_NOT_VERIFIED')
 print(json.dumps({'verified':True,'creatorSigkill':True,'controlOwnerPreserved':True,'targetRecovery':target_proof,'productionAccepted':False,'cloudCalls':0,'egressIsolated':False}));return 0
if __name__=='__main__':
 if len(sys.argv)==3 and sys.argv[1]=='--worker':worker(sys.argv[2])
 else:sys.exit(main())
