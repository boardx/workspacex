"use client";
import {previewTeamSubscriptionHistory,type PricingRegion,type PricingCycle} from "./pricing-preview-data";
const day=(value:string)=>new Date(value).toISOString().slice(0,10).replaceAll("-","/");
export function PricingTeamHistoryPreview({region,cycle,expired}:{region:PricingRegion;cycle:PricingCycle;expired:boolean}){
 const history=previewTeamSubscriptionHistory(region,cycle,expired),now=Date.parse(history.asOf);
 return <div className="divide-y divide-border text-13">{history.items.map(item=>{
  const ended=now>=Date.parse(item.paidTerm.paidPeriodEnd),future=now<Date.parse(item.paidTerm.paidPeriodStart);
  const status=ended?"订阅已到期":future?"尚未生效":"本期有效";
  const amount=new Intl.NumberFormat("en-US",{style:"currency",currency:item.currency,currencyDisplay:"narrowSymbol",minimumFractionDigits:0,maximumFractionDigits:2}).format(item.amountMinor/100);
  return <div data-testid="pricing-team-history-item" key={item.purchaseRef} className="flex flex-wrap justify-between gap-3 py-4">
   <div><p className="font-medium">{item.purpose==="add_seats"?`增加 ${item.additionalSeats} 席`:`Team ${item.paidTerm.billingCycle==="year"?"年度":"月度"}订阅`}</p><p className="mt-1 text-12 text-muted-foreground">{day(item.paidTerm.paidPeriodStart)} — {day(item.paidTerm.paidPeriodEnd)}</p></div>
   <div className="text-right tabular-nums"><p>{amount}</p><p className="mt-1 text-12 text-muted-foreground">{status}</p></div>
  </div>;
 })}</div>;
}
