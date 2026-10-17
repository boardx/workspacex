"""Actual phase API and RPC marshaling over the existing isolated HTTP provider."""
import copy
import datetime as dt
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
import test_cn_release_fixed_driver as root_fixture
from test_cn_release_phase_gates import router_module

import test_fixed_cn_remote as fixtures
from test_cn_release_safety_gates import Evidence,safety_policy,enc,sha
import cn_image_archive as a
import fixed_cn_phases as phases
import fixed_cn_remote as remote


class Phases(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.Remote('test_complete_approved_pipeline_actual_rpc_and_readback');self.f.setUp();f=self.f
        self.journal=f.root/'journal';self.journal.mkdir(mode=0o700)
        for i in range(1,9):f.result_rows[str(i)]=dict(StartTime=f.now.isoformat(),FinishedTime=f.now.isoformat())
        v=a.decode(f.release);v.update(safetyGates=safety_policy(),rds={'dbInstanceId':'prod-db'},toolRevision='1'*40,
            orchestrationJournalRoot=str(self.journal),codeFiles={})
        for name in phases.RUNNER_FILES:v['codeFiles']['scripts/'+name]=sha((Path(phases.__file__).parent/name).read_bytes())
        f.release=enc(v);f.release_sha=sha(f.release);self.release=v
        self.e=Evidence(v,f.release_sha,f.migration,f.now)
        self.safe=self.e.consume();self.chain=copy.deepcopy(f.chain);self.chain['safetyEvidence']=self.safe
        writer=a.decode(f.writer);writer['releaseSha256']=f.release_sha
        writer['issuedAt']=(f.now-dt.timedelta(seconds=1)).isoformat()
        f.writer=enc(writer);f.writer_sha=sha(f.writer)
        self.a3=self.wait('switch-stage',f.now-dt.timedelta(seconds=9))
        self.held=self.wait('clear-hold',f.now-dt.timedelta(seconds=8))
    def tearDown(self):self.f.tearDown()
    def wait(self,stage,time):
        f=self.f;prefix=f.stages[:f.stages.index(stage)]
        c=dict(kind='cn-fixed-release-checkpoint-v1',releaseSha256=f.release_sha,identity=f.identity,target=remote.TARGET,
            stage=stage,checkpointAt=time.isoformat(),lastReceiptSha256=sha(prefix[-1].encode()),
            hostBackupSha256=self.safe['hostBackupSha256'],rdsBackupSha256=self.safe['rdsBackupSha256'],
            holdGeneration='fixture-generation',backupId='100')
        if stage=='clear-hold':
            c.update({k:'b'*64 for k in ('bindingSha256','holdRawSha256','switchReceiptSha256','heldHealthSha256')})
            c.update(restoreReceiptSha256=self.safe['restoreReceiptSha256'],sqlReceiptSha256=self.safe['sqlReceiptSha256'],
                     safetyApprovalSha256=self.safe['approvalSha256'])
        return dict(status='WAITING_FOR_A3_A4_EVIDENCE' if stage=='switch-stage' else 'WAITING_FOR_WRITER_APPROVAL',
            stage=stage,intentCreated=False,completed=copy.deepcopy(self.chain['completed'][:len(prefix)]),checkpoint=c)
    def respond(self,number,value,failed=False):
        self.f.responses[str(number)]=value
        if failed:
            start,finish=(-10,-5) if number==1 else (-4,-2)
            if number!=1:value['checkpoint']['checkpointAt']=(self.f.now+dt.timedelta(seconds=-3)).isoformat()
            self.f.result_rows[str(number)]=dict(InvocationStatus='Failed',InvokeRecordStatus='Finished',ExitCode=2,
                StartTime=(self.f.now+dt.timedelta(seconds=start)).isoformat(),FinishedTime=(self.f.now+dt.timedelta(seconds=finish)).isoformat())
    def begin(self,packet=None,previous=None,output=None):
        f=self.f;packet=packet or f.packet()
        return phases.begin(packet,f.plan_raw,f.plan_sha,f.release,f.release_sha,f.provenance,f.migration,f.rpc,
            output or self.journal/packet[1],authorization_evidence_raw=f.authorization,previous_pause=previous)
    def held_pause(self):
        self.respond(1,self.held,True);raw=self.begin();return (self.journal/self.f.packet()[1],sha(raw))
    def continuation(self,pause):
        f=self.f
        return [f.packet(previous=pause[1],issuedAt=(f.now-dt.timedelta(seconds=1)).isoformat()),
            f.packet('business-readback','@previous',sequence=1,issuedAt=(f.now-dt.timedelta(seconds=1)).isoformat()),
            f.packet('business-readback','@previous',sequence=2,issuedAt=(f.now-dt.timedelta(seconds=1)).isoformat())]
    def resume(self,pause,packets=None):
        f=self.f;packets=packets or self.continuation(pause)
        return phases.resume(packets,pause,f.plan_raw,f.plan_sha,f.release,f.release_sha,f.writer,f.writer_sha,f.provenance,
            f.migration,f.rpc,self.journal/packets[0][1],authorization_evidence_raw=f.authorization)
    def test_actual_two_phase_hold_then_fresh_approval_then_same_clock_resume(self):
        pause=self.held_pause();self.assertEqual(len(self.f.commands),1)
        self.respond(2,self.chain)
        result=self.resume(pause)
        self.assertTrue(result['sixJourneyReceiptFieldsValid']);self.assertTrue(result['canonicalReadbackBytesMatch'])
        self.assertFalse(result['productionAccepted']);self.assertEqual(len(self.f.commands),4)
        self.assertEqual(self.chain['requestedAt'],self.f.identity['requestedAt'])
        self.assertEqual(self.chain['deadlineAt'],self.f.identity['deadlineAt'])
        self.assertEqual(len({v['ClientToken'] for v in self.f.commands.values()}),4)
        before=len(self.f.calls)
        with self.assertRaises(FileExistsError):self.resume(pause)
        self.assertEqual(len(self.f.calls),before)
    def test_a3_pause_then_explicit_continuation_then_a5_pause(self):
        f=self.f;packet=f.packet();self.respond(1,self.a3,True)
        first=self.begin(packet);prior=(self.journal/packet[1],sha(first))
        self.assertEqual(len(f.commands),1)
        self.respond(2,self.held,True);next_packet=f.packet(previous=prior[1],issuedAt=(f.now-dt.timedelta(seconds=4)).isoformat())
        second=self.begin(next_packet,prior)
        self.assertEqual(a.decode(second)['previousPauseSha256'],prior[1]);self.assertEqual(len(f.commands),2)
        self.respond(3,self.chain);result=self.resume((self.journal/next_packet[1],sha(second)))
        self.assertFalse(result['productionAccepted']);self.assertEqual(len(f.commands),5)
    def test_actual_root_switch_revocation_pause_recovery_and_explicit_resume(self):
        f=self.f;root=root_fixture.DriverTests();root.setUp();root.a=self.release
        r=router_module.Router(f.release_sha,self.release,f.release);r.base=f.root/'root-state';r.base.mkdir()
        r.safety_evidence=Mock(return_value=self.safe)
        r.conditional_writer=Mock(side_effect=AssertionError('no automatic approval'))
        evidence={'backup':enc(self.e.host),'rds-backup':enc(self.e.rds),'acceptance':b'actual fixture held health'}
        r.evidence=lambda stage,*args:evidence[stage]
        terminal={k:('actual fixture '+k).encode()for k in ('binding','hold','switchReceipt')}
        r.terminal_inputs=lambda:terminal
        root.router.safety_required=r.safety_required;root.router.admission=r.admission
        root.router.waiting_checkpoint=r.waiting_checkpoint;root.router.completed_safety=r.completed_safety
        original_execute=root.execute
        def execute(mode,request,attempt):
            result=original_execute(mode,request,attempt)
            if mode=='advance' and request==root_fixture.m.e.digest(b'switch-stage'):
                r.safety_evidence.return_value=None
            return result
        root.execute=execute;protected={}
        exists=Path.exists
        def read(path,*args):
            return protected[str(path)] if str(path)in protected else Path(path).read_bytes()
        def run_root(seconds):
            with patch.object(router_module.e,'now',return_value=f.now+dt.timedelta(seconds=seconds)), \
                 patch.object(root_fixture.m,'package_identity'):
                return root_fixture.m.coordinate(f.release_sha,self.release,root.router,
                    executor=root.execute,clock=lambda:f.now)
        def reply(number,value,start,finish):
            f.responses[str(number)]=value
            f.result_rows[str(number)]=dict(InvocationStatus='Failed',InvokeRecordStatus='Finished',ExitCode=2,
                StartTime=(f.now+dt.timedelta(seconds=start)).isoformat(),
                FinishedTime=(f.now+dt.timedelta(seconds=finish)).isoformat())
        # Only filesystem protection/external stage execution are fixture seams.
        # Real coordinate, Router.admission/checkpoint and phase/RPC run together.
        with patch.object(router_module.e,'read',side_effect=read), \
             patch.object(router_module.e,'directory'),patch.object(router_module.e,'fsync_dir'), \
             patch.object(router_module.e,'create',side_effect=lambda path,raw:Path(path).write_bytes(raw)), \
             patch.object(Path,'exists',lambda path:str(path)in protected or exists(path)):
            waiting=run_root(-9)
            self.assertEqual(waiting['stage'],'switch');self.assertEqual(len(waiting['completed']),13)
            self.assertNotIn('switch',root.requests)
            reply(1,waiting,-10,-8);packet=f.packet();raw=self.begin(packet)
            pause=(self.journal/packet[1],sha(raw));self.assertEqual(a.decode(raw)['checkpoint'],waiting['checkpoint'])
            (pause[0]/'pause.json').unlink()
            recovered=phases.recover(packet,f.plan_raw,f.plan_sha,f.release,f.release_sha,f.provenance,f.migration,f.rpc,pause[0])
            self.assertEqual(raw,recovered);self.assertEqual(len(f.commands),1)
            # Explicit fresh call while revocation persists still cannot switch.
            waiting_again=run_root(-5);reply(2,waiting_again,-6,-4)
            fresh=f.packet(previous=pause[1],issuedAt=(f.now-dt.timedelta(seconds=7)).isoformat())
            raw2=self.begin(fresh,pause);pause2=(self.journal/fresh[1],sha(raw2))
            self.assertEqual(a.decode(raw2)['checkpoint']['stage'],'switch');self.assertNotIn('switch',root.requests)
            recovered2=phases.recover(fresh,f.plan_raw,f.plan_sha,f.release,f.release_sha,f.provenance,
                f.migration,f.rpc,pause2[0],previous_pause=pause)
            self.assertEqual(raw2,recovered2);self.assertEqual(len(f.commands),2)
            # Restoring the same independently approved evidence permits the root
            # to reach held-health, but never publishes its own writer approval.
            r.safety_evidence.return_value=self.safe
            held=run_root(-1.5);self.assertEqual(held['stage'],'clear-hold')
            reply(3,held,-2,-1)
            fresh3=f.packet(previous=pause2[1],issuedAt=(f.now-dt.timedelta(seconds=3)).isoformat())
            raw3=self.begin(fresh3,pause2);held_pause=(self.journal/fresh3[1],sha(raw3))
            writer=a.decode(f.writer)
            for key in ('bindingSha256','holdRawSha256','switchReceiptSha256','heldHealthSha256','holdGeneration'):
                writer[key]=held['checkpoint'][key]
            writer['issuedAt']=(f.now-dt.timedelta(seconds=.5)).isoformat();f.writer=enc(writer);f.writer_sha=sha(f.writer)
            base='/etc/workspacex-cn/writer-resume-approvals/'
            protected[base+'by-release/'+f.release_sha+'.json']=enc(dict(approvalSha256=f.writer_sha))
            protected[base+f.writer_sha+'.json']=f.writer
            for key in ('bindingSha256','switchReceiptSha256','holdGeneration'):f.business[key]=writer[key]
            f.business['observedAt']=(f.now-dt.timedelta(seconds=.1)).isoformat()
            completed=run_root(0);self.assertEqual(completed['status'],'CHAIN_COMPLETED');self.respond(4,completed)
            self.assertEqual(completed['requestedAt'],f.identity['requestedAt'])
            self.assertEqual(completed['deadlineAt'],f.identity['deadlineAt'])
            issued=(f.now-dt.timedelta(seconds=.25)).isoformat()
            packets=[f.packet(previous=held_pause[1],issuedAt=issued),
                f.packet('business-readback','@previous',sequence=1,issuedAt=issued),
                f.packet('business-readback','@previous',sequence=2,issuedAt=issued)]
            result=self.resume(held_pause,packets);self.assertFalse(result['productionAccepted'])
            self.assertEqual(len(f.commands),6)
            self.assertEqual(len([v for v in root.calls if v[0]=='advance']),17)
            before=len(f.calls)
            with self.assertRaises(FileExistsError):self.resume(held_pause,packets)
            self.assertEqual(len(f.calls),before);r.conditional_writer.assert_not_called()
    def test_no_future_writer_hash_or_pre_hold_approval(self):
        f=self.f;pause=self.held_pause();before=len(f.calls)
        writer=a.decode(f.writer);writer['switchReceiptSha256']='f'*64;f.writer=enc(writer);f.writer_sha=sha(f.writer)
        with self.assertRaisesRegex(a.Rejected,'RESUME_ACTUAL_HELD_HASH_REQUIRED'):self.resume(pause)
        writer['switchReceiptSha256']='b'*64;writer['issuedAt']=(f.now-dt.timedelta(seconds=60)).isoformat()
        f.writer=enc(writer);f.writer_sha=sha(f.writer)
        with self.assertRaisesRegex(a.Rejected,'RESUME_APPROVAL_BEFORE_HOLD'):self.resume(pause)
        self.assertEqual(len(f.calls),before)
    def test_transport_scope_cannot_be_approved_before_future_pause_hash(self):
        f=self.f;pause=self.held_pause();before=len(f.calls);packets=self.continuation(pause)
        raw,pin=f.packet(previous=pause[1]);packets[0]=(raw,pin)
        with self.assertRaisesRegex(a.Rejected,'RESUME_TRANSPORT_BEFORE_WRITER'):self.resume(pause,packets)
        self.assertEqual(len(f.calls),before)
    def test_expired_approval_and_changed_root_or_tool_no_resume(self):
        f=self.f;pause=self.held_pause();before=len(f.calls)
        packets=self.continuation(pause);v=a.decode(packets[0][0]);v['expiresAt']='2020-01-01T00:00:00Z'
        packets[0]=(enc(v),sha(enc(v)))
        with self.assertRaises(a.Rejected):self.resume(pause,packets)
        packets=self.continuation(pause);v=a.decode(packets[2][0]);v['toolRevision']='2'*40;packets[2]=(enc(v),sha(enc(v)))
        with self.assertRaisesRegex(a.Rejected,'RESUME_TOOL_REVISION_CHANGED'):self.resume(pause,packets)
        self.assertEqual(len(f.calls),before)
    def test_waiting_a3_cannot_be_used_as_a5_prepare(self):
        f=self.f;packet=f.packet();self.respond(1,self.a3,True);raw=self.begin(packet)
        pause=(self.journal/packet[1],sha(raw));before=len(f.calls)
        with self.assertRaises(a.Rejected):self.resume(pause)
        self.assertEqual(len(f.calls),before)
    def test_lost_ack_no_pause_no_replay_even_with_different_output(self):
        f=self.f;f.failure='lost-ack';packet=f.packet()
        with self.assertRaises(a.Rejected):self.begin(packet)
        self.assertTrue((self.journal/packet[1]/'transport/uncertain.json').exists())
        with self.assertRaises(FileExistsError):self.begin(packet)
        with self.assertRaisesRegex(a.Rejected,'PHASE_CANONICAL_OUTPUT_REQUIRED'):
            self.begin(packet,output=f.root/'other')
        with self.assertRaises(FileNotFoundError):self.resume((self.journal/packet[1],'a'*64))
        self.assertEqual([v[0]for v in f.calls],['RunCommand'])
    def test_timeout_ack_recovered_readonly_without_resubmit(self):
        f=self.f;packet=f.packet(maxSeconds=1);self.respond(1,self.held,True)
        f.result_rows['1'].update(InvocationStatus='Running',InvokeRecordStatus='Running',ExitCode=0)
        with self.assertRaisesRegex(a.Rejected,'REMOTE_DEADLINE_UNCERTAIN'):self.begin(packet)
        f.result_rows['1'].update(InvocationStatus='Failed',InvokeRecordStatus='Finished',ExitCode=2)
        raw=phases.recover(packet,f.plan_raw,f.plan_sha,f.release,f.release_sha,f.provenance,f.migration,f.rpc,self.journal/packet[1])
        self.assertEqual(a.decode(raw)['checkpoint'],self.held['checkpoint'])
        self.assertEqual(len(f.commands),1)
        again=phases.recover(packet,f.plan_raw,f.plan_sha,f.release,f.release_sha,f.provenance,f.migration,f.rpc,self.journal/packet[1])
        self.assertEqual(raw,again);self.assertEqual(len(f.commands),1)
    def test_changed_journal_prefix_or_stale_checkpoint_fails_closed(self):
        f=self.f;pause=self.held_pause();before=len(f.calls)
        (pause[0]/'transport/failed-output.json').write_bytes(b'changed')
        with self.assertRaises(a.Rejected):self.resume(pause)
        self.assertEqual(len(f.calls),before)
    def test_missing_safety_completion_stops_before_business(self):
        f=self.f;pause=self.held_pause();value=copy.deepcopy(self.chain);value['safetyEvidence']['restoreReceiptSha256']='f'*64
        self.respond(2,value)
        with self.assertRaisesRegex(a.Rejected,'SAFETY_COMPLETION_CHANGED'):self.resume(pause)
        self.assertEqual(len(f.commands),2)
    def test_current_one_shot_cannot_skip_preparation_for_new_scope(self):
        with self.assertRaisesRegex(a.Rejected,'PREPARATION_REQUIRED'):self.f.pipeline()
        self.assertEqual(self.f.calls,[])

if __name__=='__main__':unittest.main()
