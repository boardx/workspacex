"""Proposal fixtures only. No Docker, network, credentials or budget execution."""
import copy,io,sys,tempfile,unittest,importlib.util
from pathlib import Path
from datetime import timedelta
from unittest.mock import patch
import test_cn_image_candidate as f
b,a,c=f.b,f.a,f.c
G=1024**3

def formal():
    p=f.plan();p.update(budgetProfile='formal-4g-v1',maxArchiveBytes=4*G);return p

class BudgetProfileTests(unittest.TestCase):
    def metadata(self,root,p,sizes=None,tar_root=None):
        root.mkdir();raw=a.json_bytes(p)
        for service in c.hosted.SERVICES:
            d=root/service;d.mkdir()
            entry=dict(file=service+'.tar',size=(sizes or {}).get(service,2*G),sha256='a'*64,configSha256='b'*64,imageId='sha256:'+'b'*64,layers=[{'name':'layer.tar','size':1,'sha256':'c'*64}],stagingTag=c.tag(p,service))
            if tar_root is not None:
                target=tar_root/service;target.mkdir();entry=f.archive(target/(service+'.tar'),p,service)
            receipt=a.json_bytes(f.receipt(p,{service:entry}));(d/'candidate-plan.json').write_bytes(raw);(d/'candidate-fragment.json').write_bytes(receipt)
            if tar_root is not None:
                (target/'candidate-plan.json').write_bytes(raw);(target/'candidate-fragment.json').write_bytes(receipt)
        return raw
    def mutate(self,root,fn):
        p=root/'api/candidate-fragment.json';v=a.decode(p.read_bytes());fn(v);p.write_bytes(a.json_bytes(v))
    def test_profile_explicit_and_identity_bound(self):
        old=f.plan();new=formal();self.assertEqual(c.validate_plan(new),new)
        self.assertNotEqual(c.identity(old),c.identity(new));self.assertEqual(c.validate_diagnostic_plan(old),old)
        for p in [dict(old,maxArchiveBytes=4*G),dict(new,maxArchiveBytes=2*G),dict(old,budgetProfile=None),dict(new,budgetProfile='unknown'),dict(new,maxTotalBytes=20*G),dict(new,storageMarginBytes=G)]:
            with self.subTest(p=p),self.assertRaises(a.Rejected):c.validate_plan(p)
    def test_diagnostics_reject_profile_before_any_command(self):
        env={'EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/main','GITHUB_SHA':formal()['controlRevision']}
        for script in ['diagnose-cn-image-candidate.py','diagnose-cn-agent-postbuild.py']:
            spec=importlib.util.spec_from_file_location('budget_diag',Path(__file__).resolve().parents[1]/'scripts'/script);d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
            calls=[]
            with self.subTest(script=script),self.assertRaisesRegex(a.Rejected,'DIAGNOSTIC_FIXED_BUDGET'):
                d.execute(a.json_bytes(formal()),'/missing','/missing',env,command=lambda *args,**kwargs:calls.append(args))
            self.assertEqual(calls,[])
    def test_formal_stream_cap_and_legacy_call_limit(self):
        for limit in [2*G,4*G]:
            result=io.BytesIO();b.run([sys.executable,'-c','print("ok")'],stdout_file=result,stdout_limit=limit);self.assertEqual(result.getvalue(),b'ok\n')
        for limit in [True,0,4*G+1]:
            with self.assertRaisesRegex(a.Rejected,'CANDIDATE_SAVE_LIMIT'):b.run(['/missing'],stdout_file=io.BytesIO(),stdout_limit=limit)
    def test_metadata_exact_total_boundary_and_capacity(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=formal();raw=self.metadata(root/'meta',p)
            for free,ok in [(12*G,True),(12*G-1,False)]:
                with patch.object(b.shutil,'disk_usage',return_value=type('S',(),{'free':free})()):
                    if ok:self.assertEqual(b.check_fragments(p,raw,root/'meta',True)['declaredTotalBytes'],10*G)
                    else:
                        with self.assertRaisesRegex(a.Rejected,'CANDIDATE_CAPACITY'):b.check_fragments(p,raw,root/'meta',True)
    def test_metadata_over_total_rejected_before_capacity_or_tar_access(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=formal();raw=self.metadata(root/'meta',p,{'api':2*G+1})
            with patch.object(b.shutil,'disk_usage',side_effect=AssertionError('must reject before disk check')):
                with self.assertRaisesRegex(a.Rejected,'CANDIDATE_COLLECTION_TOTAL'):b.check_fragments(p,raw,root/'meta',True)
    def test_cross_attempt_plan_source_control_and_expiry(self):
        mutations=[lambda v:v.update(attemptId='other'),lambda v:v.update(planRawSha256='0'*64),lambda v:v.update(identity='0'*64),lambda v:v.update(expiresAt=(f.datetime.now(f.timezone.utc)-timedelta(seconds=1)).isoformat())]
        for mutate in mutations:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);p=formal();raw=self.metadata(root/'meta',p);self.mutate(root/'meta',mutate)
                with self.assertRaises(a.Rejected):b.check_fragments(p,raw,root/'meta')
        for key,val in [('controlRevision','f'*40),('sourceRevision','f'*40)]:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);p=formal();raw=self.metadata(root/'meta',p);changed=copy.deepcopy(p);changed[key]=val
                (root/'meta/api/candidate-plan.json').write_bytes(a.json_bytes(changed))
                with self.assertRaisesRegex(a.Rejected,'CANDIDATE_PLAN_ORIGINAL_BYTES'):b.check_fragments(p,raw,root/'meta')
    def test_size_type_and_per_file_bound(self):
        for size in [True,0,-1,4*G+1,'100']:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);p=formal();raw=self.metadata(root/'meta',p,{'api':size})
                with self.assertRaisesRegex(a.Rejected,'CANDIDATE_METADATA_SIZE'):b.check_fragments(p,raw,root/'meta')
    def test_missing_service_and_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=formal();raw=self.metadata(root/'meta',p)
            (root/'meta/api/candidate-plan.json').unlink();(root/'meta/api/candidate-plan.json').symlink_to(root/'meta/web/candidate-plan.json')
            with self.assertRaisesRegex(a.Rejected,'CANDIDATE_FRAGMENT_METADATA'):b.check_fragments(p,raw,root/'meta')
    def test_final_collection_rechecks_admitted_metadata_and_real_tar(self):
        for damage in ['none','metadata','tar']:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);p=formal();(root/'tars').mkdir();raw=self.metadata(root/'meta',p,tar_root=root/'tars')
                b.check_fragments(p,raw,root/'meta')
                if damage=='metadata':self.mutate(root/'tars',lambda v:v.update(planRawSha256='0'*64))
                if damage=='tar':
                    with (root/'tars/api/api.tar').open('ab') as t:t.write(b'bad')
                with patch.object(b,'control'),patch.object(b.shutil,'disk_usage',return_value=type('S',(),{'free':100*G})()):
                    if damage=='none':self.assertFalse(b.collect(p,raw,root/'tars',root/'out',root/'meta')['releaseReady'])
                    else:
                        with self.assertRaises(a.Rejected):b.collect(p,raw,root/'tars',root/'out',root/'meta')
    def test_formal_collect_requires_metadata(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=formal();(root/'tars').mkdir();raw=self.metadata(root/'meta',p,tar_root=root/'tars')
            with patch.object(b,'control'),patch.object(b.shutil,'disk_usage',return_value=type('S',(),{'free':100*G})()):
                with self.assertRaisesRegex(a.Rejected,'CANDIDATE_METADATA_REQUIRED'):b.collect(p,raw,root/'tars',root/'out')
    def test_capacity_rechecks_stop_before_save_or_normalize(self):
        for values,save_count in [([18*G,14*G-1],0),([18*G,14*G,10*G-1],1)]:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);p=formal();data=b'FROM fixture\n';calls=[]
                for v in p['sourceContracts'].values():v['dockerfileSha256']=a.sha(data)
                def command(argv,cwd=None,**kwargs):
                    calls.append(argv)
                    if argv[:3]==['git','rev-parse','HEAD']:return c.SOURCE.encode()
                    if argv[:2]==['git','show']:return data
                    if argv[:2]==['git','archive']:
                        with f.tarfile.open(argv[argv.index('--output')+1],'w') as t:
                            h=f.tarfile.TarInfo('fixture');h.size=1;t.addfile(h,io.BytesIO(b'x'))
                    if argv[:3]==['docker','image','save']:kwargs['stdout_file'].write(b'x')
                    return b''
                with patch.object(b,'control'),patch.object(b,'normalize') as norm,patch.object(b.shutil,'disk_usage',side_effect=[type('S',(),{'free':v})() for v in values]):
                    with self.assertRaisesRegex(a.Rejected,'CANDIDATE_CAPACITY'):b.produce(p,a.json_bytes(p),root,root/'out','api',command)
                    norm.assert_not_called()
                self.assertEqual(sum(x[:3]==['docker','image','save'] for x in calls),save_count);self.assertFalse((root/'out').exists())
    def test_workflow_admits_metadata_before_all_tar_downloads(self):
        text=(Path(__file__).resolve().parents[1]/'.github/workflows/build-cn-image-candidates.yml').read_text()
        gate=text.index('Admit complete metadata and actual total before any tar download')
        for service in c.hosted.SERVICES:
            self.assertLess(text.index('Download '+service+' metadata from this run attempt'),gate)
            self.assertGreater(text.index('Download '+service+' archive from this run attempt'),gate)
            self.assertIn('cn-image-candidate-metadata-'+service+'-${{ github.run_id }}-${{ github.run_attempt }}',text)
        self.assertIn('--metadata "$RUNNER_TEMP/cn-image-metadata"',text)
if __name__=='__main__':unittest.main()
