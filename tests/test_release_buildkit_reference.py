"""Execute the release shell's builder reference boundary without Docker/network."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ReleaseBuildkitReference(unittest.TestCase):
    def test_builder_uses_only_the_planned_registry_namespace_repository_and_digest(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/image-release.yml').read_text()
        step = workflow.split('      - name: Build and publish service\n', 1)[1]
        block = step.split('        run: |\n', 1)[1].split('      - uses:', 1)[0]
        script = '\n'.join(line[10:] for line in block.splitlines())
        digest = 'sha256:' + 'a' * 64
        expected = 'test-registry-vpc.cn-shanghai.cr.aliyuncs.com/images/skill-sandbox@' + digest
        cases = ((expected, 'skill-sandbox', True),
                 (expected.replace('/images/', '/other/'), 'skill-sandbox', False),
                 (expected.replace('test-registry-vpc.', 'other-registry-vpc.'), 'skill-sandbox', False),
                 (expected.replace('/skill-sandbox@', '/api@'), 'skill-sandbox', False),
                 (expected.replace('@' + digest, ':latest'), 'skill-sandbox', False),
                 (expected, '../skill-sandbox', False),
                 (expected, '', False))
        for image, repository, allowed in cases:
            with self.subTest(image=image, repository=repository), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                producer = root / 'producer.py'
                producer.write_text('import json,os\nfrom pathlib import Path\n'
                                    'Path(os.environ["TRACE_PRODUCER"]).write_text(json.dumps('
                                    '{"builder":os.environ.get("BUILDX_BUILDER","")}))\n')
                docker = root / 'docker'
                docker.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$TRACE_DOCKER"\n')
                docker.chmod(0o700)
                env = {'PATH': str(root) + os.pathsep + os.environ.get('PATH', ''),
                       'SERVICE': 'sandbox', 'WSX_CN_AGENT_CACHE_REPOSITORY': '',
                       'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
                       'RELEASE_SCRIPT': str(producer), 'SOURCE_REVISION': 'b' * 40,
                       'REGISTRY': 'test-registry.cn-shanghai.cr.aliyuncs.com',
                       'REGISTRY_PREFIX': 'test-registry.cn-shanghai.cr.aliyuncs.com/images',
                       'IMAGE_TAG': '123-1', 'BUILDKIT_IMAGE': image,
                       'BUILDKIT_REPOSITORY': repository,
                       'TRACE_PRODUCER': str(root / 'producer.json'), 'TRACE_DOCKER': str(root / 'docker.txt')}
                result = subprocess.run(['bash', '-e', '-c', script], env=env, capture_output=True, text=True, timeout=10)
                if allowed:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads((root / 'producer.json').read_text())['builder'], 'wsx-sandbox-123-1')
                    self.assertEqual((root / 'docker.txt').read_text().splitlines(),
                                     ['buildx create --name wsx-sandbox-123-1 --driver docker-container --driver-opt image=' + expected,
                                      'buildx rm wsx-sandbox-123-1'])
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse((root / 'producer.json').exists())
                    self.assertFalse((root / 'docker.txt').exists())


if __name__ == '__main__':
    unittest.main()
