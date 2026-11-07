import {readFileSync,writeFileSync,renameSync} from "node:fs";
import {PgDatabase} from "../src/infrastructure/db/pg-database";
import {appConfig} from "../src/infrastructure/db/pg-config";
import {DeploymentBillingConfig} from "../src/infrastructure/billing/deployment-billing-config";
import {StripeWebhookClient} from "../src/infrastructure/billing/stripe-webhook-client";
import {backfillSubscriptionCredits} from "../src/infrastructure/billing/subscription-credit-backfill";
import {backfillCheckpointScope,validateBackfillCheckpoint} from "../src/infrastructure/billing/subscription-credit-checkpoint";

async function main(){
 const args=process.argv.slice(2),values=new Map<string,string>();let apply=false;
 for(let i=0;i<args.length;i++){const key=args[i]!;if(key==="--apply"){apply=true;continue;}if(!["--plans","--limit","--checkpoint"].includes(key)||!args[i+1]||args[i+1]!.startsWith("--"))throw Error("Usage: --plans price_a,price_b [--limit 100] [--checkpoint path] [--apply]");values.set(key,args[++i]!);}
 const plans=(values.get("--plans")??"").split(",").filter(Boolean);if(!plans.length||plans.some(x=>!/^price_[A-Za-z0-9_]+$/.test(x)))throw Error("explicit reviewed monthly --plans required");
 const file=values.get("--checkpoint"),limit=Number(values.get("--limit")??100);let after:string|undefined,until:string|undefined;
 const config=appConfig(),scope=backfillCheckpointScope(config,apply,plans);
 if(file){try{({after,until}=validateBackfillCheckpoint(JSON.parse(readFileSync(file,"utf8")),scope));}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
 const db=new PgDatabase(config);
 try{
  const report=await backfillSubscriptionCredits(db,new StripeWebhookClient(new DeploymentBillingConfig()),{apply,plans,after,until,limit});
  process.stdout.write(JSON.stringify(report)+"\n");
  // A blocked page never advances: repair and replay the whole page idempotently.
  if(file){const state={...scope,after:report.blocked?after??"":report.nextAfter??after??"",until:report.until,complete:!report.blocked&&report.nextAfter===null};writeFileSync(file+".tmp",JSON.stringify(state)+"\n",{mode:0o600});renameSync(file+".tmp",file);}
  if(report.blocked)process.exitCode=2;
 }finally{await db.close();}
}
main().catch(()=>{process.stderr.write("credit_backfill_failed: verify arguments, checkpoint and provider/database configuration; no secret or raw provider error logged\n");process.exitCode=1;});
