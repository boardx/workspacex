/**
 * 后台左栏「AI 能力」组 ↔ 契约 `AssetKind` 的**双向**对应（F132 / asset-governance I-2）。
 *
 * ## 为什么这道门控本身就是交付物
 *
 * `domain.md` I-2 要的是**双向集合相等**。单向（「左栏每一项都是合法 `AssetKind`」）
 * 在改这次之前的代码上**就是绿的**——左栏那 4 项确实全是合法资产类型，
 * 而故障恰恰是**缺 2 项**。单向断言对缺项完全无感，所以它挡不住本 UC 的起因。
 * ⇒ 这里给的是双向差集，配 `tests/ui/admin-nav-asset-kinds-bijective.test.tsx` 的反证套件
 * （从任一侧删一个 / 加一个都必须红且**点名**）。形状照 `.harness/scripts/lint-ui-material.mjs`。
 *
 * ⚠ **断言的是性质不是数量**：这里没有、也不许有 `toHaveLength(6)`
 * （coding-standards 修订 E-4 / contract-design 硬规则 7）。长度断言在
 * 「删一个、加一个」时全绿，且会把一次经 ADR 评审的正当新增当成失败。
 *
 * ⚠ **空集会让双向差集平凡为真**（本仓栽过的形状）：任一侧为空一律判失败，见 `diffAssetNav`。
 */
import { AssetKind } from "@repo/contracts/asset-governance";
import { ADMIN_NAV, AI_CAPABILITY_GROUP, type AdminModuleKey } from "@/lib/mock/admin";

/** 契约的六个取值（`z.enum` 的 `options`，不在此处抄第二份）。 */
export type AssetKindCode = (typeof AssetKind.options)[number];

/**
 * `AssetKind` → 左栏项键。**这是本文件唯一的映射事实源。**
 *
 * `Record<AssetKindCode, …>` 是有意的：契约里加一个取值而这里没跟，**typecheck 当场红**，
 * 不必等到运行时。运行时那一层由 `diffAssetNav` 兜底（契约值变了但 `ADMIN_NAV` 没跟）。
 *
 * ⚠ **第五档不选边**：契约码是 `canvas-template`，视图 mock 里是 `canvas`
 * （`CONTRACT_DIVERGENCES.D10`，待人裁）。左栏键取的是**第三个东西**——原型 `AN_META`
 * 的键 `canvasadmin`，它是路由段与 testid 的命名空间，不是资产类型码。
 * 所以本文件**没有**、也不得被解读为对 D10 的裁决。
 */
export const ASSET_KIND_NAV_KEY: Record<AssetKindCode, AdminModuleKey> = {
  agent: "agent",
  skill: "skill",
  model: "model",
  mcp: "mcp",
  "canvas-template": "canvasadmin",
  blueprint: "blueprint",
};

/**
 * 左栏项的稳定 `data-testid` —— **唯一事实源**，`admin-nav.tsx` 从这里取，不再自己拼模板。
 *
 * 为什么写成字面量表而不是 `` `admin-nav-${key}` ``：这些名字是 feature 的 `verification`
 * 与 e2e 直接 grep 的锚点，模板拼接会让「这个名字存在」这件事在仓库里 grep 不到
 * （成例：`lib/ui-state.ts` 的 `RESERVED_STATE_TESTID` 同样是字面量表，
 * 由 `verify-ui-states.sh` 读它）。表与键的一致性由测试机械核对，不靠人眼。
 */
export const ADMIN_NAV_TESTID: Record<AdminModuleKey, string> = {
  overview: "admin-nav-overview",
  agent: "admin-nav-agent",
  skill: "admin-nav-skill",
  model: "admin-nav-model",
  mcp: "admin-nav-mcp",
  canvasadmin: "admin-nav-canvasadmin",
  blueprint: "admin-nav-blueprint",
  members: "admin-nav-members",
  feedback: "admin-nav-feedback",
  "ops-status": "admin-nav-ops-status",
  local: "admin-nav-local",
  platform: "admin-nav-platform",
  "org-members": "admin-nav-org-members",
  "org-invites": "admin-nav-org-invites",
  "org-profile": "admin-nav-org-profile",
  "feedback-drafts": "admin-nav-feedback-drafts",
  inbox: "admin-nav-inbox",
  "design-workbench": "admin-nav-design-workbench",
};

/** 契约六值各自**期望**出现在左栏的项键。 */
export function expectedAssetNavKeys(
  kinds: readonly string[] = AssetKind.options,
  mapping: Record<string, string> = ASSET_KIND_NAV_KEY,
): { kind: string; navKey: string | undefined }[] {
  return kinds.map((kind) => ({ kind, navKey: mapping[kind] }));
}

/** `ADMIN_NAV` 里「AI 能力」组**实际**画出来的项键。 */
export function actualAssetNavKeys(
  nav: { group: string; items: { key: string }[] }[] = ADMIN_NAV,
  group: string = AI_CAPABILITY_GROUP,
): string[] {
  return nav.filter((g) => g.group === group).flatMap((g) => g.items.map((i) => i.key));
}

/**
 * 双向差集。返回**逐条点名**的错误清单；空数组 = 通过。
 *
 * 判定四条（缺任何一条这道门都会漏掉真实故障）：
 *   ① 空集防线：任一侧为空 ⇒ 失败（否则两侧都空时差集为空、断言平凡为真）
 *   ② 契约有映射缺失：某个 `AssetKind` 在映射表里没有左栏键
 *   ③ 正向：某个 `AssetKind` 期望的左栏项**不存在** ⇒ 少画了入口（本次故障的形状）
 *   ④ 反向：某个左栏项**不对应任何** `AssetKind` ⇒ 多画了入口，或契约删了值没跟
 */
export function diffAssetNav({
  actual,
  expected,
}: {
  actual: readonly string[];
  expected: readonly { kind: string; navKey: string | undefined }[];
}): string[] {
  const errors: string[] = [];

  if (expected.length === 0) {
    errors.push(
      "[空集] 期望侧（AssetKind 取值集合）为空 —— 空集会让双向差集平凡为真，一律判失败。",
    );
  }
  if (actual.length === 0) {
    errors.push(
      `[空集] 实际侧（ADMIN_NAV 的「${AI_CAPABILITY_GROUP}」组）为空 —— ` +
        "多半是组名改了而门控还在按旧组名取项。空集不许平凡为真，一律判失败。",
    );
  }
  if (errors.length > 0) return errors;

  const actualSet = new Set(actual);
  const expectedKeys = new Set<string>();

  for (const { kind, navKey } of expected) {
    if (!navKey) {
      errors.push(
        `[缺映射] 契约 AssetKind「${kind}」在 ASSET_KIND_NAV_KEY 里没有对应的左栏项键 —— ` +
          "契约加了取值而左栏没跟。",
      );
      continue;
    }
    expectedKeys.add(navKey);
    if (!actualSet.has(navKey)) {
      errors.push(
        `[缺项] 契约 AssetKind「${kind}」应在左栏「${AI_CAPABILITY_GROUP}」组里有项 ` +
          `「${navKey}」（data-testid: admin-nav-${navKey}），实际不存在 —— 少画了一个入口。`,
      );
    }
  }

  for (const key of actual) {
    if (!expectedKeys.has(key)) {
      errors.push(
        `[多项] 左栏「${AI_CAPABILITY_GROUP}」组里的项「${key}」不对应任何 AssetKind —— ` +
          "要么它不该放在这一组，要么契约漏了这个取值。",
      );
    }
  }

  return errors;
}
