#!/usr/bin/env python3
"""Create-once exact Git source inventory. Not a host install/provision receipt."""
import ast,hashlib,json,pathlib,re,subprocess,sys

def frozen(revision):
 if not re.fullmatch('[a-f0-9]{40}',revision):raise ValueError('EXACT_SOURCE_REVISION_REQUIRED')
 def git(*args):return subprocess.check_output(['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',*args],stderr=subprocess.DEVNULL)
 if git('rev-parse',revision+'^{commit}').decode().strip()!=revision:raise ValueError('EXACT_COMMIT_REQUIRED')
 tree=ast.parse(git('show',revision+':.harness/scripts/vm/cn-build-tool-identity.py'))
 assignments=[n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FILES' for t in n.targets)]
 if len(assignments)!=1:raise ValueError('SOURCE_ALLOWLIST_REQUIRED')
 files=ast.literal_eval(assignments[0].value)
 rows=[]
 for source,target in sorted(files.items()):
  raw=git('show',revision+':'+source)
  if not raw:raise ValueError('EMPTY_SOURCE')
  rows.append(dict(source=source,target=target,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
 payload=json.dumps(rows,sort_keys=True,separators=(',',':')).encode()
 return dict(schemaVersion=1,kind='review-only-cn-sop-source-closure',sourceCommit=revision,applicationRevision='9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision='ba6343199f3c834d6a198f83d0c771614292c82b',release='2026.10.3-cn.1',sourceCount=len(rows),targetCount=sum(r['target'] is not None for r in rows),sourceOnlyCount=sum(r['target'] is None for r in rows),closureSha256=hashlib.sha256(payload).hexdigest(),files=rows,ready=False,installed=False,installationAuthorized=False,productionActivated=False)

if __name__=='__main__':
 try:
  if len(sys.argv)!=5 or sys.argv[1]!='--source-revision' or sys.argv[3]!='--output':raise ValueError('USAGE')
  data=(json.dumps(frozen(sys.argv[2]),sort_keys=True,indent=2)+'\n').encode();path=pathlib.Path(sys.argv[4])
  try:
   with path.open('xb') as f:f.write(data)
  except FileExistsError:
   if path.read_bytes()!=data:raise ValueError('FROZEN_INVENTORY_CONFLICT')
  print('CN_SOP_SOURCE_CLOSURE_SHA256='+hashlib.sha256(data).hexdigest())
 except Exception:
  print('CN_SOP_SOURCE_FREEZE_REJECTED',file=sys.stderr);sys.exit(1)
