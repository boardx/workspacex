#!/usr/bin/env python3
"""Real fixed CN Chromium business verification over loopback TLS."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import signal
import sys
ROOT=Path('/usr/local/lib/workspacex-image-release/cn-short-tags-5925-d6c34ee8ea4f')
PINS={'cn-image-browser-probe.py':'910f57905ad240425ec1966087902723519a2bc6bb89026c0e1d3760e79c39d9','cn-image-browser-probe.mjs':'95af5956212bdfb905cb3c1d5b377a69893277317428caef7fbe248e720dd4b8'}
ENV=Path('/etc/workspacex-image-release/cn-browser.env');ENV_SHA='7659580d4e9bf115d11944280bd3ec6338c0fc2a4a954c79439bd10092dcc6e1'
SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';TAG='41248889927-1'
def need(v,c):
 if not v:raise ValueError(c)
def trusted(path,private=False):
 import stat
 p=Path(path);need(p.is_absolute(),'ABSOLUTE_PATH')
 for item in (*reversed(p.parents),p):
  s=item.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_PATH')
 need(p.is_file() and p.stat().st_nlink==1,'REGULAR_FILE')
 if private:need(not p.stat().st_mode&0o077,'PRIVATE_FILE')
 return p

def verify_pin(path,digest,private=False):
 need(type(digest) is str and re.fullmatch('[a-f0-9]{64}',digest),'BROWSER_PIN_FORMAT')
 raw=trusted(path,private).read_bytes();need(hashlib.sha256(raw).hexdigest()==digest,'BROWSER_PIN_DRIFT');return raw

def loopback_source(raw):
 anchor=b'    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],'
 need(raw.count(anchor)==1,'BROWSER_LAUNCH_ANCHOR')
 return raw.replace(anchor,b'    args: [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "--host-resolver-rules=MAP app.boardx.com.cn 127.0.0.1"],')

def main():
 need(os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1]=='verify','ROOT_FIXED_MODE')
 attempt=Path(sys.argv[2]);need(attempt.is_absolute() and re.fullmatch('tag-maintenance-[a-f0-9]{32}',attempt.name),'ATTEMPT_PATH')
 need(attempt.is_dir() and attempt.stat().st_uid==0 and not attempt.stat().st_mode&0o077 and not attempt.is_symlink(),'PRIVATE_ATTEMPT')
 policy=json.loads(trusted(attempt/'policy.json',True).read_bytes());need(policy['environment']=='cn' and policy['source']==SOURCE and policy['tag']==TAG,'POLICY_IDENTITY')
 for name,digest in PINS.items():verify_pin(ROOT/name,digest)
 verify_pin(ENV,ENV_SHA,True)
 spec=importlib.util.spec_from_file_location('original_cn_browser',ROOT/'cn-image-browser-probe.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.verify_runtime()
 run_browser(attempt,(ROOT/'cn-image-browser-probe.mjs').read_bytes())

def run_browser(attempt,original):
 raw=loopback_source(original)
 # Source retains absolute runtime module paths; no original closure is modified.
 script=attempt/('old-browser-'+os.urandom(8).hex()+'.mjs');fd=os.open(script,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 try:
  result=subprocess.run(['/usr/bin/node',str(script),'https://app.boardx.com.cn',str(ENV)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=100,env={'PATH':'/usr/bin:/bin','HOME':'/root','CN_BROWSER_EXECUTABLE_PATH':'/usr/bin/chromium-browser'})
  need(result.returncode==0 and b'CN_BROWSER_SMOKE_PASSED\n' in result.stdout,'OLD_BROWSER_ACCEPTANCE_FAILED')
  print(json.dumps({'status':'OLD_APPLICATION_VERIFIED','environment':'cn','source':SOURCE,'tag':TAG,'realChromium':True,'tlsVerification':True,'routing':'loopback-host-resolver','probeSourceSha256':PINS['cn-image-browser-probe.mjs']}))
 finally:script.unlink(missing_ok=True)
if __name__=='__main__':
 def interrupted(*_):raise RuntimeError('CN_BROWSER_INTERRUPTED')
 signal.signal(signal.SIGTERM,interrupted)
 try:main()
 except Exception:print(json.dumps({'status':'FAILED','code':'CN_OLD_BROWSER_FAILED','environment':'cn','source':SOURCE,'tag':TAG}));sys.exit(1)
