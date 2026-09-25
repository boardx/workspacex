/**
 * backlog D3 —— CRM 联系人个人信息（境内源站）。契约：`crmContacts.operations`。
 *
 * 只有平台运营（`PlatformOperatorGuard`）可访问。运营平面（Cloudflare ops-console）只持不透明
 * leadId；其详情页由运营人员浏览器在查看时直接调这里的 GET——所以每个响应都是 `no-store`，
 * 任何中间层（含 CDN）都不许缓存个人信息。
 */
import { Body, Controller, Delete, Get, Header, Inject, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { crmContacts as C } from "@repo/contracts";
import {
  CRM_CONTACT_REPOSITORY, newLeadId,
  type CrmContact, type CrmContactFields, type CrmContactRepository,
} from "../../application/crm/crm-contact-ports";
import { CurrentPrincipal } from "../current-principal.decorator";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

const notFound = () => new NotFoundException({ reasonCode: "NOT_FOUND" });
/** 非法 id 与不存在同样回 404——不给探测者区分「格式错」与「没有这个人」的信号。 */
const validId = (leadId: string) => { if (!C.LEAD_ID_PATTERN.test(leadId)) throw notFound(); return leadId; };

@Controller()
export class CrmContactController {
  constructor(@Inject(CRM_CONTACT_REPOSITORY) private readonly contacts: CrmContactRepository) {}

  @UseGuards(PlatformOperatorGuard)
  @Post("/system/crm/contacts")
  @Header("Cache-Control", "no-store")
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodBodyPipe(C.operations.createCrmContact.in)) body: CrmContactFields,
  ): Promise<CrmContact> {
    assertPrincipal(principal);
    return this.contacts.create(newLeadId(), body, principal.userId);
  }

  @UseGuards(PlatformOperatorGuard)
  @Get("/system/crm/contacts/:leadId")
  @Header("Cache-Control", "no-store")
  async get(@Param("leadId") leadId: string): Promise<CrmContact> {
    return (await this.contacts.get(validId(leadId))) ?? (() => { throw notFound(); })();
  }

  @UseGuards(PlatformOperatorGuard)
  @Patch("/system/crm/contacts/:leadId")
  @Header("Cache-Control", "no-store")
  async update(
    @Param("leadId") leadId: string,
    @Body(new ZodBodyPipe(C.operations.updateCrmContact.in)) body: Partial<CrmContactFields>,
  ): Promise<CrmContact> {
    return (await this.contacts.update(validId(leadId), body)) ?? (() => { throw notFound(); })();
  }

  @UseGuards(PlatformOperatorGuard)
  @Delete("/system/crm/contacts/:leadId")
  @Header("Cache-Control", "no-store")
  async remove(@Param("leadId") leadId: string): Promise<{ deleted: true }> {
    if (!(await this.contacts.delete(validId(leadId)))) throw notFound();
    return { deleted: true };
  }
}
