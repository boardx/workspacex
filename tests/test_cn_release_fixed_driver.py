import datetime as dt
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('driver',ROOT/'scripts/cn-release-fixed-driver.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class DriverTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime.now(dt.timezone.utc)
        self.a={'identity':dict(sourceRevision='a'*40,baselineRevision='b'*40,controlRevision='c'*40,publicationAttemptId='publication',attemptId='release',requestedAt=(self.now-dt.timedelta(seconds=1)).isoformat(),deadlineAt=(self.now+dt.timedelta(minutes=29)).isoformat()),'expiresAt':(self.now+dt.timedelta(minutes=29)).isoformat()}
        self.requests={};self.receipts={};self.calls=[];self.generated=[]
        outer=self
        class Router:
            def preflight(self,release):return None
            def admission(self,release,stage):return None
            def lookup(self,release,stage):return outer.requests.get(stage)
            def generate(self,release,stage,previous):
                outer.generated.append((stage,previous));request=m.e.digest(stage.encode());outer.requests[stage]=request;return request
        self.router=Router()
    def execute(self,mode,request,attempt):
        self.calls.append((mode,request))
        if mode=='advance':self.receipts[request]=m.e.digest((request+'receipt').encode())
        return {'status':'COMPLETED','receiptSha256':self.receipts[request]} if request in self.receipts else {'status':'NOT_STARTED'}
    def run_driver(self,**kw):
        with patch.object(m,'package_identity') as check:
            result=m.coordinate('d'*64,self.a,self.router,executor=kw.pop('executor',self.execute),clock=lambda:self.now,**kw)
        return result,check
    def test_full_order_original_clock_and_prior_hash(self):
        result,check=self.run_driver()
        self.assertEqual(result['status'],'CHAIN_COMPLETED');self.assertFalse(result['productionAcceptanceClaimedByDriver'])
        self.assertEqual([x[0]for x in self.generated],list(m.e.STAGES))
        self.assertIsNone(self.generated[0][1])
        for i,(_,prior)in enumerate(self.generated[1:],1):self.assertEqual(prior,result['completed'][i-1]['receiptSha256'])
        self.assertEqual(result['requestedAt'],self.a['identity']['requestedAt']);self.assertEqual(check.call_count,17)
    def test_repeated_run_does_not_repeat_mutation(self):
        self.run_driver();count=len([x for x in self.calls if x[0]=='advance']);self.run_driver()
        self.assertEqual(count,17);self.assertEqual(len([x for x in self.calls if x[0]=='advance']),17)
    def test_unknown_never_advances_or_automatically_recovers(self):
        self.requests['consume']='a'*64
        result,_=self.run_driver(executor=lambda *args:{'status':'UNCERTAIN'})
        self.assertEqual(result['status'],'UNKNOWN_RECONCILE_REQUIRED');self.assertEqual(self.generated,[])
    def test_readonly_status_does_not_generate(self):
        result,_=self.run_driver(mode='status');self.assertEqual(result['status'],'NOT_STARTED');self.assertEqual(self.generated,[])
    def test_explicit_reconcile_does_not_start_next_stage(self):
        self.requests['consume']='a'*64
        done=False
        def executor(mode,*args):
            nonlocal done
            self.calls.append((mode,''))
            if mode=='reconcile':done=True
            return {'status':'COMPLETED','receiptSha256':'b'*64}if done else {'status':'UNCERTAIN'}
        result,_=self.run_driver(mode='reconcile',executor=executor)
        self.assertEqual(result['stage'],'publication-stage');self.assertEqual(self.generated,[])
        self.assertNotIn('advance',[x[0]for x in self.calls])
    def test_deadline_cannot_generate_next_package(self):
        self.a['expiresAt']=(self.now-dt.timedelta(seconds=1)).isoformat()
        with self.assertRaisesRegex(m.e.Rejected,'RELEASE_DEADLINE'):self.run_driver()
        self.assertEqual(self.generated,[])
    def test_execution_exception_prevents_later_generation(self):
        def execute(*args):raise RuntimeError('lost response')
        with self.assertRaisesRegex(RuntimeError,'lost response'):self.run_driver(executor=execute)
        self.assertEqual(len(self.generated),1)
    def test_changed_post_execution_receipt_blocks_next(self):
        n=0
        def execute(*args):
            nonlocal n
            n+=1
            return {'status':'NOT_STARTED'}if n==1 else {'status':'COMPLETED','receiptSha256':str(n)*64}
        with self.assertRaisesRegex(m.e.Rejected,'RECEIPT_CHANGED'):self.run_driver(executor=execute)
        self.assertEqual(len(self.generated),1)

if __name__=='__main__':unittest.main()
