/**
 * backlog D3 —— CRM 联系人（线索个人信息）端口。契约：`@repo/contracts` 的 `crmContacts`。
 *
 * 个人信息只在境内源站；边缘（ops-console）只持不透明 leadId。这里**没有**任何「导出 / 同步到
 * 边缘」的端口——跨境传输待法务确认，不实现。
 */
import { randomBytes } from "node:crypto";
import type { crmContacts as C } from "@repo/contracts";

export type CrmContact = C.CrmContact;
export type CrmContactFields = import("zod").infer<typeof C.CrmContactInput>;

export interface CrmContactRepository {
  create(leadId: string, fields: CrmContactFields, createdBy: string): Promise<CrmContact>;
  get(leadId: string): Promise<CrmContact | null>;
  update(leadId: string, patch: Partial<CrmContactFields>): Promise<CrmContact | null>;
  delete(leadId: string): Promise<boolean>;
}

export const CRM_CONTACT_REPOSITORY = Symbol("CRM_CONTACT_REPOSITORY");

/** 随机生成，不从任何个人信息派生——边缘拿到它也反推不出是谁。 */
export function newLeadId(): string {
  return `lead_${randomBytes(8).toString("hex")}`;
}
