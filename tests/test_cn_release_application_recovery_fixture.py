"""Local wrapper boundaries; not PostgreSQL/Docker/cloud acceptance."""
import copy,contextlib,importlib.util,io,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('application_recovery',ROOT/'tests/cn_release_application_recovery_linux.py')
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)
class FixtureBoundaries(unittest.TestCase):
    def test_bridge_real_nested_imports_do_not_write_source_bytecode(self):
        with tempfile.TemporaryDirectory(prefix='application-bridge-cache-')as tmp:
            root=Path(tmp)
            for relative in ('tests/fixtures/cn-postgres-lifecycle/driver_bridge.py','scripts/cn-release-fixed-driver.py','.harness/scripts/vm/cn-release-advance.py'):
                target=root/relative;target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes((ROOT/relative).read_bytes())
            probe=root/'probe.py'
            probe.write_text('import importlib.util,sys\nfrom pathlib import Path\nr=Path(__file__).parent\ns=importlib.util.spec_from_file_location("bridge",r/"tests/fixtures/cn-postgres-lifecycle/driver_bridge.py")\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nd=m.module(r/"scripts/cn-release-fixed-driver.py","actual_driver")\nassert callable(d.coordinate) and callable(d.e.entry)\nprint(int(sys.flags.isolated),int(sys.dont_write_bytecode))\n')
            result=m.run(m.bridge_command(probe),cwd=root)
            self.assertEqual(result.stdout,b'1 1\n')
            self.assertEqual(list(root.rglob('__pycache__')),[])
            self.assertEqual(list(root.rglob('*.pyc')),[])
            # Same real import chain without the child flag reproduces the
            # source mutation. This is a disposable tree, never the checkout.
            m.run([sys.executable,'-I',probe],cwd=root)
            self.assertTrue(list((root/'scripts').rglob('*.pyc')))
            self.assertTrue(list((root/'.harness').rglob('*.pyc')))
    def test_non_linux_cannot_create_container(self):
        with patch.object(m.sys,'platform','darwin'),patch.object(m.subprocess,'Popen')as spawn,contextlib.redirect_stdout(io.StringIO())as output:
            self.assertEqual(m.main(),2);spawn.assert_not_called()
        self.assertFalse(json.loads(output.getvalue())['verified'])
    def test_completed_process_is_not_signalled(self):
        with patch.object(m.os,'killpg')as kill:
            self.assertEqual(m.run([sys.executable,'-c','print("done")']).stdout,b'done\n');kill.assert_not_called()
    def test_timeout_is_rejected_and_owned_process_killed(self):
        with self.assertRaisesRegex(RuntimeError,'CHILD_TIMEOUT'):
            m.run([sys.executable,'-c','import time;time.sleep(10)'],timeout=.1)
    def test_output_bound_is_failure(self):
        with self.assertRaisesRegex(RuntimeError,'CHILD_OUTPUT_BOUND'):
            m.run([sys.executable,'-c','import sys;sys.stdout.write("x"*5000000)'])
    def test_storage_rejects_image_implicit_volume(self):
        m.validate_image_storage({'Config':{'Volumes':{m.PGDATA:{}},'Env':['PGDATA='+m.PGDATA]}})
        with self.assertRaisesRegex(RuntimeError,'UNEXPECTED_IMAGE_VOLUME'):
            m.validate_image_storage({'Config':{'Volumes':{'/extra':{}},'Env':['PGDATA='+m.PGDATA]}})
    def test_storage_limits_and_exact_socket_only(self):
        socket=Path('/tmp/wsx-pg-fixture-test/socket')
        good={'HostConfig':{'Memory':m.MEMORY_BYTES,'MemorySwap':m.MEMORY_BYTES,'Tmpfs':{m.PGDATA:'rw,size='+str(m.TMPFS_BYTES)}},'Mounts':[{'Type':'bind','Source':str(socket),'Destination':'/var/run/postgresql','RW':True}]}
        m.validate_container_storage(good,socket)
        for bad in ('memory','volume','socket'):
            value=copy.deepcopy(good)
            if bad=='memory':value['HostConfig']['Memory']=0
            elif bad=='volume':value['Mounts'].append({'Type':'volume','Destination':m.PGDATA})
            else:value['Mounts'][0]['Source']='/other'
            with self.assertRaises(RuntimeError):m.validate_container_storage(value,socket)
    def test_actual_imports_reject_nonisolated_connection_before_database(self):
        node=os.environ.get('CN_API_STARTUP_NODE')or shutil.which('node')
        self.assertTrue(node,'Node required, missing dependency is not a skip')
        loader=ROOT/'apps/api/node_modules/tsx/dist/loader.mjs';self.assertTrue(loader.is_file())
        with tempfile.TemporaryDirectory(prefix='wsx-pg-fixture-')as tmp:
            p=Path(tmp);config=p/'config.json'
            config.write_text(json.dumps(dict(host='production.invalid',user='fixture_owner',database='postgres',seed=1)))
            result=subprocess.run([node,'--import',str(loader),str(ROOT/'tests/fixtures/cn-application-recovery/lifecycle.ts'),str(config),'--phase','init'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
            self.assertEqual(result.returncode,1)
            diagnostic=p/'failure-diagnostic.json';self.assertTrue(diagnostic.is_file(),result.stderr.decode(errors='replace')[:300])
            value=json.loads(diagnostic.read_bytes());self.assertEqual(value['errorCode'],None)
            self.assertNotIn('production.invalid',diagnostic.read_text());self.assertFalse((p/'application-journal').exists())
if __name__=='__main__':unittest.main()
