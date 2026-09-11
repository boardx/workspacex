import { Controller, Get, Inject, Put, ServiceUnavailableException, Body } from "@nestjs/common";
import { planPermissions as C } from "@repo/contracts";
import {
  TOOL_PERMISSION_GRANT_STORE, type ToolPermissionGrantStore,
} from "../../application/agent-run/tool-permission-grants";
import { DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS } from "../../domain/agent-run/document-generation-skills";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";

/**
 * issue #3440 —— composer 开关「自动批准文档生成所需权限」的读/写端点。
 *
 * ## 为什么不是 #3068 那条组织 admin 专用路由的又一个操作
 *
 * `tool-permission-grant.controller.ts` 的 `listStandingToolGrants`/
 * `revokeStandingToolGrant` 面向**任意工具名**的组织级授权，一条 forever 授权能放行
 * 同组织所有人对该工具名的每次调用——收回它因此判组织 admin（该文件头注的论证）。
 * 本开关的地址被死死钉在 `DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS` 这一个
 * 常量上，且只在 `tool-permission-gate.ts` 里被四个锁定文档 skill 的可归因调用读取
 * （`resolveDocumentGenerationGrantAddress` 非空时才会去查这个地址）——范围已经在
 * 写入之前就被代码锁死，不是"写下什么就放行什么"的通用能力，因此不需要组织
 * admin 门槛：这是产品意义上的"文档生成默认审批策略"，任何组织成员都能为自己
 * 所在的组织开/关（复用底层 standing grant 存储只是省一张表，不是把它当成
 * 那条通用管理面的一部分）。
 */
@Controller()
export class DocumentGenerationAutoApproveController {
  constructor(
    @Inject(TOOL_PERMISSION_GRANT_STORE) private readonly grants: ToolPermissionGrantStore,
  ) {}

  @Get("/document-generation-auto-approve")
  async get(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    return this.run(async () => {
      const enabled = await this.isEnabled(orgId);
      return C.operations.getDocumentGenerationAutoApprove.out.parse({ enabled });
    });
  }

  @Put("/document-generation-auto-approve")
  async set(@Body() body: unknown, @CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const input = C.operations.setDocumentGenerationAutoApprove.in.parse(body);
    return this.run(async () => {
      if (input.enabled) {
        await this.grants.grantStanding(orgId, DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS, principal.userId);
      } else {
        const rows = await this.grants.listStanding(orgId);
        const existing = rows.find((row) => row.toolName === DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS);
        if (existing) await this.grants.revokeStanding(orgId, existing.grantId, principal.userId);
      }
      const enabled = await this.isEnabled(orgId);
      return C.operations.setDocumentGenerationAutoApprove.out.parse({ enabled });
    });
  }

  private async isEnabled(orgId: ReturnType<typeof toOrgId>): Promise<boolean> {
    const rows = await this.grants.listStanding(orgId);
    return rows.some((row) => row.toolName === DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS);
  }

  /** 下层故障 → HTTP，一处。不回显 `e.message`（`lint-error-leak` 的同一条纪律）。 */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw new ServiceUnavailableException({ reasonCode: "DEPENDENCY_UNAVAILABLE" });
    }
  }
}
