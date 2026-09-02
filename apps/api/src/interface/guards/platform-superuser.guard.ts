/**
 * `PlatformSuperuserGuard` -- the ONE place that decides "is this caller a platform
 * superuser", per `.agents/skills/mod-org-identity/SKILL.md`'s invariant: "新端点必须逐行
 * 复用 `apps/api/src/interface/guards` 里既有实现，禁止另起一套" (new endpoints must reuse
 * what's in this directory, not reimplement authorization in a business controller --
 * review finding, PR #2475: the first version of this had `SystemErrorLogController` read
 * `process.env` and query credentials itself).
 *
 * ## Why this identity is not `OrgRole`
 *
 * See `@repo/contracts`'s `system-error-logs.ts` file header: `error_logs` has no `org_id`,
 * so an org-scoped role would let one org's admin see every org's incident detail. Platform
 * superuser is deliberately outside the org/team/project role hierarchy entirely.
 *
 * ## Runs AFTER `PrincipalGuard`
 *
 * `PrincipalGuard` is the global `APP_GUARD` and runs first (see `kernel.module.ts`), so by
 * the time this guard's `canActivate` runs, `req.principal` is already set and non-null --
 * an unauthenticated caller never reaches here at all (401 from `PrincipalGuard`, before
 * this guard's 403 is even a possibility). This guard therefore only has ONE question to
 * answer: given a real principal, is their email on the whitelist.
 */
import { CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from "../../application/auth/ports";
import { isPlatformSuperuserEmail, platformSuperuserWhitelistFromEnv } from "../../domain/system/platform-superuser";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";

@Injectable()
export class PlatformSuperuserGuard implements CanActivate {
  constructor(@Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ principal?: Principal }>();
    const principal = req.principal;
    assertPrincipal(principal);

    const credential = await this.credentials.findByUserId(principal.userId);
    const whitelist = platformSuperuserWhitelistFromEnv(process.env.PLATFORM_SUPERUSER_EMAILS);
    // ⚠ A lookup miss (theoretically shouldn't happen -- see `CredentialRepository.findByUserId`'s
    //   own doc comment) falls through to "" here, which never matches a whitelist entry
    //   (`isPlatformSuperuserEmail` treats an empty email as never-a-match) -- fail closed,
    //   not a 500.
    if (!isPlatformSuperuserEmail(credential?.email ?? "", whitelist)) {
      throw new ForbiddenException({ reasonCode: "NOT_PLATFORM_SUPERUSER" });
    }
    return true;
  }
}
