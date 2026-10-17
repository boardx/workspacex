"""Explicit cloud-call phases; no approval minting, restoration or auto-resume.

An authenticated existing RPC capability and independently pinned original
scope/evidence are required. Private on-cloud journals must survive job loss.
Nothing in this module is a live-provider attestation when fixtures are injected.
"""
import datetime as dt
import importlib.util
import os
import stat
from pathlib import Path

import cn_image_archive as a
import fixed_cn_remote as remote
import fixed_cn_receipts as receipts


RUNNER_FILES=('fixed_cn_phases.py','fixed_cn_receipts.py','fixed_cn_remote.py','fixed_cn_bundle.py',
              'fixed_cn_host_commands.py','fixed-cn-release.py','cn-release-safety-gates.py')

def policy(release):
    for name in RUNNER_FILES:
        source=Path(__file__).with_name(name)
        a.require(release['codeFiles']['scripts/'+name]==a.sha(source.read_bytes()),'PHASE_RUNNER_CLOSURE_PIN')
    journal=Path(release['orchestrationJournalRoot'])
    a.require(journal.is_absolute() and journal==journal.resolve() and journal.is_dir(),'PHASE_DURABLE_JOURNAL_REQUIRED')
    status=journal.stat()
    a.require(status.st_uid==os.geteuid() and stat.S_IMODE(status.st_mode)==0o700,'PHASE_PRIVATE_JOURNAL_REQUIRED')
    path=Path(__file__).with_name('cn-release-safety-gates.py')
    a.require(release['codeFiles']['scripts/cn-release-safety-gates.py']==a.sha(path.read_bytes()),'PHASE_SAFETY_TOOL_PIN')
    spec=importlib.util.spec_from_file_location('phase_safety',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.policy(release)
    a.require(a.hex_string(release['toolRevision'],40),'PHASE_INSTALLED_TOOL_REVISION')


def checkpoint(value,release,release_sha,driver):
    a.require(value['status'] in ('WAITING_FOR_A3_A4_EVIDENCE','WAITING_FOR_WRITER_APPROVAL'),'PHASE_WAIT_STATUS')
    c=value['checkpoint'];stage=value['stage']
    expected='switch-stage' if value['status']=='WAITING_FOR_A3_A4_EVIDENCE' else 'clear-hold'
    a.require(stage==expected and value['intentCreated'] is False,'PHASE_WAIT_BOUNDARY')
    prefix=list(driver.e.STAGES[:list(driver.e.STAGES).index(stage)])
    a.require([v['stage'] for v in value['completed']]==prefix,'PHASE_COMPLETED_PREFIX')
    a.require(all(a.hex_string(v[k],64) for v in value['completed'] for k in ('requestSha256','receiptSha256')),'PHASE_PREFIX_PINS')
    base={'kind','releaseSha256','identity','target','stage','checkpointAt','lastReceiptSha256',
          'hostBackupSha256','rdsBackupSha256','holdGeneration','backupId'}
    held={'bindingSha256','holdRawSha256','switchReceiptSha256','heldHealthSha256',
          'restoreReceiptSha256','sqlReceiptSha256','safetyApprovalSha256'}
    a.require(set(c)==base|(held if stage=='clear-hold' else set()),'PHASE_CHECKPOINT_FIELDS')
    a.require(c['kind']=='cn-fixed-release-checkpoint-v1' and c['releaseSha256']==release_sha
              and c['identity']==release['identity'] and c['target']==remote.TARGET and c['stage']==stage
              and c['lastReceiptSha256']==value['completed'][-1]['receiptSha256'],'PHASE_CHECKPOINT_BINDING')
    for key in (('lastReceiptSha256','hostBackupSha256','rdsBackupSha256')+tuple(held if stage=='clear-hold' else ())):
        a.require(a.hex_string(c[key],64),'PHASE_CHECKPOINT_PIN')
    a.require(type(c['holdGeneration'])is str and 0<len(c['holdGeneration'])<=128
              and type(c['backupId'])is str and 0<len(c['backupId'])<=128,'PHASE_EPOCH')
    observed=a.timestamp(c['checkpointAt'])
    a.require(a.timestamp(release['identity']['requestedAt'])<=observed<=dt.datetime.now(dt.timezone.utc)
              and observed<=a.timestamp(release['identity']['deadlineAt']),'PHASE_ORIGINAL_CLOCK')
    return c


def paused(root,pin):
    root=Path(root);raw=(root/'pause.json').read_bytes();a.require(a.sha(raw)==pin,'PAUSE_PIN')
    v=a.decode(raw)
    fields={'kind','releaseSha256','candidateSha256','toolRevision','transportApprovalSha256','previousPauseSha256',
            'failedCommandSha256','outputSha256','checkpoint','productionAccepted','automaticApproval','automaticRetry'}
    a.require(set(v)==fields and v['kind']=='fixed-cn-paused-release-v1' and v['productionAccepted']is False
              and v['automaticApproval']is False and v['automaticRetry']is False,'PAUSE_SCHEMA')
    folder=root/'transport';failure_raw=(folder/'failed-command.json').read_bytes();body=(folder/'failed-output.json').read_bytes()
    failure=a.decode(failure_raw);approval=(folder/'approval.json').read_bytes()
    a.require(a.sha(failure_raw)==v['failedCommandSha256'] and a.sha(body)==v['outputSha256']
              and a.sha(approval)==v['transportApprovalSha256'] and failure['approvalSha256']==v['transportApprovalSha256']
              and failure['outputSha256']==v['outputSha256'] and failure['exitCode']==2
              and failure['remoteCommandTerminal']is True and failure['releaseCompleted']is False
              and failure['productionAccepted']is False and failure['automaticRetry']is False,'PAUSE_JOURNAL_BINDING')
    scope=a.decode(approval);intent=a.decode((folder/'intent.json').read_bytes());ack=a.decode((folder/'ack.json').read_bytes())
    a.require(scope['entryApprovalSha256']==v['releaseSha256'] and scope['candidateSha256']==v['candidateSha256']
              and scope['toolRevision']==v['toolRevision'] and scope['previousReceiptSha256']==v['previousPauseSha256']
              and intent['previousReceiptSha256']==v['previousPauseSha256'] and intent['approvalSha256']==v['transportApprovalSha256']
              and failure['invokeId']==ack['InvokeId'] and failure['commandId']==ack['CommandId'],'PAUSE_SCOPE_BINDING')
    a.require(a.decode(body)['checkpoint']==v['checkpoint'],'PAUSE_ORIGINAL_CHECKPOINT')
    return v,body


def begin(packet,plan_raw,plan_sha,release_raw,release_sha,provenance_raw,migration_raw,rpc,output,
          *,authorization_evidence_raw,previous_pause=None):
    """One explicit call only; return an actual A3/A4 or A5 pause, never resume.

    previous_pause is (existing cloud journal directory, independent pause pin).
    It is accepted only for a known pre-switch pause and a new approved packet.
    """
    release,_,driver=receipts.release_authorities(release_raw,release_sha,plan_raw,plan_sha,provenance_raw,migration_raw)
    policy(release);previous=None;old=None
    if previous_pause is not None:
        old,_=paused(*previous_pause);previous=previous_pause[1]
        a.require(Path(previous_pause[0])==Path(release['orchestrationJournalRoot'])/old['transportApprovalSha256'],'PHASE_JOURNAL_LOCATION')
        a.require(old['releaseSha256']==release_sha and old['checkpoint']['stage']=='switch-stage','PHASE_CONTINUATION_SCOPE')
    raw,pin=packet;approved,_=remote.admit(raw,pin,plan_raw,plan_sha,previous)
    a.require(approved['operation']=='release-run' and approved['sequence']==0
              and approved['entryApprovalSha256']==release_sha and approved['toolRevision']==release['toolRevision']
              and approved['candidateSha256']==release['acquire']['requests']['consume']['inputs']['set'],'PHASE_APPROVED_SCOPE')
    a.require(old is None or pin!=old['transportApprovalSha256'],'PHASE_NO_PACKET_REPLAY')
    if old:
        prior_failure=a.decode((Path(previous_pause[0])/'transport/failed-command.json').read_bytes())
        old_raw=(Path(previous_pause[0])/'transport/approval.json').read_bytes()
        old_scope,_=remote.admit(old_raw,old['transportApprovalSha256'],plan_raw,plan_sha,old['previousPauseSha256'],now=a.timestamp(prior_failure['providerFinishedAt']))
        a.require(old_scope['principalArn']==approved['principalArn'],'PHASE_PRINCIPAL_CHANGED')
        a.require(a.timestamp(approved['issuedAt'])>=a.timestamp(prior_failure['providerFinishedAt']),'PHASE_APPROVAL_BEFORE_PREDECESSOR')
    a.require(dt.datetime.now(dt.timezone.utc)<a.timestamp(release['expiresAt']),'PHASE_RELEASE_EXPIRED')
    remote.entry_authority(approved,release_raw,plan_raw,plan_sha);remote.authorization_evidence(approved,authorization_evidence_raw)
    a.require(rpc.principal_arn==approved['principalArn'],'REMOTE_PRINCIPAL_MISMATCH')
    root=Path(output)
    a.require(root==Path(release['orchestrationJournalRoot'])/pin,'PHASE_CANONICAL_OUTPUT_REQUIRED')
    root.mkdir(mode=0o700,parents=False,exist_ok=False)
    try:
        remote.execute(raw,pin,plan_raw,plan_sha,previous,rpc,root/'transport',
            entry_approval_raw=release_raw,authorization_evidence_raw=authorization_evidence_raw)
    except remote.CommandFailed as error:
        a.require(error.exit_code==2,'PHASE_NOT_AN_APPROVAL_WAIT')
        return save_pause(root,approved,pin,release,release_sha,driver,error.output,previous,old)
    raise a.Rejected('PHASE_EXPECTED_PAUSE_NOT_COMPLETION')


def save_pause(root,approved,pin,release,release_sha,driver,body,previous,old=None):
    value=a.decode(body)
    a.require(value['status'] in ('WAITING_FOR_A3_A4_EVIDENCE','WAITING_FOR_WRITER_APPROVAL'),'PHASE_NOT_AN_APPROVAL_WAIT')
    c=checkpoint(value,release,release_sha,driver)
    failure=a.decode((root/'transport/failed-command.json').read_bytes())
    a.require(a.timestamp(failure['providerStartedAt'])<=a.timestamp(c['checkpointAt'])
              <=a.timestamp(failure['providerFinishedAt']),'PHASE_CHECKPOINT_NOT_FROM_INVOCATION')
    a.require(previous is None or old is not None,'PHASE_PREDECESSOR_CONTEXT_REQUIRED')
    if old:
        a.require(all(c[k]==old['checkpoint'][k] for k in ('hostBackupSha256','rdsBackupSha256','holdGeneration','backupId'))
                  and a.timestamp(c['checkpointAt'])>=a.timestamp(old['checkpoint']['checkpointAt']),'PHASE_EPOCH_CHANGED')
    result=dict(kind='fixed-cn-paused-release-v1',releaseSha256=release_sha,
        candidateSha256=approved['candidateSha256'],toolRevision=approved['toolRevision'],transportApprovalSha256=pin,
        previousPauseSha256=previous,failedCommandSha256=a.sha((root/'transport/failed-command.json').read_bytes()),
        outputSha256=a.sha(body),checkpoint=c,productionAccepted=False,automaticApproval=False,automaticRetry=False)
    encoded=a.json_bytes(result);path=root/'pause.json'
    if path.exists():a.require(path.read_bytes()==encoded,'PAUSE_EXISTING_BYTES_CHANGED')
    else:remote.save(root,'pause.json',encoded)
    return encoded


def recover(packet,plan_raw,plan_sha,release_raw,release_sha,provenance_raw,migration_raw,rpc,output,
            *,previous_pause=None,max_seconds=30):
    """Read existing acknowledged invocation only; never submits or advances."""
    release,_,driver=receipts.release_authorities(release_raw,release_sha,plan_raw,plan_sha,provenance_raw,migration_raw)
    policy(release);raw,pin=packet;root=Path(output)
    a.require(root==Path(release['orchestrationJournalRoot'])/pin,'PHASE_CANONICAL_OUTPUT_REQUIRED')
    a.require((root/'transport/approval.json').read_bytes()==raw,'PHASE_RECOVERY_PACKET')
    previous=a.decode((root/'transport/intent.json').read_bytes())['previousReceiptSha256'];old=None
    historical,_=remote.admit(raw,pin,plan_raw,plan_sha,previous,now=a.timestamp(a.decode(raw)['issuedAt']))
    remote.entry_authority(historical,release_raw,plan_raw,plan_sha)
    a.require(historical['operation']=='release-run' and historical['sequence']==0
              and historical['toolRevision']==release['toolRevision'],'PHASE_APPROVED_SCOPE')
    if previous_pause is not None:
        old,_=paused(*previous_pause)
        a.require(previous==previous_pause[1] and old['releaseSha256']==release_sha
                  and old['checkpoint']['stage']=='switch-stage','PHASE_CONTINUATION_SCOPE')
    a.require(previous is None or old is not None,'PHASE_PREDECESSOR_CONTEXT_REQUIRED')
    try:remote.reconcile(root/'transport',rpc,pin,max_seconds=max_seconds)
    except remote.CommandFailed as error:
        a.require(error.exit_code==2,'PHASE_NOT_AN_APPROVAL_WAIT')
        approved,_=remote.admit(raw,pin,plan_raw,plan_sha,previous,now=a.timestamp(error.finished_at))
        return save_pause(root,approved,pin,release,release_sha,driver,error.output,previous,old)
    raise a.Rejected('PHASE_EXPECTED_PAUSE_NOT_COMPLETION')


def resume(packets,preparation,plan_raw,plan_sha,release_raw,release_sha,writer_raw,writer_sha,
           provenance_raw,migration_raw,rpc,output,*,authorization_evidence_raw):
    """Explicit separately approved same-root continuation; no new clocks/hashes."""
    a.require(len(packets)==3,'THREE_APPROVED_PACKETS_REQUIRED')
    prior,body=paused(*preparation)
    release,_,writer,_,_,driver=receipts.authorities(release_raw,release_sha,writer_raw,writer_sha,
        plan_raw,plan_sha,provenance_raw,migration_raw)
    policy(release)
    a.require(Path(preparation[0])==Path(release['orchestrationJournalRoot'])/prior['transportApprovalSha256'],'PHASE_JOURNAL_LOCATION')
    a.require(Path(output)==Path(release['orchestrationJournalRoot'])/packets[0][1],'PHASE_CANONICAL_OUTPUT_REQUIRED')
    c=checkpoint(a.decode(body),release,release_sha,driver)
    a.require(prior['releaseSha256']==release_sha and c['stage']=='clear-hold'
              and prior['toolRevision']==release['toolRevision']
              and prior['candidateSha256']==release['acquire']['requests']['consume']['inputs']['set'],'RESUME_HELD_PHASE_REQUIRED')
    for key in ('bindingSha256','switchReceiptSha256','heldHealthSha256','holdRawSha256','holdGeneration'):
        a.require(writer[key]==c[key],'RESUME_ACTUAL_HELD_HASH_REQUIRED')
    failure=a.decode((Path(preparation[0])/'transport/failed-command.json').read_bytes())
    prior_raw=(Path(preparation[0])/'transport/approval.json').read_bytes()
    prior_scope,_=remote.admit(prior_raw,prior['transportApprovalSha256'],plan_raw,plan_sha,prior['previousPauseSha256'],now=a.timestamp(failure['providerFinishedAt']))
    a.require(prior_scope['principalArn']==rpc.principal_arn,'RESUME_PRINCIPAL_CHANGED')
    a.require(a.timestamp(writer['issuedAt'])>=max(a.timestamp(c['checkpointAt']),a.timestamp(failure['providerFinishedAt'])),'RESUME_APPROVAL_BEFORE_HOLD')
    a.require(len(packets)==3 and packets[0][1]!=prior['transportApprovalSha256'],'RESUME_FRESH_PACKET_REQUIRED')
    for raw,_ in packets:
        approved=a.decode(raw)
        a.require(approved['toolRevision']==prior['toolRevision'],'RESUME_TOOL_REVISION_CHANGED')
        a.require(a.timestamp(approved['issuedAt'])>=a.timestamp(writer['issuedAt']),'RESUME_TRANSPORT_BEFORE_WRITER')
    return receipts.run_approved_pipeline(packets,plan_raw,plan_sha,release_raw,release_sha,writer_raw,writer_sha,
        provenance_raw,migration_raw,rpc,output,authorization_evidence_raw=authorization_evidence_raw,
        _initial_previous=preparation[1],_safety_checkpoint=c)
