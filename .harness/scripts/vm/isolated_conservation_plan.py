"""Strict frozen conservation closure; no cloud operations or secret persistence."""
import hashlib,json,os,re,stat
from pathlib import Path
DBS=('workspacex','workspacex_agent','workspacex_memory')
def reject(code):raise ValueError(code)
def private_bytes(path,digest,limit=32*1024*1024):
 p=Path(path)
 if not p.is_absolute():reject('ABSOLUTE_PRIVATE_INPUT_REQUIRED')
 for parent in p.parents:
  s=parent.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_gid!=0 or s.st_mode&0o022:reject('UNTRUSTED_INPUT_ANCESTOR')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno())
  if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_gid!=0 or stat.S_IMODE(s.st_mode)!=0o600 or not 0<s.st_size<=limit:reject('PRIVATE_INPUT_REQUIRED')
  raw=f.read(limit+1)
 if not re.fullmatch('[a-f0-9]{64}',digest or '') or hashlib.sha256(raw).hexdigest()!=digest:reject('INPUT_HASH_DRIFT')
 return raw
def read_ref(ref,reader=private_bytes):
 if not isinstance(ref,dict) or set(ref)!={'path','sha256'}:reject('PROOF_REFERENCE_SHAPE')
 return json.loads(reader(ref['path'],ref['sha256']))
def validate_plan(plan,binding):
 if plan.get('schemaVersion')!=1 or plan.get('frozen') is not True or plan.get('prepared') is not True or plan.get('candidateSha')!=binding['candidateSha'] or plan.get('seed') is not False or plan.get('force') is not False:reject('FROZEN_CONSERVATION_PLAN_REQUIRED')
 sql=plan.get('fullSqlChecksums');laws=plan.get('migrationLawBindings')
 if not isinstance(sql,dict) or not sql or not isinstance(laws,dict) or set(sql)!=set(laws):reject('COMPLETE_MIGRATION_LAWS_REQUIRED')
 for filename,digest in sql.items():
  if not re.fullmatch(r'[a-zA-Z0-9_-]+\.sql',filename) or not re.fullmatch('[a-f0-9]{64}',digest):reject('MIGRATION_HASH_SHAPE')
  law=laws[filename]
  if not isinstance(law,dict) or law.get('sqlSha256')!=digest or law.get('reviewed') is not True or not re.fullmatch('[a-f0-9]{64}',law.get('lawSha256','')):reject('UNREVIEWED_MIGRATION_LAW')
 if plan.get('sourceInstanceId')!=binding['sourceInstanceId']:reject('PRODUCTION_SOURCE_PLAN_BINDING')
 pending=plan.get('pendingSqlChecksums');count=plan.get('expectedLedgerCount');canonical=plan.get('canonicalSchemaPlanHashes')
 if not isinstance(pending,dict) or not pending or any(sql.get(n)!=h for n,h in pending.items()) or not isinstance(count,int) or isinstance(count,bool) or count<1:reject('ACTUAL_LEDGER_PLAN_REQUIRED')
 if not isinstance(canonical,dict) or set(canonical)!={'workspacex_agent','workspacex_memory'} or any(not re.fullmatch('[a-f0-9]{64}',h) for h in canonical.values()):reject('CANONICAL_SCHEMA_PLAN_HASH_REQUIRED')
 if set(plan.get('databases',[]))!=set(DBS):reject('THREE_DATABASE_PLAN_REQUIRED')
 if plan.get('canonicalSourceSha')!=binding['candidateSha'] or set(plan.get('canonicalSourceFiles',{}))!={'memory_deployment.py','postgres_checkpointer.py','self_hosted_runtime.py','pyproject.toml'}:reject('CANONICAL_SOURCE_CLOSURE_REQUIRED')
 if any(not re.fullmatch('[a-f0-9]{64}',v) for v in plan['canonicalSourceFiles'].values()):reject('CANONICAL_SOURCE_HASH_REQUIRED')
 return plan

def verify_final_sql_inventory(plan,observation):
 """Freeze cannot relabel source: every committed SQL byte digest must match."""
 files=observation.get('files')
 if not isinstance(files,list) or not files:reject('FINAL_SQL_INVENTORY_REQUIRED')
 actual={}
 for entry in files:
  name=entry.get('path','').split('/')[-1]
  if name in actual:reject('FINAL_SQL_DUPLICATE')
  actual[name]=entry.get('sha256')
 if actual!=plan.get('fullSqlChecksums'):reject('FINAL_SQL_CLOSURE_DRIFT')
 return True
