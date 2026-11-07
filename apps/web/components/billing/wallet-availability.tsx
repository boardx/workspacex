import * as React from "react";
/** Reservations are temporary holds, separate from posted consumption and debt. */
export function WalletAvailability({reservedCredits,availableBalance}:{reservedCredits?:number;availableBalance?:number}) {
 if(reservedCredits===undefined&&availableBalance===undefined)return null;
 const format=(value:number)=>value.toLocaleString("zh-CN",{maximumFractionDigits:2});
 return <div className="space-y-1 text-13"><dl className="flex flex-wrap gap-4">{availableBalance!==undefined&&<div><dt className="text-muted-foreground">可用额度</dt><dd>{format(availableBalance)}</dd></div>}{reservedCredits!==undefined&&<div><dt className="text-muted-foreground">调用中预估额度</dt><dd>{format(reservedCredits)}</dd></div>}</dl>{reservedCredits!==undefined&&reservedCredits>0&&<p className="text-12 text-muted-foreground">预估额度不从当前可用余额扣除，模型完成后按实际用量结算。</p>}</div>;
}
