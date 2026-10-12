#!/usr/bin/env python3
"""Disposable PostgreSQL + original A-route/candidate recovery fixture, no cloud."""
import hashlib,json,os,pwd,socket,subprocess,sys,tempfile,uuid,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def safe_diagnostic(raw):
    # Launcher emits only this fixed schema. Unknown/import-before-launch errors
    # retain the original hash/length evidence without revealing raw stderr.
    if len(raw)>16384:return None
    import re
    stages={'module-load','read-config','facts-rows','facts-catalog','create-roles','create-source-databases','controller-start','postclear-write','controller-reheld','observe-writers','capture-catalog','dump','write-archive','restore-archive-identity','create-target','restore','restore-catalog','unknown'}
    reasons={'UNCLASSIFIED','FIXED_FIXTURE_SCOPE','FIXTURE_TOOLS','DATABASE_SCOPE','UNEXPECTED_SCHEMA_TABLE','POSTCLEAR_ROW_MISSING','ACTOR_LOGIN_PEER_CAS','ACTOR_LOGIN_STATE_CAS','ACTOR_FIXTURE_SQL_FAILED','ACTOR_EOF','ACTOR_DEADLINE','ORIGINAL_CATCH_NOT_COMPLETED','ACTUAL_REBLOCK_REQUIRED','RECOVERY_DID_NOT_COMPLETE','ORIGINAL_CATALOG_FACTS_DIFFER','FIXTURE_SQL_IDENTITY','FIXTURE_ACTUAL_CLUSTER','FIXTURE_ACTUAL_SOCKET','ROLE_MISSING','FACT_SCOPE','SOURCE_CATALOG_CHANGED','SOURCE_CHANGED_DURING_CAPTURE','SOURCE_CHANGED_ACROSS_CAPTURE','WRITER_STILL_ACCEPTS','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'}
    lines=[line for line in raw.splitlines()if line.startswith(b'CN_POSTCLEAR_DIAGNOSTIC ')]
    if len(lines)!=1:return None
    try:
        fixed=json.loads((ROOT/'tests/fixtures/cn-postclear-recovery/fixed-error-codes.json').read_bytes())
        reasons.update(fixed['actorReasons']);reasons.update(fixed['routeReasons'])
        v=json.loads(lines[0].split(b' ',1)[1])
        if set(v)!={'kind','stage','reason','sqlstate','childExit','stderrBytes','stderrSha256'}:return None
        if v['kind']!='postclear-fixture-diagnostic-v1' or v['stage'] not in stages or v['reason'] not in reasons:return None
        if v['sqlstate'] is not None and v['sqlstate'] not in {'42501','42703','42P01','42704','42883','42601','23505','23503','25006','28000','28P01','53300','53100','53200','57014','57P01','08001','08006'}:return None
        if v['childExit'] is not None and (type(v['childExit'])is not int or abs(v['childExit'])>=256):return None
        if type(v['stderrBytes'])is not int or not 0<=v['stderrBytes']<=10485760:return None
        if not isinstance(v['stderrSha256'],str)or not re.fullmatch('[a-f0-9]{64}',v['stderrSha256']):return None
        return v
    except (ValueError,TypeError,KeyError):return None

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
            result=run([node,'--import',loader,ROOT/'tests/fixtures/cn-postclear-recovery/diagnostic-launcher.ts',root,scenario],timeout=120)
            raw=result.stdout
            if len(raw)>16384:raise RuntimeError('RESULT_LIMIT')
            receipt=json.loads(raw);receipts.append({'scenario':scenario,'rawSha256':hashlib.sha256(raw).hexdigest(),'result':receipt})
        except subprocess.CalledProcessError as error:
            print(json.dumps({'verified':False,'scenario':scenario,'returncode':error.returncode,'stderrSha256':hashlib.sha256(error.stderr or b'').hexdigest(),'stderrBytes':len(error.stderr or b''),'diagnosticCode':'FIXTURE_SUBPROCESS_FAILED','fixtureDiagnostic':safe_diagnostic(error.stderr or b'')}))
            raise
        finally:
            stopped=not started
            if started:
                run([binary/'pg_ctl','-D',data,'-m','immediate','-w','stop'],pg=True);stopped=True
            if stopped:shutil.rmtree(pgroot);shutil.rmtree(root)
    print(json.dumps({'verified':True,'scope':'original A-route and candidate close-only chain with isolated PostgreSQL recovery','scenarios':receipts,'productionAccepted':False,'systemdValidated':False}))
    return 0
if __name__=='__main__':raise SystemExit(main())
