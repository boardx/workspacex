import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('release',Path(__file__).parents[1]/'scripts/cn-reviewed-schema-release.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class FailureIsolation(unittest.TestCase):
 def test_public_failure_and_database_timeout_reholds_before_query(self):
  self.exercise_failure(False)
 def test_activation_retry_never_replays_database_writers(self):
  self.exercise_failure(True)
 def exercise_failure(self,activation_only):
  with tempfile.TemporaryDirectory() as td,contextlib.ExitStack() as stack:
   root=Path(td);runtime=root/'runtime';runtime.mkdir();attempt=root/'attempt';attempt.mkdir()
   nginx=root/'nginx.conf';original=b'server_name app.boardx.com.cn;\nserver_name app.boardx.com.cn;';nginx.write_bytes(original)
   files=[runtime/'compose.json'];files[0].write_text('{}')
   vals={'PGHOST':'pgm-uf6rg214cp381l49.rwlb.rds.aliyuncs.com','PGDATABASE':'workspacex_a1cb_20261006','PGPORT':'5432'}
   for n in ['migration.env','bootstrap.env']:(runtime/n).write_text('\n'.join(k+'='+v for k,v in vals.items()))
   plan=root/'plan.json';raw=json.dumps({'source':m.SOURCE,'baseline':m.BASELINE}).encode();plan.write_bytes(raw)
   driver=root/'driver.mjs';driver.write_text('fixture')
   paths={'/root/wsx-cn-5917-schema-plan.json':plan,'/root/wsx-cn-5917-migration-driver.mjs':driver}
   def private(p):return paths.get(str(p),Path(p))
   before={s:{'Id':'old-'+s,'Image':m.OLD_IMAGES[s],'Config':{'Env':[k+'='+v for k,v in vals.items()]},'RestartCount':0} for s in m.SERVICES}
   sig={'unchanged':True}
   m.save(attempt/'baseline.json',{s:{'containerId':x['Id'],'signatureSha256':m.sha(json.dumps(sig,sort_keys=True).encode())} for s,x in before.items()})
   m.save(attempt/'input-hashes.json',{str(p):m.sha(p.read_bytes()) for p in files+[runtime/'bootstrap.env',runtime/'migration.env',nginx,driver]})
   m.save(attempt/'state.json',{'stage':'PREPARED','preparedAt':time.time(),'activationOnly':activation_only})
   events=[];public_calls=0;db_calls=0;database_modes=[]
   def nginx_write(b):nginx.write_bytes(b);events.append('held' if b'if ($remote_addr' in b else 'public')
   def browser(loopback=False,candidate=False):
    nonlocal public_calls
    if loopback:return {'passed':True}
    public_calls+=1
    if public_calls:raise m.Rejected('BROWSER_ACCEPTANCE_FAILED')
   def db(*a):
    nonlocal db_calls
    db_calls+=1;database_modes.append(a[-1])
    if activation_only:
     if db_calls==1:return {'status':'COMPLETE'}
    else:
     if db_calls<=2:return {'status':'COMMITTED'}
     if db_calls==3:return {'status':'COMPLETE'}
    events.append('failed-recovery-query');self.assertIn(b'if ($remote_addr',nginx.read_bytes());raise TimeoutError()
   replacements={'RUNTIME':runtime,'ATTEMPT':attempt,'FILES':files,'NGINX':nginx,'PLAN_SHA':m.sha(raw),'private':private,
    'compose':lambda f:['compose'],'djson':lambda *a,**k:{'services':dict.fromkeys(m.SERVICES+['sandbox-sessions'],{})},
    'live':lambda **k:before,'signature':lambda x:sig,'image':lambda p,s:'image-'+s,
    'docker':lambda *a,**k:None,'completed_schema_proof':lambda:None,'backup':lambda p:{'fixture':True},'probe_db':db,'browser':browser,'nginx_write':nginx_write}
   for key,value in replacements.items():stack.enter_context(patch.object(m,key,value))
   stack.enter_context(patch.object(m.os,'geteuid',return_value=0));stack.enter_context(patch.object(m.socket,'gethostname',return_value='workspacex-cn-prod'))
   lock=(root/'lock');lock.write_text('');lockfd=open(lock,'r')
   real_open=m.os.open
   def os_open(p,*args,**kw):return real_open(lock,*args,**kw) if str(p)=='/var/lib/workspacex-cn/runtime/release.lock' else real_open(p,*args,**kw)
   stack.enter_context(patch.object(m.os,'open',side_effect=os_open));stack.enter_context(patch.object(m.sys,'argv',(['release','activate-complete-schema'] if activation_only else ['release','apply','--manual-cn-initialization'])))
   with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(SystemExit):m.main()
   self.assertIn('failed-recovery-query',events)
   self.assertEqual(events[-1],'held')
   if activation_only:self.assertTrue(database_modes and all(mode=='status' for mode in database_modes))
   self.assertFalse((attempt/'receipt.json').exists())
   result=json.loads((attempt/'failure.json').read_text())
   self.assertEqual(result['recovery'],'OPERATOR_RECONCILIATION_REQUIRED');self.assertTrue(result['maintenanceHeld'])
   lockfd.close()

class ArchiveValidation(unittest.TestCase):
 def test_full_decryption_finishes_before_early_toc_consumer(self):
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as td:
   p=Path(td);complete=[]
   def anonymous_fd(*args,**kwargs):
    import os
    fd,path=tempfile.mkstemp(dir=td);os.unlink(path);return fd
   def child(args,**kw):
    if 'openssl' in args[0]:
     kw['stdout'].write(b'PGDMP'+b'X'*100000);kw['stdout'].flush();complete.append(True);return SimpleNamespace(returncode=0)
    self.assertEqual(complete,[True]);self.assertEqual(kw['stdin'].read(5),b'PGDMP')
    return SimpleNamespace(returncode=0,stdout=b'; TOC _kernel_migrations')
   with patch.object(m.os,'memfd_create',side_effect=anonymous_fd,create=True),patch.object(m.os,'MFD_CLOEXEC',1,create=True),patch.object(m.subprocess,'run',side_effect=child):
    m.verify_backup_archive(p/'key',p/'encrypted','image')
 def test_bad_decryption_never_reaches_toc(self):
  from types import SimpleNamespace
  import os
  with tempfile.TemporaryFile() as f,patch.object(m.os,'memfd_create',return_value=os.dup(f.fileno()),create=True),patch.object(m.os,'MFD_CLOEXEC',1,create=True),patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=1)) as child:
   with self.assertRaisesRegex(m.Rejected,'BACKUP_DECRYPTION_FAILED'):m.verify_backup_archive(Path('key'),Path('backup'),'image')
   self.assertEqual(child.call_count,1)

if __name__=='__main__':unittest.main()
