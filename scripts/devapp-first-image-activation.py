#!/usr/bin/env python3
"""One-time root DevApp conversion, with a cold database baseline and maintenance fence.

No runner entry point. Immutable source/tag and reviewed plan are fixed for issue 5921.
The database, original containers, and systemd units remain available for recovery.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/root/wsx-devapp-5921-activation')
PLAN = Path('/root/wsx-devapp-5921-plan')
RUNTIME = Path('/root/wsx-devapp-5921-runtime')
PROBE = Path('/root/wsx-devapp-5921-probe')
TAG = '7265bb89a9d4cc7bac9ca11ff638eb5a3c8a02d0-40117717852-1'
PLAN_HASH = 'd1f79f920693ecdf8f1f4516e2391966014c571f9e5a584992d60b4b5016072e'
OLD = ['workspacex-deep-agent','workspacex-skill-sandbox-1','workspacex-skill-sandbox-sessions-1']
APPS = ['api','web','agent','sandbox','sandbox-sessions']
PG = 'workspacex-postgres-1'
OWNER = None
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def encoded(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
def save(name,x):
    p=ROOT/name;tmp=p.with_suffix('.tmp')
    with open(tmp,'wb') as f:f.write(encoded(x));f.flush();os.fsync(f.fileno())
    os.replace(tmp,p)
def run(args,stage,inp=None,timeout=120):
    p=subprocess.run(args,input=inp,capture_output=True,timeout=timeout)
    (ROOT/(stage+'.stderr')).write_bytes(p.stderr)
    if p.returncode:raise ValueError('COMMAND_REJECTED:'+stage)
    return p.stdout

def sql(text,stage):
    return run(['docker','exec','-i',PG,'psql','-X','-q','-A','-t','--set=ON_ERROR_STOP=1','-U',OWNER,'-d','workspacex'],stage,text.encode())
def caddy_get():
    with OPENER.open('http://127.0.0.1:2019/config/',timeout=10) as r:return json.loads(r.read(2097152))
def caddy_set(value):
    req=urllib.request.Request('http://127.0.0.1:2019/load',data=encoded(value),headers={'Content-Type':'application/json'},method='POST')
    with OPENER.open(req,timeout=20) as r:assert r.status==200

def compose(args,stage):
    return run(['docker','compose','--project-name','workspacex-image','--env-file',str(RUNTIME/'compose.env'),'-f',str(ROOT/'compose.json'),*args],stage,timeout=240)
def wait_pg():
    for _ in range(60):
        p=subprocess.run(['docker','exec',PG,'psql','-X','-q','-A','-t','-U',OWNER,'-d','workspacex','-c','SELECT NOT pg_is_in_recovery()'],capture_output=True)
        if p.returncode==0 and p.stdout.strip()==b't':return
        time.sleep(1)
    raise ValueError('DATABASE_NOT_READY')
def tree_hash(path):
    h=hashlib.sha256()
    for p in sorted(path.rglob('*')):
        if p.is_symlink():raise ValueError('EXTERNAL_DATABASE_STORAGE_REQUIRES_REVIEW')
        if p.is_file():
            h.update(str(p.relative_to(path)).encode()+b'\0')
            with p.open('rb') as f:
                for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def cold_copy(source,destination):
    # Recovery must retain postgres ownership even when the image starts unprivileged.
    shutil.copytree(source,destination,symlinks=True,copy_function=shutil.copy2)
    for original in [source,*source.rglob('*')]:
        if original.is_symlink():raise ValueError('EXTERNAL_DATABASE_STORAGE_REQUIRES_REVIEW')
        target=destination/original.relative_to(source)
        st=original.stat();os.chown(target,st.st_uid,st.st_gid)
        if target.stat().st_uid!=st.st_uid or target.stat().st_gid!=st.st_gid:
            raise ValueError('COLD_BACKUP_OWNERSHIP_DRIFT')

def open_public(saved_caddy,state):
    # A timed out load may already have admitted public writes. Persist first.
    save('public-open-intent.json',{'status':'PUBLIC_OPEN_INTENT_NO_DATABASE_REWIND','tag':TAG})
    state['mayHaveOpened']=True
    caddy_set(saved_caddy)
    assert caddy_get()==saved_caddy,'PUBLIC_PROXY_READBACK_UNKNOWN'

def restore_old_services(saved_caddy,maintenance,fenced):
    run(['docker','start',*OLD],'recovery-start-old-apps')
    run(['systemctl','start','workspacex-api','workspacex-web'],'recovery-start-systemd')
    health();probe(baseline=True)
    if fenced:
        actual=caddy_get()
        assert actual in (maintenance,saved_caddy),'RECOVERY_PROXY_CHANGED'
        if actual==maintenance:caddy_set(saved_caddy)
        assert caddy_get()==saved_caddy,'RECOVERY_PUBLIC_PROXY_UNKNOWN'

def probe(baseline=False):
    run(['/usr/bin/python3','-I','-B',str(PROBE/'devapp-image-browser-probe.py'),*(['--baseline'] if baseline else [])],'browser-probe-baseline' if baseline else 'browser-probe',timeout=120)
def health():
    for _ in range(90):
        try:
            with OPENER.open('https://devapp.boardx.us/api/healthz',timeout=5) as r:
                x=json.loads(r.read(65536))
                if r.status==200 and x.get('trustworthy') is True:return
        except Exception:pass
        time.sleep(1)
    raise ValueError('HEALTH_NOT_TRUSTWORTHY')
def stop_new():compose(['stop','--timeout','30',*APPS],'stop-new')
def interrupt(signum,frame):raise InterruptedError('ACTIVATION_INTERRUPTED')

def main():
    global OWNER
    if os.geteuid()!=0 or socket.gethostname()!='iZrj94o0jq479xfhoa83xoZ' or sys.argv[1:]!=['execute']:
        raise ValueError('ROOT_FIXED_ACTIVATION_ONLY')
    os.umask(0o077);ROOT.mkdir(mode=0o700)
    lock=open('/run/workspacex-devapp-deploy.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
    raw=(PLAN/'plan.json').read_bytes();assert hashlib.sha256(raw).hexdigest()==PLAN_HASH
    plan=json.loads(raw);rehearsal=json.loads((PLAN/'rehearsal-receipt.json').read_text())
    assert rehearsal['status']=='MIGRATION_REHEARSAL_VERIFIED' and rehearsal['planChecksum']==PLAN_HASH
    assert json.loads((Path('/root/wsx-devapp-5921-backup')/'physical-restore-receipt.json').read_text())['pgVerifybackup'] is True
    manifest=json.loads(Path('/root/wsx-devapp-5921-tools/host-manifest.json').read_text());assert manifest['tag']==TAG
    cfg=json.loads((RUNTIME/'compose-v3.json').read_text())
    for service in APPS:
        cfg['services'][service]['image']=manifest['images']['sandbox' if service=='sandbox-sessions' else service]['image']
    # User policy: initialization is a separately reviewed manual step.
    cfg['services']['api']['environment']['KERNEL_PLATFORM_SKILL_SELFHEAL']='off'
    (ROOT/'compose.json').write_bytes(encoded(cfg));compose(['config','--quiet'],'compose-validate')
    pg=json.loads(run(['docker','inspect',PG],'database-inspect'))[0]
    OWNER=dict(v.split('=',1) for v in pg['Config']['Env']).get('POSTGRES_USER','postgres')
    pgdata=Path(next(m['Source'] for m in pg['Mounts'] if m['Destination']=='/var/lib/postgresql/data'))
    assert pgdata==Path('/var/lib/docker/volumes/workspacex_workspacex_pgdata/_data')
    baseline=ROOT/'cold-database';assert pgdata.stat().st_dev==ROOT.stat().st_dev
    assert json.loads(sql('BEGIN READ ONLY; SELECT jsonb_object_agg(name,checksum) FROM _kernel_migrations; ROLLBACK;','baseline-ledger'))==plan['baselineLedger']
    saved_caddy=json.loads((PROBE/'caddy-before.json').read_text());assert caddy_get()==saved_caddy,'PROXY_CONFIG_CHANGED'
    maintenance=json.loads(json.dumps(saved_caddy));route={'@id':'wsx-devapp-release-5921','match':[{'host':['devapp.boardx.us'],'not':[{'remote_ip':{'ranges':['127.0.0.0/8','::1/128','47.77.215.155/32']}}]}],'handle':[{'handler':'static_response','status_code':503,'body':'DevApp is being upgraded. Please retry shortly.'}],'terminal':True}
    for server in maintenance['apps']['http']['servers'].values():server.setdefault('routes',[]).insert(0,route)
    (ROOT/'maintenance.json').write_bytes(encoded(maintenance));run(['caddy','validate','--config',str(ROOT/'maintenance.json')],'maintenance-validate')
    # Verify the browser itself before any traffic/service change.
    run(['/usr/bin/node',str(PROBE/'devapp-image-browser-probe.mjs'),'--preflight'],'browser-preflight',timeout=60)
    spec=importlib.util.spec_from_file_location('migration',PLAN/'devapp-reviewed-migration.py');driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
    fenced=False;cold_ready=False;public_state={'mayHaveOpened':False};database_stopped=False
    save('intent.json',{'status':'PREPARED','tag':TAG,'plan':PLAN_HASH})
    try:
        fenced=True
        save('maintenance-intent.json',{'status':'MAINTENANCE_LOAD_INTENT','tag':TAG})
        caddy_set(maintenance)
        assert caddy_get()==maintenance,'MAINTENANCE_READBACK'
        save('maintenance-ready.json',{'status':'WAITING_EXTERNAL_503_WITNESS','tag':TAG})
        # A root acknowledgment is written only after the operator observes HTTP 503
        # from outside this host. Never infer acknowledgment from elapsed time.
        for _ in range(150):
            if (ROOT/'external-503-witness.json').exists():
                witness=json.loads((ROOT/'external-503-witness.json').read_text());assert witness=={'origin':'https://devapp.boardx.us','status':503,'tag':TAG};break
            time.sleep(1)
        else:raise ValueError('EXTERNAL_MAINTENANCE_NOT_VERIFIED')
        run(['systemctl','stop','workspacex-api','workspacex-web'],'stop-systemd')
        run(['docker','stop','--time=30',*OLD],'stop-old-apps')
        # Writers are drained before the final cold recovery baseline is created.
        clients=json.loads(sql("SELECT jsonb_build_object('clients',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()))",'writer-drain'))
        assert clients=={'clients':0,'prepared':0},'DATABASE_WRITERS_NOT_DRAINED'
        run(['docker','stop','--time=60',PG],'stop-database');database_stopped=True
        cold_copy(pgdata,baseline)
        checksum=tree_hash(pgdata);assert tree_hash(baseline)==checksum,'COLD_BACKUP_DRIFT';cold_ready=True
        save('cold-backup.json',{'path':str(baseline),'sha256':checksum,'databaseWasStopped':True})
        run(['docker','start',PG],'start-database');database_stopped=False;wait_pg()
        for mode in ['schema','manual-data']:
            query,expected=driver.compile_step(plan,mode,PLAN_HASH)
            sql(query,'migration-'+mode)
            assert json.loads(sql('BEGIN READ ONLY; SELECT jsonb_object_agg(name,checksum) FROM _kernel_migrations; ROLLBACK;','readback-'+mode))==expected
            save('migration-'+mode+'.json',{'status':'COMMITTED_AND_READ_BACK','ledgerCount':len(expected),'plan':PLAN_HASH})
        compose(['up','--detach','--no-deps','--pull','never','--no-build',*APPS],'start-images')
        health();probe()
        for service in APPS:
            cid=compose(['ps','--quiet',service],'container-'+service).decode().strip()
            v=json.loads(run(['docker','inspect',cid],'inspect-'+service))[0]
            expected=manifest['images']['sandbox' if service=='sandbox-sessions' else service]['imageId']
            assert v['Image']==expected and v['State']['Running'] and v['RestartCount']==0,'RUNTIME_IMAGE_OR_STATE_MISMATCH'
        assert caddy_get()==maintenance,'PROXY_CHANGED_DURING_RELEASE'
        save('accepted.json',{'status':'ACCEPTED_BEHIND_MAINTENANCE','tag':TAG,'plan':PLAN_HASH})
        # There is no database rewind once public writes have been admitted.
        open_public(saved_caddy,public_state)
        save('receipt.json',{'status':'PUBLISHED','tag':TAG,'source':TAG[:40],'plan':PLAN_HASH,'completed':time.strftime('%Y-%m-%dT%H:%M:%S%z')})
        print('DEVAPP_FIRST_IMAGE_PUBLISHED',TAG,flush=True)
    except BaseException:
        if public_state['mayHaveOpened']:
            save('recovery.json',{'status':'PUBLIC_TRAFFIC_ALREADY_OPEN_NO_DATABASE_REWIND','tag':TAG});raise
        try:
            if cold_ready:
                stop_new();run(['docker','stop','--time=60',PG],'recovery-stop-database')
                assert tree_hash(baseline)==json.loads((ROOT/'cold-backup.json').read_text())['sha256']
                preserved=pgdata.with_name('_data.failed-release-5921');assert not preserved.exists()
                os.rename(pgdata,preserved);os.rename(baseline,pgdata)
                run(['docker','start',PG],'recovery-start-database');wait_pg()
            elif database_stopped or not json.loads(run(['docker','inspect',PG],'recovery-database-state'))[0]['State']['Running']:
                run(['docker','start',PG],'recovery-start-unchanged-database');wait_pg()
            restore_old_services(saved_caddy,maintenance,fenced)
            save('recovery.json',{'status':'OLD_SERVICE_BASELINE_RESTORED','tag':TAG})
            print('DEVAPP_ACTIVATION_FAILED_BASELINE_RESTORED',flush=True)
        except BaseException:
            save('recovery.json',{'status':'RECOVERY_NEEDS_OPERATOR_MAINTENANCE_RETAINED','tag':TAG});raise
        raise

if __name__=='__main__':main()
