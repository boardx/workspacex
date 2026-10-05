"""Storage only, not an acceptance verifier. Called after compiled producers."""
import hashlib,json,os,pathlib,stat,re
from host_transport import private
from writer_fence import require
APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0'
def publish_receipt(identity,lane,value):
    require(os.geteuid()==0 and lane in ('canonical','browser','services') and identity['sourceRevision']==APP and re.fullmatch('[A-Za-z0-9-]{1,128}',identity['attemptId']) and value['identity']==identity,'RECEIPT_STORAGE_SCOPE')
    path=pathlib.Path(f"/etc/workspacex-cn/maintenance-acceptance/{APP}/{identity['attemptId']}/{lane}.json")
    require('..' not in path.parts and '/' not in identity['attemptId'],'RECEIPT_STORAGE_PATH')
    # Deployment prepares the private attempt directory; storage cannot create
    # production configuration trees or follow symlink parents.
    for parent in path.parents:
        s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'RECEIPT_STORAGE_PARENT')
    raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode()+b'\n'
    require(len(raw)<=1024*1024,'RECEIPT_STORAGE_BOUND')
    tmp=path.with_name('.receipt-'+os.urandom(16).hex())
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        try:os.link(tmp,path,follow_symlinks=False)
        except FileExistsError:require(private(str(path))==raw,'RECEIPT_STORAGE_ALREADY_DIFFERENT')
        tmp.unlink();fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)
        require(private(str(path))==raw,'RECEIPT_STORAGE_READBACK')
        return dict(path=str(path),sha256=hashlib.sha256(raw).hexdigest())
    finally:
        if tmp.exists():tmp.unlink()
