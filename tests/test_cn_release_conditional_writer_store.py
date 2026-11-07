"""Actual multiprocess durable-storage tests; callbacks are OFFLINE fixtures."""
import importlib.util
import multiprocessing as mp
import os
from pathlib import Path
import tempfile
from cn_release_private_fixture import private_temporary_directory
import unittest
import test_cn_release_conditional_writer_policy as policy_tests
m = policy_tests.m

spec = importlib.util.spec_from_file_location('writer_store', Path(__file__).resolve().parents[1] / 'scripts/cn-release-conditional-writer-store.py')
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)


def worker(root, crash, queue):
    f = Fixture(root)
    def checkpoint(point):
        if point == crash:
            os._exit(73)
    try:
        f.run(checkpoint=checkpoint)
        queue.put('ok')
    except FileExistsError:
        queue.put('claimed')
    except Exception as e:
        queue.put('claimed' if str(e)=='POLICY_STORE_ACTIVE' else type(e).__name__)


class Fixture:
    def __init__(self, root):
        self.root = Path(root).resolve()
        base = policy_tests.PolicyTests(); base.setUp(); self.f = base
        base.p['codeFiles'][s.SELF] = m.sha((s.BASE/s.SELF).read_bytes())
        base.p['codeFiles'][s.POLICY] = m.sha((s.BASE/s.POLICY).read_bytes())
        self.store = s._Store(self.root/'policies', self.root/'state', self.root/'writers', os.getuid())

    def prepare(self):
        for name in ('policies/by-release','state/locks','state/claims','state/decisions','writers/by-release'):
            (self.root/name).mkdir(parents=True, exist_ok=True, mode=0o700)
        for p in self.root.rglob('*'):
            if p.is_dir(): p.chmod(0o700)
        raw=m.enc(self.f.p); digest=m.sha(raw)
        self.write(self.root/'policies'/f'{digest}.json', raw)
        self.write(self.root/'policies/by-release'/f'{m.sha(self.f.release)}.json',m.enc({'policySha256':digest}))

    def write(self, path, raw):
        path.write_bytes(raw); path.chmod(0o600)

    def observe(self):
        return m.enc(self.f.o), self.f.inputs, self.f.p['codeFiles']

    def run(self, **kw):
        return self.store.consume(self.f.release, kw.pop('observer',self.observe),
            kw.pop('terminal',lambda *args: {'status':'MATERIALIZED_A5','intentCreated':False}),
            enabled=True, clock=lambda:self.f.now, **kw)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=private_temporary_directory(); self.addCleanup(self.tmp.cleanup)
        self.f=Fixture(self.tmp.name); self.f.prepare()

    def test_real_two_process_race_only_one_publishes(self):
        ctx=mp.get_context('fork'); q=ctx.Queue()
        processes=[ctx.Process(target=worker,args=(self.tmp.name,None,q)) for _ in range(2)]
        for p in processes:p.start()
        for p in processes:p.join(10); self.assertFalse(p.is_alive()); self.assertEqual(p.exitcode,0)
        self.assertEqual(sorted([q.get(timeout=2),q.get(timeout=2)]),['claimed','ok'])
        self.assertEqual(len(list((self.f.root/'state/decisions').glob('*.json'))),1)

    def test_crashes_after_claim_and_publication_never_redispatch(self):
        for point in ('claimed','approval-published','pointer-published'):
            with self.subTest(point=point), private_temporary_directory() as root:
                f=Fixture(root);f.prepare();ctx=mp.get_context('fork');q=ctx.Queue()
                p=ctx.Process(target=worker,args=(root,point,q));p.start();p.join(10)
                self.assertEqual(p.exitcode,73)
                called=[]
                with self.assertRaises(FileExistsError):
                    f.run(terminal=lambda *args:called.append(True))
                self.assertEqual(called,[])
                self.assertEqual(len(list((Path(root)/'state/claims').glob('*.json'))),1)
                self.assertEqual(list((Path(root)/'state/decisions').glob('*.json')),[])

    def test_terminal_failure_no_visible_approval(self):
        with self.assertRaisesRegex(ValueError,'TERMINAL_RECHECK_FAILED'):
            self.f.run(terminal=lambda *args:{'status':'REJECTED'})
        self.assertEqual(list((self.f.root/'writers').glob('*.json')),[])
        self.assertEqual(list((self.f.root/'writers/by-release').glob('*.json')),[])
        with self.assertRaises(FileExistsError):self.f.run()

    def test_changed_facts_keep_claim_without_publish(self):
        count=[0]
        def observe():
            count[0]+=1
            value=self.f.observe()
            if count[0]>1:return value[0]+b' ',value[1],value[2]
            return value
        with self.assertRaisesRegex(ValueError,'FRESH_FACTS_CHANGED'):self.f.run(observer=observe)
        self.assertEqual(list((self.f.root/'writers/by-release').glob('*.json')),[])

    def test_terminal_changes_facts_or_revokes_policy_no_publish(self):
        def terminal(*args):
            self.f.f.inputs['hold'] += b' '
            return {'status':'MATERIALIZED_A5','intentCreated':False}
        with self.assertRaisesRegex(ValueError,'POST_TERMINAL_FACTS_CHANGED'):
            self.f.run(terminal=terminal)
        self.assertEqual(list((self.f.root/'writers/by-release').glob('*.json')),[])

    def test_policy_revoked_during_terminal_no_publish(self):
        def terminal(*args):
            p=self.f.root/'policies/by-release'/f'{m.sha(self.f.f.release)}.json'
            self.f.write(p,m.enc({'policySha256':'0'*64}))
            return {'status':'MATERIALIZED_A5','intentCreated':False}
        with self.assertRaisesRegex(ValueError,'APPROVAL_REVOKED'):
            self.f.run(terminal=terminal)
        self.assertEqual(list((self.f.root/'writers/by-release').glob('*.json')),[])

    def test_existing_static_pointer_not_overwritten(self):
        p=self.f.root/'writers/by-release'/f'{m.sha(self.f.f.release)}.json'
        self.f.write(p,b'original')
        with self.assertRaises(FileExistsError):self.f.run()
        self.assertEqual(p.read_bytes(),b'original')

    def test_symlink_policy_rejected(self):
        p=self.f.root/'policies'/f'{m.sha(m.enc(self.f.f.p))}.json'
        raw=p.read_bytes();p.unlink();other=self.f.root/'outside';self.f.write(other,raw);p.symlink_to(other)
        with self.assertRaises(OSError):self.f.run()

    def test_unsafe_policy_permissions_rejected(self):
        p=self.f.root/'policies'/f'{m.sha(m.enc(self.f.f.p))}.json';p.chmod(0o644)
        with self.assertRaisesRegex(ValueError,'PRIVATE_FILE'):self.f.run()

    def test_default_and_production_api_cannot_install(self):
        with self.assertRaisesRegex(ValueError,'POLICY_DISABLED'):s.consume(self.f.f.release)
        with self.assertRaisesRegex(ValueError,'ROOT_REQUIRED|ADAPTER_NOT_INSTALLED'):
            s.consume(self.f.f.release,enabled=True)


if __name__=='__main__':unittest.main()
