"""Pinned-release DevApp config activation; synthetic CLI seams, no Docker/network."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SOURCE='a'*40
PREFIX='registry.example/team'
OLDTAG='12-90000000000000000001'
TAG='123-90000000000000000001'
PARENT_CONFIG='sha256:'+'b'*64
PARENT_DIGEST='sha256:'+'c'*64
CHILD_CONFIG='sha256:'+'d'*64
CHILD_DIGEST='sha256:'+'e'*64
DIFF='sha256:'+'f'*64
LAYER={'mediaType':'application/vnd.docker.image.rootfs.diff.tar.gzip','size':12345,'digest':'sha256:'+'1'*64}


def module():
    spec=importlib.util.spec_from_file_location('activation_registry',ROOT/'scripts/registry-images.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def parent(m):
    return {'kind':'registry-images-v1','sourceRevision':SOURCE,'tag':OLDTAG,'platform':'linux/amd64',
            'images':{role:{'service':role,'sourceRevision':SOURCE,'tag':OLDTAG,
                      'image':PREFIX+'/'+details[0]+'@'+PARENT_DIGEST,'imageId':PARENT_CONFIG}
                      for role,details in m.SERVICES.items()}}


def environment(path,sha,role='api'):
    return {'AIDT_CONFIG_ACTIVATION':'1','SOURCE_OVERRIDE':SOURCE,'GITHUB_EVENT_NAME':'workflow_dispatch',
            'AIDT_RELEASE_ENABLED':'1','TARGET_ENVIRONMENT':'devapp','BUILD_ONLY':'true','BUILD_SERVICE':'all',
            'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','REGISTRY_PREFIX':PREFIX,
            'NEXT_PUBLIC_ENABLE_AIDT':'1' if role=='web' else '0',
            'NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT':'1' if role=='web' else '0'}


class Fixture:
    def __init__(self,m,role,failure=None):
        self.m,self.role,self.failure=m,role,failure
        self.calls=[];self.recipe=None;self.args=None
        self.repository=PREFIX+'/'+m.SERVICES[role][0]

    def __call__(self,args,**kwargs):
        self.calls.append((args,kwargs))
        status,out,err=0,'',''
        if args==['git','rev-parse','HEAD']:
            out=SOURCE if self.failure!='checkout' else '2'*40
        elif args[:3]==['docker','buildx','build']:
            self.args=args;self.recipe=Path(args[args.index('--file')+1]).read_text()
            self.context_files=sorted(p.name for p in Path(args[-1]).iterdir())
            if self.failure=='timeout':raise subprocess.TimeoutExpired(args,kwargs['timeout'])
            Path(args[args.index('--metadata-file')+1]).write_text(json.dumps({
                'containerimage.config.digest':CHILD_CONFIG,'containerimage.digest':CHILD_DIGEST}))
        elif args[:2]==['docker','pull']:
            pass
        elif args[:3]==['docker','image','inspect']:
            old=args[-1].endswith('@'+PARENT_DIGEST)
            config={'Env':['PATH=/usr/bin','APP_MODE=existing'],
                    'Labels':{'org.opencontainers.image.revision':SOURCE,
                              'io.boardx.workspacex.release-tag':OLDTAG if old else TAG,'preserved':'yes'},
                    'Cmd':['node','main.js'],'Entrypoint':['entrypoint.sh'],'User':'node','WorkingDir':'/app',
                    'Healthcheck':{'Test':['CMD','true']},'Volumes':{'/data':{}},'OnBuild':None}
            if not old and self.role=='api': config['Env'] += [name+'=1' for name in self.m.API_AIDT_FLAGS]
            if old and self.failure in ('onbuild','bad-onbuild'):
                config['OnBuild']=['RUN true'] if self.failure=='onbuild' else 'RUN true'
            if not old:
                changes={'cmd':('Cmd',['changed']), 'entrypoint':('Entrypoint',['changed']),
                         'user':('User','root'),'workdir':('WorkingDir','/other'),
                         'healthcheck':('Healthcheck',{}),'volume':('Volumes',{}),'unknown-config':('Unknown','changed')}
                if self.failure in changes: key,value=changes[self.failure];config[key]=value
                if self.failure=='label':config['Labels']['preserved']='changed'
                if self.failure=='other-env':config['Env'][0]='PATH=/changed'
                if self.failure=='env-order':config['Env'][:2]=reversed(config['Env'][:2])
                if self.failure=='api-duplicate':config['Env'].append('ENABLE_AIDT_MODULE=1')
                if self.failure=='api-missing':config['Env']=[e for e in config['Env'] if not e.startswith('ENABLE_AIDT_MODULE=')]
                if self.failure=='source':config['Labels']['org.opencontainers.image.revision']='2'*40
                if self.failure=='tag':config['Labels']['io.boardx.workspacex.release-tag']=OLDTAG
            digest=PARENT_CONFIG if old else CHILD_CONFIG
            if old and self.failure=='parent-config':digest='sha256:'+'2'*64
            if not old and self.failure=='config':digest='sha256:'+'2'*64
            rootfs={'Type':'layers','Layers':[DIFF]}
            if not old and self.failure=='rootfs':rootfs['Layers']=['sha256:'+'2'*64]
            out=json.dumps([{'Id':digest,'Os':'linux','Architecture':'amd64',
                  'RepoDigests':[self.repository+'@'+(PARENT_DIGEST if old else CHILD_DIGEST)],'Config':config,'RootFS':rootfs}])
        elif args[:3]==['docker','manifest','inspect']:
            if ':'+TAG==args[-1][-len(TAG)-1:]:
                status,err=1,'manifest unknown'
                if self.failure=='existing':status,err=0,''
                if self.failure=='mixed-absence':err='unauthorized: denied; manifest unknown'
            else:
                old=args[-1].endswith('@'+PARENT_DIGEST)
                layer=copy.deepcopy(LAYER)
                if not old and self.failure=='layer':layer['size']+=1
                if not old and self.failure=='layer-digest':layer['digest']='sha256:'+'2'*64
                out=json.dumps({'schemaVersion':2,'mediaType':'application/vnd.docker.distribution.manifest.v2+json',
                    'config':{'mediaType':'application/vnd.docker.container.image.v1+json','size':1000,
                              'digest':PARENT_CONFIG if old else CHILD_CONFIG},'layers':[layer]})
        else:raise AssertionError('unexpected process')
        return subprocess.CompletedProcess(args,status,out,err)


class ActivationTests(unittest.TestCase):
    def execute(self,role='api',failure=None,env_override=None,parent_change=None):
        m=module();fixture=Fixture(m,role,failure)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'parent.json';data=parent(m)
            if parent_change:parent_change(data)
            raw=json.dumps(data).encode();path.write_bytes(raw);sha=hashlib.sha256(raw).hexdigest()
            env={**environment(path,sha,role),**(env_override or {})};output=Path(temp)/'result.json';error=None
            with patch.object(m,'ACTIVATION_PARENT_SHA256',sha),patch.object(m,'ACTIVATION_PARENT_PATH',path),patch.dict(os.environ,env,clear=True),patch.object(m.subprocess,'run',side_effect=fixture),contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                try:m.build(role,PREFIX,TAG,output,SOURCE)
                except Exception as caught:error=caught
            row=json.loads(output.read_text()) if output.exists() else None
        return fixture,row,error

    def test_all_roles_derive_own_exact_parent_without_filesystem_instructions_and_fresh_receipt(self):
        for role in module().SERVICES:
            with self.subTest(role=role):
                fixture,row,error=self.execute(role)
                self.assertIsNone(error,error);self.assertEqual(row['sourceRevision'],SOURCE);self.assertEqual(row['tag'],TAG)
                self.assertEqual(row['imageId'],CHILD_CONFIG);self.assertTrue(row['image'].endswith('@'+CHILD_DIGEST))
                lines=fixture.recipe.splitlines()
                self.assertEqual(lines[:3],['FROM '+fixture.repository+'@'+PARENT_DIGEST,
                      'LABEL org.opencontainers.image.revision='+SOURCE,'LABEL io.boardx.workspacex.release-tag='+TAG])
                self.assertEqual(lines[3:],['ENV ENABLE_AIDT_MODULE=1 ENABLE_PROJECT_MEMBER_CHAT=1'] if role=='api' else [])
                self.assertEqual(fixture.context_files,['Dockerfile','result.json'])
                self.assertIn('--network=none',fixture.args);self.assertIn('--output=type=registry,oci-mediatypes=false',fixture.args)
                self.assertNotIn('--build-arg',fixture.args);self.assertNotIn('--load',fixture.args)
                builds=[(a,k) for a,k in fixture.calls if a[:3]==['docker','buildx','build']]
                self.assertEqual(len(builds),1);self.assertEqual(builds[0][1]['timeout'],3120)
                self.assertFalse(any(a[:2]==['docker','push'] for a,k in fixture.calls))
                self.assertEqual(sum(a[:2]==['docker','pull'] for a,k in fixture.calls),2)

    def test_parent_all_five_coordinates_shape_source_tag_and_ids_are_strict_before_any_cli(self):
        changes=[lambda d:d['images'].pop('web'),lambda d:d['images'].update(extra=copy.deepcopy(d['images']['api'])),
                 lambda d:d.update(sourceRevision='2'*40),lambda d:d.update(tag=TAG),lambda d:d.update(platform='linux/arm64'),
                 lambda d:d['images']['web'].update(service='api'),lambda d:d['images']['web'].update(sourceRevision='2'*40),
                 lambda d:d['images']['web'].update(tag='2-1'),lambda d:d['images']['web'].update(image=PREFIX+'/api@'+PARENT_DIGEST),
                 lambda d:d['images']['web'].update(imageId='bad'),lambda d:d.update(extra='not allowed')]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                fixture,row,error=self.execute(parent_change=change)
                self.assertEqual(str(error),'ACTIVATION_PARENT_INVALID');self.assertIsNone(row);self.assertEqual(fixture.calls,[])

    def test_disabled_production_partial_reuse_bad_flag_hash_and_checkout_are_rejected(self):
        for env in ({'TARGET_ENVIRONMENT':'cn'},{'TARGET_ENVIRONMENT':'us'},{'AIDT_RELEASE_ENABLED':'0'},
                    {'BUILD_ONLY':'false'},{'BUILD_SERVICE':'api'},{'EXISTING_TAG':'12-1'},
                    {'AIDT_CONFIG_ACTIVATION':'true'},{'ACTIVATION_PARENT_SHA256':'0'*64},{'ACTIVATION_PARENT_MANIFEST':'/other'},
                    {'SOURCE_OVERRIDE':''},{'SOURCE_OVERRIDE':'2'*40},{'GITHUB_EVENT_NAME':'push'},{'GITHUB_RUN_ATTEMPT':'2'}):
            with self.subTest(env=env):
                fixture,row,error=self.execute(env_override=env)
                self.assertIsNotNone(error);self.assertIsNone(row);self.assertEqual(fixture.calls,[])
        fixture,row,error=self.execute(failure='checkout')
        self.assertEqual(str(error),'SOURCE_CHECKOUT_MISMATCH');self.assertIsNone(row)
        self.assertEqual(len(fixture.calls),1)

    def test_pinned_parent_raw_bytes_not_just_supplied_hash_and_no_symlink(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'parent';raw=json.dumps(parent(m)).encode();path.write_bytes(raw)
            sha=hashlib.sha256(raw).hexdigest();env=environment(path,sha)
            with patch.object(m,'ACTIVATION_PARENT_PATH',path),patch.dict(os.environ,env,clear=True),patch.object(m,'run') as run:
                with self.assertRaisesRegex(ValueError,'ACTIVATION_PARENT_INVALID'):
                    m.activation_parent(PREFIX,SOURCE,TAG,'devapp','1',True,'all')
                run.assert_not_called()
            with patch.object(m,'ACTIVATION_PARENT_SHA256',sha),patch.object(m,'ACTIVATION_PARENT_PATH',path),patch.dict(os.environ,env,clear=True):
                path.write_bytes(raw+b' ')
                with self.assertRaisesRegex(ValueError,'ACTIVATION_PARENT_INVALID'):
                    m.activation_parent(PREFIX,SOURCE,TAG,'devapp','1',True,'all')
                path.unlink();target=Path(temp)/'target';target.write_bytes(raw);path.symlink_to(target)
                with self.assertRaisesRegex(ValueError,'ACTIVATION_PARENT_INVALID'):
                    m.activation_parent(PREFIX,SOURCE,TAG,'devapp','1',True,'all')

    def test_onbuild_malformed_parent_existing_tag_or_uncertain_absence_never_builds(self):
        for failure in ('onbuild','bad-onbuild','parent-config','existing','mixed-absence'):
            fixture,row,error=self.execute(failure=failure)
            self.assertIsNotNone(error);self.assertIsNone(row)
            self.assertFalse(any(a[:3]==['docker','buildx','build'] for a,k in fixture.calls))

    def test_filesystem_layers_or_any_other_runtime_config_change_never_writes_receipt(self):
        for failure in ('rootfs','layer','layer-digest','cmd','entrypoint','user','workdir','healthcheck','volume',
                        'unknown-config','label','other-env','env-order','api-duplicate','api-missing','source','tag','config'):
            with self.subTest(failure=failure):
                _,row,error=self.execute(failure=failure)
                self.assertIsNotNone(error);self.assertIsNone(row)
        for failure in ('other-env','env-order'):
            _,row,error=self.execute(role='web',failure=failure)
            self.assertEqual(str(error),'ACTIVATION_CONFIG_CHANGED');self.assertIsNone(row)

    def test_timeout_does_not_fallback_retry_read_child_or_write(self):
        fixture,row,error=self.execute(failure='timeout')
        self.assertEqual(str(error),'BUILD_TIMEOUT_API');self.assertIsNone(row)
        self.assertEqual(sum(a[:3]==['docker','buildx','build'] for a,k in fixture.calls),1)
        self.assertEqual(sum(a[:2]==['docker','pull'] for a,k in fixture.calls),1)

    def test_real_cli_plan_rejects_bad_mode_before_outputs_or_base_resolution(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'parent';path.write_text('{}');output=Path(temp)/'output'
            env={**environment(path,m.ACTIVATION_PARENT_SHA256),'GITHUB_EVENT_NAME':'workflow_dispatch',
                 'GITHUB_REF_NAME':'develop','GITHUB_REF_TYPE':'branch','ENABLE_AIDT':'true','GITHUB_OUTPUT':str(output)}
            for extra in ({},{'AIDT_CONFIG_ACTIVATION':'true'},{'BUILD_ONLY':'false'},{'BUILD_SERVICE':'api'},
                          {'TARGET_ENVIRONMENT':'cn'},{'ENABLE_AIDT':'false'},{'EXISTING_TAG':OLDTAG}):
                result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source',SOURCE,'--resolve-bases'],env={**env,**extra},capture_output=True,text=True)
                self.assertNotEqual(result.returncode,0);self.assertFalse(output.exists())

    def test_reviewed_parent_real_cli_plan_succeeds_without_resolving_unrelated_bases(self):
        m=module()
        # The delivered, byte-pinned parent is also consumed by the real CLI;
        # do not substitute synthetic inputs for this admission check.
        raw=m.ACTIVATION_PARENT_PATH.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),m.ACTIVATION_PARENT_SHA256)
        actual=json.loads(raw);source=actual['sourceRevision']
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp)/'output'
            env={**environment(None,None),'SOURCE_OVERRIDE':source,'GITHUB_EVENT_NAME':'workflow_dispatch',
                 'GITHUB_REF_NAME':'develop','GITHUB_REF_TYPE':'branch','ENABLE_AIDT':'true','GITHUB_OUTPUT':str(output)}
            env['REGISTRY_PREFIX']=actual['images']['api']['image'].rsplit('/',1)[0]
            result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source',source,'--resolve-bases'],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            values=dict(line.split('=',1) for line in output.read_text().splitlines())
            self.assertEqual(values['source'],source);self.assertEqual(values['fullset'],'true')
            self.assertEqual(set(json.loads(values['services'])),set(m.SERVICES))
            self.assertEqual(values['tag'],TAG);self.assertEqual(values['aidt_web_enabled'],'1')
            self.assertNotIn('node_image',values)

    def test_readback_metadata_is_bounded_and_layer_descriptors_are_strict(self):
        m=module();fixture=Fixture(m,'api')
        reference=PREFIX+'/api@'+PARENT_DIGEST
        image=json.loads(fixture(['docker','image','inspect',reference]).stdout)
        manifest=json.loads(fixture(['docker','manifest','inspect',reference]).stdout)
        changes=[lambda d:d.update(mediaType='unknown'),lambda d:d.update(schemaVersion=1),
                 lambda d:d['config'].update(digest=CHILD_CONFIG),lambda d:d['config'].update(size=-1),
                 lambda d:d.update(layers=[]),lambda d:d['layers'][0].update(size=True),
                 lambda d:d['layers'][0].update(digest='invalid'),lambda d:d['layers'][0].update(mediaType='unknown'),
                 lambda d:d['layers'][0].update(urls=['https://example.invalid/DUMMY']),
                 lambda d:d.update(layers=[LAYER]*1001)]
        for change in changes:
            changed=copy.deepcopy(manifest);change(changed)
            with self.subTest(change=changes.index(change)),patch.object(m,'run',side_effect=[json.dumps(image),json.dumps(changed)]):
                with self.assertRaisesRegex(ValueError,'ACTIVATION_READBACK_INVALID'):
                    m.activation_snapshot(reference,SOURCE,OLDTAG,PARENT_CONFIG)
        for raw in ('x'*(m.MAX_BUILD_METADATA_BYTES+1),'{invalid'):
            with patch.object(m,'run',return_value=raw):
                with self.assertRaisesRegex(ValueError,'ACTIVATION_READBACK_INVALID'):
                    m.activation_snapshot(reference,SOURCE,OLDTAG,PARENT_CONFIG)


if __name__=='__main__':unittest.main()
