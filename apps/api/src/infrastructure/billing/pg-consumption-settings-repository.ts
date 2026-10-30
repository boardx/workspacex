import type {DatabasePort} from "../../application/ports/database.port";
import type {ConsumptionSettingsRepository,ConsumptionSettings} from "../../application/billing/consumption-settings-service";
import type {OrgId} from "../../domain/org-id";
import {CREDIT_ADMISSION_POLICY} from "@repo/contracts/billing-consumption";
/** Nonsecret global policy; callers enforce platform authority before mutations. */
export class PgConsumptionSettingsRepository implements ConsumptionSettingsRepository {
 constructor(private readonly db:DatabasePort){}
 async read(orgId:OrgId):Promise<ConsumptionSettings>{
  return this.db.withTenant(orgId,async s=>{
   const row=(await s.query<{credit_preflight_enabled:boolean}>("SELECT credit_preflight_enabled FROM credit_consumption_settings WHERE singleton=true")).rows[0];
   if(!row)throw new Error('credit_consumption_settings_missing');
   return {creditPreflightEnabled:row.credit_preflight_enabled,admissionPolicy:CREDIT_ADMISSION_POLICY};
  });
 }
 async update(orgId:OrgId,userId:string,input:ConsumptionSettings):Promise<ConsumptionSettings>{
  return this.db.withTenant(orgId,async s=>{
   const row=(await s.query<{credit_preflight_enabled:boolean}>("SELECT credit_preflight_enabled FROM credit_consumption_settings WHERE singleton=true FOR UPDATE")).rows[0];
   if(!row)throw new Error('credit_consumption_settings_missing');
   await s.query("UPDATE credit_consumption_settings SET credit_preflight_enabled=$1,updated_by=$2,updated_at=now() WHERE singleton=true",[input.creditPreflightEnabled,userId]);
   await s.query("INSERT INTO credit_consumption_setting_changes(actor_id,old_enabled,new_enabled) VALUES($1,$2,$3)",[userId,row.credit_preflight_enabled,input.creditPreflightEnabled]);
   return {creditPreflightEnabled:input.creditPreflightEnabled,admissionPolicy:CREDIT_ADMISSION_POLICY};
  });
 }
}
