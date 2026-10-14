import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('producer',Path(__file__).parents[1]/'scripts/cn-release-mvp-original-producer.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class OriginalProducer(unittest.TestCase):
    def setUp(self):
        self.payload=dict(identity=dict(sourceRevision='a'*40,controlRevision='b'*40,
            releaseId='mvp-test',contentManifestSha256='c'*64),buildRunId=1,transferRunId=2,
            productionRunId=3,requestedAt='2026-10-14T08:00:00Z',deadlineAt='2026-10-14T08:30:00Z')
        self.approval=m.E.encode(dict(identity=dict(sourceRevision='a'*40,controlRevision='b'*40,
            requestedAt=self.payload['requestedAt'],deadlineAt=self.payload['deadlineAt']),
            mvp=dict(buildRunId=1,transferRunId=2,contentManifestSha256='c'*64)))
        self.release=m.E.sha(self.approval)
        self.root=m.INPUT/self.release/'mvp-originals'
        self.manifest=dict(kind='cn-mvp-admitted-original-manifest-v1',releaseSha256=self.release,
            binding=self.payload,bundles={stage:'d'*64 for stage in m.E.module().STAGES},objects=[])

    def reader(self,path):
        if path.name==self.release+'.json':return self.approval
        if path.name=='manifest.json':return m.E.encode(self.manifest)
        return b'{}'

    def test_rejects_caller_path(self):
        for value in ('../test','a'*63,'a'*64+'/file'):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'RELEASE_HASH'):
                m.collect(value,reader=lambda _:self.fail('must reject before read'))

    def test_approval_changed_before_collection(self):
        with self.assertRaisesRegex(ValueError,'APPROVAL_HASH'):
            m.collect('f'*64,reader=lambda _:self.approval)

    def test_manifest_cannot_redirect_paths(self):
        self.manifest['objects']=['../../secret']
        self.manifest['bundles']={s:'../../secret' for s in m.E.module().STAGES}
        with self.assertRaisesRegex(ValueError,'ORIGINAL_PIN'):m.collect(self.release,reader=self.reader)

    def test_new_run_cannot_rebind_approval(self):
        self.payload['transferRunId']=99
        with self.assertRaisesRegex(ValueError,'APPROVAL_MVP_BINDING'):m.collect(self.release,reader=self.reader)

    def test_changed_original_bytes_rejected(self):
        with self.assertRaisesRegex(ValueError,'ORIGINAL_BYTES_CHANGED'):m.collect(self.release,reader=self.reader)

    def test_stage_omission_rejected(self):
        del self.manifest['bundles']['backup']
        with self.assertRaisesRegex(ValueError,'BUNDLE_STAGES'):m.collect(self.release,reader=self.reader)

    def test_exclusive_real_file_proposal(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)/'proposal';raw=b'{"original":"retained"}'
            m.M.write_proposal(folder,{'objects/'+m.E.sha(raw)+'.json':raw},{'installed':False})
            self.assertEqual((folder/'objects'/(m.E.sha(raw)+'.json')).read_bytes(),raw)
            self.assertEqual(folder.stat().st_mode&0o777,0o700)
            self.assertEqual((folder/'proposal.json').stat().st_mode&0o777,0o600)
            with self.assertRaises(FileExistsError):m.M.write_proposal(folder,{}, {})


if __name__=='__main__':unittest.main()
