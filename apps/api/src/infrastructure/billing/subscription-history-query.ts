import {SubscriptionHistory,SubscriptionHistoryQuery} from "@repo/contracts/billing-subscription";
import type {TenantSession} from "../../application/ports/database.port";
/** Every branch binds the authenticated owner. No provider identifiers or unpaid orders leave this read model. */
const HISTORY_SQL=`WITH history AS (
 SELECT p.period_id::text AS id,CASE WHEN o.order_id IS NULL THEN 'Pro 订阅' ELSE 'Pro 月度订阅' END AS item,
 p.period_start,p.period_end,o.amount_minor::text,o.currency
 FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id)
 LEFT JOIN billing_monthly_orders o ON o.payment_ref=p.invoice_ref AND o.user_id=$1 AND o.state='paid'
 WHERE w.owner_type='user' AND w.owner_id=$1
 UNION ALL
 SELECT o.order_id::text,'Pro 月度订阅',o.period_start,o.period_end,o.amount_minor::text,o.currency
 FROM billing_monthly_orders o WHERE o.user_id=$1 AND o.state='paid'
 AND NOT EXISTS(SELECT 1 FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id)
 WHERE p.invoice_ref=o.payment_ref AND w.owner_type='user' AND w.owner_id=$1)
 UNION ALL
 SELECT 'legacy','Pro 订阅',s.current_period_start,s.current_period_end,NULL,NULL
 FROM billing_subscriptions s WHERE s.user_id=$1 AND s.status IN ('active','trialing','past_due','unpaid','paused','canceled')
 AND NOT EXISTS(SELECT 1 FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id)
 WHERE p.subscription_ref=s.subscription_ref AND w.owner_type='user' AND w.owner_id=$1)
) SELECT * FROM history ORDER BY period_start DESC NULLS LAST,period_end DESC NULLS LAST,id DESC LIMIT $2 OFFSET $3`;
type Row={id:string;item:string;period_start:Date|null;period_end:Date|null;amount_minor:string|null;currency:string|null};
export async function readSubscriptionHistory(session:TenantSession,userId:string,input:{limit:number;offset:number}){
 const {limit,offset}=SubscriptionHistoryQuery.parse(input);
 const rows=(await session.query<Row>(HISTORY_SQL,[userId,limit+1,offset])).rows;
 return SubscriptionHistory.parse({items:rows.slice(0,limit).map(r=>({id:r.id,item:r.item,periodStart:r.period_start?.toISOString()??null,periodEnd:r.period_end?.toISOString()??null,amountMinor:r.amount_minor===null?null:Number(r.amount_minor),currency:r.currency})),hasMore:rows.length>limit});
}
