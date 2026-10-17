"""Strict consumption of approved remote results and existing canonical A6 receipts.

No journey, approval creation or production call. Root business observer remains
responsible for actual login/SSE/ASR/GitHub/skill/PDF and terminal readback.
"""
import datetime as dt
import importlib.util
from pathlib import Path
import re
import cn_image_archive as a
import fixed_cn_remote as remote


def remote_result(receipt_raw, output_raw, approval_raw, approval_sha, plan_raw, plan_sha, previous):
    v=a.decode(receipt_raw)
    completed=a.timestamp(v['completedAt'])
    a.require(completed<=dt.datetime.now(dt.timezone.utc),'REMOTE_RECEIPT_TIME')
    policy,_=remote.admit(approval_raw,approval_sha,plan_raw,plan_sha,previous,now=completed)
    fields={'kind','source','control','run','target','principalArn','operation','sequence','approvalSha256','entryApprovalSha256',
            'candidateSha256','previousReceiptSha256','invokeId','commandId','outputSha256',
            'completedAt','remoteCommandTerminal','productionAccepted','automaticRetry'}
    a.require(set(v)==fields and v['kind']=='fixed-cn-remote-stage-v1','REMOTE_RECEIPT_FIELDS')
    expected={'source':remote.FIXED.SOURCE,'control':remote.FIXED.CONTROL,'run':remote.FIXED.RUN,
              'target':remote.TARGET,'principalArn':policy['principalArn'],'operation':policy['operation'],'sequence':policy['sequence'],'approvalSha256':approval_sha,
              'entryApprovalSha256':policy['entryApprovalSha256'],'candidateSha256':policy['candidateSha256'],
              'previousReceiptSha256':previous,'outputSha256':a.sha(output_raw)}
    a.require(all(v[k]==value for k,value in expected.items()),'REMOTE_RECEIPT_BINDING')
    a.require(v['remoteCommandTerminal'] is True and v['productionAccepted'] is False
              and v['automaticRetry'] is False,'REMOTE_RECEIPT_TERMINAL')
    a.require(all(isinstance(v[k],str) and re.fullmatch('[A-Za-z0-9_-]{1,128}',v[k])
                  for k in ('invokeId','commandId')),'REMOTE_RECEIPT_IDS')
    completed=a.timestamp(v['completedAt'])
    a.require(a.timestamp(policy['issuedAt'])<=completed<=a.timestamp(policy['expiresAt'])
              and completed<=dt.datetime.now(dt.timezone.utc),'REMOTE_RECEIPT_TIME')
    return v


def authorities(release_raw, release_sha, writer_raw, writer_sha, plan_raw, plan_sha, provenance_raw, migration_raw):
    a.require(a.sha(plan_raw)==plan_sha,'BUSINESS_PLAN_PIN')
    root=Path(__file__).resolve().parent
    spec=importlib.util.spec_from_file_location('fixed_canonical_driver',root/'cn-release-fixed-driver.py')
    driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
    release=driver.validate(release_sha,release_raw,dt.datetime.now(dt.timezone.utc))
    a.require(not release.get('mvp'),'FULL_BUSINESS_SCOPE_REQUIRED')
    identity=release['identity']
    plan=remote.bundle.c.validate_plan(a.decode(plan_raw))
    a.require(identity['sourceRevision']==remote.FIXED.SOURCE
              and identity['controlRevision']==remote.FIXED.CONTROL
              and identity['publicationAttemptId']==plan['attemptId'],'BUSINESS_FIXED_RELEASE')
    a.require(a.sha(migration_raw)==release['runtime']['staticInputHashes']['migrationDiff'],
              'MIGRATION_EVIDENCE_PIN')
    migration=a.decode(migration_raw)
    a.require(migration['sourceRevision']==identity['sourceRevision']
              and migration['baselineRevision']==identity['baselineRevision']
              and migration['changedFiles']==[] and migration['schemaMigrationRequired'] is False,
              'CANONICAL_NO_MIGRATION_ROUTE_ONLY')
    a.require(a.sha(writer_raw)==writer_sha,'WRITER_APPROVAL_HASH')
    writer=a.decode(writer_raw)
    fields={'kind','scope','releaseSha256','identity','target','issuedAt','expiresAt','bindingSha256',
            'switchReceiptSha256','heldHealthSha256','holdRawSha256','holdGeneration',
            'userAuthorizationEvidenceSha256','testDataScopeSha256','publicOrigin'}
    a.require(set(writer)==fields and writer['kind']=='cn-writer-resume-approval-v1'
              and writer['scope']=='a5-resume-writers-and-a6-scoped-business-observation',
              'WRITER_APPROVAL_SCOPE')
    a.require(writer['identity']==identity and writer['target']==remote.TARGET
              and writer['releaseSha256']==release_sha
              and writer['publicOrigin']=='https://app.boardx.com.cn/','WRITER_APPROVAL_BINDING')
    for key in ('bindingSha256','switchReceiptSha256','heldHealthSha256','holdRawSha256',
                'userAuthorizationEvidenceSha256','testDataScopeSha256'):
        a.require(a.hex_string(writer[key],64),'WRITER_APPROVAL_PIN')
    start,end=a.timestamp(writer['issuedAt']),a.timestamp(writer['expiresAt'])
    a.require(a.timestamp(identity['requestedAt'])<=start<end<=a.timestamp(identity['deadlineAt'])
              and end-start<=dt.timedelta(minutes=30),'WRITER_APPROVAL_WINDOW')
    inputs=release['acquire']['requests']['consume']['inputs']
    a.require(inputs['plan']==plan_sha and a.sha(provenance_raw)==inputs['policy'],'BUSINESS_ACQUIRE_PINS')
    provenance=a.decode(provenance_raw)
    a.require(provenance['runId']==remote.FIXED.RUN and provenance['runAttempt']==1
              and provenance['sourceRevision']==remote.FIXED.SOURCE and provenance['controlRevision']==remote.FIXED.CONTROL,
              'BUSINESS_FIXED_BUILD_RUN')
    a.require(a.hex_string(inputs['set'],64),'BUSINESS_CANDIDATE_PIN')
    return release,identity,writer,start,end,driver


