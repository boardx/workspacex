"""Repeated source references normalize to strict unique output members."""
import gzip,io,tarfile,tempfile,unittest
from pathlib import Path
import test_cn_image_candidate as f
b,a,c=f.b,f.a,f.c
class RepeatedLayers(unittest.TestCase):
    def fixture(self,path,p,order=('a','a'),compressed=False,diffs=None,edit=None,duplicate=False):
        blobs={'a':b'A'*1024,'b':b'B'*1024}
        config=a.json_bytes(dict(os='linux',architecture='amd64',config={'Labels':{'org.opencontainers.image.revision':c.SOURCE,c.LABEL:c.identity(p)}},rootfs={'type':'layers','diff_ids':['sha256:'+a.sha(blobs[x]) for x in (order if diffs is None else diffs)]}))
        name='blobs/config';v=dict(Config=name,RepoTags=[c.tag(p,'api')],Layers=['blobs/'+x for x in order])
        if edit:edit(v)
        items=[(name,config)]+[('blobs/'+x,gzip.compress(blobs[x]) if compressed else blobs[x]) for x in set(order)]+[('manifest.json',a.json_bytes([v]))]
        if duplicate:items.append(items[1])
        with tarfile.open(path,'w') as t:
            for n,data in items:
                h=tarfile.TarInfo(n);h.size=len(data);t.addfile(h,io.BytesIO(data))
        return config
    def test_repeated_occurrences_preserve_identity_order_and_strict_output(self):
        for order in [('a','a'),('a','b','a')]:
            for compressed in (False,True):
                with self.subTest(order=order,compressed=compressed),tempfile.TemporaryDirectory() as td:
                    root=Path(td);p=f.plan();raw=self.fixture(root/'save',p,order,compressed)
                    result=b.normalize(root/'save',root/'out',p,'api')
                    self.assertEqual(result['imageId'],'sha256:'+a.sha(raw))
                    self.assertEqual([x['name'] for x in result['layers']],[f'layers/{i:04d}.tar' for i in range(len(order))])
                    self.assertEqual(result,c.inspect(root/'out',p,'api'))
                    with tarfile.open(root/'out') as t:self.assertEqual(t.extractfile('blobs/config').read(),raw)
    def test_diff_order_and_count_rejected(self):
        for diffs in [('a','a','b'),('a','b')]:
            with tempfile.TemporaryDirectory() as td:
                root=Path(td);p=f.plan();self.fixture(root/'save',p,('a','b','a'),diffs=diffs)
                with self.assertRaisesRegex(a.Rejected,'CANDIDATE_DIFF_IDS'):b.normalize(root/'save',root/'out',p,'api')
                self.assertFalse((root/'out').exists())
    def test_source_path_and_layer_count_rejections(self):
        edits=[(lambda v:v.update(Layers=[]),'CANDIDATE_SAVE_LAYER_COUNT'),(lambda v:v.update(Layers=['blobs/a']*129),'CANDIDATE_SAVE_LAYER_COUNT'),(lambda v:v.update(Layers=[v['Config']]),'CANDIDATE_SAVE_PATH_COLLISION'),(lambda v:v.update(Layers=['manifest.json']),'CANDIDATE_SAVE_PATH_COLLISION'),(lambda v:v.update(Layers=['../evil']),'ARCHIVE_PATH_INVALID'),(lambda v:v.update(Layers=['missing']),'CANDIDATE_SAVE_MEMBER')]
        for edit,code in edits:
            with self.subTest(code=code),tempfile.TemporaryDirectory() as td:
                root=Path(td);p=f.plan();self.fixture(root/'save',p,edit=edit)
                with self.assertRaisesRegex(a.Rejected,code):b.normalize(root/'save',root/'out',p,'api')
                self.assertFalse((root/'out').exists())
    def test_duplicate_tar_members_still_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=f.plan();self.fixture(root/'save',p,duplicate=True)
            with self.assertRaisesRegex(a.Rejected,'ARCHIVE_DUPLICATE_OR_PAX'):b.normalize(root/'save',root/'out',p,'api')
    def test_repeated_expansion_budget_counts_each_occurrence(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=f.plan();self.fixture(root/'save',p,('a',)*20,True);p['maxArchiveBytes']=15000
            with self.assertRaisesRegex(a.Rejected,'CANDIDATE_NORMALIZE_LIMIT'):b.normalize(root/'save',root/'out',p,'api')
            self.assertFalse((root/'out').exists());self.assertFalse(list(root.glob('wsx-normalize-*')))
    def test_link_payload_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=f.plan();self.fixture(root/'save',p)
            with tarfile.open(root/'save','a') as t:
                h=tarfile.TarInfo('unexpected-link');h.type=tarfile.SYMTYPE;h.linkname='blobs/a';t.addfile(h)
            with self.assertRaisesRegex(a.Rejected,'ARCHIVE_LINK_OR_SPECIAL_FILE'):b.normalize(root/'save',root/'out',p,'api')
    def test_generated_layer_path_cannot_collide_with_config(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);p=f.plan();self.fixture(root/'save',p)
            with tarfile.open(root/'save') as t:items=[(m.name,t.extractfile(m).read()) for m in t if m.isfile()]
            changed=[]
            for name,data in items:
                if name=='blobs/config':name='layers/0000.tar'
                if name=='manifest.json':
                    v=a.decode(data);v[0]['Config']='layers/0000.tar';data=a.json_bytes(v)
                changed.append((name,data))
            with tarfile.open(root/'save','w') as t:
                for name,data in changed:
                    h=tarfile.TarInfo(name);h.size=len(data);t.addfile(h,io.BytesIO(data))
            with self.assertRaisesRegex(a.Rejected,'CANDIDATE_SAVE_PATH_COLLISION'):b.normalize(root/'save',root/'out',p,'api')
    def test_new_codes_are_sanitized(self):
        for code in ('CANDIDATE_SAVE_LAYER_COUNT','CANDIDATE_SAVE_PATH_COLLISION'):
            self.assertEqual(b.diagnostic(a.Rejected(code))['code'],code)
if __name__=='__main__':unittest.main()
