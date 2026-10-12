import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

PATH = Path(__file__).resolve().parents[1] / 'scripts/cn-release-migration-owner.py'
specification = importlib.util.spec_from_file_location('migration_owner', PATH)
m = importlib.util.module_from_spec(specification)
specification.loader.exec_module(m)


class Manager:
    def __init__(self, journal, expected, failure=False):
        self.journal, self.expected, self.failure = journal, expected, failure
        self.starts = 0
        self.observation = None

    def start(self, unit):
        self.starts += 1
        if self.failure:
            raise TimeoutError()
        started = {'claimSha256': m.digest(m.encode(self.expected)), 'invocationId': 'e' * 32,
                   'pid': 123, 'startTicks': 456, 'bootId': '11111111-1111-4111-8111-111111111111'}
        self.journal.write_once('started.json', m.encode(started))
        self.observation = {'unit': unit, **started}

    def observe(self, unit):
        return self.observation


class OwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='wsx-owner-fixture-')
        os.chmod(self.temp.name, 0o700)
        self.j = m.FixtureJournal(self.temp.name)
        self.s = m.spec('a' * 64, 'b' * 64, 'c' * 64, 'd' * 64)

    def tearDown(self):
        self.j.close()
        self.temp.cleanup()

    def test_owner_observed_is_not_terminal_success(self):
        port = Manager(self.j, self.s)
        result = self.j.dispatch_once(self.s, port)
        self.assertEqual(result['state'], 'owner-observed')
        self.assertFalse(result['terminalVerified'])
        self.j.dispatch_once(self.s, port)
        self.assertEqual(port.starts, 1)

    def test_lost_ack_never_starts_again(self):
        port = Manager(self.j, self.s, True)
        self.assertEqual(self.j.dispatch_once(self.s, port)['state'], 'unknown')
        port.failure = False
        self.assertEqual(self.j.dispatch_once(self.s, port)['state'], 'unknown')
        self.assertEqual(port.starts, 1)

    def test_crash_after_claim_before_start(self):
        script = "import os,sys; os.chdir(sys.argv[1]); f=os.open('claim.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600); os.write(f,bytes.fromhex(sys.argv[2])); os.fsync(f); os.close(f); d=os.open('.',os.O_RDONLY); os.fsync(d); os._exit(41)"
        result = subprocess.run([sys.executable, '-c', script, self.temp.name, m.encode(self.s).hex()])
        self.assertEqual(result.returncode, 41)
        port = Manager(self.j, self.s)
        self.assertEqual(self.j.dispatch_once(self.s, port)['state'], 'unknown')
        self.assertEqual(port.starts, 0)

    def test_foreign_invocation_rejected(self):
        port = Manager(self.j, self.s)
        self.j.dispatch_once(self.s, port)
        port.observation['invocationId'] = 'f' * 32
        with self.assertRaisesRegex(m.Rejected, 'OWNER_CHANGED'):
            self.j.dispatch_once(self.s, port)
        self.assertEqual(port.starts, 1)

    def test_claim_conflict_rejected(self):
        self.j.write_once('claim.json', m.encode(self.s))
        changed = dict(self.s, planSha256='f' * 64)
        with self.assertRaisesRegex(m.Rejected, 'CLAIM_CONFLICT'):
            self.j.dispatch_once(changed, Manager(self.j, changed))

    def test_public_entry_disabled(self):
        with self.assertRaisesRegex(m.Rejected, 'NOT_INSTALLED'):
            m.main()

    def test_duplicate_json_rejected(self):
        with self.assertRaisesRegex(m.Rejected, 'DUPLICATE_KEY'):
            m.parse(b'{"pid":1,"pid":2}')

    def test_concurrent_process_lock_rejected(self):
        code = "import fcntl,os,sys,time; f=os.open(sys.argv[1],os.O_RDWR); fcntl.flock(f,fcntl.LOCK_EX); print('locked',flush=True); time.sleep(30)"
        child = subprocess.Popen([sys.executable, '-c', code, self.temp.name + '/dispatch.lock'], stdout=subprocess.PIPE)
        try:
            self.assertEqual(child.stdout.readline(), b'locked\n')
            with self.assertRaisesRegex(m.Rejected, 'OWNER_DISPATCH_BUSY'):
                self.j.dispatch_once(self.s, Manager(self.j, self.s))
        finally:
            child.kill()
            child.wait()
            child.stdout.close()

    def test_finite_dispatcher_exit_does_not_release_owned_lock(self):
        # Two siblings in the test's containment: finite dispatcher cannot kill
        # or release owner. Outer finally kills exact owner and observes unlock.
        import fcntl
        lockpath = self.temp.name + '/release.lock'
        code = "import fcntl,os,sys,time; f=os.open(sys.argv[1],os.O_RDWR|os.O_CREAT,0o600); fcntl.flock(f,fcntl.LOCK_EX); print('held',flush=True); time.sleep(30)"
        owner = subprocess.Popen([sys.executable, '-c', code, lockpath], stdout=subprocess.PIPE)
        fd = None
        try:
            self.assertEqual(owner.stdout.readline(), b'held\n')
            subprocess.run([sys.executable, '-c', 'raise SystemExit(0)'], check=True)
            fd = os.open(lockpath, os.O_RDWR)
            with self.assertRaises(BlockingIOError):
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            owner.kill()
            owner.wait()
            owner.stdout.close()
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(fd)


if __name__ == '__main__':
    unittest.main()
