/**
 * **方法晋升生成 skill —— phase-1 接收端**（F67；`contracts/skills/domain.md`
 * `PromotionLink`、I-22；UC-3.5 R3 步骤 4、R7、R10 处置②）。
 *
 * 本文件只做**接收端**三件事（14-brain 的晋升队列与知识五态机在 phase-3，
 * 见 domain.md「这个域不负责什么」与 `usecases.md` `UC-P1` 头部注释「触发端在
 * 14-brain / phase-3」）：
 *   ① `PromotionLink` 值对象 —— 方法 ↔ skill 的双向关联（I-22）
 *   ② 方法 → 声明式契约的转写：**留空标待补，不臆造**；数据范围**默认最小必要**
 *   ③ 源知识状态变化 → skill 侧效果的纯函数映射（E5/E6/E7）
 *
 * ⚠ **严格准入（D-32）本身的判定**——「是否真的支撑过一个已签字的决策」「复盘是否判对」——
 *   不在本文件：那是晋升队列侧（14-brain）的职责。本域只检查**这两个 id 是否存在**
 *   （`checkPromotionAdmission`），即「调用方是否声称满足了准入」，不是重新验证准入本身。
 *   这与 `data-scope.ts` 头部「鉴权判定本身属别的束，本域只做拒绝理由」是同一种分寸。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";
import type { DeclarativeContract } from "./declarative-contract";

/**
 * `PromotionLink`（domain.md）：`{ skillId, knowledgeItemId, signedDecisionId, reviewConclusionId }`
 * 加上批准前三项必填（适用范围 / 有效期 / 复核负责人）——它们同样需要双向可查
 * （R8「来自组织大脑」区块要展示这五项）。
 *
 * ⚠ **1:1**：domain.md D-k「一条方法知识能否生成多条 skill」尚未裁决，本文件按
 * 1:1 建模（`loadByKnowledgeItemId` 返回单条而非数组）；D-k 落定前不臆造 1:N 的形状。
 */
export interface PromotionLink {
  readonly skillId: string;
  readonly knowledgeItemId: string;
  readonly signedDecisionId: string;
  readonly reviewConclusionId: string;
  readonly applicableScope: string;
  readonly validUntil: string;
  readonly reviewOwnerId: string;
}

/** I-22：双向可达的判据——非 null 且能追回一个非空的签字决策。 */
export function hasBidirectionalLink(link: PromotionLink | null): link is PromotionLink {
  return link !== null && link.signedDecisionId.trim().length > 0;
}

/* ─────────────────────── 严格准入（D-32）的存在性检查 ─────────────────────── */

export interface PromotionAdmissionInput {
  readonly signedDecisionId: string;
  readonly reviewConclusionId: string;
}

export interface PromotionAdmissionResult {
  readonly ok: boolean;
  /** 缺哪一条，**逐条**——界面要「明确指出缺哪一条」（V3） */
  readonly missing: readonly string[];
}

/** D-32：支撑过一个已签字的决策 ＋ 复盘中被验证，两项**存在性**检查。 */
export function checkPromotionAdmission(input: PromotionAdmissionInput): PromotionAdmissionResult {
  const missing: string[] = [];
  if (input.signedDecisionId.trim().length === 0) missing.push("支撑过的已签字决策");
  if (input.reviewConclusionId.trim().length === 0) missing.push("复盘结论");
  return { ok: missing.length === 0, missing };
}

/* ─────────────────────── 批准前三项必填（V4） ─────────────────────── */

export interface PromotionRequiredFieldsInput {
  readonly applicableScope: string;
  readonly validUntil: string;
  readonly reviewOwnerId: string;
}

export interface PromotionRequiredFieldsResult {
  readonly ok: boolean;
  readonly missing: readonly string[];
}

