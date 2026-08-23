/**
 * `POST /mcp-servers/discover-remote` —— 契约 `agentRuntime.operations.discoverRemoteMcpTools`
 * （issue #1852）。协议适配，判断全在 `application/mcp/discover-remote-server.ts`。
 *
 * 这是本仓第一条真正把 `McpGateway` 接到一个说 MCP 协议的 client 上的路由——之前
 * `apps/api/src/application/mcp/*` 的治理用例全部存在、全部有测试，但零路由、零真实
 * `McpGateway` 实现（`grep implements McpGateway` 零命中），前端接的是纯 mock。
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpStatus,
  Inject,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import { agentRuntime as C } from "@repo/contracts";
import {
  discoverRemoteMcpTools,
  DiscoverRemoteMcpToolsError,
  DISCOVER_REMOTE_MCP_TOOLS_DEPS_FACTORY,
  type DiscoverRemoteMcpToolsDepsFactory,
} from "../../application/mcp/discover-remote-server";
import { McpEndpointRefusedError } from "../../domain/mcp/remote-endpoint-guard";
import {
  McpDiscoveryTimeoutError,
  McpServerUnreachableError,
} from "../../application/mcp/ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { isLocalOrg } from "../../domain/identity/local-org";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

type DiscoverRemoteBody = ReturnType<typeof C.operations.discoverRemoteMcpTools.in.parse>;

const ENDPOINT_GUARD_STATUS: Record<string, HttpStatus> = {
  MCP_ENDPOINT_FORBIDDEN_FOR_LOCAL_ORG: HttpStatus.FORBIDDEN,
};

@Controller()
export class McpRemoteDiscoveryController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(DISCOVER_REMOTE_MCP_TOOLS_DEPS_FACTORY)
    private readonly composeDeps: DiscoverRemoteMcpToolsDepsFactory,
  ) {}

  @Post(C.operations.discoverRemoteMcpTools.path)
  async discover(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.discoverRemoteMcpTools.in)) body: DiscoverRemoteBody,
  ) {
    assertPrincipal(principal);

    const orgId = toOrgId(principal.orgId);
    const organization = await this.identities.findOrganization(orgId);
    // 组织查不到时拒绝，不当成普通组织继续——与 `AgentUrlImportController` 同一条理由。
    if (organization === null) {
      throw new ForbiddenException({ reasonCode: "NOT_ORG_ADMIN" });
    }

    const deps = this.composeDeps({
      orgId: principal.orgId,
      localOnlyOrg: isLocalOrg(organization.kind),
      credential: body.credential,
    });

    try {
      const result = await discoverRemoteMcpTools(deps, {
        orgId: principal.orgId,
        actorId: principal.userId,
        serverId: body.serverId,
        endpoint: body.endpoint,
      });
      return C.operations.discoverRemoteMcpTools.out.parse(result);
    } catch (error) {
      if (error instanceof DiscoverRemoteMcpToolsError) {
        throw new ForbiddenException({ reasonCode: error.reason });
      }
      if (error instanceof McpEndpointRefusedError) {
        const status = ENDPOINT_GUARD_STATUS[error.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
        if (status === HttpStatus.FORBIDDEN) throw new ForbiddenException({ reasonCode: error.code });
        throw new UnprocessableEntityException({ reasonCode: error.code });
      }
      if (error instanceof McpServerUnreachableError) {
        throw new UnprocessableEntityException({ reasonCode: "MCP_SERVER_UNREACHABLE" });
      }
      if (error instanceof McpDiscoveryTimeoutError) {
        throw new UnprocessableEntityException({ reasonCode: "REQUEST_TIMEOUT" });
      }
      throw error;
    }
  }
}
