// @global-scope-fixture table:billing_orders: catalog-replay-test / CAT001 row, rolled back in finally.
import {beforeAll,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {asOwner,asApp,ensureDatabase,migrateOnce} from "../support/db";
beforeAll(async()=>{ensureDatabase();await migrateOnce();});
it("serves the BoardX CN packages starting at one yuan with one credit per fen",async()=>{
 const rows=await asApp(null,async c=>(await c.query("SELECT amount_fen,base_credits,bonus_credits,total_credits,owner_type FROM credit_packages WHERE enabled AND region='cn' ORDER BY sort_order")).rows);
 expect(rows).toEqual([100,1000,3000,5000,10000,20000].map(n=>({amount_fen:n,base_credits:n,bonus_credits:0,total_credits:n,owner_type:"both"})));
});

it("replays without changing historical order snapshots",async()=>{
 const sql=readFileSync(new URL("../../migrations/20261022023000_billing_reference_packages.sql",import.meta.url),"utf8");
 await asOwner(async c=>{
  await c.query("BEGIN");
  try{
   await c.query(`INSERT INTO billing_orders(order_no,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,bonus_credits,currency,qr_code_url,status,expired_at)
    VALUES('bg20261022023000CAT001','user','catalog-replay-test','catalog-replay-test','pkg-basic',4900,500,0,'CNY','weixin://wxpay/bizpayurl?pr=fixture','PENDING',now()+interval '15 minutes')`);
   await c.query(sql);await c.query(sql);
   expect((await c.query("SELECT amount_fen,base_credits,status FROM billing_orders WHERE order_no='bg20261022023000CAT001'")).rows[0]).toEqual({amount_fen:4900,base_credits:500,status:"PENDING"});
   expect((await c.query("SELECT count(*)::int AS n FROM credit_packages WHERE enabled AND package_id LIKE 'pkg-cn-%'")).rows[0].n).toBe(6);
  }finally{await c.query("ROLLBACK");}
 });
});
