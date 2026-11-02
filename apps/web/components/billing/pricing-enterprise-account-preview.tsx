"use client";
import {Badge} from "@/components/ui/badge";
import {TeamEntitlement} from "@repo/contracts/billing-team";
import {previewPlatformTeams,previewEnterpriseUpgrade} from "./pricing-platform-preview-data";
import {numberLabel,type PricingRegion} from "./pricing-preview-data";
export function PricingEnterpriseAccountPreview({retained,region}:{retained:boolean;region:PricingRegion}){
 const teams=previewPlatformTeams(),before=teams[retained?0:1]!;
 if(retained&&region==="us"&&before.billingSummary.teamPayment)before.billingSummary.teamPayment={...before.billingSummary.teamPayment,provider:"stripe",renewalMode:"automatic",subscriptionStatus:"active"};
 const facts=TeamEntitlement.parse(retained?previewEnterpriseUpgrade(before,"preview-account-upgrade-0001").row.billingSummary:before.billingSummary);
 return <section data-testid="pricing-enterprise-account" className="space-y-5 rounded-card border border-border bg-card p-6">
  <div className="flex items-center justify-between gap-3"><h2 className="text-18 font-semibold">团队额度与服务</h2><Badge tone="primary">Enterprise · 使用中</Badge></div>
  <p className="text-13 text-muted-foreground">由平台管理员管理服务与额外额度。如需补充额度，请联系平台管理员。</p>
  <dl className="grid gap-5 sm:grid-cols-2"><div><dt className="text-12 text-muted-foreground">可用总额度</dt><dd className="mt-1 text-30 font-semibold tabular-nums">{numberLabel(facts.wallet.balance)} credit</dd></div><div><dt className="text-12 text-muted-foreground">长期有效额度</dt><dd className="mt-1 text-30 font-semibold tabular-nums">{numberLabel(facts.wallet.permanentBalance)} credit</dd></div></dl>
  <p className="text-13">{facts.memberCount} 位成员 · 不受原 Team 已购席位限制</p>
  {facts.teamPayment ? <div data-testid="pricing-enterprise-prepaid" className="space-y-2 rounded-control bg-muted p-4 text-13"><h3 className="font-medium">保留的已付 Team 额度计划</h3><p>按原购买日逐月发放至 {facts.teamPayment.term.paidPeriodEnd.slice(0,10).replaceAll("-","/")}，每个完整月 {numberLabel(facts.teamPayment.term.monthlyCredits)} credit。</p><p>当前月剩余 {numberLabel(facts.creditGrant.grant?.remainingCredits??0)} credit，保留原有效期；未来 Team 续费已停止。</p><p>原 Team 到期不影响 Enterprise 服务。</p></div> : <p className="rounded-control bg-muted p-4 text-13">没有待发放的 Team 已付额度计划。</p>}
  <p className="text-12 text-muted-foreground">Enterprise 不新增默认月度额度。此处为模拟账户，不修改真实数据。</p>
 </section>;
}
