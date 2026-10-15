#!/usr/bin/env python3
"""NEW, separately approved root operation for one immutable cloud policy.

This is not a new mode of the read-only evidence portal. Installation of its
fixed wrapper and limited sudo rule requires its own approval. It copies only
approved existing root inputs and verified provider bytes; no process deploys,
creates credentials, changes permissions or extends the original deadline.
"""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
POLICIES=Path('/etc/workspacex-cn/mvp-cloud-policies')
APPROVALS=Path('/etc/workspacex-cn/release-approvals')
INPUTS=Path('/var/lib/workspacex-cn/release-inputs')
JOURNALS=Path('/var/lib/workspacex-cn/release-generated/mvp-cloud-preparation')

def load(name):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/('cn-release-'+name+'.py'))
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
E=load('mvp-evidence');S=load('mvp-stage-evidence')

def policy(raw,pin,now):
 E.need(E.sha(raw)==pin and re.fullmatch('[a-f0-9]{64}',pin),'POLICY_HASH')
 p=S.parse(raw)
 E.need(p.get('kind')=='cn-mvp-cloud-preparation-policy-v1' and p.get('action')=='install-approved-control-data','EXPLICIT_POLICY_ACTION_REQUIRED')
 E.module().identity(p['identity'])
 start,end=S.instant(p['requestedAt']),S.instant(p['deadlineAt'])
 E.need(0<(end-start).total_seconds()<=1800 and start<=now<end,'ORIGINAL_POLICY_WINDOW')
 target={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}
 E.need(p['target']==target,'POLICY_TARGET')
 return p

def discover(p,github):
 selector=dict(identity=p['identity'],requestedAt=p['requestedAt'],deadlineAt=p['deadlineAt'])
 for stage,workflow in (('build','build-cn-image-candidates.yml'),('transfer','transfer-cn-candidates-via-hongkong.yml')):
  listing=github('/repos/boardx/workspacex/actions/workflows/'+workflow+'/runs?event=workflow_dispatch&branch=main&per_page=100')
  title='cn-mvp-'+p['identity']['releaseId']+'-'+stage
  hits=[r for r in listing['workflow_runs'] if r.get('display_title')==title and S.instant(p['requestedAt'])<=S.instant(r['created_at'])<=S.instant(p['deadlineAt'])]
  E.need(len(hits)==1,'EXACT_UNIQUE_'+stage.upper()+'_RUN_REQUIRED')
  r=github('/repos/boardx/workspacex/actions/runs/'+str(hits[0]['id']))
  E.need(r.get('display_title')==title,'CORRELATION_CHANGED')
  S.run(r,hits[0]['id'],'.github/workflows/'+workflow,p['identity']['controlRevision'])
  E.need(S.instant(p['requestedAt'])<=S.instant(r['created_at'])<=S.instant(r['updated_at'])<=S.instant(p['deadlineAt']),'PROVIDER_ORIGINAL_WINDOW')
  selector[stage+'RunId']=r['id']
 E.selector('approval',selector)
 return selector

def fsync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)

def save(path,raw):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 fsync(path.parent)

def publication(p,selector,files,input_objects):
 """Return exact writes after validating all bytes; no writes in this function."""
 approval_raw=files['approval.json'];a=S.parse(approval_raw);release=E.sha(approval_raw)
 E.need(a['target']==p['target'] and a['codeFiles']==p['codeFiles'],'PREPARED_APPROVAL_SCOPE')
 E.need(all(a['identity'][k]==p['identity'][k]for k in ('sourceRevision','controlRevision'))
  and all(a['identity'][k]==p[k]for k in ('requestedAt','deadlineAt')),'PREPARED_APPROVAL_IDENTITY')
 E.need(a['mvp']['contentManifestSha256']==p['identity']['contentManifestSha256'] and all(a['mvp'][k]==selector[k]for k in ('buildRunId','transferRunId')),'PREPARED_APPROVAL_RUNS')
 root_inputs={}
 for name,pin in p['rootInputPins'].items():
  E.need(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9-]{0,95}\.json',name),'ROOT_INPUT_NAME')
  raw=input_objects[pin];E.need(E.sha(raw)==pin,'ROOT_INPUT_BYTES')
  root_inputs[name]=raw
 for name,source in {'plan.json':'candidate-plan.json','set.json':'candidate-set.json','proof.json':'proof.json','policy.json':'policy.json'}.items():
  E.need(name not in root_inputs,'PROVIDER_INPUT_COLLISION');root_inputs[name]=files[source]
 required={'authorization.json','template.json','migrationDiff.json','writer-authorization.json','test-data-scope.json',
  'mvp-profile.json','mvp-schema-request.json','mvp-content-request.json','mvp-content-backup.json','mvp-nonmodel-fixtures.json',
  'mvp-nonmodel-credentials.json','mvp-existing-environment.json','mvp-runtime-manifest.json'}
 E.need(required<=set(root_inputs),'COMPLETE_ROOT_INPUTS_REQUIRED')
 # These two objects are approved references, never credential payloads.
 # Preparation must not resolve or open their existing private targets.
 private=load('mvp-private-input')
 for name,purpose in (('mvp-existing-environment.json','migration-environment'),('mvp-nonmodel-credentials.json','nonmodel-credentials')):
  private.validate_ref(root_inputs[name],purpose)
 static=a['runtime']['staticInputHashes']
 E.need(set(static)=={'authorization','template','migrationDiff'} and all(E.sha(root_inputs[name+'.json'])==h for name,h in static.items()),'APPROVAL_STATIC_INPUT_HASHES')
 E.need(root_inputs['test-data-scope.json']==root_inputs['mvp-nonmodel-fixtures.json'],'WRITER_FIXTURE_SCOPE')
 E.need(E.sha(root_inputs['test-data-scope.json'])==a['business']['testDataScopeSha256']==a['mvp']['stageInputs']['nonmodelFixturesSha256'],'APPROVAL_WRITER_SCOPE_PIN')
 E.need(E.sha(root_inputs['mvp-content-request.json'])==p['identity']['contentManifestSha256'],'CONTENT_MANIFEST_IDENTITY')
 package,report=load('mvp-evidence-materializer').prepare('approval',selector,
  {'approval':approval_raw,'binding':E.encode(selector)},installed_approval=approval_raw)
 return release,root_inputs,package,report

