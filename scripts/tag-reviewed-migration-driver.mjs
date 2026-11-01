// Exact-release transaction engine. Host adapters own protected DB configuration,
// canonical release lock, stopped-service proof and independent backup qualification.
import {createHash} from 'node:crypto';
export const reviewed={
 '20261031090000_billing_stripe_topups.sql':'4fad25595e048b4405629c3c84ece4e3ba8b1bc7b97eb6430a22b62dbfcfc633',
 '20261031091000_billing_wechat_monthly.sql':'b1915a85f1fb8973e81eb47ed8aacba88fca67f20b610c150e204a1ba077d561',
 '20261031150000_billing_subscription_amount_snapshot.sql':'9f8bbc4b1e23a80eba6a5743d3a314c8f872077597636acfb0b17e5bb8a0d43c',
};
const need=(v,code)=>{if(!v)throw Object.assign(new Error(code),{safeCode:code});};
const equal=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.entries(b).every(([k,v])=>a[k]===v);
export function validate(plan,files){
 need(['cn','us'].includes(plan.environment)&&plan.source==='e44119db91e9539418ad605ca6aaef2c155d0116'&&plan.tag==='41248889927-1','RELEASE_BINDING');
 const base=plan.baselineLedger;
 need(base&&Object.keys(base).length>0&&Object.entries(base).every(([n,v])=>/^[a-zA-Z0-9_.-]+\.sql$/.test(n)&&/^[a-f0-9]{64}$/.test(v)&&!Object.hasOwn(reviewed,n)),'BASELINE_INVALID');
 need(equal(Object.fromEntries(Object.entries(files).map(([n,v])=>[n,createHash('sha256').update(v).digest('hex')])),reviewed),'SQL_BINDING');
 need(plan.database&&['migration_admin','postgres'].includes(plan.role)&&plan.role===(plan.environment==='cn'?'migration_admin':'postgres'),'DATABASE_ROLE_BINDING');
 return {...base,...reviewed};
}
export async function executeReviewedMigration({client:c,mode,plan,files}){
 let transaction=false,commitSent=false,stage='validation';
 try{
  const target=validate(plan,files);need(['preflight','reconcile','apply'].includes(mode),'MODE');
  stage='identity';const id=(await c.query('SELECT current_database() AS database,current_user AS role')).rows[0];
  need(id.database===plan.database&&id.role===plan.role,'CONNECTED_DATABASE_BINDING');
  await c.query("SET statement_timeout='30s'");await c.query("SET lock_timeout='10s'");
  await c.query(mode==='apply'?'BEGIN':'BEGIN READ ONLY');transaction=true;
  await c.query("SET LOCAL idle_in_transaction_session_timeout='120s'");
  if(mode==='apply')need((await c.query("SELECT pg_try_advisory_xact_lock(8014530119003001) AS locked")).rows[0].locked===true,'MIGRATION_LOCK_BUSY');
  const ledger=async()=>{
   const rows=(await c.query('SELECT name,checksum FROM public._kernel_migrations ORDER BY name')).rows;
   const value=Object.fromEntries(rows.map(r=>[r.name,r.checksum]));need(Object.keys(value).length===rows.length,'LEDGER_DUPLICATE');return value;
  };
  stage='ledger';const before=await ledger();
  if(mode!=='apply'){
   const status=equal(before,plan.baselineLedger)?'BASELINE':equal(before,target)?'COMPLETE':'DRIFT';
   await c.query('ROLLBACK');transaction=false;need(status!=='DRIFT','LEDGER_DRIFT');return {status,readOnly:true};
  }
  need(equal(before,plan.baselineLedger),'PRE_WRITE_LEDGER_DRIFT');stage='drain';
  // Strictly all other client sessions, including idle pools; no termination here.
  need((await c.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).rows[0].n===0,'OTHER_DATABASE_SESSIONS');
  need((await c.query('SELECT count(*)::integer AS n FROM pg_prepared_xacts WHERE database=current_database()')).rows[0].n===0,'PREPARED_TRANSACTIONS');
  for(const name of Object.keys(reviewed).sort()){
   stage='migration';await c.query(files[name]);
   await c.query('INSERT INTO public._kernel_migrations(name,checksum) VALUES($1,$2)',[name,reviewed[name]]);
  }
  need(equal(await ledger(),target),'POST_WRITE_LEDGER_DRIFT');
  stage='commit';commitSent=true;await c.query('COMMIT');transaction=false;
  return {status:'COMMITTED',commitAcknowledged:true,ledgerCount:Object.keys(target).length};
 }catch(error){
  let rollbackAcknowledged=false;
  if(transaction&&!commitSent)try{await c.query('ROLLBACK');rollbackAcknowledged=true;}catch{}
  return {status:commitSent?'COMMIT_UNKNOWN_RECONCILE_REQUIRED':'FAILED',stage,code:error.safeCode??'QUERY_REJECTED',rollbackAcknowledged};
 }
}
