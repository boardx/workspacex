"""Local fixtures only: no Docker, network, image upload, or cloud operations."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
import test_cn_image_diagnostic as build_fixtures
import test_cn_image_postbuild as archive_fixtures
spec=importlib.util.spec_from_file_location('postbuild_diagnostic',ROOT/'scripts/diagnose-cn-agent-postbuild.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
d,a=p.d,p.a


class Tests(unittest.TestCase):
    def scenario(self,td):
        f=build_fixtures.Tests();root,plan,data,env=f.setup_fixture(td);calls=[]
        return root,plan,env,calls,f.command(plan,data,calls)

    def test_build_save_normalize_inspect_once_and_discard_archives(self):
        with tempfile.TemporaryDirectory() as td:
            root,plan,env,calls,command=self.scenario(td);saved_calls=[]
            def save(argv,*,stdout_file,stdout_limit):
                saved_calls.append(argv);self.assertEqual(stdout_limit,2*1024**3)
                temp=root/'fixture-save.tar';archive_fixtures.PostBuildBoundaryTests().saved(temp,plan,compressed=True,layers=3)
                stdout_file.write(temp.read_bytes());temp.unlink()
            with patch.object(d.b,'control'),patch.object(d.shutil,'disk_usage',return_value=type('Space',(),{'free':20*1024**3})()):
                result=p.execute(a.json_bytes(plan),root,root/'report.json',env,command,save)
            self.assertEqual(result['status'],'POSTBUILD_COMPLETED');self.assertEqual(result['layerCount'],3)
            self.assertEqual(p.validate_metadata(a.json_bytes(result)),result)
            self.assertEqual(len([x for x in calls if x[0]=='docker']),1)
            self.assertEqual(saved_calls,[['docker','image','save',p.c.tag(plan,'agent')]])
            self.assertFalse(list(root.iterdir()));self.assertFalse(result['productionReady']);self.assertFalse(result['releaseReady']);self.assertFalse(result['rootCauseEstablished'])

    def test_event_ref_control_reject_before_commands_and_save(self):
        for key,value in [('EVENT_NAME','workflow_run'),('GITHUB_REF','refs/heads/other'),('GITHUB_SHA','0'*40)]:
            with self.subTest(key=key),tempfile.TemporaryDirectory() as td:
                root,plan,env,calls,command=self.scenario(td);env[key]=value
                with self.assertRaises(a.Rejected):p.execute(a.json_bytes(plan),root,root/'report',env,command,lambda *args,**kwargs:self.fail('save called'))
                self.assertFalse(calls)

    def test_new_script_bytes_and_guard_before_save(self):
        for kind in ('bytes','event'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as td:
                root,plan,env,calls,command=self.scenario(td)
                def invoke(argv,cwd=None):
                    result=command(argv,cwd)
                    if kind=='bytes' and argv[:2]==['git','show']:return b'wrong'
                    if kind=='event' and argv[:3]==['docker','buildx','build']:env['EVENT_NAME']='push'
                    return result
                with patch.object(d.b,'control'),patch.object(d.shutil,'disk_usage',return_value=type('Space',(),{'free':20*1024**3})()):
                    with self.assertRaises(a.Rejected):p.execute(a.json_bytes(plan),root,root/'report',env,invoke,lambda *args,**kwargs:self.fail('save called'))

    def test_save_failure_reports_phase_returncode_and_cleans_temp(self):
        with tempfile.TemporaryDirectory() as td:
            root,plan,env,calls,command=self.scenario(td)
            def save(*args,**kwargs):raise d.CommandFailure('DOCKER_SAVE','COMMAND_NONZERO',19)
            with patch.object(d.b,'control'),patch.object(d.shutil,'disk_usage',return_value=type('Space',(),{'free':20*1024**3})()):
                with self.assertRaises(d.CommandFailure) as caught:p.execute(a.json_bytes(plan),root,root/'report',env,command,save)
            report=d.failure(caught.exception);self.assertEqual(report['phase'],'DOCKER_SAVE');self.assertEqual(report['returncode'],19)
            p.validate_metadata(a.json_bytes(report));self.assertFalse(list(root.iterdir()))

    def test_binary_save_stream_exact_boundary_and_over_limit(self):
        for size,accepted in ((32,True),(33,False)):
            with self.subTest(size=size),tempfile.TemporaryDirectory() as td:
                path=Path(td)/'save';d.DEADLINE=None
                with path.open('xb') as output:
                    argv=[sys.executable,'-c','import sys;sys.stdout.buffer.write(bytes([0,255])*'+str(size//2)+'+bytes([0])*'+str(size%2)+')']
                    if accepted:self.assertEqual(d.run(argv,stdout_file=output,stdout_limit=32),b'')
                    else:
                        with self.assertRaises(a.Rejected) as caught:d.run(argv,stdout_file=output,stdout_limit=32)
                        self.assertEqual(str(caught.exception),'CANDIDATE_SAVE_LIMIT')
                self.assertLessEqual(path.stat().st_size,32)

    def test_stream_nonzero_and_timeout_redact_output(self):
        d.DEADLINE=None
        with tempfile.TemporaryDirectory() as td,(Path(td)/'save').open('xb') as output:
            with self.assertRaises(d.CommandFailure) as caught:
                d.run([sys.executable,'-c',"import sys;print('SECRET',file=sys.stderr);sys.exit(23)"],stdout_file=output,stdout_limit=32)
            self.assertEqual(caught.exception.returncode,23);self.assertNotIn('SECRET',json.dumps(d.failure(caught.exception)))
        d.DEADLINE=0
        with self.assertRaises(d.CommandFailure) as caught:d.run([sys.executable,'-c','pass'],stdout_file=io.BytesIO(),stdout_limit=32)
        self.assertEqual(caught.exception.code,'COMMAND_TIMEOUT');d.DEADLINE=None

    def test_metadata_rejects_raw_fields_and_invalid_success_counters(self):
        good={'status':'POSTBUILD_COMPLETED','controlRevision':'b'*40,'sourceRevision':p.c.SOURCE,'planRawSha256':'c'*64,'productionReady':False,'releaseReady':False,'rootCauseEstablished':False,'rawSaveBytes':1,'normalizedArchiveBytes':10240,'configSha256':'a'*64,'layerCount':1}
        p.validate_metadata(a.json_bytes(good))
        for bad in [dict(good,raw='SECRET'),dict(good,rawSaveBytes=2*1024**3+1),dict(good,layerCount=0),dict(good,productionReady=True),dict(good,normalizedArchiveBytes=True)]:
            with self.assertRaises(a.Rejected):p.validate_metadata(a.json_bytes(bad))
        with self.assertRaises(a.Rejected):p.validate_metadata(b' '*16385)

    def test_cli_failure_writes_bounded_metadata_and_nonzero(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'report';result=subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/diagnose-cn-agent-postbuild.py'),'--source',td,'--output',str(path)],env={'EVENT_NAME':'push','BUILD_PLAN':'SECRET'},capture_output=True)
            self.assertEqual(result.returncode,1);p.validate_metadata(path.read_bytes());self.assertNotIn(b'SECRET',result.stdout+result.stderr+path.read_bytes())

    def test_main_preserves_positive_save_exit_code_and_reports_failures(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'report'
            with patch.object(sys,'argv',['postbuild','--source',td,'--output',str(path)]),patch.object(p,'execute',side_effect=d.CommandFailure('DOCKER_SAVE','COMMAND_NONZERO',19)),patch('sys.stdout',new=io.StringIO()):
                rc=p.main()
            self.assertEqual(rc,19);report=p.validate_metadata(path.read_bytes());self.assertEqual(report['returncode'],19)
            self.assertFalse(report['rootCauseEstablished'])

    def test_workflow_one_manual_job_safe_json_upload_gate(self):
        text=(ROOT/'.github/workflows/diagnose-cn-agent-postbuild.yml').read_text()
        for wanted in ['workflow_dispatch:','refs/heads/main','ubuntu-24.04','timeout-minutes: 25','retention-days: 1',p.c.SOURCE,'id: validate_diagnostic',"if: always() && steps.validate_diagnostic.outcome == 'success'",'diagnostic.validate_metadata(p.read_bytes())','s.st_size <= 16384']:
            self.assertIn(wanted,text)
        for forbidden in ['matrix:','continue-on-error','workflow_run:','self-hosted','id-token:','cache','*.tar','retry','--push']:
            self.assertNotIn(forbidden,text)


if __name__=='__main__':unittest.main()