/** 缺任一项都无法进入生效状态，**skill 生成一并阻断**（E3）。 */
export function checkPromotionRequiredFields(
  input: PromotionRequiredFieldsInput,
): PromotionRequiredFieldsResult {
  const missing: string[] = [];
  if (input.applicableScope.trim().length === 0) missing.push("适用范围");
  if (input.validUntil.trim().length === 0) missing.push("有效期");
  if (input.reviewOwnerId.trim().length === 0) missing.push("复核负责人");
  return { ok: missing.length === 0, missing };
}

/* ─────────────────────── 转写：留空标待补，不臆造 ─────────────────────── */

/** 占位符本身说明「这是待补，不是真实内容」——不是一份看起来合理的假 schema。 */
export const TRANSCRIPTION_INCOMPLETE_PLACEHOLDER =
  "【待补：转写不完整，需人工补全；系统不臆造 schema/提示词内容】";

export interface TranscriptionResult {
  readonly contract: DeclarativeContract;
  /** 哪些字段是靠占位符补的——**不是**「哪些字段是空的」，两者在界面上必须显示成不同的东西。 */
  readonly incompleteFields: readonly (keyof DeclarativeContract)[];
}

const TRANSCRIBED_TEXT_FIELDS = [
  "promptTemplate",
  "inputSchema",
  "outputSchema",
  "fallbackDeclaration",
] as const satisfies readonly (keyof DeclarativeContract)[];

/**
 * 方法 → 声明式契约三件套的转写。
 *
 * ⚠ **数据范围默认最小必要**：`draft.dataScope` 未提供时结果为**空数组**，
 *   不是「提名人的全部权限」——本函数签名里根本没有一个「提名人权限全集」的入参可继承，
 *   这条纪律因此是**结构性**的，不是运行时判断出来的（同 `data-scope.ts` 头部的写法）。
 * ⚠ `readsRawTranscript` 未声明时默认 `false`：不完整的转写不能默认授予更高权限。
 */
export function transcribeToDeclarativeContract(
  draft: Partial<DeclarativeContract>,
): TranscriptionResult {
  const incompleteFields: (keyof DeclarativeContract)[] = [];

  const textFields = {} as Record<(typeof TRANSCRIBED_TEXT_FIELDS)[number], string>;
  for (const f of TRANSCRIBED_TEXT_FIELDS) {
    const v = draft[f];
    if (typeof v === "string" && v.trim().length > 0) {
      textFields[f] = v;
    } else {
      incompleteFields.push(f);
      textFields[f] = TRANSCRIPTION_INCOMPLETE_PLACEHOLDER;
    }
  }

  const contract: DeclarativeContract = {
    promptTemplate: textFields.promptTemplate,
    inputSchema: textFields.inputSchema,
    outputSchema: textFields.outputSchema,
    fallbackDeclaration: textFields.fallbackDeclaration,
    dataScope: draft.dataScope ?? [],
    readsRawTranscript: draft.readsRawTranscript ?? false,
  };

  return { contract, incompleteFields };
}

/* ─────────────────────── 源知识状态联动（E5/E6/E7） ─────────────────────── */

/** 从契约派生，**不重写**（ADR-020）。 */
export type SourceKnowledgeState = z.infer<typeof skills.SourceKnowledgeState>;
export type KnowledgeChangeEffect = z.infer<typeof skills.KnowledgeChangeEffect>;

/**
 * 纯函数映射，**不是三个调用方各写一份 if**：
 *   · `待复核` → `annotate`（标注「源方法已过期」，**不自动停用**——D-j 待人类裁决，
 *     本文按 `usecases.md`「标注不停用」落地）
 *   · `被推翻` / `被撤销` → `disable`（自动转已停用，**不硬删**，进行中项目不受影响）
 *   · `被替代` → `new-version`（发新版、旧版归档，已建实例锁旧版）
 */
export function effectForSourceKnowledgeState(state: SourceKnowledgeState): KnowledgeChangeEffect {
  if (state === "待复核") return "annotate";
  if (state === "被替代") return "new-version";
  return "disable"; // 被推翻 / 被撤销
}
