/**
 * `GET /mcp-servers` —— 契约 `agentRuntime.operations.listMcpServers`（issue #1928）。
 * 协议适配，判断全在 `application/mcp/list-mcp-servers.ts`。
 */
import { Controller, ForbiddenException, Get, Inject, Query } from "@nestjs/common";
import { agentRuntime as C } from "@repo/contracts";
import { listMcpServers, ListMcpServersError } from "../../application/mcp/list-mcp-servers";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { MCP_SERVER_STORE, type McpServerStore } from "../../application/mcp/ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

@Controller()
export class McpServersController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(MCP_SERVER_STORE) private readonly servers: McpServerStore,
  ) {}

  @Get(C.operations.listMcpServers.path)
  async list(@CurrentPrincipal() principal: Principal, @Query() _query: unknown) {
    assertPrincipal(principal);

    try {
      const rows = await listMcpServers(
        { identities: this.identities, servers: this.servers },
        { orgId: principal.orgId, actorId: principal.userId },
      );
      return C.operations.listMcpServers.out.parse(rows);
    } catch (error) {
      if (error instanceof ListMcpServersError) {
        throw new ForbiddenException({ reasonCode: error.reason });
      }
      throw error;
    }
  }
}