def execute(pin,*,reader=E.private,clock=lambda:dt.datetime.now(dt.timezone.utc),github=None):
 """Root-policy capability only; neither runner booleans nor paths grant this."""
 E.need(type(pin)is str and re.fullmatch('[a-f0-9]{64}',pin),'POLICY_HASH')
 raw=reader(POLICIES/(pin+'.json'));p=policy(raw,pin,clock())
 E.need('scripts/cn-release-mvp-private-input.py' in p['codeFiles'],'PRIVATE_INPUT_HELPER_PIN_REQUIRED')
 for name,h in p['codeFiles'].items():
  rel=Path(name);E.need(not rel.is_absolute() and '..'not in rel.parts,'CODE_PATH')
  E.need(E.sha(reader(ROOT/rel))==h,'POLICY_CODE_PIN')
 collector=load('mvp-trusted-collector')
 profile=S.parse(reader(POLICIES/'objects'/(p['rootInputPins']['mvp-profile.json']+'.json')))
 host=profile['githubProvider']
 E.need(set(host)=={'ghExecutable','ghSha256','authentication'} and host['authentication']=='existing-root-gh'
  and all(host[k]==p['githubPolicy'][k]for k in ('ghExecutable','ghSha256')),'APPROVED_EXISTING_HOST_PROVIDER_REQUIRED')
 provider=github or collector.protected_github(host)
 selector=discover(p,provider)
 probe=reader(POLICIES/'objects'/(p['probeSha256']+'.json'))
 prepared,preparation=load('mvp-approval-prepare').derive_from_policy(raw,selector,probe,github=provider)
 # A runtime manifest can exceed ordinary 64KiB metadata; use the original
 # advance reader with private ownership checks for approved objects only.
 entry=load('fixed-driver').e
 objects={h:(reader(POLICIES/'objects'/(h+'.json')) if name!='mvp-runtime-manifest.json'
  else entry.read(POLICIES/'objects'/(h+'.json'),33554432)) for name,h in p['rootInputPins'].items()}
 release,inputs,package,report=publication(p,selector,prepared,objects)
 # Do not start a write when any fixed installation directory is absent.
 for parent in (APPROVALS,INPUTS,JOURNALS,E.ROOT,E.ROOT/'objects',E.ROOT/'selectors'):entry.directory(parent)
 policy(raw,pin,clock())
 journal=JOURNALS/pin;journal.mkdir(mode=0o700);fsync(JOURNALS)
 save(journal/'intent.json',E.encode({'policySha256':pin,'releaseSha256':release,'selector':selector,'automaticRetry':False}))
 # Partial publication never retries: exclusive intent preserves unknown state.
 destination=INPUTS/release;destination.mkdir(mode=0o700);fsync(INPUTS)
 for name,data in inputs.items():save(destination/name,data)
 policy(raw,pin,clock());save(APPROVALS/(release+'.json'),prepared['approval.json'])
 # Selector is published last. The existing read-only portal never observes a
 # selector advertising an incomplete object closure or missing approval.
 for name,data in package.items():
  if not name.startswith('selectors/'):save(E.ROOT/name,data)
 policy(raw,pin,clock())
 for name,data in package.items():
  if name.startswith('selectors/'):save(E.ROOT/name,data)
 result={'kind':'cn-mvp-approved-cloud-preparation-v1','policySha256':pin,'releaseSha256':release,
  'selectorSha256':report['selectorSha256'],'installed':True,'productionStarted':False,'retryAllowed':False,
  'deadlineAt':p['deadlineAt'],'newCredentialsCreated':False,'securityPermissionsChanged':False}
 save(journal/'result.json',E.encode(result));return result

