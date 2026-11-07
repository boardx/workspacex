"""Disposable Linux root lock proof; no host production paths are touched."""
import fcntl,os,pathlib,re,subprocess,sys,tempfile
assert os.geteuid()==0 and sys.platform=='linux'
source=pathlib.Path(__file__).with_name('cn-auto-evidence-stage.mjs').read_text()
proof=re.search(r'export const LOCK_PROOF=String.raw`(.*?)`;',source,re.S)[1]
with tempfile.TemporaryDirectory(prefix='cn-evidence-lock-') as temp:
 path=pathlib.Path(temp)/'release.lock'
 fd=os.open(path,os.O_CREAT|os.O_RDWR,0o600)
 if fd!=9:os.dup2(fd,9);os.close(fd)
 code=proof.replace('/var/lib/workspacex-cn/runtime/release.lock',str(path))
 def run():return subprocess.run([sys.executable,'-B','-c',code],pass_fds=(9,),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode
 assert run()!=0,'unlocked descriptor passed'
 fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert run()==0,'actual inherited FLOCK was not recognized'
 path.unlink();path.write_bytes(b'');path.chmod(0o600)
 assert run()!=0,'replaced lock inode passed'
 os.close(9)
print('CN_AUTO_EVIDENCE_LOCK_BOUNDARIES_PASSED')
