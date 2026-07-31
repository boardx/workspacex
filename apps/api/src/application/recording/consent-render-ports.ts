/**
 * F79 — 同意书渲染 + 快照固化所需的端口。
 *
 * ⚠ 与 F78 同一个判断：**本 feature 不落 PostgreSQL 实现**。渲染变量的权威存储
 *   （模板文本、项目的数据控制方/联系人/合规邮箱配置）尚无内核落地，本束仍是消费方；
 *   `ConsentRenderDeps.retention` 直接复用 F78 的 `RetentionDeps`，
 *   以保证「保留期只有一处」不被本 feature 悄悄破一次（uc-5-4 R8）。
 *
 * ⇒ 本文件定义**问题的形状**，`tests/support/consent-render-fakes.ts` 给出内存实现。
 */
import type { RetentionDeps } from "./retention-ports";
import type { ConsentRenderInstance } from "../../domain/recording/consent-render";

/** 模板文本存储。⚠ 只返回原始模板字符串（含占位符），不做任何渲染。 */
export interface ConsentTemplateStore {
  template(templateId: string): Promise<string | undefined>;
}

/**
 * 项目级的合规联系信息配置。
 * ⚠ 三个字段都可以是 `null` —— 未配置就是 `null`，由用例判
 *   `CONSENT_TEMPLATE_VARIABLE_MISSING`，不得兜底成空字符串或占位文案
 *   （空字符串一样会在 `resolveConsentVariables` 里被当成缺失）。
 */
export interface ConsentComplianceContactStore {
  contact(input: { readonly projectId: string }): Promise<{
    readonly dataController: string | null;
    readonly contactName: string | null;
    readonly complianceEmail: string | null;
  }>;
}

/** 已提交同意书的渲染快照存储。⚠ 不提供「更新」方法——固化只有插入一条路径。 */
export interface ConsentSnapshotStore {
  instance(consentId: string): Promise<ConsentRenderInstance | undefined>;
  insert(instance: ConsentRenderInstance): Promise<void>;
}

/**
 * 同意提交状态的读端口——`freezeConsentSnapshot` 的前置检查（`CONSENT_NOT_SUBMITTED`）。
 * 固化快照的前提是受访者已经提交了同意选择（uc-5-4 R3-3 步骤 4 / UC-6.3 R3 步骤 4），
 * 本束不重复实现「同意提交」本身，只读一个布尔判据。
 */
export interface ConsentSubmissionStore {
  isSubmitted(consentId: string): Promise<boolean>;
}

export interface ConsentRenderDeps {
  readonly retention: RetentionDeps;
  readonly templates: ConsentTemplateStore;
  readonly contacts: ConsentComplianceContactStore;
  readonly snapshots: ConsentSnapshotStore;
  readonly submissions: ConsentSubmissionStore;
}

export type { ConsentRenderInstance };
