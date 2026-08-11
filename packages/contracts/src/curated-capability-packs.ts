/**
 * 契约束 `curated-capability-packs` 的第 ③ 件（ADR-023 形态 A）。
 *
 * 本束**不新增或修改任何 schema**（design-signoff.md ③ 逐条确认：请求仍只有
 * `packId`/`packVersion`/`idempotencyKey`，成功体仍是 `SkillStarterImportResult`，
 * 失败仍是既有五码）。唯一 API 事实源是 `wave2-runtime.ts` 的
 * `wave2Runtime.operations.importSkillStarterPack`。
 *
 * 本文件是**命名指针**（re-export 同一批对象），不是第二份声明——要改 schema
 * 只能改 `wave2-runtime.ts`，这里永远不允许出现独立的 z.object。
 */
export {
  SkillStarterPackFile,
  SkillStarterPackEntry,
  UnsignedSkillStarterPack,
  SkillStarterPack,
  SkillStarterImportError,
  SkillStarterImportResult,
} from "./wave2-runtime";
