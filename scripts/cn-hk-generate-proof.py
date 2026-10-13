"""Runner-local true cached revalidation using exact producer-control verifier."""
import argparse,datetime,hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
CONTROL='27bada5321e45fbdd5f0506fd06d08fa29ea24ce'
def sha(b):return hashlib.sha256(b).hexdigest()
def put(p,v):
 raw=(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
 with p.open('xb')as f:p.chmod(0o600);f.write(raw)
 return sha(raw)
def main():
 a=argparse.ArgumentParser();a.add_argument('--bundle',type=Path,required=True);a.add_argument('--control',type=Path,required=True);a.add_argument('--template',type=Path,required=True);a.add_argument('--output',type=Path,required=True);x=a.parse_args()
 p=json.loads(x.template.read_bytes());assert p['controlRevision']==p['verifierRevision']==CONTROL
 assert subprocess.check_output(['git','-C',str(x.control),'rev-parse','HEAD'],text=True).strip()==CONTROL
 x.output.mkdir(mode=0o700);code=x.output/'code';code.mkdir(mode=0o700)
 for name,pin in p['verifierFiles'].items():
  b=(x.control/'scripts'/name).read_bytes();assert sha(b)==pin
  (code/name).write_bytes(b);(code/name).chmod(0o700)
 binary=Path(shutil.which('gh')).resolve();raw=binary.read_bytes();target=x.output/'gh-verified';target.write_bytes(raw);target.chmod(0o700)
 p.update(ghExecutable=str(target.resolve()),ghSha256=sha(raw))
 # Cache manifest is produced by the unchanged verifier through genuine provider reads.
 original=json.loads((x.bundle/'upload-plan.json').read_bytes());selection={k:p[k]for k in ('repositoryId','runId','runAttempt','controlRevision','producerWorkflowSha256','candidatePlanRawSha256','candidateSetRawSha256','artifactIds')}
 request=dict(kind='candidate-byte-acquisition-request-v1',schemaVersion=1,acquisitionId='hk-cloud-cached-acquisition',selection=selection,artifacts={k:dict(zipBytes=v['bytes'],zipSha256=v['sha256'])for k,v in original['artifacts'].items()},reusePaths={k:str((x.bundle/(k+'.zip')).resolve())for k in original['artifacts']},verifierRevision=CONTROL,verifierFiles=p['verifierFiles'],ghExecutable=str(target.resolve()),ghSha256=sha(raw),maxSeconds=1200,workers=1,networkAcquisitionAuthorized=True,previousDownloadStopped=True)
 requestpath=x.output/'acquisition-request.json';pin=put(requestpath,request);entry=code/'revalidate-cn-image-candidates.py'
 def run(args):
  result=subprocess.run([sys.executable,'-I','-S','-B',str(entry),*map(str,args)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=1200)
  assert result.returncode==0 and len(result.stdout)<16384
 run(['--acquire',requestpath,pin,x.output])
 manifest=x.output/request['acquisitionId']/'acquisition-manifest.json'
 cached=json.loads(manifest.read_bytes())['artifacts']
 # Remove only this process's already verified duplicate original ZIPs. Canonical cache remains.
 for name in original['artifacts']:
  source=x.bundle/(name+'.zip');assert source.is_file() and not source.is_symlink();source.unlink()
 now=datetime.datetime.now(datetime.timezone.utc)
 p.update(audience='i-uf6ga92ewloganobbln6',purpose='candidate-transfer-publication',verificationId='hk-cloud-proof',issuedAt=now.isoformat(),expiresAt=(now+datetime.timedelta(hours=1)).isoformat())
 policy=x.output/'revalidation-policy.json';pin=put(policy,p)
 run([policy,pin,x.output,'--cached',manifest,sha(manifest.read_bytes())])
 proof=x.output/p['verificationId']/'candidate-revalidation.json';assert proof.is_file()
 print(json.dumps(dict(proofPath=str(proof),proofSha256=sha(proof.read_bytes()),policyPath=str(policy),policySha256=pin,artifactZipPaths={k:v['path']for k,v in cached.items()},productionReady=False)))
if __name__=='__main__':main()
