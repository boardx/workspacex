import type {MonthlyCheckoutProvider,MonthlyOrder,MonthlyProvider} from "../../application/billing/monthly-pass-service";
export class MonthlyCheckoutRouter implements MonthlyCheckoutProvider {
 constructor(private readonly stripe:MonthlyCheckoutProvider,private readonly wechat:MonthlyCheckoutProvider){}
 private client(provider:MonthlyProvider){return provider==="wechat"?this.wechat:this.stripe;}
 enabled(provider:MonthlyProvider="stripe"){return this.client(provider).enabled();}
 liveMode(provider:MonthlyProvider="stripe"){return this.client(provider).liveMode();}
 create(order:MonthlyOrder){return this.client(order.provider??"stripe").create(order);}
 retrieve(id:string){return (id.startsWith("bg")?this.wechat:this.stripe).retrieve(id);}
}
