import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack, contextmanager

ROOT=Path(__file__).resolve().parents[1]
def module():
    spec=importlib.util.spec_from_file_location('deploy_registry',ROOT/'scripts/deploy-registry-images.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

@contextmanager
def host_fixture():
    """Exercise host state writes with fixed policy; replace privileged host boundaries."""
    m=module()
    with tempfile.TemporaryDirectory() as temp, ExitStack() as patches:
        root=Path(temp);state=root/'state';state.mkdir();lock=root/'lock';lock.touch()
        config={'environment':'devapp','registryPrefix':'registry.example/team','docker':'/usr/bin/docker',
                'dockerConfig':str(root/'docker'),'stateDirectory':str(state),
                'lockFile':'/run/workspacex-devapp-deploy.lock','composeFiles':[],
                'envFile':{'path':str(root/'env'),'sha256':'a'*64},'project':'example',
                'services':{},'health':{},'verificationCommand':['/usr/bin/true']}
        (root/'devapp.json').write_text(json.dumps(config))
        patches.enter_context(patch.object(m,'trusted',side_effect=lambda path,**kwargs:Path(path)))
        patches.enter_context(patch.object(m.engine,'trusted_file'))
        real_open=os.open
        patches.enter_context(patch.object(m.os,'open',side_effect=lambda path,*args,**kwargs:real_open(lock if str(path)==config['lockFile'] else path,*args,**kwargs)))
        images={role:{'sourceRevision':'b'*40} for role in m.registry.SERVICES}
        resolve=patches.enter_context(patch.object(m.registry,'resolve',side_effect=lambda docker,prefix,tag,role:images[role]))
        def release(config_file,manifest_file,directory,execute,lock_fd,commit):
            override=state/'override.yml';override.write_text('services: {}\n');commit(override)
            return {'status':'SUCCEEDED'}
        run=patches.enter_context(patch.object(m.engine,'release',side_effect=release))
        yield m,root,state,images,resolve,run

class Policy(unittest.TestCase):
    def test_missing_policy_never_pulls_or_deploys(self):
        m=module()
        with patch.object(m.registry,'resolve') as pull:
            with self.assertRaises(FileNotFoundError): m.deploy('devapp','a'*40+'-123-1',Path('/nonexistent/release-config'))
            pull.assert_not_called()
    def test_environment_and_tag_reject_injection(self):
        m=module()
        for environment,tag in [('other','a'*40+'-123-1'),('cn','latest'),('../cn','a'*40+'-123-1')]:
            with self.assertRaises(ValueError): m.deploy(environment,tag)
    def test_cn_cannot_skip_existing_host_admission(self):
        m=module()
        with self.assertRaisesRegex(ValueError,'CN_ADMISSION_REQUIRED'):m.admission_command({},'cn')
        self.assertIsNone(m.admission_command({},'devapp'))

    def test_verified_image_source_propagates_for_short_and_legacy_tags(self):
        for tag in ['40174623496-1','b'*40+'-123-1']:
            with self.subTest(tag=tag), host_fixture() as (m,root,state,images,resolve,run):
                result=m.deploy('devapp',tag,root)
                manifest=json.loads((Path(result['evidenceDirectory'])/'manifest.json').read_text())
                pointer=json.loads((state/'current.json').read_text())
                self.assertEqual(manifest['sourceRevision'],'b'*40)
                self.assertEqual(pointer['sourceRevision'],'b'*40)
                self.assertEqual(pointer['tag'],tag)
                self.assertEqual(manifest['tag'],tag)
                self.assertEqual(resolve.call_count,5)
                run.assert_called_once()
                self.assertFalse((state/'pending.json').exists())

    def test_missing_invalid_or_mixed_image_sources_reject_before_state_mutation(self):
        for role in module().registry.SERVICES:
            for source in [None,'','b'*39,'B'*40,123,'c'*40]:
                with self.subTest(role=role,source=source), host_fixture() as (m,root,state,images,resolve,run):
                    image=images[role]
                    if source is None: image.pop('sourceRevision')
                    else: image['sourceRevision']=source
                    with self.assertRaisesRegex(ValueError,'IMAGE_SOURCE_MISMATCH'):
                        m.deploy('devapp','b'*40+'-123-1',root)
                    run.assert_not_called()
                    self.assertEqual(list(state.iterdir()),[])

    def test_us_uses_private_policy_and_canonical_selfhost_lock(self):
        with host_fixture() as (m,root,state,images,resolve,run):
            config=json.loads((root/'devapp.json').read_text())
            config.update(environment='us',lockFile='/run/workspacex-selfhost-deploy.lock')
            (root/'us.json').write_text(json.dumps(config))
            real_open=os.open
            fixture_lock=root/'us-lock';fixture_lock.touch()
            with patch.object(m.os,'open',side_effect=lambda path,*args,**kwargs:real_open(fixture_lock if str(path)==config['lockFile'] else path,*args,**kwargs)):
                result=m.deploy('us','40216660127-1',root)
            self.assertEqual(result['status'],'SUCCEEDED')
            self.assertEqual(result['environment'],'us')
            self.assertEqual(resolve.call_count,5)
            self.assertFalse((state/'pending.json').exists())
            config['lockFile']='/run/workspacex-devapp-deploy.lock'
            (root/'us.json').write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError,'CANONICAL_LOCK_REQUIRED'):
                m.deploy('us','40216660127-1',root)

    def test_atomic_pointer_is_complete(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'current.json';m.atomic(p,{'tag':'old'});m.atomic(p,{'tag':'new'})
            self.assertEqual(json.loads(p.read_text()),{'tag':'new'});self.assertEqual(p.stat().st_mode & 0o777,0o600)
    def test_untrusted_policy_is_rejected(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'config';p.write_text('{}');p.chmod(0o666)
            with self.assertRaises(ValueError): m.trusted(p)
    def test_symlink_ancestor_is_rejected(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'real').mkdir();(root/'link').symlink_to(root/'real',target_is_directory=True)
            p=root/'real'/'config';p.write_text('{}')
            with self.assertRaises(ValueError): m.trusted(root/'link'/'config')

if __name__=='__main__':unittest.main()
