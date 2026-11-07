"""Alias publication tests exercise real identity resolution at the Docker command boundary."""
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
PREFIX='registry.example/team'
SOURCE='a'*40
SHORT='40174623496-1'
LEGACY=SOURCE+'-'+SHORT


def module():
    spec=importlib.util.spec_from_file_location('alias_registry_images',ROOT/'scripts/alias-registry-images.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value


class DockerFixture:
    def __init__(self,module):
        self.module=module
        self.calls=[]
        self.images={}
        self.probe_errors={}
        self.post_publish_mismatch=None
        for role in module.registry.SERVICES:
            repository=PREFIX+'/'+module.registry.SERVICES[role][0]
            digest=hashlib.sha256(role.encode()).hexdigest()
            self.images[self.reference(role,LEGACY)]={
                'Os':'linux','Architecture':'amd64','Id':'sha256:'+digest,
                'RepoDigests':[repository+'@sha256:'+digest],
                'Config':{'Labels':{'org.opencontainers.image.revision':SOURCE}}}

    def reference(self,role,tag=SHORT):
        return PREFIX+'/'+self.module.registry.SERVICES[role][0]+':'+tag

    def existing(self,role,conflicting=False):
        row=deepcopy(self.images[self.reference(role,LEGACY)])
        if conflicting:
            row['Id']='sha256:'+'f'*64
            row['RepoDigests']=[self.reference(role).rsplit(':',1)[0]+'@sha256:'+'e'*64]
            row['Config']['Labels']['io.boardx.workspacex.release-tag']=SHORT
        self.images[self.reference(role)]=row

    @property
    def writes(self):
        return [args for args in self.calls if args[1:4]==['buildx','imagetools','create']]

    def run(self,args,**kwargs):
        self.calls.append(list(args))
        stdout='';stderr='';code=0
        if args[1:3]==['manifest','inspect']:
            reference=args[3]
            if reference in self.probe_errors: code=1;stderr=self.probe_errors[reference]
            elif reference not in self.images: code=1;stderr='manifest unknown'
        elif args[1]=='pull':
            if args[-1] not in self.images: raise AssertionError('Unexpected pull '+args[-1])
        elif args[1:3]==['image','inspect']:
            stdout=json.dumps([self.images[args[3]]])
        elif args[1:4]==['buildx','imagetools','create']:
            reference=args[args.index('--tag')+1]
            self.assert_source(args[-1])
            self.images[reference]=deepcopy(next(row for row in self.images.values() if args[-1] in row['RepoDigests']))
            if reference==self.post_publish_mismatch:
                role=next(role for role in self.module.registry.SERVICES if self.reference(role)==reference)
                self.existing(role,conflicting=True)
        else: raise AssertionError('Unexpected Docker command '+repr(args))
        return subprocess.CompletedProcess(args,code,stdout,stderr)

    def assert_source(self,digest):
        if not any(digest in row['RepoDigests'] for row in self.images.values()):
            raise AssertionError('Alias must publish a verified immutable digest')


class Alias(unittest.TestCase):
    def invoke(self,m,docker,output):
        with patch.object(m.subprocess,'run',side_effect=docker.run),redirect_stdout(io.StringIO()):
            m.alias(PREFIX,LEGACY,output)

    def test_complete_five_identities_preflight_before_publication(self):
        m=module();docker=DockerFixture(m)
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'aliases.json';self.invoke(m,docker,output)
            receipt=json.loads(output.read_text())
            self.assertEqual(receipt['tag'],SHORT)
            self.assertEqual(receipt['sourceRevision'],SOURCE)
            self.assertEqual(set(receipt['images']),set(m.registry.SERVICES))
            self.assertEqual(len(receipt['images']),5)
            for role,row in receipt['images'].items():
                original=docker.images[docker.reference(role,LEGACY)]
                self.assertEqual(row['sourceRevision'],SOURCE)
                self.assertEqual(row['imageId'],original['Id'])
                self.assertEqual(row['image'],original['RepoDigests'][0])
            probes=[i for i,args in enumerate(docker.calls) if args[1:3]==['manifest','inspect']]
            self.assertEqual(len(probes),5)
            self.assertEqual(len(docker.writes),5)
            self.assertLess(max(probes),docker.calls.index(docker.writes[0]))

    def test_conflicting_or_unknown_last_destination_rejects_before_any_write(self):
        for mode in ['conflict','auth-unknown']:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                m=module();docker=DockerFixture(m);last=list(m.registry.SERVICES)[-1]
                if mode=='conflict': docker.existing(last,conflicting=True)
                else: docker.probe_errors[docker.reference(last)]='unauthorized: authentication required'
                output=Path(tmp)/'aliases.json'
                expected='ALIAS_ALREADY_EXISTS_DIFFERENT_IMAGE' if mode=='conflict' else 'ALIAS_EXISTENCE_UNVERIFIED'
                with self.assertRaisesRegex(ValueError,expected): self.invoke(m,docker,output)
                self.assertEqual(docker.writes,[])
                self.assertFalse(output.exists())

    def test_invalid_fifth_legacy_identity_rejects_before_publication(self):
        m=module();docker=DockerFixture(m);last=list(m.registry.SERVICES)[-1]
        docker.images[docker.reference(last,LEGACY)]['Config']['Labels']['org.opencontainers.image.revision']='b'*40
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'aliases.json'
            with self.assertRaisesRegex(ValueError,'IMAGE_SOURCE_MISMATCH'): self.invoke(m,docker,output)
            self.assertEqual(docker.writes,[])
            self.assertFalse(output.exists())

    def test_resumes_identical_aliases_and_repeated_run_publishes_nothing(self):
        m=module();docker=DockerFixture(m);roles=list(m.registry.SERVICES)
        for role in roles[:2]: docker.existing(role)
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'aliases.json';self.invoke(m,docker,output)
            self.assertEqual({args[args.index('--tag')+1] for args in docker.writes},
                             {docker.reference(role) for role in roles[2:]})
            docker.calls.clear()
            self.invoke(m,docker,Path(tmp)/'resumed.json')
            self.assertEqual(docker.writes,[])

    def test_postpublication_mismatch_cannot_emit_success_receipt(self):
        m=module();docker=DockerFixture(m)
        docker.post_publish_mismatch=docker.reference(list(m.registry.SERVICES)[-1])
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'aliases.json'
            with self.assertRaisesRegex(ValueError,'ALIAS_POST_PUBLISH_MISMATCH'): self.invoke(m,docker,output)
            self.assertEqual(len(docker.writes),5)
            self.assertFalse(output.exists())


if __name__=='__main__': unittest.main()
