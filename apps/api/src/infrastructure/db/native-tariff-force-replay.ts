import type {Client} from 'pg';
const HISTORICAL_NATIVE_TARIFF='20261022120000_credit_consumption.sql';
/** Only the historical table reference, only force mode, only a validated complete cutover.
 * Raw migration text/checksum is retained by the caller; ordinary migrations never rewrite SQL. */
export async function nativeTariffForceReplay(client:Pick<Client,'query'>,name:string,sql:string,force:boolean){
 if(!force||name!==HISTORICAL_NATIVE_TARIFF)return {sql,mapped:false};
 const state=(await client.query<{name:string;kind:string}>("SELECT c.relname AS name,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1)",[['credit_native_tariffs','credit_native_tariffs_legacy','credit_global_native_tariffs']])).rows;
 if(!state.some(r=>r.name!=='credit_native_tariffs'||r.kind==='v'))return {sql,mapped:false};
 const validator=(await client.query<{present:boolean}>("SELECT to_regprocedure('public.kernel_native_tariff_cutover_complete(text)') IS NOT NULL AS present")).rows[0];
 if(!validator?.present)throw new Error('global_native_tariff_cutover_incomplete');
 const valid=(await client.query<{complete:boolean}>("SELECT public.kernel_native_tariff_cutover_complete('public') AS complete")).rows[0];
 if(!valid?.complete)throw new Error('global_native_tariff_cutover_incomplete');
 return {sql:sql.replace(/\bcredit_native_tariffs\b/g,'credit_native_tariffs_legacy'),mapped:true};
}
