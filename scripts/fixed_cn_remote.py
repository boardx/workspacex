"""Approved fixed-entry Cloud Assistant transport; credential acquisition is external.

No CLI dispatch, IAM, tokens, runners, retries, cancellation or arbitrary shell.
Caller supplies an existing authenticated SDK capability and independently pinned
approval bytes. Existing protected host entries revalidate their own authority.
"""
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import time

import cn_image_archive as a
import fixed_cn_bundle as bundle
import fixed_cn_host_commands as host

FIXED = bundle.fixed
TARGET = {'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':FIXED.TARGET}
OPERATIONS = {'download-check','image-download','publication-check','image-publication',
              'release-run','release-status','release-reconcile','business-readback'}


class CommandFailed(a.Rejected):
    """Verified terminal process failure; it never proves release terminality."""
    def __init__(self, output, exit_code, started_at, finished_at):
        super().__init__('REMOTE_COMMAND_FAILED')
        self.output = output
        self.exit_code = exit_code
        self.started_at = started_at
        self.finished_at = finished_at


def save(root, name, raw):
    with (root/name).open('xb') as f:
        os.chmod(f.name,0o600); f.write(raw); f.flush(); os.fsync(f.fileno())
    fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def command(plan_raw, plan_sha, operation, entry_sha, tool_revision):
    a.require(operation in OPERATIONS and a.hex_string(entry_sha,64), 'REMOTE_OPERATION_OR_APPROVAL')
    if operation in {'download-check','image-download','publication-check','image-publication'}:
        return host.prepare(plan_raw,plan_sha,operation,entry_sha)['argv']
    plan=bundle.c.validate_plan(a.decode(plan_raw))
    a.require(a.sha(plan_raw)==plan_sha and plan['sourceRevision']==FIXED.SOURCE
              and plan['controlRevision']==FIXED.CONTROL, 'REMOTE_FIXED_PLAN')
    if operation.startswith('release-'):
        return ['/usr/local/bin/workspacex-cn-fixed-release',operation[8:],entry_sha]
    a.require(a.hex_string(tool_revision,40), 'BUSINESS_TOOL_REVISION')
    entry='/opt/workspacex-cn/release-tools/'+tool_revision+'/scripts/cn-release-business-observer.py'
    return ['/usr/bin/python3','-I','-S','-B',entry,operation[9:],entry_sha]


def admit(raw, pin, plan_raw, plan_sha, previous, now=None):
    """Consume externally approved transport scope; never mint human approval."""
    a.require(len(raw)<=16384 and a.sha(raw)==pin, 'TRANSPORT_APPROVAL_HASH')
    v=a.decode(raw)
    fields={'kind','source','control','run','target','principalArn','operation','sequence','entryApprovalSha256',
            'toolRevision','planSha256','candidateSha256','previousReceiptSha256',
            'commandSha256','issuedAt','expiresAt','maxSeconds','userAuthorizationEvidenceSha256'}
    a.require(set(v)==fields and v['kind']=='fixed-cn-transport-approval-v1', 'TRANSPORT_APPROVAL_FIELDS')
    a.require(v['source']==FIXED.SOURCE and v['control']==FIXED.CONTROL and v['run']==FIXED.RUN
              and v['target']==TARGET and v['planSha256']==plan_sha, 'TRANSPORT_FIXED_IDENTITY')
    a.require(isinstance(v['principalArn'],str) and v['principalArn'].startswith('acs:ram::1177216024653153:'),'APPROVED_PRINCIPAL_REQUIRED')
    for key in ('entryApprovalSha256','candidateSha256','commandSha256','userAuthorizationEvidenceSha256'):
        a.require(a.hex_string(v[key],64), 'TRANSPORT_PIN_REQUIRED')
    a.require((v['previousReceiptSha256']==previous or (v['operation']=='business-readback' and v['previousReceiptSha256']=='@previous' and a.hex_string(previous,64))) and (previous is None or a.hex_string(previous,64)),
              'TRANSPORT_PREDECESSOR')
    a.require(type(v['sequence']) is int and v['sequence'] in (0,1,2) and ((v['operation']=='business-readback' and v['sequence'] in (1,2)) or (v['operation']!='business-readback' and v['sequence']==0)),'TRANSPORT_SEQUENCE')
    now=now or dt.datetime.now(dt.timezone.utc)
    issued,expiry=a.timestamp(v['issuedAt']),a.timestamp(v['expiresAt'])
    a.require(dt.timedelta(0)<expiry-issued<=dt.timedelta(minutes=30) and issued<=now<expiry,
              'TRANSPORT_APPROVAL_EXPIRED')
    a.require(type(v['maxSeconds']) is int and 1<=v['maxSeconds']<=1800, 'TRANSPORT_TIMEOUT')
    argv=command(plan_raw,plan_sha,v['operation'],v['entryApprovalSha256'],v['toolRevision'])
    a.require(a.sha(a.json_bytes(argv))==v['commandSha256'], 'TRANSPORT_COMMAND_CHANGED')
    return v,argv


