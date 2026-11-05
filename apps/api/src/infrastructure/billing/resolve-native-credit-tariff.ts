import {GlobalImageTariffSchedule} from '@repo/contracts/billing-consumption';
import type {TenantSession} from '../../application/ports/database.port';
export async function resolveNativeCreditTariff(s:TenantSession,orgId:string,provider:string,model:string,unit:string){
 if(provider==='bailian-image'){
  if(unit!=='image')return undefined;
  const row=(await s.query<{revision:string;schedule:unknown}>('SELECT revision,schedule FROM credit_global_image_schedule WHERE singleton=true')).rows[0];
  if(!row)return undefined;
  const schedule=GlobalImageTariffSchedule.parse({scope:'global',revision:row.revision,items:row.schedule});
  const tariff=schedule.items.find(item=>item.modelProvider===provider&&item.modelId===model&&item.unit===unit);
  return tariff?{quantum:tariff.quantum,hundredths_per_quantum:tariff.hundredthsPerQuantum,version:tariff.version}:undefined;
 }
 return (await s.query<{quantum:string;hundredths_per_quantum:string;version:string}>('SELECT quantum::text,hundredths_per_quantum::text,version FROM credit_native_tariffs WHERE org_id=$1 AND model_provider=$2 AND model_id=$3 AND unit=$4',[orgId,provider,model,unit])).rows[0];
}
