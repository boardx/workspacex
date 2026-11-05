#!/usr/bin/env python3
"""Issue 6275: fixed model, approved 3x rate, reviewed quote/org snapshot, audited writes.
Defaults to read-only dry-run. Apply/rollback require the exact dry-run digest.
No arbitrary SQL, model, provider, actor identity or DB destination input is accepted.
"""
import json,os,subprocess

REPAIR=r'''
import {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {migrationConfig} from './src/infrastructure/db/pg-config.ts';
import {readProductConfiguration,personalConfiguredProducts} from './src/infrastructure/billing/product-catalog-configuration.ts';
const MODEL='qwen3-asr-flash-realtime',PROVIDER='dashscope',VERSION='asr-credit-6275-v1',QUANTUM=4300n,RATE=33n;
const CATALOG='catalog-cn-2cc7238acdeab60b248b9cd2f65f8afe2ad072ad92e5db1b67fcf16f335632ec';
const e=process.env,action=e.ASR_REPAIR_ACTION??'dry-run',expected=e.ASR_REPAIR_EXPECTED??'';
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{repairCode:c});};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
let pool,client;
try{
 need(['dry-run','apply','rollback'].includes(action),'invalid_action');
 const url=new URL(e.KERNEL_ASR_BASE_URL);
 need(e.KERNEL_ASR_PROVIDER===PROVIDER&&e.KERNEL_ASR_MODEL===MODEL&&url.protocol==='wss:'&&url.hostname==='dashscope.aliyuncs.com'&&!url.username&&!url.password&&!url.port,'live_model_region_changed');
 need(!!e.MIGRATION_DB_USER&&!!e.MIGRATION_DB_PASSWORD,'configured_owner_required');
 const actor=`maintenance:github-actions:${e.ASR_REPAIR_RUN_ID}:${e.ASR_REPAIR_ACTOR}:issue6275`;
 if(action!=='dry-run')need(/^\d+$/.test(e.ASR_REPAIR_RUN_ID??'')&&/^[A-Za-z0-9-]{1,100}$/.test(e.ASR_REPAIR_ACTOR??'')&&/^[a-f0-9]{64}$/.test(expected),'reviewed_snapshot_and_actor_required');
 pool=new Pool({...migrationConfig(),connectionTimeoutMillis:5000,statement_timeout:10000,max:1});client=await pool.connect();
 await client.query(action==='dry-run'?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL SERIALIZABLE');
 await client.query('SET LOCAL row_security=off');
 await client.query("SET LOCAL lock_timeout='5000ms'");
 if(action!=='dry-run')await client.query('LOCK TABLE organizations IN SHARE MODE');
 const configured=await readProductConfiguration(client,'cn');
 const products=personalConfiguredProducts(configured.rows).filter(p=>p.kind==='credit_topup'&&p.currency==='CNY').sort((a,b)=>a.amountMinor-b.amountMinor);
 const sku=products[0];
 need(configured.version===CATALOG&&sku?.sku==='credit-cn-10000-v1'&&sku.amountMinor===12900&&sku.credits===10000&&products[1]?.amountMinor!==sku.amountMinor,'live_quote_changed');
 // Rational reduction preserves 3x supplier cost; round only the whole request to 0.01 credit.
 const numerator=330n*3n*BigInt(sku.credits)*100n,denominator=BigInt(sku.amountMinor)*10000n*1000n;
 need(numerator*QUANTUM===RATE*denominator,'rate_invariant_failed');
 const orgs=(await client.query('SELECT id FROM organizations ORDER BY id')).rows.map(r=>r.id);
 need(orgs.length===18,'organization_inventory_changed');
 if(action!=='dry-run')for(const org of orgs)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['credit-native-tariff',org,PROVIDER,MODEL,'millisecond'])]);
 const before=(await client.query('SELECT org_id,model_provider,model_id,unit,quantum::text,hundredths_per_quantum::text,version FROM credit_native_tariffs WHERE model_provider=$1 AND model_id=$2 AND unit=$3 ORDER BY org_id',[PROVIDER,MODEL,'millisecond'])).rows;
 const digest=hash({catalogVersion:configured.version,sku:sku.sku,amountMinor:sku.amountMinor,credits:sku.credits,orgs,before,provider:PROVIDER,model:MODEL,region:'cn-beijing',quantum:String(QUANTUM),rate:String(RATE),markup:3});
 const quote={catalogVersion:configured.version,sku:sku.sku,amountMinor:sku.amountMinor,credits:sku.credits,region:'cn-beijing',supplierMicrosPerSecond:'330',markup:3,quantumMilliseconds:String(QUANTUM),hundredthsPerQuantum:String(RATE),rounding:'ceil-on-total-request-to-credit-hundredth'};
 let affected=0;
 if(action==='apply'){
  need(digest===expected,'reviewed_snapshot_changed');
  // Existing explicit overrides are preserved, even if their prices differ.
  const priced=new Set(before.map(r=>r.org_id));
  for(const orgId of orgs.filter(id=>!priced.has(id))){
   const value={orgId,modelProvider:PROVIDER,modelId:MODEL,unit:'millisecond',quantum:String(QUANTUM),hundredthsPerQuantum:String(RATE),version:VERSION};
   const inserted=await client.query('INSERT INTO credit_native_tariffs(org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING org_id',[orgId,PROVIDER,MODEL,'millisecond',String(QUANTUM),String(RATE),VERSION]);
   need(inserted.rows.length===1,'concurrent_tariff_changed');
   await client.query('INSERT INTO credit_native_tariff_changes(org_id,actor_id,old_tariff,new_tariff) VALUES($1,$2,$3::jsonb,$4::jsonb)',[orgId,actor,null,JSON.stringify({...value,maintenance:{issue:6275,snapshot:expected,quote}})]);affected++;
  }
 }else if(action==='rollback'){
  const changes=(await client.query("SELECT org_id,new_tariff FROM credit_native_tariff_changes WHERE new_tariff->>'version'=$1 AND new_tariff->'maintenance'->>'snapshot'=$2 AND old_tariff IS NULL AND actor_id LIKE 'maintenance:github-actions:%:issue6275' ORDER BY org_id",[VERSION,expected])).rows;
  need(changes.length>0&&changes.length<=18,'rollback_snapshot_missing');
  for(const change of changes){
   const live=before.find(r=>r.org_id===change.org_id),prior=change.new_tariff;
   need(live&&live.version===VERSION&&live.quantum===prior.quantum&&live.hundredths_per_quantum===prior.hundredthsPerQuantum,'rollback_tariff_was_modified');
  }
  for(const change of changes){
   await client.query('DELETE FROM credit_native_tariffs WHERE org_id=$1 AND model_provider=$2 AND model_id=$3 AND unit=$4 AND version=$5',[change.org_id,PROVIDER,MODEL,'millisecond',VERSION]);
   await client.query('INSERT INTO credit_native_tariff_changes(org_id,actor_id,old_tariff,new_tariff) VALUES($1,$2,$3::jsonb,$4::jsonb)',[change.org_id,actor,JSON.stringify(change.new_tariff),JSON.stringify({deleted:true,modelProvider:PROVIDER,modelId:MODEL,unit:'millisecond',version:VERSION,maintenance:{issue:6275,rollbackOfSnapshot:expected}})]);affected++;
  }
 }
 await client.query('COMMIT');
 console.log(JSON.stringify({action,committed:action!=='dry-run',version:VERSION,snapshot:action==='rollback'?expected:digest,organizationCount:orgs.length,existingOverrides:before.length,missingCount:orgs.length-before.length,affected,quote,receiptBoundary:'estimated-duration-remains-pending-not-vendor-reported',newOrganizations:'not-covered-future-policy-required'}));
}catch(error){try{await client?.query('ROLLBACK');}catch{}console.log(JSON.stringify({action,committed:false,code:error?.repairCode??'controlled_repair_unavailable'}));process.exitCode=1;}
finally{client?.release();await pool?.end();}
'''

