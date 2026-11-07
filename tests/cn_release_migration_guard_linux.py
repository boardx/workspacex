"""Actual migration guard/A-route Node tests; fixture I/O, not a production migration."""
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time
ROOT=Path(__file__).resolve().parents[1]
TEST_FILES=tuple('packages/cloud-deploy/src/cn-maintenance-host/'+name+'_test.ts' for name in ('migration_scope_adapter','a_route_factory','source_production_consumers'))
EXPECTED_TESTS=51
CASE_MANIFEST=ROOT/'tests/fixtures/cn-migration-owner/guard-cases.json'
REQUIRED_CASE='new held generation after isolated acceptance cannot reuse old epoch for DDL'
BUDGET_SECONDS=180


def validate_tap(raw):
    text=raw.decode('utf-8',errors='strict');counts={}
    # Never accept a contradictory failure or bailout beside a green summary.
    if re.search(r'^\s*(?:not ok\b|Bail out!)',text,re.M|re.I):raise ValueError('TAP_FAILURE_OR_BAILOUT')
    for key in ('tests','pass','fail','cancelled','skipped','todo'):
        values=re.findall(r'^# '+key+r' (\d+)\s*$',text,re.M)
        if len(values)!=1:raise ValueError('MIGRATION_GUARD_SUMMARY_REQUIRED')
        counts[key]=int(values[0])
    plans=re.findall(r'^1\.\.(\d+)\s*$',text,re.M)
    cases=re.findall(r'^ok (\d+) - (.+)$',text,re.M)
    if plans!=[str(EXPECTED_TESTS)] or counts['tests']!=EXPECTED_TESTS or counts['pass']!=EXPECTED_TESTS or any(counts[k]for k in ('fail','cancelled','skipped','todo')):raise ValueError('MIGRATION_GUARD_NOT_ALL_PASSED')
    names=[name for _,name in cases]
    if len(cases)!=EXPECTED_TESTS or [int(n)for n,_ in cases]!=list(range(1,EXPECTED_TESTS+1)) or len(set(names))!=EXPECTED_TESTS:raise ValueError('MIGRATION_GUARD_CASES_REQUIRED')
    if any(re.search(r' # (?:SKIP|TODO)\b',name,re.I)for name in names)or names.count(REQUIRED_CASE)!=1:raise ValueError('MIGRATION_GUARD_COUNTEREXAMPLE_REQUIRED')
    manifest=json.loads(CASE_MANIFEST.read_bytes())
    if tuple(manifest.get('testFiles',[]))!=TEST_FILES or len(manifest.get('nodeCaseNames',[]))!=EXPECTED_TESTS or set(names)!=set(manifest['nodeCaseNames']):raise ValueError('MIGRATION_GUARD_EXACT_INVENTORY_REQUIRED')
    return {'counts':counts,'caseNames':names}


def run_node(command, seconds=180, limit=2 * 1024 * 1024):
    # No new session: caller owned cgroup must contain the actual Node test process.
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
    chunks = []; size = 0; deadline = time.monotonic() + seconds
    try:
        while True:
            if time.monotonic() >= deadline: raise TimeoutError('MIGRATION_GUARD_DEADLINE')
            if not selector.select(.1): continue
            block = os.read(process.stdout.fileno(), min(65536, limit - size + 1))
            if not block: break
            size += len(block)
            if size > limit: raise ValueError('MIGRATION_GUARD_OUTPUT_LIMIT')
            chunks.append(block)
        code = process.wait(timeout=max(.01, deadline - time.monotonic()))
        raw = b''.join(chunks)
        sys.stdout.buffer.write(raw); sys.stdout.buffer.flush()
        if code != 0: raise ValueError('MIGRATION_GUARD_NODE_FAILED')
        return validate_tap(raw)
    finally:
        selector.close()
        if process.poll() is None: process.kill()
        process.wait(timeout=5); process.stdout.close()


def main():
    if sys.platform!='linux':raise RuntimeError('LINUX_REQUIRED')
    node=Path(os.environ['CN_API_STARTUP_NODE']);loader=ROOT/'node_modules/tsx/dist/loader.mjs'
    if not node.is_absolute()or not node.is_file()or not loader.is_file():raise RuntimeError('MIGRATION_GUARD_RUNTIME_REQUIRED')
    started=time.monotonic()
    result=run_node([str(node),'--import',str(loader),'--test','--test-reporter=tap',*TEST_FILES],seconds=BUDGET_SECONDS)
    print(json.dumps({'verified':True,'nodeTap':result['counts'],'nodeCaseNames':result['caseNames'],'aggregateCaseCount':1,'nodeTestCount':EXPECTED_TESTS,'durationSeconds':time.monotonic()-started,'budgetSeconds':BUDGET_SECONDS,'externalOperations':'fixtures','cloudCalls':0,'productionAccepted':False,'scope':'actual migration guard and A-route code with fixture operations; not full production migration'}))
    return 0

if __name__=='__main__':sys.exit(main())
