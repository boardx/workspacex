import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
ROOT=Path(__file__).resolve().parents[1]
def module():
    spec=importlib.util.spec_from_file_location('source_prepare',ROOT/'scripts/schema-tag-prepare.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
class SourceBoundary(unittest.TestCase):
    def test_duplicate_runtime_environment_cannot_select_another_database(self):
        m=module()
        with self.assertRaisesRegex(ValueError,'RUNTIME_ENV_AMBIGUOUS'):
            m.env_map({'Config':{'Env':['PGDATABASE=workspacex','PGDATABASE=other']}})
    def test_service_id_and_labels_must_both_match(self):
        m=module();d=Mock();d.run.return_value=('a'*64+'\n').encode()
        d.json.return_value=[{'Id':'b'*64,'State':{'Running':True},'Config':{'Labels':{'com.docker.compose.project':'project','com.docker.compose.service':'api'}}}]
        with self.assertRaisesRegex(ValueError,'LIVE_SERVICE_BINDING'):m.live_service(d,'project','api')
    def test_runtime_database_binding_is_local_and_exact(self):
        m=module();api={'Config':{'Env':['PGHOST=postgres','PGPORT=5432','PGDATABASE=workspacex']},'NetworkSettings':{'Networks':{'app':{'NetworkID':'net1'}}}}
        pg={'Config':{'Env':[]},'NetworkSettings':{'Networks':{'app':{'NetworkID':'net1','Aliases':['postgres']}}}}
        m.source_binding(api,pg)
        with self.assertRaises(ValueError):m.source_binding({**api,'NetworkSettings':{'Networks':{'other':{'NetworkID':'net2'}}}},pg)
        for key,value in [('PGHOST','remote.example'),('PGPORT','55432'),('PGDATABASE','another')]:
            bad={'Config':{'Env':[x for x in api['Config']['Env'] if not x.startswith(key+'=')]+[key+'='+value]}}
            with self.assertRaises(ValueError):m.source_binding(bad,pg)
    def test_read_only_source_metadata_never_accepts_other_database_or_excess_size(self):
        import json
        m=module();d=Mock();good={'database':'workspacex','role':'postgres','bytes':10000,'ledger':{'old.sql':'a'*64},'roles':['app_rw']}
        d.run.return_value=json.dumps(good).encode();self.assertEqual(m.read_source(d,{'Id':'a'*64},'workspacex'),good)
        args=d.run.call_args.args[0]
        self.assertIn('BEGIN READ ONLY;',args[-1]);self.assertTrue(args[-1].strip().endswith('ROLLBACK;'))
        self.assertEqual(args[0:3],['exec','--user','postgres']);self.assertIn('--host=/var/run/postgresql',args);self.assertIn('--port=5432',args);self.assertIn('-i',args);self.assertIn('/usr/bin/env',args)
        for patch in [{'database':'wrong'},{'role':'app_rw'},{'bytes':128*1024*1024},{'bytes':True}]:
            d.run.return_value=json.dumps({**good,**patch}).encode()
            with self.assertRaises(ValueError):m.read_source(d,{'Id':'a'*64},'workspacex')
if __name__=='__main__':unittest.main()
