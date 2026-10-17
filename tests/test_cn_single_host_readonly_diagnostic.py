"""Offline only. No Docker socket, IMDS, production, credential or DB calls."""
import ast
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import types
import unittest
from unittest.mock import Mock,patch

ROOT=Path(__file__).resolve().parents[1]
PROBE=ROOT/'scripts/cn-single-host-readonly-diagnostic.py'
spec=importlib.util.spec_from_file_location('probe',PROBE)
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class Fake:
    def __init__(self):
        self.calls=[];self.identity=p.TARGET;self.health={'trustworthy':True,'password':'SENTINEL_SECRET'}
        self.rows=[dict(Id=str(i+1)*64,ImageID='sha256:'+str(i+1)*64,State='running',Names=['/workspacex-cn-'+s+'-1'],
            Labels={'com.docker.compose.project':p.PROJECT,'com.docker.compose.service':s,
              'org.opencontainers.image.revision':'a'*40,'com.docker.compose.project.config_files':'/var/lib/workspacex-cn/runtime/'+'a'*40+'/compose.json','unrelated':'SENTINEL_SECRET'},
            Command='SENTINEL_SECRET',Mounts=[{'Source':'SENTINEL_SECRET'}])for i,s in enumerate(p.SERVICES)]
    def get(self,url,limit):
        self.calls.append(('GET',url))
        return self.identity.encode()if url==p.IMDS else json.dumps(self.health).encode()
    def containers(self):self.calls.append(('DOCKER_LIST',p.CONTAINERS));return self.rows
    def metadata(self,path,code=False):self.calls.append(('CODE_HASH'if code else'STAT',path));return {'status':'PRESENT'}