def entry_authority(approval, raw, plan_raw, plan_sha):
    """Bind transport annotations to original protected driver approval bytes."""
    a.require(approval['operation'] in {'release-run','release-status','release-reconcile','business-readback'},
              'REMOTE_ENTRY_AUTHORITY_UNSUPPORTED')
    a.require(type(raw) is bytes and len(raw)<=1048576
              and a.sha(raw)==approval['entryApprovalSha256'],'REMOTE_ENTRY_APPROVAL_BYTES')
    value=a.decode(raw);plan=bundle.c.validate_plan(a.decode(plan_raw))
    a.require(value['kind']=='cn-fixed-release-approval-v1' and value['target']==TARGET
              and not value.get('mvp'),'REMOTE_ENTRY_SCOPE')
    identity=value['identity']
    a.require(identity['sourceRevision']==FIXED.SOURCE and identity['controlRevision']==FIXED.CONTROL
              and identity['publicationAttemptId']==plan['attemptId'],'REMOTE_ENTRY_IDENTITY')
    pins=value['acquire']['requests']['consume']['inputs']
    a.require(pins['plan']==plan_sha and pins['set']==approval['candidateSha256'],
              'REMOTE_ENTRY_CANDIDATE_BINDING')


def authorization_evidence(approval, raw):
    a.require(type(raw) is bytes and 0<len(raw)<=1048576
              and a.sha(raw)==approval['userAuthorizationEvidenceSha256'],
              'REMOTE_AUTHORIZATION_EVIDENCE_BYTES')


