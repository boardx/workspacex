/**
 * `validateRootFrontmatter` —— 实现已迁到 `@repo/contracts/asset-governance`（#1884）。
 *
 * 迁移原因：Monaco 编辑器的内联校验（`apps/web`）需要在编辑期对着**同一套**根文件
 * frontmatter 规则标红，而不是重新发明一份可能漂移的第二套——本仓已经因「同一事实
 * 两处声明」栽过五次（设计 token / 字号档位 / 丢弃原因枚举 / 撤回链 SLA / 估点），
 * 不应有第六次。`assetFileBadgeFromPath` 早先就是同样的理由放进 `@repo/contracts`
 * （见该文件同款注释），此文件只是同一模式的第二个实例。
 *
 * 这个文件保留为**薄 re-export**，只是为了不动 `write-asset-file.ts` 现有的
 * `../../domain/asset/asset-root-frontmatter` 导入路径——真正的实现、类型定义与
 * 完整头注释见 `packages/contracts/src/asset-governance.ts`。
 */
export {
  isRootFrontmatterAssetKind,
  validateRootFrontmatter,
  type FrontmatterIssue,
  type RootFrontmatterAssetKind,
} from "@repo/contracts/asset-governance";
