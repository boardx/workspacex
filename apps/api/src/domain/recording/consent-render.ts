/**
 * F79 — 同意书文案动态渲染 + 已提交渲染快照不可回溯改写（uc-5-4 R3-3 / AC2 / I-38 / I-39）。
 *
 * ## 这个文件存在的唯一理由：**渲染变量只有一个来源，且冻结之后谁都改不了**
 *
 * uc-5-4 R8「保留期的三处呈现必须同源」：研究计划参数面板、材料库「保留至…」、受访者授权页
 * 三处必须读同一个 `材料保留期` 解析结果。本文件的 `retentionDays` 因此**从不自己算**——
 * 它由调用方（应用层）传入 F78 `resolveRetention` 的输出，本文件只做「全不全、渲不渲得出来」。
 *
 * I-39 / E6：四个模板变量（材料保留期 / 数据控制方 / 联系人 / 合规邮箱）任一缺失，
 * **不得发出授权链接**——这里落实为 `CONSENT_TEMPLATE_VARIABLE_MISSING`，发链接前必须先过这一关。
 *
 * I-38：已提交的同意书渲染快照的 `contentHash` **永不改变**。本文件的 `freezeExpiry` 类比
 * 是「固化只做一次」——第二次固化视为「试图回溯改写」，一律 `CONSENT_SNAPSHOT_IMMUTABLE`，
 * 不比较内容是否相同（同 F78 `EXPIRY_ALREADY_FROZEN` 的纪律：已固化就是已固化）。
 *
 * ⚠ 本文件属于 F78 静态检查（`tests/rec/retention-param-resolution-no-hardcode.test.ts`）
 *   扫描的 `src/domain/recording` 目录，天数黑名单同样适用——这里没有任何天数字面量。
 */
import { createHash } from "node:crypto";
import { recording as C } from "@repo/contracts";
import type { z } from "zod";

export type RecordingErrorCode = z.infer<typeof C.RecordingError>;

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: RecordingErrorCode };

const fail = (reason: RecordingErrorCode): DomainResult<never> => ({ ok: false, reason });

/**
 * 渲染变量的契约形状——**引用契约里 `renderConsentText.out.variables` 的子 schema，
 * 不在本文件另写一遍**（避免本仓已漂移五次的「同一事实两处声明」）。
 */
const ConsentVariablesSchema = C.operations.renderConsentText.out.shape.variables;
export type ConsentTemplateVariables = z.infer<typeof ConsentVariablesSchema>;

/**
 * 渲染前的原始输入：**每个字段都可以是 `null`**——这正是「缺失」的表达方式。
 * `retentionDays` 来自 F78 `resolveRetention` 的结果，不是本模块解析的。
 */
export interface ConsentVariableInputs {
  readonly retentionDays: number | null;
  readonly dataController: string | null;
  readonly contactName: string | null;
  readonly complianceEmail: string | null;
}

/**
 * 校验四个渲染变量全部到位。任一缺失（`null` 或空字符串）⇒ `CONSENT_TEMPLATE_VARIABLE_MISSING`。
 * ⚠ 这里**不重算** `retentionDays`：它是否合法由 F78 的 `RetentionResolution` schema 负责，
 *   本函数只再确认一次契约形状（正整数）不被破坏，不重写解析逻辑。
 */
export function resolveConsentVariables(
  input: ConsentVariableInputs,
): DomainResult<ConsentTemplateVariables> {
  if (
    input.retentionDays === null ||
    input.dataController === null ||
    input.dataController.trim() === "" ||
    input.contactName === null ||
    input.contactName.trim() === "" ||
    input.complianceEmail === null ||
    input.complianceEmail.trim() === ""
  ) {
    return fail("CONSENT_TEMPLATE_VARIABLE_MISSING");
  }

  const candidate = {
    retentionDays: input.retentionDays,
    dataController: input.dataController,
    contactName: input.contactName,
    complianceEmail: input.complianceEmail,
  };

  const parsed = ConsentVariablesSchema.safeParse(candidate);
  if (!parsed.success) return fail("CONSENT_TEMPLATE_VARIABLE_MISSING");

  return { ok: true, value: candidate };
}

/**
 * 模板占位符 token。渲染是纯字符串替换——本函数不产生、不校验任何数字，
 * 天数已经在 `resolveConsentVariables` 那一步校验完毕。
 */
const PLACEHOLDER_TOKEN: Record<keyof ConsentTemplateVariables, string> = {
  retentionDays: "{{retentionDays}}",
  dataController: "{{dataController}}",
  contactName: "{{contactName}}",
  complianceEmail: "{{complianceEmail}}",
};

/** 用解析到的变量渲染模板文案。缺失变量已在上一步拦截，这里假定输入齐全。 */
export function renderConsentTemplate(
  templateText: string,
  variables: ConsentTemplateVariables,
): string {
  let rendered = templateText;
  for (const key of Object.keys(PLACEHOLDER_TOKEN) as (keyof ConsentTemplateVariables)[]) {
    rendered = rendered.split(PLACEHOLDER_TOKEN[key]).join(String(variables[key]));
  }
  return rendered;
}

/**
 * 一份已提交同意书的渲染快照——「当时告知了什么」的证据。
 * ⚠ 落库之后**任何字段都不再变化**（I-38）；变了就不是同一个 `instanceId` 能表达的东西。
 */
export type ConsentRenderInstance = Readonly<{
  instanceId: string;
  consentId: string;
  templateId: string;
  variables: ConsentTemplateVariables;
  renderedText: string;
  contentHash: string;
  submittedAt: string;
}>;

/**
 * 渲染实例的内容哈希——用来核对「快照有没有被悄悄改过」，不是加密用途。
 * 覆盖 `renderedText` 与 `variables` 两者，任一变化哈希都会变。
 */
export function computeConsentContentHash(
  renderedText: string,
  variables: ConsentTemplateVariables,
): string {
  const hash = createHash("sha256");
  hash.update(renderedText);
  hash.update(JSON.stringify(variables));
  return hash.digest("hex");
}

/**
 * 固化同意书渲染快照。
 * ⚠ **固化是一次性的**——`existing !== undefined` 就意味着「已经固化过」，
 *   第二次调用一律 `CONSENT_SNAPSHOT_IMMUTABLE`，不比较内容是否相同：
 *   受访者当时看到的那份字，事后任何人都不能改，包括「把数字改成新值」这种善意修正。
 */
export function freezeConsentSnapshot(input: {
  readonly existing: ConsentRenderInstance | undefined;
  readonly instanceId: string;
  readonly consentId: string;
  readonly templateId: string;
  readonly renderedText: string;
  readonly variables: ConsentTemplateVariables;
  readonly submittedAt: string;
}): DomainResult<ConsentRenderInstance> {
  if (input.existing !== undefined) return fail("CONSENT_SNAPSHOT_IMMUTABLE");

  const contentHash = computeConsentContentHash(input.renderedText, input.variables);

  return {
    ok: true,
    value: {
      instanceId: input.instanceId,
      consentId: input.consentId,
      templateId: input.templateId,
      variables: input.variables,
      renderedText: input.renderedText,
      contentHash,
      submittedAt: input.submittedAt,
    },
  };
}
