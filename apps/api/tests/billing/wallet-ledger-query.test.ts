// @global-scope-fixture table:credit_wallets: billing wallets are owner-scoped; cleanup uses f03-wallet- prefix.
// @global-scope-fixture table:credit_transactions: owner-scoped ledger fixtures; cleanup deletes only these wallets' entries.
import "reflect-metadata";
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { asApp, asOwner, ensureDatabase, migrateOnce } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgBillingWalletRepository } from "../../src/infrastructure/billing/pg-billing-wallet-repository";
import { BillingWalletService, BillingWalletAccessError } from "../../src/application/billing/billing-wallet-service";
import { toOrgId } from "../../src/domain/org-id";
import { operations } from "@repo/contracts/billing-credits";
import { BillingWalletController } from "../../src/interface/controllers/billing-wallet.controller";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
const user = "f03-wallet-user", other = "f03-wallet-other", org = toOrgId("f03-wallet-org");
const principal = {userId:user,orgId:org};
const db = new PgDatabase(appConfig());
const repository = new PgBillingWalletRepository(db);
let role: "admin" | "consultant" | null = null;
let platform = false;
const service = new BillingWalletService(repository, {
  findOrgMembership: async () => role ? {orgRole:role,teamId:null} : null,
}, async () => platform);
let app: NestExpressApplication;
let base: string;
const cleanup = () => asOwner(async c => {
  await c.query("DELETE FROM credit_transactions WHERE wallet_id IN (SELECT wallet_id FROM credit_wallets WHERE owner_id LIKE 'f03-wallet-%')");
  await c.query("DELETE FROM credit_wallets WHERE owner_id LIKE 'f03-wallet-%'");
});
beforeAll(async()=>{
  console.info("[F03 HTTP fixture] starting database readiness");
  ensureDatabase();await migrateOnce();
  console.info("[F03 HTTP fixture] database ready; creating Nest fixture");
  // Explicit localhost identity fixture exercises the real PrincipalGuard and HTTP handlers, not production login.
  app=await NestFactory.create<NestExpressApplication>({module:class WalletHttpFixture{},
    controllers:[BillingWalletController],providers:[
      {provide:BillingWalletService,useValue:service},
      {provide:PRINCIPAL_RESOLVER_PORT,useValue:{resolve:async(headers:Readonly<Record<string,string|string[]|undefined>>)=>headers.authorization==="Bearer f03-http-fixture"?principal:null}},
      {provide:APP_GUARD,useClass:PrincipalGuard},
    ],
  },{logger:false,abortOnError:false});
  console.info("[F03 HTTP fixture] Nest created; binding loopback listener");
  await app.listen(0,"127.0.0.1");
  console.info("[F03 HTTP fixture] listener ready");
  const address=app.getHttpServer().address();if(!address||typeof address==="string") throw new Error("No loopback listener");
  base=`http://127.0.0.1:${address.port}`;
});
beforeEach(async()=>{role=null;platform=false;await cleanup();});
afterEach(()=>vi.restoreAllMocks());
afterAll(async()=>{await app?.close();await cleanup();await db.close();});
async function seed(ownerType="user", ownerId=user) {
  await asApp(null, async c => {
    const r=await c.query<{wallet_id:string}>("INSERT INTO credit_wallets(owner_type,owner_id,balance,total_purchased,total_granted) VALUES($1,$2,60,50,5) RETURNING wallet_id",[ownerType,ownerId]);
    for (const [i,type,credits,balance] of [[1,"purchase",50,50],[2,"bonus",5,55],[3,"grant",5,60]] as const) {
      await c.query(`INSERT INTO credit_transactions(txn_id,wallet_id,type,direction,credits,balance_after,source_type,source_id,operator_id,reason,created_at)
        VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,'2026-10-01T00:00:00.123456Z')`,
      [`00000000-0000-4000-8000-00000000000${i}`,r.rows[0]!.wallet_id,type,credits,balance,type==="grant"?"admin_grant":"payment_order",`f03-${i}`,type==="grant"?user:null,type==="grant"?"test grant":null]);
    }
  });
}
describe("F03 real wallet and ledger reads",()=>{
  it("HTTP handlers remain authenticated; anonymous wallet and ledger reads return401",async()=>{
    for(const path of ["/billing/wallet","/billing/transactions"]) expect((await fetch(`${base}${path}?ownerType=user`)).status).toBe(401);
  });
  it("real HTTP returns persisted wallet data, rejects forged owner, and coerces bounded numeric query limits",async()=>{
    await seed();const headers={authorization:"Bearer f03-http-fixture"};
    const wallet=await fetch(`${base}/billing/wallet?ownerType=user`,{headers});expect(wallet.status).toBe(200);
    expect(operations.getWallet.out.parse(await wallet.json()).wallet.balance).toBe(60);
    expect((await fetch(`${base}/billing/wallet?ownerType=user&ownerId=${other}`,{headers})).status).toBe(403);
    const first=await fetch(`${base}/billing/transactions?ownerType=user&limit=1`,{headers});expect(first.status).toBe(200);
    const page=operations.listTransactions.out.parse(await first.json());expect(page.items).toHaveLength(1);expect(page.nextCursor).not.toBeNull();
    const next=await fetch(`${base}/billing/transactions?ownerType=user&limit=1&cursor=${page.nextCursor}`,{headers});expect(next.status).toBe(200);
    expect(operations.listTransactions.out.parse(await next.json()).items[0]!.txnId).not.toBe(page.items[0]!.txnId);
    for(const limit of ["0","101","not-number"]) expect((await fetch(`${base}/billing/transactions?ownerType=user&limit=${limit}`,{headers})).status).toBe(400);
    expect((await fetch(`${base}/billing/transactions?ownerType=user&cursor=invalid`,{headers})).status).toBe(400);
  });
  it("returns a contract-valid empty wallet without inventing a database row",async()=>{
    const result=await service.wallet(principal,{ownerType:"user"});
    expect(operations.getWallet.out.parse(result).wallet).toMatchObject({ownerId:user,balance:0,totalPurchased:0,totalGranted:0});
    expect((await asOwner(c=>c.query("SELECT wallet_id FROM credit_wallets WHERE owner_id=$1",[user]))).rowCount).toBe(0);
    expect(await service.transactions(principal,{ownerType:"user"})).toEqual({items:[],nextCursor:null});
  });
  it("reads real balances, totals and ledger entries; balance equals signed ledger sum",async()=>{
    await seed();
    const {wallet}=await service.wallet(principal,{ownerType:"user",ownerId:user});
    const result=operations.listTransactions.out.parse(await service.transactions(principal,{ownerType:"user"}));
    expect(wallet).toMatchObject({balance:60,totalPurchased:50,totalGranted:5});
    expect(result.items.reduce((n,t)=>n+t.credits*t.direction,0)).toBe(wallet.balance);
    expect(result.items[0]!.balanceAfter).toBe(60);
  });
  it("stable pagination preserves microseconds and duplicate timestamps without missing or repeating rows",async()=>{
    await seed();let cursor:string|undefined;const ids:string[]=[];
    do {const page=await service.transactions(principal,{ownerType:"user",limit:1,cursor});ids.push(...page.items.map(x=>x.txnId));cursor=page.nextCursor??undefined;} while(cursor);
    expect(ids).toHaveLength(3);expect(new Set(ids).size).toBe(3);
    const filtered=await service.transactions(principal,{ownerType:"user",type:"grant",limit:100});
    expect(filtered.items.map(t=>t.type)).toEqual(["grant"]);expect(filtered.nextCursor).toBeNull();
  });
  it("forbids another personal wallet and ledger even for a platform operator",async()=>{
    await seed("user",other);platform=true;
    const walletRead=vi.spyOn(repository,"wallet"),ledgerRead=vi.spyOn(repository,"transactions");
    await expect(service.wallet(principal,{ownerType:"user",ownerId:other})).rejects.toBeInstanceOf(BillingWalletAccessError);
    await expect(service.transactions(principal,{ownerType:"user",ownerId:other})).rejects.toBeInstanceOf(BillingWalletAccessError);
    expect(walletRead).not.toHaveBeenCalled();expect(ledgerRead).not.toHaveBeenCalled();
  });
  it("keeps personal and organization wallets distinct even when owner ids collide",async()=>{
    await seed();role="admin";
    await asApp(null,c=>c.query("INSERT INTO credit_wallets(owner_type,owner_id) VALUES('team',$1)",[user]));
    expect((await service.wallet(principal,{ownerType:"user"})).wallet.balance).toBe(60);
    expect((await service.wallet(principal,{ownerType:"team",ownerId:user})).wallet.balance).toBe(0);
    expect((await service.transactions(principal,{ownerType:"team",ownerId:user})).items).toEqual([]);
  });
  it("team wallet requires real admin membership or existing platform authorization; ordinary members cannot read",async()=>{
    await seed("team",org);role="consultant";
    await expect(service.wallet(principal,{ownerType:"team"})).rejects.toBeInstanceOf(BillingWalletAccessError);
    await expect(service.transactions(principal,{ownerType:"team"})).rejects.toBeInstanceOf(BillingWalletAccessError);
    role="admin";expect((await service.wallet(principal,{ownerType:"team"})).wallet.balance).toBe(60);
    role=null;await expect(service.wallet(principal,{ownerType:"team"})).rejects.toBeInstanceOf(BillingWalletAccessError);
    platform=true;expect((await service.transactions(principal,{ownerType:"team"})).items).toHaveLength(3);
  });
  it("rejects malformed/cross-owner/cross-filter cursors and invalid page limits",async()=>{
    await seed();const page=await service.transactions(principal,{ownerType:"user",limit:1});
    await expect(service.transactions(principal,{ownerType:"user",cursor:"not-a-cursor"})).rejects.toThrow();
    await expect(service.transactions(principal,{ownerType:"user",type:"grant",cursor:page.nextCursor!})).rejects.toThrow();
    role="admin";
    await expect(service.transactions(principal,{ownerType:"team",cursor:page.nextCursor!})).rejects.toThrow();
    await expect(service.transactions(principal,{ownerType:"user",limit:101})).rejects.toThrow();
  });
});
