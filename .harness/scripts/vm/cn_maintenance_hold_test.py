import importlib.util,json,multiprocessing,os,pathlib,stat,tempfile,unittest
from unittest.mock import patch
MODULE=pathlib.Path(__file__).with_name('cn_maintenance_hold.py')
spec=importlib.util.spec_from_file_location('hold_protocol',MODULE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
IDENTITY={'sourceRevision':'9'*40,'baselineRevision':'b'*40,'migrationPlanSha256':'a'*64,'attemptId':'local-test'}
def worker(path,operation,payload,queue):
    try:
        store=m.HoldStore(path,os.geteuid(),os.getegid());result=getattr(store,operation)(payload) if payload is not None else getattr(store,operation)();queue.put(('ok',result))
    except BaseException as error:queue.put(('rejected',str(error)))
class HoldTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='wsx-hold-',dir=str(pathlib.Path(tempfile.gettempdir()).resolve()));self.path=pathlib.Path(self.tmp.name);self.path.chmod(0o700);os.chown(self.path,os.geteuid(),os.getegid());self.store=m.HoldStore(self.path,os.geteuid(),os.getegid())
    def tearDown(self):self.tmp.cleanup()
    def process(self,op,payload=None):
        q=multiprocessing.get_context('fork').Queue();p=multiprocessing.get_context('fork').Process(target=worker,args=(str(self.path),op,payload,q));p.start();p.join(5);self.assertFalse(p.is_alive());self.assertEqual(p.exitcode,0);return q.get(timeout=2)
    def test_actual_cross_process_hold_and_cas(self):
        state,receipt=self.process('create',IDENTITY);self.assertEqual(state,'ok');self.assertEqual(self.process('read')[1],receipt)
        self.assertEqual(self.process('admit_ordinary_release')[0],'rejected');state,cleared=self.process('clear',receipt);self.assertEqual(state,'ok');self.assertEqual(cleared['state'],'cleared');self.assertEqual(self.process('admit_ordinary_release')[0],'ok')
    def test_concurrent_creators_only_one_wins(self):
        ctx=multiprocessing.get_context('fork');q=ctx.Queue();jobs=[ctx.Process(target=worker,args=(str(self.path),'create',IDENTITY,q)) for _ in range(4)]
        for p in jobs:p.start()
        for p in jobs:p.join(5);self.assertFalse(p.is_alive());self.assertEqual(p.exitcode,0)
        results=[q.get(timeout=2)[0] for _ in jobs];self.assertEqual(results.count('ok'),1)
    def test_concurrent_clear_only_one_wins(self):
        receipt=self.store.create(IDENTITY);ctx=multiprocessing.get_context('fork');q=ctx.Queue();jobs=[ctx.Process(target=worker,args=(str(self.path),'clear',receipt,q)) for _ in range(3)]
        for p in jobs:p.start()
        for p in jobs:p.join(5);self.assertFalse(p.is_alive());self.assertEqual(p.exitcode,0)
        self.assertEqual([q.get(timeout=2)[0] for _ in jobs].count('ok'),1)
    def test_symlink_lock_rejects_without_reading_hold(self):
        (self.path/'hold.lock').symlink_to('/etc/hosts')
        with self.assertRaises(OSError):self.store.admit_ordinary_release()
    def test_uninitialized_directory_is_not_implicitly_created(self):
        with self.assertRaises(FileNotFoundError):m.HoldStore(self.path/'absent',os.geteuid(),os.getegid()).admit_ordinary_release()
        self.assertFalse((self.path/'absent').exists())
    def test_stale_generation_cannot_clear_new_hold(self):
        first=self.store.create(IDENTITY);self.store.clear(first);second=self.store.create(IDENTITY)
        self.assertNotEqual(first['generation'],second['generation'])
        with self.assertRaises(m.HoldRejected):self.store.clear(first)
        self.assertEqual(self.store.read(),second)
    def test_all_identity_fields_bound(self):
        receipt=self.store.create(IDENTITY)
        for field in IDENTITY:
            changed=json.loads(json.dumps(receipt));changed['identity'][field]='other'
            with self.assertRaises(m.HoldRejected):self.store.clear(changed)
    def test_same_bytes_replaced_inode_rejects_clear(self):
        receipt=self.store.create(IDENTITY);old=self.path/'hold.json';copy=self.path/'replacement';copy.write_bytes(old.read_bytes());copy.chmod(0o600);os.replace(copy,old)
        with self.assertRaises(m.HoldRejected):self.store.clear(receipt)
    def test_corrupt_partial_hold_rejects_admission(self):
        self.store.create(IDENTITY);(self.path/'hold.json').write_bytes(b'{')
        with self.assertRaises(m.HoldRejected):self.store.admit_ordinary_release()
    def test_symlink_hold_rejects_read(self):
        (self.path/'hold.json').symlink_to('/etc/hosts')
        with self.assertRaises(OSError):self.store.read()
    def test_symlink_directory_rejects(self):
        link=self.path/'link';link.symlink_to(self.path,target_is_directory=True)
        with self.assertRaises(OSError):m.HoldStore(link,os.geteuid(),os.getegid()).read()
    def test_wrong_mode_rejects(self):
        self.store.create(IDENTITY);(self.path/'hold.json').chmod(0o644)
        with self.assertRaises(m.HoldRejected):self.store.read()
    def test_hardlink_hold_rejects(self):
        self.store.create(IDENTITY);os.link(self.path/'hold.json',self.path/'hardlink')
        with self.assertRaises(m.HoldRejected):self.store.read()
    def test_unknown_extra_fields_rejects(self):
        self.store.create(IDENTITY);p=self.path/'hold.json';x=json.loads(p.read_text());x['accepted']=True;p.write_text(json.dumps(x))
        with self.assertRaises(m.HoldRejected):self.store.admit_ordinary_release()
    def test_clear_committed_response_lost_readback_actual(self):
        receipt=self.store.create(IDENTITY);self.process('clear',receipt)
        actual=self.process('read')[1];self.assertEqual(actual['state'],'cleared');self.assertEqual(actual['generation'],receipt['generation']);self.assertNotEqual(actual,receipt)
        with self.assertRaises(m.HoldRejected):self.store.clear(receipt)
    def test_root_directory_rejected(self):
        for path in ('/', ''):
            with self.assertRaises(m.HoldRejected):m.HoldStore(path,os.geteuid(),os.getegid()).read()
    def test_unpublished_owned_temp_removed_on_write_fault(self):
        receipt=self.store.create(IDENTITY);real_fsync=os.fsync
        def fail_file(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode):raise OSError('injected file fsync')
            return real_fsync(fd)
        with patch.object(m.os,'fsync',side_effect=fail_file):
            with self.assertRaises(OSError):self.store.clear(receipt)
        self.assertEqual(list(self.path.glob('.hold-*')),[]);self.assertEqual(self.store.read(),receipt)
    def test_foreign_replacement_temp_not_removed_on_fault(self):
        receipt=self.store.create(IDENTITY);real_fsync=os.fsync;foreign=[]
        def replace_then_fail(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode):
                name=next(self.path.glob('.hold-*'));other=self.path/'foreign';other.write_text('foreign');other.chmod(0o600);os.replace(other,name);foreign.append(name);raise OSError('injected replacement')
            return real_fsync(fd)
        with patch.object(m.os,'fsync',side_effect=replace_then_fail):
            with self.assertRaises(OSError):self.store.clear(receipt)
        self.assertEqual(len(foreign),1);self.assertEqual(foreign[0].read_text(),'foreign');self.assertEqual(self.store.read(),receipt)
    def test_directory_fsync_after_replace_reads_actual_held(self):
        old=self.store.create(IDENTITY);self.store.clear(old);real_fsync=os.fsync
        def fail_dir(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):raise OSError('injected directory fsync')
            return real_fsync(fd)
        with patch.object(m.os,'fsync',side_effect=fail_dir):
            with self.assertRaises(OSError):self.store.create(IDENTITY)
        actual=self.store.read();self.assertEqual(actual['state'],'held');self.assertNotEqual(actual['generation'],old['generation'])
        with self.assertRaises(m.HoldRejected):self.store.admit_ordinary_release()
    def test_directory_fsync_after_replace_reads_actual_cleared(self):
        old=self.store.create(IDENTITY);real_fsync=os.fsync
        def fail_dir(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):raise OSError('injected directory fsync')
            return real_fsync(fd)
        with patch.object(m.os,'fsync',side_effect=fail_dir):
            with self.assertRaises(OSError):self.store.clear(old)
        actual=self.store.read();self.assertEqual(actual['state'],'cleared');self.assertEqual(actual['generation'],old['generation'])
        self.assertNotEqual(actual,old)
    def test_partial_first_write_unknown_admission_rejected(self):
        # Actual first content write fails after hold.json EXCL has created it.
        with patch.object(m.os,'fdopen',side_effect=OSError('injected first content failure')):
            with self.assertRaises(OSError):self.store.create(IDENTITY)
        with self.assertRaises(m.HoldRejected):self.store.admit_ordinary_release()
if __name__=='__main__':unittest.main()
