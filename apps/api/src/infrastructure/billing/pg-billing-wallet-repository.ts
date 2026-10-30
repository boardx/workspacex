import { CreditWallet, CreditTransaction, BillingOwnerType, BillingTransactionType } from "@repo/contracts/billing-credits";
import type { DatabasePort } from "../../application/ports/database.port";
import { BillingWalletCursorError, type BillingOwner, type BillingWalletRepository, type LedgerQuery } from "../../application/billing/billing-wallet-service";
import {creditDecimal, creditHundredths} from "../../application/billing/credit-consumption";
import {normalizeCreditPeriods, creditPeriodSnapshot} from "./pg-credit-periods";

type Cursor = {ownerType:BillingOwner["ownerType"];ownerId:string;type:NonNullable<LedgerQuery["type"]>|null;timestamp:string;txnId:string};
// Private, opaque pagination state, not a second public API DTO. Vocabulary stays in contracts.
function parseCursor(value:unknown):Cursor {
  if(typeof value!=="object" || value===null || Array.isArray(value)) throw new BillingWalletCursorError();
  const row=value as Record<string,unknown>;
  const keys=["ownerType","ownerId","type","timestamp","txnId"];
  if(Object.keys(row).length!==keys.length || !keys.every(key=>Object.hasOwn(row,key))) throw new BillingWalletCursorError();
  const ownerType=BillingOwnerType.safeParse(row.ownerType), type=BillingTransactionType.nullable().safeParse(row.type);
  if(!ownerType.success || !type.success || typeof row.ownerId!=="string" || typeof row.timestamp!=="string"
    || typeof row.txnId!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.txnId)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.timestamp) || row.timestamp.startsWith("0000")) throw new BillingWalletCursorError();
  const time=new Date(row.timestamp);
  if(!Number.isFinite(time.getTime()) || time.toISOString()!==`${row.timestamp.slice(0,23)}Z`) throw new BillingWalletCursorError();
  return {ownerType:ownerType.data,ownerId:row.ownerId,type:type.data,timestamp:row.timestamp,txnId:row.txnId};
}
type WalletRow = {wallet_id:string;owner_type:string;owner_id:string;balance:string;held_hundredths:string;total_purchased:number;total_granted:number;updated_at:Date};
type TransactionRow = {txn_id:string;type:string;direction:number;credits:number;balance_after:number;source_type:string;source_id:string;operator_id:string|null;reason:string|null;created_at:Date;cursor_timestamp:string};
export class PgBillingWalletRepository implements BillingWalletRepository {
  constructor(private readonly db: DatabasePort) {}
  async wallet(owner: BillingOwner) {
    return this.db.withTenant(owner.orgId, async s => {
      const r=await s.query<WalletRow>(`SELECT wallet_id,owner_type,owner_id,balance::text,held_hundredths::text,total_purchased,total_granted,updated_at
        FROM credit_wallets WHERE owner_type=$1 AND owner_id=$2 FOR UPDATE`,[owner.ownerType,owner.ownerId]);
      const row=r.rows[0];
      let subscription={hundredths:0n,expiresAt:null as string|null};
      if(row){
        await normalizeCreditPeriods(s,row.wallet_id,new Date());
        const current=(await s.query<{balance:string;updated_at:Date}>("SELECT balance::text,updated_at FROM credit_wallets WHERE wallet_id=$1",[row.wallet_id])).rows[0]!;
        row.balance=current.balance;row.updated_at=current.updated_at;
        subscription=await creditPeriodSnapshot(s,row.wallet_id);
      }
      return {wallet:CreditWallet.parse(row ? {
        ownerType:row.owner_type,ownerId:row.owner_id,balance:Number(row.balance),permanentBalance:Number(creditDecimal(creditHundredths(row.balance)-subscription.hundredths)),subscriptionCredits:Number(creditDecimal(subscription.hundredths)),subscriptionExpiresAt:subscription.expiresAt,reservedCredits:Number(row.held_hundredths)/100,availableBalance:Number(row.balance),totalPurchased:Number(row.total_purchased),totalGranted:Number(row.total_granted),updatedAt:row.updated_at.toISOString(),
      } : {ownerType:owner.ownerType,ownerId:owner.ownerId,balance:0,permanentBalance:0,subscriptionCredits:0,subscriptionExpiresAt:null,reservedCredits:0,availableBalance:0,totalPurchased:0,totalGranted:0,updatedAt:new Date().toISOString()})};
    });
  }
  async transactions(owner: BillingOwner,input: LedgerQuery) {
    let cursor:Cursor|undefined;
    if (input.cursor !== undefined) {
      try {
        if (input.cursor.length>2048 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new BillingWalletCursorError();
        cursor=parseCursor(JSON.parse(Buffer.from(input.cursor,"base64url").toString("utf8")));
        if(cursor.ownerType!==owner.ownerType || cursor.ownerId!==owner.ownerId || cursor.type!==(input.type??null)) throw new BillingWalletCursorError();
      } catch { throw new BillingWalletCursorError(); }
    }
    const limit=input.limit??20;
    return this.db.withTenant(owner.orgId,async s=>{
      const r=await s.query<TransactionRow>(`SELECT t.txn_id,t.type,t.direction,t.credits,t.balance_after,t.source_type,t.source_id,t.operator_id,t.reason,t.created_at,
        to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_timestamp
        FROM credit_transactions t JOIN credit_wallets w ON w.wallet_id=t.wallet_id
        WHERE w.owner_type=$1 AND w.owner_id=$2 AND ($3::text IS NULL OR t.type=$3)
        AND ($4::timestamptz IS NULL OR (t.created_at,t.txn_id)<($4::timestamptz,$5::uuid))
        ORDER BY t.created_at DESC,t.txn_id DESC LIMIT $6`,
      [owner.ownerType,owner.ownerId,input.type??null,cursor?.timestamp??null,cursor?.txnId??null,limit+1]);
      const page=r.rows.slice(0,limit), last=page.at(-1);
      const nextCursor=r.rows.length>limit && last ? Buffer.from(JSON.stringify({ownerType:owner.ownerType,ownerId:owner.ownerId,type:input.type??null,timestamp:last.cursor_timestamp,txnId:last.txn_id})).toString("base64url") : null;
      return {items:page.map(row=>CreditTransaction.parse({txnId:row.txn_id,type:row.type,direction:row.direction,credits:Number(row.credits),balanceAfter:Number(row.balance_after),sourceType:row.source_type,sourceId:row.source_id,operatorId:row.operator_id,reason:row.reason,createdAt:row.created_at.toISOString()})),nextCursor};
    });
  }
}