class EcsRpc:
    """Concrete official SDK adapter; explicit existing credentials, no default chain."""
    def __init__(self, client, request_factory, principal_arn):
        self.client=client; self.request_factory=request_factory; self.principal_arn=principal_arn

    @classmethod
    def from_existing_credential(cls, credential, expected_principal_arn):
        a.require(credential is not None,'EXISTING_CREDENTIAL_REQUIRED')
        a.require(os.environ.get('DEBUG','').lower()!='sdk','AUTH_SDK_DEBUG_FORBIDDEN')
        from aliyunsdkcore.client import AcsClient
        from aliyunsdkcore.request import CommonRequest
        from requests.adapters import HTTPAdapter
        client=AcsClient(region_id='cn-shanghai',credential=credential,auto_retry=False,
                         connect_timeout=5,timeout=10,verify=True,proxy={})
        from cn_candidate_authenticated_oss import pin_session
        pin_session(client.session,'ecs.cn-shanghai.aliyuncs.com',{'POST'})
        client.session.mount('https://',HTTPAdapter(max_retries=0))
        a.require(isinstance(expected_principal_arn,str) and expected_principal_arn.startswith('acs:ram::1177216024653153:'), 'EXPECTED_PRINCIPAL_REQUIRED')
        sts=AcsClient(region_id='cn-shanghai',credential=credential,auto_retry=False,
                      connect_timeout=5,timeout=10,verify=True,proxy={})
        pin_session(sts.session,'sts.cn-shanghai.aliyuncs.com',{'POST'})
        sts.session.mount('https://',HTTPAdapter(max_retries=0))
        q=CommonRequest();q.set_domain('sts.cn-shanghai.aliyuncs.com');q.set_version('2015-04-01')
        q.set_action_name('GetCallerIdentity');q.set_protocol_type('https');q.set_method('POST');q.set_accept_format('json')
        identity_raw=sts.do_action_with_exception(q)
        a.require(len(identity_raw)<=65536,'CALLER_IDENTITY_BOUND')
        identity=a.decode(identity_raw)
        a.require(str(identity.get('AccountId'))==TARGET['accountId'] and identity.get('Arn')==expected_principal_arn,
                  'APPROVED_CALLER_IDENTITY_MISMATCH')
        return cls(client,CommonRequest,expected_principal_arn)

    def call(self, action, params):
        a.require(action in ('RunCommand','DescribeInvocationResults'),'ECS_ACTION_NOT_ADMITTED')
        a.require(params.get('RegionId')=='cn-shanghai' and params.get('InstanceId.1' if action=='RunCommand' else 'InstanceId')==FIXED.TARGET,'ECS_FIXED_TARGET')
        a.require(not any(k.startswith('InstanceId.') and k!='InstanceId.1' for k in params),'ECS_SINGLE_TARGET')
        allowed=({'RegionId','InstanceId.1','Name','Type','ContentEncoding','CommandContent','WorkingDir','Username',
                  'RepeatMode','KeepCommand','EnableParameter','Timeout','ClientToken'} if action=='RunCommand'
                 else {'RegionId','InvokeId','CommandId','InstanceId','ContentEncoding','IncludeHistory','PageSize'})
        a.require(set(params)==allowed,'ECS_PARAMETER_SCOPE')
        if action=='RunCommand':
            a.require(params['Type']=='RunShellScript' and params['Username']=='root' and params['RepeatMode']=='Once'
                      and params['KeepCommand']=='false' and params['EnableParameter']=='false','ECS_OPERATION_SCOPE')
        q=self.request_factory(); q.set_domain('ecs.cn-shanghai.aliyuncs.com')
        q.set_version('2014-05-26'); q.set_action_name(action);q.set_protocol_type('https')
        q.set_method('POST');q.set_accept_format('json')
        for k,v in params.items():q.add_query_param(k,str(v))
        raw=self.client.do_action_with_exception(q)
        a.require(len(raw)<=256*1024,'ECS_RESPONSE_BOUND')
        return a.decode(raw)


def poll(rpc, ack, approval, deadline, *, monotonic=time.monotonic, wait=time.sleep, terminal=None):
    while monotonic()<deadline:
        result=rpc.call('DescribeInvocationResults',dict(RegionId='cn-shanghai',
            InvokeId=ack['InvokeId'],CommandId=ack['CommandId'],InstanceId=FIXED.TARGET,
            ContentEncoding='Base64',IncludeHistory='false',PageSize='1'))
        a.require(monotonic()<deadline,'REMOTE_DEADLINE_UNCERTAIN')
        invocation=result.get('Invocation',{})
        a.require(not result.get('NextToken') and not invocation.get('NextToken'),'REMOTE_PAGINATION')
        rows=invocation.get('InvocationResults',{}).get('InvocationResult',[])
        a.require(len(rows)<=1,'REMOTE_RESULT_AMBIGUOUS')
        if rows:
            row=rows[0]
            a.require(row.get('InstanceId')==FIXED.TARGET and row.get('InvokeId')==ack['InvokeId']
                      and row.get('CommandId')==ack['CommandId'],'REMOTE_RESULT_BINDING')
            status=row.get('InvocationStatus')
            if ((status=='Success' and row.get('InvokeRecordStatus') in ('Success','Finished'))
                    or (status=='Failed' and row.get('InvokeRecordStatus') in ('Failed','Finished'))):
                a.require(type(row.get('ExitCode')) is int
                          and row.get('Dropped')==0,'REMOTE_EXIT_OR_TRUNCATION')
                started,finished=a.timestamp(row['StartTime']),a.timestamp(row['FinishedTime'])
                a.require(a.timestamp(approval['issuedAt'])<=started<=finished<=a.timestamp(approval['expiresAt'])
                          and finished<=dt.datetime.now(dt.timezone.utc),
                          'REMOTE_RESULT_TIME_WINDOW')
                output=base64.b64decode(row['Output'],validate=True)
                a.require(0<len(output)<=65536,'REMOTE_OUTPUT_BOUND')
                if status!='Success' or row['ExitCode']!=0:
                    raise CommandFailed(output,row['ExitCode'],started.isoformat(),finished.isoformat())
                if terminal is not None:terminal['completedAt']=finished.isoformat()
                return output
            a.require(status in ('Pending','Running','Success'),'REMOTE_TERMINAL_FAILURE')
        wait(min(1,max(0,deadline-monotonic())))
    raise a.Rejected('REMOTE_DEADLINE_UNCERTAIN')


