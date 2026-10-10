"""Exact source transition without historical identity or diagnostic expansion."""
import importlib.util,io,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import test_cn_image_candidate as f
b,a,c=f.b,f.a,f.c
NEW='5285bef9a6c91bbb9857ede42779aafa64b98f32'
class SourceAdmission(unittest.TestCase):
    def plan(self):
        p=f.plan();p['sourceRevision']=NEW;return p
    def archive(self,path,p):
        return f.archive(path,p,'api',labels={'org.opencontainers.image.revision':p['sourceRevision'],c.LABEL:c.identity(p)})
    def test_exact_list_and_legacy_golden_identity(self):
        self.assertEqual(c.SOURCE,'55d904af3edcca54b2fbe17bba59ed2eed09323b')
        self.assertEqual(c.FORMAL_SOURCES,{c.SOURCE,NEW})
        self.assertEqual(c.identity(f.plan()),'022b995c3bf4640f07df026e33e95a7fd8c11d63a509f77caae131859ca55b15')
        self.assertNotEqual(c.identity(self.plan()),c.identity(f.plan()))
        for source in ['a'*40,'main',NEW.upper(),None,[],True]:
            p=self.plan();p['sourceRevision']=source
            with self.subTest(source=source),self.assertRaises(a.Rejected):c.validate_plan(p)
    def test_old_receipt_and_tar_still_verify(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=f.plan();entry=f.archive(root/'api.tar',p,'api');raw=a.json_bytes(f.receipt(p,{'api':entry}))
            result=c.verify_bundle(root,p,raw,a.sha(raw),a.sha(a.json_bytes(p)),complete=False)
            self.assertFalse(result['releaseReady'])
    def test_new_archive_and_cross_source_rejection(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=self.plan();entry=self.archive(root/'api.tar',p)
            raw=a.json_bytes(f.receipt(p,{'api':entry}));c.verify_bundle(root,p,raw,a.sha(raw),a.sha(a.json_bytes(p)),complete=False)
            with self.assertRaisesRegex(a.Rejected,'CANDIDATE_TAG'):c.inspect(root/'api.tar',f.plan(),'api')
            # Correct new identity label cannot disguise an old revision label.
            bad=root/'bad.tar'
            with self.assertRaisesRegex(a.Rejected,'CANDIDATE_LABELS'):
                f.archive(bad,p,'api',labels={'org.opencontainers.image.revision':c.SOURCE,c.LABEL:c.identity(p)})
    def test_diagnostic_entries_reject_new_source_before_commands(self):
        p=self.plan();env={'EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/main','GITHUB_SHA':p['controlRevision']}
        for name in ['diagnose-cn-image-candidate.py','diagnose-cn-agent-postbuild.py']:
            spec=importlib.util.spec_from_file_location('source_diag',Path(__file__).resolve().parents[1]/'scripts'/name);d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
            calls=[]
            with self.subTest(name=name),self.assertRaisesRegex(a.Rejected,'DIAGNOSTIC_SOURCE_NOT_ALLOWED'):
                d.execute(a.json_bytes(p),'/missing','/missing',env,command=lambda *args,**kw:calls.append(args))
            self.assertEqual(calls,[])
    def test_producer_binds_every_git_and_docker_source_use(self):
        self.produce()
    def test_producer_rejects_cross_source_checkout_before_build(self):
        self.produce(wrong_head=True)
    def produce(self,wrong_head=False):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=self.plan();data=b'FROM fixture\n';calls=[]
            for v in p['sourceContracts'].values():v['dockerfileSha256']=a.sha(data)
            def command(argv,cwd=None,**kwargs):
                calls.append(argv)
                if argv[:3]==['git','rev-parse','HEAD']:return (c.SOURCE if wrong_head else NEW).encode()
                if argv[:2]==['git','show']:return data
                if argv[:2]==['git','archive']:
                    with f.tarfile.open(argv[argv.index('--output')+1],'w') as t:
                        h=f.tarfile.TarInfo('fixture');h.size=1;t.addfile(h,io.BytesIO(b'x'))
                if argv[:3]==['docker','image','save']:
                    temporary=root/'fixture.tar';self.archive(temporary,p);kwargs['stdout_file'].write(temporary.read_bytes());temporary.unlink()
                return b''
            with patch.object(b,'control'),patch.object(b.shutil,'disk_usage',return_value=type('S',(),{'free':100*1024**3})()):
                if wrong_head:
                    with self.assertRaisesRegex(a.Rejected,'CANDIDATE_SOURCE_SHA'):b.produce(p,a.json_bytes(p),root,root/'out','api',command)
                    self.assertFalse(any(x[0]=='docker' for x in calls));return
                b.produce(p,a.json_bytes(p),root,root/'out','api',command)
            self.assertIn(['git','merge-base','--is-ancestor',NEW,'origin/main'],calls)
            self.assertTrue(all(x[2].startswith(NEW+':') for x in calls if x[:2]==['git','show']))
            self.assertEqual(next(x for x in calls if x[:2]==['git','archive'])[-1],NEW)
            build=next(x for x in calls if x[:3]==['docker','buildx','build'])
            self.assertIn('org.opencontainers.image.revision='+NEW,build);self.assertIn('SOURCE_REVISION='+NEW,build)
            self.assertFalse(any(c.SOURCE in part for x in calls for part in x))
if __name__=='__main__':unittest.main()
