"""Offline preload contract checks; no Docker or database is started."""
import ast
import json
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
import subprocess
import tempfile
import shutil
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'tests/cn_release_application_recovery_complete_linux.py'
spec = importlib.util.spec_from_file_location('complete_fixture', PATH)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class PreloadContract(unittest.TestCase):
    def test_catalog_comparison_rejects_large_drift_without_diff_or_rows(self):
        node=shutil.which('node');self.assertTrue(node)
        code="""import assert from 'node:assert/strict';
import {assertCatalogEqual,constraintDifferences} from './tests/fixtures/cn-application-recovery-complete/catalog-assert.ts';
import {diagnostic,mark} from './tests/fixtures/cn-application-recovery-complete/diagnostic.ts';
const original={functions:Array.from({length:20000},(_,i)=>({name:'secret_'+i,definition:'PRIVATE SQL '.repeat(20)})),roles:[{name:'owner'}]};
assertCatalogEqual(structuredClone(original),original);
mark('compatibility');assert.equal(diagnostic(new Error('private')).catalogCategory,null);
const constraint={schema:'private',relation:'private',name:'private',kind:'c',deferrable:false,deferred:false,validated:false,definition:'PRIVATE CHECK SQL NOT VALID'};
const delta=constraintDifferences([{...constraint,validated:true,definition:'PRIVATE CHECK SQL'}],[constraint]);
assert.equal(delta.differingCount,1);assert.deepEqual(delta.changes[0].fields,['validated','definition']);assert(!JSON.stringify(delta).includes('PRIVATE'));assert.equal(delta.changes[0].expected.notValid,true);
for(const value of [{...original,functions:[...original.functions,{name:'PRIVATE'}]}, {...original,roles:[{name:'other'}]}, {...original,extra:[]}]){
 try{assertCatalogEqual(value,original);assert.fail('accepted drift');}catch(e){assert.match(e.message,/^RESTORE_CATALOG_(?:SCOPE_)?MISMATCH$/);assert(e.message.length<80);}
}
mark('restore-catalog');try{assertCatalogEqual({...original,roles:[]},original);}catch(e){console.log(JSON.stringify(diagnostic(e)));}
"""
        value=json.loads(subprocess.check_output([node,'--import','tsx','--input-type=module','-e',code],cwd=ROOT,timeout=15))
        self.assertEqual(value['catalogCategory'],'roles');self.assertEqual(value['stage'],'restore-catalog')
        self.assertNotIn('PRIVATE',json.dumps(value));self.assertLess(len(json.dumps(value)),8192)

    def test_restore_journal_projection_and_rejected_reason(self):
        spec=importlib.util.spec_from_file_location('restore_bridge',ROOT/'tests/fixtures/cn-postgres-lifecycle/driver_bridge.py');bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
        e=SimpleNamespace(read=lambda p:p.read_bytes(),decode=json.loads)
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);stem=root/'state/pg-lifecycle-fixture/02-restore';stem.parent.mkdir(parents=True)
            terminal=dict(reason='EXITED',exitCode=1,stdoutSha256='a'*64,processGroupStillPresent=False,finishedAt='private-not-output')
            process=dict(pid=42,isolation={'secret':'never-output'},requestSha256='b'*64)
            Path(str(stem)+'.terminal.json').write_text(json.dumps(terminal));Path(str(stem)+'.process.json').write_text(json.dumps(process))
            value=bridge.restore_failure_projection(e,root)
            self.assertEqual(value['terminal']['exitCode'],1);self.assertEqual(value['process']['pid'],42);self.assertNotIn('secret',json.dumps(value));self.assertNotIn('private-not-output',json.dumps(value))
            raw=('CN_PG_RESTORE_DIAGNOSTIC '+json.dumps(value)+'\npg_fixture_entry.Rejected: EXECUTION_UNCERTAIN_RECONCILE_NO_RETRY\n').encode()
            observed=fixture.failure_projection(raw,root);self.assertEqual(observed['reason'],'EXECUTION_UNCERTAIN_RECONCILE_NO_RETRY');self.assertEqual(observed['restoreTerminalDiagnostic'],value)
            terminal['reason']='SECRET';Path(str(stem)+'.terminal.json').write_text(json.dumps(terminal));self.assertIsNone(bridge.restore_failure_projection(e,root)['terminal'])
            value['terminal']['argv']='secret';self.assertIsNone(fixture.failure_projection(('CN_PG_RESTORE_DIAGNOSTIC '+json.dumps(value)).encode(),root)['restoreTerminalDiagnostic'])
            self.assertEqual(fixture.failure_projection(b'pg_fixture_entry.Rejected: PRIVATE_SECRET\n',root)['reason'],'UNCLASSIFIED')

    def test_bridge_projection_reports_phase_and_fixed_reason_without_raw_error(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);(root/'application-journal').mkdir();(root/'application-journal/init.intent.json').write_text('{}')
            raw=b'File "/private/driver_bridge.py", line 133\nRuntimeError: FIXTURE_CHAIN_INCOMPLETE\nsecret password SELECT url=https://private.invalid\n'
            value=fixture.failure_projection(raw,root);self.assertEqual(value['reason'],'FIXTURE_CHAIN_INCOMPLETE');self.assertEqual(value['frames'],[dict(file='driver_bridge.py',line=133)])
            self.assertTrue(value['phaseRecords'][0]['intentPresent']);self.assertFalse(value['phaseRecords'][0]['receiptPresent']);self.assertFalse(value['phaseRecordsVerified'])
            self.assertNotIn('secret',json.dumps(value));self.assertNotIn('SELECT',json.dumps(value))
            self.assertEqual(fixture.failure_projection(b'RuntimeError: SECRET_VALUE\n',root)['reason'],'UNCLASSIFIED')
    def test_real_typescript_diagnostic_captures_causes_without_secret(self):
        node=shutil.which('node');self.assertTrue(node)
        code="import{diagnostic,mark}from'./tests/fixtures/cn-application-recovery-complete/diagnostic.ts';mark('initial-migrations');const cause=Object.assign(new Error('secret SELECT password url'),{code:'42501'});console.log(JSON.stringify(diagnostic(new Error('private',{cause}))));"
        value=json.loads(subprocess.check_output([node,'--import','tsx','--input-type=module','-e',code],cwd=ROOT,timeout=15))
        self.assertEqual(value['stage'],'initial-migrations');self.assertEqual(value['causes'][1]['errorCode'],'42501');self.assertNotIn('secret',json.dumps(value));self.assertNotIn('SELECT',json.dumps(value));self.assertLess(len(json.dumps(value)),8192)
    def test_override_retains_original_image_preload(self):
        image = (ROOT / 'apps/api/docker/postgres-age/Dockerfile').read_text()
        self.assertIn('CMD ["postgres", "-c", "shared_preload_libraries=age"]', image)
        self.assertEqual(fixture.postgres_command(), [
            'postgres', '-c', 'shared_preload_libraries=age', '-c',
            'listen_addresses=', '-c', 'statement_timeout=85000'])
        main = next(x for x in ast.parse(PATH.read_text()).body
                    if isinstance(x, ast.FunctionDef) and x.name == 'main')
        calls = [n for n in ast.walk(main) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Name)]
        self.assertEqual(len([n for n in calls if n.func.id == 'postgres_command']), 1)
        preload = next(n for n in calls if n.func.id == 'check_preload')
        bridge = next(n for n in calls if n.func.id == 'bridge_command')
        self.assertLess(preload.lineno, bridge.lineno)

    def test_live_setting_readback_before_acceptance(self):
        with patch.object(fixture, 'run', return_value=SimpleNamespace(stdout=b'age\n')) as run:
            fixture.check_preload('/fixed/docker', 'owned-container')
        self.assertEqual(run.call_args.args[0], [
            '/fixed/docker', 'exec', 'owned-container', 'psql', '-XAt', '-U',
            'fixture_owner', '-d', 'postgres', '-c',
            "SELECT current_setting('shared_preload_libraries')"])

    def test_available_extension_does_not_prove_preload(self):
        for observed in (b'', b'\n', b'vector\n', b'age,other\n', b'age\nvector\n'):
            with self.subTest(observed=observed), patch.object(
                    fixture, 'run', return_value=SimpleNamespace(stdout=observed)):
                with self.assertRaisesRegex(RuntimeError, '^AGE_PRELOAD_REQUIRED$'):
                    fixture.check_preload('/fixed/docker', 'owned-container')


if __name__ == '__main__':
    unittest.main()
