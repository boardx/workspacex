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


# Run the actual CLI/__main__ and coordinate loop in a fresh interpreter. Only
# root/provider boundaries are fixtures; production files and cloud are untouched.
CLI_FIXTURE = r'''
import datetime as dt,hashlib,importlib.util,json,os,re,runpy,stat,sys,tempfile,types
from pathlib import Path
from unittest.mock import patch
source=Path(sys.argv[1]);mode,scenario=sys.argv[2:4];now=dt.datetime.now(dt.timezone.utc)
encode=lambda v:(json.dumps(v,sort_keys=True)+'\n').encode()
digest=lambda v:hashlib.sha256(v).hexdigest()
identity=dict(sourceRevision='a'*40,baselineRevision='b'*40,controlRevision='c'*40,publicationAttemptId='publication',attemptId='release',requestedAt=(now-dt.timedelta(seconds=1)).isoformat(),deadlineAt=(now+dt.timedelta(minutes=20)).isoformat())
root=source.parents[1]
paths=['scripts/cn-release-fixed-driver.py','scripts/cn-release-stage-router.py','.harness/scripts/vm/cn-release-advance.py']
a=dict(kind='cn-fixed-release-approval-v1',identity=identity,target=dict(accountId='1177216024653153',region='cn-shanghai',ecsInstanceId='i-uf6ga92ewloganobbln6'),issuedAt=identity['requestedAt'],expiresAt=identity['deadlineAt'],codeFiles={p:digest((root/p).read_bytes())for p in paths})
raw=encode(a);release=digest(raw);packages={};requests={};receipts={}
class Rejected(Exception):pass
def need(v,code):
 if not v:raise Rejected(code)
def entry(mode,request,attempt):
 if scenario=='UNKNOWN':return {'status':'UNCERTAIN'}
 if mode=='advance':receipts[request]=digest((request+'receipt').encode())
 return {'status':'COMPLETED','receiptSha256':receipts[request]}if request in receipts else {'status':'NOT_STARTED'}
stages=('consume','publication-stage','check-plan','publish','hold-stage','hold','stop-stage','stop','sessions','backup-stage','backup','rds-backup','switch-stage','switch','acceptance','clear-hold','observe')
e=types.SimpleNamespace(HEX=re.compile('[a-f0-9]{64}'),SHA=re.compile('[a-f0-9]{40}'),ATTEMPT=re.compile('[a-z0-9-]+'),STAGES=stages,Rejected=Rejected,need=need,digest=digest,decode=json.loads,encode=encode,instant=dt.datetime.fromisoformat,now=lambda:now,directory=lambda _:None,entry=entry)
e.read=lambda p:raw if str(p).startswith('/etc/workspacex-cn/release-approvals/')else p.read_bytes()
e.load_package=lambda request,attempt:packages[request]
class Router:
 def __init__(self,*args):
  if scenario=='UNKNOWN':self.generate(release,'consume',None)
 def preflight(self,*args):pass
 def lookup(self,release,stage):return requests.get(stage)
 def admission(self,release,stage):return 'WAITING_FOR_WRITER_APPROVAL'if scenario=='WAITING'and stage=='clear-hold'else None
 def generate(self,release,stage,previous):
  request=digest(stage.encode());requests[stage]=request
  manifest={k:identity[k]for k in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt')}
  manifest.update(scope='runtime-only-reviewed-continuation',stage=stage,previousReceiptSha256=previous)
  packages[request]=(manifest,{'authorization.json':raw});return request
class Loader:
 def __init__(self,obj):self.obj=obj
 def create_module(self,spec):return None
 def exec_module(self,module):module.__dict__.update(vars(self.obj))
original_spec=importlib.util.spec_from_file_location
original_open=os.open;original_fstat=os.fstat
with tempfile.TemporaryDirectory()as tmp:
 def spec(name,path,*args,**kwargs):
  if name in ('fixed_driver_entry','fixed_stage_router'):
   return importlib.util.spec_from_loader(name,Loader(e if name=='fixed_driver_entry'else types.SimpleNamespace(Router=Router)))
  return original_spec(name,path,*args,**kwargs)
 def opened(path,*args,**kwargs):
  if str(path)=='/var/lib/workspacex-cn/release-driver/driver.lock':path=Path(tmp)/'lock'
  return original_open(path,*args,**kwargs)
 def rootstat(fd):
  s=original_fstat(fd);v={k:getattr(s,k)for k in dir(s)if k.startswith('st_')};v['st_uid']=0;return types.SimpleNamespace(**v)
 sys.argv=[str(source),mode,release]
 with patch.object(importlib.util,'spec_from_file_location',spec),patch.object(os,'geteuid',lambda:0),patch.object(os,'open',opened),patch.object(os,'fstat',rootstat):
  runpy.run_path(str(source),run_name='__main__')
'''

class DriverCliTests(unittest.TestCase):
    def cli(self,mode,scenario):
        import json,subprocess,sys
        result=subprocess.run([sys.executable,'-I','-B','-c',CLI_FIXTURE,str(ROOT/'scripts/cn-release-fixed-driver.py'),mode,scenario],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.stderr,'',result.stderr)
        return result.returncode,json.loads(result.stdout)
    def test_run_waiting_preserves_stage_and_fails_cli(self):
        code,value=self.cli('run','WAITING')
        self.assertEqual(value['status'],'WAITING_FOR_WRITER_APPROVAL');self.assertEqual(value['stage'],'clear-hold');self.assertEqual(len(value['completed']),15)
        self.assertNotEqual(code,0)
    def test_run_unknown_preserves_stage_and_fails_cli(self):
        code,value=self.cli('run','UNKNOWN')
        self.assertEqual(value['status'],'UNKNOWN_RECONCILE_REQUIRED');self.assertEqual(value['stage'],'consume');self.assertFalse(value['mutationRetried'])
        self.assertNotEqual(code,0)
    def test_reconcile_not_started_fails_cli(self):
        code,value=self.cli('reconcile','NOT_STARTED')
        self.assertEqual(value['status'],'NOT_STARTED');self.assertEqual(value['stage'],'consume');self.assertNotEqual(code,0)
    def test_status_is_readonly_success_even_incomplete(self):
        for scenario,expected in [('NOT_STARTED','NOT_STARTED'),('UNKNOWN','UNKNOWN_RECONCILE_REQUIRED')]:
            with self.subTest(scenario=scenario):
                code,value=self.cli('status',scenario);self.assertEqual(code,0);self.assertEqual(value['status'],expected);self.assertEqual(value['completed'],[])
    def test_run_completed_is_not_business_acceptance_claim(self):
        code,value=self.cli('run','COMPLETE');self.assertEqual(code,0);self.assertEqual(value['status'],'CHAIN_COMPLETED');self.assertFalse(value['productionAcceptanceClaimedByDriver'])

if __name__=='__main__':unittest.main()
