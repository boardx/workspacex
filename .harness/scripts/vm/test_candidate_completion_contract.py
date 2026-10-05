import copy,datetime,json,hashlib,unittest
from candidate_completion_contract import verify_completion,validate_completed,ledger_sha
from test_candidate_plan_producer import data_fixture
from writer_fence import digest

class CompletionTests(unittest.TestCase):
    def fixture(self):
        inputs,docs,*_=data_fixture();return inputs,docs['completion'],docs['liveLedger']['ledger']
    def test_native_flat_witness_and_native_name_checksum_hash(self):
        b,r,rows=self.fixture();sha=verify_completion(r,b,rows)
        self.assertEqual(sha,validate_completed(r,b['identity'],rows))
        self.assertEqual(sha,hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest())
        self.assertNotEqual(sha,digest(rows))
    def test_each_receipt_scope_identity_count_hash_and_freshness_error_rejects(self):
        for k,v in (('scope','validated-migration-completion'),('pendingCount',1),('driftCount',1),('unknownAppliedCount',1),
            ('appliedSqlCount',True),('sourceRevision','0'*40),('originalPlanSha256','0'*64),('ledgerSha256','0'*64),
            ('productionMutationAuthorized',True),('capturedAt','2000-01-01T00:00:00Z'),('providerFinishedAt','2999-01-01T00:00:00Z'),
            ('expiresAt','2000-01-01T00:00:00Z')):
            b,r,rows=self.fixture();r[k]=v
            with self.assertRaises(RuntimeError,msg=k):verify_completion(r,b,rows)
        b,r,rows=self.fixture();r['kind']='validated-migration-completion'
        with self.assertRaisesRegex(RuntimeError,'NATIVE_SCHEMA'):verify_completion(r,b,rows)
    def test_live_ledger_duplicate_and_checksum_drift_fail(self):
        b,r,rows=self.fixture()
        with self.assertRaises(RuntimeError):verify_completion(r,b,rows+rows)
        rows[0]['checksum']='0'*64
        with self.assertRaisesRegex(RuntimeError,'LIVE_LEDGER'):verify_completion(r,b,rows)
