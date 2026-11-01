import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { auth } from "@repo/contracts";
import { ensureDatabase, migrateOnce, asOwner } from "../support/db";
import { resetOrgsOwnedBy } from "../support/auth-db";
import { BILLING_ACCOUNTING_GENERATION } from "../../src/domain/billing/billing-generation";
const domain=`welcome-http-${randomUUID().slice(0,8)}.test`,users:string[]=[];
let app:NestExpressApplication,base:string;
// Epoch fixture ownership: one-worker isolated DB; afterAll restores inactive state.
// Credential fixture ownership: unique email domain; afterAll removes its exact users and organizations.
// Wallet fixture ownership: afterAll removes only wallets of this file's registered users.
beforeAll(async()=>{
  ensureDatabase();await migrateOnce();
  vi.stubEnv("NODE_ENV","test");vi.stubEnv("MAIL_OUTBOX_WORKER_ENABLED","0");vi.stubEnv("KERNEL_QUIET","1");
  await asOwner(c=>c.query("UPDATE billing_pricing_epoch SET generation=$1,activated_at=clock_timestamp() WHERE singleton=true",[BILLING_ACCOUNTING_GENERATION]));
  const {createApp}=await import("../../src/main");app=await createApp();await app.listen(0,"127.0.0.1");
  const addr=app.getHttpServer().address();base=`http://127.0.0.1:${typeof addr==='object'&&addr?addr.port:0}`;
});
afterAll(async()=>{
  await app?.close();
  await asOwner(async c=>{
    const found=(await c.query<{user_id:string}>("SELECT user_id FROM credentials WHERE email LIKE $1",[`%@${domain}`])).rows;
    for(const row of found)if(!users.includes(row.user_id))users.push(row.user_id);
    await c.query("DELETE FROM credit_subscription_periods WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[users]);
    await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[]))",[users]);
    await c.query("DELETE FROM credit_wallets WHERE owner_type='user' AND owner_id=ANY($1::text[])",[users]);
    await c.query("UPDATE billing_pricing_epoch SET generation=NULL,activated_at=NULL WHERE singleton=true");
  });
  await resetOrgsOwnedBy(users);
  await asOwner(c=>c.query("DELETE FROM credentials WHERE user_id=ANY($1::text[])",[users]));
  vi.unstubAllEnvs();
});
function input(local:string){return {email:`${local}@${domain}`,password:"correct-horse-battery-staple",displayName:"Welcome user",orgName:"Welcome organization"};}
async function post(body:unknown){const response=await fetch(`${base}/auth/register-open`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
it("real registration commits its one welcome batch and durable verification outbox together",async()=>{
  const result=await post(input("real"));expect(result.status,JSON.stringify(result.body)).toBe(201);
  const out=auth.operations.registerNewAccount.out.parse(result.body);users.push(out.userId);
  const state=await asOwner(async c=>(await c.query(`SELECT w.balance::text,w.total_granted,
    (SELECT count(*)::int FROM credit_subscription_periods p WHERE p.wallet_id=w.wallet_id AND p.source_kind='welcome') AS batches,
    (SELECT count(*)::int FROM mail_outbox m JOIN email_verification_challenges e ON e.id=m.challenge_id WHERE e.user_id=$1) AS queued
    FROM credit_wallets w WHERE w.owner_type='user' AND w.owner_id=$1`,[out.userId])).rows[0]);
  expect(state).toEqual({balance:"1000.00",total_granted:1000,batches:1,queued:1});
  expect((await fetch(`${base}/billing/wallet?ownerType=user`)).status).toBe(401);
  expect((await post(input("real"))).status).toBe(409);
  const grants=await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM credit_transactions t JOIN credit_wallets w USING(wallet_id) WHERE w.owner_id=$1 AND t.type='welcome_grant'",[out.userId])).rows[0].n);
  expect(grants).toBe(1);
});
it("the client cannot choose a gift amount in registration",async()=>{
  expect((await post({...input("tamper"),welcomeCredits:999999})).status).toBe(400);
  const count=await asOwner(async c=>(await c.query("SELECT count(*)::int AS n FROM credentials WHERE email=$1",[input("tamper").email])).rows[0].n);
  expect(count).toBe(0);
});
