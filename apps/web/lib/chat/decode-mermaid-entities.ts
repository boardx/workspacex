/**
 * VZ-fabric 保存边界的 HTML entity 解转义（main agent 决定 ④，2026-08-12）。
 *
 * 背景：`@repo/fabric-markdown` 的 `canvasToMarkdown` 序列化节点标签时把 `<`/`>`/`&`/`"` 做了
 * HTML 转义——mermaid 节点 `D1{"< 18 个月?"}` 往返画布后变成 `D1{"&lt; 18 个月?"}`。落盘再喂
 * mermaid 会显示字面 `&lt;` 或语法漂移。这是 fabric-markdown 包的既有行为，改包会牵动其他 canvas
 * 消费者，故**修在 chat 保存边界**：保存前对将落盘的 mermaid 源解一次转义。
 *
 * 只解 mermaid 源里会被上述序列化引入的 5 个具名实体。`&amp;` **必须最后**解，否则
 * `&amp;lt;` 会在一趟里先被拆成 `&lt;` 再被解成 `<`（双重解码）。不解数字实体（序列化器不产）。
 */
const NAMED_ENTITIES: readonly [RegExp, string][] = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&apos;/g, "'"],
  [/&amp;/g, "&"], // 必须最后
];

export function decodeMermaidEntities(source: string): string {
  let out = source;
  for (const [re, ch] of NAMED_ENTITIES) out = out.replace(re, ch);
  return out;
}
