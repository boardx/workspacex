import { BILLING_ACCOUNTING_GENERATION } from "../../domain/billing/billing-generation";
import { requireActivePricingEpoch } from "./personal-pricing-epoch";
import { randomUUID } from "node:crypto";
import { EnterpriseCreditGrantRequest, EnterpriseCreditGrantResult } from "@repo/contracts/billing-team";
import { CreditBalance } from "@repo/contracts/billing-credits";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { EnterpriseError } from "../../application/billing/enterprise-ports";
import { creditDecimal, creditHundredths } from "../../application/billing/credit-consumption";

/** All writes, including the idempotency receipt, commit or roll back together. */
export class EnterpriseCreditGrant {
  constructor(private readonly db: DatabasePort) {}
  async grant(orgId: OrgId, actorId: string, request: EnterpriseCreditGrantRequest): Promise<EnterpriseCreditGrantResult> {
    const input = EnterpriseCreditGrantRequest.parse(request);
    return this.db.withTenant(orgId, async s => {
      try { await requireActivePricingEpoch(s); } catch { throw new EnterpriseError("dependency_unavailable"); }
      const org = await s.query("SELECT id FROM organizations WHERE id=$1 AND kind='organization' FOR UPDATE", [orgId]);
      if (!org.rows.length) throw new EnterpriseError("ORGANIZATION_NOT_FOUND");
      const plan = (await s.query<{plan:string;billing_generation:string|null}>("SELECT plan,billing_generation FROM organization_plans WHERE org_id=$1 FOR UPDATE", [orgId])).rows[0];
      if (plan?.plan !== "enterprise" || plan.billing_generation !== BILLING_ACCOUNTING_GENERATION) throw new EnterpriseError("enterprise_required");
      const prior = (await s.query<{actor_id:string;generation:string;credits:number;reason:string;receipt:unknown}>("SELECT actor_id,generation,credits,reason,receipt FROM enterprise_credit_grants WHERE org_id=$1 AND idempotency_key=$2", [orgId,input.idempotencyKey])).rows[0];
      if (prior) {
        if (prior.generation !== BILLING_ACCOUNTING_GENERATION || prior.actor_id !== actorId || prior.credits !== input.credits || prior.reason !== input.reason) throw new EnterpriseError("idempotency_conflict");
        return EnterpriseCreditGrantResult.parse(prior.receipt);
      }
      await s.query("INSERT INTO credit_wallets(owner_type,owner_id) VALUES('team',$1) ON CONFLICT(owner_type,owner_id) DO NOTHING", [orgId]);
      const wallet = (await s.query<{wallet_id:string;balance:string;total_granted:string}>("SELECT wallet_id,balance::text,total_granted::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1 FOR UPDATE", [orgId])).rows[0];
      if (!wallet) throw new EnterpriseError("dependency_unavailable");
      const decimal = creditDecimal(creditHundredths(wallet.balance) + BigInt(input.credits)*100n);
      const balance = Number(decimal);
      const totalGranted=Number(creditDecimal(creditHundredths(wallet.total_granted)+BigInt(input.credits)*100n));
      if (!CreditBalance.safeParse(balance).success || !CreditBalance.safeParse(totalGranted).success) throw new EnterpriseError("credit_balance_unrepresentable");
      const grantRef=randomUUID(), ledgerRef=randomUUID(), auditRef=randomUUID();
      const createdAt=(await s.query<{at:Date}>("SELECT now() AS at")).rows[0]!.at.toISOString();
      const receipt=EnterpriseCreditGrantResult.parse({orgId,grantRef,ledgerRef,auditRef,credits:input.credits,balance,createdAt});
      await s.query("UPDATE credit_wallets SET balance=$2,total_granted=total_granted+$3,updated_at=now() WHERE wallet_id=$1",[wallet.wallet_id,decimal,input.credits]);
      await s.query(`INSERT INTO credit_transactions(txn_id,wallet_id,type,direction,credits,balance_after,source_type,source_id,operator_id,reason)
        VALUES($1,$2,'grant',1,$3,$4,'admin_grant',$5,$6,$7)`,[ledgerRef,wallet.wallet_id,input.credits,decimal,grantRef,actorId,input.reason]);
      await s.query(`INSERT INTO enterprise_credit_grants(id,org_id,generation,idempotency_key,actor_id,credits,reason,audit_ref,receipt)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,[grantRef,orgId,BILLING_ACCOUNTING_GENERATION,input.idempotencyKey,actorId,input.credits,input.reason,auditRef,JSON.stringify(receipt)]);
      return receipt;
    });
  }
}
