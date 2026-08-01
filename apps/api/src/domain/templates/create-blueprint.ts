/**
 * 新建蓝本**三入口**（F22 / A0，契约 `templates.createBlueprint`）。
 *
 * 三入口共用同一份 out 形状（`unmappedDesignFacetKeys` + `machineGenerated`），
 * 但语义刻意不同：
 * · **空白**——没有「映射」这回事，`unmappedDesignFacetKeys` 恒空。
 * · **套用已有**——把源蓝本已填的内容整份搬过来；源本身缺的槽位在新蓝本里
 *   仍然缺，但那是「没填」不是「映射不上」，所以同样不计入 `unmappedDesignFacetKeys`——
 *   这个字段只用来表达 `reverse-from-project` 的映射缺口（V13），不是「完成度缺口」的第二个名字。
 * · **反向生成**——把源项目里能对上号的设计配置项映射过来；对不上号的**留空
 *   并计入 `unmappedDesignFacetKeys`**（V13：告警不是失败，蓝本仍然要建出来）。
 *   `machineGenerated` 在这条入口下恒 `true`——AI/机器产出必须被标识（R7 通用条）。
 *
 * ⚠ 「源项目里哪些字段能映射到哪个 designFacetKey」是**调用方**（未来的
 * `templates` 控制器 + 一个尚未建的项目侧读取端口）的活：本文件不读任何存储，
 * 只接受一份已经算好「映射到了哪个 key」的 `ReadonlyMap`，然后把**表里其余没被
 * 提到的 key**算成未映射——这与 `previewParticipantView.ts` 头注的立场一致：
 * 洋葱层不偷偷发明数据源，读不到就诚实记成留空，不猜。
 */

import { DESIGN_FACET_DEFINITIONS, designFacetKeys, type DesignFacetRow } from "./design-facet-table";

export interface BlueprintCreationPlan {
  /** 冻结快照的雏形：{ designFacetKey: 已填的值 }。缺失的 key 表示「这一项还没有值」 */
  readonly content: Readonly<Record<string, string>>;
  /** 仅 `reverse-from-project` 入口非空——见文件头三条语义的区分 */
  readonly unmappedDesignFacetKeys: readonly string[];
  /** 恒等于「这条入口是不是 reverse-from-project」——不是各入口各判一次 */
  readonly machineGenerated: boolean;
}

/** 空白入口：全部设计配置项都是空槽位，没有「映射」这回事。 */
export function planBlankBlueprint(): BlueprintCreationPlan {
  return { content: {}, unmappedDesignFacetKeys: [], machineGenerated: false };
}

/** 套用已有入口：整份拷贝源蓝本已填内容（源缺的槽位新蓝本同样缺，非「未映射」）。 */
export function planCopyBlueprint(
  sourceContent: Readonly<Record<string, string>>,
): BlueprintCreationPlan {
  return { content: { ...sourceContent }, unmappedDesignFacetKeys: [], machineGenerated: false };
}

/**
 * 反向生成入口：`mappedFacets` 是调用方已经从源项目算出的「designFacetKey → 值」；
 * 表里没被这份 map 提到的 key 一律进 `unmappedDesignFacetKeys`（V13）。
 */
export function planReverseFromProject(
  mappedFacets: ReadonlyMap<string, string>,
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): BlueprintCreationPlan {
  const content: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const key of designFacetKeys(table)) {
    const value = mappedFacets.get(key);
    if (value === undefined) {
      unmapped.push(key);
    } else {
      content[key] = value;
    }
  }
  return { content, unmappedDesignFacetKeys: unmapped, machineGenerated: true };
}