def business(release_raw, release_sha, writer_raw, writer_sha, chain, observed, readback,
             plan_raw, plan_sha, predecessor, provenance_raw, migration_raw):
    """Structural validation only; supplied JSON does not authenticate its origin.

    Each result tuple: (receipt bytes, output bytes, approved packet, packet pin).

    Readback is a distinct approved, read-only invocation of the existing root
    observer; it returns the unchanged original A6 receipt only after verifying
    persisted owned runs and the actual terminal observation.
    """
    release,identity,writer,start,end,driver=authorities(release_raw,release_sha,writer_raw,writer_sha,plan_raw,plan_sha,provenance_raw,migration_raw)
    root_result=remote_result(*chain,plan_raw,plan_sha,predecessor)
    a.require(root_result['operation']=='release-run' and root_result['entryApprovalSha256']==release_sha,
              'BUSINESS_RELEASE_OPERATION')
    completed=a.decode(chain[1])
    a.require(completed['status']=='CHAIN_COMPLETED' and not completed.get('terminalProposal'),
              'FULL_RELEASE_CHAIN_REQUIRED')
    a.require([row['stage'] for row in completed['completed']]==list(driver.e.STAGES),
              'FULL_RELEASE_STAGE_ORDER')
    a.require(all(a.hex_string(row['requestSha256'],64) and a.hex_string(row['receiptSha256'],64)
                  for row in completed['completed']),'FULL_RELEASE_STAGE_PINS')
    a.require(completed['requestedAt']==identity['requestedAt'] and completed['deadlineAt']==identity['deadlineAt'],
              'FULL_RELEASE_CLOCK_CHANGED')
    first=remote_result(*observed,plan_raw,plan_sha,a.sha(chain[0]))
    second=remote_result(*readback,plan_raw,plan_sha,a.sha(observed[0]))
    a.require(first['operation']=='business-readback' and second['operation']=='business-readback'
              and first['entryApprovalSha256']==second['entryApprovalSha256']==release_sha
              and first['candidateSha256']==second['candidateSha256']==root_result['candidateSha256']==release['acquire']['requests']['consume']['inputs']['set']
              and first['invokeId']!=second['invokeId'] and first['approvalSha256']!=second['approvalSha256'],'BUSINESS_REMOTE_OPERATIONS')
    a.require(observed[1]==readback[1],'BUSINESS_ORIGINAL_READBACK_CHANGED')
    value=a.decode(observed[1])
    a.require(value['kind']=='cn-independent-business-acceptance-v1' and value['schemaVersion']==1
              and value['mode']=='observe' and value['runtimeRevision']==remote.FIXED.SOURCE,
              'BUSINESS_CANONICAL_RECEIPT')
    a.require(all(value[k]==v for k,v in identity.items()),'BUSINESS_IDENTITY')
    a.require(set(value['checks'])=={'login','hello','asr','githubFeedbackRead','skillTool','pdfDownload'}
              and all(v is True for v in value['checks'].values()),'BUSINESS_SIX_JOURNEYS')
    a.require(type(value['stableWindowSeconds']) is int and 30<=value['stableWindowSeconds']<=300 and value['stableWindowSeconds']==release['business']['stableWindowSeconds']
              and value['externalWritesTerminal'] is False,'BUSINESS_STABILITY_OR_TERMINAL')
    ids=value['ownedAcceptanceRunIds']
    a.require(len(ids)==3 and len(set(ids))==3 and all(isinstance(v,str)
              and re.fullmatch('[A-Za-z0-9_-]{1,128}',v) for v in ids),'BUSINESS_OWNED_RUNS')
    a.require(len(value['liveObservationSha256'])>=2 and all(a.hex_string(v,64)
              for v in value['liveObservationSha256']) and a.hex_string(value['runtimeInventorySha256'],64),
              'BUSINESS_LIVE_OBSERVATIONS')
    for key in ('bindingSha256','switchReceiptSha256','holdGeneration'):
        a.require(value[key]==writer[key],'BUSINESS_A5_LINK')
    observed_at=a.timestamp(value['observedAt'])
    a.require(start<=observed_at<=end and observed_at<=a.timestamp(first['completedAt'])
              <=a.timestamp(second['completedAt']),'BUSINESS_EXECUTION_WINDOW')
    # This is evidence consumption, not a statement that this development run
    # executed or accepted production. Final production status belongs to A6.
    return dict(kind='fixed-cn-business-evidence-consumed-v1',source=remote.FIXED.SOURCE,
        releaseSha256=release_sha,writerApprovalSha256=writer_sha,
        businessReceiptSha256=a.sha(observed[1]),observationReceiptSha256=a.sha(observed[0]),
        readbackReceiptSha256=a.sha(readback[0]),sixJourneyReceiptFieldsValid=True,
        canonicalReadbackBytesMatch=True,productionAccepted=False)


