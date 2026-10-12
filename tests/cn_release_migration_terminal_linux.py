"""Linux aggregate: original terminal validators with fixture I/O; no systemd install."""
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time
import unittest
ROOT=Path(__file__).resolve().parents[1]
TEST_FILES=tuple('packages/cloud-deploy/src/cn-maintenance-host/'+name+'_test.ts' for name in ('migration_owner_observer','migration_owner_terminal','entry','source_plan_authority','migration_transport'))
PYTHON_FILES=('test_cn_release_migration_owner.py','test_cn_release_migration_owner_native.py')
EXPECTED_NODE=68
EXPECTED_PYTHON=19
BUDGET_SECONDS=180
CASE_MANIFEST=ROOT/'tests/fixtures/cn-migration-owner/terminal-cases.json'


def validate_tap(raw):
    text=raw.decode('utf-8',errors='strict');counts={}
    # Never accept a contradictory failure or bailout beside a green summary.
    if re.search(r'^\s*(?:not ok\b|Bail out!)',text,re.M|re.I):raise ValueError('TAP_FAILURE_OR_BAILOUT')
    for key in ('tests','pass','fail','cancelled','skipped','todo'):
        values=re.findall(r'^# '+key+r' (\d+)\s*$',text,re.M)
        if len(values)!=1:raise ValueError('TERMINAL_SUMMARY_REQUIRED')
        counts[key]=int(values[0])
    cases=re.findall(r'^ok (\d+) - (.+)$',text,re.M)
    expected=json.loads(CASE_MANIFEST.read_bytes())['nodeCaseNames']
    if (re.findall(r'^1\.\.(\d+)\s*$',text,re.M)!=[str(EXPECTED_NODE)] or counts['tests']!=EXPECTED_NODE or counts['pass']!=EXPECTED_NODE or any(counts[k]for k in ('fail','cancelled','skipped','todo')) or [int(n)for n,_ in cases]!=list(range(1,EXPECTED_NODE+1)) or [name for _,name in cases]!=expected or len(set(expected))!=EXPECTED_NODE):
        raise ValueError('TERMINAL_EXACT_CASES_REQUIRED')
    return {'counts':counts,'caseNames':expected}


def python_suite():
    suite=unittest.TestSuite()
    for filename in PYTHON_FILES:
        spec=importlib.util.spec_from_file_location(Path(filename).stem,ROOT/'tests'/filename)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
    result=unittest.TextTestRunner(stream=sys.stderr,verbosity=2).run(suite)
    value={'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'expectedFailures':len(result.expectedFailures),'unexpectedSuccesses':len(result.unexpectedSuccesses)}
    if value!={'tests':EXPECTED_PYTHON,'failures':0,'errors':0,'skipped':0,'expectedFailures':0,'unexpectedSuccesses':0}:raise ValueError('NATIVE_CASES_INCOMPLETE')
    print('NATIVE_RESULT='+json.dumps(value,sort_keys=True))


def validate_python(raw):
    rows=[line[len('NATIVE_RESULT='):]for line in raw.decode().splitlines()if line.startswith('NATIVE_RESULT=')]
    if len(rows)!=1:raise ValueError('NATIVE_RESULT_REQUIRED')
    value=json.loads(rows[0])
    if value!={'tests':EXPECTED_PYTHON,'failures':0,'errors':0,'skipped':0,'expectedFailures':0,'unexpectedSuccesses':0}:raise ValueError('NATIVE_CASES_INCOMPLETE')
    return value


def run_command(command, seconds, limit=2 * 1024 * 1024):
    if seconds<=0:raise TimeoutError('MIGRATION_TERMINAL_DEADLINE')
    # No new session: caller owned cgroup must contain the actual Node test process.
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
    chunks = []; size = 0; deadline = time.monotonic() + seconds
    try:
        while True:
            if time.monotonic() >= deadline: raise TimeoutError('MIGRATION_TERMINAL_DEADLINE')
            if not selector.select(.1): continue
            block = os.read(process.stdout.fileno(), min(65536, limit - size + 1))
            if not block: break
            size += len(block)
            if size > limit: raise ValueError('MIGRATION_TERMINAL_OUTPUT_LIMIT')
            chunks.append(block)
        code = process.wait(timeout=max(.01, deadline - time.monotonic()))
        raw = b''.join(chunks)
        sys.stdout.buffer.write(raw); sys.stdout.buffer.flush()
        if code != 0: raise ValueError('MIGRATION_TERMINAL_NODE_FAILED')
        return raw
    finally:
        selector.close()
        if process.poll() is None: process.kill()
        process.wait(timeout=5); process.stdout.close()


def main():
    if sys.platform!='linux':raise RuntimeError('LINUX_REQUIRED')
    if sys.argv[1:]==['--python-suite']:
        python_suite();return 0
    if sys.argv[1:]:raise ValueError('FIXED_COMMAND_REQUIRED')
    node=Path(os.environ['CN_API_STARTUP_NODE']);loader=ROOT/'node_modules/tsx/dist/loader.mjs'
    if not node.is_absolute()or not node.is_file()or not loader.is_file():raise RuntimeError('TERMINAL_RUNTIME_REQUIRED')
    started=time.monotonic();deadline=started+BUDGET_SECONDS
    result=validate_tap(run_command([str(node),'--import',str(loader),'--test','--test-reporter=tap',*TEST_FILES],deadline-time.monotonic()))
    native=validate_python(run_command([sys.executable,'-B',str(Path(__file__).resolve()),'--python-suite'],deadline-time.monotonic()))
    print(json.dumps({'verified':True,'aggregateCaseCount':1,'nodeTap':result['counts'],'nodeCaseNames':result['caseNames'],'nativeTests':native,'durationSeconds':time.monotonic()-started,'budgetSeconds':BUDGET_SECONDS,'systemdValidated':False,'rootSinkValidated':False,'productionAccepted':False,'scope':'canonical validator and native owner protocol using fixture operations; no live systemd or provider execution'}))
    return 0


if __name__=='__main__':sys.exit(main())
