#!/usr/bin/env python3
"""Single-host image-only release. Plan by default; no migration or credential handling."""
import fcntl, signal, stat
import argparse, hashlib, io, json, os, pathlib, re, subprocess, tarfile, tempfile, time, urllib.request, uuid

class Rejected(Exception): pass
def need(ok, code):
    if not ok: raise Rejected(code)
def digest(raw): return hashlib.sha256(raw).hexdigest()
def encoded(obj): return (json.dumps(obj, sort_keys=True, separators=(',', ':'))+'\n').encode()
def load(path): return json.loads(pathlib.Path(path).read_bytes())
def save(path, obj):
    with open(path, 'xb') as f: f.write(encoded(obj)); f.flush(); os.fsync(f.fileno())
def sha_file(path): return digest(pathlib.Path(path).read_bytes())
def image_id(v): return isinstance(v,str) and re.fullmatch(r'sha256:[0-9a-f]{64}',v)
def trusted_file(path, pin):
    p=pathlib.Path(path); need(p.is_absolute() and not p.is_symlink(), 'INPUT_PATH')
    st=p.stat(); need(st.st_uid in (0,os.geteuid()) and not st.st_mode & 0o022 and p.is_file(), 'INPUT_TRUST')
    need(sha_file(p)==pin, 'INPUT_DRIFT'); return str(p)

class Docker:
    def __init__(self, executable): self.executable=executable
    def run(self,args,limit=2*1024*1024,timeout=60):
        # No inherited Docker context, credential/config environment, interpolation secrets or proxies.
        env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8'}
        with tempfile.TemporaryFile() as out:
            p=subprocess.Popen([self.executable,*args],stdout=out,stderr=subprocess.DEVNULL,env=env)
            until=time.monotonic()+timeout
            try:
                while p.poll() is None:
                    need(out.tell()<=limit,'COMMAND_OUTPUT_LIMIT')
                    need(time.monotonic()<until,'COMMAND_TIMEOUT'); time.sleep(.01)
                need(p.returncode==0,'DOCKER_COMMAND_FAILED'); need(out.tell()<=limit,'COMMAND_OUTPUT_LIMIT')
                out.seek(0); return out.read(limit+1)
            finally:
                if p.poll() is None: p.kill(); p.wait()
    def json(self,args,**kwargs): return json.loads(self.run(args,**kwargs))

def image(d, ident, source=None):
    need(image_id(ident),'IMAGE_ID_REQUIRED'); rows=d.json(['image','inspect',ident]); need(len(rows)==1,'IMAGE_INSPECT')
    v=rows[0]; need(v['Id']==ident and v['Os']=='linux' and v['Architecture']=='amd64','IMAGE_ID_OR_PLATFORM')
    revision=v.get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision')
    need(isinstance(revision,str) and re.fullmatch('[0-9a-f]{40}',revision),'IMAGE_SOURCE_MISSING')
    if source is not None: need(revision==source,'IMAGE_SOURCE_MISMATCH')
    return revision

def archive_map(raw,sql=False):
    result={}
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:*') as archive:
        for entry in archive:
            parts=pathlib.PurePosixPath(entry.name).parts
            need(parts and not entry.name.startswith('/') and '..' not in parts,'ARCHIVE_PATH')
            if entry.isdir(): continue
            need(entry.isfile() and entry.size<=4*1024*1024,'ARCHIVE_TYPE_OR_SIZE')
            name='/'.join(parts[1:]) if len(parts)>1 else parts[0]
            need(name not in result,'ARCHIVE_DUPLICATE')
            data=archive.extractfile(entry).read(); need(len(data)==entry.size,'ARCHIVE_TRUNCATED')
            if not sql or name.endswith('.sql'): result[name]=digest(data)
    need(bool(result),'EMPTY_SCHEMA_INVENTORY'); return result

