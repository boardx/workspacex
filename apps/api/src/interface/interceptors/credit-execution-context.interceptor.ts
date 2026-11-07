import {Injectable,type NestInterceptor,type ExecutionContext,type CallHandler} from "@nestjs/common";
import {Observable} from "rxjs";
import type {Principal} from "../../domain/principal";
import {withCreditSubject} from "../../application/billing/credit-execution-context";
/** Runs after authentication guards. Scope subscription as well as handler creation. */
@Injectable()
export class CreditExecutionContextInterceptor implements NestInterceptor {
 intercept(context:ExecutionContext,next:CallHandler):Observable<unknown>{
  const principal=context.switchToHttp().getRequest<{principal?:Principal}>().principal;
  if(!principal)return next.handle();
  return new Observable(subscriber=>withCreditSubject(principal,()=>{
   const subscription=next.handle().subscribe({next:value=>subscriber.next(value),error:error=>subscriber.error(error),complete:()=>subscriber.complete()});
   return ()=>subscription.unsubscribe();
  }));
 }
}
