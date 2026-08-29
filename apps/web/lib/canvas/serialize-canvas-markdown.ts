/**
 * `canvasToMarkdown`（`@repo/fabric-markdown` 的公开导出）的正确替身——只在
 * fabric 画布可编辑时（`CanvasStage` 的写路径）用得到，只读预览走不到这里。
 *
 * ## 为什么需要一个替身，而不是直接用上游那个函数
 *
 * 上游 `canvasToMarkdown`（`packages/fabric-markdown/src/index.ts`）对
 * `kind: 'template'` 的模型判 `lang` 判对了（`template` → `canvas`/`persona`），
 * 但序列化 `code` 恒用 `modelToMermaid(model)`——那是给 flowchart/类图等「图」用的
 * 序列化器，不认 `role: 'section' | 'sticky' | 'field'` 这套模板节点结构，喂给它
 * 的画布模板编辑结果会被强行按 mermaid 语法拼、产出不是「模板: key\n## 分区\n- 便签」
 * 而是乱码。这是 fabric-markdown 包自身的缺口，不是本文件要修的逻辑——2026-08-19
 * 之前从没有调用点让 `CanvasStage` 在**可编辑**模式下加载过模板围栏（`ChatCanvasFabric`
 * 只读预览、`chat-diagram-fabric` 只处理 mermaid），所以这条分支从未被真正踩到过。
 *
 * ## vendor 纪律：不改 `packages/fabric-markdown/src/**` 一个字
 *
 * 见其 `VENDOR.md`。因此这里不是「修 bug」，是用它的公开导出
 * （`extractModel`/`serializeTemplate`/`modelToMermaid`/`serializeUsecase`/
 * `extractMermaidBlocks`/`replaceMermaidBlock`/`wrapAsMermaidBlock`）在包外重新拼一份
 * **正确版本**——`auto-template-layout.ts` 已经是这个模式的先例（组织自建模板的坐标生成
 * 也是包外拼出来的）。对 mermaid / usecase 模型，这里的行为与上游 `canvasToMarkdown`
 * 逐字节相同（同样的分支结构、同样的替换/追加逻辑），只修了 `template` 这一支。
 */
import {
  extractMermaidBlocks,
  replaceMermaidBlock,
  wrapAsMermaidBlock,
  extractModel,
  modelToMermaid,
  serializeTemplate,
  serializeUsecase,
  type DiagramModel,
} from "@repo/fabric-markdown";
import type { Canvas as FabricCanvas } from "fabric";

function serializeModel(model: DiagramModel): { code: string; lang: string } {
  if (model.kind === "template") {
    const lang = model.meta?.templateKey === "persona" ? "persona" : "canvas";
    return { code: serializeTemplate(model), lang };
  }
  if (model.kind === "usecase") {
    return { code: serializeUsecase(model), lang: "usecase" };
  }
  return { code: modelToMermaid(model), lang: "mermaid" };
}

/**
 * 补回 `serializeTemplate` 为 `key === "persona"` 省掉的「模板: persona」行——
 * 那条省略只对**隐式**围栏（```persona，key 由围栏语言本身声明）成立；一条
 * ```canvas 围栏（本仓 AI 产出 persona 画布时恒用的写法，见
 * `canvas-template-guidance.ts` 的「格式：```canvas / 模板: <key>」指引）里 key
 * 只能靠这行文字声明，省了它围栏就变成「canvas 语言 + 没有模板 key」，
 * `checkCanvasFence` 判失败，正是「首次生成正常、编辑一次保存后就不能渲染」这个
 * 线上 bug 的根因：`replaceMermaidBlock` 保留的是原围栏的 `lang`（`canvas`），
 * 不会因为这次序列化算出的 `lang` 是 `persona` 就把围栏语言换掉，两者一旦不一致，
 * 唯一还能声明 key 的这行文字却被吞掉了。
 */
function withExplicitTemplateKeyIfNeeded(
  code: string,
  fenceLang: string,
  model: DiagramModel,
): string {
  if (fenceLang === "persona" || model.kind !== "template") return code;
  const key = model.meta?.templateKey;
  if (!key || /^\s*(模板|template)\s*[:：]/im.test(code)) return code;
  return `模板: ${key}\n${code}`;
}

/** 签名与上游 `canvasToMarkdown` 一致，`CanvasStage` 可直接替换调用点。 */
export function serializeCanvasMarkdown(
  canvas: FabricCanvas,
  originalMarkdown?: string,
  blockIndex = 0,
): string {
  const model = extractModel(canvas);
  const { code, lang } = serializeModel(model);
  if (originalMarkdown !== undefined) {
    const blocks = extractMermaidBlocks(originalMarkdown);
    const block = blocks[blockIndex];
    if (block) {
      // 围栏语言以原来这条围栏用的为准（`replaceMermaidBlock` 的既有行为）——
      // 编辑一次不该把作者/AI 选的 ```canvas 显式写法悄悄换成 ```persona 隐式
      // 写法；但保留 `canvas` 语言时必须确保「模板:」行还在，见上面的说明。
      const fixedCode = withExplicitTemplateKeyIfNeeded(code, block.lang ?? "mermaid", model);
      return replaceMermaidBlock(originalMarkdown, block, fixedCode);
    }
    const sep = originalMarkdown.endsWith("\n") ? "" : "\n";
    return originalMarkdown + sep + "\n" + wrapAsMermaidBlock(code, lang) + "\n";
  }
  return wrapAsMermaidBlock(code, lang);
}
