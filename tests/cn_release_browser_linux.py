"""Run existing Node business contracts and real Chromium against local TLS only."""
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_JOURNEYS = (
    'canonical six journeys execute with real Chromium and local TLS: candidate',
    'canonical six journeys execute with real Chromium and local TLS: baseline after expired original window',
)


def validate_tap(raw):
    text = raw.decode('utf-8', errors='strict')
    counts = {}
    for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        values = re.findall(r'^# ' + key + r' (\d+)\s*$', text, re.M)
        if len(values) != 1: raise ValueError('TAP_SUMMARY_REQUIRED')
        counts[key] = int(values[0])
    plans = re.findall(r'^1\.\.(\d+)\s*$', text, re.M)
    passed = re.findall(r'^ok (\d+) - (.+)$', text, re.M)
    if len(plans) != 1 or counts['tests'] < 2 or int(plans[0]) != counts['tests']:
        raise ValueError('TAP_PLAN_REQUIRED')
    if counts['pass'] != counts['tests'] or any(counts[k] for k in ('fail', 'cancelled', 'skipped', 'todo')):
        raise ValueError('TAP_NOT_ALL_PASSED')
    if len(passed) != counts['tests'] or [int(n) for n, _ in passed] != list(range(1, counts['tests'] + 1)):
        raise ValueError('TAP_CASES_REQUIRED')
    if any(re.search(r' # (?:SKIP|TODO)\b', name, re.I) for _, name in passed):
        raise ValueError('TAP_SKIP_REJECTED')
    if any(sum(name == required for _, name in passed) != 1 for required in REQUIRED_JOURNEYS):
        raise ValueError('REAL_CHROMIUM_JOURNEYS_REQUIRED')
    return counts


def run_node(command, seconds=240, limit=2 * 1024 * 1024):
    # No new session: the caller's owned cgroup contains Node and Chromium.
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
    chunks = []; size = 0; deadline = time.monotonic() + seconds
    try:
        while True:
            if time.monotonic() >= deadline: raise TimeoutError('BROWSER_DEADLINE')
            if not selector.select(.1): continue
            block = os.read(process.stdout.fileno(), min(65536, limit - size + 1))
            if not block: break
            size += len(block)
            if size > limit: raise ValueError('BROWSER_OUTPUT_LIMIT')
            chunks.append(block)
        code = process.wait(timeout=max(.01, deadline - time.monotonic()))
        raw = b''.join(chunks)
        sys.stdout.buffer.write(raw); sys.stdout.buffer.flush()
        if code != 0: raise ValueError('BROWSER_NODE_FAILED')
        return validate_tap(raw)
    finally:
        selector.close()
        if process.poll() is None: process.kill()
        process.wait(timeout=5); process.stdout.close()


def main():
    if sys.platform != 'linux': raise RuntimeError('LINUX_REQUIRED')
    node = Path(os.environ['CN_ARCHIVE_TEST_NODE'])
    runtime = Path(os.environ['CN_ARCHIVE_TEST_RUNTIME'])
    chromium = Path(os.environ['CN_TEST_CHROMIUM'])
    playwright = Path(os.environ['CN_TEST_PLAYWRIGHT'])
    if not all(p.is_absolute() and p.exists() for p in (node, runtime, chromium, playwright)):
        raise ValueError('REAL_BROWSER_RUNTIME_REQUIRED')
    counts = run_node([str(node), '--import', str(runtime/'node_modules/tsx/dist/loader.mjs'),
        '--test', '--test-reporter=tap', 'tests/cn-release-business-runner.test.ts',
        'tests/cn-release-business-browser.integration.ts'])
    print(json.dumps({'verified': True, 'nodeTap': counts, 'realChromium': True,
        'applicationMode': 'local-TLS-fixture', 'cloudCalls': 0, 'productionAccepted': False}))
    return 0


if __name__ == '__main__': sys.exit(main())
