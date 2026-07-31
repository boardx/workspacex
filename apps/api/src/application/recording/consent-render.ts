/**
 * F79 — 同意书文案渲染 · 快照固化 · 快照查询三个用例。
 *
 * 对应契约 `recording.operations` 的 `renderConsentText` / `freezeConsentSnapshot`。
 *
 * ## 两条不许松的
 *
 * 1. **保留期只读一处**（uc-5-4 R8）。`renderConsentText` 拿到的 `retentionDays`
 *    直接来自 `retention-lifecycle.resolveRetention`（F78 的同一条解析链），
 *    本文件**没有第二套「取值顺序」的实现**。改项目覆盖值 ⇒ 新渲染立刻变化，
 *    因为它每次都重新走这条链，没有任何缓存或副本。
 * 2. **固化之后不可回溯改写**（I-38）。`freezeConsentSnapshot` 已固化过就拒绝——
 *    不比较内容是否相同，形状与 F78 `freezeMaterialExpiry` 的 `EXPIRY_ALREADY_FROZEN` 一致。
 */
import { resolveRetention } from "./retention-lifecycle";
import {
  computeConsentContentHash,
  freezeConsentSnapshot as freezeConsentSnapshotDomain,
  renderConsentTemplate,
  resolveConsentVariables,
  type ConsentRenderInstance,
  type ConsentTemplateVariables,
  type RecordingErrorCode,
} from "../../domain/recording/consent-render";
import type { ConsentRenderDeps } from "./consent-render-ports";

export type Fail<E extends RecordingErrorCode = RecordingErrorCode> = {
  readonly ok: false;
  readonly reason: E;
};
export type Result<T> = ({ readonly ok: true } & T) | Fail;

const fail = (reason: RecordingErrorCode): Fail => ({ ok: false, reason });

/* ── 一、渲染（`renderConsentText`）─────────────────────────────────── */

export interface RenderConsentTextInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly templateId: string;
  /** 解析保留期的时刻——透传给 F78 的 `resolveRetention`，不在本文件另立时钟。 */
  readonly resolvedAt: string;
}

export interface RenderConsentTextOutput {
  readonly renderedText: string;
  readonly variables: ConsentTemplateVariables;
}

/**
 * 渲染同意书文案。
 * ⚠ 这个用例**没有一个数字是自己算出来的**：`retentionDays` 来自
 *   `resolveRetention`（F78），联系信息来自 `deps.contacts`，模板文本来自 `deps.templates`。
 *   任一变量缺失 ⇒ `CONSENT_TEMPLATE_VARIABLE_MISSING`，**不得发出授权链接**（I-39 / E6）——
 *   调用方看到失败就不应该继续签发链接。
 */
export async function renderConsentText(
  deps: ConsentRenderDeps,
  input: RenderConsentTextInput,
): Promise<Result<RenderConsentTextOutput>> {
  const templateText = await deps.templates.template(input.templateId);
  if (templateText === undefined) return fail("TEMPLATE_NOT_FOUND");

  const retention = await resolveRetention(deps.retention, {
    orgId: input.orgId,
    projectId: input.projectId,
    resolvedAt: input.resolvedAt,
  });
  if (!retention.ok) return fail(retention.reason);

  const contact = await deps.contacts.contact({ projectId: input.projectId });

  const resolvedVars = resolveConsentVariables({
    retentionDays: retention.retention.resolvedDays,
    dataController: contact.dataController,
    contactName: contact.contactName,
    complianceEmail: contact.complianceEmail,
  });
  if (!resolvedVars.ok) return fail(resolvedVars.reason);

  const renderedText = renderConsentTemplate(templateText, resolvedVars.value);

  return { ok: true, renderedText, variables: resolvedVars.value };
}

/* ── 二、固化（`freezeConsentSnapshot`）─────────────────────────────── */

export interface FreezeConsentSnapshotInput {
  readonly consentId: string;
  readonly templateId: string;
  readonly renderedText: string;
  readonly variables: ConsentTemplateVariables;
  readonly submittedAt: string;
}

export interface FreezeConsentSnapshotOutput {
  readonly instanceId: string;
  readonly contentHash: string;
  readonly submittedAt: string;
}

/**
 * 固化已提交同意书的渲染快照。
 * ⚠ 前提是受访者**已经提交**（`CONSENT_NOT_SUBMITTED`）；已固化过的 `consentId`
 *   **不能**再固化一次（`CONSENT_SNAPSHOT_IMMUTABLE`），不论新内容是否与旧内容相同。
 */
export async function freezeConsentSnapshot(
  deps: ConsentRenderDeps,
  input: FreezeConsentSnapshotInput,
): Promise<Result<FreezeConsentSnapshotOutput>> {
  const submitted = await deps.submissions.isSubmitted(input.consentId);
  if (!submitted) return fail("CONSENT_NOT_SUBMITTED");

  const existing = await deps.snapshots.instance(input.consentId);

  const frozen = freezeConsentSnapshotDomain({
    existing,
    instanceId: `consent-render-${input.consentId}`,
    consentId: input.consentId,
    templateId: input.templateId,
    renderedText: input.renderedText,
    variables: input.variables,
    submittedAt: input.submittedAt,
  });
  if (!frozen.ok) return fail(frozen.reason);

  await deps.snapshots.insert(frozen.value);

  return {
    ok: true,
    instanceId: frozen.value.instanceId,
    contentHash: frozen.value.contentHash,
    submittedAt: frozen.value.submittedAt,
  };
}

/* ── 三、查询（快照检索，AC2 的证据出口）────────────────────────────── */

/**
 * 查询某份同意书的固化快照。
 * ⚠ 与 F78 `getMaterialRetention` 同一纪律：**不重新渲染**，只读固化后的那份——
 *   否则「事后改参数不追溯」这条会在查询路径上被悄悄破掉。
 */
export async function getConsentSnapshot(
  deps: ConsentRenderDeps,
  consentId: string,
): Promise<ConsentRenderInstance | undefined> {
  return deps.snapshots.instance(consentId);
}

/**
 * 独立验证：给定一份已固化快照与该快照声称的内容，核对哈希是否一致——
 * 检测「快照是否被绕过 `freezeConsentSnapshot` 而直接改写」的反证工具。
 */
export function verifyConsentSnapshotIntegrity(instance: ConsentRenderInstance): boolean {
  return computeConsentContentHash(instance.renderedText, instance.variables) === instance.contentHash;
}
