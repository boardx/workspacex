"""候选协议反证：真实 tar 解析，不执行 Docker/cloud。"""
import copy
from datetime import datetime,timedelta,timezone
import importlib.util
import io
import json
from pathlib import Path
import sys
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import cn_image_candidate as c
import cn_image_archive as a
spec=importlib.util.spec_from_file_location('candidate_builder',Path(__file__).resolve().parents[1]/'scripts/build-cn-image-candidates.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

def plan():
    contracts={s:dict(repository=r,dockerfile=d,context=x,bases=list(bs),dockerfileSha256='4'*64) for s,(r,d,x,bs) in c.hosted.SERVICES.items()}
    return dict(kind=c.KIND,schemaVersion=2,sourceRevision=c.SOURCE,controlRevision='b'*40,attemptId='candidate-test',platform='linux/amd64',baseImages={'node':'docker.io/library/node@sha256:'+'1'*64,'python':'docker.io/library/python@sha256:'+'2'*64,'postgres':'docker.io/pgvector/pgvector@sha256:'+'3'*64},sourceContracts=contracts,maxArchiveBytes=2*1024**3,maxTotalBytes=10*1024**3,storageMarginBytes=2*1024**3)

def archive(path,p,s,labels=None):
    layer=b'actual uncompressed layer fixture';config=dict(os='linux',architecture='amd64',config={'Labels':labels or {'org.opencontainers.image.revision':c.SOURCE,c.LABEL:c.identity(p)}},rootfs={'type':'layers','diff_ids':['sha256:'+a.sha(layer)]})
    raw=a.json_bytes(config);name=a.sha(raw)+'.json';manifest=[dict(Config=name,RepoTags=[c.tag(p,s)],Layers=['layer.tar'])]
    with tarfile.open(path,'w') as t:
        for n,data in [(name,raw),('layer.tar',layer),('manifest.json',a.json_bytes(manifest))]:
            h=tarfile.TarInfo(n);h.size=len(data);t.addfile(h,io.BytesIO(data))
    size,digest=a.file_digest(path,p['maxArchiveBytes']);return dict(file=s+'.tar',size=size,sha256=digest,**c.inspect(path,p,s))

def receipt(p,images,now=None):
    now=now or datetime.now(timezone.utc)
    return dict(kind=c.KIND,schemaVersion=2,planRawSha256=a.sha(a.json_bytes(p)),planSha256=a.sha(a.json_bytes(p)),identity=c.identity(p),attemptId=p['attemptId'],producedAt=now.isoformat(),expiresAt=(now+timedelta(hours=1)).isoformat(),images=images,releaseReady=False,productionReady=False)

class CandidateTests(unittest.TestCase):
    def test_three_bases_only_old_schema_rejects(self):
        p=plan();self.assertEqual(c.validate_plan(p),p)
        with self.assertRaises(a.Rejected):a.validate_plan(p)
        p['baseImages']['redis']='anything'
        with self.assertRaises(a.Rejected):c.validate_plan(p)
    def test_identity_contract_change_and_attempt_excluded(self):
        p=plan();other=copy.deepcopy(p);other['attemptId']='other';self.assertEqual(c.identity(p),c.identity(other))
        for field in ['controlRevision','baseImages','sourceContracts']:
            q=copy.deepcopy(p)
            if field=='controlRevision':q[field]='c'*40
            elif field=='baseImages':q[field]['node']='docker.io/library/node@sha256:'+'9'*64
            else:q[field]['api']['dockerfileSha256']='9'*64
            self.assertNotEqual(c.identity(p),c.identity(q))
    def test_raw_hash_duplicate_json_budget_fixed(self):
        with tempfile.TemporaryDirectory() as td:
            f=Path(td)/'plan';f.write_bytes(a.json_bytes(plan()))
            with self.assertRaises(a.Rejected):b.load(f,'0'*64)
        with self.assertRaises(a.Rejected):a.decode(b'{"x":1,"x":2}')
        p=plan();p['maxTotalBytes']+=1
        with self.assertRaises(a.Rejected):c.validate_plan(p)
    def test_real_tar_complete_and_tamper(self):
        p=plan()
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);images={s:archive(folder/(s+'.tar'),p,s) for s in c.hosted.SERVICES};v=receipt(p,images);raw=a.json_bytes(v)
            self.assertEqual(c.verify_bundle(folder,p,raw,a.sha(raw),v['planRawSha256']),v)
            with (folder/'api.tar').open('ab') as f:f.write(b'changed')
            with self.assertRaises(a.Rejected):c.verify_bundle(folder,p,raw,a.sha(raw),v['planRawSha256'])
    def test_legacy_label_rejected_and_legacy_archive_inspector_rejects(self):
        p=plan()
        with tempfile.TemporaryDirectory() as td:
            f=Path(td)/'api.tar';archive(f,p,'api')
            old=dict(schemaVersion=1,sourceRevision=c.SOURCE,controlRevision='b'*40,release='1.2.3',attemptId=p['attemptId'],platform='linux/amd64',baseImages={**p['baseImages'],'redis':a.PREFIX+'/base-redis@sha256:'+'5'*64},maxArchiveBytes=p['maxArchiveBytes'],maxTotalBytes=p['maxTotalBytes'],storageMarginBytes=p['storageMarginBytes'])
            with self.assertRaises(a.Rejected):a.inspect_archive(f,old,'api')
            f.unlink()
            with self.assertRaises(a.Rejected):archive(f,p,'api',{'org.opencontainers.image.revision':c.SOURCE,c.LABEL:c.identity(p),'org.workspacex.archive-build-identity':'x'})
    def test_missing_cross_attempt_expired_and_privilege_rejected(self):
        p=plan();v=receipt(p,{'api':{}})
        for mutate in [lambda q:q.update(attemptId='wrong'),lambda q:q.update(productionReady=True),lambda q:q.update(producedAt=(datetime.now(timezone.utc)-timedelta(hours=2)).isoformat(),expiresAt=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat())]:
            q=copy.deepcopy(v);mutate(q);raw=a.json_bytes(q)
            with self.assertRaises(a.Rejected):c.validate_receipt(raw,p,a.sha(raw))
        raw=a.json_bytes(v)
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(a.Rejected):c.verify_bundle(td,p,raw,a.sha(raw),v['planRawSha256'])
    def test_collect_preserves_tar_bytes_and_earliest_expiry(self):
        p=plan();raw=a.json_bytes(p)
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);folder=root/'fragments';folder.mkdir();digests={};exp=[]
            for i,s in enumerate(c.hosted.SERVICES):
                d=folder/s;d.mkdir();image=archive(d/(s+'.tar'),p,s);digests[s]=image['sha256'];v=receipt(p,{s:image},datetime.now(timezone.utc)-timedelta(seconds=i));exp.append(v['expiresAt']);(d/'candidate-plan.json').write_bytes(raw);(d/'candidate-fragment.json').write_bytes(a.json_bytes(v))
            with patch.object(b,'control'),patch.object(b.shutil,'disk_usage',return_value=type('Space',(),{'free':100*1024**3})()):v=b.collect(p,raw,folder,root/'out')
            self.assertEqual(v['expiresAt'],min(exp));self.assertFalse(v['releaseReady']);self.assertEqual({s:a.file_digest(root/'out'/(s+'.tar'),p['maxArchiveBytes'])[1] for s in c.hosted.SERVICES},digests)
    def test_collector_remaining_margin_boundary_and_reject_before_move(self):
        p=plan();raw=a.json_bytes(p)
        for free,accepted in [(p['storageMarginBytes'],True),(p['storageMarginBytes']-1,False)]:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);folder=root/'fragments';folder.mkdir()
                for s in c.hosted.SERVICES:
                    d=folder/s;d.mkdir();image=archive(d/(s+'.tar'),p,s);v=receipt(p,{s:image});(d/'candidate-plan.json').write_bytes(raw);(d/'candidate-fragment.json').write_bytes(a.json_bytes(v))
                with patch.object(b,'control'),patch.object(b.shutil,'disk_usage',return_value=type('Space',(),{'free':free})()):
                    if accepted:self.assertFalse(b.collect(p,raw,folder,root/'out')['productionReady'])
                    else:
                        with self.assertRaises(a.Rejected) as caught:b.collect(p,raw,folder,root/'out')
                        self.assertEqual(b.diagnostic(caught.exception)['stage'],'COLLECTION_VERIFY');self.assertEqual(b.diagnostic(caught.exception)['code'],'CANDIDATE_COLLECTION_CAPACITY')
                        self.assertFalse((root/'out').exists());self.assertTrue(all((folder/s/(s+'.tar')).is_file() for s in c.hosted.SERVICES))
    def test_producer_simulation_retains_real_tar_and_no_cloud_operations(self):
        p=plan();dockerfile=b'FROM fixture\n'
        for v in p['sourceContracts'].values():v['dockerfileSha256']=a.sha(dockerfile)
        raw=a.json_bytes(p);calls=[]
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            def command(argv,cwd=None):
                calls.append(argv)
                if argv[:3]==['git','rev-parse','HEAD']:return (c.SOURCE+'\n').encode()
                if argv[:2]==['git','status']:return b''
                if argv[:2]==['git','show']:return dockerfile
                if argv[:2]==['git','archive']:
                    with tarfile.open(argv[argv.index('--output')+1],'w') as t:
                        h=tarfile.TarInfo('fixture');h.size=1;t.addfile(h,io.BytesIO(b'x'))
                if argv[:3]==['docker','image','save']:archive(Path(argv[argv.index('--output')+1]),p,'api')
                return b''
            with patch.object(b,'control'),patch.object(b.shutil,'disk_usage',return_value=type('Space',(),{'free':100*1024**3})()):v=b.produce(p,raw,root,root/'out','api',command)
            self.assertFalse(v['releaseReady']);self.assertEqual(set(v['images']),{'api'});self.assertTrue((root/'out'/'api.tar').is_file())
            build=next(x for x in calls if x[:3]==['docker','buildx','build']);self.assertIn(c.LABEL+'='+c.identity(p),build);self.assertFalse(any('redis' in x or x in ['push','login','prune'] for argv in calls for x in argv))
    def test_cli_check_returns_non_authorizing_and_bad_control_rejects(self):
        with tempfile.TemporaryDirectory() as td:
            f=Path(td)/'plan';raw=a.json_bytes(plan());f.write_bytes(raw);cli=str(Path(__file__).resolve().parents[1]/'scripts/build-cn-image-candidates.py')
            result=subprocess.run([sys.executable,'-I','-B',cli,'--plan',str(f),'--plan-sha256',a.sha(raw),'--check'],capture_output=True)
            self.assertEqual(result.returncode,0);v=json.loads(result.stdout);self.assertFalse(v['productionReady']);self.assertFalse(v['buildStarted'])
            p=plan();p['controlRevision']=None;raw=a.json_bytes(p);f.write_bytes(raw);result=subprocess.run([sys.executable,'-I','-B',cli,'--plan',str(f),'--plan-sha256',a.sha(raw),'--check'],capture_output=True);self.assertEqual(result.returncode,1)
    def test_offline_assembly_cannot_authorize_even_claimed_proof(self):
        p=plan()
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);images={s:archive(folder/(s+'.tar'),p,s) for s in c.hosted.SERVICES};raw=a.json_bytes(receipt(p,images));v=dict(kind='cn-image-candidate-assembly-v2',schemaVersion=2,candidateRawSha256=a.sha(raw),candidateIdentity=c.identity(p),redisImage=a.PREFIX+'/base-redis@sha256:'+'5'*64,release='1.2.3');assembly=a.json_bytes(v)
            result=c.offline_assembly(p,raw,a.sha(raw),assembly,a.sha(assembly),folder,a.sha(a.json_bytes(p)));self.assertEqual(result['status'],'NOT_READY');self.assertFalse(result['productionReady'])
            v['authenticatedRedis']=True;assembly=a.json_bytes(v)
            with self.assertRaises(a.Rejected):c.offline_assembly(p,raw,a.sha(raw),assembly,a.sha(assembly),folder,a.sha(a.json_bytes(p)))
