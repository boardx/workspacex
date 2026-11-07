#!/usr/bin/env python3
"""GitHub Linux Docker integration; synthetic images/data, never BC or production.
Run: python3 -I -B tests/test_minimal_docker_release_real.py --output NEW_DIRECTORY
Only this fixture's labeled containers/networks/images are removed. No prune.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
ROLES = ('api', 'web', 'agent', 'sandbox', 'postgres')
SERVICES = {'api':'api', 'web':'web', 'agent':'agent', 'sandbox':'sandbox', 'sandbox-sessions':'sandbox'}
BASE_SOURCE, NEW_SOURCE = 'b'*40, 'a'*40
LABEL = 'wsx.minimal.fixture'
SERVER = '''from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"trustworthy":true,"fixture":true}')
 def log_message(self,*args):pass
HTTPServer(('0.0.0.0',8080),Handler).serve_forever()
'''
DOCKERFILE = '''ARG BASE
FROM ${BASE}
ARG SOURCE
ARG ROLE
ARG OWNER
LABEL org.opencontainers.image.revision=$SOURCE wsx.minimal.fixture=$OWNER wsx.minimal.role=$ROLE
COPY migration.sql /opt/workspacex/apps/api/migrations/001.sql
COPY memory_deployment.py /app/src/deep_agent_service/memory_deployment.py
COPY uv.lock /app/uv.lock
COPY server.py /fixture/server.py
CMD ["python3", "-c", "import time;time.sleep(3600)"]
'''

def require(condition, code):
    if not condition: raise RuntimeError(code)
def write(path, value):
    with open(path, 'x', encoding='utf8') as f:
        json.dump(value, f, sort_keys=True, indent=2); f.write('\n')
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

class Fixture:
    def __init__(self, out):
        self.out=out; self.owner=uuid.uuid4().hex; self.project='minimal-fixture-'+self.owner[:16]
        self.docker=shutil.which('docker'); require(self.docker, 'DOCKER_UNAVAILABLE')
        self.start=time.monotonic(); self.work_deadline=self.start+480; self.deadline=self.start+590
        self.commands=0; self.images={}; self.base=None
        self.env={'PATH':os.environ.get('PATH','/usr/bin:/bin'), 'LANG':'C.UTF-8'}
        write(out/'owner.json', {'owner':self.owner,'project':self.project,'label':LABEL,'synthetic':True,'production':False})
    def run(self, args, timeout=60, cleanup=False, check=True):
        self.commands+=1
        left=(self.deadline if cleanup else self.work_deadline)-time.monotonic()
        require(left>0, 'FIXTURE_DEADLINE')
        log=self.out/('command-%03d.log'%self.commands)
        with open(log,'xb') as f:
            p=subprocess.Popen(args,stdout=f,stderr=subprocess.STDOUT,env=self.env)
            try: code=p.wait(timeout=min(timeout,left))
            except subprocess.TimeoutExpired:
                p.kill();p.wait();raise RuntimeError('FIXTURE_COMMAND_TIMEOUT')
        require(log.stat().st_size<=8*1024*1024,'FIXTURE_LOG_TOO_LARGE')
        if check: require(code==0,'FIXTURE_COMMAND_FAILED_%03d'%self.commands)
        return code,log.read_bytes()
    def d(self,*args,**kwargs): return self.run([self.docker,*args],**kwargs)[1]
    def j(self,*args,**kwargs): return json.loads(self.d(*args,**kwargs))
    def images_for(self, source, variant):
        result={}
        for role in ROLES:
            tag='wsx-minimal-fixture:'+self.owner+'-'+variant+'-'+role
            self.d('build','--network=none','--pull=false','--build-arg','BASE='+self.base,
                   '--build-arg','SOURCE='+source,'--build-arg','ROLE='+role,'--build-arg','OWNER='+self.owner,
                   '--tag',tag,str(self.out/'context'),timeout=90)
            row=self.j('image','inspect',tag)[0]
            require(row['Config']['Labels'].get(LABEL)==self.owner,'IMAGE_OWNER')
            result[role]=row['Id'];self.images[row['Id']]=tag
        return result
    def live(self, compose):
        result={}
        for service in SERVICES:
            ids=self.d(*compose,'ps','--quiet',service).decode().split()
            require(len(ids)==1,'LIVE_SERVICE_MISSING')
            row=self.j('container','inspect',ids[0])[0]
            require(row['Config']['Labels'].get(LABEL)==self.owner,'CONTAINER_OWNER')
            result[service]={'containerId':row['Id'],'imageId':row['Image'],'running':row['State']['Running']}
        return result
    def manifest(self, images, path):
        # Synthetic provenance is intentional: this test does not validate GitHub artifacts.
        write(path,{'kind':'single-host-images-v1','sourceRevision':NEW_SOURCE,
              'images':{r:{'imageId':images[r],'archiveSha256':hashlib.sha256(('synthetic-'+r).encode()).hexdigest(),
                             'artifactId':'1','runId':'1'} for r in ROLES}})
    def exercise(self):
        self.d('version','--format','{{.Server.Os}}');self.d('compose','version')
        self.d('pull','--platform=linux/amd64','python:3.12-alpine',timeout=120)
        base=self.j('image','inspect','python:3.12-alpine')[0]
        require(base['Os']=='linux' and base['Architecture']=='amd64','BASE_PLATFORM')
        self.base=next(x for x in base['RepoDigests'] if x.startswith('python@sha256:'))
        write(self.out/'base-image.json',{'requested':'python:3.12-alpine','resolved':self.base,'imageId':base['Id'],
              'baselineSource':BASE_SOURCE,'candidateSource':NEW_SOURCE,'productionSource':False})
        context=self.out/'context';context.mkdir()
        for name,text in {'Dockerfile':DOCKERFILE,'migration.sql':'CREATE TABLE fixture_test(id integer);\n',
                          'memory_deployment.py':'# synthetic schema contract; not executed\n','uv.lock':'synthetic-unchanged-lock\n','server.py':SERVER}.items():
            (context/name).write_text(text)
        baseline=self.images_for(BASE_SOURCE,'baseline');candidate=self.images_for(NEW_SOURCE,'candidate')
        require(all(baseline[r]!=candidate[r] for r in ROLES),'CANDIDATE_NOT_DISTINCT')
        # Build exactly one additional API image with a different real SQL byte sequence.
        (context/'migration.sql').write_text('CREATE TABLE fixture_changed(id integer);\n')
        drift_tag='wsx-minimal-fixture:'+self.owner+'-drift-api'
        self.d('build','--network=none','--pull=false','--build-arg','BASE='+self.base,'--build-arg','SOURCE='+NEW_SOURCE,
               '--build-arg','ROLE=api','--build-arg','OWNER='+self.owner,'--tag',drift_tag,str(context),timeout=90)
        drift_id=self.j('image','inspect',drift_tag)[0]['Id'];self.images[drift_id]=drift_tag
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1]
        composefile=self.out/'compose.json';envfile=self.out/'interpolation.env';envfile.write_text('')
        services={name:{'image':baseline[role],'labels':{LABEL:self.owner},'pull_policy':'never'} for name,role in SERVICES.items()}
        services['api'].update({'command':['python3','/fixture/server.py'],'ports':[f'127.0.0.1:{port}:8080']})
        write(composefile,{'services':services,'networks':{'default':{'labels':{LABEL:self.owner}}}})
        compose=['compose','--project-name',self.project,'--env-file',str(envfile),'--file',str(composefile)]
        self.d(*compose,'up','--detach','--no-build','--pull','never',timeout=60)
        before=self.live(compose)
        lock=self.out/'existing-release.lock';lock.touch(mode=0o600)
        manifest=self.out/'manifest.json';self.manifest(candidate,manifest)
        config={'docker':self.docker,'project':self.project,'lockFile':str(lock),'readinessTimeoutSeconds':30,
                'manifestSha256':sha(manifest),'composeFiles':[{'path':str(composefile),'sha256':sha(composefile)}],
                'envFile':{'path':str(envfile),'sha256':sha(envfile)},'services':SERVICES,
                'health':{'url':f'http://127.0.0.1:{port}/health','expected':{'trustworthy':True,'fixture':True}}}
        # First prove incompatible SQL cannot switch any real service container.
        bad_manifest=self.out/'drift-manifest.json';self.manifest({**candidate,'api':drift_id},bad_manifest)
        bad_config=self.out/'drift-config.json';write(bad_config,{**config,'manifestSha256':sha(bad_manifest)})
        cli=[sys.executable,'-I','-B',str(ROOT/'scripts/minimal-docker-release.py')]
        code,_=self.run(cli+['--config',str(bad_config),'--manifest',str(bad_manifest),'--output',str(self.out/'rejected'),'--apply'],timeout=120,check=False)
        rejection=json.loads((self.out/'rejected/receipt.json').read_text())
        require(code!=0 and rejection['code']=='SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE','SCHEMA_REJECTION_NOT_PROVEN')
        require(self.live(compose)==before,'SCHEMA_REJECTION_SWITCHED_CONTAINERS')
        write(self.out/'schema-rejection.json',{'passed':True,'actualContainerIdsUnchanged':True,'code':rejection['code']})
        configpath=self.out/'config.json';write(configpath,config)
        self.run(cli+['--config',str(configpath),'--manifest',str(manifest),'--output',str(self.out/'applied'),'--apply'],timeout=150)
        receipt=json.loads((self.out/'applied/receipt.json').read_text());require(receipt['status']=='SUCCEEDED','APPLY_RECEIPT')
        after=self.live(compose)
        require(all(after[s]['running'] and after[s]['imageId']==candidate[r] and after[s]['containerId']!=before[s]['containerId'] for s,r in SERVICES.items()),'ACTUAL_IMAGE_SWITCH_NOT_PROVEN')
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(config['health']['url'],timeout=5)as response:
            require(response.status==200 and json.loads(response.read(1024))=={'trustworthy':True,'fixture':True},'ACTUAL_HTTP_HEALTH')
        # Failed real candidate must restore exact previous images and remain deployable.
        (context/'migration.sql').write_text('CREATE TABLE fixture_test(id integer);\n')
        (context/'server.py').write_text('raise SystemExit(1)\n')
        broken_tag='wsx-minimal-fixture:'+self.owner+'-broken-api'
        self.d('build','--network=none','--pull=false','--build-arg','BASE='+self.base,'--build-arg','SOURCE='+NEW_SOURCE,
               '--build-arg','ROLE=api','--build-arg','OWNER='+self.owner,'--tag',broken_tag,str(context),timeout=90)
        broken_id=self.j('image','inspect',broken_tag)[0]['Id'];self.images[broken_id]=broken_tag
        broken_manifest=self.out/'broken-manifest.json';self.manifest({**candidate,'api':broken_id},broken_manifest)
        current_overlay=self.out/'applied/images.json'
        recovery_config={**config,'automaticRollback':True,'readinessTimeoutSeconds':15,'manifestSha256':sha(broken_manifest),
                         'composeFiles':[*config['composeFiles'],{'path':str(current_overlay),'sha256':sha(current_overlay)}]}
        recovery_path=self.out/'recovery-config.json';write(recovery_path,recovery_config)
        code,_=self.run(cli+['--config',str(recovery_path),'--manifest',str(broken_manifest),'--output',str(self.out/'recovered'),'--apply'],timeout=150,check=False)
        recovered=json.loads((self.out/'recovered/receipt.json').read_text())
        require(code!=0 and recovered['status']=='ROLLED_BACK','AUTOMATIC_RECOVERY_NOT_PROVEN')
        restored=self.live(compose)
        require(all(restored[s]['running'] and restored[s]['imageId']==candidate[r] for s,r in SERVICES.items()),'RECOVERED_IMAGE_MISMATCH')
        # The ID-based recovery overlay must remain in the next baseline (config hashes differ from tags).
        rollback_overlay=self.out/'recovered/rollback.json'
        next_config={**config,'automaticRollback':True,'composeFiles':[*config['composeFiles'],{'path':str(rollback_overlay),'sha256':sha(rollback_overlay)}]}
        next_path=self.out/'next-config.json';write(next_path,next_config)
        self.run(cli+['--config',str(next_path),'--manifest',str(manifest),'--output',str(self.out/'after-recovery'),'--apply'],timeout=150)
        return {'status':'PASSED','realDocker':True,'realCompose':True,'realHttp':True,'syntheticImageProvenance':True,
                'productionAccepted':False,'sourceIsBC':False,'baselineSource':BASE_SOURCE,'candidateSource':NEW_SOURCE,
                'before':before,'after':after,'schemaDriftRejectedWithoutSwitch':True,'automaticRollbackVerified':True,'releaseAfterRollbackVerified':True,'elapsedSeconds':time.monotonic()-self.start}
    def cleanup(self):
        errors=[]
        # Cleanup only exact owner-labeled objects; Docker's shared base image/cache are retained.
        for kind in ('container','network','image'):
            try:
                if kind=='container': ids=self.d('ps','--all','--quiet','--filter','label='+LABEL+'='+self.owner,cleanup=True).decode().split()
                elif kind=='network': ids=self.d('network','ls','--quiet','--filter','label='+LABEL+'='+self.owner,cleanup=True).decode().split()
                else: ids=self.d('image','ls','--quiet','--no-trunc','--filter','label='+LABEL+'='+self.owner,cleanup=True).decode().split()
                # Failed CLI schema probes inherit image labels, so this same owner filter includes them.
                for ident in set(ids):
                    row=self.j(kind,'inspect',ident,cleanup=True)[0]
                    labels=row.get('Labels',{}) if kind=='network' else row.get('Config',{}).get('Labels',{})
                    require(labels.get(LABEL)==self.owner,'CLEANUP_OWNER_MISMATCH')
                    if kind=='container': self.d('container','rm','--force',row['Id'],cleanup=True)
                    else: self.d(kind,'rm',row['Id'],cleanup=True)
            except Exception as error: errors.append(type(error).__name__+':'+str(error))
        try:
            for args in [('ps','--all','--quiet'),('network','ls','--quiet'),('image','ls','--quiet')]:
                require(not self.d(*args,'--filter','label='+LABEL+'='+self.owner,cleanup=True).strip(),'CLEANUP_REMAINS')
        except Exception as error: errors.append(type(error).__name__+':'+str(error))
        result={'verified':not errors,'owner':self.owner,'errors':errors,'globalPrune':False,'baseImageRetained':True}
        write(self.out/'cleanup.json',result);return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    if sys.platform!='linux' or os.environ.get('GITHUB_ACTIONS')!='true':
        print('{"status":"LINUX_GITHUB_ONLY","productionAccepted":false}');return 2
    out=Path(args.output).absolute();out.mkdir(mode=0o700,parents=False,exist_ok=False)
    fixture=Fixture(out); result={'status':'FAILED','productionAccepted':False}
    try: result=fixture.exercise()
    except Exception as error: result.update(errorType=type(error).__name__,errorCode=str(error))
    finally:
        clean=fixture.cleanup();result['cleanupVerified']=clean['verified']
        if not clean['verified']:result['status']='FAILED_CLEANUP_UNPROVEN'
        write(out/'result.json',result)
    print(json.dumps(result,sort_keys=True));return 0 if result['status']=='PASSED' else 1
if __name__=='__main__':raise SystemExit(main())
