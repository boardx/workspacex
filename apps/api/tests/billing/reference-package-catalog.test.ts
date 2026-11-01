// @global-scope-fixture table:billing_orders: catalog-replay-test / CAT001 row, rolled back in finally.
import {beforeAll,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {asOwner,asApp,ensureDatabase,migrateOnce} from "../support/db";
beforeAll(async()=>{ensureDatabase();await migrateOnce();});
it("serves the confirmed CN credit packages with exact server prices",async()=>{
 const rows=await asApp(null,async c=>(await c.query("SELECT amount_fen,base_credits,bonus_credits,total_credits,owner_type FROM credit_packages WHERE enabled AND region='cn' ORDER BY sort_order")).rows);
 expect(rows).toEqual([[12900,10000],[59900,50000],[219900,200000]].map(([amount,credits])=>({amount_fen:amount,base_credits:credits,bonus_credits:0,total_credits:credits,owner_type:"both"})));
});

it("replays the generated new catalog without changing a new order snapshot",async()=>{
 const sql=readFileSync(new URL("../../migrations/20261101220000_personal_credit_packages.sql",import.meta.url),"utf8");
 await asOwner(async c=>{
  await c.query("BEGIN");
  try{
   await c.query(`INSERT INTO billing_orders(order_no,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,bonus_credits,currency,qr_code_url,status,expired_at)
    VALUES('bg20261022023000CAT001','user','catalog-replay-test','catalog-replay-test','credit-cn-10000-v1',12900,10000,0,'CNY','weixin://wxpay/bizpayurl?pr=fixture','PENDING',now()+interval '15 minutes')`);
   await c.query(sql);await c.query(sql);
   expect((await c.query("SELECT amount_fen,base_credits,status FROM billing_orders WHERE order_no='bg20261022023000CAT001'")).rows[0]).toEqual({amount_fen:12900,base_credits:10000,status:"PENDING"});
   expect((await c.query("SELECT count(*)::int AS n FROM credit_packages WHERE enabled AND package_id LIKE 'pkg-cn-%'")).rows[0].n).toBe(0);
  }finally{await c.query("ROLLBACK");}
 });
});
