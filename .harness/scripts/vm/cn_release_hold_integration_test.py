import fcntl,json,os,pathlib,subprocess,sys,tempfile,unittest
D=pathlib.Path(__file__).parent
class Integration(unittest.TestCase):
 def test_real_crossprocess_canonical_lock_and_admission(self):
  for state in ('absent','held','unknown','unlocked','foreign'):
   with self.subTest(state=state),tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as temp:
    p=pathlib.Path(temp);p.chmod(0o700);lock=p/'release.lock';lock.touch(mode=0o600);fd=os.open(lock,os.O_RDWR)
    if state!='unlocked':fcntl.flock(fd,fcntl.LOCK_EX)
    if state=='held':(p/'hold.json').write_text(json.dumps({'schemaVersion':1,'state':'held','generation':'a'*32,'identity':{'sourceRevision':'9'*40,'baselineRevision':'b'*40,'migrationPlanSha256':'c'*64,'attemptId':'fixture'}}));(p/'hold.json').chmod(0o600)
    if state=='unknown':(p/'hold.json').write_text('{}');(p/'hold.json').chmod(0o600)
    childfd=fd
    if state=='foreign':childfd=os.open(lock,os.O_RDWR)
    runner="import sys,os;sys.path.insert(0,sys.argv[1]);import cn_maintenance_hold as h;os.dup2(int(sys.argv[3]),9);h.require_canonical_lock(sys.argv[2]+'/release.lock',os.getuid(),os.getgid());h.HoldStore(sys.argv[2],os.getuid(),os.getgid()).admit_ordinary_release();open(sys.argv[2]+'/mutation-marker','w').write('reached')"
    try:r=subprocess.run([sys.executable,'-c',runner,str(D),temp,str(childfd)],pass_fds=(childfd,),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    finally:
     if childfd!=fd:os.close(childfd)
     os.close(fd)
    self.assertEqual(r.returncode==0,state=='absent');self.assertEqual((p/'mutation-marker').exists(),state=='absent')
 def test_entrypoint_order_in_actual_shell_subprocess(self):
  # Execute the actual bounded admission block: root-only paths/stat are mapped
  # to disposable fixtures; production CLI itself retains fixed paths/owners.
  for name in ('build-cn-release-candidate.sh','deploy-cn-production.sh'):
   source=(D/name).read_text();start=source.index('# Maintenance admission');end=source.index('\n',source.index('maintenance hold blocks ordinary release',start))+1;block=source[start:end]
   self.assertLess(source.index('flock -n 9'),start)
   for operation in ('restore_baseline ||','prepare_started','activation_started=1'):
    if operation in source:self.assertLess(start,source.rindex(operation))
   for accepted in (False,True):
    with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as temp:
     p=pathlib.Path(temp);helper=p/'helper.py';helper.write_text('import sys;sys.exit('+('0' if accepted else '1')+')');helper.chmod(0o700)
     fixtureblock=block.replace('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py',str(helper))
     script="set -e; fail(){ exit 1; }; stat(){ echo 0:0:700:1; }; RUNTIME_ROOT="+temp+'\n'+fixtureblock+'\ntouch '+temp+'/marker\n'
     r=subprocess.run(['bash','-c',script],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
     self.assertEqual(r.returncode==0,accepted,r.stderr.decode());self.assertEqual((p/'marker').exists(),accepted)
if __name__=='__main__':unittest.main()