def run():
    action=os.environ.get('ASR_REPAIR_ACTION','dry-run')
    expected=os.environ.get('ASR_REPAIR_EXPECTED','')
    if action not in ('dry-run','apply','rollback'):raise ValueError('invalid_action')
    result=subprocess.run(['docker','ps','--filter','label=com.docker.compose.project=workspacex-image','--filter','label=com.docker.compose.service=api','--format','{{.ID}}'],capture_output=True,text=True,timeout=15,check=True)
    ids=result.stdout.split()
    if len(ids)!=1:raise ValueError('unique_devapp_api_required')
    # GitHub actor/run provenance is supplied by the fixed workflow, never a fake platform user.
    values={'ASR_REPAIR_ACTION':action,'ASR_REPAIR_EXPECTED':expected,'ASR_REPAIR_RUN_ID':os.environ.get('GITHUB_RUN_ID',''),'ASR_REPAIR_ACTOR':os.environ.get('GITHUB_ACTOR','')}
    args=['docker','exec','-i']
    for key,value in values.items():args+=['-e',key+'='+value]
    args += [ids[0],'node','--import','tsx','--input-type=module']
    result=subprocess.run(args,input=REPAIR,capture_output=True,text=True,timeout=90,check=False)
    # Only our final fixed JSON envelope can reach workflow output.
    output=json.loads(result.stdout.strip())
    print(json.dumps(output,sort_keys=True))
    if result.returncode:raise SystemExit(1)

if __name__=='__main__':
    try:run()
    except Exception:print(json.dumps({'committed':False,'code':'controlled_repair_unavailable'}));raise SystemExit(1)