def run_approved_pipeline(packets, plan_raw, plan_sha, release_raw, release_sha,
                          writer_raw, writer_sha, provenance_raw, migration_raw, rpc, output,
                          *, authorization_evidence_raw=None):
    """Effectful library entry. Explicit approved packets + existing RPC required.

    The existing fixed root driver owns all A0–A6 mutations. Only independent
    readbacks follow it: this adapter never re-runs business journeys or resumes
    writers itself. Neither CLI nor PR workflow invokes this production API.
    """
    a.require(len(packets)==3,'THREE_APPROVED_PACKETS_REQUIRED')
    release,_,_,writer_start,writer_end,_=authorities(release_raw,release_sha,writer_raw,writer_sha,plan_raw,plan_sha,provenance_raw,migration_raw)
    a.require(dt.datetime.now(dt.timezone.utc)<a.timestamp(release['expiresAt']),'ROOT_EXECUTION_APPROVAL_EXPIRED')
    a.require(writer_start<=dt.datetime.now(dt.timezone.utc)<writer_end,'WRITER_EXECUTION_APPROVAL_EXPIRED')
    for index,(raw,pin) in enumerate(packets):
        policy,_=remote.admit(raw,pin,plan_raw,plan_sha,None if index==0 else '0'*64)
        remote.entry_authority(policy,release_raw,plan_raw,plan_sha)
        remote.authorization_evidence(policy,authorization_evidence_raw)
        a.require(policy['principalArn']==rpc.principal_arn,'REMOTE_PRINCIPAL_MISMATCH')
        a.require(policy['sequence']==index and policy['operation']==('release-run' if index==0 else 'business-readback') and policy['entryApprovalSha256']==release_sha
                  and policy['candidateSha256']==release['acquire']['requests']['consume']['inputs']['set'],'PIPELINE_APPROVED_SCOPE')
    root=Path(output);root.mkdir(mode=0o700,parents=False,exist_ok=False)
    results=[];previous=None
    for index,(raw,pin) in enumerate(packets):
        policy,_=remote.admit(raw,pin,plan_raw,plan_sha,previous)
        expected='release-run' if index==0 else 'business-readback'
        a.require(policy['operation']==expected and policy['entryApprovalSha256']==release_sha,
                  'PIPELINE_FIXED_OPERATION')
        receipt,body=remote.execute(raw,pin,plan_raw,plan_sha,previous,rpc,root/str(index),
            entry_approval_raw=release_raw,authorization_evidence_raw=authorization_evidence_raw)
        remote_result(receipt,body,raw,pin,plan_raw,plan_sha,previous)
        if index==0:
            value=a.decode(body)
            a.require(value.get('status')=='CHAIN_COMPLETED' and not value.get('terminalProposal'),'ROOT_CHAIN_NOT_COMPLETED')
            stages=['consume','publication-stage','check-plan','publish','hold-stage','hold','stop-stage','stop','sessions',
                    'backup-stage','backup','rds-backup','switch-stage','switch','acceptance','clear-hold','observe']
            a.require([v['stage'] for v in value['completed']]==stages,'ROOT_STAGE_ORDER')
        results.append((receipt,body,raw,pin));previous=a.sha(receipt)
    result=business(release_raw,release_sha,writer_raw,writer_sha,*results,plan_raw,plan_sha,None,provenance_raw,migration_raw)
    result['providerQueriesPerformed']=True
    remote.save(root,'evidence-consumed.json',a.json_bytes(result))
    return result
