import datetime as dt
import json
import importlib.util
from pathlib import Path
import unittest
import tempfile
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
    def test_explicit_mvp_hook_after_switch_before_held_acceptance(self):
        self.a['mvp']={'acceptanceScope':'mvp-non-model'}
        calls=[]
        def hook(release,previous,mode):
            calls.append((list(self.requests),previous,mode));return {'contentReadbackPassed':True}
        self.router.mvp_after_switch=hook
        self.router.mvp_complete=lambda release,mode:{'status':'MVP_TERMINAL_PROPOSAL_READY'}
        result,_=self.run_driver()
        self.assertEqual(result['status'],'CHAIN_COMPLETED')
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][0][-1],'switch')
        self.assertNotIn('acceptance',calls[0][0])
        self.assertEqual(calls[0][1],result['completed'][13]['receiptSha256'])
    def test_mvp_unavailable_hook_never_clears_hold(self):
        self.a['mvp']={'acceptanceScope':'mvp-non-model'}
        self.router.mvp_after_switch=lambda *args: {'status':'NOT_STARTED','stage':'mvp-held-content'}
        result,_=self.run_driver()
        self.assertEqual(result['stage'],'mvp-held-content')
        self.assertNotIn('clear-hold',self.requests)
        self.assertNotIn('observe',self.requests)
    def test_mvp_completion_after_all_seventeen_admitted_stages(self):
        self.a['mvp']={'acceptanceScope':'mvp-non-model'}
        self.router.mvp_after_switch=lambda *args:{'contentReadbackPassed':True}
        calls=[]
        def complete(release,mode):
            calls.append((list(self.requests),mode));return {'status':'MVP_TERMINAL_PROPOSAL_READY'}
        self.router.mvp_complete=complete
        result,_=self.run_driver()
        self.assertEqual(calls,[(list(m.e.STAGES),'run')])
        self.assertEqual(result['terminalProposal']['status'],'MVP_TERMINAL_PROPOSAL_READY')
        self.assertFalse(result['productionAcceptanceClaimedByDriver'])
    def test_missing_terminal_originals_cannot_report_chain_completed(self):
        self.a['mvp']={'acceptanceScope':'mvp-non-model'}
        self.router.mvp_after_switch=lambda *args:{'contentReadbackPassed':True}
        self.router.mvp_complete=lambda *args:{'status':'NOT_READY','installed':False}
        result,_=self.run_driver()
        self.assertEqual(result['status'],'EVIDENCE_NOT_READY')
        self.assertEqual(len(result['completed']),17)
        self.assertFalse(result['productionAcceptanceClaimedByDriver'])
    def test_blueprint_is_prepare_only_and_never_invokes_driver_router(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'scripts').mkdir();blueprints=root/'blueprints';blueprints.mkdir()
            names=('scripts/cn-release-fixed-driver.py','scripts/cn-release-mvp-approval-prepare.py')
            for name in names:(root/name).write_bytes(b'fixed installed fixture')
            selector={'requestedAt':(self.now-dt.timedelta(seconds=1)).isoformat(),'deadlineAt':(self.now+dt.timedelta(minutes=1)).isoformat()}
            pin=m.e.digest(json.dumps(selector,sort_keys=True,separators=(',',':')).encode())
            blueprint={'kind':'cn-mvp-approved-blueprint-v1','selector':selector,'codeFiles':{name:m.e.digest((root/name).read_bytes())for name in names}}
            path=blueprints/(pin+'.json');path.write_text(json.dumps(blueprint))
            calls=[]
            class Preparer:
                def prepare(self,received):calls.append(received);return {'approvalSha256':'a'*64,'installed':False}
            with patch.object(m,'ROOT',root),patch.object(m,'BLUEPRINTS',blueprints),patch.object(m.e,'read',side_effect=lambda p,*args:Path(p).read_bytes()),patch.object(m,'module',return_value=Preparer()) as importer:
                result=m.prepare_only(pin,'status',clock=lambda:self.now)
                self.assertEqual(result['status'],'PREPARATION_READ_ONLY_NO_EXECUTION');self.assertEqual(calls,[]);importer.assert_not_called()
                result=m.prepare_only(pin,'run',clock=lambda:self.now)
                self.assertEqual(calls,[pin]);self.assertEqual(result['status'],'PREPARE_ONLY');self.assertFalse(result['productionStarted'])
                (root/names[1]).write_bytes(b'tampered code')
                with self.assertRaisesRegex(m.e.Rejected,'PREPARER_CODE_PIN'):m.prepare_only(pin,'run',clock=lambda:self.now)
                self.assertEqual(calls,[pin])


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
original_open=os.open;original_fstat=os.fstat;original_exists=Path.exists
with tempfile.TemporaryDirectory()as tmp:
 def spec(name,path,*args,**kwargs):
  if name in ('fixed_driver_entry','fixed_stage_router'):
   return importlib.util.spec_from_loader(name,Loader(e if name=='fixed_driver_entry'else types.SimpleNamespace(Router=Router)))
  return original_spec(name,path,*args,**kwargs)
 def opened(path,*args,**kwargs):
  if str(path)=='/var/lib/workspacex-cn/release-driver/driver.lock':path=Path(tmp)/'lock'
  return original_open(path,*args,**kwargs)
 def exists(path):
  if str(path).startswith('/etc/workspacex-cn/release-approvals/'):return True
  if str(path).startswith('/etc/workspacex-cn/mvp-approval-blueprints/'):return False
  return original_exists(path)
 def rootstat(fd):
  s=original_fstat(fd);v={k:getattr(s,k)for k in dir(s)if k.startswith('st_')};v['st_uid']=0;return types.SimpleNamespace(**v)
 sys.argv=[str(source),mode,release]
 with patch.object(importlib.util,'spec_from_file_location',spec),patch.object(os,'geteuid',lambda:0),patch.object(os,'open',opened),patch.object(os,'fstat',rootstat),patch.object(Path,'exists',exists):
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