def schema(d,ident,role,out):
    need(not d.json(['image','inspect',ident])[0].get('Config',{}).get('Volumes'),'PROBE_DECLARED_VOLUME_UNSUPPORTED')
    nonce=uuid.uuid4().hex; name='wsx-schema-'+nonce
    save(out/('probe-'+nonce+'.json'),{'name':name,'imageId':ident,'role':role,'started':False})
    cid=None
    try:
        cid=d.run(['create','--pull=never','--name',name,'--label','wsx.release.schema='+nonce,'--network','none','--entrypoint','/bin/true',ident]).decode().strip()
        need(re.fullmatch('[0-9a-f]{64}',cid),'PROBE_ID')
        paths=['/opt/workspacex/apps/api/migrations'] if role=='api' else ['/app/src/deep_agent_service/memory_deployment.py','/app/uv.lock']
        return {path:archive_map(d.run(['cp',cid+':'+path,'-'],limit=16*1024*1024),sql=role=='api') for path in paths}
    finally:
        # Inspect by our unique name even if create response was lost; never start probe containers.
        rows=d.json(['container','inspect',name]); need(len(rows)==1,'PROBE_CLEANUP_UNPROVEN')
        v=rows[0]; need(v['Config']['Labels'].get('wsx.release.schema')==nonce and v['Image']==ident and not v['State']['Running'],'PROBE_OWNER_MISMATCH')
        d.run(['rm',v['Id']]); save(out/('probe-'+nonce+'-cleanup.json'),{'containerId':v['Id'],'removed':True})

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise Rejected('HEALTH_REDIRECT')
def health(config,timeout=10):
    # Socket timeouts alone permit an indefinitely slow response body.
    started=time.monotonic(); previous=signal.getsignal(signal.SIGALRM)
    def expired(*_): raise Rejected('HEALTH_DEADLINE')
    signal.signal(signal.SIGALRM,expired)
    old_timer=signal.setitimer(signal.ITIMER_REAL,timeout)
    try: return read_health(config,timeout)
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        signal.signal(signal.SIGALRM,previous)
        if old_timer[0]>0:
            signal.setitimer(signal.ITIMER_REAL,max(.001,old_timer[0]-(time.monotonic()-started)),old_timer[1])

def read_health(config,timeout):
    from urllib.parse import urlsplit
    u=urlsplit(config['url']); need(u.scheme in ('http','https') and u.hostname and not u.username and not u.password and not u.fragment,'HEALTH_URL')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open(config['url'],timeout=timeout) as r:
        need(r.status==200,'HEALTH_HTTP'); raw=r.read(65537); need(len(raw)<=65536,'HEALTH_SIZE'); body=json.loads(raw)
    need(bool(config['expected']) and all(body.get(k)==v for k,v in config['expected'].items()),'HEALTH_BODY')
    return {'httpStatus':200,'expectedFieldsMatched':True}

def verify_runtime(d, command, services, images, config):
    until=time.monotonic()+config.get('readinessTimeoutSeconds',120);polls=0
    def remaining():
        value=until-time.monotonic();need(value>0,'READINESS_DEADLINE');return value
    while True:
        polls+=1;ready=True
        for service in services:
            ids=d.run(command+['ps','--quiet',service],timeout=min(10,remaining())).decode().split()
            need(len(ids)<=1,'DEPLOYED_CONTAINER_AMBIGUOUS')
            if not ids: ready=False;continue
            rows=d.json(['container','inspect',ids[0]],timeout=min(10,remaining()))
            need(len(rows)==1,'DEPLOYED_CONTAINER_AMBIGUOUS');v=rows[0]
            labels=v.get('Config',{}).get('Labels',{})
            need(labels.get('com.docker.compose.project')==config['project'] and labels.get('com.docker.compose.service')==service,'LIVE_BINDING')
            need(v['Image']==images[service],'DEPLOYED_IMAGE_MISMATCH')
            ready=ready and v['State']['Running'] and not v['State'].get('Restarting',False) and v['State'].get('Health',{}).get('Status','healthy')=='healthy'
        if ready:
            try:
                result=health(config['health'],timeout=min(10,remaining()));remaining()
                break
            except Rejected as error:
                if str(error) in ('HEALTH_DEADLINE','READINESS_DEADLINE'): raise
            except Exception: pass
        time.sleep(min(.25,remaining()))
    # Optional fixed host browser/business probe, executed for baseline, candidate and rollback.
    probe=config.get('verificationCommand')
    if probe:
        checked=subprocess.run(probe,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=max(.001,remaining()),env={'PATH':'/usr/bin:/bin:/usr/local/bin','LANG':'C.UTF-8'})
        need(checked.returncode==0,'BUSINESS_VERIFICATION_FAILED');remaining()
    result['readinessPolls']=polls
    return result

def resolved_config_hash(d, original, project, service, out):
    # Compose 2.40 config --hash explicitly skips env_file resolution, unlike up.
    # Hash the already-resolved model instead; never waive the live hash check.
    # The temporary model contains private environment values: mode 0600, no
    # second interpolation of literal dollars, and no retained evidence copy.
    fd,path=tempfile.mkstemp(prefix='.resolved-compose-',suffix='.json',dir=out)
    try:
        # Compose v2.40.3 cmd/compose/config.go escapeDollarSign doubles every
        # dollar in serialized config JSON. Invert that transport escaping once;
        # --no-interpolate below preserves literal $ and ${...} semantic values.
        with os.fdopen(fd,'wb') as output: output.write(encoded(original).replace(b'$$',b'$'))
        return d.run(['compose','--project-name',project,'--file',path,
                      'config','--no-interpolate','--hash',service]).decode().strip().split()
    finally: os.unlink(path)

