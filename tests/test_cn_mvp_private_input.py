import copy,hashlib,importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).parents[1]
FIXTURE_PARENT=Path('/run')if __import__('sys').platform=='linux'and os.geteuid()==0 else ROOT
s=importlib.util.spec_from_file_location('private_input',ROOT/'scripts/cn-release-mvp-private-input.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class PrivateInput(unittest.TestCase):
 def ref(self,purpose='nonmodel-credentials'):
  return dict(kind='cn-mvp-existing-private-input-ref-v1',purpose=purpose,format=m.FORMATS[purpose],path='/etc/workspacex-cn/existing-approved.json',sha256='a'*64)
 def fixture(self):
  payload={role:{'email':'fake-'+role+'@invalid.test','password':'FAKE-SECRET-MUST-NOT-LEAK'}for role in ('primary','foreign','restricted')};return json.dumps(payload).encode(),payload
 def test_metadata_validation_has_no_io_and_purpose_cannot_cross(self):
  with patch.object(m.os,'open',side_effect=AssertionError('no IO')):self.assertEqual(m.validate_ref(self.ref(),'nonmodel-credentials'),self.ref())
  with self.assertRaisesRegex(ValueError,'REFERENCE_PURPOSE'):m.validate_ref(self.ref(),'migration-environment')
 def test_bad_paths_extra_fields_duplicate_and_unsupported_format(self):
  for path in ('/tmp/existing.json','/etc/workspacex-cn/../else.json','/etc/workspacex-cn//file','/etc/workspacex-cn/file/','/etc/workspacex-cn/x\x00'):
   ref=self.ref();ref['path']=path
   with self.assertRaisesRegex(ValueError,'REFERENCE_PATH'):m.validate_ref(ref,'nonmodel-credentials')
  ref=self.ref();ref['extra']=True
  with self.assertRaisesRegex(ValueError,'REFERENCE_FIELDS'):m.validate_ref(ref,'nonmodel-credentials')
  ref=self.ref();ref['format']='dotenv'
  with self.assertRaisesRegex(ValueError,'REFERENCE_FORMAT'):m.validate_ref(ref,'nonmodel-credentials')
  raw=json.dumps(self.ref()).replace('"purpose":', '"purpose":"nonmodel-credentials","purpose":').encode()
  with self.assertRaisesRegex(ValueError,'DUPLICATE_KEY'):m.validate_ref(raw,'nonmodel-credentials')
 def test_values_only_returned_in_memory_and_no_environment_change(self):
  raw,payload=self.fixture();ref=self.ref();ref['sha256']=hashlib.sha256(raw).hexdigest();before=dict(os.environ)
  with patch.object(m,'_read_private',return_value=raw)as read:self.assertEqual(m.resolve_ref(ref,'nonmodel-credentials'),payload);read.assert_called_once_with(ref['path'],ref['sha256'],owner=0)
  self.assertEqual(dict(os.environ),before)
 def test_real_fixture_hash_fifo_links_and_permission_guards(self):
  raw,_=self.fixture()
  with tempfile.TemporaryDirectory(dir=FIXTURE_PARENT)as folder:
   root=Path(folder);file=root/'input';file.write_bytes(raw);file.chmod(0o600);pin=hashlib.sha256(raw).hexdigest()
   self.assertEqual(m._read_private(file,pin,owner=os.getuid()),raw)
   with self.assertRaisesRegex(ValueError,'FILE_HASH'):m._read_private(file,'0'*64,owner=os.getuid())
   alias=root/'alias';alias.symlink_to(file)
   with self.assertRaisesRegex(ValueError,'UNAVAILABLE'):m._read_private(alias,pin,owner=os.getuid())
   fifo=root/'fifo';os.mkfifo(fifo,0o600)
   with self.assertRaisesRegex(ValueError,'FILE_TRUST'):m._read_private(fifo,pin,owner=os.getuid())
   file.chmod(0o644)
   with self.assertRaisesRegex(ValueError,'FILE_TRUST'):m._read_private(file,pin,owner=os.getuid())
 def test_symlinked_parent_hardlink_and_oversized_file_rejected(self):
  raw,_=self.fixture()
  with tempfile.TemporaryDirectory(dir=FIXTURE_PARENT)as folder:
   root=Path(folder);real=root/'real';real.mkdir();file=real/'input';file.write_bytes(raw);file.chmod(0o600);pin=hashlib.sha256(raw).hexdigest()
   alias=root/'alias';alias.symlink_to(real,target_is_directory=True)
   with self.assertRaisesRegex(ValueError,'UNAVAILABLE'):m._read_private(alias/'input',pin,owner=os.getuid())
   hard=root/'hard';os.link(file,hard)
   with self.assertRaisesRegex(ValueError,'FILE_TRUST'):m._read_private(file,pin,owner=os.getuid())
   hard.unlink();file.write_bytes(b'x'*(m.LIMIT+1))
   with self.assertRaisesRegex(ValueError,'FILE_TRUST'):m._read_private(file,pin,owner=os.getuid())
 def test_explicit_migration_json_format_and_duplicate_payload(self):
  payload={k:'fake-value'for k in m.ENV_REQUIRED};payload['WORKSPACEX_DEPLOY_PROFILE']='production'
  raw=json.dumps(payload).encode();ref=self.ref('migration-environment')
  with patch.object(m,'_read_private',return_value=raw):self.assertEqual(m.resolve_ref(ref,'migration-environment'),payload)
  payload['ARBITRARY_EXECUTABLE']='bad'
  with patch.object(m,'_read_private',return_value=json.dumps(payload).encode()),self.assertRaisesRegex(ValueError,'PAYLOAD_FORMAT'):m.resolve_ref(ref,'migration-environment')
  with patch.object(m,'_read_private',return_value=b'{"primary":{},"primary":{}}'),self.assertRaisesRegex(ValueError,'DUPLICATE_KEY'):m.resolve_ref(self.ref(),'nonmodel-credentials')
 def test_same_bytes_touch_or_named_swap_is_rejected_during_read(self):
  raw,_=self.fixture()
  for mode in ('touch','swap'):
   with tempfile.TemporaryDirectory(dir=FIXTURE_PARENT)as folder:
    file=Path(folder)/'input';file.write_bytes(raw);file.chmod(0o600);changed=False
    real=m._read_chunk
    def mutate(fd,size):
     nonlocal changed
     data=real(fd,size)
     if not changed:
      changed=True
      if mode=='touch':st=file.stat();os.utime(file,ns=(st.st_atime_ns,st.st_mtime_ns+1000000000))
      else:replacement=Path(folder)/'replacement';replacement.write_bytes(raw);replacement.chmod(0o600);os.replace(replacement,file)
     return data
    with patch.object(m,'_read_chunk',side_effect=mutate),self.assertRaisesRegex(ValueError,'FILE_CHANGED'):m._read_private(file,hashlib.sha256(raw).hexdigest(),owner=os.getuid())
 def test_parse_and_payload_errors_never_include_secret(self):
  bad=b'{"password":"FAKE-SECRET-MUST-NOT-LEAK",broken'
  with self.assertRaises(ValueError)as error:m._decode(bad)
  self.assertEqual(str(error.exception),'PRIVATE_INPUT_INVALID_JSON');self.assertIsNone(error.exception.__cause__)
  raw=json.dumps({'primary':{'email':'fake','password':'FAKE-SECRET-MUST-NOT-LEAK','extra':1}}).encode()
  with patch.object(m,'_read_private',return_value=raw),self.assertRaisesRegex(ValueError,'PAYLOAD_FORMAT'):m.resolve_ref(self.ref(),'nonmodel-credentials')
 def test_exact_legacy_env_path_and_purpose_boundary(self):
  ref=self.ref('migration-environment');ref.update(path=m.LEGACY_ENV,format=m.ENV_FILE_FORMAT)
  with patch.object(m.os,'open',side_effect=AssertionError('metadata cannot read target')):self.assertEqual(m.validate_ref(ref,'migration-environment'),ref)
  for path in (m.LEGACY_ENV+'-other',str(Path(m.LEGACY_ENV).parent/'other.env')):
   wrong={**ref,'path':path}
   with self.assertRaisesRegex(ValueError,'REFERENCE_PATH'):m.validate_ref(wrong,'migration-environment')
  wrong=self.ref();wrong['path']=m.LEGACY_ENV
  with self.assertRaisesRegex(ValueError,'REFERENCE_PATH'):m.validate_ref(wrong,'nonmodel-credentials')
 def test_env_literal_dollar_quotes_hash_and_first_equals_never_execute(self):
  values={key:'fake'for key in m.ENV_REQUIRED};values['MIGRATION_DB_PASSWORD']='$(DO_NOT_EXECUTE)"literal"#hash=tail';values['PGHOST']="'$UNEXPANDED'"
  raw=('  # comment\n\n'+'\n'.join(key+'='+value for key,value in values.items())+'\n').encode()
  ref=self.ref('migration-environment');ref.update(path=m.LEGACY_ENV,format=m.ENV_FILE_FORMAT)
  with patch.object(m,'_read_private',return_value=raw),patch.object(m.os,'system',side_effect=AssertionError('no shell')):self.assertEqual(m.resolve_ref(ref,'migration-environment'),values)
 def test_env_duplicate_unknown_assignment_nul_encoding_and_required_guards(self):
  for raw,code in [(b'PGHOST=a\nPGHOST=b','DUPLICATE_KEY'),(b'UNKNOWN=value','ENV_KEY'),(b'PGHOST','ENV_ASSIGNMENT'),(b'PGHOST=a\x00','ENV_NUL'),(b'PGHOST=\xff','ENV_ENCODING')]:
   with self.assertRaisesRegex(ValueError,code):m._decode_env_file(raw)
  ref=self.ref('migration-environment');ref.update(path=m.LEGACY_ENV,format=m.ENV_FILE_FORMAT)
  with patch.object(m,'_read_private',return_value=b'PGHOST=fake'),self.assertRaisesRegex(ValueError,'PAYLOAD_FORMAT'):m.resolve_ref(ref,'migration-environment')
 @unittest.skipUnless(__import__('sys').platform=='linux'and os.geteuid()==0,'disposable Linux root only')
 def test_actual_root_secure_read_in_run_private_fixture(self):
  raw,_=self.fixture()
  with tempfile.TemporaryDirectory(dir='/run',prefix='cn-private-input-unit-')as folder:
   file=Path(folder)/'input';file.write_bytes(raw);file.chmod(0o600)
   self.assertEqual(m._read_private(file,hashlib.sha256(raw).hexdigest()),raw)
if __name__=='__main__':unittest.main()
