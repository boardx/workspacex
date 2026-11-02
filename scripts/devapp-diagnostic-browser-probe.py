#!/usr/bin/env python3
"""Exact original DevApp browser journey with allowlisted failure diagnostics.

Original mjs, credentials, runtime and 100-second contract remain unchanged.
No raw child stderr, credential or URL text is forwarded.
"""
import hashlib,importlib.util,json,os,re,socket,stat,subprocess,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
RUNTIME=Path('/usr/local/lib/workspacex-devapp-browser-runtime')
SCRIPT=Path('/root/wsx-devapp-5921-probe/devapp-image-browser-probe.mjs')
CREDENTIALS=Path('/root/wsx-devapp-5921-probe/credentials.env')
POLICY=Path('/etc/workspacex-image-release/devapp-reviewed-tag-release.json')
def need(value,code):
 if not value:raise ValueError(code)
def trusted(path,private=False):
 path=Path(path)
 for p in (*reversed(path.parents),path):
  s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode&0o022,'ROOT_INPUT')
 need(path.is_file() and path.stat().st_nlink==1,'ROOT_FILE')
 if private:need(not path.stat().st_mode&0o077,'PRIVATE_FILE')
 return path
def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
 return h.hexdigest()
def browser_command(args):
 need(args in ([],['--baseline']),'FIXED_ARGUMENTS')
 return ['/usr/bin/node',str(SCRIPT),'https://devapp.boardx.us',str(CREDENTIALS),*args]
def accepted(result,args):
 marker=b'DEVAPP_BROWSER_BASELINE_PASSED' if args else b'DEVAPP_BROWSER_SMOKE_PASSED'
 return result.returncode==0 and marker in result.stdout

def main(args):
 need(os.geteuid()==0 and socket.gethostname()=='iZrj96m8nydns2hro306o7Z','ROOT_HOST')
 command=browser_command(args);policy_path=trusted(POLICY,True);need(policy_path.stat().st_size<=1024*1024,'POLICY_BOUND');policy=json.loads(policy_path.read_bytes());need(policy.get('diagnosticBrowser') is True and policy.get('source')=='b3e9977de08b056a564058ca0419d85d421fdd4a' and policy.get('tag')=='41388409479-1','DIAGNOSTIC_CAPABILITY')
 pins=policy.get('closurePins',{});module=trusted(HERE/'devapp-reviewed-tag-release.py');need(digest(module)==pins.get(module.name) and digest(trusted(Path(__file__).resolve()))==pins.get(Path(__file__).name),'CODE_PIN')
 spec=importlib.util.spec_from_file_location('safe_devapp_diagnostics',module);adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
 cfg=trusted('/etc/workspacex-image-release/devapp.json',True);need(cfg.stat().st_size<=1024*1024,'CONFIG_BOUND');config=json.loads(cfg.read_bytes());refs={r['path']:r for r in config.get('verificationFiles',[])}
 for path in (SCRIPT,CREDENTIALS,RUNTIME/'manifest.json'):
  need(str(path) in refs and digest(trusted(path,private=path==CREDENTIALS))==refs[str(path)]['sha256'],'ORIGINAL_BROWSER_PIN')
 manifest_path=trusted(RUNTIME/'manifest.json');need(manifest_path.stat().st_size<=8*1024*1024,'MANIFEST_BOUND');manifest=json.loads(manifest_path.read_bytes());need(type(manifest) is dict and 0<len(manifest)<=100000,'RUNTIME_MANIFEST')
 for name,checksum in manifest.items():
  relative=Path(name);need(type(name) is str and not relative.is_absolute() and '..' not in relative.parts and type(checksum) is str and re.fullmatch('[a-f0-9]{64}',checksum),'RUNTIME_ENTRY');need(digest(trusted(RUNTIME/relative))==checksum,'RUNTIME_DRIFT')
 try:result=subprocess.run(command,env={'PATH':'/usr/bin:/bin','HOME':'/root','PLAYWRIGHT_BROWSERS_PATH':'/root/.cache/ms-playwright'},capture_output=True,timeout=100)
 except (OSError,subprocess.TimeoutExpired):print('DEVAPP_PUBLIC_BROWSER_UNAVAILABLE',file=sys.stderr);return 1
 for item in adapter.browser_diagnostics(result.stderr):
  if all(k in item for k in ('phase','errorType','netCode')):print('BROWSER_DIAG phase='+item['phase']+' errorType='+item['errorType']+' netCode='+item['netCode'],file=sys.stderr)
  else:print('BROWSER_DIAG '+json.dumps(item,separators=(',',':')),file=sys.stderr)
 if accepted(result,args):print('DEVAPP_PUBLIC_BROWSER_PASSED');return 0
 print('DEVAPP_PUBLIC_BROWSER_FAILED',file=sys.stderr);return 1
if __name__=='__main__':
 try:raise SystemExit(main(sys.argv[1:]))
 except Exception:print('DEVAPP_PUBLIC_BROWSER_UNAVAILABLE',file=sys.stderr);raise SystemExit(1)
