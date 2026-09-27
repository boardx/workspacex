/**
 * `frontend-design` skill → 原型画布这条链路的**翻译覆盖矩阵**（issue #4327）。
 *
 * ## 为什么要有它
 *
 * `DESIGN_PRINCIPLES` 是 anthropics/skills `frontend-design`（仓库里存于
 * `.agents/skills/frontend-design/SKILL.md`）的**手工翻译**：那份 skill 写给自由写 CSS 的场景，
 * 这里只有 21 个原语的闭集，所以只能翻译不能照搬。手工翻译已经漏过两次（#3125 当时整段视觉判据
 * 没接；#4319 补上「一排相同卡片」「大数字当默认重点」两条），每次都是用户看到丑页面才发现——
 * 因为**没有任何东西记录「上游的哪一条被翻成了什么」**。
 *
 * 这张表把每条上游判据落到四种去处之一，测试逐条核对去处真的存在：
 *   · `prompt`   —— 某段提示词里的原话（锚点短语必须在那段提示词里，且落在所写的条目里）；
 *   · `metric`   —— `prototype-quality.ts` 的一条机械指标（违反会被打回重画，比提示词更硬）；
 *   · `renderer` —— 由渲染器 / 截图审计门负责（给出负责的文件）；
 *   · `inexpressible` —— 这套原语表达不了，写明为什么。
 * 并且钉住 SKILL.md 的 sha256：**上游一更新（重新导入 skill），这里立刻红**，逼人逐条重核，
 * 而不是等用户再截一张丑图。
 *
 * ⚠ 条目是对上游的**概括**，不是原文摘抄；原文只在 SKILL.md 一处。
 */
export const FRONTEND_DESIGN_SKILL_SHA256 = "ab0457189f433042c73a83861c59f245e27e3bfc002d6f7afd16f81870082a05";

export type CoverageTarget =
  | { readonly kind: "prompt"; readonly prompt: "principles" | "outline" | "qualityBar"; readonly clause?: string; readonly anchor: string }
  | { readonly kind: "metric"; readonly metric: string }
  | { readonly kind: "renderer"; readonly file: string; readonly note: string }
  | { readonly kind: "inexpressible"; readonly reason: string };

export interface CoverageEntry {
  readonly id: string;
  /** 上游判据的一句话概括。 */
  readonly upstream: string;
  readonly targets: readonly CoverageTarget[];
}

