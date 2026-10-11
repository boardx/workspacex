#!/usr/bin/env python3
"""Offline consume/publication materialization from a root-owned exact approval.

No acquisition, cloud call, image download, proof generation or dispatch. The
CLI has no approval-path override. Root installation and execution are separate.
"""
import argparse
import base64
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / '.harness/scripts/vm/cn-runtime-continuation/acquire'
spec = importlib.util.spec_from_file_location('phase_bind', ROOT/'scripts/cn-release-continuation-bind.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
sha, need, parse = b.sha, b.require, b.parse
NAMES = ('consumer.py', 'consume-launcher.py', 'materialize-publication.py', 'stage-runtime.py')
COMMON = {'plan','set','proof','policy'}
PUB = COMMON | {'tools','canonical','provider','redis','binaries'}
ENV = {'PATH':'/usr/bin:/bin', 'LANG':'C.UTF-8', 'GIT_NO_LAZY_FETCH':'1', 'GIT_CONFIG_NOSYSTEM':'1'}


def encode(v):
    return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()


def export_control(repo, control, folder):
    """Exact Git bytes, no checkout, no fetch, no untrusted current worktree code."""
    command = ['git','-C',str(repo)]
    names = subprocess.check_output(command+['ls-tree','-r','--name-only',control,'scripts/','.harness/scripts/vm/'],env=ENV,timeout=10,stderr=subprocess.PIPE).decode().splitlines()
    for name in names:
        if (name.startswith('scripts/') and name.count('/')==1 and name.endswith('.py')) or Path(name).name in ('import-cn-image-archives.py','import-cn-image-candidates.py'):
            path=folder/Path(name).name
            need(not path.exists(),'CONTROL_BASENAME_COLLISION')
            path.write_bytes(subprocess.check_output(command+['show',control+':'+name],env=ENV,timeout=10,stderr=subprocess.PIPE))


VALIDATE = '''import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import cn_candidate_revalidation as rv
import cn_image_candidate as c
root=Path(sys.argv[2]);r=json.loads((root/'request.json').read_bytes())
p=(root/'proof.json').read_bytes();q=(root/'policy.json').read_bytes();plan=(root/'plan.json').read_bytes();s=(root/'set.json').read_bytes();h=lambda x:hashlib.sha256(x).hexdigest()
cap=rv.admit(p,r['inputs']['proof'],r['inputs']['policy'],q);v=json.loads(plan)
cap.check(c.validate_plan(v),s,h(s),h(plan))
assert all(v[k]==r[k] for k in ('sourceRevision','controlRevision','attemptId'))
pv=json.loads(p);policy=json.loads(q)
assert all(pv['github'][k]==r[k] for k in ('repositoryId','runId','runAttempt','producerWorkflowSha256'))
assert pv['candidatePlanRawSha256']==h(plan) and pv['candidateSetRawSha256']==h(s)
for name,digest in policy['verifierFiles'].items():assert h((Path(sys.argv[1])/name).read_bytes())==digest
assert policy['verifierRevision']==r['controlRevision']
print(json.dumps({'expiresAt':cap.expires_at}))
'''


def materialize(request_raw, approval_raw, inputs, repo, output, *, now=None):
    """Library testing seam; production must use load_approval in main."""
    r,a=parse(request_raw),parse(approval_raw);now=now or dt.datetime.now(dt.timezone.utc)
    fields={'schemaVersion','phase','sourceRevision','controlRevision','attemptId','repositoryId','runId','runAttempt','producerWorkflowSha256','requestedAt','deadlineAt','inputs','release','launcher'}
    need(set(r)==fields and type(r['schemaVersion']) is int and r['schemaVersion']==1,'REQUEST_FIELDS')
    need(r['phase'] in ('consume','publication'),'PHASE')
    for k in ('sourceRevision','controlRevision'):need(isinstance(r[k],str) and re.fullmatch('[a-f0-9]{40}',r[k]),'REVISION')
    need(isinstance(r['attemptId'],str) and re.fullmatch('[a-z0-9-]{1,64}',r['attemptId']),'ATTEMPT')
    for k in ('repositoryId','runId','runAttempt'):need(type(r[k]) is int and r[k]>0,'GITHUB_ID')
    need(re.fullmatch('[a-f0-9]{64}',r['producerWorkflowSha256']),'WORKFLOW_HASH')
    start,end=b.stamp(r['requestedAt']),b.stamp(r['deadlineAt'])
    need(start<=now<end and dt.timedelta(0)<end-start<=dt.timedelta(minutes=30),'END_TO_END_DEADLINE')
    need(a['kind']=='cn-continuation-acquire-approval-v1' and a['requestSha256']==sha(request_raw),'ROOT_APPROVAL_REQUEST')
    need(b.stamp(a['issuedAt'])<=now<b.stamp(a['expiresAt'])<=end,'APPROVAL_DEADLINE')
    need(set(a['templateFiles'])==set(NAMES),'TEMPLATE_CLOSURE')
    code={name:(TEMPLATES/name).read_bytes() for name in NAMES}
    need(all(sha(code[n])==a['templateFiles'][n] for n in NAMES),'TEMPLATE_HASH')
    expected=COMMON if r['phase']=='consume' else PUB
    need(set(inputs)==set(r['inputs'])==expected,'INPUT_CLOSURE')
    for n,raw in inputs.items():
        need(0<len(raw)<=1048576 and sha(raw)==r['inputs'][n],'INPUT_HASH_'+n)
        parse(raw)
    output=Path(output);need(not output.exists(),'OUTPUT_EXISTS')
    with tempfile.TemporaryDirectory(prefix='cn-acquire-bind-') as tmp:
        t=Path(tmp);control=t/'control';control.mkdir();export_control(repo,r['controlRevision'],control)
        for n,raw in inputs.items():(t/(n+'.json')).write_bytes(raw)
        (t/'request.json').write_bytes(request_raw)
        result=subprocess.run([sys.executable,'-I','-B','-c',VALIDATE,str(control),str(t)],env=ENV,capture_output=True,timeout=30)
        need(result.returncode==0,'CANONICAL_REVALIDATION_REJECTED')
        need(end<=b.stamp(parse(result.stdout)['expiresAt']),'PROOF_WINDOW_TOO_SHORT')
        if r['phase']=='consume':
            content=consume(r,inputs,code,control,now)
        else:
            # Original publication validator remains authoritative. No second
            # admission implementation; exact bytes are passed unmodified.
            for n in ('materialize-publication.py','stage-runtime.py'):(t/n).write_bytes(code[n])
            decision={'kind':'cn-reviewed-publication-decision-v1','publishAuthorized':True,
                      'issuedAt':r['requestedAt'],'expiresAt':r['deadlineAt'],'release':r['release'],
                      'identity':{k:r[k] for k in ('sourceRevision','controlRevision','attemptId')},
                      'refs':{n:{'path':str(t/(n+'.json')),'sha256':sha(raw)} for n,raw in inputs.items()}}
            raw=encode(decision);(t/'decision.json').write_bytes(raw);dest=t/'publication'
            runner = """import importlib.util,json,sys,os
from pathlib import Path
root=Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('publication',root/'materialize-publication.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
raw=(root/'decision.json').read_bytes();content=m.generate(json.loads(raw),raw,Path(sys.argv[2]));dest=root/'publication';dest.mkdir(mode=0o700)
for name,data in content.items():
 with (dest/name).open('xb') as f:os.chmod(f.name,0o600);f.write(data)
"""
            result=subprocess.run([sys.executable,'-I','-B','-c',runner,str(t),str(Path(repo).absolute())],env=ENV,capture_output=True,timeout=45)
            need(result.returncode==0,'CANONICAL_PUBLICATION_REJECTED')
            content={p.name:p.read_bytes() for p in dest.iterdir()}
    provenance={'kind':'cn-continuation-acquire-materialization-v1','requestSha256':sha(request_raw),
                'approvalRawSha256':sha(approval_raw),'phase':r['phase'],
                'requestedAt':r['requestedAt'],'deadlineAt':r['deadlineAt'],
                'sourceRevision':r['sourceRevision'],'controlRevision':r['controlRevision'],
                'templateFiles':a['templateFiles'],'files':{n:sha(raw) for n,raw in content.items()},
                'cloudCalls':0,'proofGenerated':False,'dispatchAuthorizedByGenerator':False}
    content['provenance.json']=encode(provenance)
    output.mkdir(mode=0o700)
    for n,raw in content.items():
        with (output/n).open('xb') as f:os.chmod(f.name,0o600);f.write(raw);f.flush();os.fsync(f.fileno())
    return provenance


def consume(r,inputs,code,control,now):
    closure=r['launcher'];need(set(closure)=={'sdkSha256','code'},'LAUNCHER_CLOSURE')
    need(re.fullmatch('[a-f0-9]{64}',closure['sdkSha256']),'SDK_HASH')
    required={'execute-cn-candidate-download.py','cn_candidate_sdk_runtime.py','cn_candidate_download_supervisor.py','cn_candidate_authenticated_oss.py','cn_candidate_revalidation.py','cn_image_candidate.py','cn_image_archive.py','cn_candidate_oss.py','cn_archive_oss.py','canonical_control.py','hosted-release.py'}
    need(set(closure['code'])==required,'LAUNCHER_CODE_CLOSURE')
    for n,h in closure['code'].items():
        need((control/n).is_file() and sha((control/n).read_bytes())==h,'LAUNCHER_CONTROL_HASH')
    need(all(re.fullmatch('[a-f0-9]{64}',h) for h in closure['code'].values()),'LAUNCHER_HASH')
    proof=parse(inputs['proof']);prefix=f"runs/{r['runId']}/{r['runAttempt']}/"
    objects={n:{'key':prefix+n+'.zip','artifactId':x['artifactId'],'bytes':x['zipBytes'],'sha256':x['zipSha256']} for n,x in proof['github']['artifacts'].items()}
    for n in ('proof','policy'):objects[n]={'key':prefix+n+'.json','bytes':len(inputs[n]),'sha256':sha(inputs[n])}
    seconds=min(1100,int((b.stamp(r['deadlineAt'])-now).total_seconds()))
    need(seconds>0,'BUDGET_EXHAUSTED')
    config={k:r[k] for k in ('sourceRevision','controlRevision','runId','runAttempt','attemptId')}
    config.update(kind='cn-hk-consumer-v1',bucket='workspacex-hk-release-cache-1177216024653153',endpoint='https://oss-cn-hongkong.aliyuncs.com',prefix=prefix,destinationName='hk-'+sha(encode(r))[:32],issuedAt=r['requestedAt'],expiresAt=r['deadlineAt'],maxSeconds=seconds,objects=objects,candidatePlanRawSha256=sha(inputs['plan']),candidateSetRawSha256=sha(inputs['set']))
    ns={'__name__':'consumer','CONFIG':config};exec(compile(code['consumer.py'],'consumer','exec'),ns);ns['validate'](config)
    source=code['consume-launcher.py'].decode()
    replacements={'__CONTROL__':r['controlRevision'],'__SDK_SHA__':closure['sdkSha256'],'__CODE__':closure['code'],'__CONFIG__':config,'__CONSUMER__':code['consumer.py']}
    for token,value in replacements.items():need(source.count(token)==1,'LAUNCHER_TOKEN');source=source.replace(token,repr(value))
    compile(source,'bound-consumer','exec');raw=source.encode();packed=base64.b64encode(zlib.compress(raw)).decode()
    command="/usr/bin/python3.12 -I -S -B - <<'CN_CONSUMER'\nimport base64,zlib,hashlib\nb=zlib.decompress(base64.b64decode("+repr(packed)+"))\nassert hashlib.sha256(b).hexdigest()=="+repr(sha(raw))+"\nexec(compile(b,'<cn-consumer>','exec'))\nCN_CONSUMER\n"
    need(len(command.encode())<=18000,'COMMAND_LIMIT')
    params={'RegionId':'cn-shanghai','InstanceId.1':'i-uf6ga92ewloganobbln6','Type':'RunShellScript','Name':'cn-hk-consumer','CommandContent':command,'ContentEncoding':'PlainText','Timeout':str(min(1200,seconds+20)),'WorkingDir':'/','Username':'root','RepeatMode':'Once','KeepCommand':'false','EnableParameter':'false'}
    return {'consumer-request.json':encode(config),'bound-consumer.py':raw,'parameters.json':encode(params)}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('request','request-sha256','inputs','repository','output'):p.add_argument('--'+n,required=True)
    args=p.parse_args();raw=Path(args.request).read_bytes();need(sha(raw)==args.request_sha256,'REQUEST_HASH')
    approval=b.load_approval(args.request_sha256)
    r=parse(raw);need(set(r['inputs'])<=PUB,'INPUT_NAMES')
    inputs={n:(Path(args.inputs)/(n+'.json')).read_bytes() for n in r['inputs']}
    print(json.dumps(materialize(raw,approval,inputs,args.repository,args.output),sort_keys=True))

if __name__=='__main__':main()
