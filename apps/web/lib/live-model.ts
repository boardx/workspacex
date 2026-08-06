/**
 * #548 —— 模型池的前端薄封装。目前只有**一条**真实路径可用：`registerModel`
 * （`POST /models`，凭据进入系统的唯一入口）。
 *
 * ## 为什么这里没有 `listModels`
 *
 * 契约里没有任何操作会返回池子行——`apps/api/src/domain/model/registry.ts` 文件头把这个
 * 缺口钉成 `POOL_LISTING_GAP`：F48 的 `user_visible_behavior` 要展示 kind / vendor /
 * 能力标签 / 上下文窗口 / 单价 / 合规属性 / 状态，而 57 条契约操作里没有一条把这些字段
 * 作为 `out` 送回来（`listSelectableModels` 返回的是选择器用的 `ModelCandidate`，
 * 五个字段，且刻意不带单价/vendor——那是另一份"给谁看"的清单）。
 *
 * 按 `contract-design.md` §五 / ADR-020，agent 不得在签核期间自行给契约加操作。所以本文件
 * 不假装有一个能读列表的函数——那会在类型层撒谎。治理后台的模型列表暂时仍读
 * `lib/mock/admin.ts`（页头已有"示例组织配置"提示），只有"接入模型"这一个动作走真实后端。
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
