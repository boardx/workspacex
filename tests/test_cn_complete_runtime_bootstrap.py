import base64, datetime as dt, importlib.util, json, os, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bootstrap',ROOT/'scripts/cn-complete-runtime-bootstrap.py');B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
NOW=dt.datetime(2026,10,14,12,tzinfo=dt.timezone.utc)
def fixture():
    files={name:b'# public fixture code\n' for name in B.FILES}
    manifest={'kind':'cn-complete-runtime-bootstrap-v1','revision':'a'*40,'files':{k:{'sha256':B.sha(v),'bytes':len(v),'mode':'0600'} for k,v in files.items()},'installationAuthorized':False,'includesRuntimePayload':False}
    p={'kind':'cn-complete-runtime-bootstrap-policy-v1','instanceId':B.INSTANCE,'issuedAt':'2026-10-14T12:00:00Z','expiresAt':'2026-10-14T12:30:00Z','entry':{'path':str(B.ENTRY),'sha256':'b'*64},'githubProvider':{'ghExecutable':'/usr/bin/gh','ghSha256':'c'*64,'authentication':'existing-root-gh','ghConfigDirectory':'/root/.config/gh'},'manifest':manifest,'manifestSha256':B.sha(B.encode(manifest))}
    return p,files
class Provider:
    def __init__(self,files):self.files=files;self.calls=[]
    def contents(self,revision,name):
        self.calls.append((revision,name));raw=self.files[name]
        return B.encode({'type':'file','path':'scripts/'+name,'name':name,'size':len(raw),'encoding':'base64','content':base64.b64encode(raw).decode()})
class Tests(unittest.TestCase):
    def test_policy_exact_closure_and_hash(self):
        p,_=fixture();raw=B.encode(p);self.assertEqual(B.validate_policy(raw,B.sha(raw),NOW),p)
        for change in ('extra','missing','mode','entry','expired'):
            q=json.loads(raw)
            if change=='extra':q['unknown']=True
            if change=='missing':q['manifest']['files'].pop(B.FILES[0])
            if change=='mode':q['manifest']['files'][B.FILES[0]]['mode']='0700';q['manifestSha256']=B.sha(B.encode(q['manifest']))
            if change=='entry':q['entry']['path']='/tmp/bootstrap.py'
            if change=='expired':q['expiresAt']='2026-10-14T12:00:00Z'
            changed=B.encode(q)
            with self.assertRaises(ValueError):B.validate_policy(changed,B.sha(changed),NOW)
    def test_content_checks_and_duplicate(self):
        p,files=fixture();name=B.FILES[0];row=p['manifest']['files'][name];raw=Provider(files).contents('a'*40,name)
        self.assertEqual(B.decode_content(raw,name,row),files[name])
        for key,value in [('path','scripts/evil.py'),('size',1),('content','!!!!'),('content',base64.b64encode(b'wrong').decode())]:
            v=json.loads(raw);v[key]=value
            with self.assertRaises(ValueError):B.decode_content(B.encode(v),name,row)
        with self.assertRaises(ValueError):B.decode(b'{"x":1,"x":2}')
    def test_auth_environment_never_changes_home_or_input(self):
        env={'HOME':'/root','GH_TOKEN':'fake','GITHUB_TOKEN':'fake'};saved=dict(env);clean=B.github_environment(env)
        self.assertEqual(env,saved);self.assertEqual(clean['HOME'],'/root');self.assertNotIn('GH_TOKEN',clean)
        with self.assertRaises(ValueError):B.github_environment({'HOME':'/tmp'})
    def exercise(self,publish):
        p,files=fixture();provider=Provider(files)
        parent='/run' if sys.platform=='linux' and os.geteuid()==0 else None
        with tempfile.TemporaryDirectory(dir=parent) as tmp:
            journals=Path(tmp)/'journal';dest=Path(tmp)/'dest';journals.mkdir();dest.mkdir()
            j=os.open(journals,os.O_RDONLY|os.O_DIRECTORY);d=os.open(dest,os.O_RDONLY|os.O_DIRECTORY)
            try:
                pin=B.sha(B.encode(p));report=B.materialize(p,pin,provider,j,d,clock=lambda:NOW,publish=publish)
                self.assertFalse(report['payloadExecuted']);self.assertEqual(len(provider.calls),9)
                for name,raw in files.items():
                    path=dest/p['manifestSha256']/'scripts'/name;self.assertEqual(path.read_bytes(),raw);self.assertEqual(path.stat().st_mode&0o777,0o600)
                self.assertFalse(any(x.name.startswith('stage-') for x in dest.iterdir()))
                with self.assertRaises(FileExistsError):B.materialize(p,pin,provider,j,d,clock=lambda:NOW,publish=publish)
                self.assertEqual(len(provider.calls),9)
            finally:os.close(j);os.close(d)
    def test_real_files_and_exclusive_intent(self):
        def publish(parent,stage,name):
            if name in os.listdir(parent):raise ValueError('TARGET_COLLISION')
            os.rename(name,name,src_dir_fd=stage,dst_dir_fd=parent)
        self.exercise(publish)
    @unittest.skipUnless(sys.platform=='linux' and os.geteuid()==0,'Linux disposable root syscall fixture')
    def test_actual_noreplace_publication(self):self.exercise(B.no_replace)
    def test_hash_failure_retains_intent_no_publish(self):
        p,files=fixture();files[B.FILES[0]]=b'tampered';provider=Provider(files)
        with tempfile.TemporaryDirectory() as tmp:
            j=os.open(tmp,os.O_RDONLY|os.O_DIRECTORY)
            try:
                with self.assertRaises(ValueError):B.materialize(p,'d'*64,provider,j,j,clock=lambda:NOW,publish=lambda *args:self.fail('must not publish'))
                self.assertTrue((Path(tmp)/('d'*64)/'intent.json').exists());self.assertFalse((Path(tmp)/p['manifestSha256']).exists())
            finally:os.close(j)
if __name__=='__main__':unittest.main()
