import {createHash} from "node:crypto";
import type {TenantSession} from "../../application/ports/database.port";
import type {TokenUsageRecord} from "../../application/agent-run/ports";
import type {OrgId} from "../../domain/org-id";
import {CreditConsumptionError, creditDecimal, creditHundredths, creditFacts, tokenCreditHundredths} from "../../application/billing/credit-consumption";
import {normalizeCreditPeriods, allocateCreditDebit} from "./pg-credit-periods";

type Receipt = {tokens: number; source: string; native: TokenUsageRecord["nativeUsage"] | null; prompt: number | null; completion: number | null; outcome: string};
type Request = {request_id: string; user_id: string; wallet_id: string; model_provider: string; model_id: string; run_id: string | null;
  reserved_hundredths: string; native_unit: string | null; native_quantum: string | null; native_rate: string | null; tariff_version: string;
  state: string; usage_facts: Receipt | null; debited_hundredths: string | null};
type Wallet = {wallet_id: string; balance: string; owner_type: "user" | "team"; owner_id: string};
const limit = 214748364700n;
function debitFor(row: Request, usage: TokenUsageRecord): bigint | null {
  if (usage.totalSource === "reported") return tokenCreditHundredths(usage.tokensTotal);
  if (row.native_unit) {
    const n = usage.nativeUsage;
    if (n && n.unit !== row.native_unit) throw new Error("credit_native_unit_mismatch");
    if (n?.source === "reported" && n.quantity !== null) {
      if (n.quantity < 0n) throw new Error("credit_native_quantity_invalid");
      const q = BigInt(row.native_quantum!), r = BigInt(row.native_rate!);
      return (n.quantity * r + q - 1n) / q;
    }
    return null;
  }
  return usage.totalSource !== "unknown" && usage.totalSource !== "not-applicable" && !usage.nativeUsage ? tokenCreditHundredths(usage.tokensTotal) : null;
}
function quantity(receipt: Receipt): bigint | null {
  if (receipt.source === "reported") return BigInt(receipt.tokens);
  return receipt.native?.source === "reported" && receipt.native.quantity !== null ? BigInt(receipt.native.quantity) : null;
}
function immutable(receipt: Receipt) {return {tokens: receipt.tokens, source: receipt.source, native: receipt.native, outcome: receipt.outcome};}

