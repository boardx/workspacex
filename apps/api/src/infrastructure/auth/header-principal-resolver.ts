/**
 * Kernel placeholder implementation of principal resolution: read the principal from
 * a test-injection header.
 *
 * This is NOT an authentication scheme. The real credential format belongs to phase-01
 * `01-auth` (UC-0.6 A-3). It exists so the Guard's structural constraints (principal
 * non-null, 401 without credentials) can be asserted now rather than after auth is built.
 *
 * The injection channel is unreachable in production: it requires
 * `KERNEL_ALLOW_TEST_PRINCIPAL=1` AND `NODE_ENV !== production`. Same discipline as the
 * web kernel's `?as=` role-preview switch -- a switch that lets you claim to be someone
 * else is test tooling only while it is unreachable in production; otherwise it is a
 * backdoor. verify-runtime-gates.sh carries the counter-proof.
 */
import type { PrincipalResolverPort } from "../../application/ports/principal-resolver.port";
import type { Principal } from "../../domain/principal";
import { isOrgId } from "../../domain/org-id";

export class HeaderPrincipalResolver implements PrincipalResolverPort {
  private readonly enabled: boolean;

  constructor() {
    this.enabled =
      process.env.KERNEL_ALLOW_TEST_PRINCIPAL === "1" && process.env.NODE_ENV !== "production";
  }

  async resolve(
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): Promise<Principal | null> {
    if (!this.enabled) return null;
    const raw = headers["x-kernel-test-principal"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return null;
    const [userId, orgId] = value.split(":");
    // Unidentifiable => null, so the Guard rejects with 401. Never an anonymous principal.
    if (!userId || !isOrgId(orgId)) return null;
    return { userId, orgId };
  }
}
