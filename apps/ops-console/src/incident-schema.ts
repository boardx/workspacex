/**
 * 事故记录 schema——运营平面存储的唯一形状。
 *
 * 硬约束：运营平面不存客户内容 / 客户 PII / 凭据值 / 计费账本 / 客户可审计证据。
 * 这里用两道机械门守住它：
 *   · `pnpm run lint:ops-incident-schema`：复用 C5/C6 的 lint-telemetry-schema.mjs 遍历本 schema
 *     （对象 strict、数组有上限、字符串受约束、字段名不像个人信息；0 叶子判红）；
 *   · test/incident-schema.test.ts：额外禁止任何能指向客户身份的字段——客户只能以不透明
 *     实例哈希（sha256 hex）出现在 `affectedInstanceHashes` 里。
 *
 * `internalSummary` 是唯一的人写文字：长度 ≤ 280、单行、不含 `@` / `<>` / 6 位以上连续数字
 * （挡邮箱、标记、电话号码与账号）。它只写「哪个组件怎么坏了」，不写「谁受影响」。
 */
import { z } from "zod";

export const SEVERITIES = ["sev1", "sev2", "sev3", "sev4"] as const;
export const STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
/** 受影响组件：部署面上的服务名，不是客户维度。 */
export const COMPONENTS = [
  "web", "api", "agent", "sandbox", "postgres", "redis",
  "coord-gateway", "devportal", "home", "release-pipeline",
] as const;

const Severity = z.enum(SEVERITIES);
const Status = z.enum(STATUSES);
const Component = z.enum(COMPONENTS);
const Timestamp = z.string().datetime();
const IncidentId = z.string().regex(/^inc_[a-z0-9]{16}$/);
/** 客户实例的不透明哈希：只能是 64 位小写 hex，无法反推客户。 */
const InstanceHash = z.string().regex(/^[a-f0-9]{64}$/);
const InternalSummary = z.string().regex(/^(?!.*\d{6})[^@<>\r\n]{1,280}$/);

export const IncidentEvent = z.object({
  at: Timestamp,
  status: Status,
  severity: Severity,
}).strict();

export const IncidentRecord = z.object({
  id: IncidentId,
  severity: Severity,
  status: Status,
  components: z.array(Component).min(1).max(COMPONENTS.length),
  affectedInstanceHashes: z.array(InstanceHash).max(100),
  internalSummary: InternalSummary,
  openedAt: Timestamp,
  resolvedAt: Timestamp.optional(),
  timeline: z.array(IncidentEvent).min(1).max(200),
}).strict();
export type IncidentRecord = z.infer<typeof IncidentRecord>;

export const CreateIncidentInput = z.object({
  severity: Severity,
  components: z.array(Component).min(1).max(COMPONENTS.length),
  affectedInstanceHashes: z.array(InstanceHash).max(100).default([]),
  internalSummary: InternalSummary,
}).strict();

export const UpdateIncidentInput = z.object({
  severity: Severity.optional(),
  status: z.enum(["investigating", "identified", "monitoring"]).optional(),
  components: z.array(Component).min(1).max(COMPONENTS.length).optional(),
  affectedInstanceHashes: z.array(InstanceHash).max(100).optional(),
  internalSummary: InternalSummary.optional(),
}).strict();