def result_receipt(approval,pin,previous,ack,result,completed_at):
    return a.json_bytes(dict(kind='fixed-cn-remote-stage-v1',source=FIXED.SOURCE,control=FIXED.CONTROL,run=FIXED.RUN,
            target=TARGET,principalArn=approval['principalArn'],operation=approval['operation'],sequence=approval['sequence'],approvalSha256=pin,
            entryApprovalSha256=approval['entryApprovalSha256'],candidateSha256=approval['candidateSha256'],
            previousReceiptSha256=previous,invokeId=ack['InvokeId'],commandId=ack['CommandId'],
            outputSha256=a.sha(result),completedAt=completed_at,
            remoteCommandTerminal=True,productionAccepted=False,automaticRetry=False))


def failed_record(approval_sha,ack,error):
    return a.json_bytes(dict(status='COMMAND_FAILED',approvalSha256=approval_sha,
        invokeId=ack['InvokeId'],commandId=ack['CommandId'],exitCode=error.exit_code,
        outputSha256=a.sha(error.output),providerStartedAt=error.started_at,providerFinishedAt=error.finished_at,
        remoteCommandTerminal=True,releaseCompleted=False,productionAccepted=False,
        automaticRetry=False,requiresIndependentReview=True))


def execute(raw, pin, plan_raw, plan_sha, previous, rpc, output, *, entry_approval_raw=None,
            authorization_evidence_raw=None,monotonic=time.monotonic, wait=time.sleep):
    approval,argv=admit(raw,pin,plan_raw,plan_sha,previous)
    entry_authority(approval,entry_approval_raw,plan_raw,plan_sha)
    authorization_evidence(approval,authorization_evidence_raw)
    a.require(rpc.principal_arn==approval['principalArn'],'REMOTE_PRINCIPAL_MISMATCH')
    root=Path(output);root.mkdir(mode=0o700,parents=False,exist_ok=False)
    seconds=min(approval['maxSeconds'],int((a.timestamp(approval['expiresAt'])-dt.datetime.now(dt.timezone.utc)).total_seconds()))
    a.require(seconds>=1,'REMOTE_APPROVAL_EXPIRED')
    payload=dict(RegionId='cn-shanghai',**{'InstanceId.1':FIXED.TARGET},Name='fixed-cn-'+pin[:24],
        Type='RunShellScript',ContentEncoding='PlainText',CommandContent='#!/bin/sh\nset -eu\nexec '+shlex.join(argv)+'\n',
        WorkingDir='/',Username='root',RepeatMode='Once',KeepCommand='false',EnableParameter='false',
        Timeout=str(seconds),ClientToken=pin)
    deadline=monotonic()+seconds
    save(root,'approval.json',raw)
    save(root,'entry-approval.json',entry_approval_raw)
    save(root,'intent.json',a.json_bytes(dict(approvalSha256=pin,payload=payload,previousReceiptSha256=previous,
                                            automaticRetry=False)))
    try:
        # Exactly one mutation. Lost response remains uncertain, never resubmitted.
        ack=rpc.call('RunCommand',payload)
        a.require(all(isinstance(ack.get(k),str) and re.fullmatch('[A-Za-z0-9_-]{1,128}',ack[k])
                      for k in ('InvokeId','CommandId')),'REMOTE_ACK')
        save(root,'ack.json',a.json_bytes({k:ack[k] for k in ('InvokeId','CommandId')}))
        terminal={}
        result=poll(rpc,ack,approval,deadline,monotonic=monotonic,wait=wait,terminal=terminal)
        save(root,'output.json',result)
        encoded=result_receipt(approval,pin,previous,ack,result,terminal['completedAt'])
        save(root,'receipt.json',encoded)
        return encoded,result
    except CommandFailed as error:
        # Root driver deliberately exits 2 for WAITING_FOR_WRITER_APPROVAL.
        # Retain the exact bounded stdout without issuing a success receipt or
        # treating process exit as proof that all release effects are terminal.
        save(root,'failed-output.json',error.output)
        save(root,'failed-command.json',failed_record(pin,ack,error))
        raise
    except BaseException as error:
        save(root,'uncertain.json',a.json_bytes(dict(status='RECONCILE_REQUIRED',automaticRetry=False,
            instruction='Do not replay or cancel. Read existing invocation by persisted ack; absent ack requires independent provider reconciliation.')))
        if isinstance(error,a.Rejected):raise
        raise a.Rejected('REMOTE_TRANSPORT_FAILED_UNCERTAIN') from None


