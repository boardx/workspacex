import {NativeCreditTariff} from "@repo/contracts/billing-consumption";
import {toOrgId} from "../../domain/org-id";
import {PricingCatalog} from "@repo/contracts/billing-pricing";
import {readProductConfiguration,personalConfiguredProducts} from "./product-catalog-configuration";
import type {DatabasePort} from "../../application/ports/database.port";
import {NativeTariffWriterUnavailable,type NativeCreditTariffRepository,type NativeTariff} from "../../application/billing/native-credit-tariff-service";
type Row={model_provider:string;model_id:string;unit:NativeTariff['unit'];quantum:string;hundredths_per_quantum:string;version:string;pricing_basis?:NativeTariff['pricingBasis']};
const view=(r:Row):NativeTariff=>({modelProvider:r.model_provider,modelId:r.model_id,unit:r.unit,quantum:r.quantum,hundredthsPerQuantum:r.hundredths_per_quantum,version:r.version,...(r.pricing_basis?{pricingBasis:r.pricing_basis}:{})});
const columns='model_provider,model_id,unit,quantum::text,hundredths_per_quantum::text,version,pricing_basis';
/** Global nonsecret pricing only. Authoritative platform-operator authorization precedes mutations. */
export class PgNativeCreditTariffRepository implements NativeCreditTariffRepository {
 /** Writer is borrowed from the image service lifecycle; no second pool or closer. */
 constructor(private readonly db:DatabasePort,private readonly writer:DatabasePort|null=null){}
 async readCnyCatalog(orgId:string){return this.db.withTenant(toOrgId(orgId),async s=>{
  const configured=await readProductConfiguration(s,'cn');
  return PricingCatalog.parse({version:configured.version,market:'cn',enabledProviders:[],products:personalConfiguredProducts(configured.rows)});
 });}
 async list(_legacyOrgId?:string){return this.db.withoutTenant(async s=>(await s.query<Row>(`SELECT ${columns} FROM credit_global_native_tariffs ORDER BY model_provider,model_id,unit`)).rows.map(view));}
 async upsert(actorId:string,input:NativeTariff){
  input=NativeCreditTariff.parse(input);
  if(!this.writer)throw new NativeTariffWriterUnavailable();
  return this.writer.withoutTenant(async s=>{
   await s.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['credit-global-native-tariff',input.modelProvider,input.modelId,input.unit])]);
   const old=(await s.query<Row>(`SELECT ${columns} FROM credit_global_native_tariffs WHERE model_provider=$1 AND model_id=$2 AND unit=$3 FOR UPDATE`,[input.modelProvider,input.modelId,input.unit])).rows[0];
   const value={...input,pricingBasis:input.pricingBasis??{source:'operator' as const,retailSnapshotId:input.version}};
   await s.query(`INSERT INTO credit_global_native_tariffs(model_provider,model_id,unit,quantum,hundredths_per_quantum,version,pricing_basis) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
    ON CONFLICT(model_provider,model_id,unit) DO UPDATE SET quantum=EXCLUDED.quantum,hundredths_per_quantum=EXCLUDED.hundredths_per_quantum,version=EXCLUDED.version,pricing_basis=EXCLUDED.pricing_basis`,[input.modelProvider,input.modelId,input.unit,input.quantum,input.hundredthsPerQuantum,input.version,JSON.stringify(value.pricingBasis)]);
   await s.query('INSERT INTO credit_global_native_tariff_changes(actor_id,old_tariff,new_tariff) VALUES($1,$2::jsonb,$3::jsonb)',[actorId,old?JSON.stringify(view(old)):null,JSON.stringify(value)]);
   return value;
  });
 }
}
