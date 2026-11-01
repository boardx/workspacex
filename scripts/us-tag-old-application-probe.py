#!/usr/bin/env python3
"""Run the existing US business probe through exact loopback TLS during maintenance.

Real authenticated API/file/Agent/model/sandbox verification; no browser UI claim.
The probe creates synthetic application data and retains policy-managed objects.
"""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import uuid
HERE=Path(__file__).resolve().parent
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
def need(v,c):
 if not v:raise ValueError(c)
def trusted(path):
 p=Path(path);need(p.is_absolute(),'ROOT_CLOSURE_REQUIRED')
 for item in (*reversed(p.parents),p):
  s=item.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_CLOSURE_REQUIRED')
 return p
def load(path):
 s=importlib.util.spec_from_file_location('us_maintenance_source',path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def probe_env(raw):
 values={}
 for line in raw.decode().splitlines():
  if not line or line.startswith('#'):continue
  need('=' in line,'PROBE_ENV_INVALID');key,value=line.split('=',1)
  need(key not in values,'PROBE_ENV_DUPLICATE');values[key]=value
 need(values.get('PROVISION_PUBLIC_URL') in ('https://appv1.boardx.us','https://appv1.boardx.us/'),'PUBLIC_URL_BINDING')
 need(values.get('WORKSPACEX_DEPLOYMENT_MARKER'),'DEPLOYMENT_MARKER_REQUIRED')
 budget=values.get('PROVISION_TIMEOUT_MS','');need(budget.isdigit() and 1<=int(budget)<=300000,'PROBE_BUDGET')
 return int(budget)

def command(image,name,token):
 need(re.fullmatch('sha256:[a-f0-9]{64}',image),'BASELINE_API_IMAGE')
 return ['/usr/bin/docker','run','--rm','--pull','never','--name',name,'--label','wsx.us-maintenance-probe='+token,
  '--network','host','--add-host','appv1.boardx.us:127.0.0.1',
  '--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2',
  '--env-file','/etc/workspacex-selfhost/probe.env',
  '--mount','type=bind,src=/etc/workspacex-selfhost/sandbox,dst=/run/sandbox',
  '--mount','type=bind,src=/etc/workspacex-selfhost/sessions,dst=/run/sessions',
  '--entrypoint','node',image,'--import','tsx','scripts/cloud-business-probe.ts']

def accepted(value):
 return (value.get('ok') is True and value.get('loginVerified') is True and
  value.get('file',{}).get('fileRoundtripVerified') is True and
  value.get('agent',{}).get('agentBusinessVerified') is True and
  value.get('components',{}).get('model') is True and value.get('components',{}).get('sandbox') is True)

def main():
 need(os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1]=='verify','ROOT_FIXED_MODE_REQUIRED')
 trusted(__file__);module=trusted(HERE/'us-tag-migration-adapter.py');us=load(module)
 prep_path=trusted(HERE/'schema-tag-prepare.py');prep=load(prep_path)
 attempt=prep.trusted(sys.argv[2],private=True,directory=True)
 p=json.loads(prep.trusted(attempt/'policy.json',private=True).read_bytes())
 need(p['environment']=='us' and p['source']==SOURCE and p['tag']==TAG,'POLICY_IDENTITY')
 us.inherited_lock(int(os.environ.get('WSX_RELEASE_LOCK_FD','-1')))
 pins=p['oldApplicationProbe']['inputs'];refs={r['path']:r for r in pins}
 required=['/etc/workspacex-selfhost/probe.env','/usr/local/bin/workspacex-selfhost-business-probe','/usr/local/bin/workspacex-us-release-probe']
 for path in required:
  need(path in refs,'PROBE_INPUT_PIN_REQUIRED');need(hashlib.sha256(prep.trusted(path,private=path.endswith('probe.env')).read_bytes()).hexdigest()==refs[path]['sha256'],'PROBE_INPUT_DRIFT')
 budget=probe_env(prep.trusted(required[0],private=True).read_bytes())
 for path in ['/etc/workspacex-selfhost/sandbox','/etc/workspacex-selfhost/sessions']:need(trusted(path).is_dir(),'SANDBOX_MOUNT_BINDING')
 state=trusted('/var/lib/workspacex-selfhost-state');uncertain=state/'business-probe-uncertain'
 need(not uncertain.exists() and not uncertain.is_symlink(),'PROBE_PREVIOUSLY_UNCERTAIN')
 baseline=p['baseline']['api'];docker='/usr/bin/docker';env={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C.UTF-8'}
 def run(args,timeout=30):
  r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,env=env);need(r.returncode==0,'PROBE_DOCKER_FAILED');return r.stdout
 rows=json.loads(run([docker,'inspect',baseline['containerId']]))
 need(len(rows)==1,'API_CONTAINER_SET');row=rows[0]
 need(row['Id']==baseline['containerId'] and row['Image']==baseline['imageId'] and row['State']['Running'] is True and row['Config']['Labels'].get('com.docker.compose.service')=='api' and row['Config']['Labels'].get('com.docker.compose.project')==p['project'],'API_BASELINE_DRIFT')
 token=uuid.uuid4().hex;name='wsx-us-old-business-'+token;success=False
 fd=os.open(uncertain,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fsync(fd);os.close(fd)
 directory_fd=os.open(state,os.O_RDONLY);os.fsync(directory_fd);os.close(directory_fd)
 try:
  # An intent is private, durable and remains after interruption; it does not
  # claim that accepted remote Agent work has terminated.
  us.load('probe_core',trusted(HERE/'schema-restore-rehearsal.py')).save(attempt/('business-probe-intent-'+token+'.json'),{'source':SOURCE,'tag':TAG,'containerName':name,'syntheticBusinessWrites':True})
  raw=run(command(baseline['imageId'],name,token),timeout=budget/1000+45)
  need(len(raw)<=65536,'PROBE_OUTPUT_BOUND');need(accepted(json.loads(raw)),'BUSINESS_PROBE_FAILED');success=True
 finally:
  if not success:
   fd=os.open(uncertain,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600);os.fsync(fd);os.close(fd)
  # Reconcile only this owned probe. Successful --rm normally leaves no rows.
  ids=run([docker,'ps','--all','--quiet','--no-trunc','--filter','label=wsx.us-maintenance-probe='+token]).decode().split()
  need(len(ids)<=1,'OWNED_PROBE_AMBIGUOUS')
  for cid in ids:
   items=json.loads(run([docker,'inspect',cid]));need(len(items)==1 and items[0]['Name']=='/'+name and items[0]['Image']==baseline['imageId'] and items[0]['Config']['Labels'].get('wsx.us-maintenance-probe')==token,'PROBE_CLEANUP_OWNER');run([docker,'rm','--force',cid])
  need(not run([docker,'ps','--all','--quiet','--filter','label=wsx.us-maintenance-probe='+token]).strip(),'PROBE_CLEANUP_UNPROVEN')
 need(success,'BUSINESS_PROBE_FAILED');uncertain.unlink()
 directory_fd=os.open(state,os.O_RDONLY);os.fsync(directory_fd);os.close(directory_fd)
 print(json.dumps({'status':'OLD_APPLICATION_VERIFIED','source':SOURCE,'tag':TAG,'environment':'us','routing':'host-network-loopback-TLS','authenticatedLogin':True,'fileRoundtrip':True,'agentReply':True,'model':True,'sandbox':True,'browserVerified':False,'syntheticBusinessWrites':True}));return 0
if __name__=='__main__':
 def interrupted(*_):raise RuntimeError('PROBE_INTERRUPTED')
 signal.signal(signal.SIGTERM,interrupted)
 try:raise SystemExit(main())
 except Exception:
  print(json.dumps({'status':'OLD_APPLICATION_PROBE_FAILED','source':SOURCE,'tag':TAG,'environment':'us'}));raise SystemExit(1)
