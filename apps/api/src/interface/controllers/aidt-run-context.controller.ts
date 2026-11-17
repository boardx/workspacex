import { Controller, Get, Header, HttpException, Inject, Param } from "@nestjs/common";
import { operations } from "@repo/contracts/aidt-run-context";
import { AIDT_RUN_CONTEXT_RECEIPT, type AidtRunContextReceiptPort } from "../../application/aidt-run-context/ports";
import { AidtContextError } from "../../application/aidt-run-context/errors";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

/** Closed transport projection; no database, source text or provider error is disclosed. */
export function aidtContextHttpException(error: AidtContextError): HttpException {
  const code = error.reasonCode;
  const status = code === "AIDT_CONTEXT_INVALID" || code === "AIDT_CONTEXT_TOO_LARGE" ? 422
    : code === "AIDT_CONTEXT_NOT_AVAILABLE" ? 404 : code === "AIDT_CONTEXT_CONFLICT" ? 409 : 503;
  return new HttpException({ reasonCode: code }, status);
}
@Controller()
export class AidtRunContextController {
  constructor(@Inject(AIDT_RUN_CONTEXT_RECEIPT) private readonly receipts: AidtRunContextReceiptPort) {}
  @Get(operations.receipt.path)
  @Header("Cache-Control", "private, no-store")
  async receipt(@CurrentPrincipal() actor: Principal, @Param("runId") runId: string) {
    assertPrincipal(actor);
    if (!operations.receipt.in.safeParse({ runId }).success) throw aidtContextHttpException(new AidtContextError("AIDT_CONTEXT_NOT_AVAILABLE"));
    try {
      return operations.receipt.out.parse(await this.receipts.receipt(actor, runId));
    } catch (error) {
      if (error instanceof AidtContextError && error.reasonCode === "AIDT_CONTEXT_NOT_AVAILABLE") throw aidtContextHttpException(error);
      throw aidtContextHttpException(new AidtContextError("AIDT_CONTEXT_UNAVAILABLE"));
    }
  }
}
