import copy
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_only', ROOT / 'scripts/cloud-build-only.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def valid_plan():
    return dict(schemaVersion=1, sourceRevision=m.APP, platform='linux/amd64',
                baseImages={key: tag.rsplit(':', 1)[0] + '@sha256:' + 'a' * 64 for key, tag in m.BASES.items()})

class BuildOnlyTests(unittest.TestCase):
    def test_frozen_app_and_services(self):
        self.assertEqual(m.APP, 'ee7e682805c27a38e9fd601c4aca66f11763ba91')
        self.assertEqual(set(m.SERVICES), {'api', 'web', 'agent', 'sandbox', 'postgres'})

    def test_previous_fcdd_plan_rejected(self):
        value = valid_plan()
        value["sourceRevision"] = "fcdd09cdc230b08947f19defb425e86988a3ecc0"
        with self.assertRaisesRegex(ValueError, "INVALID_BUILD_ONLY_IDENTITY"):
            m.validate(value)

    def test_wrong_source_rejected(self):
        value = valid_plan(); value['sourceRevision'] = 'b' * 40
        with self.assertRaises(ValueError): m.validate(value)

    def test_mutable_private_or_missing_base_rejected(self):
        for base in ['node:22', 'private.invalid/node@sha256:' + 'a'*64, 'docker.io/library/node@sha256:bad']:
            value = valid_plan(); value['baseImages']['node'] = base
            with self.assertRaises(ValueError): m.validate(value)
        value = valid_plan(); del value['baseImages']['postgres']
        with self.assertRaises(ValueError): m.validate(value)

    def test_extra_authority_and_platform_rejected(self):
        for key, val in [('registryPrefix', 'prod'), ('platform', 'linux/arm64'), ('schemaVersion', 2)]:
            value = valid_plan(); value[key] = val
            with self.assertRaises(ValueError): m.validate(value)

    def fake(self, calls, wrong_head=False, wrong_label=False, fail_build=False):
        def execute(argv, env):
            calls.append(argv)
            if argv[:3] == ['git', 'rev-parse', 'HEAD']: return 'b'*40 if wrong_head else m.APP
            if argv[:2] == ['git', 'archive']:
                with tarfile.open(argv[argv.index('--output')+1], 'w') as archive:
                    info = tarfile.TarInfo('fixture'); info.size = 2
                    archive.addfile(info, io.BytesIO(b'ok'))
                return ''
            if argv[:3] == ['docker', 'buildx', 'build']:
                if fail_build: raise RuntimeError('BUILD_FAILED')
                return ''
            if argv[:3] == ['docker', 'image', 'inspect']:
                return json.dumps([{'Id': 'sha256:'+'c'*64, 'Size': 123,
                                    'Config': {'Labels': {'org.opencontainers.image.revision': 'b'*40 if wrong_label else m.APP}}}])
            if argv[:4] == ['docker', 'buildx', 'imagetools', 'inspect']:
                return json.dumps({'digest': 'sha256:'+'a'*64})
            raise AssertionError('Unapproved command: '+repr(argv))
        return execute

    def test_five_builds_have_no_publish_or_production_command(self):
        for service in m.SERVICES:
            with self.subTest(service=service), tempfile.TemporaryDirectory() as tmp:
                calls=[]; output=Path(tmp)/'result.json'
                with patch.object(m, 'execute', self.fake(calls)):
                    m.build(valid_plan(), service, output, {})
                value=json.loads(output.read_text())
                self.assertLess(output.stat().st_size, 16384)
                for flag in ['pushed', 'sealed', 'prepared', 'productionActivated', 'runtimeVerified']:
                    self.assertIs(value[flag], False)
                build=[cmd for cmd in calls if cmd[:3]==['docker','buildx','build']][0]
                self.assertIn('--load', build)
                for cmd in calls:
                    self.assertNotIn('--push', cmd)
                    self.assertNotIn('push', cmd)
                    self.assertNotIn('login', cmd)
                    self.assertNotIn('sudo', cmd)
                    self.assertNotIn('--cache-to', cmd)
                self.assertTrue(all(cmd[0] in ['git','docker'] for cmd in calls))

    def test_wrong_head_stops_before_docker(self):
        calls=[]
        with patch.object(m,'execute',self.fake(calls,wrong_head=True)):
            with self.assertRaises(ValueError): m.build(valid_plan(),'api','unused',{})
        self.assertEqual(len(calls),1)

    def test_failure_or_wrong_label_creates_no_result(self):
        for flags in [dict(fail_build=True),dict(wrong_label=True)]:
            with tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp)/'result.json'; calls=[]
                with patch.object(m,'execute',self.fake(calls,**flags)):
                    with self.assertRaises((ValueError,RuntimeError)): m.build(valid_plan(),'api',output,{})
                self.assertFalse(output.exists())

    def test_public_plan_only_reads_three_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls=[]; output=Path(tmp)/'plan.json'
            with patch.object(m,'execute',self.fake(calls)): m.plan(output,{})
            m.validate(json.loads(output.read_text()))
            self.assertEqual(len(calls),3)
            self.assertTrue(all(cmd[:4]==['docker','buildx','imagetools','inspect'] for cmd in calls))

    def test_only_explicit_dispatch_can_admit_build(self):
        workflow = (ROOT / '.github/workflows/cloud-build-only.yml').read_text()
        trigger = workflow.split('on:\n', 1)[1].split('permissions:', 1)[0]
        self.assertEqual(trigger, '  workflow_dispatch:\n')
        gate = workflow.split('  plan:\n', 1)[1].split('    runs-on:', 1)[0]
        self.assertEqual(gate.strip(), "if: github.event_name == 'workflow_dispatch'")
        for event in ['pull_request', 'push', 'workflow_run', 'schedule']:
            self.assertNotIn(event + ':', trigger)
        self.assertIn('ref: ${{ github.sha }}', workflow)

    def test_workflow_has_no_environment_secret_or_privileged_job(self):
        workflow=(ROOT/'.github/workflows/cloud-build-only.yml').read_text()
        for forbidden in ['secrets.', 'vars.', 'environment:', 'self-hosted', 'contents: write', 'pull_request_target', 'docker push', 'sudo ', 'workflow_run:', 'push:']:
            self.assertNotIn(forbidden, workflow)
        self.assertIn('max-parallel: 5',workflow)
        self.assertIn("if: github.event_name == 'workflow_dispatch'",workflow)
        self.assertNotIn('pull_request', workflow)
        self.assertIn('persist-credentials: false',workflow)
        uses = [line.strip().split('uses: ', 1)[1] for line in workflow.splitlines() if 'uses: ' in line]
        self.assertEqual(set(uses), {'actions/checkout@v5', 'actions/upload-artifact@v6', 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'})

if __name__ == '__main__': unittest.main()
