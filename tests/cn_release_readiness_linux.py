"""Run the ten existing readiness-dispatch Vitest cases, with fixture external I/O."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
import time
ROOT=Path(__file__).resolve().parents[1]


def validate(value):
    if value.get('success') is not True or value.get('numTotalTests')!=10 or value.get('numPassedTests')!=10 or value.get('numFailedTests')!=0 or value.get('numPendingTests')!=0:
        raise ValueError('READINESS_TESTS_NOT_ALL_PASSED')
    files=value.get('testResults',[])
    if len(files)!=1 or Path(files[0].get('name','')).resolve()!=ROOT/'packages/cloud-deploy/test/cn-release-readiness-dispatch.test.ts':raise ValueError('READINESS_WRONG_FILE')
    cases=files[0].get('assertionResults',[])
    names=[c.get('fullName') for c in cases]
    if len(cases)!=10 or len(set(names))!=10 or any(not name for name in names) or any(c.get('status')!='passed'for c in cases):raise ValueError('READINESS_CASES_REQUIRED')
    return names


def main():
    if sys.platform!='linux':raise RuntimeError('LINUX_REQUIRED')
    node=Path(os.environ['CN_API_STARTUP_NODE']);vitest=ROOT/'node_modules/vitest/vitest.mjs'
    if not node.is_absolute() or not node.is_file() or not vitest.is_file():raise RuntimeError('WORKSPACE_VITEST_REQUIRED')
    with tempfile.TemporaryDirectory(prefix='cn-readiness-report-')as td:
        report=Path(td)/'vitest.json'
        args=[str(node),str(vitest),'run','packages/cloud-deploy/test/cn-release-readiness-dispatch.test.ts','--maxWorkers=1','--minWorkers=1','--reporter=json','--outputFile='+str(report)]
        p=subprocess.Popen(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        selector=selectors.DefaultSelector();selector.register(p.stdout,selectors.EVENT_READ);size=0;end=time.monotonic()+180
        try:
            while True:
                if time.monotonic()>=end:raise TimeoutError('READINESS_TIMEOUT')
                if not selector.select(.1):continue
                raw=os.read(p.stdout.fileno(),65536)
                if not raw:break
                size+=len(raw)
                if size>2*1024*1024:raise ValueError('READINESS_LOG_LIMIT')
                sys.stdout.buffer.write(raw);sys.stdout.buffer.flush()
            if p.wait(timeout=max(.01,end-time.monotonic()))!=0:raise ValueError('READINESS_NODE_FAILED')
        finally:
            selector.close()
            if p.poll()is None:p.kill()
            p.wait(timeout=5);p.stdout.close()
        if report.is_symlink() or not report.is_file() or report.stat().st_size>262144:raise ValueError('READINESS_REPORT_REQUIRED')
        value=json.loads(report.read_bytes());names=validate(value)
        print(json.dumps({'verified':True,'vitestCaseNames':names,'testCount':10,'externalOperations':'fixtures','productionAccepted':False,'cloudCalls':0,'rawReport':value}))
    return 0

if __name__=='__main__':sys.exit(main())
