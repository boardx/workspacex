#!/usr/bin/env python3
"""Build exact, lossless schema/manual-data components for the reviewed CN release.

This is a plan builder, not a SQL executor. Historical migration bytes stay intact.
The four data ranges below are reviewed complete top-level statements, not a SQL
regex filter. Unknown source revisions or content changes fail closed.
"""
import hashlib
import json

SOURCE = '9eaedc66c6f9d83220ba702ecc62205a0bdaaa4b'
BASELINE = 'f0eb9d07398a66fdd5646a9e6b855fa1b940e571'
RANGES = {
 '20261001090000_billing_credits_core.sql': [('INSERT INTO credit_packages\n', 'ON CONFLICT (package_id) DO NOTHING;')],
 '20261021100000_billing_stripe_webhook.sql': [('INSERT INTO billing_stripe_bindings(subscription_ref,user_id,binding_generation,customer_ref) SELECT', 'ON CONFLICT DO NOTHING;')],
 '20261022023000_billing_reference_packages.sql': [('UPDATE credit_packages SET enabled=false', 'enabled=EXCLUDED.enabled,sort_order=EXCLUDED.sort_order;')],
 '20261022110000_credit_consumption_settings.sql': [('INSERT INTO credit_consumption_settings(singleton)', 'ON CONFLICT(singleton) DO NOTHING;')],
}

def digest(b):
 return hashlib.sha256(b).hexdigest()

def components(name, raw, expected):
 if digest(raw) != expected:
  raise ValueError('SOURCE_CHECKSUM_DRIFT')
 parts=[];cursor=0
 for start,end in RANGES.get(name, []):
  a=start.encode();b=end.encode()
  if raw.count(a)!=1 or raw.count(b)!=1:
   raise ValueError('REVIEWED_RANGE_DRIFT')
  left=raw.index(a);right=raw.index(b,left)+len(b)
  if left<cursor:raise ValueError('OVERLAPPING_RANGE')
  if left>cursor:parts.append(('schema',cursor,left))
  parts.append(('manual-data',left,right));cursor=right
 if cursor<len(raw):parts.append(('schema',cursor,len(raw)))
 result=[{'kind':kind,'start':a,'end':b,'sha256':digest(raw[a:b]),'sql':raw[a:b].decode()} for kind,a,b in parts]
 if b''.join(p['sql'].encode() for p in result)!=raw:
  raise ValueError('INCOMPLETE_COVERAGE')
 return {'name':name,'sourceChecksum':expected,'components':result}

def build(inputs, read_source):
 if inputs['source']!=SOURCE or inputs['baseline']!=BASELINE:
  raise ValueError('FIXED_RELEASE_ONLY')
 baseline=inputs['schemas'][BASELINE];target=inputs['schemas'][SOURCE]
 if len(baseline)!=415 or len(target)!=431 or any(target.get(k)!=v for k,v in baseline.items()):
  raise ValueError('BASELINE_DRIFT')
 pending=sorted(target.keys()-baseline.keys())
 if len(pending)!=16 or not set(RANGES)<=set(pending):
  raise ValueError('PENDING_SET_DRIFT')
 return {'kind':'cn-reviewed-schema-plan-v1','source':SOURCE,'baseline':BASELINE,
  'baselineLedger':baseline,'targetLedger':target,'manifest':inputs['manifest'],
  'migrations':[components(n,read_source(n),target[n]) for n in pending],
  'manualDataPolicy':'separate-root-operated-step; no cross-environment import',
  'rdsRestoreRehearsal':'USER_WAIVED_UNTESTED'}
