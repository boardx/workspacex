"""Concrete RPC marshaling over loopback HTTP; no cloud or root commands execute."""
import base64
import copy
import datetime as dt
import http.server
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.request
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import test_cn_image_candidate as fixtures
import cn_image_archive as a
import fixed_cn_remote as r
import fixed_cn_receipts as consumer


class Request:
    def __init__(self):self.values={};self.params={}
    def add_query_param(self,k,v):self.params[k]=v
    def __getattr__(self,k):
        if k.startswith('set_'):return lambda v:self.values.update({k[4:]:v})
        raise AttributeError(k)


class Remote(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        now=dt.datetime.now(dt.timezone.utc);self.now=now
        self.authorization=b'isolated independently pinned user authorization evidence'
        self.plan=fixtures.plan();self.plan.update(sourceRevision=r.FIXED.SOURCE,controlRevision=r.FIXED.CONTROL)
        self.plan_raw=a.json_bytes(self.plan);self.plan_sha=a.sha(self.plan_raw)
        self.provenance=a.json_bytes(dict(runId=r.FIXED.RUN,runAttempt=r.FIXED.RUN_ATTEMPT,
            sourceRevision=r.FIXED.SOURCE,controlRevision=r.FIXED.CONTROL))
        self.identity=dict(sourceRevision=r.FIXED.SOURCE,baselineRevision='b'*40,controlRevision=r.FIXED.CONTROL,
            publicationAttemptId=self.plan['attemptId'],attemptId='fixed-isolated',
            requestedAt=(now-dt.timedelta(seconds=120)).isoformat(),deadlineAt=(now+dt.timedelta(minutes=25)).isoformat())
        self.migration=a.json_bytes(dict(sourceRevision=r.FIXED.SOURCE,baselineRevision='b'*40,changedFiles=[],schemaMigrationRequired=False))
        release=dict(kind='cn-fixed-release-approval-v1',target=r.TARGET,identity=self.identity,
            issuedAt=(now-dt.timedelta(seconds=90)).isoformat(),expiresAt=self.identity['deadlineAt'],
            business={'stableWindowSeconds':30},runtime={'staticInputHashes':{'migrationDiff':a.sha(self.migration)}},
            acquire={'requests':{'consume':{'inputs':{'plan':self.plan_sha,'set':'a'*64,'policy':a.sha(self.provenance)}}}})
        self.release=a.json_bytes(release);self.release_sha=a.sha(self.release)
        writer=dict(kind='cn-writer-resume-approval-v1',scope='a5-resume-writers-and-a6-scoped-business-observation',
            releaseSha256=self.release_sha,identity=self.identity,target=r.TARGET,
            issuedAt=(now-dt.timedelta(seconds=60)).isoformat(),expiresAt=(now+dt.timedelta(minutes=20)).isoformat(),
            holdGeneration='fixture-generation',publicOrigin='https://app.boardx.com.cn/',
            **{k:'b'*64 for k in ('bindingSha256','switchReceiptSha256','heldHealthSha256','holdRawSha256',
                                  'userAuthorizationEvidenceSha256','testDataScopeSha256')})
        self.writer=a.json_bytes(writer);self.writer_sha=a.sha(self.writer)
        self.business=dict(schemaVersion=1,kind='cn-independent-business-acceptance-v1',**self.identity,
            mode='observe',runtimeRevision=r.FIXED.SOURCE,runtimeInventorySha256='c'*64,
            bindingSha256='b'*64,switchReceiptSha256='b'*64,holdGeneration='fixture-generation',
            observedAt=(now-dt.timedelta(seconds=1)).isoformat(),
            checks={k:True for k in ('login','hello','asr','githubFeedbackRead','skillTool','pdfDownload')},
            ownedAcceptanceRunIds=['hello-run','skill-run','pdf-run'],liveObservationSha256=['d'*64,'e'*64],
            stableWindowSeconds=30,externalWritesTerminal=False)
        self.stages=['consume','publication-stage','check-plan','publish','hold-stage','hold','stop-stage','stop',
                     'sessions','backup-stage','backup','rds-backup','switch-stage','switch','acceptance','clear-hold','observe']
        self.chain=dict(status='CHAIN_COMPLETED',requestedAt=self.identity['requestedAt'],deadlineAt=self.identity['deadlineAt'],
            completed=[dict(stage=s,requestSha256=a.sha((s+'request').encode()),receiptSha256=a.sha(s.encode())) for s in self.stages],
            productionAcceptanceClaimedByDriver=False)
        self.calls=[];self.commands={};self.failure=None;self.row_updates={};self.second_changed=False
        self.responses={};self.result_rows={}
        outer=self
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                action=request['action'];params=request['params'];outer.calls.append((action,params))
                if action=='RunCommand':
                    ident=str(len(outer.commands)+1);outer.commands['t-'+ident]=params
                    body=dict(InvokeId='t-'+ident,CommandId='c-'+ident)
                    if outer.failure=='lost-ack':self.connection.shutdown(2);return
                else:
                    ident=params['InvokeId'].split('-')[1]
                    value=outer.responses.get(ident,outer.chain if ident=='1' else outer.business)
                    if ident=='3' and outer.second_changed:value={**value,'runtimeInventorySha256':'f'*64}
                    row=dict(InstanceId=r.FIXED.TARGET,InvokeId='t-'+ident,CommandId='c-'+ident,
                        InvocationStatus='Success',InvokeRecordStatus='Finished',ExitCode=0,Dropped=0,
                        StartTime=(outer.now-dt.timedelta(seconds=10)).isoformat(),
                        FinishedTime=outer.now.isoformat(),
                        Output=base64.b64encode(a.json_bytes(value)).decode())
                    row.update(outer.row_updates);row.update(outer.result_rows.get(ident,{}))
                    body={'Invocation':{'InvocationResults':{'InvocationResult':[row]}}}
                raw=json.dumps(body).encode();self.send_response(200);self.end_headers();self.wfile.write(raw)
            def log_message(self,*args):pass
        self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        class Client:
            def do_action_with_exception(_,q):
                outer.assertEqual(q.values['domain'],'ecs.cn-shanghai.aliyuncs.com')
                outer.assertEqual(q.values['protocol_type'],'https')
                payload=json.dumps(dict(action=q.values['action_name'],params=q.params)).encode()
                with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(outer.server.server_port),
                    data=payload,headers={'Content-Type':'application/json'}),timeout=2) as response:return response.read()
        self.rpc=r.EcsRpc(Client(),Request,'acs:ram::1177216024653153:role/isolated-fixture')

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()

    def packet(self,operation='release-run',previous=None,**changes):
        argv=r.command(self.plan_raw,self.plan_sha,operation,self.release_sha,'1'*40)
        value=dict(kind='fixed-cn-transport-approval-v1',source=r.FIXED.SOURCE,control=r.FIXED.CONTROL,
            run=r.FIXED.RUN,target=r.TARGET,principalArn=self.rpc.principal_arn,operation=operation,sequence=0,entryApprovalSha256=self.release_sha,
            toolRevision='1'*40,planSha256=self.plan_sha,candidateSha256='a'*64,
            previousReceiptSha256=previous,commandSha256=a.sha(a.json_bytes(argv)),
            issuedAt=(self.now-dt.timedelta(seconds=30)).isoformat(),expiresAt=(self.now+dt.timedelta(minutes=20)).isoformat(),
            maxSeconds=60,userAuthorizationEvidenceSha256=a.sha(self.authorization))
        value.update(changes);raw=a.json_bytes(value);return raw,a.sha(raw)

    def packets(self):return [self.packet(),self.packet('business-readback','@previous',sequence=1),self.packet('business-readback','@previous',sequence=2)]
    def pipeline(self,packets=None):
        return consumer.run_approved_pipeline(packets or self.packets(),self.plan_raw,self.plan_sha,self.release,self.release_sha,
            self.writer,self.writer_sha,self.provenance,self.migration,self.rpc,self.root/'pipeline',authorization_evidence_raw=self.authorization)

    def test_complete_approved_pipeline_actual_rpc_and_readback(self):
        value=self.pipeline()
        self.assertTrue(value['sixJourneyReceiptFieldsValid']);self.assertTrue(value['canonicalReadbackBytesMatch'])
        self.assertFalse(value['productionAccepted'])
        self.assertTrue(value['providerQueriesPerformed'])
        self.assertNotIn('sixJourneysVerified',value)
        self.assertNotIn('canonicalReadbackVerified',value)
        tuples=[]
        for index,(raw,pin) in enumerate(self.packets()):
            folder=self.root/'pipeline'/str(index)
            tuples.append(((folder/'receipt.json').read_bytes(),(folder/'output.json').read_bytes(),raw,pin))
        offline=consumer.business(self.release,self.release_sha,self.writer,self.writer_sha,*tuples,
            self.plan_raw,self.plan_sha,None,self.provenance,self.migration)
        self.assertNotIn('providerQueriesPerformed',offline)
        self.assertNotIn('sixJourneysVerified',offline)
        self.assertFalse(offline['productionAccepted'])
        self.assertEqual([v[0] for v in self.calls],['RunCommand','DescribeInvocationResults']*3)
        self.assertEqual(len(self.commands),3)
        self.assertEqual(len({v['ClientToken'] for v in self.commands.values()}),3)
        first=self.commands['t-1'];self.assertEqual(first['InstanceId.1'],r.FIXED.TARGET)
        self.assertIn('/usr/local/bin/workspacex-cn-fixed-release run',first['CommandContent'])
        for ident in ('t-2','t-3'):
            self.assertIn('readback',self.commands[ident]['CommandContent'])
            self.assertNotIn(' observe ',self.commands[ident]['CommandContent'])
        before=len(self.calls)
        with self.assertRaises(FileExistsError):self.pipeline()
        self.assertEqual(before,len(self.calls))

    def test_bad_approval_or_scope_zero_calls(self):
        for field,value in [('target',{**r.TARGET,'ecsInstanceId':'other'}),('source','a'*40),('run',1),
                             ('commandSha256','0'*64),('previousReceiptSha256','f'*64),
                             ('principalArn','acs:ram::1177216024653153:role/wrong'),
                             ('expiresAt','2020-01-01T00:00:00Z')]:
            with self.subTest(field=field):
                raw,pin=self.packet(**{field:value})
                with self.assertRaises(a.Rejected):r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/field,authorization_evidence_raw=self.authorization,entry_approval_raw=self.release)
                self.assertEqual(self.calls,[])

    def test_standalone_entry_original_and_candidate_binding_before_effects(self):
        raw,pin=self.packet()
        for original in (None,b'{}'):
            with self.assertRaisesRegex(a.Rejected,'REMOTE_ENTRY_APPROVAL_BYTES'):
                r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/'unbound',entry_approval_raw=original)
        raw,pin=self.packet(candidateSha256='f'*64)
        with self.assertRaisesRegex(a.Rejected,'REMOTE_ENTRY_CANDIDATE_BINDING'):
            r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/'mismatch',authorization_evidence_raw=self.authorization,entry_approval_raw=self.release)
        self.assertEqual(self.calls,[])
        self.assertFalse((self.root/'unbound').exists())
        self.assertFalse((self.root/'mismatch').exists())

    def test_original_authorization_evidence_required_before_effects(self):
        raw,pin=self.packet()
        for evidence in (None,b'wrong evidence'):
            with self.assertRaisesRegex(a.Rejected,'REMOTE_AUTHORIZATION_EVIDENCE_BYTES'):
                r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/'auth',
                    entry_approval_raw=self.release,authorization_evidence_raw=evidence)
        self.assertFalse((self.root/'auth').exists())
        self.assertEqual(self.calls,[])

    def test_unknown_or_changed_sql_blocks_before_remote_submit(self):
        migration=a.decode(self.migration);migration.update(changedFiles=['permission-change.sql'],schemaMigrationRequired=True)
        self.migration=a.json_bytes(migration)
        release=a.decode(self.release);release['runtime']['staticInputHashes']['migrationDiff']=a.sha(self.migration)
        self.release=a.json_bytes(release);self.release_sha=a.sha(self.release)
        with self.assertRaisesRegex(a.Rejected,'CANONICAL_NO_MIGRATION_ROUTE_ONLY'):self.pipeline()
        self.assertEqual(self.calls,[])

    def test_bad_writer_and_build_proof_before_effects(self):
        original=self.writer_sha
        self.writer_sha='0'*64
        with self.assertRaises(a.Rejected):self.pipeline()
        self.assertEqual(self.calls,[]);self.writer_sha=original
        self.provenance=a.json_bytes(dict(runId=1,runAttempt=1,sourceRevision=r.FIXED.SOURCE,controlRevision=r.FIXED.CONTROL))
        with self.assertRaises(a.Rejected):self.pipeline()
        self.assertEqual(self.calls,[])

    def test_expired_original_build_attempt_cannot_authorize_rebuild(self):
        provenance=a.decode(self.provenance);provenance['runAttempt']=1
        self.provenance=a.json_bytes(provenance)
        release=a.decode(self.release)
        release['acquire']['requests']['consume']['inputs']['policy']=a.sha(self.provenance)
        self.release=a.json_bytes(release);self.release_sha=a.sha(self.release)
        writer=a.decode(self.writer);writer['releaseSha256']=self.release_sha
        self.writer=a.json_bytes(writer);self.writer_sha=a.sha(self.writer)
        with self.assertRaisesRegex(a.Rejected,'BUSINESS_FIXED_BUILD_RUN'):self.pipeline()
        self.assertEqual(self.calls,[])

    def test_lost_submit_response_never_retries(self):
        self.failure='lost-ack';raw,pin=self.packet()
        with self.assertRaises(Exception):r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/'lost',authorization_evidence_raw=self.authorization,entry_approval_raw=self.release)
        self.assertEqual([c[0] for c in self.calls],['RunCommand'])
        self.assertTrue((self.root/'lost/uncertain.json').exists())
        with self.assertRaises(FileExistsError):r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/'lost',authorization_evidence_raw=self.authorization,entry_approval_raw=self.release)
        self.assertEqual(len(self.calls),1)

    def test_provider_failure_identity_truncation_and_exit(self):
        for index,update in enumerate([{'InstanceId':'other'},{'InvokeId':'other'}, {'CommandId':'other'},
                {'Dropped':1},{'ExitCode':1},{'InvocationStatus':'Failed'}]):
            with self.subTest(update=update):
                self.row_updates=update;raw,pin=self.packet()
                with self.assertRaises(a.Rejected):r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/str(index),authorization_evidence_raw=self.authorization,entry_approval_raw=self.release)
                self.commands.clear()

    def test_root_waiting_stops_before_any_business_call(self):
        self.chain['status']='AWAITING_A5_APPROVAL'
        with self.assertRaisesRegex(a.Rejected,'ROOT_CHAIN_NOT_COMPLETED'):self.pipeline()
        self.assertEqual(len(self.commands),1)

    def test_actual_nonzero_wait_preserves_output_without_success_or_retry(self):
        self.chain.update(status='WAITING_FOR_WRITER_APPROVAL',stage='clear-hold',intentCreated=False)
        self.chain['completed']=self.chain['completed'][:15]
        self.row_updates={'InvocationStatus':'Failed','InvokeRecordStatus':'Finished','ExitCode':2}
        with self.assertRaisesRegex(r.CommandFailed,'REMOTE_COMMAND_FAILED'):
            self.pipeline()
        journal=self.root/'pipeline/0'
        self.assertEqual((journal/'failed-output.json').read_bytes(),a.json_bytes(self.chain))
        failed=a.decode((journal/'failed-command.json').read_bytes())
        self.assertEqual(failed['exitCode'],2)
        self.assertTrue(failed['remoteCommandTerminal'])
        self.assertFalse(failed['releaseCompleted'])
        self.assertFalse(failed['productionAccepted'])
        self.assertFalse((journal/'receipt.json').exists())
        self.assertFalse((journal/'uncertain.json').exists())
        self.assertEqual(len(self.commands),1)
        with self.assertRaises(FileExistsError):self.pipeline()
        self.assertEqual(len(self.commands),1)

    def test_sdk_debug_rejected_before_sdk_import_or_identity_call(self):
        with patch.dict(os.environ,{'DEBUG':'SDK'}):
            with self.assertRaisesRegex(a.Rejected,'AUTH_SDK_DEBUG_FORBIDDEN'):
                r.EcsRpc.from_existing_credential(object(),self.rpc.principal_arn)
        self.assertEqual(self.calls,[])

    def test_later_principal_and_expired_writer_rejected_before_effects(self):
        packets=self.packets()
        bad=a.decode(packets[2][0]);bad['principalArn']='acs:ram::1177216024653153:role/other'
        raw=a.json_bytes(bad);packets[2]=(raw,a.sha(raw))
        with self.assertRaisesRegex(a.Rejected,'REMOTE_PRINCIPAL_MISMATCH'):self.pipeline(packets)
        self.assertEqual(self.calls,[])
        writer=a.decode(self.writer);writer['expiresAt']=(self.now-dt.timedelta(seconds=1)).isoformat()
        self.writer=a.json_bytes(writer);self.writer_sha=a.sha(self.writer)
        with self.assertRaisesRegex(a.Rejected,'WRITER_EXECUTION_APPROVAL_EXPIRED'):self.pipeline()
        self.assertEqual(self.calls,[])

    def test_no_missing_or_reordered_a0_a6_stage(self):
        self.chain['completed'].pop(9)
        with self.assertRaisesRegex(a.Rejected,'ROOT_STAGE_ORDER'):self.pipeline()
        self.assertEqual(len(self.commands),1)

    def test_business_readback_bytes_must_match(self):
        self.second_changed=True
        with self.assertRaisesRegex(a.Rejected,'BUSINESS_ORIGINAL_READBACK_CHANGED'):self.pipeline()
        self.assertEqual(len(self.commands),3)

    def test_business_failures_not_health_success(self):
        for field,value in [('checks',{'health':True}),('ownedAcceptanceRunIds',['a','a','a']),
                             ('bindingSha256','f'*64),('runtimeRevision','b'*40),
                             ('externalWritesTerminal',True)]:
            with self.subTest(field=field):
                with tempfile.TemporaryDirectory() as temp:
                    original_root=self.root;self.root=Path(temp)
                    original=copy.deepcopy(self.business);self.business[field]=value;self.commands.clear()
                    with self.assertRaises(a.Rejected):self.pipeline()
                    self.business=original;self.root=original_root

    def test_no_ambient_credential_fallback(self):
        with self.assertRaisesRegex(a.Rejected,'EXISTING_CREDENTIAL_REQUIRED'):
            r.EcsRpc.from_existing_credential(None,self.rpc.principal_arn)
        self.assertEqual(self.calls,[])

    def test_unsupported_iam_or_cancel_never_sent(self):
        for action in ('StopInvocation','CreateRole','AttachPolicyToRole'):
            with self.assertRaises(a.Rejected):self.rpc.call(action,{})
        self.assertEqual(self.calls,[])

    def test_readonly_reconcile_never_submits(self):
        raw,pin=self.packet();r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/'existing',authorization_evidence_raw=self.authorization,entry_approval_raw=self.release)
        before=len(self.commands)
        output=r.reconcile(self.root/'existing',self.rpc,pin)
        self.assertEqual(json.loads(output)['status'],'CHAIN_COMPLETED')
        self.assertEqual(len(self.commands),before)
        with self.assertRaises(a.Rejected):r.reconcile(self.root/'existing',self.rpc,'0'*64)

    def test_expired_approval_readonly_recovery_preserves_original_execution_window(self):
        raw,pin=self.packet();folder=self.root/'historical'
        receipt,body=r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,folder,authorization_evidence_raw=self.authorization,entry_approval_raw=self.release)
        (folder/'receipt.json').unlink()
        future=self.now+dt.timedelta(minutes=21)
        class Later(dt.datetime):
            @classmethod
            def now(cls,tz=None):return future
        before=len(self.commands)
        with patch.object(r.dt,'datetime',Later):
            self.assertEqual(r.reconcile(folder,self.rpc,pin),body)
            self.assertEqual((folder/'receipt.json').read_bytes(),receipt)
            consumer.remote_result(receipt,body,raw,pin,self.plan_raw,self.plan_sha,None)
            with self.assertRaisesRegex(a.Rejected,'TRANSPORT_APPROVAL_EXPIRED'):
                r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/'new',authorization_evidence_raw=self.authorization,entry_approval_raw=self.release)
            (folder/'receipt.json').unlink()
            self.row_updates={'FinishedTime':future.isoformat()}
            with self.assertRaisesRegex(a.Rejected,'REMOTE_RESULT_TIME_WINDOW'):
                r.reconcile(folder,self.rpc,pin)
            self.assertFalse((folder/'receipt.json').exists())
        self.assertEqual(len(self.commands),before)

    def test_reconcile_never_overwrites_changed_original_receipt(self):
        raw,pin=self.packet();folder=self.root/'conflict'
        r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,folder,authorization_evidence_raw=self.authorization,entry_approval_raw=self.release)
        (folder/'receipt.json').write_bytes(b'changed')
        with self.assertRaisesRegex(a.Rejected,'RECONCILE_EXISTING_BYTES_CHANGED'):
            r.reconcile(folder,self.rpc,pin)
        self.assertEqual((folder/'receipt.json').read_bytes(),b'changed')
        self.assertEqual(len(self.commands),1)

    def test_running_deadline_preserves_ack_then_readonly_reconcile(self):
        self.row_updates={'InvocationStatus':'Running','InvokeRecordStatus':'Running'}
        raw,pin=self.packet(maxSeconds=1)
        clock=[0.0]
        def wait(seconds):clock[0]+=seconds
        with self.assertRaisesRegex(a.Rejected,'REMOTE_DEADLINE_UNCERTAIN'):
            r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/'timeout',authorization_evidence_raw=self.authorization,entry_approval_raw=self.release,
                      monotonic=lambda:clock[0],wait=wait)
        self.assertTrue((self.root/'timeout/ack.json').exists())
        self.assertFalse((self.root/'timeout/receipt.json').exists())
        self.row_updates={}
        r.reconcile(self.root/'timeout',self.rpc,pin)
        self.assertEqual(len(self.commands),1)

    def test_late_success_is_not_accepted(self):
        raw,pin=self.packet(maxSeconds=1)
        ticks=iter([0,0,2])
        with self.assertRaisesRegex(a.Rejected,'REMOTE_DEADLINE_UNCERTAIN'):
            r.execute(raw,pin,self.plan_raw,self.plan_sha,None,self.rpc,self.root/'late',authorization_evidence_raw=self.authorization,entry_approval_raw=self.release,monotonic=lambda:next(ticks))
        self.assertFalse((self.root/'late/receipt.json').exists())
        self.assertEqual(len(self.commands),1)

    def test_business_approval_late_or_candidate_packet_mismatch(self):
        packets=self.packets();bad=a.decode(packets[2][0]);bad['candidateSha256']='b'*64
        packets[2]=(a.json_bytes(bad),a.sha(a.json_bytes(bad)))
        with self.assertRaises(a.Rejected):self.pipeline(packets)
        self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main()
