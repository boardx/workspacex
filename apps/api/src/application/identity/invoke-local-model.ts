/**
 * `InvokeLocalModel` + `GetLocalRuntimeStatus` (F16, acceptance V3 and V5).
 *
 * ## Why a real call path exists at all
 *
 * V3 says "发起 AI 调用时出网流量为零". That sentence can only be asserted if there is a
 * call. Asserting it against `resolveModelConstraint` would be theatre: that function returns
 * a verdict object and of course never opens a socket. This project has already been bitten
 * by exactly that shape once -- F03 found that "管理员不是超级用户" was proven inside the
 * decision function while no real read path had been shown to consult it.
 *
 * ## The two refusals, and why neither degrades
 *
 * `CLOUD_MODEL_FORBIDDEN`     the named model is not on this machine
 * `LOCAL_RUNTIME_UNAVAILABLE` the local runtime is not running
 *
 * Neither has a fallback branch, and there is deliberately nowhere to put one: the runtime
 * port has a single endpoint (`local-org-ports.ts`) and the use case never chooses a model
 * the caller did not name. "绝不偷偷改用云端" is not implemented by remembering not to; it is
 * implemented by there being no cloud client in reach.
 *
 * ## Why the whole thing runs inside the egress guard
 *
 * Because the promise is not about what THIS file does. Inside `runLocalOnly`, any outbound
 * connection -- from here, from `pg`, from a dependency's telemetry -- is refused at
 * `net.Socket.connect`. That is the only level at which "出网请求数为 0" is a fact rather than
 * a self-report (identity domain.md, "为什么 I-9 必须在网络层断言").
 */
import { isLocalEndpoint, LOCAL_RUNTIME_STARTUP_HINT, isLocalOrg } from "../../domain/identity/local-org";
import type { OrgId } from "../../domain/org-id";
import type { CapabilityRepository } from "./capability-ports";
import {
  CapabilityNotFoundError,
  CloudModelForbiddenError,
  LocalOrgOnlyError,
  LocalRuntimeUnavailableError,
  NoOrgMembershipError,
} from "./errors";
import type { EgressGuard, LocalModelRuntime } from "./local-org-ports";
import type { IdentityRepository } from "./ports";

export interface LocalModelDeps {
  readonly repo: IdentityRepository;
  readonly capabilities: CapabilityRepository;
  readonly runtime: LocalModelRuntime;
  readonly egress: EgressGuard;
}

/**
 * Membership + "this really is a local organization", in that order.
 *
 * The order is not cosmetic: answering LOCAL_ORG_ONLY to a non-member would confirm the kind
 * of an organization they have no relationship with.
 */
async function requireLocalMembership(
  repo: IdentityRepository,
  userId: string,
  orgId: OrgId,
): Promise<void> {
  const membership = await repo.findOrgMembership(userId, orgId);
  if (membership === null) throw new NoOrgMembershipError();
  const org = await repo.findOrganization(orgId);
  if (org === null) throw new NoOrgMembershipError();
  if (!isLocalOrg(org.kind)) throw new LocalOrgOnlyError();
}

export interface LocalRuntimeStatus {
  readonly available: boolean;
  readonly endpoint: string;
  readonly failure: {
    readonly code: "LOCAL_RUNTIME_UNAVAILABLE";
    readonly detail: string;
    readonly startupHint: string;
  } | null;
}

export async function getLocalRuntimeStatus(
  deps: LocalModelDeps,
  input: { readonly userId: string; readonly orgId: OrgId },
): Promise<LocalRuntimeStatus> {
  await requireLocalMembership(deps.repo, input.userId, input.orgId);

  // Probed INSIDE the guard as well. A health check is still a network call, and a health
  // check that quietly reached a cloud endpoint would be the leak -- with the added charm of
  // happening on a timer, without anybody pressing anything.
  const probe = await deps.egress.runLocalOnly(input.orgId, () => deps.runtime.probe());

  return {
    available: probe.available,
    endpoint: deps.runtime.endpoint,
    failure: probe.available
      ? null
      : {
          code: "LOCAL_RUNTIME_UNAVAILABLE",
          detail: probe.detail,
          // From the contract. The interface layer composes nothing -- a hint written at the
          // edge is a second copy of an operational instruction, and copies say "retry later".
          startupHint: LOCAL_RUNTIME_STARTUP_HINT,
        },
  };
}

export interface InvokeLocalModelInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly capabilityId: string;
  readonly prompt: string;
}

export interface InvokeLocalModelResult {
  readonly capabilityId: string;
  readonly endpoint: string;
  readonly output: string;
}

export async function invokeLocalModel(
  deps: LocalModelDeps,
  input: InvokeLocalModelInput,
): Promise<InvokeLocalModelResult> {
  await requireLocalMembership(deps.repo, input.userId, input.orgId);

  const found = await deps.capabilities.findById(input.orgId, input.capabilityId);
  // No built-in model list to fall back on (F15 V1): an organization that configured nothing
  // has nothing, and "nothing" is an empty state rather than a default.
  if (found === null) throw new CapabilityNotFoundError();

  const endpoint = found.facts.endpoint;
  if (!isLocalEndpoint(endpoint)) {
    // Refused, not substituted. Substituting would keep the privacy promise while breaking
    // the user's belief about which model answered -- and only one of those two is visible.
    throw new CloudModelForbiddenError(endpoint);
  }

  return deps.egress.runLocalOnly(input.orgId, async () => {
    const probe = await deps.runtime.probe();
    if (!probe.available) {
      throw new LocalRuntimeUnavailableError(probe.detail, LOCAL_RUNTIME_STARTUP_HINT);
    }
    const output = await deps.runtime.complete(input.prompt);
    return { capabilityId: input.capabilityId, endpoint: deps.runtime.endpoint, output };
  });
}
