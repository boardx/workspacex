/**
 * CRM 边缘 schema（backlog D3「边缘存 ID、源站存个人信息」）。
 *
 * 运营平面（Cloudflare）只存：不透明 `leadId`（源站生成，契约 `crmContacts.LEAD_ID_PATTERN`
 * 是唯一定义）+ 非个人信息状态（阶段、来源渠道、关联活动 id、时间戳）。
 * 姓名 / 公司 / 电话 / 邮箱 / 备注只在境内源站 `crm_contacts`；详情页由运营人员浏览器在查看时
 * 直接回源读取——本 Worker 不代取、不缓存、不落盘（见 crm.ts 与 test/crm.test.ts）。
 *
 * 门控：`pnpm run lint:ops-crm-schema`（lint-telemetry-schema.mjs 同一道门）+ test/crm.test.ts
 * 的「无个人信息形状字段」断言。
 */
import { LEAD_ID_PATTERN } from "@repo/contracts/crm-contacts";
import { z } from "zod";
import { CampaignId, CHANNELS } from "./gtm-schema";

export const LEAD_STAGES = ["new", "qualified", "trial", "negotiating", "won", "lost", "dormant"] as const;

const LeadId = z.string().regex(LEAD_ID_PATTERN);
const Timestamp = z.string().datetime();

export const LeadRef = z.object({
  leadId: LeadId,
  stage: z.enum(LEAD_STAGES),
  channel: z.enum(CHANNELS),
  campaignId: CampaignId.optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}).strict();
export type LeadRef = z.infer<typeof LeadRef>;

export const CreateLeadRefInput = LeadRef.omit({ createdAt: true, updatedAt: true }).strict();
export const UpdateLeadRefInput = z.object({ stage: z.enum(LEAD_STAGES).optional(), campaignId: CampaignId.optional() }).strict();
