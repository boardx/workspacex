/**
 * 解析蓝本「流程 Agenda」设计面（`flow-agenda` facet）的逐环节时长
 * （F23 补实现 / issue #1667 / 人类裁决：P10「逐段时长无出处」已随 F202 落地过期）。
 *
 * ## 为什么现在有出处了
 *
 * `apps/web/components/tpl-designer/agenda-panel-editor.tsx`（F202）把 `flow-agenda`
 * 这一项从自由文本换成结构化表单，真实写入 `content: string` 装的 JSON
 * `{ segments: [{ no, title, min, boardSkill, optional }] }`（`serializeAgendaContent`）。
 * 本文件是该 JSON 在仓储侧**唯一**的解析点——不重复定义一遍字段形状（同
 * `design-facet-table.ts` 头注「同一事实不得声明在两处」的纪律）。
 *
 * ## 「未填 = 空」，不编造默认值
 *
 * `agenda-panel-editor.tsx` 的 `parseAgendaContent` 在**编辑态**给 `min` 一个 30 的兜底——
 * 那是给用户一个可改的起点。本文件是**读态**：facet 内容为空串 / 解析失败 / 某一行 `min`
 * 不是正数，均如实返回该行时长 `null`（未填），不套用编辑态的兜底值——编辑态默认值解决的是
 * "用户还没打字时表单显示什么"，读态没有内容就是没有内容，这是两件不同的事。
 *
 * ⚠ JSON 解析失败（脏数据/旧格式）整体返回 `[]`（等同"未填"），不向上抛——
 * 一条 facet 的解析失败不该打崩 `applyBlueprint` 的整个初始化事务（同
 * `agenda-panel-editor.tsx` 自己的 try/catch 容错）。
 */

export interface FlowAgendaSegmentDraftLike {
  readonly no?: unknown;
  readonly title?: unknown;
  readonly min?: unknown;
  readonly boardSkill?: unknown;
  readonly optional?: unknown;
}

/**
 * 按位置（数组下标）返回每一行的时长（分钟）。`null` = 该位置未填 / 无法解析。
 * ⚠ 返回数组长度 = facet 里实际记录的环节数，可能与结构性档位表的环节数不同——
 *   调用方按下标对齐，取不到的下标（数组更短）同样视为 `null`。
 */
export function parseFlowAgendaDurations(content: string | null | undefined): readonly (number | null)[] {
  if (content === null || content === undefined || content.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return [];
    const segments = (parsed as { segments?: unknown }).segments;
    if (!Array.isArray(segments)) return [];
    return segments.map((raw: unknown) => {
      const s = raw as FlowAgendaSegmentDraftLike | null;
      const min = s?.min;
      return typeof min === "number" && Number.isFinite(min) && min > 0 ? min : null;
    });
  } catch {
    return [];
  }
}
