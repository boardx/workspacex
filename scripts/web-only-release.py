#!/usr/bin/env python3
"""Pinned Web-only Compose transaction; never restarts data or backend services."""
import argparse,hashlib,importlib.util,json,os,pathlib,re,subprocess,fcntl,stat
spec=importlib.util.spec_from_file_location('minimal',pathlib.Path(__file__).with_name('minimal-docker-release.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def snapshot(v):
    # Values remain in memory; receipts contain a whole-configuration fingerprint only.
    config={k:x for k,x in v['Config'].items() if k not in ('Image','Labels','Hostname')}
    return {'id':v['Id'],'image':v['Image'],'startedAt':v['State'].get('StartedAt'),'running':v['State']['Running'],
            'configuration':m.digest(m.encoded(config)),'mounts':m.digest(m.encoded(v.get('Mounts',[]))),
            'networks':sorted(v.get('NetworkSettings',{}).get('Networks',{}))}

def inspect_live(d,base,services,project):
    result={}
    for s in services:
        ids=d.run(base+['ps','--quiet',s]).decode().split();m.need(len(ids)==1,'LIVE_CONTAINER_COUNT')
        v=d.json(['container','inspect',ids[0]])[0];l=v['Config'].get('Labels',{})
        m.need(l.get('com.docker.compose.project')==project and l.get('com.docker.compose.service')==s and v['State']['Running'],'LIVE_BINDING')
        result[s]=snapshot(v)
    return result

def assert_unchanged(before,after,web):
    m.need(set(before)==set(after),'SERVICE_SET_DRIFT')
    for s,v in before.items():
        if s!=web:m.need(after[s]==v,'BACKEND_OR_DATA_CHANGED')

def browser(c,out,mode):
    m.trusted_file(c['script']['path'],c['script']['sha256'])
    m.trusted_file(c['config'],c['configSha256'])
    args=[c['node'],c['script']['path'],'--config',c['config'],'--output',str(out),'--mode',mode]
    r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=90)
    m.need(r.returncode==0 and len(r.stdout)<=65536,'BROWSER_PROBE_FAILED')
    v=json.loads(r.stdout);m.need(v.get('passed') is True and v.get('mode')==mode,'BROWSER_PROTOCOL')
    return v

def release(config,output,apply=False):
    out=pathlib.Path(output);out.mkdir(mode=0o700,parents=True,exist_ok=False)
    lock=None;mutated=False;d=None;before=None;stage='preflight';c=None;command=None;base=None
    try:
        c=m.load(config);m.need(c['kind']=='single-host-web-only-v1','CONTRACT_KIND')
        for k in ('sourceRevision','baselineRevision'):m.need(re.fullmatch('[a-f0-9]{40}',c[k]),'EXACT_REVISION')
        m.need(c['sourceRevision']!=c['baselineRevision'],'SOURCE_IS_BASELINE')
        m.need(re.fullmatch('[a-z][a-z0-9_-]{0,40}',c['project']),'PROJECT')
        web=c['webService'];services=c['services'];m.need(web in services and len(services)>=5 and len(services)==len(set(services)),'SERVICE_SET')
        m.need(set(c['baseline'])==set(services),'BASELINE_CLOSURE')
        m.need(pathlib.Path(c['docker']).is_absolute(),'DOCKER_PATH')
        files=[m.trusted_file(x['path'],x['sha256']) for x in c['composeFiles']]
        env=m.trusted_file(c['envFile']['path'],c['envFile']['sha256'])
        m.need(files and pathlib.Path(c['lockFile']).is_absolute(),'INPUT_PATH')
        lock=os.open(c['lockFile'],os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW);st=os.fstat(lock)
        m.need(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==os.geteuid() and stat.S_IMODE(st.st_mode)==0o600,'LOCK_TRUST')
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise m.Rejected('RELEASE_LOCK_BUSY')
        d=m.Docker(c['docker']);base=['compose','--project-name',c['project'],'--env-file',env]
        for f in files:base+=['--file',f]
        original=d.json(base+['config','--format','json']);m.need(set(services)==set(original['services']),'COMPLETE_SERVICE_SET_REQUIRED')
        before=inspect_live(d,base,services,c['project']);m.need(before==c['baseline'],'BASELINE_CAS_FAILED')
        m.image(d,c['webImageId'],c['sourceRevision'])
        m.image(d,before[web]['image'],c['baselineRevision'])
        m.need(before[web]['image']!=c['webImageId'],'NO_IMAGE_CHANGE')
        provenance=c['artifact'];m.need(re.fullmatch('[a-f0-9]{64}',provenance['sha256']) and str(provenance['runId']).isdigit() and str(provenance['artifactId']).isdigit(),'ARTIFACT_PROVENANCE')
        # Caller pins an actual downloaded build archive; inspect verifies the loaded immutable image separately.
        m.trusted_file(provenance['path'],provenance['sha256'])
        for name,ident in [('candidate',c['webImageId']),('rollback',before[web]['image'])]:
            m.need(not d.json(['image','inspect',ident])[0].get('Config',{}).get('Volumes'),'IMAGE_VOLUME_FORBIDDEN')
        override=out/'web.json';m.save(override,{'services':{web:{'image':c['webImageId']}}})
        restore=out/'rollback-web.json';m.save(restore,{'services':{web:{'image':before[web]['image']}}})
        command=base+['--file',str(override.resolve())]
        expected=json.loads(json.dumps(original));expected['services'][web]['image']=c['webImageId']
        m.need(d.json(command+['config','--format','json'])==expected,'NON_IMAGE_COMPOSE_CHANGE')
        baseline_browser=browser(c['browser'],out/'baseline-browser','baseline')
        m.save(out/'plan.json',{'kind':c['kind'],'sourceRevision':c['sourceRevision'],'baselineRevision':c['baselineRevision'],
          'baseline':before,'webImageId':c['webImageId'],'changedServices':[web],'artifact':{k:v for k,v in provenance.items() if k!='path'},
          'migrations':False,'backendRestart':False,'permissionChanges':False,'baselineBrowser':baseline_browser})
        if not apply:return {'status':'PLANNED','applied':False}
        for x in [*c['composeFiles'],c['envFile']]:m.trusted_file(x['path'],x['sha256'])
        m.need(inspect_live(d,base,services,c['project'])==before,'FINAL_BASELINE_CAS_FAILED')
        m.need(d.json(base+['config','--format','json'])==original,'FINAL_COMPOSE_DRIFT')
        named=os.stat(c['lockFile'],follow_symlinks=False);m.need((st.st_dev,st.st_ino)==(named.st_dev,named.st_ino),'LOCK_REPLACED')
        stage='activation';m.save(out/'apply-intent.json',{'changedServices':[web],'automaticRetry':False});mutated=True
        d.run(command+['up','--detach','--no-deps','--pull','never','--no-build',web],timeout=90)
        stage='browser';result=browser(c['browser'],out/'candidate-browser','candidate')
        after=inspect_live(d,command,services,c['project']);assert_unchanged(before,after,web)
        m.need(after[web]['image']==c['webImageId'],'WEB_IMAGE_MISMATCH')
        for k in ('configuration','mounts','networks'):m.need(after[web][k]==before[web][k],'WEB_CONFIGURATION_CHANGED')
        receipt={'status':'SUCCEEDED','kind':c['kind'],'sourceRevision':c['sourceRevision'],'baselineRevision':c['baselineRevision'],
          'before':before,'after':after,'browser':result,'backendAndDataUnchanged':True,'migrationsExecuted':False,'permissionChanges':False}
        m.save(out/'receipt.json',receipt);return receipt
    except Exception as e:
        code=str(e) if isinstance(e,m.Rejected) else 'OPERATION_FAILED';result={'status':'REJECTED','stage':stage,'code':code,'applied':mutated}
        if mutated:
            result['status']='FAILED_OR_UNCERTAIN'
            try:
                # Do not mask external backend drift by restarting it. Restore only our Web image.
                rollback=base+['--file',str((out/'rollback-web.json').resolve())]
                d.run(rollback+['up','--detach','--no-deps','--pull','never','--no-build',c['webService']],timeout=90)
                restored=inspect_live(d,rollback,c['services'],c['project']);assert_unchanged(before,restored,c['webService'])
                m.need(restored[c['webService']]['image']==before[c['webService']]['image'],'ROLLBACK_IMAGE_MISMATCH')
                for k in ('configuration','mounts','networks'):m.need(restored[c['webService']][k]==before[c['webService']][k],'ROLLBACK_CONFIGURATION_CHANGED')
                result['rollbackBrowser']=browser(c['browser'],out/'rollback-browser','baseline');result['status']='ROLLED_BACK'
            except Exception:result['rollback']='UNPROVEN'
        m.save(out/'receipt.json',result);return result
    finally:
        if lock is not None:os.close(lock)

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--output',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    try:r=release(a.config,a.output,a.apply)
    except Exception:r={'status':'INPUT_OR_OUTPUT_REJECTED'}
    print(json.dumps(r,sort_keys=True));return 0 if r['status'] in ('SUCCEEDED','PLANNED') else 1
if __name__=='__main__':raise SystemExit(main())
