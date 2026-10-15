#!/usr/bin/env python3
"""Standalone approved nine-file bootstrap; never imports or executes payload code.

Trusted filesystem/CAS primitives intentionally copied from the old installer:
bootstrap cannot import that module before the approved closure exists.
"""
import base64, ctypes, datetime as dt, hashlib, json, os, re, resource, stat, subprocess, sys, tempfile
from pathlib import Path
OWNER=(0,0)
LIMIT=1048576
POLICIES=Path('/etc/workspacex-cn/complete-runtime-bootstrap-approvals')
JOURNALS=Path('/var/lib/workspacex-cn/complete-runtime-bootstrap')
DESTINATION=Path('/usr/local/lib/workspacex-cn/complete-runtime-bootstrap')
ENTRY=Path('/usr/local/lib/workspacex-cn/cn-complete-runtime-bootstrap.py')
INSTANCE='i-uf6ga92ewloganobbln6'
FILES=('cn-complete-runtime-carrier.py','install-cn-complete-runtime.py','install-cn-candidate-runtime.py','cn_candidate_github.py','cn_candidate_revalidation.py','cn_image_candidate.py','cn_image_archive.py','hosted-release.py','canonical_control.py')

def need(value, code):
    if not value: raise ValueError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def trusted(fd, mode=None):
    value = os.fstat(fd)
    need(stat.S_ISDIR(value.st_mode) and (value.st_uid,value.st_gid) == OWNER
         and not value.st_mode & 0o022 and (mode is None or stat.S_IMODE(value.st_mode)==mode), 'DIRECTORY_TRUST')


def directory(path, create=False):
    need(Path(path).is_absolute() and '..' not in Path(path).parts, 'DIRECTORY_PATH')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        trusted(fd)
        for part in Path(path).parts[1:]:
            if create:
                try: os.mkdir(part,0o700,dir_fd=fd)
                except FileExistsError: pass
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child;trusted(fd)
        return fd
    except BaseException:
        os.close(fd);raise


def read(parent,name,expected=None,mode=0o600,maximum=LIMIT):
    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
    with os.fdopen(fd,'rb') as stream:
        before=os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and (before.st_uid,before.st_gid)==OWNER
             and before.st_nlink==1 and stat.S_IMODE(before.st_mode)==mode
             and 0 <= before.st_size <= maximum,'FILE_TRUST')
        raw=stream.read(maximum+1)
        ident=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        need(len(raw)<=maximum and ident(before)==ident(os.fstat(stream.fileno()))
             ==ident(os.stat(name,dir_fd=parent,follow_symlinks=False)),'FILE_CHANGED')
        if expected is not None:
            need(len(raw)==expected['size'] and sha(raw)==expected['sha256'],'FILE_HASH')
        return raw


def decode(raw):
    def pairs(items):
        result={}
        for key,value in items:
            need(key not in result,'DUPLICATE_JSON_KEY');result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=pairs)


def no_replace(parent,stage,name):
    libc=ctypes.CDLL(None,use_errno=True)
    need(hasattr(libc,'renameat2'),'ATOMIC_NOREPLACE_UNSUPPORTED')
    fn=libc.renameat2
    fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    fn.restype=ctypes.c_int
    need(fn(stage,os.fsencode(name),parent,os.fsencode(name),1)==0,'TARGET_COLLISION')



