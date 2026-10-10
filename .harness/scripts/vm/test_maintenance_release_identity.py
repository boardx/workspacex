"""The new pair is closed admission, not permission to execute a release."""
import copy, hashlib, json, pathlib, unittest
from writer_fence import admitted_release_identity, approved_release
from candidate_writer import validate
from test_candidate_writer import fixture as writer_fixture
from test_candidate_stage_actions import fixture as stage_fixture
from candidate_stage_actions import prepare
from candidate_completion_contract import verify_completion
from test_candidate_plan_producer import data_fixture

OLD=('9b25bfa65662b96c0826fe67506b562ea46aa6d0','ba6343199f3c834d6a198f83d0c771614292c82b')
NEW=('5285bef9a6c91bbb9857ede42779aafa64b98f32','a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0')
def convert(value):
    if isinstance(value,dict):return {k:convert(v) for k,v in value.items()}
    if isinstance(value,list):return [convert(v) for v in value]
    if isinstance(value,str):return value.replace(OLD[0],NEW[0]).replace(OLD[1],NEW[1])
    return value
class Tests(unittest.TestCase):
    def test_only_complete_pairs_and_never_cross_products(self):
        for source,base in (OLD,NEW):self.assertTrue(admitted_release_identity(dict(sourceRevision=source,baselineRevision=base)))
        for source,base in ((OLD[0],NEW[1]),(NEW[0],OLD[1]),('f'*40,NEW[1]),(NEW[0],'e'*40)):
            self.assertFalse(admitted_release_identity(dict(sourceRevision=source,baselineRevision=base)))
    def test_actual_writer_admits_both_and_rejects_foreign_pair_even_if_plan_agrees(self):
        identity,plan,*_=writer_fixture();validate(plan,identity)
        identity,plan=convert(identity),convert(plan);validate(plan,identity)
        for source,base in ((OLD[0],NEW[1]),(NEW[0],OLD[1]),('f'*40,'e'*40)):
            bad=dict(identity,sourceRevision=source,baselineRevision=base);badplan=copy.deepcopy(plan);badplan['identity']=bad
            with self.assertRaisesRegex(RuntimeError,'FROZEN_REVISION'):validate(badplan,bad)
    def stage(self):
        i,m,c,raw,reader,s,calls,inspection=stage_fixture()
        i['identity'].update(sourceRevision=NEW[0],baselineRevision=NEW[1])
        m.update(sourceRevision=NEW[0],release='test-reviewed-5285')
        encoded=json.dumps(m,sort_keys=True).encode();ref=i['manifest'];raw[ref['path']]=encoded;ref['sha256']=hashlib.sha256(encoded).hexdigest()
        s.approved_release=lambda identity:'test-reviewed-5285'
        return i,s,reader,calls
    def test_actual_stage_uses_new_manifest_label_and_independent_release(self):
        i,s,reader,calls=self.stage();out=prepare(i,s,reader,expected_identity=copy.deepcopy(i['identity']))
        self.assertEqual(out['identity'],i['identity']);self.assertTrue(any(isinstance(c,list) and 'create' in c for c in calls))
    def test_old_label_or_release_refuses_before_create(self):
        for kind in ('label','release','foreign-authority'):
            i,s,reader,calls=self.stage()
            if kind=='release':s.approved_release=lambda identity:'different-reviewed-release'
            if kind=='foreign-authority':i['identity']['baselineRevision']=OLD[1]
            if kind=='label':
                original=s.run_docker
                def run(args):
                    result=original(args)
                    if 'inspect' in args and 'image' in args:result[0]['Config']['Labels']['org.opencontainers.image.revision']=OLD[0]
                    return result
                s.run_docker=run
            with self.assertRaises(RuntimeError):prepare(i,s,reader,expected_identity=copy.deepcopy(i['identity']))
            self.assertFalse(any(isinstance(c,list) and 'create' in c for c in calls))
    def test_new_completion_requires_independent_release(self):
        inputs,docs,*_=data_fixture();bound={'identity':convert(inputs['identity'])};receipt=convert(docs['completion']);rows=docs['liveLedger']['ledger']
        receipt['release']='test-reviewed-5285'
        self.assertTrue(verify_completion(receipt,bound,rows,expected_release='test-reviewed-5285'))
        for value in (None,'2026.10.3-cn.1'):
            with self.assertRaises(RuntimeError):verify_completion(receipt,bound,rows,expected_release=value)
    def test_config_top_level_release_cannot_authorize(self):
        store={}
        def put(name,value):
            p='/etc/workspacex-cn/'+name;raw=json.dumps(value).encode();store[p]=raw;return {'path':p,'sha256':hashlib.sha256(raw).hexdigest()}
        manifest=put('manifest',dict(sourceRevision=NEW[0],release='reviewed'))
        profile={'candidateComposeEmitter':{'optionsRef':put('options',{'manifestRef':manifest}),'configRef':put('config',{'release':'reviewed'})}}
        identity=dict(sourceRevision=NEW[0],baselineRevision=NEW[1])
        with self.assertRaisesRegex(RuntimeError,'RELEASE_IDENTITY'):approved_release(profile,identity,store.__getitem__)
        profile['candidateComposeEmitter']['configRef']=put('config',{'provision':{'release':'reviewed'}})
        self.assertEqual(approved_release(profile,identity,store.__getitem__),'reviewed')
if __name__=='__main__':unittest.main()