class ProbeTests(unittest.TestCase):
    def test_full_bounded_metadata_without_secret_output_or_readiness_claim(self):
        f=Fake();v=p.collect(f);raw=p.encode(v)
        self.assertEqual(v['status'],'OBSERVED');self.assertTrue(v['targetVerified'])
        self.assertNotIn(b'SENTINEL',raw);self.assertLess(len(raw),p.MAX_OUTPUT)
        for key in ('productionReady','productionAccepted','rollbackVerified','databaseChecked','approvalGranted'):self.assertFalse(v[key])
        self.assertEqual([x[1]for x in f.calls if x[0]=='CODE_HASH'],list(p.CODE))
        self.assertFalse(any('.env'in x[1]or 'secrets'in x[1]for x in f.calls))
    def test_wrong_target_stops_before_any_host_inventory(self):
        f=Fake();f.identity='i-other'
        with self.assertRaisesRegex(p.Rejected,'WRONG_OR_UNVERIFIED_INSTANCE'):p.collect(f)
        self.assertEqual(f.calls,[('GET',p.IMDS)])
    def test_cardinality_and_duplicate_or_foreign_names_fail_closed(self):
        f=Fake();f.rows*=4
        with self.assertRaisesRegex(p.Rejected,'CONTAINER_COUNT'):p.collect(f)
        for change in ('duplicate','project','name'):
            f=Fake()
            if change=='duplicate':f.rows.append(copy.deepcopy(f.rows[0]))
            if change=='project':f.rows[0]['Labels']['com.docker.compose.project']='foreign'
            if change=='name':f.rows[0]['Names']=['/foreign']
            with self.subTest(change=change),self.assertRaises(p.Rejected):p.collect(f)
    def test_mixed_runtime_or_unapproved_path_cannot_select_files(self):
        for value in ('/etc/secret.env','/var/lib/workspacex-cn/runtime/'+'b'*40+'/compose.json'):
            f=Fake();f.rows[0]['Labels']['com.docker.compose.project.config_files']=value
            v=p.collect(f);self.assertEqual(v['status'],'PARTIAL');self.assertIsNone(v['reportedRuntimeDirectoryRevision'])
            self.assertEqual(v['runtimeFileMetadata'],{})
    def test_missing_required_or_stopped_service_is_partial(self):
        for mode in ('missing','stopped'):
            f=Fake()
            if mode=='missing':f.rows.pop(0)
            else:f.rows[0]['State']='exited'
            self.assertEqual(p.collect(f)['status'],'PARTIAL')
    def test_missing_permission_is_partial_and_never_requests_elevation(self):
        f=Fake();f.metadata=lambda path,code=False:{'status':'DENIED'}
        v=p.collect(f);self.assertEqual(v['status'],'PARTIAL')
        self.assertIn('TRUSTED_ENTRYPOINTS_UNAVAILABLE',v['errors'])
        self.assertFalse(v['productionReady'])
    def test_inventory_drift_during_observation_rejects(self):
        f=Fake();old=copy.deepcopy(f.rows);new=copy.deepcopy(f.rows);new[0]['ImageID']='sha256:'+'f'*64
        f.containers=Mock(side_effect=[old,new])
        with self.assertRaisesRegex(p.Rejected,'DOCKER_INVENTORY_CHANGED'):p.collect(f)
    def test_raw_code_or_provider_error_never_printed(self):
        host=p.Host()
        with patch.object(host,'trusted',side_effect=PermissionError('SECRET')):
            self.assertEqual(host.metadata(p.CODE[0],True),{'status':'DENIED'})
        with patch.object(p,'collect',side_effect=OSError('SECRET')),patch.object(p.sys,'argv',['probe']), \
             patch.object(p.sys,'stdout',types.SimpleNamespace(buffer=io.BytesIO()))as output, \
             patch.object(p.signal,'signal'),patch.object(p.signal,'setitimer'):
            self.assertEqual(p.main(),2);self.assertNotIn(b'SECRET',output.buffer.getvalue())
    def test_global_deadline_is_not_swallowed_as_health_success(self):
        f=Fake();original=f.get
        f.get=lambda url,limit:(_ for _ in ()).throw(p.Rejected('GLOBAL_DEADLINE'))if url==p.HEALTH else original(url,limit)
        with self.assertRaisesRegex(p.Rejected,'GLOBAL_DEADLINE'):p.collect(f)
    def test_output_bound(self):
        with self.assertRaisesRegex(p.Rejected,'OUTPUT_BOUND'):p.encode({'x':'x'*p.MAX_OUTPUT})
    def test_http_only_two_fixed_get_targets_and_no_proxy_or_redirect(self):
        host=p.Host()
        with patch.object(p.urllib.request,'build_opener')as build:
            for url in ('http://100.100.100.200/latest/meta-data/ram/security-credentials/','https://other/'):
                with self.assertRaisesRegex(p.Rejected,'HTTP_TARGET'):host.get(url,128)
            build.assert_not_called()
        with self.assertRaisesRegex(p.Rejected,'HTTP_REDIRECT'):p.NoRedirect().redirect_request(None,None,None,None,None,None)
    def test_no_cli_target_override_and_import_is_inert(self):
        with patch.object(p,'collect')as collect,patch.object(p.sys,'argv',['probe','--host','other']), \
             patch.object(p.sys,'stdout',types.SimpleNamespace(buffer=io.BytesIO())), \
             patch.object(p.signal,'signal'),patch.object(p.signal,'setitimer'):
            self.assertEqual(p.main(),2);collect.assert_not_called()
        tree=ast.parse((PROBE).read_text())
        imports=[n.module for n in ast.walk(tree)if isinstance(n,ast.ImportFrom)]+[a.name for n in ast.walk(tree)if isinstance(n,ast.Import)for a in n.names]
        self.assertFalse(any(x in imports for x in ('subprocess','psycopg','psycopg2')))
        attrs=[n.attr for n in ast.walk(tree)if isinstance(n,ast.Attribute)]
        self.assertFalse(any(x in attrs for x in ('environ','system','popen','unlink','mkdir','rename','chmod','chown','remove','execv')))

