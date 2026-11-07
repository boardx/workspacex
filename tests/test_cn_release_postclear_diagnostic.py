import importlib.util,json,unittest
from pathlib import Path
p=Path(__file__).with_name('cn_release_postclear_recovery_linux.py')
s=importlib.util.spec_from_file_location('postclear_diagnostic',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class DiagnosticTests(unittest.TestCase):
    def value(self):return dict(kind='postclear-fixture-diagnostic-v1',stage='dump',reason='UNCLASSIFIED',sqlstate='42501',childExit=1,stderrBytes=10,stderrSha256='a'*64)
    def raw(self,v):return b'CN_POSTCLEAR_DIAGNOSTIC '+json.dumps(v).encode()
    def test_valid(self):
        v=self.value();self.assertEqual(m.safe_diagnostic(self.raw(v)),v)
    def test_secret_fields_rejected(self):
        for field in ('stage','reason','sqlstate'):
            v=self.value();v[field]='SECRET';self.assertIsNone(m.safe_diagnostic(self.raw(v)))
        v=self.value();v['message']='SECRET';self.assertIsNone(m.safe_diagnostic(self.raw(v)))
    def test_duplicate_and_oversize_rejected(self):
        raw=self.raw(self.value());self.assertIsNone(m.safe_diagnostic(raw+b'\n'+raw));self.assertIsNone(m.safe_diagnostic(b'x'*16385))
    def test_invalid_types_rejected(self):
        for field in ('stderrBytes','childExit'):
            v=self.value();v[field]=True;self.assertIsNone(m.safe_diagnostic(self.raw(v)))
    def test_fixed_original_candidate_reason_exported(self):
        v=self.value();v['reason']='ACTOR_CANDIDATE_PLAN_DRIFT'
        self.assertEqual(m.safe_diagnostic(self.raw(v)),v)
        v['reason']='ACTOR_SECRET_PASSWORD';self.assertIsNone(m.safe_diagnostic(self.raw(v)))
