#!/usr/bin/env python3
"""Real isolated Compose success/rollback/config-drift exercise. Synthetic data only."""
import argparse,hashlib,importlib.util,json,pathlib,shutil,socket,subprocess,tempfile,time,urllib.request,uuid
from unittest.mock import patch
R=pathlib.Path(__file__).resolve().parent.parent
sp=importlib.util.spec_from_file_location('release',R/'scripts/web-only-release.py');w=importlib.util.module_from_spec(sp);sp.loader.exec_module(w)
def cli(*a):return subprocess.check_output(a,stderr=subprocess.STDOUT)
def main(out):
 out.mkdir(mode=0o700);owner=uuid.uuid4().hex;project='web-fixture-'+owner[:12];docker=shutil.which('docker');BASE='b'*40;NEW='a'*40
 def d(*a):return cli(docker,*a)
 def pin(p):return {'path':str(p),'sha256':w.m.sha_file(p)}
 context=out/'context';context.mkdir();(context/'Dockerfile').write_text('FROM python:3.12-alpine\nARG SOURCE\nLABEL org.opencontainers.image.revision=$SOURCE\nCOPY source /source\nCOPY server.py /server.py\nCMD ["python3","-c","import time;time.sleep(3600)"]\n')
 (context/'server.py').write_text('from http.server import BaseHTTPRequestHandler,HTTPServer\nclass H(BaseHTTPRequestHandler):\n def do_GET(self):\n  self.send_response(200);self.end_headers();self.wfile.write(open("/source","rb").read())\n def log_message(self,*a):pass\nHTTPServer(("0.0.0.0",8080),H).serve_forever()\n')
 d('pull','--platform=linux/amd64','python:3.12-alpine')
 tags=[];images={};compose=[]
 try:
  for label,source in [('baseline',BASE),('candidate',NEW)]:
   (context/'source').write_text(source);tag='wsx-web-fixture:'+owner+'-'+label;tags.append(tag)
   d('build','--platform=linux/amd64','--network=none','--pull=false','--build-arg','SOURCE='+source,'-t',tag,str(context));images[label]=json.loads(d('image','inspect',tag))[0]['Id']
  with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
  services=['api','web','agent','sandbox','sandbox-sessions'];file=out/'compose.json';env=out/'existing.env';env.write_text('');fixture=out/'synthetic-data';fixture.mkdir();(fixture/'keep.txt').write_text('existing synthetic bytes')
  service_env=out/'service.env';literal='fixture-literal-$NOT_INTERPOLATED-${NOT_INTERPOLATED}-$$';service_env.write_text('UNCHANGED='+literal+'\n')
  rows={s:{'image':images['baseline'],'platform':'linux/amd64','env_file':[{'path':str(service_env),'format':'raw'}],'volumes':[str(fixture)+':/'+name+':ro' for name in ['data','second-data','third-data','fourth-data']]} for s in services}
  rows['web'].update(command=['python3','/server.py'],ports=[f'127.0.0.1:{port}:8080']);file.write_text(json.dumps({'services':rows}));compose=['compose','--project-name',project,'--env-file',str(env),'--file',str(file)]
  d(*compose,'up','--detach','--pull','never','--no-build');lock=out/'release.lock';lock.touch(mode=0o600)
  archive=out/'web.tar';subprocess.run([docker,'save',tags[1]],stdout=archive.open('wb'),check=True)
  backend=w.m.Docker(docker);before=w.inspect_live(backend,compose,services,project)
  raw_before={service:json.loads(d('container','inspect',d(*compose,'ps','--quiet',service).decode().strip()))[0] for service in services}
  for service in services:
   ident=d(*compose,'ps','--quiet',service).decode().strip();live=json.loads(d('container','inspect',ident))[0]
   assert 'UNCHANGED='+literal in live['Config']['Env'],'LITERAL_ENV_INTERPOLATED'
  c={'kind':'single-host-web-only-v1','sourceRevision':NEW,'baselineRevision':BASE,'project':project,'docker':docker,'webService':'web','services':services,'baseline':before,'webImageId':images['candidate'],'composeFiles':[pin(file)],'envFile':pin(env),'lockFile':str(lock),'artifact':{**pin(archive),'runId':'1','artifactId':'1'},'browser':{}}
  config=out/'config.json';config.write_text(json.dumps(c))
  def probe(c,o,mode):
   until=time.monotonic()+20
   while True:
    try:
     with urllib.request.urlopen(f'http://127.0.0.1:{port}',timeout=2) as r:body=r.read().decode()
     if body==(BASE if mode=='baseline' else NEW):return {'passed':True,'mode':mode,'realHttp':True}
    except Exception:pass
    if time.monotonic()>until:raise w.m.Rejected('FIXTURE_BROWSER_FAILED')
    time.sleep(.1)
  # First exercise failure and actual exact-image restoration.
  def fail_candidate(c,o,mode):
   result=probe(c,o,mode)
   if mode=='candidate':raise w.m.Rejected('FIXTURE_INJECTED_BROWSER_FAILURE')
   return result
  with patch.object(w,'browser',side_effect=fail_candidate):rollback=w.release(config,out/'rollback',True)
  if rollback['status']!='ROLLED_BACK':
   diagnostics=[]
   for service in services:
    ids=d(*compose,'ps','--quiet',service).decode().split()
    if len(ids)!=1:diagnostics.append({'service':service,'runningContainers':len(ids)});continue
    old=raw_before[service]['HostConfig'];now=json.loads(d('container','inspect',ids[0]))[0]['HostConfig']
    fields=sorted(k for k in old.keys()|now.keys() if old.get(k)!=now.get(k));collections={}
    for key in ['Binds','Mounts']:
     a,b=old.get(key),now.get(key)
     if isinstance(a,list) and isinstance(b,list):
      collections[key]={'beforeCount':len(a),'afterCount':len(b),'beforeHash':w.m.digest(w.m.encoded(a)),'afterHash':w.m.digest(w.m.encoded(b)),'sameCompleteRecordMultiset':sorted(a,key=w.m.encoded)==sorted(b,key=w.m.encoded)}
    if fields:diagnostics.append({'service':service,'hostConfigurationChangedFields':fields,'mountCollections':collections})
   print(json.dumps({'rollbackDiagnostic':rollback,'dockerVersion':d('version','--format','{{.Server.Version}}').decode().strip(),'composeVersion':d('compose','version','--short').decode().strip(),'services':diagnostics}),flush=True)
  assert rollback['status']=='ROLLED_BACK',rollback
  restored=w.inspect_live(backend,compose,services,project);w.assert_unchanged(before,restored,'web');assert restored['web']['image']==images['baseline']
  # Restore creates a new Web container: freeze the freshly observed baseline.
  c['baseline']=restored;config.write_text(json.dumps(c))
  with patch.object(w,'browser',side_effect=probe):success=w.release(config,out/'success',True)
  assert success['status']=='SUCCEEDED',success
  after=w.inspect_live(backend,compose+['--file',str(out/'success/web.json')],services,project);w.assert_unchanged(restored,after,'web')
  assert (fixture/'keep.txt').read_text()=='existing synthetic bytes'
  # A disk-only env drift with a newly pinned file still fails live config hash before up.
  c['baseline']=after;c['baselineRevision']=NEW;c['sourceRevision']=BASE;c['webImageId']=images['baseline']
  with archive.open('wb') as f:subprocess.run([docker,'save',tags[0]],stdout=f,check=True)
  c['artifact'].update(pin(archive));service_env.write_text('UNCHANGED=changed-on-disk\n');rows['web']['image']=images['candidate'];file.write_text(json.dumps({'services':rows}));c['composeFiles']=[pin(file)];config.write_text(json.dumps(c))
  with patch.object(w,'browser',side_effect=probe):rejected=w.release(config,out/'drift',True)
  assert rejected['code']=='LIVE_CONFIG_DRIFT' and not rejected['applied'],rejected
  result={'passed':True,'realDocker':True,'realCompose':True,'rollbackVerified':True,'successVerified':True,'diskDriftRejected':True,'syntheticDataPreserved':True,'production':False}
 finally:
  if compose:subprocess.run([docker,*compose,'down'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  for tag in tags:subprocess.run([docker,'image','rm',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  assert not d('ps','--all','--quiet','--filter','label=com.docker.compose.project='+project).strip(),'OWNED_CONTAINERS_REMAIN'
  assert not d('network','ls','--quiet','--filter','label=com.docker.compose.project='+project).strip(),'OWNED_NETWORKS_REMAIN'
 print(json.dumps({**result,'cleanupVerified':True}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();main(pathlib.Path(a.output).resolve())
