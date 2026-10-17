"""Actual phase API and RPC marshaling over the existing isolated HTTP provider."""
import copy
import datetime as dt
from pathlib import Path
import unittest

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
