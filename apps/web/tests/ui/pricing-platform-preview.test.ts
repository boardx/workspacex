import {expect,it} from "vitest";
import {OrganizationRow} from "@repo/contracts/platform-organizations";
import {EnterpriseUpgradeOperation} from "@repo/contracts/billing-team";
import {previewPlatformTeams,previewEnterpriseUpgrade} from "@/components/billing/pricing-platform-preview-data";
it("projects directory rows through the shared organization and billing contracts",()=>{
 const rows=previewPlatformTeams();expect(rows).toHaveLength(3);
 for(const row of rows)expect(OrganizationRow.parse(row)).toEqual(row);
 expect(rows[0]!.billingSummary.wallet.balance).toBe(64000);
 expect(rows[1]!.billingSummary.licenseStatus).toBe("enterprise");
});
it("retains the original paid term and current wallet without advancing nine monthly grants",()=>{
 const before=previewPlatformTeams()[0]!,{row,operation}=previewEnterpriseUpgrade(before,"preview-upgrade-key-0001");
 expect(EnterpriseUpgradeOperation.parse(operation)).toEqual(operation);
 expect(operation.status).toBe("succeeded");expect(row.plan.version).toBe(before.plan.version+1);
 expect(row.billingSummary.licenseStatus).toBe("enterprise");
 expect(row.billingSummary.teamPayment?.term).toEqual(before.billingSummary.teamPayment?.term);
 expect(row.billingSummary.creditGrant).toEqual(before.billingSummary.creditGrant);
 expect(row.billingSummary.wallet).toEqual(before.billingSummary.wallet);
 expect(OrganizationRow.parse(row)).toEqual(row);
});
it("stops only future Stripe renewal while retaining the paid schedule",()=>{
 const row=previewPlatformTeams()[0]!;
 row.billingSummary.teamPayment={...row.billingSummary.teamPayment!,provider:"stripe",renewalMode:"automatic",subscriptionStatus:"active",cancelAtPeriodEnd:false};
 const result=previewEnterpriseUpgrade(row,"preview-stripe-key-0001");
 expect(result.row.billingSummary.teamPayment?.cancelAtPeriodEnd).toBe(true);
 expect(result.row.billingSummary.teamPayment?.term).toEqual(row.billingSummary.teamPayment.term);
});
