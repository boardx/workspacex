#!/usr/bin/env python3
"""Exact three-migration DevApp capability; preserves the already active epoch.

The root entrypoint validates the complete closure before importing this module.
Reuse the reviewed bounded backup/native-migrator/recovery/proof protocol. No
caller-selected tag, SQL, epoch, count, or permission override is accepted.
"""
import datetime
import json
import importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('active_epoch_protocol',HERE/'devapp-reviewed-tag-release.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
GENERATION='billing-credits-2026-11-v1'
SOURCE='4581a58a1f002c39db28f04155a1d5436b78280f';TAG='41474708224-1'
MIGRATIONS={
 '20261102030500_credit_grant_precision.sql':'f1874b14566c98526a4975d121a00e63c42eee614e3e537f9b83ecfd0ad8b67c',
 '20261102031000_org_commercial_capacity.sql':'e3e751abc1681a9224938a898539b8b5c7888f45efe9113a1138edf43a22d5fd',
 '20261102050000_product_configuration.sql':'19ce1d1b68e10fcb4c7958e44b27c9d662a19cbad71aa182fce06893e716102b'}
POLICY='/etc/workspacex-image-release/devapp-active-epoch-release.json'
def check_epoch(value,required=False):
 base.need(type(value) is dict and value.get('exists') is True,'ACTIVE_EPOCH_REQUIRED')
 rows=value.get('rows');base.need(type(rows) is list and len(rows)==1 and type(rows[0]) is dict and set(rows[0])=={'generation','activated_at'},'ACTIVE_EPOCH_ROW')
 row=rows[0];base.need(row['generation']==GENERATION and type(row['activated_at']) is str,'ACTIVE_EPOCH_IDENTITY')
 try:t=datetime.datetime.fromisoformat(row['activated_at'])
 except (ValueError,TypeError):raise ValueError('ACTIVE_EPOCH_TIME') from None
 base.need(t.tzinfo is not None and t<=datetime.datetime.now(datetime.timezone.utc),'ACTIVE_EPOCH_TIME')
# Explicit schema projections permit only the new defaulted term field and the
# numerically identical widened grant scale. Every existing price field remains.
FINANCE_SQL="""BEGIN READ ONLY;
SELECT json_build_object(
'wallets',(SELECT md5(coalesce(string_agg(v::text,'' ORDER BY v::text),'')) FROM (SELECT to_jsonb(w)||jsonb_build_object('total_granted',total_granted::numeric(12,2)) v FROM credit_wallets w) x),
'ledger',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM credit_transactions t),
'receipts',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM billing_personal_payment_receipts t),
'purchases',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM billing_personal_purchases t),
'bindings',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM billing_personal_stripe_bindings t),
'periods',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM credit_subscription_periods t),
'allocations',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) FROM credit_subscription_allocations t),
'epoch',(SELECT jsonb_agg(to_jsonb(t)) FROM billing_pricing_epoch t),
'terms',(SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]') FROM billing_personal_terms t),
'prices',(SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]') FROM credit_packages t));
ROLLBACK;"""
PRO_DEFAULTS={
 'pro-cn-month-v1':('cn','CNY',19900,'month',0),
 'pro-cn-year-v1':('cn','CNY',199000,'year',1),
 'pro-us-month-v1':('us','USD',2900,'month',0),
 'pro-us-year-v1':('us','USD',29000,'year',1)}
TOPUPS={f'credit-{market}-{amount}-v1' for market in ('cn','us') for amount in (10000,50000,200000)}
NEW_FIELDS={'product_kind':'legacy','billing_cycle':None,'included_seats':None,'extra_seat_amount_fen':None,'extra_seat_monthly_credits':None}
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'))
def check_finance(before,after):
 base.need(set(before)==set(after),'FINANCIAL_SHAPE')
 for key in set(before)-{'terms','prices'}:base.need(before[key]==after[key],'FINANCIAL_STATE_CHANGED')
 old_terms=before['terms'];new_terms=after['terms']
 expected_terms=[dict(t,monthly_credits=t.get('monthly_credits',20000)) for t in old_terms]
 base.need(sorted(map(canonical,expected_terms))==sorted(map(canonical,new_terms)),'PAID_TERM_CHANGED')
 old={r['package_id']:r for r in before['prices']};new={r['package_id']:r for r in after['prices']}
 base.need(len(old)==len(before['prices']) and len(new)==len(after['prices']) and set(old)<=set(new) and set(new)-set(old)<=set(PRO_DEFAULTS),'PRODUCT_ROW_CHANGED')
 for sku,row in old.items():
  expected={**NEW_FIELDS,**row}
  if expected['product_kind']=='legacy' and sku in TOPUPS:expected['product_kind']='credit_topup'
  if expected['product_kind']=='legacy' and sku in PRO_DEFAULTS:expected.update(product_kind='subscription',billing_cycle=PRO_DEFAULTS[sku][3])
  base.need(new[sku]==expected,'EXISTING_PRICE_OR_ENTITLEMENT_CHANGED')
 for sku in set(new)-set(old):
  market,currency,amount,cycle,order=PRO_DEFAULTS[sku]
  expected=dict(package_id=sku,region=market,currency=currency,amount_fen=amount,base_credits=20000,bonus_credits=0,bonus_rate=0,total_credits=20000,owner_type='user',enabled=True,sort_order=order,**NEW_FIELDS)
  expected.update(product_kind='subscription',billing_cycle=cycle)
  base.need(new[sku]==expected,'NEW_PRODUCT_DEFAULT_CHANGED')
 base.need(set(PRO_DEFAULTS)<=set(new),'NEW_PRODUCT_MISSING')

OriginalDatabase=base.Database
class Database(OriginalDatabase):
 def financial_reconcile(self):
  base.need(not self.ctx.get('financialRejected'),'FINANCIAL_RECONCILIATION_REJECTED')
  if self.ctx.get('financialGuard'):
   after=json.loads(self.query(FINANCE_SQL))
   try:check_finance(self.ctx['financialBefore'],after)
   except BaseException:self.ctx['financialRejected']=True;raise
   proof={'source':SOURCE,'tag':TAG,'request':self.ctx['requestRef'],'before':self.ctx['financialBefore'],'after':after,'scope':'stopped-migration-window','createdAt':base.time.time()}
   path=self.ctx['attempt']/'financial-migration-proof.json';self.ctx['mods']['schema-restore-rehearsal'].save(path,proof)
   self.ctx['additionalMigrationProof']={'financialInvariant':base.ref(path)}
   self.ctx['financialGuard']=False
 def read(self):
  base.need(not self.ctx.get('financialRejected'),'FINANCIAL_RECONCILIATION_REJECTED')
  result=super().read();base.need(result['epoch']==self.p['expectedEpoch'],'ACTIVE_EPOCH_CHANGED')
  if result['state']=='COMPLETE':self.financial_reconcile()
  return result
 def apply(self):
  self.ctx['financialBefore']=json.loads(self.query(FINANCE_SQL));self.ctx['financialGuard']=True
  result=super().apply();self.financial_reconcile();return result
base.SOURCE=SOURCE;base.TAG=TAG;base.MIGRATIONS=MIGRATIONS;base.POLICY=POLICY
base.BASELINE_LEDGER_COUNT=447;base.CAPABILITY_KIND='devapp-active-epoch-three-release-v1'
base.CLOSURE=(*base.CLOSURE,'devapp-active-epoch-release.py','devapp-active-epoch-writer.py','devapp-active-epoch-verifier.py')
base.check_epoch=check_epoch;base.Database=Database
original_bind=base.bind
original_writer=base.writer
original_verifier=base.verifier
def bind(request_path,receipt_path,mode):
 ctx=original_bind(request_path,receipt_path,mode)
 base.need(ctx['p'].get('activeEpochThree') is True and 'resumeOriginal' not in ctx['p'] and 'expectedSchemaState' not in ctx['p'],'NO_OLD_RESUME_CAPABILITY')
 check_epoch(ctx['p'].get('expectedEpoch'),True)
 return ctx
base.bind=bind
def writer(ctx):
 base.need(Database(ctx).read()['state']=='BASELINE','FRESH_BASELINE_447_REQUIRED')
 original_writer(ctx)
def verifier(ctx):
 ledger=base.read(base.pinned(base.read(ctx['receipt'])['proofs']['migration-ledger']))
 path=base.pinned(ledger['financialInvariant']);base.need(path==ctx['attempt']/'financial-migration-proof.json','FINANCIAL_PROOF_ATTEMPT')
 proof=base.read(path);base.need(proof.get('source')==SOURCE and proof.get('tag')==TAG and proof.get('request')==ctx['requestRef'] and proof.get('scope')=='stopped-migration-window' and 0<=base.time.time()-proof['createdAt']<600,'FINANCIAL_PROOF_IDENTITY')
 check_finance(proof['before'],proof['after']);original_verifier(ctx)
base.writer=writer;base.verifier=verifier
main=base.main