class DiagnosticTests(unittest.TestCase):
    def test_local_command_nonzero_redacts_both_streams_and_preserves_returncode(self):
        # Python fixture only: no Git, Docker, network or build executed.
        with self.assertRaises(b.CommandFailure) as caught:
            b.run([sys.executable,'-c',"import sys;print('SECRET_STDOUT');print('SECRET_STDERR',file=sys.stderr);sys.exit(23)"])
        b.stage('DOCKER_BUILD');v=b.diagnostic(caught.exception)
        self.assertEqual(v['returncode'],23);self.assertEqual(v['code'],'COMMAND_NONZERO')
        self.assertEqual(v['stage'],'DOCKER_BUILD');self.assertNotIn('SECRET',json.dumps(v))
    def test_command_categories_and_untrusted_exception_redaction(self):
        for argv,expected in [(['docker','buildx','build','SECRET'],'DOCKER_BUILD'),(['docker','image','save'],'DOCKER_SAVE'),(['git','archive'],'GIT_ARCHIVE'),(['git','merge-base'],'GIT_ANCESTRY')]:
            self.assertEqual(b.command_category(argv),expected)
        for error in [ValueError('SECRET'),a.Rejected('SECRET'),a.Rejected(['SECRET']),b.CommandFailure('SECRET','SECRET','SECRET'),b.CommandFailure(['SECRET'],['SECRET'],23)]:
            self.assertNotIn('SECRET',json.dumps(b.diagnostic(error)))
        self.assertEqual(b.diagnostic(a.Rejected('CANDIDATE_SOURCE_SHA'))['code'],'CANDIDATE_SOURCE_SHA')
    def test_source_rejection_has_specific_stage_and_does_not_build(self):
        with tempfile.TemporaryDirectory() as td,patch.object(b,'control'):
            with self.assertRaises(a.Rejected) as caught:
                b.produce(plan(),a.json_bytes(plan()),td,Path(td)/'out','api',lambda *args:b'wrong')
            v=b.diagnostic(caught.exception)
            self.assertEqual(v['stage'],'SOURCE_VERIFY');self.assertEqual(v['code'],'CANDIDATE_SOURCE_SHA')
            self.assertFalse((Path(td)/'out').exists())
    def test_local_timeout_and_output_limit_redact_streams(self):
        with patch.object(b.time,'monotonic',side_effect=[0,4000]):
            with self.assertRaises(b.CommandFailure) as caught:b.run([sys.executable,'-c','pass'])
        self.assertEqual(b.diagnostic(caught.exception)['code'],'COMMAND_TIMEOUT')
        with self.assertRaises(b.CommandFailure) as caught:
            b.run([sys.executable,'-c',"import sys;sys.stdout.write('SECRET'*(2*1024**2))"])
        v=b.diagnostic(caught.exception);self.assertEqual(v['code'],'COMMAND_OUTPUT_LIMIT');self.assertNotIn('SECRET',json.dumps(v))
    def test_start_failure_redacts_executable_path(self):
        with self.assertRaises(b.CommandFailure) as caught:b.run(['/nonexistent/SECRET_EXECUTABLE'])
        v=b.diagnostic(caught.exception);self.assertEqual(v['code'],'COMMAND_START_FAILED');self.assertIsNone(v['returncode']);self.assertNotIn('SECRET',json.dumps(v))
if __name__=='__main__':unittest.main()
