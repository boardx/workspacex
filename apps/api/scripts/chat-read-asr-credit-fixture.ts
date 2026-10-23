import type {TenantSession} from "../src/application/ports/database.port";
/** Synthetic browser ASR pricing; never used by production bootstrap. */
export async function seedChatReadAsrCreditTariff(session:TenantSession,orgId:string,env:NodeJS.ProcessEnv=process.env):Promise<void>{
 if(env.CHAT_E2E_FIXTURE!=="1"||env.CHAT_E2E_ORG_ID!==orgId)throw new Error("CHAT_READ_ASR_CREDIT_FIXTURE_SCOPE_REQUIRED");
 await session.query(`INSERT INTO credit_native_tariffs(org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version)
  VALUES($1,'chat-read-loopback-asr','loopback-transcribe','millisecond',1000,1,'chat-read-asr-fixture-v1')
  ON CONFLICT(org_id,model_provider,model_id,unit) DO UPDATE SET quantum=EXCLUDED.quantum,hundredths_per_quantum=EXCLUDED.hundredths_per_quantum,version=EXCLUDED.version`,[orgId]);
}
