import {it,expect,vi} from 'vitest';
import {PgGlobalImageTariffRepository} from '../../src/infrastructure/billing/pg-global-image-tariff-repository';
import {GlobalImageTariffConflict,GlobalImageTariffWriterUnavailable} from '../../src/application/billing/global-image-tariff-service';
const row={package_id:'cn-live',region:'cn',currency:'CNY',amount_fen:12900,total_credits:10000,owner_type:'user',product_kind:'credit_topup',billing_cycle:null,included_seats:null,extra_seat_amount_fen:null,extra_seat_monthly_credits:null,extra_seat_monthly_credits_unused:null,sort_order:0};
function fixture(rows:unknown[]=[row]){const calls:string[]=[];let revision:string|null=null;let items:unknown[]=[];const query=vi.fn(async(sql:string,params?:readonly unknown[])=>{calls.push(sql);if(sql.includes('FROM credit_global_image_schedule'))return {rows:revision?[{revision,schedule:items}]:[]};if(sql.includes('FROM credit_packages'))return {rows};if(sql.startsWith('INSERT INTO credit_global_image_schedule')){revision=String(params![0]);items=JSON.parse(String(params![2]));}return {rows:[]};});const db={withoutTenant:async(work:(s:{query:typeof query})=>unknown)=>work({query}),close:vi.fn(async()=>{})};return {repo:new PgGlobalImageTariffRepository(db as never,db as never),db,calls,query};}
it('requires separate writer and rejects stale schedule before catalog/write',async()=>{
 expect(()=>new PgGlobalImageTariffRepository({} as never,null).activate('operator',{expectedRevision:null,expectedCatalogVersion:'v'})).toThrow(GlobalImageTariffWriterUnavailable);
 const f=fixture();await expect(f.repo.activate('operator',{expectedRevision:'stale',expectedCatalogVersion:'v'})).rejects.toBeInstanceOf(GlobalImageTariffConflict);expect(f.calls.some(sql=>sql.startsWith('INSERT'))).toBe(false);
});
it('stale catalog produces no mutation',async()=>{const f=fixture();await expect(f.repo.activate('operator',{expectedRevision:null,expectedCatalogVersion:'stale'})).rejects.toBeInstanceOf(GlobalImageTariffConflict);expect(f.calls.some(sql=>sql.startsWith('INSERT'))).toBe(false);});

it('missing or ambiguous catalog rejects without global mutation',async()=>{
 for(const rows of [[],[row,{...row,package_id:'duplicate'}]]){
  const f=fixture(rows);await expect(f.repo.activate('operator',{expectedRevision:null,expectedCatalogVersion:'unused'})).rejects.toThrow();expect(f.calls.some(sql=>sql.startsWith('INSERT'))).toBe(false);
 }
});