def encode(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def instant(value):
    result=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    need(result.tzinfo is not None,'TIMEZONE');return result

def validate_policy(raw,pin,now):
    need(sha(raw)==pin,'POLICY_HASH');p=decode(raw)
    need(set(p)=={'kind','instanceId','issuedAt','expiresAt','entry','githubProvider','manifest','manifestSha256'} and p['kind']=='cn-complete-runtime-bootstrap-policy-v1' and p['instanceId']==INSTANCE,'POLICY_SCHEMA')
    start,end=instant(p['issuedAt']),instant(p['expiresAt'])
    need(start<=now<end and 0<(end-start).total_seconds()<=1800,'POLICY_WINDOW')
    need(set(p['entry'])=={'path','sha256'} and p['entry']['path']==str(ENTRY) and re.fullmatch('[a-f0-9]{64}',p['entry']['sha256']),'ENTRY_PIN')
    m=p['manifest'];need(set(m)=={'kind','revision','files','installationAuthorized','includesRuntimePayload'} and m['kind']=='cn-complete-runtime-bootstrap-v1' and m['installationAuthorized'] is False and m['includesRuntimePayload'] is False and re.fullmatch('[a-f0-9]{40}',m['revision']) and set(m['files'])==set(FILES),'MANIFEST_SCHEMA')
    need(sha(encode(m))==p['manifestSha256'],'MANIFEST_HASH')
    for row in m['files'].values():
        need(set(row)=={'sha256','bytes','mode'} and re.fullmatch('[a-f0-9]{64}',row['sha256']) and type(row['bytes']) is int and 0<row['bytes']<=LIMIT and row['mode']=='0600','FILE_PIN')
    h=p['githubProvider']
    need(set(h)=={'ghExecutable','ghSha256','ghConfigDirectory','authentication'} and h['authentication']=='existing-root-gh' and h['ghConfigDirectory']=='/root/.config/gh' and type(h['ghExecutable']) is str and str(Path(h['ghExecutable']))==h['ghExecutable'] and Path(h['ghExecutable']).is_absolute() and '..' not in Path(h['ghExecutable']).parts and re.fullmatch('[a-f0-9]{64}',h['ghSha256']),'PROVIDER_PIN')
    return p

def decode_content(raw,name,row):
    need(type(raw) is bytes and len(raw)<=2*LIMIT,'CONTENTS_LIMIT');v=decode(raw)
    need(v.get('type')=='file' and v.get('path')=='scripts/'+name and v.get('name')==name and v.get('size')==row['bytes'] and v.get('encoding')=='base64' and type(v.get('content')) is str,'CONTENTS_IDENTITY')
    try:content=base64.b64decode(v['content'].replace('\n',''),validate=True)
    except Exception:raise ValueError('CONTENTS_BASE64') from None
    need(len(content)==row['bytes'] and sha(content)==row['sha256'],'CONTENTS_HASH');return content

def github_environment(environment):
    need(environment.get('HOME')=='/root','EXISTING_ROOT_HOME')
    result=dict(environment)
    for key in ('GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN'):result.pop(key,None)
    result.update(GH_CONFIG_DIR='/root/.config/gh',GH_PROMPT_DISABLED='1');return result

class Github:
    def __init__(self,binary,environment,deadline):self.binary=binary;self.environment=environment;self.deadline=deadline
    def contents(self,revision,name):
        # Fixed public repository and literal code path; caller paths never enter URL.
        need(name in FILES and re.fullmatch('[a-f0-9]{40}',revision),'FETCH_SCOPE')
        with tempfile.TemporaryFile() as out:
            remaining=(self.deadline-dt.datetime.now(dt.timezone.utc)).total_seconds();need(remaining>0,'POLICY_WINDOW')
            result=subprocess.run([self.binary,'api','--hostname','github.com','/repos/boardx/workspacex/contents/scripts/'+name+'?ref='+revision],env=self.environment,stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.DEVNULL,timeout=min(remaining,60),check=False,preexec_fn=lambda:resource.setrlimit(resource.RLIMIT_FSIZE,(2*LIMIT,2*LIMIT)))
            need(result.returncode==0 and out.tell()<=2*LIMIT,'GITHUB_CONTENTS_FAILED');out.seek(0);return out.read(2*LIMIT+1)

def save(parent,name,raw):
    fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
    with os.fdopen(fd,'wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
    os.fsync(parent)

def materialize(p,pin,provider,journals,destination,clock=lambda:dt.datetime.now(dt.timezone.utc),publish=no_replace):
    # dirfds are trusted by CLI; tests use disposable directories, never real roots.
    need(instant(p['issuedAt'])<=clock()<instant(p['expiresAt']),'POLICY_WINDOW')
    os.mkdir(pin,0o700,dir_fd=journals);os.fsync(journals)
    journal=os.open(pin,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=journals)
    stage=None
    try:
        save(journal,'intent.json',encode({'policySha256':pin,'retryAllowed':False,'payloadExecuted':False}))
        # Random stage lives beneath the same trusted destination filesystem.
        stage='stage-'+os.urandom(16).hex();os.mkdir(stage,0o700,dir_fd=destination)
        stagefd=os.open(stage,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=destination)
        try:
            name=p['manifestSha256'];os.mkdir(name,0o700,dir_fd=stagefd)
            root=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=stagefd)
            try:
                os.mkdir('scripts',0o700,dir_fd=root);scripts=os.open('scripts',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=root)
                try:
                    for filename,row in p['manifest']['files'].items():
                        need(clock()<instant(p['expiresAt']),'POLICY_WINDOW')
                        save(scripts,filename,decode_content(provider.contents(p['manifest']['revision'],filename),filename,row))
                finally:os.close(scripts)
                save(root,'manifest.json',encode(p['manifest']));os.fsync(root)
            finally:os.close(root)
            need(clock()<instant(p['expiresAt']),'POLICY_WINDOW');os.fsync(stagefd)
            publish(destination,stagefd,name);os.fsync(destination);os.fsync(stagefd)
        finally:os.close(stagefd)
        report={'kind':'cn-complete-runtime-bootstrap-receipt-v1','manifestSha256':p['manifestSha256'],'policySha256':pin,'bootstrapCodeMaterialized':True,'payloadExecuted':False,'runtimeInstallationPerformed':False,'sudoChanged':False,'retryAllowed':False}
        save(journal,'receipt.json',encode(report));return report
    finally:
        os.close(journal)
        # Retain incomplete stage on failure for explicit reconciliation; never retry.
        if stage is not None:
            try:os.rmdir(stage,dir_fd=destination);os.fsync(destination)
            except OSError:pass

def pinned_read(path,pin,maximum=LIMIT,mode=0o600):
    parent=directory(path.parent)
    try:raw=read(parent,path.name,mode=mode,maximum=maximum);need(sha(raw)==pin,'PINNED_FILE_HASH');return raw
    finally:os.close(parent)

def main():
    need(len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]) and os.geteuid()==os.getegid()==0 and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode,'EXPLICIT_ROOT_ENTRY')
    pin=sys.argv[1];parent=directory(POLICIES)
    try:raw=read(parent,pin+'.json',maximum=LIMIT)
    finally:os.close(parent)
    p=validate_policy(raw,pin,dt.datetime.now(dt.timezone.utc))
    need(Path(__file__).absolute()==ENTRY,'FIXED_ENTRY');pinned_read(ENTRY,p['entry']['sha256'],mode=0o700)
    parent=directory('/var/lib/cloud/data')
    try:identity=read(parent,'instance-id',mode=0o644,maximum=128)
    finally:os.close(parent)
    need(identity.decode('ascii').strip()==INSTANCE,'HOST_IDENTITY')
    host=p['githubProvider'];binary=Path(host['ghExecutable']);parent=directory(binary.parent)
    try:
        st=os.stat(binary.name,dir_fd=parent,follow_symlinks=False)
        need(stat.S_IMODE(st.st_mode) in (0o700,0o755),'GITHUB_MODE')
        raw=read(parent,binary.name,mode=stat.S_IMODE(st.st_mode),maximum=134217728);need(sha(raw)==host['ghSha256'],'GITHUB_BINARY_HASH')
    finally:os.close(parent)
    config=directory(host['ghConfigDirectory']);os.close(config) # No credential raw read.
    environment=github_environment(os.environ)
    journals=directory(JOURNALS);destination=directory(DESTINATION)
    try:
        trusted(journals,0o700);trusted(destination,0o700)
        report=materialize(p,pin,Github(str(binary),environment,instant(p['expiresAt'])),journals,destination)
    finally:os.close(journals);os.close(destination)
    print(json.dumps(report,sort_keys=True))
if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z][A-Z0-9_]{1,80}',str(error)) else 'UNCLASSIFIED_FAILURE'
        print('CN_COMPLETE_RUNTIME_BOOTSTRAP_REJECTED:'+code,file=sys.stderr);raise SystemExit(20)
