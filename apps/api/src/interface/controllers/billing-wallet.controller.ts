import { Controller, Get, Inject, Query, ForbiddenException, BadRequestException } from "@nestjs/common";
import { operations } from "@repo/contracts/billing-credits";
import { z } from "zod";
import type { Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { BillingWalletService, BillingWalletAccessError, BillingWalletCursorError } from "../../application/billing/billing-wallet-service";
const LedgerHttpQuery=operations.listTransactions.in.extend({
  limit:z.preprocess(value=>typeof value==="string"?Number(value):value,operations.listTransactions.in.shape.limit),
});
@Controller()
export class BillingWalletController {
  constructor(@Inject(BillingWalletService) private readonly service:BillingWalletService) {}
  private async mapped<T>(call:()=>Promise<T>) {
    try { return await call(); } catch(error) {
      if(error instanceof BillingWalletAccessError) throw new ForbiddenException();
      if(error instanceof BillingWalletCursorError) throw new BadRequestException();
      throw error;
    }
  }
  @Get(operations.getWallet.path)
  wallet(@CurrentPrincipal() principal:Principal,@Query(new ZodBodyPipe(operations.getWallet.in)) input:z.infer<typeof operations.getWallet.in>) {
    return this.mapped(()=>this.service.wallet(principal,input));
  }
  @Get(operations.listTransactions.path)
  transactions(@CurrentPrincipal() principal:Principal,@Query(new ZodBodyPipe(LedgerHttpQuery)) input:z.infer<typeof operations.listTransactions.in>) {
    return this.mapped(()=>this.service.transactions(principal,input));
  }
}