/** The durable usage receipt and this settlement must share the caller's transaction. */
export async function settleCreditReceipt(s: TenantSession, orgId: OrgId, usage: TokenUsageRecord): Promise<void> {
  const admitted = (await s.query<Request>("SELECT * FROM credit_consumption_requests WHERE request_id=$1 AND org_id=$2", [usage.eventId ?? null, orgId])).rows[0];
  if (!admitted) throw new CreditConsumptionError("credit_accounting_unavailable", "team", orgId, "credit_request_identity_missing");
  // Wallet → periods → request is the same order used by admission and granting.
  const wallet = (await s.query<Wallet>("SELECT wallet_id,balance::text,owner_type,owner_id FROM credit_wallets WHERE wallet_id=$1 FOR UPDATE", [admitted.wallet_id])).rows[0];
  const unavailable = (reason: string) => new CreditConsumptionError("credit_accounting_unavailable", wallet?.owner_type ?? "team", wallet?.owner_id ?? orgId, reason);
  if (!wallet) throw unavailable("credit_receipt_provenance_mismatch");
  const at = new Date();
  await normalizeCreditPeriods(s, wallet.wallet_id, at);
  wallet.balance = (await s.query<{balance: string}>("SELECT balance::text FROM credit_wallets WHERE wallet_id=$1", [wallet.wallet_id])).rows[0]!.balance;
  const row = (await s.query<Request>("SELECT * FROM credit_consumption_requests WHERE request_id=$1 AND org_id=$2 FOR UPDATE", [usage.eventId, orgId])).rows[0];
  if (!row || row.wallet_id !== wallet.wallet_id || row.user_id !== usage.userId || row.model_provider !== usage.modelProvider || row.model_id !== usage.modelId || row.run_id !== usage.runId) throw unavailable("credit_receipt_provenance_mismatch");
  const progress = usage.billingReceipt, final = progress?.final ?? true;
  if (progress && (typeof progress.id !== "string" || progress.id.length < 1 || progress.id.length > 200 || typeof progress.final !== "boolean")) throw unavailable("credit_receipt_identity_invalid");
  const receipt: Receipt = {tokens: usage.tokensTotal, source: usage.totalSource ?? "legacy", native: usage.nativeUsage ?? null, prompt: usage.promptTokens, completion: usage.completionTokens, outcome: usage.outcome};
  if (progress) {
    const seen = (await s.query<{terminal: boolean; usage_facts: Receipt}>("SELECT terminal,usage_facts FROM credit_consumption_receipts WHERE request_id=$1 AND receipt_id=$2", [row.request_id, progress.id])).rows[0];
    if (seen) {
      if (seen.terminal !== final || creditFacts(immutable(seen.usage_facts)) !== creditFacts(immutable(receipt))) throw unavailable("credit_receipt_replay_mismatch");
      return;
    }
  }
  const remember = async (delta: bigint, sourceId: string | null) => {
    if (progress) await s.query(`INSERT INTO credit_consumption_receipts(request_id,org_id,receipt_id,terminal,usage_facts,debited_hundredths,transaction_source_id)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`, [row.request_id, orgId, progress.id, final, creditFacts(receipt), delta.toString(), sourceId]);
  };
  const prior = row.usage_facts;
  if (row.state === "settled") {
    if (progress && !final) {
      const previous = prior && quantity(prior), incoming = quantity(receipt);
      if (previous === null || previous === undefined || incoming === null || incoming > previous || prior!.source !== receipt.source || prior!.native?.unit !== receipt.native?.unit) throw unavailable("credit_receipt_replay_mismatch");
      await remember(0n, null); return;
    }
    if (!prior || creditFacts(immutable(prior)) !== creditFacts(immutable(receipt))) throw unavailable("credit_receipt_replay_mismatch");
    const enriched = {...prior};
    for (const key of ["prompt", "completion"] as const) {
      const incoming = receipt[key], known = prior[key];
      if (incoming !== null && (!Number.isSafeInteger(incoming) || incoming < 0 || known !== null && known !== incoming)) throw unavailable("credit_receipt_replay_mismatch");
      enriched[key] = known ?? incoming;
    }
    if (creditFacts(enriched) !== creditFacts(prior)) await s.query("UPDATE credit_consumption_requests SET usage_facts=$2::jsonb WHERE request_id=$1", [row.request_id, creditFacts(enriched)]);
    await remember(0n, null); return;
  }
  let target: bigint | null;
  try {target = debitFor(row, usage);} catch (error) {throw unavailable(error instanceof Error ? error.message : "credit_native_quantity_invalid");}
  const already = BigInt(row.debited_hundredths ?? 0);
  if (target === null) {
    // Unknown terminal usage does not erase already confirmed streaming usage.
    await s.query("UPDATE credit_consumption_requests SET state='pending',usage_facts=COALESCE($2::jsonb,usage_facts) WHERE request_id=$1", [row.request_id, prior && quantity(prior) !== null ? null : creditFacts(receipt)]);
    return;
  }
  const previousQuantity = prior && quantity(prior), incomingQuantity = quantity(receipt);
  if (already > 0n && prior && quantity(prior) !== null && (prior.source !== receipt.source || prior.native?.unit !== receipt.native?.unit)) throw unavailable("credit_receipt_replay_mismatch");
  if (target < already || previousQuantity != null && incomingQuantity != null && incomingQuantity < previousQuantity) {
    if (final || !progress) throw unavailable("credit_receipt_replay_mismatch");
    await remember(0n, null); return;
  }
  const delta = target - already, balance = creditHundredths(wallet.balance) - delta;
  if (target > limit || balance < -limit || balance > limit) throw unavailable("credit_balance_unrepresentable");
  await allocateCreditDebit(s, {walletId: wallet.wallet_id, requestId: row.request_id, hundredths: delta, at});
  const sourceId = progress ? `receipt:${createHash("sha256").update(creditFacts([row.request_id, progress.id])).digest("hex")}` : row.request_id;
  if (delta > 0n) await s.query("INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id,operator_id,reason) VALUES($1,'consume',-1,$2,$3,'model_request',$4,$5,$6)",
    [wallet.wallet_id, creditDecimal(delta), creditDecimal(balance), sourceId, usage.userId, `model:${usage.modelProvider}/${usage.modelId};tariff:${row.tariff_version};receipt:${createHash("sha256").update(creditFacts(receipt)).digest("hex")}`]);
  await s.query("UPDATE credit_wallets SET balance=$2,held_hundredths=held_hundredths-$3,unbounded_requests=unbounded_requests-$4,updated_at=now() WHERE wallet_id=$1",
    [wallet.wallet_id, creditDecimal(balance), final ? row.reserved_hundredths : "0", final && BigInt(row.reserved_hundredths) === 0n ? 1 : 0]);
  await s.query("UPDATE credit_consumption_requests SET state=$2,usage_facts=$3::jsonb,debited_hundredths=$4,settled_at=$5 WHERE request_id=$1",
    [row.request_id, final ? "settled" : "pending", creditFacts(receipt), target.toString(), final ? at : null]);
  await remember(delta, delta > 0n ? sourceId : null);
}
