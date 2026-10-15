/** These are owner-global tables declared by the billing migrations, not tenant content. */
const TABLES=new Set(["billing_payment_receipts","billing_orders","credit_wallets","credit_transactions","billing_webhook_events"]);
export function assertBillingGlobalStatement(sql:string):void {
  if(/;|--|\/\*|\b(?:copy|call|execute|alter|create|drop|truncate|grant|revoke|with)\b/i.test(sql))throw new Error("billing_global_sql_outside_boundary");
  const normalized=sql.replace(/\bFOR\s+UPDATE(?:\s+SKIP\s+LOCKED)?\b/gi,"");
  const names=[...normalized.matchAll(/\b(?:from|join|update|into)\s+([a-z_][a-z_0-9]*)/gi)].map(match=>match[1]!.toLowerCase());
  if(!names.length || names.some(name=>!TABLES.has(name)))throw new Error("billing_global_sql_outside_boundary");
}