def reconcile(root, rpc, approval_sha, *, max_seconds=30):
    """Read-only existing invocation; never submits, retries or advances stages."""
    root=Path(root);raw=(root/'approval.json').read_bytes()
    a.require(a.sha(raw)==approval_sha,'RECONCILE_APPROVAL_PIN')
    approval=a.decode(raw);ack=a.decode((root/'ack.json').read_bytes())
    a.require(rpc.principal_arn==approval['principalArn'],'RECONCILE_PRINCIPAL')
    a.require(approval['source']==FIXED.SOURCE and approval['control']==FIXED.CONTROL and approval['run']==FIXED.RUN and approval['target']==TARGET,'RECONCILE_SCOPE')
    a.require(type(max_seconds) is int and 1<=max_seconds<=60,'RECONCILE_TIMEOUT')
    intent=a.decode((root/'intent.json').read_bytes())
    a.require(intent['approvalSha256']==approval_sha,'RECONCILE_INTENT_PIN')
    terminal={}
    try:
        result=poll(rpc,ack,approval,time.monotonic()+max_seconds,terminal=terminal)
    except CommandFailed as error:
        for name,value in (('failed-output.json',error.output),('failed-command.json',failed_record(approval_sha,ack,error))):
            path=root/name
            if path.exists():a.require(path.read_bytes()==value,'RECONCILE_EXISTING_BYTES_CHANGED')
            else:save(root,name,value)
        raise
    # Validate historical execution at its actual finish time. This does not
    # reopen the original approval for a new submission or advance any stage.
    entry=a.decode((root/'entry-approval.json').read_bytes())
    a.require(a.sha((root/'entry-approval.json').read_bytes())==approval['entryApprovalSha256']
              and entry['acquire']['requests']['consume']['inputs']['set']==approval['candidateSha256'],
              'RECONCILE_ENTRY_PIN')
    expected=result_receipt(approval,approval_sha,intent['previousReceiptSha256'],ack,result,terminal['completedAt'])
    for name,value in (('output.json',result),('receipt.json',expected)):
        path=root/name
        if path.exists():a.require(path.read_bytes()==value,'RECONCILE_EXISTING_BYTES_CHANGED')
        else:save(root,name,value)
    return result
