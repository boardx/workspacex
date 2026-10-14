#!/usr/bin/env python3
"""Single dispatch with durable intent, exact correlation, read-only reconciliation."""
import argparse, datetime, hashlib, json, os, re, subprocess, time
from pathlib import Path
WORKFLOWS={'build':'build-cn-image-candidates.yml','transfer':'transfer-cn-candidates-via-hongkong.yml','production':'release-cn-fixed.yml'}
WORKFLOWS.update(approval='cn-release-mvp-bridge.yml',terminal='cn-release-mvp-bridge.yml')
WORKFLOWS.update(prepare='cn-release-mvp-approved-preparation.yml')
WORKFLOWS.update(finalize='cn-release-mvp-approved-preparation.yml')
def need(ok,reason):
 if not ok:raise ValueError(reason)
def api(path,payload=None):
 args=['gh','api','--hostname','github.com',path]
 if payload is not None:args+=['--method','POST','--input','-']
 r=subprocess.run(args,input=None if payload is None else json.dumps(payload).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30)
 need(r.returncode==0,'DISPATCH_UNKNOWN'if payload is not None else 'PROVIDER_READ_FAILED')
 return json.loads(r.stdout)if r.stdout else None
def instant(s):
 value=datetime.datetime.fromisoformat(s.replace('Z','+00:00'));need(value.tzinfo is not None,'TIMEZONE');return value
def coordinate(request,state,provider=api,clock=lambda:datetime.datetime.now(datetime.timezone.utc),pause=time.sleep):
 need(request['stage']in WORKFLOWS,'STAGE');need(re.fullmatch('[a-f0-9]{40}',request['controlRevision']),'CONTROL')
 need(re.fullmatch('[a-z0-9][a-z0-9-]{0,79}',request['releaseId']),'RELEASE_ID')
 start,end=instant(request['requestedAt']),instant(request['deadlineAt']);need(0<(end-start).total_seconds()<=1800,'BUDGET')
 token='cn-mvp-'+request['releaseId']+'-'+request['stage'];inputs=dict(request['inputs']);inputs['chain_id']=token
 raw=json.dumps(request,sort_keys=True,separators=(',',':')).encode();pin=hashlib.sha256(raw).hexdigest()
 state=Path(state)
 if state.exists():need(json.loads(state.read_bytes())['requestSha256']==pin,'INTENT_CONFLICT')
 else:
  need(start<=clock()<end,'DEADLINE')
  with state.open('x')as f:json.dump(dict(requestSha256=pin,correlation=token,status='DISPATCH_INTENT'),f);f.flush();os.fsync(f.fileno())
  try:provider('/repos/boardx/workspacex/actions/workflows/'+WORKFLOWS[request['stage']]+'/dispatches',{'ref':'main','inputs':inputs})
  except (ValueError,subprocess.TimeoutExpired):pass # Read only from here, never retry an uncertain POST.
 while clock()<end:
  rows=provider('/repos/boardx/workspacex/actions/workflows/'+WORKFLOWS[request['stage']]+'/runs?event=workflow_dispatch&branch=main&per_page=100')
  hits=[r for r in rows.get('workflow_runs',[])if r.get('display_title')==token and instant(r['created_at'])>=start]
  need(len(hits)<=1,'AMBIGUOUS_RUN')
  if hits:
   r=hits[0];need(r.get('head_sha')==request['controlRevision'] and r.get('run_attempt')==1 and r.get('event')=='workflow_dispatch' and r.get('head_branch')=='main','RUN_IDENTITY')
   if r.get('status')=='completed':
    need(r.get('conclusion')=='success','CHILD_FAILED')
    return dict(kind='cn-mvp-child-run-v1',stage=request['stage'],runId=r['id'],runAttempt=1,controlRevision=r['head_sha'],status='SUCCEEDED',correlation=token)
  pause(min(10,max(0,(end-clock()).total_seconds())))
 raise ValueError('UNKNOWN_RECONCILE_REQUIRED')
def main():
 p=argparse.ArgumentParser();p.add_argument('--request',required=True);p.add_argument('--state',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 try:
  result=coordinate(json.loads(Path(a.request).read_bytes()),a.state)
  with Path(a.output).open('x')as f:json.dump(result,f,sort_keys=True);f.write('\n')
  return 0
 except (ValueError,KeyError,OSError,subprocess.TimeoutExpired)as e:
  code=str(e) if isinstance(e,ValueError) and re.fullmatch('[A-Z][A-Z0-9_]{0,100}',str(e)) else 'INPUT_OR_EXECUTION_FAILED'
  print(json.dumps(dict(status='BLOCKED_OR_UNKNOWN',reason=code,retryAllowed=False)));return 2
if __name__=='__main__':raise SystemExit(main())
