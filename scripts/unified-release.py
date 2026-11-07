#!/usr/bin/env python3
"""Shared release state machine. Host adapters supply environment inputs, not policy.

Callers hold the canonical environment lock throughout release/recovery. State and
rendered Compose files contain secrets and live under a root-private release root.
"""
import json,os,re,tempfile,uuid
from pathlib import Path

def atomic(path,value):
 path=Path(path);fd,name=tempfile.mkstemp(dir=path.parent,prefix='.release-')
 try:
  with os.fdopen(fd,'w') as f:json.dump(value,f,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
  os.replace(name,path)
  fd=os.open(path.parent,os.O_RDONLY)
  try:os.fsync(fd)
  finally:os.close(fd)
 finally:
  if os.path.exists(name):os.unlink(name)

def layout(root):
 root=Path(root);root.mkdir(mode=0o700,parents=True,exist_ok=True)
 for name in ('config','log','current','previous','backup','data'):(root/name).mkdir(mode=0o700,exist_ok=True)

def recover(root,adapter):
 root=Path(root);active=root/'log/active.json'
 try:
  interrupted=json.loads(active.read_bytes());state=root/'config/versions.json'
  if state.exists():
   versions=json.loads(state.read_bytes())
   # A durable pointer commit wins over incomplete human-readable projections.
   if versions.get('attempt')==interrupted.get('attempt') and versions.get('attempt'):
    adapter.start(versions['current']);adapter.verify(versions['current'])
    atomic(root/'current/release.json',versions['current']);atomic(root/'previous/release.json',versions['previous'])
    active.unlink();return {'status':'SUCCEEDED','stage':'recovered-publication','database':interrupted['database']}
  baseline=interrupted['baseline']
  if not baseline:raise ValueError('BASELINE_MISSING')
  adapter.start(baseline);adapter.verify(baseline)
  if interrupted['database']=='RECONCILE_REQUIRED':
   check=adapter.plan(interrupted['candidate'],Path(interrupted['attempt']))
   if check.get('status') not in ('PENDING','COMPLETE'):raise ValueError('LEDGER_RECONCILIATION_FAILED')
   interrupted['databaseReconciliation']=check
  atomic(root/'log'/('recovery-'+uuid.uuid4().hex+'.json'),interrupted)
  active.unlink();return {'status':'ROLLED_BACK','stage':'recovered-application','database':interrupted['database']}
 except Exception:return {'status':'RECOVERY_REQUIRED','stage':'recovery','database':'RECONCILE_REQUIRED'}

def release(root,tag,adapter):
 root=Path(root);layout(root);active=root/'log/active.json'
 if active.exists():
  recovered=recover(root,adapter)
  if recovered['status']=='RECOVERY_REQUIRED':return recovered
 attempt=root/'log'/('release-'+uuid.uuid4().hex);attempt.mkdir(mode=0o700)
 stage='prepare';mutated=False;published=False;database='UNCHANGED';baseline=None
 context={'attempt':str(attempt),'tag':tag};candidate=None
 def record():atomic(active,{**context,'stage':stage,'database':database,'baseline':baseline,'candidate':candidate})
 try:
  candidate=adapter.prepare(tag,attempt)
  stage='baseline';baseline=adapter.baseline(attempt)
  stage='plan';plan=adapter.plan(candidate,attempt)
  if plan.get('status') not in ('PENDING','COMPLETE'):raise ValueError('MIGRATION_PLAN_FAILED')
  record()
  if plan['status']=='PENDING':
   stage='stop';mutated=True;record();adapter.stop(baseline)
   stage='backup';record();adapter.backup(attempt)
   stage='migrate';database='RECONCILE_REQUIRED';record()
   result=adapter.migrate(candidate,attempt)
   if result.get('status')!='COMPLETE':raise ValueError('MIGRATION_NOT_COMPLETE')
   database='COMPLETE';record()
  else:database='COMPLETE'
  stage='start';mutated=True;record();adapter.start(candidate)
  stage='verify';record();adapter.verify(candidate)
  # One authoritative atomic object contains both pointers. Directory copies are
  # human-readable projections; recover them from config/versions.json on startup.
  stage='publish';record()
  atomic(root/'config/versions.json',{'attempt':str(attempt),'current':candidate,'previous':baseline})
  published=True
  atomic(root/'previous/release.json',baseline);atomic(root/'current/release.json',candidate)
  result={**context,'status':'SUCCEEDED','stage':'complete','database':database,'verification':'runtime-readiness'}
  atomic(attempt/'result.json',result);active.unlink();return result
 except Exception as error:
  code=str(error)
  result={**context,'status':'FAILED','stage':stage,'database':database,'code':code if re.fullmatch(r'[A-Z][A-Z0-9_]{1,100}',code) else 'RELEASE_OPERATION_FAILED'}
  # os.replace may have succeeded even when its following directory fsync fails.
  # Recovery reads the authoritative attempt before deciding which runtime wins.
  if published or stage=='publish':result['status']='RECOVERY_REQUIRED'
  elif mutated and baseline is not None:
   try:
    adapter.start(baseline);adapter.verify(baseline);result['status']='ROLLED_BACK'
   except Exception:result['status']='RECOVERY_REQUIRED'
  atomic(attempt/'result.json',result)
  if result['status']!='RECOVERY_REQUIRED' and database!='RECONCILE_REQUIRED' and active.exists():active.unlink()
  return result
