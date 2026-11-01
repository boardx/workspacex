#!/usr/bin/env python3
"""Fixed CN verifier entrypoint; root policy pins every executable before import."""
import hashlib,importlib.util,json,os,stat
from pathlib import Path
HERE=Path(__file__).resolve().parent
POLICY=Path('/etc/workspacex-image-release/cn-reviewed-tag-release.json')
def trusted(path):
 for p in (*reversed(path.parents),path):
  s=p.lstat()
  if s.st_uid!=0 or stat.S_ISLNK(s.st_mode) or s.st_mode&0o022:raise RuntimeError('ROOT_CLOSURE_REQUIRED')
 if not path.is_file() or path.stat().st_nlink!=1:raise RuntimeError('ROOT_CODE_REQUIRED')
 return path
if __name__=='__main__':
 if os.geteuid()!=0:raise SystemExit('ROOT_REQUIRED')
 trusted(POLICY)
 if POLICY.stat().st_mode&0o077 or POLICY.stat().st_size>1024*1024:raise SystemExit('PRIVATE_POLICY_REQUIRED')
 pins=json.loads(POLICY.read_bytes())['closurePins']
 if not isinstance(pins,dict) or not pins or len(pins)>32:raise SystemExit('CLOSURE_BOUND')
 for name,checksum in pins.items():
  if Path(name).name!=name or '..' in name:raise SystemExit('CODE_NAME')
  p=trusted(HERE/name)
  if p.stat().st_size>2*1024*1024 or hashlib.sha256(p.read_bytes()).hexdigest()!=checksum:raise SystemExit('CODE_HASH')
 for required in ('cn-reviewed-tag-release.py','cn-reviewed-tag-verifier.py'):
  if required not in pins:raise SystemExit('CLOSURE_MISSING')
 spec=importlib.util.spec_from_file_location('cn_reviewed_once',HERE/'cn-reviewed-tag-release.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.main('verifier')
