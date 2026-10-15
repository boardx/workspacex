#!/usr/bin/env python3
"""Derive transfer input from actual build metadata; never fetch image ZIPs."""
import base64, hashlib, importlib.util, json, stat, tempfile, zipfile
from pathlib import Path

def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
B=module('mvp_binding','cn-release-mvp-chain.py');U=module('hk_upload','cn-hk-original-artifact-upload.py')
FILES={'canonical_control.py','cn_candidate_github.py','cn_candidate_revalidation.py','cn_image_archive.py','cn_image_candidate.py','hosted-release.py','revalidate-cn-image-candidates.py'}
def sha(raw):return hashlib.sha256(raw).hexdigest()
def metadata_zip(record,names,reader):
 U.need(record['bytes']<=256*1024)
 with tempfile.TemporaryDirectory(prefix='cn-mvp-small-metadata-')as folder:
  path=Path(folder)/'metadata.zip';reader('/repos/boardx/workspacex/actions/artifacts/'+str(record['id'])+'/zip',path,record['bytes'])
  U.need(sha(path.read_bytes())==record['sha256'])
  result={}
  with zipfile.ZipFile(path)as archive:
   rows=archive.infolist();U.need({r.filename for r in rows}==names and len(rows)==len(names))
   for row in rows:
    U.need(not row.is_dir()and not row.flag_bits&1 and stat.S_IFMT(row.external_attr>>16)in(0,stat.S_IFREG)and 0<row.file_size<=65536)
    result[row.filename]=archive.read(row);U.need(len(result[row.filename])==row.file_size)
  return result

def derive(identity,runid,destination,reader=U.gh):
 run=reader(f'/repos/boardx/workspacex/actions/runs/{runid}/attempts/1')
 listing=reader(f'/repos/boardx/workspacex/actions/runs/{runid}/artifacts?per_page=100')
 bound=B.bind(identity,run,listing)
 plan=metadata_zip(bound['artifacts']['plan'],{'cn-candidate-plan.json'},reader)['cn-candidate-plan.json']
 bundle=metadata_zip(bound['artifacts']['set'],{'candidate-set.json','candidate-plan.json'},reader)
 U.need(bundle['candidate-plan.json']==plan)
 def control_bytes(path):
  content=reader(f'/repos/boardx/workspacex/contents/{path}?ref={identity["controlRevision"]}')
  U.need(content.get('encoding')=='base64');return base64.b64decode(content['content'],validate=False)
 template=dict(kind='candidate-revalidation-policy-v1',schemaVersion=1,repositoryId=1000328649,
  runId=runid,runAttempt=1,controlRevision=identity['controlRevision'],verifierRevision=identity['controlRevision'],
  artifactIds={k:v['id']for k,v in bound['artifacts'].items()},candidatePlanRawSha256=sha(plan),
  candidateSetRawSha256=sha(bundle['candidate-set.json']),producerWorkflowSha256=sha(control_bytes('.github/workflows/build-cn-image-candidates.yml')),
  verifierFiles={name:sha(control_bytes('scripts/'+name))for name in sorted(FILES)},ghExecutable='/runtime/verified-gh-placeholder',ghSha256='0'*64,
  issuedAt=None,expiresAt=None,audience=None,purpose=None,verificationId=None)
 raw=(json.dumps(template,sort_keys=True,separators=(',',':'))+'\n').encode()
 transfer=B.transfer_plan(bound,destination,plan,raw,Path(__file__).parent)
 # Real source admission is performed again before credentials in child workflow.
 U.need(reader(f'/repos/boardx/workspacex/actions/runs/{runid}/attempts/1')==run)
 return dict(binding=bound,transferPlan=transfer,revalidationTemplate=template,
             transferRaw=(json.dumps(transfer,sort_keys=True,separators=(',',':'))+'\n'),templateRaw=raw.decode())