export const FRONTEND_DESIGN_COVERAGE: readonly CoverageEntry[] = [
  { id: "subject", upstream: "从题材本身（行业、材料、行话）找视觉选择，先想清楚主题、受众、主要任务", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑧", anchor: "最有代表性的东西" },
    { kind: "prompt", prompt: "outline", anchor: "该有的**气质挑" },
  ] },
  { id: "hero", upstream: "首屏放题材里最有代表性的东西；「大数字 + 小标签 + 渐变」是默认做法，不是选择", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑧", anchor: "「一排 stat 大数字配小标签」是最常见的默认做法" },
  ] },
  { id: "typeface", upstream: "有意识地选字体，一到两个家族，不用每个项目都会伸手去拿的默认字体", targets: [
    { kind: "prompt", prompt: "outline", anchor: "整套界面的字体气质" },
    { kind: "inexpressible", reason: "字体是闭集四档（PrototypeFont：sans/serif/rounded/mono），不能指定具体字体家族" },
  ] },
  { id: "type-scale", upstream: "建立清晰的字号层级，字重与间距有意图", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑨", anchor: "title 一页最多一次" },
    { kind: "metric", metric: "hierarchy" },
  ] },
  { id: "line-length", upstream: "正文行长不超过约 80 字符；衬线正文行距略大", targets: [
    { kind: "inexpressible", reason: "行长由画布宽度（手机 300px / 桌面 720px）与渲染器决定，原语没有行长或行距属性" },
  ] },
  { id: "headline-accent", upstream: "别只把标题里一个词换成斜体 / 粗体 / 另一种颜色", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑭", anchor: "不要只把标题里的一个词换成另一种 variant" },
  ] },
  { id: "caps-labels", upstream: "别用全大写做标签", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑭", anchor: "不要用全大写的小标签当眉头" },
  ] },
  { id: "extra-labels", upstream: "别在内容上方加不必要的小标签", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑫", anchor: "不要每段文字上面都加一行小标签" },
  ] },
  { id: "structure-is-info", upstream: "边框、编号、分隔线等结构装置要编码信息而不是装饰；编号只用于真正的序列", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑪", anchor: "结构装置要**编码信息**" },
    { kind: "prompt", prompt: "principles", clause: "⑪", anchor: "数字编号只在内容真的是有序步骤时用" },
  ] },
  { id: "motion", upstream: "非用户触发的动效少用，一处编排好的动效胜过到处的淡入", targets: [
    { kind: "inexpressible", reason: "原语没有动效属性，画布不播放动画" },
  ] },
  { id: "card-kit", upstream: "AI 生成特征：内容切成一排相同的圆角卡片、全页一个圆角、同样的阴影、渐变装饰", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑭", anchor: "不要把内容切成一排结构相同的 card" },
    { kind: "metric", metric: "repeatedCards" },
  ] },
  { id: "template-chrome", upstream: "AI 生成特征：全大写眉头、中点拼元信息、「词 —— 片段」标签、按钮缀 →", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑭", anchor: "「A · B · C」中点" },
    { kind: "prompt", prompt: "principles", clause: "⑭", anchor: "破折号标签" },
    { kind: "prompt", prompt: "principles", clause: "⑭", anchor: "按钮文案不要缀「→」" },
  ] },
  { id: "palette-cliches", upstream: "AI 生成特征：奶油底 + 赤陶色、近黑底 + 荧光色、报纸式细线排版", targets: [
    { kind: "inexpressible", reason: "颜色是闭集强调色八档（PrototypeAccent）+ 明暗主题，模型无法自由取色，这几种配色套路在这套原语里造不出来" },
  ] },
  { id: "plan-then-review", upstream: "先出简短设计方案（配色 / 字体 / 布局 / 原则），对照需求复核它是不是任何类似项目都会得到的默认方案，再动手", targets: [
    { kind: "prompt", prompt: "outline", anchor: "写得具体、可执行" },
  ] },
  { id: "css-specificity", upstream: "注意 CSS 选择器优先级互相抵消", targets: [
    { kind: "inexpressible", reason: "模型不写 CSS，样式全由渲染器从原语映射" },
  ] },
  { id: "one-bold-thing", upstream: "大胆只花在一处，其余安静；出门前摘掉一件配饰", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑧", anchor: "一页只有一个视觉重点" },
    { kind: "prompt", prompt: "principles", clause: "⑱", anchor: "有没有一处装饰是删掉也不损失信息的" },
  ] },
  { id: "spacing-system", upstream: "间距与层级成体系，同级同距", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑩", anchor: "间距成体系" },
  ] },
  { id: "quality-floor", upstream: "质量底线：响应式、可见的键盘焦点、尊重减少动效、可读的对比度", targets: [
    { kind: "renderer", file: "apps/web/e2e/support/text-contrast.ts", note: "截图审计门的 WCAG AA 对比度检查；响应式与焦点由画布组件负责" },
  ] },
  { id: "self-critique", upstream: "边做边截图自查", targets: [
    { kind: "metric", metric: "substance" },
    { kind: "renderer", file: "apps/web/e2e/prototype-audit.spec.ts", note: "开发期截图几何审计门；运行期只有结构自审，服务端没有浏览器" },
  ] },
  { id: "copy-cta", upstream: "按钮说清点下去发生什么；同一个动作全流程同名", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑮", anchor: "按钮说清楚点下去会发生什么" },
    { kind: "prompt", prompt: "principles", clause: "⑮", anchor: "全流程同名" },
  ] },
  { id: "copy-states", upstream: "错误说清出了什么事、怎么办，不道歉；空态是去做事的邀请", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑯", anchor: "错误不道歉也不含糊" },
    { kind: "prompt", prompt: "principles", clause: "⑯", anchor: "空态是一句邀请" },
  ] },
  { id: "copy-voice", upstream: "用终端用户的词、主动语态、句子式大小写、不写填充语", targets: [
    { kind: "prompt", prompt: "principles", clause: "⑰", anchor: "用用户的词不用系统的词" },
    { kind: "metric", metric: "placeholderCopy" },
  ] },
];
