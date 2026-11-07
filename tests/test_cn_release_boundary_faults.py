"""Seeded OFFLINE 17-stage fault matrix, not a production/cloud E2E claim.

Uses the real full-chain driver/router/materializers, journal and forked entry.
External execution, installed-capability admission and e.verify are explicit
fixtures inherited by composition from test_cn_release_full_chain. A marker
means a fixture operation completed, NOT that a real DB/container was changed.
Hard failure occurs before the provider response/effect; lost response occurs
after it. Seeded timeouts cover both sides of that boundary. No recovery action
is authorized by these tests; only explicit read-only reconcile is exercised.
"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import unittest
from unittest.mock import patch

import test_cn_release_full_chain as full

SEED = os.environ.get('CN_RELEASE_SIMULATION_SEED', '0')
STAGES = tuple(full.r.e.STAGES)
FAULTS = ('lost-response', 'timeout', 'failure')


class BoundaryFaults(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        full.FullChain.setUpClass()
        print(json.dumps({'suite': 'cn-release-boundary-faults', 'seed': SEED,
                          'cases': len(STAGES) * len(FAULTS),
                          'externalProviders': 'fixture', 'productionE2E': False}), flush=True)

    @classmethod
    def tearDownClass(cls):
        full.FullChain.tearDownClass()

    def setUp(self):
        # Do not subclass/import FullChain as a TestCase name: unittest must
        # collect precisely this matrix, not its six tests again.
        self.chain = full.FullChain()
        self.addCleanup(self.chain.doCleanups)
        self.chain.setUp()

    def exercise(self, stage, fault):
        f = self.chain
        index = STAGES.index(stage)
        schedule = hashlib.sha256((SEED + ':' + stage + ':' + fault).encode()).digest()
        jitter = (1 + schedule[0] % 9) / 1000
        timeout = .02 + (schedule[1] % 5) / 1000
        completed = fault == 'lost-response' or (fault == 'timeout' and bool(schedule[2] & 1))
        trace = {'seed': SEED, 'stage': stage, 'fault': fault,
                 'jitterSeconds': jitter, 'timeoutSeconds': timeout,
                 'fixtureOperationCompleted': completed}
        (f.root / 'fault-schedule.json').write_text(json.dumps(trace, sort_keys=True))
        original = f.provider_command
        observations = []

        def transport(raw, seconds, started):
            matches = []
            for folder in f.requests.iterdir():
                manifest = full.r.e.decode((folder / 'manifest.json').read_bytes())
                for observing, name in ((False, 'action.sh'), (True, 'observe.sh')):
                    if (folder / name).read_bytes() == raw:
                        matches.append((manifest['stage'], observing))
            self.assertEqual(len(matches), 1)
            current, observing = matches[0]
            if current != stage:
                return original(raw, seconds, started)
            if observing:
                observations.append(current)
                if not completed:
                    # Neither a failed operation nor an unresolved timeout can
                    # acquire fabricated terminal-success evidence on reconcile.
                    return f.realrun(b'exit 24\n', seconds, started)
                return original(raw, seconds, started)
            f.calls.append(current)
            if completed:
                body = f.response(current, False)
                f.expected[(current, False)] = body
                full.r.e.create(f.root / ('provider-effect-' + current + '.json'), body)
            if fault == 'timeout':
                # A real child process crosses the bounded entry timeout. The
                # seed decides if the external fixture completed before timeout.
                # This offline action owns one process. exec keeps sleep as the
                # entry's waitable leader instead of orphaning a killed child
                # whose zombie can keep killpg(pid, 0) true until init reaps it.
                # Descendant/setsid cleanup remains covered by the Linux cgroup suites.
                command = ('exec sleep %.3f\n' % (timeout + jitter + .1)).encode()
                return f.realrun(command, timeout, started)
            command = ('sleep %.3f\nexit %d\n' %
                       (jitter, 17 if fault == 'lost-response' else 23)).encode()
            return f.realrun(command, seconds, started)

        with patch.object(full.r.e, 'run_command', transport):
            if index >= STAGES.index('clear-hold'):
                self.assertEqual(f.coordinate()['status'], 'WAITING_FOR_WRITER_APPROVAL')
                self.assertNotIn('clear-hold', f.calls)
                f.approve()
            with self.assertRaisesRegex(Exception, 'EXECUTION_UNCERTAIN'):
                f.coordinate()
            self.assertEqual(f.calls, list(STAGES[:index + 1]))
            marker = f.root / ('provider-effect-' + stage + '.json')
            self.assertEqual(marker.exists(), completed)
            prefix = f.state / f.identity['attemptId'] / ('%02d-%s' % (index, stage))
            terminal = full.r.e.decode(Path(str(prefix) + '.terminal.json').read_bytes())
            self.assertFalse(terminal['processGroupStillPresent'])
            self.assertEqual(terminal['reason'], 'TIMEOUT' if fault == 'timeout' else 'EXITED')
            if fault != 'timeout':
                self.assertEqual(terminal['exitCode'], 17 if completed else 23)
            else:
                self.assertNotEqual(terminal['exitCode'], 0)
            self.assertTrue(Path(str(prefix) + '.intent.json').exists())
            self.assertFalse(Path(str(prefix) + '.receipt.json').exists())
            # Ordinary re-entry and status must NOT repeat the action, invoke
            # recovery, run observers implicitly, or generate any later package.
            calls = list(f.calls)
            for mode in ('run', 'status', 'run'):
                value = f.coordinate(mode)
                self.assertEqual(value['status'], 'UNKNOWN_RECONCILE_REQUIRED')
                self.assertEqual(value['stage'], stage)
                self.assertFalse(value['mutationRetried'])
            self.assertEqual(f.calls, calls)
            self.assertEqual(observations, [])
            for later in STAGES[index + 1:]:
                self.assertIsNone(f.router.lookup(f.release, later))
                self.assertFalse((f.root / ('provider-effect-' + later + '.json')).exists())
            # Hold safety is asserted from performed fixture operations, never
            # inferred solely from the immutable self.hold template.
            held = (f.root / 'provider-effect-hold.json').exists()
            cleared = (f.root / 'provider-effect-clear-hold.json').exists()
            hold_index, clear_index = STAGES.index('hold'), STAGES.index('clear-hold')
            self.assertEqual(held, index > hold_index or (index == hold_index and completed))
            self.assertEqual(cleared, index > clear_index or (index == clear_index and completed))
            if hold_index < index < clear_index:
                self.assertTrue(held and not cleared)
                self.assertEqual(full.r.e.decode(f.router.evidence('hold'))['actualHold']['generation'], f.hold['generation'])
            # Only a completed external operation may reconcile successfully.
            if completed:
                result = f.coordinate('reconcile')
                if index + 1 == len(STAGES):
                    self.assertEqual(result['status'], 'CHAIN_COMPLETED')
                else:
                    self.assertEqual(result['status'], 'NOT_STARTED')
                    self.assertEqual(result['stage'], STAGES[index + 1])
                self.assertTrue(Path(str(prefix) + '.receipt.json').exists())
            else:
                with self.assertRaisesRegex(Exception, 'OBSERVATION_FAILED'):
                    f.coordinate('reconcile')
                self.assertFalse(Path(str(prefix) + '.receipt.json').exists())
                self.assertEqual(f.coordinate()['status'], 'UNKNOWN_RECONCILE_REQUIRED')
            self.assertEqual(f.calls, calls)
            self.assertTrue(observations)
            self.assertFalse(any(f.state.rglob('*.recovery.intent.json')))


def case(stage, fault):
    def test(self):
        self.exercise(stage, fault)
    test.__doc__ = 'OFFLINE %s / %s; seed=%s' % (stage, fault, SEED)
    return test


for _stage in STAGES:
    for _fault in FAULTS:
        setattr(BoundaryFaults, 'test_%02d_%s_%s' %
                (STAGES.index(_stage), _stage.replace('-', '_'), _fault.replace('-', '_')),
                case(_stage, _fault))


if __name__ == '__main__':
    unittest.main()
