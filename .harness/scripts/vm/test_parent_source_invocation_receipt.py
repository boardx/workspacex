import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).parent.resolve()


class ParentInvocationTests(unittest.TestCase):
    def run_case(self, mode):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            root.chmod(0o700)
            sources = root / 'sources'
            sources.mkdir(mode=0o700)
            source = sources / 'parent_source_invocation_receipt.py'
            source.write_bytes((ROOT / source.name).read_bytes())
            source.chmod(0o700)
            executable = root / 'python3'
            shutil.copyfile(Path('/usr/bin/python3').resolve(), executable)
            executable.chmod(0o755)
            evidence = root / 'evidence'
            evidence.mkdir(mode=0o700)
            provider = evidence / 'provider.json'
            provider.write_text(json.dumps({'providerBindingSha256': 'a' * 64}))
            provider.chmod(0o600)
            # Disposable test runner loads exact local repository modules. The
            # recorder's fixture dispatch is source-compiled and non-root only;
            # no runtime callbacks or caller passed outcome flags are installed.
            script = r'''
import importlib.util,hashlib,json,os,pathlib,sys
repo,fixture,mode=sys.argv[1:]
sys.path.insert(0,repo)
spec=importlib.util.spec_from_file_location('epoch_recovery',pathlib.Path(repo)/'cn-maintenance-recovery-evidence-verifier.py')
recovery=importlib.util.module_from_spec(spec);sys.modules['epoch_recovery']=recovery;spec.loader.exec_module(recovery)
import parent_source_invocation_receipt as p
from current_epoch_qualification import QualificationCodeAuthority
root=pathlib.Path(fixture)
# Ambient ancestors are fixture infrastructure; evidence and source files remain real.
original_lstat=pathlib.Path.lstat
def fixture_lstat(path):
 value=original_lstat(path)
 if path in root.parents:
  fields=list(value);fields[0]&=~0o022;fields[4:6]=[os.geteuid(),os.getegid()];return os.stat_result(fields)
 return value
pathlib.Path.lstat=fixture_lstat
source=root/'sources/parent_source_invocation_receipt.py';exe=root/'python3'
sha=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
code=QualificationCodeAuthority({p.SOURCE:{'path':str(source),'sha256':sha(source)}},{str(exe):sha(exe)},uid=os.getuid(),gid=os.getgid(),fixture_root=root)
protected=recovery.ProtectedArtifacts(root/'evidence',uid=os.getuid(),gid=os.getgid())
ref=protected.reference(root/'evidence/provider.json')
capture=p._FixtureCapture(root/'evidence',{'providerBindingSha256':'a'*64},mode)
if mode=='source-drift':source.write_bytes(source.read_bytes()+b'\n# drift\n')
try:
 result=p.record_production(capture,code,protected,'local-parent',[ref],local_fixture=True)
 print(json.dumps(result,sort_keys=True))
except Exception as error:
 print(type(error).__name__+':'+str(error))
finally:
 for child in p.direct_children():
  try:os.waitpid(child,0)
  except ChildProcessError:pass
'''
            result = subprocess.run([str(executable), '-I', '-c', script, str(ROOT), str(root), mode], capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            return result.stdout.decode().strip(), result.stderr.decode()

    def test_actual_same_parent_identity_twelve_outputs_unqualified(self):
        raw, stderr = self.run_case('success')
        self.assertEqual(stderr, '')
        result = json.loads(raw)
        self.assertFalse(result['ready'])
        self.assertFalse(result['qualified'])
        self.assertFalse(result['sourcePolicyApproved'])
        self.assertEqual(len(result['invocations']), 12)
        pids = {record['pid'] for record in result['invocations'].values()}
        self.assertEqual(len(pids), 1)
        for kind, record in result['invocations'].items():
            self.assertEqual(record['kind'], kind)
            self.assertEqual(record['schemaVersion'], 2)
            self.assertEqual(record['exitCode'], 0)
            self.assertTrue(record['ownedChildrenJoined'])
            self.assertTrue(record['processStart'].isdigit())
            self.assertLessEqual(record['startedAt'], record['endedAt'])
            self.assertEqual(set(record['namespaces']), {'pid', 'mnt', 'net'})
            self.assertIn('bytes', record['output'])
        self.assertFalse(any(kind.startswith(('objects:', 'stage:', 'journey:')) for kind in result['invocations']))

    def test_actual_failure_has_no_invocation_draft(self):
        raw, _ = self.run_case('failure')
        self.assertEqual(raw, 'ValueError:PARENT_SOURCE_FIXTURE_ACTUAL_FAILURE')

    def test_independent_source_pin_drift_blocks_before_operation(self):
        raw, _ = self.run_case('source-drift')
        self.assertEqual(raw, 'ValueError:EPOCH_CODE_RAW_HASH')

    def test_actual_unjoined_child_blocks_receipt(self):
        raw, _ = self.run_case('unjoined')
        self.assertEqual(raw, 'ValueError:PARENT_SOURCE_NEW_CHILD_NOT_JOINED')


if __name__ == '__main__':
    unittest.main()
