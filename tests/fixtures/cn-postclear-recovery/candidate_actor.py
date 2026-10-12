"""Persistent isolated actor: original hold CAS and candidate close-only code.
Docker and provider observations use existing source-owned test transport fixtures.
No production path is written and no production CLI is invoked.
"""
import fcntl,json,os,re,sys,subprocess,copy
from pathlib import Path
from postgres_peer import read_peer,sql_error_code
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'.harness/scripts/vm'))
from cn_maintenance_hold import HoldStore
from test_candidate_host_transport import Tests,Probes
from test_candidate_writer import seal_fixture
from writer_fence import digest,DATABASES
from unittest.mock import patch

def main():
    root=Path(sys.argv[1]);assert re.fullmatch(r'/tmp/wsx-postclear-[a-f0-9]{32}',str(root))
    st=root.lstat();assert root.is_dir()and not root.is_symlink()and st.st_uid==os.getuid()and st.st_mode&0o777==0o700
    runtime=root/'hold';runtime.mkdir(mode=0o700)
    lock=os.open(root/'release.lock',os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    os.dup2(lock,9)
    store=HoldStore(str(runtime.resolve()),os.getuid(),runtime.stat().st_gid);f=Tests();f.setUp()
    try:
        config_path=root/'postgres.json'
        if config_path.exists():
            cfg=json.loads(config_path.read_bytes())
            assert set(cfg)=={'binDir','port','systemIdentifier'} and type(cfg['port'])is int and 1024<cfg['port']<65536
            assert re.fullmatch(r'/usr/lib/postgresql/[0-9]+/bin',cfg['binDir']) and re.fullmatch('[0-9]+',cfg['systemIdentifier'])
            def sql(db,query):
                assert db in DATABASES
                r=subprocess.run([cfg['binDir']+'/psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',str(cfg['port']),'-U','fixture_owner','-d',db],input=query.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,check=False)
                if r.returncode:raise RuntimeError(sql_error_code(r.stderr))
                return r.stdout.decode().strip()
            def login():
                rows=json.loads(sql(DATABASES[0],"SELECT json_object_agg(rolname,rolcanlogin) FROM pg_roles WHERE rolname IN ('app','lane','migration_admin');"))
                return {'kind':'role-login-v1','login':{db:copy.deepcopy(rows)for db in DATABASES}}
            for db in DATABASES:
                peer=read_peer(sql,db,cfg)
                f.p['databasePeers'][db]=peer
                for row in f.p['heldSessions'][db]+f.p['candidateSessions'][db]:row['peerSha256']=digest(peer)
            f.host.plan['databasePeers']=copy.deepcopy(f.p['databasePeers'])
            class ActualLoginProbes(Probes):
                def admission(self):return login(),{}
            real_probe=patch('candidate_host_transport.FixedProbes',ActualLoginProbes);real_probe.start();f.addCleanup(real_probe.stop)
            old_observe=f.host.observe
            def observe(plan):
                f.host.login=login();return old_observe(plan)
            f.host.observe=observe
            def execute(db,query,control=False):
                assert control;sql(db,query);f.host.login=login()
            f.host.database_execute=execute
        actor=None
        f.host.read_hold=store.read
        print(json.dumps({'identity':f.identity,'oldGeneration':f.p['holdGeneration'],'completion':json.loads(f.raw)}),flush=True)
        for line in sys.stdin:
            message=json.loads(line);assert set(message)<= {'action','data'}
            action=message['action']
            try:
                if action=='create':
                    value=store.create(f.identity)
                    if actor is None:
                        old=f.p['holdGeneration'];f.p['holdGeneration']=value['generation']
                        for event in f.j.value['events']:
                            if event.get('holdGeneration')==old:event['holdGeneration']=value['generation']
                        actor=f.actor()
                        def collect(plan,nonce,expected_hold_state='held'):
                            assert store.read()['state']==expected_hold_state
                            return seal_fixture(plan,nonce)
                        actor.transport.collector.collect=collect
                elif action=='read':value=store.read()
                elif action=='clear':value=store.clear(message['data'])
                elif action=='lock':
                    named=(root/'release.lock').stat();opened=os.fstat(9);assert (named.st_dev,named.st_ino)==(opened.st_dev,opened.st_ino)
                    probe=os.open(root/'release.lock',os.O_RDWR)
                    try:
                        try:fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
                        except BlockingIOError:pass
                        else:raise AssertionError('LOCK_NOT_HELD')
                    finally:os.close(probe)
                    value={'held':True}
                elif action=='state':value={'running':f.host.running,'hold':store.read(),'resumeDisabled':actor.resume_disabled,'commands':f.host.commands,'events':f.j.value['events']}
                elif action in actor.operations:value=actor.dispatch(action,f.identity)
                else:raise AssertionError('FIXED_ACTION_REQUIRED')
                print(json.dumps({'ok':True,'value':value}),flush=True)
            except BaseException as error:
                print(json.dumps({'ok':False,'code':str(error)if re.fullmatch('[A-Z_]{1,100}',str(error))else type(error).__name__}),flush=True)
    finally:f.doCleanups();os.close(9);os.close(lock)
if __name__=='__main__':main()
