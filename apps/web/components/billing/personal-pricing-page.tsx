"use client";
import * as React from "react";
import type {PricingCatalog,PricingSubscriptionInfo} from "@repo/contracts/billing-pricing";
import {PersonalPricingOverview} from "./personal-pricing-overview";
import {PersonalPricingCheckout} from "./personal-pricing-checkout";
import {loadPersonalCheckout} from "./personal-checkout-state";
type Purchase={kind:"plans"|"credits";catalog:PricingCatalog;entitlement:PricingSubscriptionInfo};
export function PersonalPricingPage({userId,sessionToken,openOnReady=false,onPurchaseOpened}:{userId:string;sessionToken:string;openOnReady?:boolean;onPurchaseOpened?:()=>void}){
 const [purchase,setPurchase]=React.useState<Purchase|null>(null),[revision,refresh]=React.useReducer(n=>n+1,0),[message,setMessage]=React.useState<string|null>(null),consumed=React.useRef(false);
 const select=React.useCallback((kind:"plans"|"credits",catalog:PricingCatalog,entitlement:PricingSubscriptionInfo)=>setPurchase({kind,catalog,entitlement}),[]);
 const ready=React.useCallback((catalog:PricingCatalog,entitlement:PricingSubscriptionInfo)=>{
  if(consumed.current)return;
  const returning=new URLSearchParams(window.location.search).has("purchase_ref");
  if(!openOnReady&&!returning)return;
  consumed.current=true;
  try{
   const existing=loadPersonalCheckout(localStorage,userId);
   if(!openOnReady&&!existing)return;
   const product=existing?catalog.products.find(p=>p.sku===existing.request.sku):null;
   select(product?.kind==="subscription"?"plans":"credits",catalog,entitlement);onPurchaseOpened?.();
  }catch{setMessage("无法读取原付款记录，请联系支持，勿重复付款。");}
 },[openOnReady,userId,onPurchaseOpened,select]);
 const close=React.useCallback(()=>{setPurchase(null);refresh();},[]);
 return <>
  {message&&<p role="alert" className="mx-auto max-w-5xl p-4 text-13 text-destructive">{message}</p>}
  <PersonalPricingOverview key={revision} userId={userId} sessionToken={sessionToken} onPurchase={select} onReady={ready}/>
  {purchase&&<PersonalPricingCheckout {...purchase} userId={userId} sessionToken={sessionToken} onClose={close} onPaid={refresh}/>}
 </>;
}
