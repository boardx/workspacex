#!/usr/bin/env python3
"""Generate closed release pairs into already-pinned runtime closures. No runtime I/O."""
import json, pathlib, re, sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
pairs=json.loads((ROOT/'.harness/scripts/cn-maintenance-release-identities.json').read_text())
assert len(pairs)==2 and all(set(p)=={'sourceRevision','baselineRevision'} and all(re.fullmatch('[a-f0-9]{40}',v) for v in p.values()) for p in pairs)
js="const admittedReleaseIdentity = i => !!i && ("+' || '.join("(i.sourceRevision === "+json.dumps(p['sourceRevision'])+" && i.baselineRevision === "+json.dumps(p['baselineRevision'])+")" for p in pairs)+");"
py="def admitted_release_identity(identity):\n    return type(identity) is dict and ("+' or '.join("(identity.get('sourceRevision') == "+repr(p['sourceRevision'])+" and identity.get('baselineRevision') == "+repr(p['baselineRevision'])+")" for p in pairs)+")"
files={'.harness/scripts/vm/writer_fence.py':('#',py),'packages/cloud-deploy/src/cn-maintenance-host/release_identity.ts':('//',js.replace('const admitted','export const admitted').replace('= i =>','= (i: {sourceRevision?: unknown; baselineRevision?: unknown} | null | undefined): boolean =>'))}
for name in ('control_connection.cjs','existing_session_restore.cjs','retained_session_recovery.cjs','held_candidate_queries.cjs','held_candidate_expected.cjs','held_candidate_expected_producer.cjs','retained_backup_helper.cjs','acceptance_receipt_producer.cjs'):
 files['.harness/scripts/vm/'+name]=('//',js)
files['.harness/scripts/vm/build-cn-candidate-compose-source.mjs']=('//',js)
for name,(comment,body) in files.items():
 p=ROOT/name; text=p.read_text() if p.exists() else ''
 start=comment+' BEGIN GENERATED RELEASE IDENTITIES'; end=comment+' END GENERATED RELEASE IDENTITIES'
 block=start+'\n'+body+'\n'+end+'\n'
 if start in text:
  text=re.sub(re.escape(start)+r'.*?'+re.escape(end)+r'\n','',text,flags=re.S)
 lines=text.splitlines(keepends=True); prefix=''
 while lines and (lines[0].startswith('#!') or lines[0].strip() in ("'use strict';", '\"use strict\";')):
  prefix+=lines.pop(0)
 text=prefix+block+''.join(lines)
 if '--check' in sys.argv:
  if not p.exists() or p.read_text()!=text: raise SystemExit('RELEASE_IDENTITY_GENERATED_DRIFT: '+name)
 else:p.write_text(text)
