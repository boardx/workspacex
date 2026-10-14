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


if __name__=='__main__':unittest.main()
