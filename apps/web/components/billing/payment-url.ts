/** Shared browser boundary for server-provided payment addresses. Never accept credentials, fragments or foreign hosts. */
export function requirePaymentUrl(value:string,provider:"wechat"|"stripe"):string {
 const url=new URL(value);
 const invalid=provider==="stripe" ? url.protocol!=="https:"||url.hostname!=="checkout.stripe.com"
  : url.protocol!=="weixin:"||url.hostname!=="wxpay"||url.pathname!=="/bizpayurl"||!url.searchParams.get("pr");
 if(invalid||url.port||url.username||url.password||url.hash)throw Error("invalid_payment_address");
 return value;
}
export function requireManagementUrl(value:string):string {
 const url=new URL(value);
 if(url.protocol!=="https:"||url.hostname!=="billing.stripe.com"||!url.pathname.startsWith("/p/session/")||url.port||url.username||url.password||url.hash)throw Error("invalid_management_address");
 return value;
}
