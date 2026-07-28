/**
 * Global auth guard -- one of the three mandatory runtime gates in `architecture.md`.
 *
 * It enforces exactly one structural constraint: the principal a handler receives is
 * non-null. The decision logic (two-layer intersection) belongs to the `identity` bundle,
 * and enforcement belongs to PG RLS. Three distinct positions, none of which can stand in
 * for another (UC-0.6 R5).
 *
 * Two rules that must not be broken:
 *   - Cannot identify the principal => 401. Never pass an anonymous principal through.
 *   - Resolution dependency unavailable => reject, never degrade to allowing the request
 *     (the same rule as identity's `AUTH_SERVICE_UNAVAILABLE`).
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  PRINCIPAL_RESOLVER_PORT,
  type PrincipalResolverPort,
} from "../../application/ports/principal-resolver.port";
import { IS_PUBLIC } from "../public.decorator";

@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(
    @Inject(PRINCIPAL_RESOLVER_PORT) private readonly resolver: PrincipalResolverPort,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined>; principal?: unknown }>();
    let principal;
    try {
      principal = await this.resolver.resolve(req.headers);
    } catch {
      // Dependency failure => reject. Degrading to allow is the most common disguise for
      // "there is no auth layer at all".
      throw new ServiceUnavailableException("auth_unavailable");
    }
    if (!principal) throw new UnauthorizedException("unauthenticated");
    req.principal = principal;
    return true;
  }
}
