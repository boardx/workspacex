"""Run unchanged repository manifest/seal CLIs; only Docker is synthetic."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPO = Path('/workspace/workspacex')
RUNTIME = ROOT / 'canonical-runtime'
NODE = ROOT / 'toolchain/node-v22.20.0-linux-x64/bin/node'
SPEC = importlib.util.spec_from_file_location('hosted_release', ROOT / 'scripts/hosted-release.py')
h = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(h)
GENERATOR_SPEC = importlib.util.spec_from_file_location('canonical_fixture_generator', ROOT / 'scripts/create-hosted-handoff-expected.py')
generator = importlib.util.module_from_spec(GENERATOR_SPEC)
GENERATOR_SPEC.loader.exec_module(generator)
SHA = 'a' * 40
DIGEST = 'b' * 64
DOCKER = '''#!/usr/bin/env python3
import json, os, sys
args=sys.argv[1:]
if args[0] in ('login','logout','pull'): sys.exit(0)
image=args[-1]
if args[:3]==['buildx','imagetools','inspect']:
 print('Digest: '+image.split('@')[1]);sys.exit(0)
if args[:2]==['image','inspect']:
 if '--format' in args: print(json.dumps([image]));sys.exit(0)
 source=os.environ['FIXTURE_SOURCE']
 if os.environ.get('FIXTURE_BAD_SOURCE')=='1': source='c'*40
 print(json.dumps([dict(Os='linux',Architecture='amd64',RepoDigests=[image],Config={'Labels':{'org.opencontainers.image.revision':source,'org.workspacex.build-identity':os.environ['FIXTURE_BUILD_IDENTITY']}})]));sys.exit(0)
sys.exit(2)
'''

class CanonicalIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        source = self.root / 'packages/cloud-deploy/src'
        source.mkdir(parents=True)
        self.source_hashes = {}
        for name in ('release-manifest-cli.ts','release-manifest.ts','release-candidate-cli.ts','release-candidate.ts','release.ts','image-reference.ts'):
            original = REPO / 'packages/cloud-deploy/src' / name
            copied = source / name
            shutil.copyfile(original, copied)
            self.source_hashes[name] = hashlib.sha256(original.read_bytes()).hexdigest()
            self.assertEqual(hashlib.sha256(copied.read_bytes()).hexdigest(), self.source_hashes[name])
        (self.root / 'package.json').write_text('{"type":"module"}')
        (self.root / 'node_modules').symlink_to(RUNTIME / 'node_modules', target_is_directory=True)
        binary = self.root / 'bin'
        binary.mkdir()
        (binary / 'docker').write_text(DOCKER)
        (binary / 'docker').chmod(0o700)
        self.env = dict(os.environ, PATH=str(binary)+os.pathsep+os.environ['PATH'],
                        FIXTURE_SOURCE=SHA, ACR_USERNAME='fixture', ACR_TOKEN='fixture-not-real')
        self.plan = h.validate_input(dict(schemaVersion=1, sourceRevision=SHA, release='2026.10.7-cn.1',
            attemptId='fixture-canonical-1', platform='linux/amd64',
            registryPrefix='reviewed.cn-hongkong.cr.aliyuncs.com/workspacex',
            acrRegion='cn-hongkong', acrInstanceId='cri-fixture123',
            registryProbeImage='reviewed.cn-hongkong.cr.aliyuncs.com/workspacex/probe@sha256:'+DIGEST,
            baseImages={key:'base.example/library/'+key+'@sha256:'+DIGEST for key in ('node','python','postgres','redis')}))
        self.plan['_planSha256'] = hashlib.sha256(json.dumps(self.plan,sort_keys=True).encode()).hexdigest()
        self.env['FIXTURE_BUILD_IDENTITY'] = h.build_identity(self.plan)
        self.assertEqual(subprocess.run([str(NODE), '--version'], check=True, text=True, capture_output=True).stdout.strip(), 'v22.20.0')
        self.control_root = self.root / 'control'
        self.control_path = self.control_root / 'canonical-control.json'
        self.expected_path = self.root / 'expected.json'
        reviewed_path = self.root / 'reviewed-identity.json'
        reviewed_path.write_text(json.dumps({key: self.plan[key] for key in generator.v.IDENTITY}))
        self.expected = generator.create(reviewed_path, REPO, RUNTIME / 'node_modules',
                                         self.control_root, NODE, self.expected_path,
                                         control_output=self.control_path)
        self.control_sha256 = hashlib.sha256(self.control_path.read_bytes()).hexdigest()
        self.results = self.root / 'results'
        self.results.mkdir()
        for service, mapping in h.SERVICES.items():
            value={key:self.plan[key] for key in ('sourceRevision','attemptId','platform')}
            value.update(service=service,image=self.plan['registryPrefix']+'/'+mapping[0]+'@sha256:'+DIGEST,planSha256=self.plan['_planSha256'])
            (self.results/(service+'.json')).write_text(json.dumps(value))

    def aggregate(self):
        previous = Path.cwd()
        try:
            os.chdir(self.root)
            from unittest.mock import patch
            with patch.dict(os.environ,self.env,clear=True):
                h.aggregate(self.plan,self.results,self.root/'sealed',
                            control_config=self.control_path, control_sha256=self.control_sha256)
        finally:
            os.chdir(previous)

    def canonical_command(self, script, *args):
        with h.control.canonical_snapshot(self.control_path, self.control_sha256) as control:
            return subprocess.run([control['nodeExecutable'], '--import', 'tsx',
                                   'packages/cloud-deploy/src/' + script, *map(str, args)],
                                  cwd=control['directory'], env=h.control.canonical_environment(self.env),
                                  text=True, capture_output=True, timeout=60)

    def test_actual_manifest_and_seal_cli_succeed_and_bind_bytes(self):
        self.aggregate()
        output=self.root/'sealed'
        manifest=(output/'release.json').read_bytes()
        seal=json.loads((output/'release.sealed.json').read_text())
        self.assertEqual(seal['status'],'sealed')
        self.assertEqual(seal['manifestSha256'],hashlib.sha256(manifest).hexdigest())
        self.assertEqual(set(json.loads(manifest)['images']),set(h.SERVICES)|{'redis'})
        receipt=json.loads((output/'artifact-build.json').read_text())
        self.assertEqual(receipt['manifestSha256'],seal['manifestSha256'])
        self.assertEqual(receipt['stage'],'hosted-artifact-build')
        self.assertIs(receipt['productionActivated'],False)

    def test_actual_seal_cli_rejects_changed_manifest_bytes(self):
        self.aggregate()
        output=self.root/'sealed'
        manifest=output/'release.json'
        manifest.write_bytes(manifest.read_bytes()+b'\n')
        result=self.canonical_command('release-candidate-cli.ts', 'validate', manifest, output/'release.sealed.json', SHA)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('RELEASE_CANDIDATE_MANIFEST_MISMATCH',result.stderr)

    def test_actual_manifest_cli_rejects_missing_service(self):
        input_file=self.root/'bad-input.json'
        input_file.write_text(json.dumps({key:self.plan[key] for key in ('schemaVersion','release','sourceRevision','platform')}|{'images':{}}))
        result=self.canonical_command('release-manifest-cli.ts', input_file, self.root/'bad-manifest.json')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('INVALID_RELEASE_BUILD_INPUT',result.stderr)
        self.assertFalse((self.root/'bad-manifest.json').exists())

if __name__ == '__main__':
    unittest.main()
