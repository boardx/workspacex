import importlib.util
from pathlib import Path
import unittest
P=Path(__file__).resolve().parents[1]/'scripts/devapp-active-epoch-release.py'
def load():
 s=importlib.util.spec_from_file_location('active_release',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class ActiveEpoch(unittest.TestCase):
 def test_hashes_match_actual_repository_sql_bytes(self):
  import hashlib
  m=load();root=P.parents[1]
  for name,checksum in m.MIGRATIONS.items():self.assertEqual(hashlib.sha256((root/'apps/api/migrations'/name).read_bytes()).hexdigest(),checksum,name)
 def test_live_epoch_preserved(self):
  m=load();v={'exists':True,'rows':[{'generation':m.GENERATION,'activated_at':'2026-11-02T13:00:00+00:00'}]};m.check_epoch(v,True)
 def test_dormant_wrong_missing_rejected(self):
  m=load()
  for v in [{'exists':False},{'exists':True,'rows':[]},{'exists':True,'rows':[{'generation':None,'activated_at':None}]},{'exists':True,'rows':[{'generation':'other','activated_at':'2026-11-02T13:00:00+00:00'}]}]:
   with self.assertRaises(ValueError):m.check_epoch(v)
 def test_exact_three_and_history(self):
  m=load();b={str(i):'a'*64 for i in range(447)};self.assertEqual(m.base.ledger_state(b,b),'BASELINE');self.assertEqual(m.base.ledger_state(b,{**b,**m.MIGRATIONS}),'COMPLETE')
  for c in [{**b,**m.MIGRATIONS,'unknown':'b'*64},{**b,'0':'b'*64}]:
   with self.assertRaises(ValueError):m.base.ledger_state(b,c)
 def test_no_partial_replay(self):
  m=load();b={str(i):'a'*64 for i in range(447)};k=next(iter(m.MIGRATIONS));self.assertEqual(m.base.ledger_state(b,{**b,k:m.MIGRATIONS[k]}),'PARTIAL')
 def test_old_module_defaults_unchanged(self):
  m=load();self.assertEqual(m.base.BASELINE_LEDGER_COUNT,447);self.assertEqual(m.base.CAPABILITY_KIND,'devapp-active-epoch-three-release-v1');self.assertEqual(len(m.MIGRATIONS),3)
 def snapshot(self,m):
  import copy
  old={'terms':[{'term_id':'t','amount_minor':19900}], 'prices':[], 'wallets':'balance-20000','ledger':'one','epoch':'active'}
  for sku,(market,currency,amount,cycle,order) in m.PRO_DEFAULTS.items():
   old['prices'].append(dict(package_id=sku,region=market,currency=currency,amount_fen=amount,base_credits=20000,bonus_credits=0,bonus_rate=0,total_credits=20000,owner_type='user',enabled=True,sort_order=order))
  new=copy.deepcopy(old);new['terms'][0]['monthly_credits']=20000
  for row in new['prices']:row.update(m.NEW_FIELDS);row.update(product_kind='subscription',billing_cycle=m.PRO_DEFAULTS[row['package_id']][3])
  return old,new
 def test_precise_projection(self):
  m=load();a,b=self.snapshot(m);m.check_finance(a,b)
 def test_existing_pro_price_and_credit_changes_rejected(self):
  import copy
  m=load();a,b=self.snapshot(m)
  for key in ['amount_fen','total_credits','base_credits','bonus_credits']:
   c=copy.deepcopy(b);c['prices'][0][key]+=1
   with self.assertRaises(ValueError):m.check_finance(a,c)
 def test_new_fields_and_terms_cannot_hide_entitlement_change(self):
  import copy
  m=load();a,b=self.snapshot(m)
  for field,val in [('billing_cycle','year'),('included_seats',99),('product_kind','legacy')]:
   c=copy.deepcopy(b);c['prices'][0][field]=val
   with self.assertRaises(ValueError):m.check_finance(a,c)
  b['terms'][0]['monthly_credits']=1
  with self.assertRaises(ValueError):m.check_finance(a,b)
 def test_new_seed_defaults_and_unknown_sku_rejected(self):
  import copy
  m=load();a,b=self.snapshot(m);a['prices']=[];m.check_finance(a,b)
  c=copy.deepcopy(b);c['prices'][0]['amount_fen']=1
  with self.assertRaises(ValueError):m.check_finance(a,c)
  c=copy.deepcopy(b);c['prices'][0]['bonus_rate']=0.5
  with self.assertRaises(ValueError):m.check_finance(a,c)
  c=copy.deepcopy(b);c['prices'].append({'package_id':'unknown'})
  with self.assertRaises(ValueError):m.check_finance(a,c)
 def test_known_finance_rejection_survives_complete_reconcile(self):
  m=load();db=object.__new__(m.Database);db.ctx={'financialRejected':True}
  with self.assertRaisesRegex(ValueError,'FINANCIAL_RECONCILIATION_REJECTED'):db.reconcile()
 def test_unknown_ack_cannot_swallow_financial_rejection(self):
  m=load()
  class D:
   def __init__(self):self.rejected=False
   def read(self):
    if self.rejected:raise ValueError('FINANCIAL_RECONCILIATION_REJECTED')
    return {'state':'BASELINE'}
   def apply(self):self.rejected=True;raise ValueError('FINANCIAL_STATE_CHANGED')
   def drain(self):pass
   def reconcile(self):return self.read()
  with self.assertRaisesRegex(ValueError,'FINANCIAL_RECONCILIATION_REJECTED'):m.base.apply_once(D(),lambda e:None)
 def test_owned_business_explicit_for_active_only(self):
  m=load();self.assertTrue(m.base.owned_business({'p':{'activeEpochThree':True}}));self.assertFalse(m.base.owned_business({'p':{}}))
class WholeWriter(unittest.TestCase):
 def exercise(self,failure=None,initial_state=None):
  from unittest.mock import patch
  import test_devapp_reviewed_tag_release as prior
  m=load()
  with patch.object(m,'Database') as database:
   return prior.FullWriterStateMachine.exercise(self,failure,initial_state=initial_state,active=m,active_database=database)
 def test_first_save_publishes_financial_ref(self):
  import json
  m,ctx,state,events,pending,error=self.exercise();self.assertIsNone(error);self.assertEqual(state['images'],{'api':'new'})
  receipt=json.loads(ctx['receipt'].read_bytes());proof=json.loads((ctx['attempt']/'migration-ledger.json').read_bytes());self.assertTrue(proof['financialInvariant']);self.assertEqual(receipt['proofs']['migration-ledger'],m.ref(ctx['attempt']/'migration-ledger.json'))
 def test_initial_complete_fails_before_stop_or_activation(self):
  m,ctx,state,events,pending,error=self.exercise(initial_state='COMPLETE');self.assertRegex(str(error),'FRESH_BASELINE_447_REQUIRED');self.assertFalse(events)
 def test_active_cleanup_failure_no_second_business(self):
  import json
  m,ctx,state,events,pending,error=self.exercise('cleanup');self.assertRegex(str(error),'OWNED_PROCESS_GROUP_NOT_REAPED');self.assertNotIn('business-recovery',events);self.assertFalse(state['running']);self.assertEqual(json.loads((ctx['attempt']/'failure.json').read_bytes())['trafficControl'],'stopped-five-applications')
if __name__=='__main__':unittest.main()
