"""Execute upgraded historical host consumers against the existing host fixture."""
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

import test_deploy_registry_images as consumer_tests

ROOT=Path(__file__).resolve().parents[1]
CONSUMER=ROOT/'scripts/deploy-registry-images.py'
ATTEMPT="        attempt=state/('attempt-'+uuid.uuid4().hex);attempt.mkdir(mode=0o700)"


def upgrader():
    spec=importlib.util.spec_from_file_location('upgrade_image_tag_consumer',ROOT/'scripts/upgrade-image-tag-consumer.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def historical_consumer(attempt_before_images):
    # Keep the full real deployment path; restore the two historical source slices
    # and remove the new revision validation, retaining either installed ordering.
    lines=CONSUMER.read_text().splitlines()
    lines=[line for line in lines if not line.startswith((
        '        sources=', '        registry.need(all(isinstance(source,str)', '        source=sources[0]'))
        and line!=ATTEMPT]
    images=next(i for i,line in enumerate(lines) if line.startswith('        images={role:registry.resolve'))
    lines.insert(images if attempt_before_images else images+1,ATTEMPT)
    return ('\n'.join(lines)+'\n').replace("'sourceRevision':source","'sourceRevision':tag[:40]")


def upgraded_module(code):
    upgraded=types.ModuleType('upgraded_consumer')
    upgraded.__file__=str(CONSUMER)
    exec(compile(upgrader().upgrade_consumer(code),str(CONSUMER),'exec'),upgraded.__dict__)
    return upgraded


class Upgrade(unittest.TestCase):
    def test_both_installed_orderings_execute_with_verified_source(self):
        for before in [True,False]:
            with self.subTest(attempt_before_images=before):
                module=upgraded_module(historical_consumer(before))
                with patch.object(consumer_tests,'module',return_value=module),consumer_tests.host_fixture() as (m,root,state,images,resolve,run):
                    result=m.deploy('devapp','40174623496-1',root)
                    manifest=json.loads((Path(result['evidenceDirectory'])/'manifest.json').read_text())
                    self.assertEqual(manifest['sourceRevision'],'b'*40)
                    self.assertEqual(json.loads((state/'current.json').read_text())['sourceRevision'],'b'*40)
                    self.assertEqual(resolve.call_count,5)
                    run.assert_called_once()
                    self.assertFalse((state/'pending.json').exists())

    def test_invalid_and_mixed_sources_reject_before_creating_attempt(self):
        for before in [True,False]:
            for revision in [None,'invalid','c'*40]:
                with self.subTest(attempt_before_images=before,revision=revision):
                    module=upgraded_module(historical_consumer(before))
                    with patch.object(consumer_tests,'module',return_value=module),consumer_tests.host_fixture() as (m,root,state,images,resolve,run):
                        last=images[list(images)[-1]]
                        if revision is None: last.pop('sourceRevision')
                        else: last['sourceRevision']=revision
                        with self.assertRaisesRegex(ValueError,'IMAGE_SOURCE_MISMATCH'):
                            m.deploy('devapp','40174623496-1',root)
                        run.assert_not_called()
                        self.assertEqual(resolve.call_count,5)
                        self.assertEqual(list(state.iterdir()),[])


if __name__=='__main__': unittest.main()
