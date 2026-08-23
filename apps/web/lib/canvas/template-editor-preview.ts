/**
 * 模板编辑器面板的**实时预览**——把编辑器里正在改的「显示名 + 分区名列表」变成一段
 * `CanvasStage` 能吃的 markdown，复用与 chat 围栏渲染组织自建模板**同一条**引擎
 * （`buildAutoTemplateSpec` + `registerTemplate`，见 `fence-template-resolver.ts` 文件头）。
 *
 * ## 为什么不直接复用 `fence-template-resolver.ts`
 *
 * 那个文件解决的是"chat 里一个 `模板: <key>` 围栏该渲染成什么"——key 来自服务端已发布的
 * 真实模板，`AUTO_OWNER` 记的是"这个 key 现在归哪个 `orgId@version`"，用来判断要不要
 * 重新拉取+注册。编辑器预览完全不同：内容**只在浏览器内存里**（使用者正在打字，
 * 还没提交），没有 `orgId@version` 这回事——每次分区列表变化都要重新算 spec 并
 * `registerTemplate` 覆盖同一个临时 key，不需要那套"要不要重新拉"的判断。
 * 硬套那个模块会把「本地未提交编辑」伪装成一次服务端读取。
 *
 * ## 临时 key 的命名与生命周期
 *
 * `__editor-preview-<realKey>-<realVersion>`——前缀避免撞到任何真实模板 key（真实 key
 * 由使用者输入，理论上无法产出以 `__` 开头的值，因为界面从不允许使用者填这个前缀，
 * 但即便撞了，代价也只是预览画错，不影响任何真实数据）。`registerTemplate` 全局表
 * 没有 `unregisterTemplate`（vendor 纪律不许改包，见 `auto-template-layout.ts` 文件头），
 * 编辑器关闭后这个临时 spec 会**留在内存里**——同一账号一次会话里编辑同一个模板多次，
 * 复用同一个临时 key 覆盖，不会无限增长；真正的内存增长上限是"这次会话编辑过多少个
 * 不同的模板"，与页面刷新后归零，可接受。
 */
import { registerTemplate } from "@repo/fabric-markdown";
import { buildAutoTemplateSpec, type AutoLayoutSectionInput } from "./auto-template-layout";

export function templateEditorPreviewKey(realKey: string, realVersion: number): string {
  return `__editor-preview-${realKey}-${realVersion}`;
}

/**
 * 把「显示名 + 分区名列表」注册成一个可渲染的临时 spec，返回喂给 `CanvasStage`
 * `markdown` prop 的完整围栏文本。空分区列表也能注册——引擎的 `computeAutoLayout`
 * 对空数组有定义（见 `auto-template-layout.ts` 的既有反证用例），画出来是一个只有
 * 标题、没有任何分区框的画布，不是报错态。
 */
export function buildTemplateEditorPreviewMarkdown(input: {
  readonly realKey: string;
  readonly realVersion: number;
  readonly displayName: string;
  readonly sectionNames: readonly string[];
}): string {
  const previewKey = templateEditorPreviewKey(input.realKey, input.realVersion);
  const sections: AutoLayoutSectionInput[] = input.sectionNames
    .map((name, i) => ({ sectionId: `s${i + 1}`, name, order: i, required: false, capacity: null }))
    .filter((s) => s.name.trim().length > 0);

  const { spec } = buildAutoTemplateSpec({
    key: previewKey,
    displayName: input.displayName.trim().length > 0 ? input.displayName : "未命名模板",
    sections,
  });
  registerTemplate(spec);

  const lines = [`模板: ${previewKey}`, ...sections.map((s) => `## ${s.name}`)];
  return ["```canvas", ...lines, "```"].join("\n");
}
