#!/usr/bin/env python3
"""Private publication template. Only the root-approval binder invokes generate()."""
import argparse,base64,hashlib,json,os,re,subprocess,sys,tempfile,zlib
from datetime import datetime,timezone
from pathlib import Path
SOURCE=None
ATTEMPT=None
CONTROL=None
PREFIX='workspacex-cn-prod-registry-vpc.cn-shanghai.cr.aliyuncs.com/workspacex-prod'
def sha(b):return hashlib.sha256(b).hexdigest()
def enc(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def need(v):
 if not v:raise ValueError('PUBLICATION_MATERIALIZATION_REJECTED')
def ref(v):
 need(set(v)=={'path','sha256'} and re.fullmatch('[a-f0-9]{64}',v['sha256']))
 p=Path(v['path']);need(p.is_absolute() and not p.is_symlink());b=p.read_bytes();need(0<len(b)<=1048576 and sha(b)==v['sha256']);return b
def params(command,name,timeout):return {'RegionId':'cn-shanghai','InstanceId.1':'i-uf6ga92ewloganobbln6','Type':'RunShellScript','Name':name,'CommandContent':command,'ContentEncoding':'PlainText','Timeout':str(timeout),'WorkingDir':'/','Username':'root','RepeatMode':'Once','KeepCommand':'false','EnableParameter':'false'}
def bounded_parameters(source,name,limit,d):
 now=datetime.now(timezone.utc);deadline=datetime.fromisoformat(d['deadlineAt'].replace('Z','+00:00'));requested=datetime.fromisoformat(d['requestedAt'].replace('Z','+00:00'))
 need(requested<=now<deadline and 0<(deadline-requested).total_seconds()<=1800)
 remaining=int((deadline-now).total_seconds());timeout=min(limit,remaining);need(timeout>=1)
 config=dict(requestedAt=d['requestedAt'],deadlineAt=d['deadlineAt'],maxSeconds=timeout,source=base64.b64encode(source).decode(),sourceSha256=sha(source))
 runtime=Path(__file__).with_name('deadline-runtime.py').read_text().replace('__CONFIG__',repr(config)).encode()
 packed=base64.b64encode(zlib.compress(runtime)).decode()
 command="/usr/bin/python3.12 -I -S -B - <<'CN_DEADLINE'\nimport base64,zlib,hashlib\nb=zlib.decompress(base64.b64decode("+repr(packed)+"))\nassert hashlib.sha256(b).hexdigest()=="+repr(sha(runtime))+"\nexec(compile(b,'<deadline-guard>','exec'))\nCN_DEADLINE\n"
 need(len(command.encode())<=18000)
 return enc(params(command,name,timeout))

def generate(d,raw,repo):
 global SOURCE,CONTROL,ATTEMPT
 identity=d["identity"];SOURCE=identity["sourceRevision"];CONTROL=identity["controlRevision"];ATTEMPT=identity["attemptId"]
 need(set(d)=={'kind','publishAuthorized','issuedAt','expiresAt','release','refs','identity','requestedAt','deadlineAt'} and d['kind']=='cn-reviewed-publication-decision-v1' and d['publishAuthorized'] is True)
 need(set(d['refs'])=={'plan','set','proof','policy','tools','canonical','provider','redis','binaries'})
 b={k:ref(v) for k,v in d['refs'].items()};v={k:json.loads(x) for k,x in b.items()};plan=v['plan']
 need((plan['sourceRevision'],plan['controlRevision'],plan['attemptId'])==(SOURCE,CONTROL,ATTEMPT))
 start,end=(datetime.fromisoformat(d[k].replace('Z','+00:00')) for k in ('issuedAt','expiresAt'));now=datetime.now(timezone.utc)
 need(start<=now<end and 0<(end-start).total_seconds()<=1800 and (end-now).total_seconds()>=1200)
 need(v['tools']['allNineHashesMatch'] is True and v['canonical']['sourceRevision']==SOURCE and v['canonical']['attemptId']==ATTEMPT and set(v['canonical']['installed'])=={'node','canonical-source','canonical-control.json'})
 need(v['binaries']['kind']=='cn-reviewed-publication-binaries-v1')
 need(0<=(now-datetime.fromisoformat(v['binaries']['observedAt'].replace('Z','+00:00'))).total_seconds()<3600)
 need(type(v['binaries']['evidenceRefs']) is list and len(v['binaries']['evidenceRefs'])>0)
 for evidence in v['binaries']['evidenceRefs']:ref(evidence)
 redis=v['redis'];need(redis['IsSuccess'] is True and redis['Code']=='success')
 selected=[x for x in redis['Images'] if x['Tag']=='redis-7-alpine' and x['Status']=='NORMAL'];need(len(selected)==1 and re.fullmatch('[a-f0-9]{64}',selected[0]['Digest']))
 with tempfile.TemporaryDirectory(prefix='cn-publication-') as td:
  names=subprocess.check_output(['git','-C',str(repo),'ls-tree','-r','--name-only',CONTROL,'scripts/','.harness/scripts/vm/'],text=True).splitlines()
  for name in names:
   if (name.startswith('scripts/') and name.count('/')==1 and name.endswith('.py')) or Path(name).name in ('import-cn-image-archives.py','import-cn-image-candidates.py'):
    (Path(td)/Path(name).name).write_bytes(subprocess.check_output(['git','-C',str(repo),'show',CONTROL+':'+name]))
  sys.path.insert(0,td)
  import cn_image_candidate as c,cn_candidate_revalidation as rv,cn_candidate_publication as pub,cn_candidate_host as host,cn_image_archive as archive
  cap=rv.admit(b['proof'],sha(b['proof']),sha(b['policy']),b['policy']);cap.check(plan,b['set'],sha(b['set']),sha(b['plan']))
  need(end<=archive.timestamp(v['policy']['expiresAt']))
  intent=dict(kind='cn-candidate-publication-intent-v2',schemaVersion=2,candidatePlanRawSha256=sha(b['plan']),candidateSetRawSha256=sha(b['set']),candidateIdentity=c.identity(plan),sourceRevision=SOURCE,controlRevision=CONTROL,attemptId=ATTEMPT,release=d['release'],redisImage=PREFIX+'/base-redis@sha256:'+selected[0]['Digest'],registryPrefix=PREFIX,revalidationRawSha256=sha(b['proof']))
  ib=enc(intent);pub.validate_intent(ib,sha(ib),plan,b['set'],sha(b['set']),sha(b['plan']),revalidation=cap)
  provider=v['provider'];evidence={k:provider[k] for k in ('observedAt','accountId','instanceId','region')};evidence.update(namespace='workspacex-prod',providerResponseSha256=sha(b['provider']),repositories={k:dict(repositoryId=x['RepoId'],immutable=x['TagImmutability']) for k,x in provider['repositories'].items()})
  archive.validate_immutable_evidence(provider,evidence)
  approval=dict(kind='cn-candidate-host-revalidated-approval-v1',schemaVersion=1,candidatePlanRawSha256=sha(b['plan']),candidateSetRawSha256=sha(b['set']),publicationIntentRawSha256=sha(ib),issuedAt=d['issuedAt'],expiresAt=d['expiresAt'],publishAuthorized=True,accountId='1177216024653153',ecsInstanceId='i-uf6ga92ewloganobbln6',region='cn-shanghai',instanceId='cri-ttm0916mvdvg4ugx',registryPrefix=PREFIX,immutableRepositories=list(archive.REPOSITORIES.values()),immutableEvidence=evidence,installedToolSha256=v['tools']['files'],canonicalConfigurationSha256=v['canonical']['canonicalConfigurationSha256'],binaries=v['binaries']['binaries'],maxPublishSeconds=1200,sourceRevision=SOURCE,attemptId=ATTEMPT,revalidationRawSha256=sha(b['proof']),revalidationPolicyRawSha256=sha(b['policy']))
  host.validate_approval(approval,SOURCE,ATTEMPT)
  content={'approval.json':enc(approval),'candidate-plan.json':b['plan'],'publication-intent.json':ib,'immutable-provider-response.json':b['provider'],'candidate-revalidation.json':b['proof'],'candidate-revalidation-policy.json':b['policy']}
  root='/etc/workspacex-cn/candidate-publish/'+SOURCE+'/'+ATTEMPT
  config=dict(root=root,inbox='/var/lib/workspacex-cn/candidate-inbox/'+SOURCE+'/'+ATTEMPT,tools=v['tools']['files'],canonicalSha=approval['canonicalConfigurationSha256'],setSha=sha(b['set']),files={k:dict(sha256=sha(x),base64=base64.b64encode(x).decode()) for k,x in content.items()})
  runtime=Path(__file__).with_name('stage-runtime.py').read_text();need(sha(runtime.encode())=='cdf483cbb3880a81ac7bcaf647bb1d5372fbcb61fb5e2a1492ad187fee92c5a7');stage=runtime.replace('__CONFIG__',repr(config)).encode();content['stage.py']=stage
  transport=Path(__file__).with_name('transport-runtime.py').read_bytes()
  compressed=zlib.compress(stage);need(0<len(stage)<=1024**2 and len(compressed)<=1024**2)
  # 5 KiB accommodates the exact-byte transport plus the deadline guard below 18 KiB.
  chunks=[compressed[i:i+5000] for i in range(0,len(compressed),5000)]
  directory='publication-bytes-'+sha(raw)
  configs=[dict(op='chunk',directory=directory,index=i,data=base64.b64encode(x).decode(),size=len(x),sha256=sha(x)) for i,x in enumerate(chunks)]
  configs.append(dict(op='assemble',directory=directory,chunks=[dict(size=len(x),sha256=sha(x)) for x in chunks],compressedSha256=sha(compressed),stageSize=len(stage),stageSha256=sha(stage)))
  steps=[]
  for i,configuration in enumerate(configs):
   code=transport.decode().replace('__CONFIG__',repr(configuration)).encode()
   name=('stage-chunk-%03d'%i) if configuration['op']=='chunk' else 'stage-assemble'
   filename=name+'-parameters.json';content[filename]=bounded_parameters(code,'cn-publication-'+name,120,d)
   steps.append(dict(parameters=filename,sha256=sha(content[filename]),operation=name))
  for op in ('check-plan','publish'):
   argv=['/usr/bin/python3.12','-I','-S','-B','/usr/local/lib/workspacex-cn/import-cn-image-candidates.py','--'+op,SOURCE,ATTEMPT,sha(content['approval.json'])]
   source=('import os\nos.execv('+repr(argv[0])+','+repr(argv)+')\n').encode()
   filename=op+'-parameters.json';content[filename]=bounded_parameters(source,'cn-publication-'+op,1200,d)
   steps.append(dict(parameters=filename,sha256=sha(content[filename]),operation=op))
  content['stage-order.json']=enc(dict(kind='cn-publication-split-stage-v3',decisionSha256=sha(raw),steps=steps,retryAllowed=False,requestedAt=d['requestedAt'],deadlineAt=d['deadlineAt'],independentObserverRequired=True))
  content['receipt.json']=enc(dict(kind='cn-publication-materialization-v1',decisionSha256=sha(raw),files={k:sha(x) for k,x in content.items()},cloudCalls=0))
  return content
