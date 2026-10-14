#!/usr/bin/env python3
"""Resolve explicitly approved existing private JSON in memory. No copy or output.

Formats are deliberate contracts, not assertions that such files already exist.
Only the declared literal env-file format is supported; no shell parsing,
credential provisioning or environment mutation is performed.
"""
import hashlib,json,os,re,stat
from pathlib import Path,PurePosixPath
LIMIT=65536
PREFIX='/etc/workspacex-cn/'
LEGACY_ENV='/var/lib/workspacex-cn/runtime/a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0-newdb-20261006/migration.env'
ENV_FILE_FORMAT='migration-environment-env-file-v1'
FORMATS={'migration-environment':'migration-environment-json-v1','nonmodel-credentials':'nonmodel-credentials-json-v1'}
ENV_FIELDS=frozenset(('WORKSPACEX_DEPLOY_PROFILE','WORKSPACEX_RDS_TLS_EXCEPTION','PGHOST','PGPORT','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT_MS','PGSTATEMENT_TIMEOUT_MS','MIGRATION_DB_USER','MIGRATION_DB_PASSWORD'))
ENV_REQUIRED=frozenset(('WORKSPACEX_DEPLOY_PROFILE','PGHOST','PGDATABASE','MIGRATION_DB_USER','MIGRATION_DB_PASSWORD'))
def need(value,code):
 if not value:raise ValueError(code)
def _decode(raw):
 def pairs(items):
  result={}
  for k,v in items:need(k not in result,'PRIVATE_INPUT_DUPLICATE_KEY');result[k]=v
  return result
 try:return json.loads(raw,object_pairs_hook=pairs)
 except ValueError as error:
  if str(error)=='PRIVATE_INPUT_DUPLICATE_KEY':raise ValueError('PRIVATE_INPUT_DUPLICATE_KEY')from None
  raise ValueError('PRIVATE_INPUT_INVALID_JSON')from None
 except (TypeError,UnicodeError):raise ValueError('PRIVATE_INPUT_INVALID_JSON')from None

def validate_ref(value,purpose):
 """Metadata only: does not open, stat or otherwise inspect the target."""
 need(type(purpose)is str and purpose in FORMATS,'PRIVATE_INPUT_PURPOSE')
 if isinstance(value,bytes):
  need(0<len(value)<=LIMIT,'PRIVATE_INPUT_REFERENCE_LIMIT');value=_decode(value)
 need(type(value)is dict and set(value)=={'kind','purpose','format','path','sha256'},'PRIVATE_INPUT_REFERENCE_FIELDS')
 need(value['kind']=='cn-mvp-existing-private-input-ref-v1'and value['purpose']==purpose,'PRIVATE_INPUT_REFERENCE_PURPOSE')
 need(value['format']==FORMATS[purpose]or(purpose=='migration-environment'and value['format']==ENV_FILE_FORMAT),'PRIVATE_INPUT_REFERENCE_FORMAT')
 path=value['path']
 need(type(path)is str and '\x00'not in path and '\\'not in path and ((path.startswith(PREFIX)and len(path)>len(PREFIX))or(purpose=='migration-environment'and path==LEGACY_ENV))and str(PurePosixPath(path))==path and all(p not in ('','..','.')for p in path[1:].split('/')),'PRIVATE_INPUT_REFERENCE_PATH')
 need(type(value['sha256'])is str and re.fullmatch('[a-f0-9]{64}',value['sha256']),'PRIVATE_INPUT_REFERENCE_HASH')
 return dict(value)

def _signature(value):return(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
def _read_chunk(fd,size):return os.read(fd,size)
def _read_private(path,pin,*,owner=0):
 """Private test seam permits fixture ownership; public resolve always fixes 0."""
 parent=None;fd=None
 try:
  path=Path(path);parent=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  def check_directory(handle):
   value=os.fstat(handle);need(stat.S_ISDIR(value.st_mode)and value.st_uid in (0,owner)and not value.st_mode&0o022,'PRIVATE_INPUT_PARENT_TRUST')
  check_directory(parent)
  for part in path.parts[1:-1]:
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);os.close(parent);parent=child;check_directory(parent)
  fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent);before=os.fstat(fd)
  need(stat.S_ISREG(before.st_mode)and before.st_uid==owner and before.st_nlink==1 and stat.S_IMODE(before.st_mode)==0o600 and 0<before.st_size<=LIMIT,'PRIVATE_INPUT_FILE_TRUST')
  chunks=[];count=0
  while True:
   raw=_read_chunk(fd,min(4096,LIMIT-count+1))
   if not raw:break
   chunks.append(raw);count+=len(raw);need(count<=LIMIT,'PRIVATE_INPUT_FILE_LIMIT')
  after=os.fstat(fd);named=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
  need(_signature(before)==_signature(after)==_signature(named)and count==before.st_size,'PRIVATE_INPUT_FILE_CHANGED')
  raw=b''.join(chunks);need(hashlib.sha256(raw).hexdigest()==pin,'PRIVATE_INPUT_FILE_HASH');return raw
 except OSError:raise ValueError('PRIVATE_INPUT_UNAVAILABLE')from None
 finally:
  if fd is not None:os.close(fd)
  if parent is not None:os.close(parent)

def _validate_payload(value,purpose):
 need(type(value)is dict,'PRIVATE_INPUT_PAYLOAD_FORMAT')
 if purpose=='migration-environment':
  need(ENV_REQUIRED<=set(value)<=ENV_FIELDS and all(type(v)is str and 0<len(v)<=16384 for v in value.values()),'PRIVATE_INPUT_PAYLOAD_FORMAT')
 else:
  need(set(value)=={'primary','foreign','restricted'},'PRIVATE_INPUT_PAYLOAD_FORMAT')
  for row in value.values():need(type(row)is dict and set(row)=={'email','password'}and all(type(v)is str and 0<len(v)<=16384 for v in row.values()),'PRIVATE_INPUT_PAYLOAD_FORMAT')
 return value

def _decode_env_file(raw):
 """Literal Docker-style KEY=VALUE contract; never shell evaluation."""
 try:text=raw.decode('utf-8',errors='strict')
 except (UnicodeError,AttributeError):raise ValueError('PRIVATE_INPUT_ENV_ENCODING')from None
 need('\x00'not in text,'PRIVATE_INPUT_ENV_NUL')
 result={}
 for line in text.split('\n'):
  if line.endswith('\r'):line=line[:-1]
  if not line.strip()or line.lstrip().startswith('#'):continue
  need('='in line,'PRIVATE_INPUT_ENV_ASSIGNMENT')
  key,value=line.split('=',1)
  need(key in ENV_FIELDS,'PRIVATE_INPUT_ENV_KEY')
  need(key not in result,'PRIVATE_INPUT_DUPLICATE_KEY')
  result[key]=value
 return result


def resolve_ref(value,purpose):
 """Only root-owned, exact-format input; secret values remain solely in memory."""
 ref=validate_ref(value,purpose)
 raw=_read_private(ref['path'],ref['sha256'],owner=0)
 payload=_decode_env_file(raw)if ref['format']==ENV_FILE_FORMAT else _decode(raw)
 return _validate_payload(payload,purpose)
