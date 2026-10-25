#!/usr/bin/env python3
"""Offline/root-only: recover private settings for a NEW host, never overwrite existing paths."""
import argparse,hashlib,json,os,tarfile
from pathlib import Path,PurePosixPath
from configure import private
p=argparse.ArgumentParser();p.add_argument('backup',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
assert os.geteuid()==0,'root required'
assert not a.output.exists(),'Output exists'
for line in (a.backup/'SHA256SUMS').read_text().splitlines():
 digest,name=line.split('  ',1)
 assert '/' not in name and name not in ('.','..')
 assert hashlib.sha256((a.backup/name).read_bytes()).hexdigest()==digest,'Backup digest mismatch'
a.output.mkdir(mode=0o700)
with tarfile.open(a.backup/'runtime.tar.gz','r:gz') as t:
 for m in t.getmembers():
  path=PurePosixPath(m.name)
  assert not path.is_absolute() and '..' not in path.parts and (m.isfile() or m.isdir()),'Unsafe archive'
  target=a.output/path
  if m.isdir():target.mkdir(mode=0o700,parents=True,exist_ok=True)
  else:
   target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
   with os.fdopen(fd,'wb') as f:f.write(t.extractfile(m).read())
meta=json.loads((a.backup/'images.json').read_text());s=json.loads((a.output/'settings.json').read_text())
s['sourceRevision']=meta['sourceRevision'];(a.output/'settings.json').write_text(json.dumps(s,indent=2)+'\n')
(a.output/'compose.env').write_text(''.join(k+'='+v+'\n' for k,v in meta['images'].items()))
# Bootstrap regenerates probe org IDs; retain the original restored IDs privately.
(a.output/'restore-probe.env').unlink(missing_ok=True)
private(a.output/'restore-probe.env',(a.output/'probe.env').read_text())
print('Prepared existing stable secrets and exact backup images for a NEW host at '+str(a.output))
