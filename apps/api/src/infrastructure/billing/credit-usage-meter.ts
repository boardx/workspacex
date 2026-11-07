import {join} from "node:path";
import {fileURLToPath} from "node:url";
import type {DatabasePort} from "../../application/ports/database.port";
import {PgTokenUsageRepository} from "../auth/pg-token-usage-repository";
import {DurableCreditUsageMeter} from "./durable-credit-usage";
const meters=new WeakMap<DatabasePort,DurableCreditUsageMeter>();
/** Shared private receipt directory; root replay uses its own independent transactions. */
export function creditUsageMeter(db:DatabasePort):DurableCreditUsageMeter{
 let meter=meters.get(db);if(!meter){
  const directory=process.env.WORKSPACEX_CREDIT_RECEIPT_DIR??(process.env.NODE_ENV==="production"?undefined:join(fileURLToPath(new URL("../../../../../.harness/state/.cache/credit-receipts",import.meta.url)),encodeURIComponent(process.env.WORKSPACEX_ISOLATION_ID??"default")));
  meter=new DurableCreditUsageMeter(new PgTokenUsageRepository(db),{directory,retainUntilReplay:true,requireExplicitDirectory:process.env.NODE_ENV==="production"});meters.set(db,meter);
 }
 return meter;
}
