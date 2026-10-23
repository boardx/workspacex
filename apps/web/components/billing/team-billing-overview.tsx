"use client";
import * as React from "react";
import { billingCredits as billing } from "@repo/contracts";
import { apiRequest, ApiError } from "@/lib/api-client";
import { WalletAvailability } from "./wallet-availability";
import { LiveCashierDialog } from "./live-cashier-dialog";
import { Button } from "@/components/ui/button";
type Wallet = ReturnType<typeof billing.operations.getWallet.out.parse>["wallet"];
/** Organization administrator destination; denial never falls back to a personal wallet. */
export function TeamBillingOverview({ownerId,sessionToken,openOnReady=false}:{ownerId:string;sessionToken:string;openOnReady?:boolean}) {
 const [wallet,setWallet]=React.useState<Wallet|null>(null);const [denied,setDenied]=React.useState(false);const [failed,setFailed]=React.useState(false);const [open,setOpen]=React.useState(false);const [revision,retry]=React.useReducer((v:number)=>v+1,0);
 React.useEffect(()=>{const controller=new AbortController();setFailed(false);void apiRequest(billing.operations.getWallet.path,{sessionToken,query:{ownerType:"team",ownerId},signal:controller.signal}).then(raw=>{const value=billing.operations.getWallet.out.parse(raw).wallet;if(value.ownerType!=="team"||value.ownerId!==ownerId)throw new Error("BILLING_WALLET_SCOPE_MISMATCH");if(!controller.signal.aborted){setWallet(value);if(openOnReady)setOpen(true);}}).catch((error:unknown)=>{if(controller.signal.aborted)return;setWallet(null);if(error instanceof ApiError&&[401,403].includes(error.status))setDenied(true);else setFailed(true);});return()=>controller.abort();},[ownerId,sessionToken,revision,openOnReady]);
 return <section className="mx-auto max-w-5xl space-y-4 p-6"><h1 className="text-24 font-semibold">组织额度</h1><p className="text-13 text-muted-foreground">本次充值只进入该组织账户。组织管理员可管理充值，普通成员请联系管理员。</p>{denied?<p role="alert">仅组织管理员可查看余额与充值，请联系组织管理员。</p>:failed?<><p role="alert">暂时无法查询组织额度，请重试。</p><Button onClick={retry}>重试查询</Button></>:wallet?<><p>当前余额 <strong>{wallet.balance.toLocaleString("zh-CN",{maximumFractionDigits:2})}</strong> 额度</p><WalletAvailability reservedCredits={wallet.reservedCredits} availableBalance={wallet.availableBalance}/>{wallet.balance<0&&<p>待结算欠额 {Math.abs(wallet.balance).toLocaleString("zh-CN",{maximumFractionDigits:2})} 额度</p>}<Button onClick={()=>setOpen(true)}>为组织充值</Button><LiveCashierDialog owner={{ownerType:"team",ownerId}} sessionToken={sessionToken} open={open} onOpenChange={setOpen} onCredited={retry}/></>:<p role="status">正在查询组织额度…</p>}</section>;
}
