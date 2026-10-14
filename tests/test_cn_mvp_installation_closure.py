"""Cloud reproducibility and pre-import rejection for privileged wrappers."""
import ast
import importlib.util
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).parents[1]
spec=importlib.util.spec_from_file_location('closure',ROOT/'scripts/cn-release-installation-closure.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class CloudWrappers(unittest.TestCase):
    def test_cloud_rebuild_pins_entire_canonical_package_without_workstation_path(self):
        files=m.inventory(ROOT)
        self.assertIn('scripts/cn-release-mvp-private-input.py',files)
        for entry in ('release','evidence','prepare'):
            raw=m.fixed_wrapper(files,entry)
            self.assertEqual(raw,m.fixed_wrapper(dict(reversed(list(files.items()))),entry))
            self.assertNotIn(b'/Users/',raw)
            parsed=ast.parse(raw)
            pins=next(ast.literal_eval(node.value)for node in parsed.body
                if isinstance(node,ast.Assign)and any(isinstance(target,ast.Name)and target.id=='pins'for target in node.targets))
            self.assertEqual(pins,files)
            self.assertIn(m.digest(files).encode(),raw)

    def test_unapproved_arguments_reject_before_any_privileged_file_or_import(self):
        raw=m.fixed_wrapper(m.inventory(ROOT),'prepare')
        for args in (['wrapper','run','a'*64],['wrapper','prepare','latest'],['wrapper','prepare','a'*64,'extra']):
            with patch.object(sys,'argv',args),patch('os.geteuid',return_value=0),patch.object(Path,'lstat',side_effect=AssertionError('privileged read')):
                with self.assertRaises(SystemExit)as result:
                    exec(compile(raw,'cloud-wrapper','exec'),{'__name__':'__main__'})
                self.assertEqual(result.exception.code,20)


class ProbeInstallationContract(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.probe=Path(self.temp.name)/'probe.json'
        spec=importlib.util.spec_from_file_location('orchestrator',ROOT/'scripts/cn-release-orchestrate.py')
        self.plan=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.plan)
        spec=importlib.util.spec_from_file_location('host_probe',ROOT/'scripts/cn-release-mvp-host-capability.py')
        self.host=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.host)

    def test_real_collect_result_consumed_by_installation_generator(self):
        import json
        from types import SimpleNamespace
        with patch.object(Path,'lstat',side_effect=FileNotFoundError),patch.object(Path,'read_text',side_effect=PermissionError),patch.object(self.host.subprocess,'run',return_value=SimpleNamespace(stdout=b'',returncode=1)):
            observation=self.host.collect()
        self.probe.write_text(json.dumps(observation))
        plan=self.plan.installation_plan(self.probe)
        targets={row['path'] for row in observation['paths']}
        self.assertTrue(set(plan['directories']).issubset(targets))
        for row in plan['files']+[plan[key] for key in ('fixedDriver','fixedRecoveryDriver','readOnlyEvidencePortal','approvedCloudPreparation')]:
            self.assertIn(row['target'],targets)
            self.assertTrue(row['oldStateVerified']);self.assertTrue(row['expectedOldAbsent'])
        for name in ('/etc/workspacex-cn/mvp-approval-blueprints','/etc/workspacex-cn/mvp-approval-blueprints/objects','/var/lib/workspacex-cn/release-generated/mvp-approval','/etc/workspacex-cn/mvp-cloud-policies','/etc/workspacex-cn/mvp-cloud-policies/objects','/var/lib/workspacex-cn/release-generated/mvp-cloud-preparation'):
            self.assertIn(name,plan['directories'])
        self.assertFalse(plan['installationReady'])

    def test_denied_duplicate_symlink_and_invalid_hash_never_verify_old_state(self):
        import json
        target='/usr/local/bin/workspacex-cn-fixed-release'
        for rows in ([{'path':target,'metadataReadable':False}],
                     [{'path':target,'exists':True,'bytesReadable':False}],
                     [{'path':target,'exists':True,'sha256':'invalid','symlink':False,'hashStatus':'HASHED'}],
                     [{'path':target,'exists':True,'sha256':'a'*64,'symlink':True}],
                     [{'path':target,'exists':False}]*2):
            self.probe.write_text(json.dumps({'paths':rows}))
            row=self.plan.installation_plan(self.probe)['fixedDriver']
            self.assertFalse(row['oldStateVerified']);self.assertIsNone(row['expectedOldSha256'])

    def test_valid_hash_and_legacy_probe_shapes(self):
        import json
        for key in ('paths','wrappers','targets'):
            self.probe.write_text(json.dumps({key:[{'path':'/usr/local/bin/workspacex-cn-release-advance','exists':True,'symlink':False,'sha256':'a'*64}]}))
            row=self.plan.installation_plan(self.probe)['files'][0]
            self.assertTrue(row['oldStateVerified']);self.assertEqual(row['expectedOldSha256'],'a'*64)


if __name__=='__main__':unittest.main()
