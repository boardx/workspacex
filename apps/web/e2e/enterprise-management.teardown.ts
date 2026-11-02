import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {tsImport} from "tsx/esm/api";
/** Optional coordinator draft: isolated read-only syntax smoke, never a remote inventory. */
export default async function enterpriseInventoryDraft(){
 const draft=process.env.ENTERPRISE_INVENTORY_SQL_SMOKE;if(!draft)return;
 const marker="test-results/enterprise-management-6108/browser-success.json";
 if(!existsSync(marker)||JSON.parse(readFileSync(marker,"utf8")).isolationId!==process.env.WORKSPACEX_ISOLATION_ID){console.info("[inventory-smoke] browser did not finish successfully; draft not executed");return;}
 if(!process.env.WORKSPACEX_ISOLATION_ID||!process.env.PGDATABASE?.startsWith("wsx_")||process.env.PGDATABASE!==process.env.WORKSPACEX_DB)throw Error("owned isolated database required");
 type Db={asOwner<T>(fn:(c:{query(sql:string):Promise<unknown>})=>Promise<T>):Promise<T>};
 const {asOwner}=await tsImport(pathToFileURL(resolve(__dirname,"../../api/tests/support/db.ts")).href,{parentURL:pathToFileURL(__filename).href,tsconfig:resolve(__dirname,"../../api/tsconfig.json")}) as Db;
 const result=await asOwner(async c=>{await c.query("SET default_transaction_read_only=on");await c.query("SET row_security=off");return c.query(readFileSync(draft,"utf8"));});
 mkdirSync("test-results/enterprise-management-6108",{recursive:true});writeFileSync("test-results/enterprise-management-6108/inventory-syntax-smoke.json",JSON.stringify({purpose:"isolated draft syntax smoke only; not remote inventory or cleanup",result},null,2));console.info("[inventory-smoke] isolated read-only draft completed; no remote claim");
}
