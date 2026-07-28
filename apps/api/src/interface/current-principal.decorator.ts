import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Principal } from "../domain/principal";

/**
 * Reads the current principal. It only reads what the Guard put there and never resolves
 * credentials itself -- two places able to resolve "who is this" means two judgements of
 * identity, which will drift.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal | undefined =>
    ctx.switchToHttp().getRequest<{ principal?: Principal }>().principal,
);
