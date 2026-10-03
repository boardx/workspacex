import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseProtectedRuntimePlan,createPersistentWriterLifecycle,runtimeDigest,type PersistentWriterSpec,type PersistentFenceDriver} from './sealed_runtime';
const dbs=['workspacex','workspacex_agent','workspacex_memory'];
function fixture(){
 const identity={sourceRevision:'a'.repeat(40),baselineRevision:'b'.repeat(40),migrationPlanSha256:'c'.repeat(64),attemptId:'fixture'};const toolRevision='d'.repeat(40);
 const peers=Object.fromEntries(dbs.map(db=>[db,{database:db,serverAddr:'10.0.0.1',serverPort:5432,systemIdentifier:'123'}]));
 const sourcePlan:any={schemaVersion:1,identity,toolRevision,mode:'maintenance-all-writer-fence',productionActionsAuthorized:true,runtimeSessionBootstrapAuthorized:true,databasePeers:peers,databaseWriterRoles:Object.fromEntries(dbs.map(db=>[db,['control']])),diagnosticRole:'diagnostic',controlRuntime:{nodePath:'/usr/local/bin/node',nodeSha256:'e'.repeat(64)},runtimeSealPath:'/var/lib/workspacex-cn/runtime/fixture/sealed-writer-runtime.json'};
 const sessions=(role:string,start:number)=>Object.fromEntries(dbs.map((db,i)=>[db,{peer:peers[db],tls:{ssl:true},role,pid:start+i,backendStart:'2026-10-03T00:00:00+00:00',clientAddr:'10.0.0.2'}]));
 const processIdentity={kind:'process',uid:0,pid:123,startTicks:10,exe:'/usr/bin/python3',exeSha256:'f'.repeat(64)};
 const runtimePlan:any={...sourcePlan,runtimeSourcePlanSha256:runtimeDigest(sourcePlan),controlSessions:sessions('control',200),diagnosticSessions:sessions('diagnostic',300),diagnosticClientAddress:'10.0.0.2',runtimeHelperProcesses:Array.from({length:6},(_,i)=>({uid:0,pid:400+i,startTicks:10,parentPid:123,exe:sourcePlan.controlRuntime.nodePath,exeSha256:sourcePlan.controlRuntime.nodeSha256}))};
 const sealed:any={schemaVersion:1,kind:'sealed-maintenance-writer-runtime',identity,toolRevision,sourcePlanPath:'/etc/workspacex-cn/writer-plan.json',sourcePlanSha256:'1'.repeat(64),sourcePlanCanonicalSha256:runtimeDigest(sourcePlan),runtimePlanSha256:runtimeDigest(runtimePlan),runtimePlan,sessionsSha256:runtimeDigest({control:runtimePlan.controlSessions,diagnostic:runtimePlan.diagnosticSessions}),processIdentity,ready:false,productionAvailabilityProven:false};
 let starts=0,closes=0,retains=0;const messages:any[]=[];
 const driver:PersistentFenceDriver={started:async()=>({kind:'persistent-writer-runtime-started',identity,toolRevision,processIdentity,sealedPlanPath:sourcePlan.runtimeSealPath,sealedPlanSha256:'2'.repeat(64),runtimePlanSha256:sealed.runtimePlanSha256}),request:async msg=>{messages.push(msg);if(msg.operation==='close-accepted')return {closed:true};return {value:{identity,callback:msg.callback,state:msg.callback==='verifyWritesResumed'?'writes-resumed':'writes-held',ready:false,productionAvailabilityProven:false}};},close:async()=>{closes++;},retain:()=>{retains++;}};
 const spec:PersistentWriterSpec={identity,toolRevision,sourcePlanPath:sealed.sourcePlanPath,sourcePlanSha256:sealed.sourcePlanSha256,sourcePlan,host:{identity,writerPlanPath:sealed.sourcePlanPath,writerPlanSha256:sealed.sourcePlanSha256,writerPlanCanonicalSha256:sealed.sourcePlanCanonicalSha256,hold:{path:'/trusted/hold',sha256:'3'.repeat(64)},writerFence:{path:'/trusted/fence',sha256:'4'.repeat(64)}},modules:{writer_fence:{path:'/trusted/writer',sha256:'5'.repeat(64)},fixed_probes:{path:'/trusted/probes',sha256:'6'.repeat(64)},control_connection:{path:'/trusted/control',sha256:'7'.repeat(64)}},driverFactory:()=>{starts++;return driver;},readSeal:()=>parseProtectedRuntimePlan(sealed,spec)};
 return {spec,sealed,driver,messages,counts:()=>({starts,closes,retains})};
}
test('sealed actual session proof permits only approved runtime deltas',()=>{const f=fixture();assert.equal(parseProtectedRuntimePlan(f.sealed,f.spec).ready,false);f.sealed.runtimePlan.productionActionsAuthorized=false;f.sealed.runtimePlanSha256=runtimeDigest(f.sealed.runtimePlan);assert.throws(()=>parseProtectedRuntimePlan(f.sealed,f.spec),/UNAPPROVED_CHANGE/);});
test('foreign TLS/role/peer/helper process cannot be sealed as approved',()=>{for(const change of [(v:any)=>{v.runtimePlan.controlSessions.workspacex.tls.ssl=false;},(v:any)=>{v.runtimePlan.diagnosticSessions.workspacex.role='writer';},(v:any)=>{v.runtimePlan.runtimeHelperProcesses[0].parentPid=999;}]){const f=fixture();change(f.sealed);f.sealed.runtimePlanSha256=runtimeDigest(f.sealed.runtimePlan);f.sealed.sessionsSha256=runtimeDigest({control:f.sealed.runtimePlan.controlSessions,diagnostic:f.sealed.runtimePlan.diagnosticSessions});assert.throws(()=>parseProtectedRuntimePlan(f.sealed,f.spec),/SEALED_RUNTIME/);}});
test('all writer callbacks share one server and close only after accepted resume',async()=>{const f=fixture();const runtime=createPersistentWriterLifecycle(f.spec);const binding=await runtime.start();assert.equal(binding.writerPlanCanonicalSha256,f.sealed.runtimePlanSha256);await runtime.invoke('blockAllWrites',f.spec.identity);await assert.rejects(runtime.closeAfterAccepted(),/NOT_ACCEPTED/);await runtime.invoke('verifyWritesResumed',f.spec.identity);await runtime.closeAfterAccepted();assert.deepEqual(f.counts(),{starts:1,closes:1,retains:0});assert.equal(f.messages.at(-1).operation,'close-accepted');});
test('unknown response retains server, closes nothing and rejects resume',async()=>{const f=fixture();const runtime=createPersistentWriterLifecycle(f.spec);await runtime.start();f.driver.request=async()=>{throw new Error('fixture lost response');};await assert.rejects(runtime.invoke('blockAllWrites',f.spec.identity));await assert.rejects(runtime.closeAfterAccepted(),/NOT_ACCEPTED/);await assert.rejects(runtime.invoke('resumeWrites',f.spec.identity),/BINDING/);assert.deepEqual(f.counts(),{starts:1,closes:0,retains:1});});
test('stale seal/start identity is rejected before callback',async()=>{const f=fixture();f.driver.started=async()=>({kind:'persistent-writer-runtime-started',identity:{...f.spec.identity,attemptId:'foreign'},toolRevision:f.spec.toolRevision});await assert.rejects(createPersistentWriterLifecycle(f.spec).start(),/START_PROTOCOL/);assert.equal(f.messages.length,0);assert.equal(f.counts().retains,1);});
import {spawnSync} from 'node:child_process';
test('Python sealing persists observed sessions without overwriting prior seal (pure IO fixture)',()=>{
 const script=String.raw`
import sys,json,types,io,stat,hashlib
sys.path.insert(0,'.harness/scripts/vm')
import host_transport as h
from writer_fence import digest
source={'identity':{'attemptId':'fixture'},'toolRevision':'a'*40,'runtimeSealPath':'/var/lib/workspacex-cn/runtime/fixture/sealed-writer-runtime.json'}
class Transport:
 manifest_sha='b'*64
 def __init__(self):self.plan=source
 def openBoth(self):return {'controlSessions':{'db':{'pid':10}},'diagnosticSessions':{'db':{'pid':11}}}
 def bindRuntimeSessions(self,p):self.plan=dict(source,controlSessions=p['controlSessions'],diagnosticSessions=p['diagnosticSessions']);return self.plan
class P:
 def __init__(self,value):self.value=str(value)
 def __str__(self):return self.value
 @property
 def parent(self):return P('/private-fixture')
 @property
 def parents(self):return [self.parent]
 @property
 def name(self):return 'sealed-writer-runtime.json'
 def lstat(self):return types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=0)
 def stat(self):return self.lstat()
class Sink(io.BytesIO):
 def fileno(self):return 10
 def __exit__(self,*args):self.saved=self.getvalue();return False
sink=Sink();events=[]
h.pathlib=types.SimpleNamespace(Path=P)
h.proc_binding=lambda pid:{'kind':'process','uid':0,'pid':pid}
fake=types.SimpleNamespace(O_RDONLY=1,O_DIRECTORY=2,O_NOFOLLOW=4,O_WRONLY=8,O_CREAT=16,O_EXCL=32,getpid=lambda:123,urandom=lambda n:b'a'*n,open=lambda *a,**k:10,fdopen=lambda *a,**k:sink,fsync=lambda *a:None,close=lambda *a:None,unlink=lambda *a,**k:events.append('unlink'),link=lambda *a,**k:events.append('exclusive-link'))
h.os=fake
value,receipt=h.seal_runtime_plan(Transport(),'/etc/workspacex-cn/source.json','b'*64,read_private=lambda path:json.dumps(source).encode())
assert value['runtimePlan']['controlSessions']['db']['pid']==10
assert receipt['sealedPlanSha256']==hashlib.sha256(sink.saved).hexdigest()
assert 'exclusive-link' in events
h.os.link=lambda *a,**k:(_ for _ in ()).throw(FileExistsError('existing-seal'))
sink=Sink()
try:h.seal_runtime_plan(Transport(),'/etc/workspacex-cn/source.json','b'*64,read_private=lambda path:json.dumps(source).encode())
except FileExistsError:pass
else:raise AssertionError('existing seal overwritten')
print('pure-seal-fixture-pass')
`;
 const result=spawnSync('/usr/bin/python3',['-c',script],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/pure-seal-fixture-pass/);
});
test('first callback binds observed hold generation only under explicit static policy',()=>{
 const f=fixture();f.spec.sourcePlan.holdGenerationPolicy='bind-held-at-runtime';f.sealed.runtimePlan.holdGenerationPolicy='bind-held-at-runtime';f.sealed.runtimePlan.holdGeneration='9'.repeat(32);f.sealed.sourcePlanCanonicalSha256=runtimeDigest(f.spec.sourcePlan);f.sealed.runtimePlan.runtimeSourcePlanSha256=f.sealed.sourcePlanCanonicalSha256;f.sealed.runtimePlanSha256=runtimeDigest(f.sealed.runtimePlan);assert.equal(parseProtectedRuntimePlan(f.sealed,f.spec).runtimePlan.holdGeneration,'9'.repeat(32));
 delete f.spec.sourcePlan.holdGenerationPolicy;delete f.sealed.runtimePlan.holdGenerationPolicy;f.sealed.sourcePlanCanonicalSha256=runtimeDigest(f.spec.sourcePlan);f.sealed.runtimePlan.runtimeSourcePlanSha256=f.sealed.sourcePlanCanonicalSha256;f.sealed.runtimePlanSha256=runtimeDigest(f.sealed.runtimePlan);assert.throws(()=>parseProtectedRuntimePlan(f.sealed,f.spec),/UNAPPROVED_CHANGE/);
});
test('Python runtime bootstrap re-reads actual held identity before any fence callback (pure transport)',()=>{
 const script=String.raw`
import sys,types,os
sys.path.insert(0,'.harness/scripts/vm')
import host_transport as h
from writer_fence import digest
identity={'attemptId':'fixture'}
source={'identity':identity,'holdGenerationPolicy':'bind-held-at-runtime','controlRuntime':{'nodeSha256':'a'*64}}
t=object.__new__(h.HostTransport);t.plan=source
class C:
 def __init__(self,pid):self.process=types.SimpleNamespace(pid=pid);self.binding={'pid':pid,'clientAddr':'local'}
t.control_connections={'db':C(101)};t.diagnostic_connections={'db':C(102)}
proof={'sourcePlanSha256':digest(source),'identity':identity,'controlSessions':{'db':t.control_connections['db'].binding},'diagnosticSessions':{'db':t.diagnostic_connections['db'].binding}}
events=[]
t.read_hold=lambda:(events.append('actual-held-read') or {'state':'held','identity':identity,'generation':'b'*32})
h.proc_binding=lambda pid:{'uid':0,'pid':pid,'exeSha256':'a'*64,'state':'R'}
bound=t.bindRuntimeSessions(proof)
assert events==['actual-held-read'] and bound['holdGeneration']=='b'*32
assert 'holdGeneration' not in source
# A foreign hold cannot reach a callback or become a sealed accepted runtime.
t.plan=source;t.read_hold=lambda:{'state':'held','identity':{'attemptId':'foreign'},'generation':'b'*32}
try:t.bindRuntimeSessions(proof)
except RuntimeError as e:assert str(e)=='RUNTIME_HELD_IDENTITY'
else:raise AssertionError('foreign hold accepted')
print('pure-runtime-hold-pass')
`;
 const result=spawnSync('/usr/bin/python3',['-c',script],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/pure-runtime-hold-pass/);
});
test('migration and fresh ledger use the same sealed lifecycle without new driver',async()=>{
 const f=fixture();f.spec.sourcePlan.migrationAuthorization={fixture:'approved'};f.sealed.runtimePlan.migrationAuthorization=f.spec.sourcePlan.migrationAuthorization;f.sealed.sourcePlanCanonicalSha256=runtimeDigest(f.spec.sourcePlan);f.sealed.runtimePlan.runtimeSourcePlanSha256=f.sealed.sourcePlanCanonicalSha256;f.sealed.runtimePlanSha256=runtimeDigest(f.sealed.runtimePlan);
 f.driver.request=async message=>message.operation==='migrate-exact-plan'?{value:{applied:['0001.sql'],skipped:[]}}:{value:{ledger:[{name:'0001.sql',checksum:'a'.repeat(64),appliedAt:'2026-10-03T00:00:00Z'}],rowCount:1,connection:f.sealed.runtimePlan.diagnosticSessions.workspacex,observedAt:Date.now()/1000}};
 const life=createPersistentWriterLifecycle(f.spec);await life.start();assert.deepEqual(await life.migrateExactPlan(f.spec.identity),{applied:['0001.sql'],skipped:[]});assert.equal((await life.readDiagnosticLedger(f.spec.identity)).rowCount,1);assert.equal(f.counts().starts,1);
 f.driver.request=async()=>({value:{ledger:[],rowCount:0,connection:{pid:999},observedAt:Date.now()/1000}});await assert.rejects(life.readDiagnosticLedger(f.spec.identity),/DIAGNOSTIC_LEDGER/);assert.equal(f.counts().retains,1);
});
test('completion journal RPC requires migration and binds fixed output path/receipt',async()=>{
 const f=fixture();f.spec.sourcePlan.migrationAuthorization={fixture:'approved'};f.sealed.runtimePlan.migrationAuthorization=f.spec.sourcePlan.migrationAuthorization;f.sealed.sourcePlanCanonicalSha256=runtimeDigest(f.spec.sourcePlan);f.sealed.runtimePlan.runtimeSourcePlanSha256=f.sealed.sourcePlanCanonicalSha256;f.sealed.runtimePlanSha256=runtimeDigest(f.sealed.runtimePlan);
 const recorded:any[]=[];f.driver.request=async m=>{recorded.push(m);return m.operation==='migrate-exact-plan'?{value:{applied:[],skipped:[]}}:{value:{identity:m.identity,stage:m.stage,receipt:m.receipt,ready:false}};};
 const life=createPersistentWriterLifecycle(f.spec);await life.start();const receipt={path:`/etc/workspacex-cn/migration-completion-inputs/${f.spec.identity.sourceRevision}/${f.spec.identity.attemptId}.completed.json`,sha256:'9'.repeat(64)};
 await assert.rejects(life.recordMigrationCompletion(f.spec.identity,'intent',receipt),/BINDING/);assert.equal(recorded.length,0);await life.migrateExactPlan(f.spec.identity);await life.recordMigrationCompletion(f.spec.identity,'intent',receipt);await life.recordMigrationCompletion(f.spec.identity,'durable',receipt);assert.deepEqual(recorded.map(m=>m.operation),['migrate-exact-plan','record-migration-completion','record-migration-completion']);await assert.rejects(life.recordMigrationCompletion(f.spec.identity,'intent',{...receipt,path:'/etc/foreign'}),/BINDING/);
});
test('server completion intent/durable append one existing journal without acceptance forgery (pure host fixture)',()=>{
 const script=String.raw`
import sys,types,json,io,tempfile,pathlib,os,hashlib
sys.path.insert(0,'.harness/scripts/vm')
import host_transport as h,writer_fence as w
identity={'sourceRevision':'9'*40,'baselineRevision':'b'*40,'migrationPlanSha256':'a'*64,'attemptId':'fixture'}
completed='/etc/workspacex-cn/migration-completion-inputs/'+identity['sourceRevision']+'/fixture.completed.json'
receipt={'path':completed,'sha256':hashlib.sha256(b'fixture-completion').hexdigest()}
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp);root.chmod(0o700)
 source={'schemaVersion':1,'mode':'maintenance-all-writer-fence','productionActionsAuthorized':True,'identity':identity,'toolRevision':'c'*40,'journalDirectory':temp,'holdGeneration':'d'*32}
 raw=json.dumps(source).encode();source_sha=hashlib.sha256(raw).hexdigest()
 h.private=lambda path:raw if path=='/fixture/source.json' else b'fixture-completion'
 original=w.Journal;w.Journal=lambda directory,identity:original(directory,identity,os.getuid(),root)
 class Transport:
  def __init__(self,plan,*args):self.plan=plan;self.control_connections={'workspacex':types.SimpleNamespace(migrate_exact_plan=lambda identity:{'applied':[],'skipped':[]})}
  def require_lock(self):pass
  def verify_capabilities(self,plan):pass
  def close_control_connections(self):pass
 h.HostTransport=Transport
 h.seal_runtime_plan=lambda *args:({'processIdentity':{'pid':123}},{'sealedPlanPath':'/fixture/seal','sealedPlanSha256':'e'*64,'runtimePlanSha256':'f'*64})
 class Adapter:
  def __init__(self,identity,plan,transport,journal):self.journal=journal
  def verifyWritesBlocked(self,identity):self.journal.record('writes-held')
  def resumed(self,identity):self.journal.record('writes-resumed')
  def callbacks(self):return {'verifyWritesResumed':self.resumed}
 w.WriterFenceAdapter=Adapter
 requests=[{'operation':'migrate-exact-plan'},{'operation':'record-migration-completion','stage':'intent','receipt':receipt},{'operation':'record-migration-completion','stage':'durable','receipt':receipt},{'operation':'callback','callback':'verifyWritesResumed'},{'operation':'close-accepted'}]
 data=b''.join((json.dumps(dict(request,sequence=i+1,identity=identity))+'\n').encode() for i,request in enumerate(requests))
 sys.stdin=io.TextIOWrapper(io.BytesIO(data))
 h.serve_reviewed_fence('/fixture/source.json',source_sha)
 result=json.loads((root/'writer-fence.json').read_text())
 assert result['migrationCompletionIntent']==receipt and result['migrationCompletionReceipt']==receipt
 assert 'acceptanceEvidence' not in result
 assert [e['state'] for e in result['events'] if e['state'].startswith('migration-completion-')]==['migration-completion-intent','migration-completion-durable']
 print('pure-shared-completion-journal-pass')
`;
 const result=spawnSync('/usr/bin/python3',['-c',script],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/pure-shared-completion-journal-pass/);
});
test('held drain reuses the sealed diagnostic connection and rejects stale or foreign proof',async()=>{
 for(const bad of ['none','session','generation','stale','unheld','unsafe']){
  const f=fixture();f.spec.sourcePlan.holdGeneration='9'.repeat(32);f.sealed.runtimePlan.holdGeneration=f.spec.sourcePlan.holdGeneration;f.sealed.sourcePlanCanonicalSha256=runtimeDigest(f.spec.sourcePlan);f.sealed.runtimePlan.runtimeSourcePlanSha256=f.sealed.sourcePlanCanonicalSha256;f.sealed.runtimePlanSha256=runtimeDigest(f.sealed.runtimePlan);
  const value:any={queued:0,running:0,writebackPending:0,connection:f.sealed.runtimePlan.diagnosticSessions.workspacex,identity:f.spec.identity,holdGeneration:f.spec.sourcePlan.holdGeneration,writesHeld:true,observedAt:Date.now()/1000};
  if(bad==='session')value.connection={pid:999};if(bad==='generation')value.holdGeneration='8'.repeat(32);if(bad==='stale')value.observedAt-=31;if(bad==='unheld')value.writesHeld=false;if(bad==='unsafe')value.running=-1;
  f.driver.request=async m=>{assert.equal(m.operation,'read-run-drain');return {value};};
  const life=createPersistentWriterLifecycle(f.spec);await life.start();
  if(bad==='none'){assert.deepEqual(await life.readRunDrain(f.spec.identity),{queued:0,running:0,writebackPending:0});assert.equal(f.counts().starts,1);}
  else{await assert.rejects(life.readRunDrain(f.spec.identity),/DRAIN_READBACK/);assert.equal(f.counts().retains,1);}
 }
});
test('retained recovery uses the running fence driver and rejects foreign input before dispatch',async()=>{const f=fixture();const ref={path:'/etc/workspacex-cn/maintenance-recovery/fixture/recovery-plan.json',sha256:'a'.repeat(64)};const auth={identity:f.spec.identity,planPath:ref.path,planSha256:ref.sha256,operationTimeoutMs:10000};f.spec.sourcePlan.recoveryAuthorization=auth;f.sealed.runtimePlan.recoveryAuthorization=auth;f.sealed.sourcePlanCanonicalSha256=runtimeDigest(f.spec.sourcePlan);f.sealed.runtimePlan.runtimeSourcePlanSha256=f.sealed.sourcePlanCanonicalSha256;f.sealed.runtimePlanSha256=runtimeDigest(f.sealed.runtimePlan);f.driver.request=async msg=>{f.messages.push(msg);return {value:{schemaVersion:1,kind:'production-recovery-completed',identity:f.spec.identity,receiptSha256:'b'.repeat(64),writesHeld:true,ready:false}};};const lifecycle=createPersistentWriterLifecycle(f.spec);await lifecycle.start();await assert.rejects(lifecycle.recoverRetainedBaseline(f.spec.identity,{...ref,sha256:'c'.repeat(64)}),/AUTHORIZATION/);assert.equal(f.messages.length,0);assert.equal((await lifecycle.recoverRetainedBaseline(f.spec.identity,ref)).writesHeld,true);assert.equal(f.messages[0].operation,'recover-retained-baseline');assert.equal(f.counts().starts,1);assert.equal(f.counts().closes,0);});
test('lost recovery response retains existing actor and disallows resume or automatic retry',async()=>{const f=fixture();const ref={path:'/etc/workspacex-cn/maintenance-recovery/fixture/recovery-plan.json',sha256:'a'.repeat(64)};f.spec.sourcePlan.recoveryAuthorization={identity:f.spec.identity,planPath:ref.path,planSha256:ref.sha256,operationTimeoutMs:10000};f.sealed.runtimePlan.recoveryAuthorization=f.spec.sourcePlan.recoveryAuthorization;f.sealed.sourcePlanCanonicalSha256=runtimeDigest(f.spec.sourcePlan);f.sealed.runtimePlan.runtimeSourcePlanSha256=f.sealed.sourcePlanCanonicalSha256;f.sealed.runtimePlanSha256=runtimeDigest(f.sealed.runtimePlan);const lifecycle=createPersistentWriterLifecycle(f.spec);await lifecycle.start();f.driver.request=async()=>{throw Error('lost response');};await assert.rejects(lifecycle.recoverRetainedBaseline(f.spec.identity,ref));await assert.rejects(lifecycle.recoverRetainedBaseline(f.spec.identity,ref),/AUTHORIZATION/);await assert.rejects(lifecycle.invoke('resumeWrites',f.spec.identity),/BINDING/);assert.equal(f.counts().retains,1);assert.equal(f.counts().closes,0);});