def release(config_path,manifest_path,output,apply=False,lock_fd=None,commit=None):
    out=pathlib.Path(output); out.mkdir(mode=0o700,parents=False,exist_ok=False)
    stage='preflight'; mutated=False; lock=None; previous_signals={}
    def cancelled(*_): raise Rejected('DEPLOYMENT_CANCELLED')
    try:
        c=load(config_path); m=load(manifest_path)
        need(sha_file(manifest_path)==c['manifestSha256'],'MANIFEST_PIN')
        need(m['kind'] in ('single-host-images-v1','registry-images-v1') and re.fullmatch('[a-f0-9]{40}',m['sourceRevision']),'MANIFEST_SOURCE')
        need(set(m['images'])=={'api','web','agent','sandbox','postgres'},'FIVE_IMAGES_REQUIRED')
        need(re.fullmatch('[a-z][a-z0-9_-]{0,40}',c['project']),'PROJECT')
        # CN has four existing application containers; DevApp can additionally
        # bind a second sandbox service. Never create an optional service here.
        services=c['services']; need(set(services.values())=={'api','web','agent','sandbox'} and len(services) in (4,5),'APPLICATION_SERVICES')
        need(all(re.fullmatch('[a-z][a-z0-9_-]{0,40}',s) and s not in ('postgres','redis') and r!='postgres' for s,r in services.items()),'DATA_SERVICE_FORBIDDEN')
        files=[trusted_file(r['path'],r['sha256']) for r in c['composeFiles']]; need(bool(files),'COMPOSE_FILES')
        envfile=trusted_file(c['envFile']['path'],c['envFile']['sha256'])
        need(pathlib.Path(c['lockFile']).is_absolute(),'LOCK_PATH')
        lock=os.dup(lock_fd) if lock_fd is not None else os.open(c['lockFile'],os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
        ls=os.fstat(lock);need(stat.S_ISREG(ls.st_mode) and ls.st_nlink==1 and ls.st_uid==os.geteuid() and stat.S_IMODE(ls.st_mode)==0o600,'LOCK_TRUST')
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise Rejected('RELEASE_LOCK_BUSY')
        named=os.stat(c['lockFile'],follow_symlinks=False);need((ls.st_dev,ls.st_ino)==(named.st_dev,named.st_ino),'LOCK_REPLACED')
        wait=c.get('readinessTimeoutSeconds',120);need(type(wait) is int and 1<=wait<=120,'READINESS_TIMEOUT_RANGE')
        d=Docker(c['docker']); base=['compose','--project-name',c['project'],'--env-file',envfile]
        for f in files: base+=['--file',f]
        original=d.json(base+['config','--format','json']); need(set(services)<=set(original['services']),'SERVICE_NOT_EXISTING')
        old={}
        for service,role in services.items():
            ids=d.run(base+['ps','--quiet',service]).decode().split(); need(len(ids)==1,'EXISTING_CONTAINER_REQUIRED')
            v=d.json(['container','inspect',ids[0]])[0]; labels=v['Config']['Labels']
            need(labels.get('com.docker.compose.project')==c['project'] and labels.get('com.docker.compose.service')==service and v['State']['Running'],'LIVE_BINDING')
            config_hash=resolved_config_hash(d,original,c['project'],service,out)
            need(len(config_hash)==2 and config_hash[0]==service and labels.get('com.docker.compose.config-hash')==config_hash[1],'LIVE_CONFIG_DRIFT')
            image(d,v['Image']); old[service]=v['Image']
        for role,row in m['images'].items():
            if m['kind']=='single-host-images-v1':
                need(re.fullmatch('[a-f0-9]{64}',row['archiveSha256']) and str(row['artifactId']).isdigit() and str(row['runId']).isdigit(),'PROVENANCE_REQUIRED')
            else:
                need(isinstance(row.get('image'),str) and re.fullmatch(r'[a-z0-9][a-z0-9.:/_-]*@sha256:[a-f0-9]{64}',row['image']),'REGISTRY_DIGEST_REQUIRED')
                inspected=d.json(['image','inspect',row['imageId']])
                need(len(inspected)==1 and row['image'] in inspected[0].get('RepoDigests',[]),'REGISTRY_DIGEST_MISMATCH')
            image(d,row['imageId'],m['sourceRevision'])
        # Actual stopped-container bytes, never caller boolean or empty-map equality.
        schema_evidence={}
        for role in ('api','agent'):
            service=next(s for s,r in services.items() if r==role)
            before=schema(d,old[service],role,out);after=schema(d,m['images'][role]['imageId'],role,out)
            need(before==after,'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE')
            schema_evidence[role]={'baselineImageId':old[service],'candidateImageId':m['images'][role]['imageId'],'inventorySha256':digest(encoded(before)),'fileCount':sum(len(v)for v in before.values())}
        override=out/'images.json'; save(override,{'services':{s:{'image':m['images'][r]['imageId']} for s,r in services.items()}})
        command=base+['--file',str(override.resolve())]
        rendered=d.json(command+['config','--format','json'])
        expected=json.loads(json.dumps(original))
        for s,r in services.items(): expected['services'][s]['image']=m['images'][r]['imageId']
        need(rendered==expected,'NON_IMAGE_COMPOSE_CHANGE')
        save(out/'plan.json',{'sourceRevision':m['sourceRevision'],'manifestSha256':sha_file(manifest_path),'oldImages':old,'newImages':{s:m['images'][r]['imageId'] for s,r in services.items()},'applyRequested':apply,'schemaInventoriesEqual':True,'schemaEvidence':schema_evidence,'automaticRetry':False})
        if not apply: return {'status':'PLANNED','applied':False}
        # Recheck original files immediately before the sole mutation.
        for row in [*c['composeFiles'],c['envFile']]: trusted_file(row['path'],row['sha256'])
        need(sha_file(manifest_path)==c['manifestSha256'],'MANIFEST_DRIFT')
        need(d.json(base+['config','--format','json'])==original,'FINAL_COMPOSE_DRIFT')
        for s in services:
            ids=d.run(base+['ps','--quiet',s]).decode().split();need(len(ids)==1,'FINAL_CONTAINER_DRIFT')
            need(d.json(['container','inspect',ids[0]])[0]['Image']==old[s],'FINAL_CONTAINER_DRIFT')
        named=os.stat(c['lockFile'],follow_symlinks=False);need((ls.st_dev,ls.st_ino)==(named.st_dev,named.st_ino),'LOCK_REPLACED')
        if c.get('automaticRollback'):
            # Refuse to replace an unhealthy/unverifiable baseline; prepare recovery before mutation.
            verify_runtime(d,base,services,old,c)
            rollback_file=out/'rollback.json';save(rollback_file,{'services':{s:{'image':ident} for s,ident in old.items()}})
            for sig in (signal.SIGTERM,signal.SIGINT):
                previous_signals[sig]=signal.getsignal(sig);signal.signal(sig,cancelled)
        stage='compose-up'; save(out/'apply-intent.json',{'sourceRevision':m['sourceRevision'],'automaticRetry':False}); mutated=True
        d.run(command+['up','--detach','--no-deps','--pull','never','--no-build',*services],timeout=120)
        stage='readiness'
        result=verify_runtime(d,command,services,{s:m['images'][r]['imageId'] for s,r in services.items()},c)
        receipt={'status':'SUCCEEDED','sourceRevision':m['sourceRevision'],'manifestSha256':sha_file(manifest_path),'health':result,'versionEvidence':'actual-running-image-IDs','markerUnchanged':True,'schemaMigrationExecuted':False,'databaseZeroWritesClaimed':False,'automaticRetry':False}
        if commit: commit(out/'images.json')
        save(out/'receipt.json',receipt); return receipt
    except Exception as e:
        if stage=='readiness' and isinstance(e,Rejected) and str(e)=='COMMAND_TIMEOUT': e=Rejected('READINESS_DEADLINE')
        result={'status':'FAILED_OR_UNCERTAIN' if mutated else 'REJECTED','stage':stage,'code':str(e) if isinstance(e,Rejected) else 'OPERATION_FAILED','automaticRetry':False,'applyAttempted':mutated}
        if mutated and c.get('automaticRollback'):
            # Reserve the process for recovery even when Actions sends cancellation signals.
            for sig in previous_signals: signal.signal(sig,signal.SIG_IGN)
            try:
                recovery=base+['--file',str(rollback_file.resolve())]
                d.run(recovery+['up','--detach','--no-deps','--pull','never','--no-build',*services],timeout=120)
                result['rollbackHealth']=verify_runtime(d,recovery,services,old,c)
                result['status']='ROLLED_BACK'
                result['rollbackOverride']={'path':str(rollback_file.resolve()),'sha256':sha_file(rollback_file)}
            except Exception:
                result['status']='ROLLBACK_FAILED'
        save(out/'receipt.json',result); return result
    finally:
        for sig,handler in previous_signals.items(): signal.signal(sig,handler)
        if lock is not None: os.close(lock)

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--manifest',required=True);p.add_argument('--output',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    try: result=release(a.config,a.manifest,a.output,a.apply)
    except Exception: result={'status':'OUTPUT_OR_INPUT_REJECTED','automaticRetry':False}
    print(json.dumps(result,sort_keys=True)); return 0 if result['status'] in ('PLANNED','SUCCEEDED') else 1
if __name__=='__main__': raise SystemExit(main())
