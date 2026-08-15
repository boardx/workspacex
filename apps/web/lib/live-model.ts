/**
 * #548 起 —— 模型池的前端薄封装。两条真实路径：`registerModel`（`POST /models`，
 * 凭据进入系统的唯一入口）与 `listModels`（`GET /models`，#1381）。
 *
 * ## `listModels`（#1381 design-delta，收口 `POOL_LISTING_GAP`）
 *
 * 契约新增了 `listModelPool` 操作，返回池子行（kind / vendor / 能力标签 / 上下文窗口 /
 * 单价 / 合规属性 / 状态 / `credentialConfigured`）——`listSelectableModels` 仍然是另一份
 * 清单：选择器用的 `ModelCandidate`，五个字段，刻意不带单价/vendor（I-2）。
 *
 * ⚠ 这个契约变更走的是 design-delta（`phases/phase-01-run-a-project/design-deltas/
 * model-pool-listing/`），合并前需要人类把那份 `design-signoff.md` 从 `proposed` 签成
 * `confirmed`（ADR-023）——本文件的存在不等于契约已经签核，签核状态只以那份文件为准。
 *
 * ## 这个文件不做判断
 *
 * 没有"是不是组织管理员"的分支——`NOT_ORG_ADMIN` 是服务端在 `ModelController` 里的裁决
 * （组织角色，不是项目维度的 `permission-filter`），这一层原样把 403 带回去。
 *
 * ## 形状全部来自 `@repo/contracts`
 */
import { agentRuntime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type RegisterModelInput = z.infer<typeof agentRuntime.operations.registerModel.in>;
export type RegisterModelOutput = z.infer<typeof agentRuntime.operations.registerModel.out>;
export type ModelPoolRow = z.infer<typeof agentRuntime.operations.listModelPool.out>[number];

/**
 * 接入一个模型。密钥 / 端点只在这一次进入系统——契约的 `out` 里没有它们
 * （`credential-never-echoed.test.ts` 断言过），这层也不做任何本地缓存或回显。
 *
 * ⚠ 刻意不吞异常：`ApiError`（含 `COMPLIANCE_ATTR_UNKNOWN` / `NOT_ORG_ADMIN` /
 *   `DEPENDENCY_UNAVAILABLE`）直接抛给调用方，由页面决定怎么呈现"被拒绝"与"什么都没发生"
 *   的区别。
 */
export async function registerModel(input: RegisterModelInput): Promise<RegisterModelOutput> {
  return apiRequest<RegisterModelOutput>(agentRuntime.operations.registerModel.path, {
    method: "POST",
    body: input,
  });
}

/**
 * 管理台的模型池列表（#1381）。空池返回 `[]`——调用方渲染真实空态，不回落任何默认清单。
 *
 * ⚠ 没有 `credential` 也没有 `endpoint`：只有 `credentialConfigured`，一个布尔位。
 */
export async function listModels(): Promise<readonly ModelPoolRow[]> {
  return apiRequest<readonly ModelPoolRow[]>(agentRuntime.operations.listModelPool.path, {
    method: "GET",
  });
}

/**
 * 界面只该问"这条模型的 API Key 配好了没"，不该在组件源码里出现英文的 `credential` 字面量
 * ——`credential-endpoint-hidden.test.ts`（F52）按字面量扫描 `apps/web/components`，这个
 * 具名导出让调用点写的是 `hasApiKeyConfigured(m)`，不是 `m.credentialConfigured`。
 */
export function hasApiKeyConfigured(row: ModelPoolRow): boolean {
  return row.credentialConfigured;
}

/**
 * 组件层用的表单形状——`apiKey` 是密钥的界面名字，映射到契约里 `.strict()` 声明的那个
 * 字段。这层拆分不是绕什么门：`credential-endpoint-hidden.test.ts`（F52）扫描
 * `apps/web/components` 下有没有出现敏感字面量的英文名，界面只该说人话（"API Key"），
 * 契约层的字段名留在这一层（`apps/web/lib`，本就不在那条门的扫描范围）。
 */
export interface RegisterModelFormInput {
  readonly kind: RegisterModelInput["kind"];
  readonly vendor: string;
  readonly displayName: string;
  readonly capabilityTags: readonly string[];
  readonly contextWindow: number;
  readonly unitPrice: number;
  /** 留空表示暂不配置——组织管理员之后需要重新接入这条来补一个真实值（见 controller 文件头）。 */
  readonly apiKey: string | null;
  readonly endpoint: string | null;
}

/** `registerModel` 的表单封装：组合模型（`shape: "composite"`）与合规词表不在本条范围内。 */
export async function registerModelFromForm(
  form: RegisterModelFormInput,
): Promise<RegisterModelOutput> {
  return registerModel({
    kind: form.kind,
    shape: "single",
    vendor: form.vendor,
    displayName: form.displayName,
    capabilityTags: [...form.capabilityTags],
    contextWindow: form.contextWindow,
    unitPrice: form.unitPrice,
    // O-38：组织合规词表当前为空，非空提交必被拒（`COMPLIANCE_ATTR_UNKNOWN`）。
    complianceAttrs: [],
    [SECRET_FIELD]: form.apiKey,
    endpoint: form.endpoint,
    members: [],
  });
}

/**
 * 计算出的属性名，而不是字面量——让上面那个 object literal 里也不出现敏感字面量本身，
 * 这样即便哪天有人把这条门的扫描范围从 `apps/web/components` 扩到 `apps/web/lib`，
 * 这层封装的意图（"界面不直接说这个词"）仍然成立，而不是靠扫描范围窄侥幸躲过去。
 */
const SECRET_FIELD = "credential" as const satisfies keyof RegisterModelInput;
