import {createHash} from 'node:crypto';
import {GlobalImageTariffSchedule,ActivateGlobalImageTariffs,GLOBAL_IMAGE_CUSTOMER_FEN} from '@repo/contracts/billing-consumption';
import type {z} from 'zod';
import type {DatabasePort,TenantSession} from '../../application/ports/database.port';
import {PricingCatalog} from '@repo/contracts/billing-pricing';
import {imageFixedCnyPrice} from '../../domain/agent-run/image-activation-pricing';
import {readProductConfiguration,personalConfiguredProducts} from './product-catalog-configuration';
import {GlobalImageTariffConflict,GlobalImageTariffWriterUnavailable,type GlobalImageTariffRepository} from '../../application/billing/global-image-tariff-service';
import {ImagePricingBasisUnavailable} from '../../application/billing/native-credit-tariff-service';
async function read(s:TenantSession){
 const row=(await s.query<{revision:string;schedule:unknown}>('SELECT revision,schedule FROM credit_global_image_schedule WHERE singleton=true')).rows[0];
 return GlobalImageTariffSchedule.parse({scope:'global',revision:row?.revision??null,items:row?.schedule??[]});
}
/** A separately credentialed writer is mandatory. Never fall back to tenant app_rw. */
export class PgGlobalImageTariffRepository implements GlobalImageTariffRepository {
 constructor(private readonly reader:DatabasePort,private readonly writer:DatabasePort|null){}
 list(){return this.reader.withoutTenant(read);}
 async close(){await this.writer?.close();}
 activate(actorId:string,input:z.infer<typeof ActivateGlobalImageTariffs>){
  if(!this.writer)throw new GlobalImageTariffWriterUnavailable();
  return this.writer.withoutTenant(async s=>{
   await s.query("SELECT pg_advisory_xact_lock(hashtextextended('global-image-tariff-schedule',0))");
   const before=await read(s);
   if(before.revision!==input.expectedRevision)throw new GlobalImageTariffConflict();
   let configured:Awaited<ReturnType<typeof readProductConfiguration>>;
   try{configured=await readProductConfiguration(s,'cn');}catch{throw new ImagePricingBasisUnavailable();}
   const catalog=PricingCatalog.parse({version:configured.version,market:'cn',enabledProviders:[],products:personalConfiguredProducts(configured.rows)});
   if(catalog.version!==input.expectedCatalogVersion)throw new GlobalImageTariffConflict();
   let items;
   try{items=Object.entries(GLOBAL_IMAGE_CUSTOMER_FEN).map(([modelId,customerAmountMinor])=>({modelProvider:'bailian-image',modelId,unit:'image',customerAmountMinor,currency:'CNY',quantum:'1',hundredthsPerQuantum:imageFixedCnyPrice(BigInt(customerAmountMinor)*10000n,catalog).hundredthsPerImage,catalogVersion:catalog.version,version:`fixed-image-${createHash('sha256').update(JSON.stringify([modelId,customerAmountMinor,catalog])).digest('hex').slice(0,32)}`}));}catch(error){throw new ImagePricingBasisUnavailable(error instanceof Error&&error.message==='IMAGE_MINIMUM_CNY_CREDIT_QUOTE_AMBIGUOUS'?'image_cny_quote_ambiguous':'image_cny_quote_unconfigured');}
   const revision=createHash('sha256').update(JSON.stringify([before.revision,items])).digest('hex');
   const after=GlobalImageTariffSchedule.parse({scope:'global',revision,items});
   await s.query('INSERT INTO credit_global_image_schedule(singleton,revision,catalog_version,schedule) VALUES(true,$1,$2,$3::jsonb) ON CONFLICT(singleton) DO UPDATE SET revision=EXCLUDED.revision,catalog_version=EXCLUDED.catalog_version,schedule=EXCLUDED.schedule',[revision,catalog.version,JSON.stringify(after.items)]);
   await s.query('INSERT INTO credit_global_image_tariff_changes(actor_id,old_schedule,new_schedule,supersession) VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb)',[actorId,JSON.stringify(before),JSON.stringify(after),JSON.stringify({provider:'bailian-image',unit:'image',temporaryVersionPrefixes:['image-cn-bj-10x-','image-fixed-cny-'],legacyRowsRetained:true})]);
   return after;
  });
 }
}
