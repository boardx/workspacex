import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
def module():
    spec=importlib.util.spec_from_file_location('schema_handoff',ROOT/'scripts/schema-release-handoff.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
class Handoff(unittest.TestCase):
    def test_no_unconfigured_or_maintenance_writer(self):
        m=module()
        for plan,policy,code in [({'route':'schema-preparation','complete':True},None,'SCHEMA_RELEASE_ADAPTER_REQUIRED'),({'route':'maintenance-review','complete':True},{},'MAINTENANCE_REVIEW_REQUIRED'),({'route':'schema-preparation','complete':False},{},'COMPLETE_SCHEMA_PLAN_REQUIRED')]:
            with self.assertRaisesRegex(ValueError,code):m.validate_policy(plan,policy,lambda *a:None)
    def test_exact_receipt_and_all_proofs_required(self):
        m=module();request={'environment':'cn','tag':'1-1','sourceRevision':'e'*40,'planSha256':'a'*64,'manifestSha256':'b'*64}
        receipt={'kind':'schema-release-result-v1','status':'SUCCEEDED',**request,'proofs':{name:{'path':'/private/'+name+'.json','sha256':'c'*64} for name in m.PROOFS}}
        m.verify_receipt(request,receipt)
        for key in request:
            with self.subTest(key=key),self.assertRaises(ValueError):m.verify_receipt(request,{**receipt,key:'wrong'})
        for name in m.PROOFS:
            bad=json.loads(json.dumps(receipt));bad['proofs'][name]='SKIPPED'
            with self.assertRaises(ValueError):m.verify_receipt(request,bad)
        bad=json.loads(json.dumps(receipt));bad['proofs']['backup-restore']['path']='/private/attempt/../foreign.json'
        with self.assertRaises(ValueError):m.verify_receipt(request,bad)
        for status in ['PREPARED','COMMIT_UNKNOWN','ROLLED_BACK','WAITING_FOR_APPROVAL']:
            with self.assertRaises(ValueError):m.verify_receipt(request,{**receipt,'status':status})
    def test_child_failure_and_timeout_never_clear_durable_pending(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);request=root/'request.json';request.write_text('{}')
            for error in [subprocess.TimeoutExpired('adapter',1),OSError('missing')]:
                with patch.object(m.subprocess,'run',side_effect=error),self.assertRaisesRegex(ValueError,'SCHEMA_RELEASE_RECONCILIATION_REQUIRED'):
                    m.invoke(['/fixed/adapter'],request,root/'receipt.json',30)
            with patch.object(m.subprocess,'run',return_value=type('Reply',(),{'returncode':1})()),self.assertRaisesRegex(ValueError,'SCHEMA_RELEASE_RECONCILIATION_REQUIRED'):
                m.invoke(['/fixed/adapter'],request,root/'receipt.json',30)
    def test_receipt_rejects_duplicate_keys_and_unbounded_output(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'receipt.json'
            for raw in ['{"status":"SUCCEEDED","status":"FAILED"}', ' '*65537]:
                path.write_text(raw)
                with self.assertRaises(ValueError):m.read_receipt(path)

    def test_success_requires_actual_private_receipt_file_not_stdout(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);request=root/'request.json';request.write_text('{}')
            with patch.object(m.subprocess,'run',return_value=type('Reply',(),{'returncode':0})()),self.assertRaisesRegex(ValueError,'SCHEMA_RELEASE_RECONCILIATION_REQUIRED'):
                m.invoke(['/fixed/adapter'],request,root/'receipt.json',30)
if __name__=='__main__':unittest.main()