class FileAndDockerTests(unittest.TestCase):
    def info(self,**kwargs):
        values=dict(st_mode=stat.S_IFREG|0o700,st_uid=0,st_gid=0,st_nlink=1,st_size=3,st_dev=1,st_ino=2,st_mtime_ns=3,st_ctime_ns=4)
        values.update(kwargs);return types.SimpleNamespace(**values)
    def test_configuration_metadata_never_opens_contents(self):
        h=p.Host()
        with patch.object(h,'trusted',return_value=self.info()),patch.object(p.os,'open')as opened:
            self.assertEqual(h.metadata('/etc/nginx/conf.d/workspacex-cn.conf')['status'],'PRESENT');opened.assert_not_called()
    def test_code_hash_uses_readonly_nofollow_and_rejects_changes(self):
        h=p.Host();info=self.info()
        with patch.object(h,'trusted',return_value=info),patch.object(p.os,'open',return_value=10)as opened, \
             patch.object(p.os,'fstat',return_value=info),patch.object(p.os,'read',side_effect=[b'abc',b'']),patch.object(p.os,'close'):
            self.assertEqual(h.metadata(p.CODE[0],True)['sha256'],hashlib.sha256(b'abc').hexdigest())
            self.assertEqual(opened.call_args.args[1],p.os.O_RDONLY|p.os.O_NOFOLLOW|p.os.O_NONBLOCK)
        with patch.object(h,'trusted',return_value=info),patch.object(p.os,'open',return_value=10), \
             patch.object(p.os,'fstat',side_effect=[info,self.info(st_ctime_ns=99)]), \
             patch.object(p.os,'read',side_effect=[b'abc',b'']),patch.object(p.os,'close'):
            self.assertEqual(h.metadata(p.CODE[0],True)['status'],'CODE_CHANGED')
    def test_symlink_oversize_and_writable_code_rejected_before_open(self):
        for info in (self.info(st_mode=stat.S_IFLNK|0o777),self.info(st_size=p.MAX_CODE_BYTES+1),self.info(st_mode=stat.S_IFREG|0o777)):
            h=p.Host()
            with patch.object(h,'trusted',return_value=info),patch.object(p.os,'open')as opened:
                self.assertNotEqual(h.metadata(p.CODE[0],True)['status'],'PRESENT');opened.assert_not_called()
    def test_untrusted_parent_prevents_child_access(self):
        h=p.Host()
        with patch.object(p.os,'lstat',return_value=self.info(st_mode=stat.S_IFDIR|0o777)):
            with self.assertRaisesRegex(p.Rejected,'UNTRUSTED_PARENT'):h.trusted('/run/docker.sock')
    def test_docker_list_only_get_bounded_and_socket_pin(self):
        h=p.Host();info=self.info(st_mode=stat.S_IFSOCK|0o660)
        connection=Mock();connection.getresponse.return_value.status=200;connection.getresponse.return_value.read.return_value=b'[]'
        with patch.object(h,'trusted',return_value=info),patch.object(p,'UnixHTTP',return_value=connection):
            self.assertEqual(h.containers(),[])
        connection.request.assert_called_once_with('GET',p.CONTAINERS);connection.close.assert_called_once()
        self.assertNotIn('/json/inspect',p.CONTAINERS);self.assertNotIn('/exec',p.CONTAINERS)
        with patch.object(h,'trusted',side_effect=[info,self.info(st_mode=stat.S_IFSOCK|0o660,st_ino=99)]),patch.object(p,'UnixHTTP',return_value=connection):
            with self.assertRaisesRegex(p.Rejected,'DOCKER_SOCKET_CHANGED'):h.containers()
    def test_docker_body_bound(self):
        h=p.Host();info=self.info(st_mode=stat.S_IFSOCK|0o660)
        connection=Mock();connection.getresponse.return_value.status=200;connection.getresponse.return_value.read.return_value=b'x'*(p.MAX_BODY+1)
        with patch.object(h,'trusted',return_value=info),patch.object(p,'UnixHTTP',return_value=connection):
            with self.assertRaisesRegex(p.Rejected,'DOCKER_BOUND'):h.containers()
        connection.close.assert_called_once()

class ReviewedMaterialTests(unittest.TestCase):
    def test_approved_script_bytes_are_unchanged(self):
        self.assertEqual(hashlib.sha256(PROBE.read_bytes()).hexdigest(),
            '2f2adc6b0bbc12e3cb07e7140abd1a376749ce1e82499deaa9902bbfae13d813')
    def test_workflow_fixed_guard_and_existing_protection_without_escalation(self):
        value=(ROOT/'.github/workflows/cn-single-host-readonly-diagnostic.yml').read_text()
        self.assertIn(hashlib.sha256(PROBE.read_bytes()).hexdigest(),value)
        for clause in ('environment: production-cn-promotion','contents: read',
                       "if: github.ref == 'refs/heads/main'",'ref: ${{ github.sha }}',
                       'persist-credentials: false','cancel-in-progress: false','timeout-minutes: 3'):
            self.assertIn(clause,value)
        for forbidden in ('sudo ','id-token:','secrets.','prepare-cn-release','promote-cn-production','workflow_run:','push:'):
            self.assertNotIn(forbidden,value)

if __name__=='__main__':unittest.main(verbosity=2)
