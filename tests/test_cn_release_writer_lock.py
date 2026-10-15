"""Owned-lock capability checks with actual flock/process/thread boundaries."""
import os
import threading
import unittest
import test_cn_release_terminal_delegation as fixture
m = fixture.m


class WriterLockTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.TerminalTests(); self.f.setUp(); self.addCleanup(self.f.doCleanups)

    def test_forged_and_expired_capabilities_reject(self):
        for cap in (True, {}, m._WriterLock()):
            with self.assertRaises((ValueError, TypeError)):
                m.owned_writer_root(cap, self.f.j.e, self.f.identity)
        with m.writer_lock(self.f.j.e, self.f.identity) as cap:
            self.assertEqual(m.owned_writer_root(cap,self.f.j.e,self.f.identity),self.f.j.attempt)
        with self.assertRaisesRegex(ValueError,'WRITER_LOCK_CAPABILITY'):
            m.owned_writer_root(cap,self.f.j.e,self.f.identity)

    def test_wrong_identity_or_thread_rejects(self):
        with m.writer_lock(self.f.j.e,self.f.identity) as cap:
            wrong=dict(self.f.identity,attemptId='other')
            with self.assertRaisesRegex(ValueError,'WRITER_LOCK_BINDING'):
                m.owned_writer_root(cap,self.f.j.e,wrong)
            result=[]
            def check():
                try:m.owned_writer_root(cap,self.f.j.e,self.f.identity)
                except ValueError as exc:result.append(str(exc))
            thread=threading.Thread(target=check);thread.start();thread.join(5)
            self.assertEqual(result,['WRITER_LOCK_EXECUTION_OWNER'])

    def test_fork_cannot_reuse_capability_or_take_lock(self):
        with m.writer_lock(self.f.j.e,self.f.identity) as cap:
            pid=os.fork()
            if pid==0:
                try:
                    try:m.owned_writer_root(cap,self.f.j.e,self.f.identity)
                    except ValueError as exc:assert str(exc)=='WRITER_LOCK_EXECUTION_OWNER'
                    else:os._exit(2)
                    try:
                        with m.writer_lock(self.f.j.e,self.f.identity):pass
                    except ValueError as exc:assert str(exc)=='ENTRY_ACTIVE'
                    else:os._exit(3)
                    os._exit(0)
                except BaseException:os._exit(4)
            _,status=os.waitpid(pid,0);self.assertEqual(os.waitstatus_to_exitcode(status),0)

    def test_actual_terminal_materializer_under_owned_lock(self):
        writer,inputs=self.f.writer_fixture()
        with m.writer_lock(self.f.j.e,self.f.identity) as cap:
            result=m.derive_writer_resume_locked(m.enc(self.f.a),m.enc(writer),inputs,
                self.f.j.e,self.f.f.root/'under-owned-lock',cap,now=self.f.f.now)
            self.assertEqual(result['status'],'MATERIALIZED_A5')
            self.assertFalse(result['intentCreated'])


if __name__=='__main__':unittest.main()