def terminal(pin,*,reader=E.private,clock=lambda:dt.datetime.now(dt.timezone.utc)):
 """Separately explicit publication after actual production workflow succeeds.

    This performs fresh trusted validation; internal in-progress proposals and
    runner-provided success flags cannot install terminal evidence.
    """
 E.need(type(pin)is str and re.fullmatch('[a-f0-9]{64}',pin),'POLICY_HASH')
 raw=reader(POLICIES/(pin+'.json'));p=policy(raw,pin,clock())
 for name,h in p['codeFiles'].items():
  rel=Path(name);E.need(not rel.is_absolute() and '..'not in rel.parts,'CODE_PATH')
  E.need(E.sha(reader(ROOT/rel))==h,'POLICY_CODE_PIN')
 prepared=S.parse(reader(JOURNALS/pin/'result.json'))
 E.need(prepared['policySha256']==pin and prepared['installed']is True and prepared['productionStarted']is False,'ORIGINAL_APPROVED_PREPARATION_REQUIRED')
 release=prepared['releaseSha256'];producer=load('mvp-original-producer')
 payload,bundles,objects=producer.collect(release,reader=reader)
 E.need(payload['identity']==p['identity'] and all(payload[k]==p[k]for k in ('requestedAt','deadlineAt')),'TERMINAL_POLICY_SCOPE')
 provenance=load('mvp-trusted-collector').verify(payload,bundles,objects,reader=reader)
 E.need(provenance['releaseSha256']==release and provenance['authenticatedProviderReadbackVerified']is True
  and provenance['historicalRootAdmissionVerified']is True,'FINAL_COMPLETED_PROVENANCE_REQUIRED')
 # Build the public terminal object only from genuine retained originals.
 b=E.module();receipts=[];previous=None
 for stage in b.STAGES:
  row=dict(stage=stage,identity=payload['identity'],status='SUCCEEDED',previousReceiptSha256=previous,evidenceSha256=E.sha(bundles[stage]))
  if stage=='acceptance':row.update(checks={k:'PASSED'for k in b.CHECKS},modelQuality='SKIPPED',futureV2Content='NOT_APPLICABLE')
  receipts.append(row);previous=E.sha(E.encode(row))
 originals={'binding':E.encode(payload),'receipts':E.encode(receipts)}
 originals.update({'evidence-'+stage:data for stage,data in bundles.items()})
 originals.update({'original-'+h:data for h,data in objects.items()})
 package,report=load('mvp-evidence-materializer').prepare('terminal',payload,originals)
 entry=load('fixed-driver').e
 for parent in (JOURNALS/pin,E.ROOT,E.ROOT/'objects',E.ROOT/'selectors'):entry.directory(parent)
 policy(raw,pin,clock())
 journal=JOURNALS/pin/'terminal';journal.mkdir(mode=0o700);fsync(journal.parent)
 save(journal/'intent.json',E.encode({'policySha256':pin,'releaseSha256':release,'productionRunId':payload['productionRunId'],'retryAllowed':False}))
 def retained(name,data):
  path=E.ROOT/name
  if path.exists():E.need(reader(path)==data,'TERMINAL_EXISTING_BYTES_CONFLICT')
  else:save(path,data)
 for name,data in package.items():
  if not name.startswith('selectors/'):retained(name,data)
 policy(raw,pin,clock())
 for name,data in package.items():
  if name.startswith('selectors/'):retained(name,data)
 result={'kind':'cn-mvp-approved-terminal-publication-v1','policySha256':pin,'releaseSha256':release,'selectorSha256':report['selectorSha256'],
  'productionRunId':payload['productionRunId'],'installed':True,'productionWrites':False,'retryAllowed':False,'fullBusinessAcceptance':False}
 save(journal/'result.json',E.encode(result));return result

if __name__=='__main__':
 import sys
 try:
  E.need(os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1]in ('prepare','terminal'),'NEW_EXPLICIT_ROOT_ENTRY_ONLY')
  result=execute(sys.argv[2])if sys.argv[1]=='prepare'else terminal(sys.argv[2])
  print(E.encode(result).decode());raise SystemExit(0)
 except (ValueError,KeyError,TypeError,OSError):
  print('{"status":"BLOCKED_OR_UNKNOWN","productionStarted":false,"retryAllowed":false}');raise SystemExit(20)
