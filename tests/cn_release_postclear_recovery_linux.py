#!/usr/bin/env python3
"""Disposable PostgreSQL + original A-route/candidate recovery fixture, no cloud."""
import hashlib,json,os,pwd,socket,subprocess,sys,tempfile,uuid,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
    if sys.platform!='linux' or os.geteuid()!=0:raise RuntimeError('LINUX_ROOT_REQUIRED')
    candidates=sorted(Path('/usr/lib/postgresql').glob('*/bin'),reverse=True)
    binary=next((p for p in candidates if all((p/n).is_file()for n in ('initdb','pg_ctl','psql','pg_dump','pg_restore'))),None)
    if binary is None:raise RuntimeError('POSTGRES_REQUIRED')
    node=Path(os.environ['CN_API_STARTUP_NODE']);loader=ROOT/'node_modules/tsx/dist/loader.mjs'
    if not node.is_absolute()or not node.is_file()or not loader.is_file():raise RuntimeError('NODE_TSX_REQUIRED')
    account=pwd.getpwnam('postgres');require=account.pw_uid!=0
    if not require:raise RuntimeError('NONROOT_POSTGRES_REQUIRED')
    receipts=[]
    for scenario in ('success','old-epoch','writer-unknown','partial-restore'):
        root=Path('/tmp/wsx-postclear-'+uuid.uuid4().hex);root.mkdir(mode=0o700)
        pgroot=Path(tempfile.mkdtemp(prefix='wsx-pg-postclear-',dir='/tmp'));os.chown(pgroot,account.pw_uid,account.pw_gid)
        data=pgroot/'data';started=False
        env={'PATH':str(binary)+':/usr/bin:/bin','HOME':str(pgroot),'LANG':'C.UTF-8','PGCONNECT_TIMEOUT':'5'}
        def run(args,pg=False,timeout=45):
            return subprocess.run([str(x)for x in args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=timeout,env=env,**({'user':account.pw_uid,'group':account.pw_gid,'extra_groups':[]}if pg else {}))
        try:
            with socket.socket()as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            run([binary/'initdb','-D',data,'-A','trust','-U','fixture_owner','--no-locale'],pg=True)
            run([binary/'pg_ctl','-D',data,'-l',pgroot/'server.log','-o',f"-c listen_addresses='127.0.0.1' -c port={port} -c unix_socket_directories='' -c fsync=on",'-w','start'],pg=True);started=True
            identifier=run([binary/'psql','-X','-A','-t','-h','127.0.0.1','-p',port,'-U','fixture_owner','-d','postgres','-c','SELECT system_identifier::text FROM pg_control_system();']).stdout.decode().strip()
            config=root/'postgres.json';config.write_text(json.dumps({'binDir':str(binary),'port':port,'systemIdentifier':identifier}));config.chmod(0o600)
            env['CN_POSTCLEAR_PYTHON']=sys.executable
            result=run([node,'--import',loader,ROOT/'tests/fixtures/cn-postclear-recovery/postgres.ts',root,scenario],timeout=120)
            raw=result.stdout
            if len(raw)>16384:raise RuntimeError('RESULT_LIMIT')
            receipt=json.loads(raw);receipts.append({'scenario':scenario,'rawSha256':hashlib.sha256(raw).hexdigest(),'result':receipt})
        except subprocess.CalledProcessError as error:
            print(json.dumps({'verified':False,'scenario':scenario,'returncode':error.returncode,'stderrSha256':hashlib.sha256(error.stderr or b'').hexdigest(),'stderrBytes':len(error.stderr or b''),'diagnosticCode':'FIXTURE_SUBPROCESS_FAILED'}))
            raise
        finally:
            stopped=not started
            if started:
                run([binary/'pg_ctl','-D',data,'-m','immediate','-w','stop'],pg=True);stopped=True
            if stopped:shutil.rmtree(pgroot);shutil.rmtree(root)
    print(json.dumps({'verified':True,'scope':'original A-route and candidate close-only chain with isolated PostgreSQL recovery','scenarios':receipts,'productionAccepted':False,'systemdValidated':False}))
    return 0
if __name__=='__main__':raise SystemExit(main())
