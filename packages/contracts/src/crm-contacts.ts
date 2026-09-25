/**
 * CRM 联系人（backlog D3「边缘存 ID、源站存个人信息」）——源站侧契约。
 *
 * ## 分层
 *
 * - **源站（本契约，apps/api，境内）**：线索的个人信息——姓名、公司、电话、邮箱、备注。
 *   只有平台运营（`PlatformOperatorGuard`）可读写；表 `crm_contacts` 开 RLS（FORCE），
 *   不设运营标记的会话一行也看不到。
 * - **边缘（apps/ops-console，Cloudflare）**：只存不透明 `leadId` + 非个人信息的状态字段
 *   （阶段、来源渠道、活动 id）。详情页在**查看时由运营人员的浏览器直接回源**取个人信息，
 *   边缘 Worker 既不代取、也不缓存、也不落盘——个人信息不经过 Cloudflare。
 *
 * ⚠ 个人信息跨境传输「待法务确认」：本契约**不提供**任何把个人信息导出到境外 / 边缘的接口。
 *
 * `leadId` 由源站在建联系人时生成；`LEAD_ID_PATTERN` 是两侧共用的唯一定义。
 */
import { z } from "zod";

/** 不透明线索 id：`lead_` + 16 位小写 hex（随机生成，不从姓名 / 邮箱 / 公司派生）。 */
export const LEAD_ID_PATTERN = /^lead_[a-f0-9]{16}$/;
export const LeadId = z.string().regex(LEAD_ID_PATTERN);

export const CrmContactInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    company: z.string().trim().max(200).optional(),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{5,32}$/).optional(),
    email: z.string().trim().email().max(254).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

export const CrmContact = z
  .object({
    leadId: LeadId,
    name: z.string(),
    company: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type CrmContact = z.infer<typeof CrmContact>;

const ERR = ["NOT_PLATFORM_SUPERUSER"] as const;

export const operations = {
  /** 新建联系人（境内源站落库），返回源站生成的 `leadId`——边缘只登记这个 id。 */
  createCrmContact: {
    method: "POST",
    path: "/system/crm/contacts",
    in: CrmContactInput,
    out: CrmContact,
    err: [...ERR, "VALIDATION_FAILED"] as const,
  },
  /** 详情页回源：运营人员浏览器在查看时直接调用，响应 `cache-control: no-store`。 */
  getCrmContact: {
    method: "GET",
    path: "/system/crm/contacts/:leadId",
    in: z.object({}).strict(),
    out: CrmContact,
    err: [...ERR, "NOT_FOUND"] as const,
  },
  /** 部分更新：省略 = 保留现值。 */
  updateCrmContact: {
    method: "PATCH",
    path: "/system/crm/contacts/:leadId",
    in: CrmContactInput.partial().strict(),
    out: CrmContact,
    err: [...ERR, "NOT_FOUND", "VALIDATION_FAILED"] as const,
  },
  /** 删除（个人信息删除请求）：源站行物理删除；边缘的不透明 id 此后回源得 404。 */
  deleteCrmContact: {
    method: "DELETE",
    path: "/system/crm/contacts/:leadId",
    in: z.object({}).strict(),
    out: z.object({ deleted: z.literal(true) }).strict(),
    err: [...ERR, "NOT_FOUND"] as const,
  },
} as const;
