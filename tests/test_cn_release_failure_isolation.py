"""Actual release functions with temporary files/processes; Docker/RDS are NOT run.

No invented release state machine: imported production template functions and the
actual main switch branch are exercised. Docker replies are explicit fixtures.
Database restore and PostgreSQL migration semantics remain outside this suite.
"""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / '.harness/scripts/vm/cn-runtime-continuation'

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

u = load(PACKAGE / 'upgrade-draft.py', 'failure_upgrade')
b = load(PACKAGE / 'backup-host.DRAFT.py', 'failure_backup')
f = load(ROOT / 'tests/test_cn_release_continuation_bind.py', 'failure_binder_fixture')
enc = lambda x: json.dumps(x).encode()

class BackupFiles(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.paths = []
        for region in ('cn', 'us'):
            parent = self.root / region; parent.mkdir()
            p = parent / 'compose.json'; p.write_bytes(enc({'region': region, 'secret': 'synthetic-only'}))
            self.paths.append(p)
        self.original = {p: p.read_bytes() for p in self.paths}
        self.bindings = [{'path': str(p), 'sha256': b.digest(p.read_bytes())} for p in self.paths]

    def unchanged(self):
        self.assertEqual({p: p.read_bytes() for p in self.paths}, self.original)

    def test_exact_real_copy_and_distinct_names_preserve_us(self):
        out = self.root / 'backup'
        records = b.backup_config_files(self.bindings, out)
        self.assertEqual(len({r['backupFile'] for r in records}), 2)
        for r in records:
            self.assertEqual((out / r['backupFile']).read_bytes(), self.original[Path(r['originalPath'])])
        self.unchanged()
        with self.assertRaises(FileExistsError): b.backup_config_files(self.bindings, out)
        self.unchanged()

    def test_drift_refuses_before_destination_or_source_mutation(self):
        self.bindings[0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(AssertionError, 'CONFIG_DRIFT'):
            b.backup_config_files(self.bindings, self.root / 'backup')
        self.assertFalse((self.root / 'backup').exists()); self.unchanged()

    def test_partial_io_failure_retained_and_no_blind_replay(self):
        real_open = b.os.open
        def fail_second(path, flags, *args):
            if Path(path).name.startswith('001-') and flags & b.os.O_CREAT:
                raise OSError('injected disk failure')
            return real_open(path, flags, *args)
        out = self.root / 'backup'
        with patch.object(b.os, 'open', fail_second):
            with self.assertRaisesRegex(OSError, 'injected'): b.backup_config_files(self.bindings, out)
        self.assertEqual(len(list(out.iterdir())), 1)
        with self.assertRaises(FileExistsError): b.backup_config_files(self.bindings, out)
        self.unchanged()

    def test_symlink_cannot_read_other_region(self):
        self.paths[0].unlink(); self.paths[0].symlink_to(self.paths[1])
        with self.assertRaises(OSError): b.backup_config_files(self.bindings, self.root / 'backup')
        self.assertFalse((self.root / 'backup').exists())
        self.assertEqual(self.paths[1].read_bytes(), self.original[self.paths[1]])

class RuntimeFailures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.hold = {'state': 'held', 'generation': 'fixed-generation'}
        self.binding = {'workingDir': '/fixture/cn', 'composeFiles': [{'path': '/fixture/cn/compose.json'}],
                        'candidateImages': {s: 'new-' + s for s in u.SERVICES},
                        'rollbackImages': {s: 'old-' + s for s in u.SERVICES}}
        self.rows = []
        for i, service in enumerate(u.SERVICES):
            labels = {'com.docker.compose.project': 'workspacex-cn', 'com.docker.compose.service': service,
                      'com.docker.compose.project.working_dir': '/fixture/cn',
                      'com.docker.compose.project.config_files': '/fixture/cn/compose.json'}
            self.rows.append({'Name': '/workspacex-cn-' + service + '-1', 'Id': str(i)*64,
                'Config': {'Image': 'old-' + service, 'Labels': labels}, 'State': {'Running': False, 'Restarting': False}})
        self.binding['expectedContainers'] = {x['Name']: {'id': x['Id'], 'image': x['Config']['Image']} for x in self.rows}
        self.calls = []

    def docker(self, args, timeout=60):
        self.calls.append(args)
        if 'image' in args:
            return enc([{'Os': 'linux', 'Architecture': 'amd64', 'RepoDigests': [args[-1]]}])
        if 'inspect' in args: return enc(self.rows)
        raise AssertionError('unexpected Docker call')

    def test_missing_candidate_never_stops_services(self):
        def missing(args, timeout=60):
            self.calls.append(args)
            raise subprocess.CalledProcessError(1, 'docker-image-inspect')
        with self.assertRaises(subprocess.CalledProcessError):
            u.stop_phase(self.binding, self.root, 'a'*64, self.hold, lambda:self.hold, missing, u.record)
        self.assertFalse((self.root/'stop-intent.json').exists())
        self.assertTrue(all('stop' not in a for a in self.calls))

    def test_stop_timeout_keeps_intent_without_success_or_second_stop(self):
        def timeout(args, limit=60):
            if 'stop' in args:
                self.calls.append(args)
                # A real bounded subprocess timeout, no Docker mutation.
                return subprocess.check_output([sys.executable, '-I', '-c', 'import time;time.sleep(2)'], timeout=.02)
            return self.docker(args, limit)
        with self.assertRaises(subprocess.TimeoutExpired):
            u.stop_phase(self.binding, self.root, 'a'*64, self.hold, lambda:self.hold, timeout, u.record)
        with self.assertRaises(FileExistsError):
            u.stop_phase(self.binding, self.root, 'a'*64, self.hold, lambda:self.hold, timeout, u.record)
        self.assertEqual(sum('stop' in a for a in self.calls), 1)
        self.assertFalse((self.root/'known-five-stop.json').exists())

    def test_start_partial_failure_keeps_hold_and_cannot_claim_business(self):
        u.record(self.root, "stop-intent.json", {"fixture": True})
        def failed(args, limit=60):
            if 'start' in args:
                self.calls.append(args)
                raise subprocess.CalledProcessError(17, 'fixture-start')
            return self.docker(args, limit)
        with self.assertRaises(subprocess.CalledProcessError):
            u.abort_original_phase(self.binding, self.root, 'a'*64, self.hold, lambda:self.hold, failed, u.record)
        with self.assertRaises(FileExistsError):
            u.abort_original_phase(self.binding, self.root, 'a'*64, self.hold, lambda:self.hold, failed, u.record)
        self.assertEqual(sum('start' in a for a in self.calls), 1)
        self.assertFalse((self.root/'abort-original-result.json').exists())
        self.assertEqual(self.hold['state'], 'held')

    def test_mixed_foreign_image_and_us_project_refuse_rollback(self):
        for field, value in [('image', 'unapproved-image'), ('project', 'workspacex-us')]:
            rows = copy.deepcopy(self.rows)
            if field == 'image': rows[0]['Config']['Image'] = value
            else: rows[0]['Config']['Labels']['com.docker.compose.project'] = value
            def provider(args):
                if 'ps' in args:
                    return b'\n'.join(enc({'ID': x['Id'], 'Names': x['Name'].lstrip('/')}) for x in rows)
                return enc(rows)
            with self.subTest(field=field), self.assertRaises(AssertionError):
                u.rollback_inventory(self.binding, self.root, provider)


    def actual_switch_branch(self, rows):
        # Compile the exact final branch from production main; no copied state machine.
        tree = ast.parse((PACKAGE/'upgrade-draft.py').read_text())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        branch = next(n for n in main.body if isinstance(n, ast.If) and ast.unparse(n.test) == "mode == 'backup'")
        code = compile(ast.fix_missing_locations(ast.Module(body=branch.orelse, type_ignores=[])), str(PACKAGE/'upgrade-draft.py'), 'exec')
        raw_backup = enc({'holdGeneration': self.hold['generation']}); raw_rds = enc({'fixture': 'provider'})
        self.binding.update(hostBackupReceiptSha256=u.sha(raw_backup), rdsBackupReceiptSha256=u.sha(raw_rds), backupProviderObservationReviewed=True)
        images = self.binding['candidateImages']
        def private(path):
            return {'backup-result.json': raw_backup, 'rds-backup-receipt.json': raw_rds,
                    'switch-images.json':enc({'services':{k:{'image':v}for k,v in images.items()}})}[Path(path).name]
        def command(args, timeout=60):
            self.calls.append(args)
            if 'image' in args: return enc([{'Os':'linux','Architecture':'amd64','RepoDigests':[args[-1]]}])
            if 'compose' in args: return b''
            if 'inspect' in args: return enc(rows)
            raise AssertionError('unexpected command')
        scope = dict(vars(u), b=self.binding, root=self.root, h=self.hold, hold=lambda:self.hold,
                     expected_sha='a'*64, mode='switch', names=[x['Name'].lstrip('/')for x in self.rows],
                     private=private, run=command)
        exec(code, scope)

    def test_switch_empty_or_duplicate_inspect_cannot_record_success(self):
        candidate = copy.deepcopy(self.rows)
        for x in candidate:
            service = x['Config']['Labels']['com.docker.compose.service']
            x['Config']['Image'] = self.binding['candidateImages'][service]; x['State']['Running'] = True
        for rows in ([], [candidate[0]]*5):
            with self.subTest(count=len(rows)):
                for p in self.root.iterdir(): p.unlink()
                with self.assertRaises(AssertionError): self.actual_switch_branch(rows)
                self.assertFalse((self.root/'switch-result.json').exists())

    def test_switch_rejects_wrong_name_project_restarting_and_mixed_images(self):
        for fault in ('name','project','restarting','image','id'):
            rows=copy.deepcopy(self.rows)
            for x in rows:
                service=x['Config']['Labels']['com.docker.compose.service']
                x['Config']['Image']=self.binding['candidateImages'][service]; x['State']['Running']=True
            if fault=='name': rows[0]['Name']='/workspacex-us-api-1'
            elif fault=='project': rows[0]['Config']['Labels']['com.docker.compose.project']='workspacex-us'
            elif fault=='restarting': rows[0]['State']['Restarting']=True
            elif fault=='image': rows[0]['Config']['Image']=self.binding['rollbackImages']['api']
            else: rows[0]['Id']=rows[1]['Id']
            for p in self.root.iterdir(): p.unlink()
            with self.subTest(fault=fault), self.assertRaises(AssertionError): self.actual_switch_branch(rows)
            self.assertFalse((self.root/'switch-result.json').exists())

    def test_switch_exact_five_records_runtime_only_and_cn_commands(self):
        candidate = copy.deepcopy(self.rows)
        for x in candidate:
            service=x['Config']['Labels']['com.docker.compose.service']
            x['Config']['Image']=self.binding['candidateImages'][service]; x['State']['Running']=True
        self.actual_switch_branch(candidate)
        result=json.loads((self.root/'switch-result.json').read_bytes())
        self.assertTrue(result['exactFiveRunning']); self.assertFalse(result['businessAcceptancePassed'])
        compose=next(a for a in self.calls if 'compose' in a)
        self.assertEqual(compose[compose.index('-p')+1], 'workspacex-cn')
        self.assertEqual(compose[-5:], list(u.SERVICES)); self.assertIn('never',compose)

class MigrationAdmission(unittest.TestCase):
    def test_real_binder_rejects_required_or_changed_migration_before_outputs(self):
        fixture = f.ReviewedPackageIntegration(); fixture.setUp(); self.addCleanup(fixture.doCleanups)
        for diff in ({'changedFiles':['migration.sql'], 'schemaMigrationRequired':False},
                     {'changedFiles':[], 'schemaMigrationRequired':True}):
            value = json.loads(fixture.inputs['migrationDiff']); value.update(diff)
            fixture.inputs['migrationDiff'] = f.enc(value)
            for retry in range(2):
                with self.subTest(diff=diff, retry=retry), self.assertRaisesRegex(ValueError, 'NO_MIGRATION_ONLY'):
                    fixture.run_bind()
                self.assertFalse((fixture.root/'out').exists())

if __name__ == '__main__': unittest.main()
