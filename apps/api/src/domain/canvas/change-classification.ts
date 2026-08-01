/**
 * F105 — `classifyChange` 判定表（O-32 / I-15）。
 *
 * ⚠ **这是全函数**：`ChangeDescriptor.kind` 覆盖到的每一种改动都必须落进
 * `sticky-level` 或 `structural` 恰好一支，不允许 `undefined` / 抛异常
 * （见 `packages/contracts/src/canvas.ts` 里 `classifyChange` 的 err 列表故意不含
 * "unclassifiable" 这一支）。判定**只在服务端发生**——前端不得自行归类，
 * 这条同样写在契约注释里，本文件是它唯一的实现。
 *
 * ⚠ **归属分区变更（跨区移动）归便签级**（O-32 裁决）。早期稿本把"结构变化"理解成
 * "任何改变了画布骨架的动作"，把便签换区也算了进去；O-32 按"改动作用的对象"
 * 重新裁定：换区动的是一张便签的 `sectionId` 字段，作用对象仍是便签本身，
 * 分区框（`## 段落`）没有被增删或重命名——所以它是 sticky-level，不弹冲突条，
 * 走 LWW（`applyStickyChange` 的 `patch.sectionId`）。
 *
 * 判定表七行（domain.md I-15）：
 *   1. 便签文本改动           → sticky-level
 *   2. 便签颜色改动           → sticky-level
 *   3. 便签位置改动           → sticky-level
 *   4. 便签归属分区改动（跨区移动） → sticky-level（O-32，见上）
 *   5. 分区（## 段落）增删/改名   → structural
 *   6. 节点/连线的新增删除（画布骨架层，非便签）→ structural
 *   7. 模板版本 / 图类型切换      → structural
 */

/** `ChangeDescriptor.kind` 的封闭取值——判定表七行各对应一个 kind。 */
export const CHANGE_KINDS = [
  "sticky-text",
  "sticky-color",
  "sticky-position",
  "sticky-section-move",
  "section-add-remove-rename",
  "node-or-edge-structural",
  "template-version-or-diagram-type",
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

export type ChangeClassification = "sticky-level" | "structural";

/** 判定表本表——七行穷举，逐行可读，不用推导式压缩成一条正则/前缀判断。 */
const CLASSIFICATION_TABLE: Readonly<Record<ChangeKind, ChangeClassification>> = {
  "sticky-text": "sticky-level",
  "sticky-color": "sticky-level",
  "sticky-position": "sticky-level",
  // O-32：跨区移动动的是便签的 sectionId 字段，作用对象是便签本身，不是分区框。
  "sticky-section-move": "sticky-level",
  "section-add-remove-rename": "structural",
  "node-or-edge-structural": "structural",
  "template-version-or-diagram-type": "structural",
};

export type ClassifyChangeResult =
  | { readonly ok: true; readonly classification: ChangeClassification }
  | { readonly ok: false; readonly reason: "INSTANCE_NOT_FOUND" };

/**
 * `classifyChange` 的纯判定部分。调用方（application 层）负责先确认
 * `instanceId` 存在——`instanceExists` 由调用方注入，本函数不做任何 I/O。
 *
 * ⚠ **全函数**：`kind` 落在 `CHANGE_KINDS` 之外时也必须返回，不允许抛异常——
 * 契约层 `ChangeDescriptor.kind` 是开放字符串（`KNOWN_CONTRACT_GAPS.C_CANVAS_6`
 * 如实登记了这一点：全函数性只能由 domain 层 + 应用层穷举保证，契约给不出机械门控）。
 * 本函数对未知 kind 的处理是**保守地归入 structural**——不认识的改动类型
 * 宁可多弹一次冲突条走人工裁决，也不能悄悄当成 sticky-level 免检直接同步。
 */
export function classifyChange(params: {
  readonly instanceExists: boolean;
  readonly kind: string;
}): ClassifyChangeResult {
  if (!params.instanceExists) return { ok: false, reason: "INSTANCE_NOT_FOUND" };
  const known = CLASSIFICATION_TABLE[params.kind as ChangeKind];
  return { ok: true, classification: known ?? "structural" };
}

/** 供测试穷举用：判定表的全部行，作为只读数组导出，防止表被悄悄删行而没人发现。 */
export const CLASSIFICATION_TABLE_ENTRIES: ReadonlyArray<
  readonly [ChangeKind, ChangeClassification]
> = CHANGE_KINDS.map((k) => [k, CLASSIFICATION_TABLE[k]] as const);
