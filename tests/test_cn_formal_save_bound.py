import io,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_cn_image_candidate as f
b,a,c=f.b,f.a,f.c
class Tests(unittest.TestCase):
    def test_real_stream_exact_boundary_and_overflow_never_written(self):
        for size in (31,32,33,100000):
            with self.subTest(size=size),tempfile.TemporaryDirectory() as td:
                target=Path(td)/'save.tar'
                with target.open('xb') as stream:
                    argv=[sys.executable,'-c',f'import sys;sys.stdout.buffer.write(b"x"*{size})']
                    if size<=32:self.assertEqual(b.run(argv,stdout_file=stream,stdout_limit=32),b'')
                    else:
                        with self.assertRaises(a.Rejected) as caught:b.run(argv,stdout_file=stream,stdout_limit=32)
                        self.assertEqual(caught.exception.args,('CANDIDATE_SAVE_LIMIT',))
                self.assertLessEqual(target.stat().st_size,32)
                if size<=32:self.assertEqual(target.read_bytes(),b'x'*size)
    def test_nonzero_and_write_error_preserve_failure(self):
        with self.assertRaises(b.CommandFailure) as caught:
            b.run([sys.executable,'-c','import sys;sys.stdout.write("x");sys.exit(23)'],stdout_file=io.BytesIO(),stdout_limit=32)
        self.assertEqual(caught.exception.returncode,23)
        class Broken:
            def write(self,data):raise OSError('fixture write error')
        with self.assertRaisesRegex(OSError,'fixture write error'):
            b.run([sys.executable,'-c','print("x")'],stdout_file=Broken(),stdout_limit=32)
    def test_produce_save_failures_remove_owned_outputs_and_staging(self):
        for kind in ('overflow','nonzero','empty','write'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as td:
                root=Path(td);p=f.plan();data=b'FROM fixture\n'
                for v in p['sourceContracts'].values():v['dockerfileSha256']=a.sha(data)
                calls=[]
                def command(argv,cwd=None,**kwargs):
                    calls.append(argv)
                    if argv[:3]==['git','rev-parse','HEAD']:return c.SOURCE.encode()
                    if argv[:2]==['git','show']:return data
                    if argv[:2]==['git','archive']:
                        with f.tarfile.open(argv[argv.index('--output')+1],'w') as t:
                            h=f.tarfile.TarInfo('fixture');h.size=1;t.addfile(h,io.BytesIO(b'x'))
                    if argv[:3]==['docker','image','save']:
                        self.assertNotIn('--output',argv);self.assertEqual(kwargs['stdout_limit'],p['maxArchiveBytes'])
                        if kind=='empty':return b''
                        kwargs['stdout_file'].write(b'partial')
                        if kind=='overflow':raise a.Rejected('CANDIDATE_SAVE_LIMIT')
                        if kind=='nonzero':raise b.CommandFailure('DOCKER_SAVE','COMMAND_NONZERO',19)
                        raise OSError('fixture disk error')
                    return b''
                with patch.object(b,'control'),patch.object(b.shutil,'disk_usage',return_value=type('Space',(),{'free':100*1024**3})()),patch.object(b,'normalize') as normalize:
                    with self.assertRaises((a.Rejected,b.CommandFailure,OSError)):
                        b.produce(p,a.json_bytes(p),root,root/'out','api',command)
                normalize.assert_not_called();self.assertEqual(list(root.iterdir()),[])
                self.assertEqual(b.STAGE,'DOCKER_SAVE')
if __name__=='__main__':unittest.main()
