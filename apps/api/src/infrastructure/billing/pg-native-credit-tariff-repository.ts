import type {DatabasePort} from "../../application/ports/database.port";
import type {NativeCreditTariffRepository,NativeTariff} from "../../application/billing/native-credit-tariff-service";
import {toOrgId} from "../../domain/org-id";
type Row={org_id:string;model_provider:string;model_id:string;unit:NativeTariff['unit'];quantum:string;hundredths_per_quantum:string;version:string};
const view=(r:Row):NativeTariff=>({orgId:r.org_id,modelProvider:r.model_provider,modelId:r.model_id,unit:r.unit,quantum:r.quantum,hundredthsPerQuantum:r.hundredths_per_quantum,version:r.version});
export class PgNativeCreditTariffRepository implements NativeCreditTariffRepository {
 constructor(private readonly db:DatabasePort){}
 async list(orgId:string){return this.db.withTenant(toOrgId(orgId),async s=>(await s.query<Row>('SELECT org_id,model_provider,model_id,unit,quantum::text,hundredths_per_quantum::text,version FROM credit_native_tariffs WHERE org_id=$1 ORDER BY model_provider,model_id,unit',[orgId])).rows.map(view));}
 async upsert(actorId:string,input:NativeTariff){
  return this.db.withTenant(toOrgId(input.orgId),async s=>{
   // Serialize concurrent changes, including a missing-row insertion, by trusted tariff key.
   await s.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['credit-native-tariff',input.orgId,input.modelProvider,input.modelId,input.unit])]);
   const old=(await s.query<Row>('SELECT org_id,model_provider,model_id,unit,quantum::text,hundredths_per_quantum::text,version FROM credit_native_tariffs WHERE org_id=$1 AND model_provider=$2 AND model_id=$3 AND unit=$4 FOR UPDATE',[input.orgId,input.modelProvider,input.modelId,input.unit])).rows[0];
   await s.query(`INSERT INTO credit_native_tariffs(org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(org_id,model_provider,model_id,unit) DO UPDATE SET quantum=EXCLUDED.quantum,hundredths_per_quantum=EXCLUDED.hundredths_per_quantum,version=EXCLUDED.version`,[input.orgId,input.modelProvider,input.modelId,input.unit,input.quantum,input.hundredthsPerQuantum,input.version]);
   await s.query('INSERT INTO credit_native_tariff_changes(org_id,actor_id,old_tariff,new_tariff) VALUES($1,$2,$3::jsonb,$4::jsonb)',[input.orgId,actorId,old?JSON.stringify(view(old)):null,JSON.stringify(input)]);
   return input;
  });
 }
}
