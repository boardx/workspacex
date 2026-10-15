#!/usr/bin/env python3
"""Verify the reproducible, frontend-only production backport before any build."""
import subprocess,sys
BASE='f0eb9d07398a66fdd5646a9e6b855fa1b940e571'
PAYLOAD='bdd0a2911a05ac03de29b2cd2965ab3623116ee7'
FILES=('apps/web/app/agent/page.tsx','apps/web/components/admin/official-digital-human-panel.tsx','apps/web/components/agent/agent-directory-workspace.tsx','apps/web/components/agent/agent-directory.tsx','apps/web/lib/agent-directory-tasks.ts')
def git(*args):return subprocess.check_output(['git',*args])
def verify(source):
 import re
 if not re.fullmatch('[a-f0-9]{40}',source):raise ValueError('SOURCE_EXACT_SHA')
 if git('show','-s','--format=%P',source).decode().strip()!=BASE:raise ValueError('SOURCE_BASELINE')
 if set(git('diff','--name-only',BASE,source).decode().splitlines())!=set(FILES):raise ValueError('SOURCE_SCOPE')
 for p in FILES:
  if git('show',source+':'+p)!=git('show',PAYLOAD+':'+p):raise ValueError('SOURCE_PAYLOAD')
 return {'sourceRevision':source,'baselineRevision':BASE,'payloadRevision':PAYLOAD,'frontendFiles':len(FILES),'backendChanged':False,'migrationsChanged':False}
if __name__=='__main__':
 import json
 print(json.dumps(verify(sys.argv[1]),sort_keys=True))
