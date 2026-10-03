> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Sticky Mural 契约审计

2026-10-01 只读源码审计与设计输入。不是 feature 权威、UI 实测、签核或完成声明。
遵循 phase-19/AGENTS.md：Fabric 只投影，Yjs/whiteboard-core 保存事实；本文不修改业务、功能状态或签核。

## 官方参考的证据边界

已读取 [Mural Update Sticky Note API](https://developers.mural.co/public/reference/updatestickynote)。
该官方接口说明更新操作、几何/文字/样式等字段及写授权需求；这证明接口可表达相关数据，不证明 Mural 当前编辑器的工具条、尺寸策略、手势或默认值。
其 htmlText 优先于纯文本、位置可相对 parent 等语义不能直接照搬到 Board：本仓使用纯文本与结构化文字属性、world geometry，不引入任意 HTML schema。
网页折叠的style object未展开详细字段，因此不据此宣称官方支持某个具体字号/对齐枚举。Mural字段不作为本仓事实副本。

## 当前事实源与已可复用能力

| 能力 | 源码与数据落点 | 审计结论 |
| --- | --- | --- |
| 身份、文字、几何 | `packages/contracts/src/whiteboard-document.ts` WhiteboardObject | kind=sticky，text有界；geometry保存world位置/尺寸/rotation；Y.Text承载正文 |
| 基础style | 同文件 WhiteboardStyle | fill/stroke/color/fontSize；不能把Fabric任意style属性视为公共契约 |
| 形状/尺寸模式/颜色 | `packages/whiteboard-core/src/thinking-input.ts` ThinkingInputMetadata | extensionData.thinkingInput.sticky保存square/rectangle/circle、auto-height/fixed/auto-size、六位hex颜色 |
| 文字属性 | 同文件 validateTextAttributes/CanonicalTextAttributes | 字体、字号、bold/italic/underline、颜色、left/center/right、lineHeight、列表及受限URL已存在 |
| 颜色预设 | 同文件 STICKY_COLOR_PRESETS | 八个预设及自定义hex；picker复用同一常量，不另造Mural色盘权威 |
| 创建 | 同文件 createStickyBatchEnvelope | 校验后生成create批，保留其他extension元数据；当前一次最多100张，不承诺500张已有实现 |
| 显示与编辑 | `apps/web/components/whiteboard/whiteboard-fabric-projection.ts`、thinking-input-editor.tsx | 使用已验证thinkingInput文字属性与sticky外观；不将HTML作为正文直接执行 |
| 属性更新 | collaborative-thinking-editor.tsx updateSticky/updateTextAttributes | style与thinkingInput同步写同批，形状变化可同时写geometry |
| 尺寸交互 | fabric/board-fabric-surface.tsx applyResizePolicy | square/circle比例缩放；auto-size禁手动缩放，auto-height限制纵向；是本仓策略，不是Mural实测 |

形状、颜色、自定义hex、固定字号、横向对齐、已有文字样式与三种尺寸模式可复用当前结构，无SQL迁移或新字段优先。
但需要区分「数据可表达」「入口可见」「行为已验收」：本次只读不是完整UI或双浏览器验收。
当前旧sticky无thinkingInput时projection回退square/auto-height；现有文字与style默认外观必须锁定，不批量回写新默认。

## 需要明确的契约与设计边界

- auto-height/auto-size已有模式，并不等于持久化自动缩字号、min/max字号、fit-text策略；若本轮要求字体随内容/容器自适应，应先确定派生还是持久化，提交用例/API设计增量。
- horizontal alignment已有left/center/right；sticky没有独立verticalAlign契约。Shape内容的verticalAlign不能冒充Sticky支持。justify、上下对齐若新增需单一schema与明确默认。
- 文本属性目前来自core校验函数与bounded extensionData，并非独立zod Sticky schema；不能称任意公网extension输入都经过sticky领域字段strict校验。若收紧领域验证，须验证旧数据兼容与拒绝路径，避免另写一套约束漂移。
- 字号/颜色在style和thinkingInput都有值；合法UI入口已同批更新，投影thinkingInput可能覆盖style。只改style的公共命令是否符合期望需要反例测试，不能凭字段存在宣称所有写入口一致；本次没有复现持久化bug，未自行修代码。
- 圆形长文本的包裹、最小尺寸、overflow与无手动缩放状态需要实际布局验证；不能用裁剪文字当auto-fit完成。
- 划线、混合字符范围样式、富文本HTML、嵌入执行内容、额外形状或新的reaction身份都不由现有整对象文字属性自动覆盖。新设计不得绕进未签核extension字段。

## 复制、交换、持久化

`packages/whiteboard-core/src/duplicate.ts`对对象做structuredClone并映射身份/parent/connector引用，sticky thinkingInput随extension保留。
copy/paste同样需要保留颜色、variant、sizing与全部文字属性；带位移操作只平移world geometry，不能将文本框测量尺寸当事实覆盖用户geometry。
`apps/api/src/application/whiteboard/portable-board.ts`解析WhiteboardObject、克隆extension并映射id；纯sticky不依赖图片资源。导入降级需可见报告，不静默丢失文字样式。
`board-backup.ts`验证canonical Yjs snapshot与blob hash/bytes；恢复应保留原始正文、元数据与几何。含不支持file附件的整板可受控拒绝，不能说所有混合Board都能备份。
新增样式必须同时补duplicate/paste、portable/import、backup往返断言；截图相同不等于字段没有丢失。

## 权限、锁定、协作与 Undo

- 通用文档命令执行拒绝锁定对象修改；lock状态不授予写权限。Owner/Editor才能写，Viewer/Commenter不可通过颜色、文字编辑或粘贴绕过ACL。
- `apps/api/src/infrastructure/whiteboard/pg-collaboration-store.ts`在tenant transaction锁Board、fresh检查成员与archive；epoch/request identity及durable snapshot/update沿用现有规则。
- 正文是Y.Text；IME composition只有结束后才提交canonical变化。整体thinkingInput metadata替换与正文CRDT不是相同冲突粒度，同一sticky同时改色/改字号必须验证不丢对方字段，不能只测两张不同便签。
- 浏览器 `packages/whiteboard-core/src/undo.ts`局部结构补偿与公共 `operation-service.ts`严格revision Undo分开验收；后者仅原用户且head匹配原receipt，后来有提交应stale，不承诺任意并发Undo。
- 删除关联connector默认cascade；若preserve-free必须复用既有原子删除规划。Undo正文/属性与Undo节点身份不应制造新id或留下dangling relation。
- archived、撤权、同租户另一私有Board、跨租户及锁定对象均需失败反证；只读UI按钮禁用不是服务器拒绝证据。

## 用例与验证输入

1. 新建三种形状、预设/自定义颜色，立即输入中文IME、RTL和长文本；cancel不提交，reload字段一致。
2. 同一sticky切换三尺寸模式、改字号/横向对齐/粗体/列表，再缩放与旋转；文本不溢出或被静默截断。
3. duplicate、copy/paste有位移、portable导入及backup恢复后核对正文、geometry、variant、sizing和全部文字属性，不只核截图。
4. 两浏览器同一sticky并发正文、颜色、字号更新；各自Undo不覆盖他人后续字段，断线重连与幂等重试不重复便签。
5. viewer/archive/撤权/locked写失败，失败后API回读无变化；合法拥有另一Board也不可改原Board对象。

## 功能来源与签核状态

`feature_list.json`中BV04覆盖Sticky/Text编辑、形状、颜色、字号与尺寸模式；BV05覆盖连续输入、删除与基础Undo，BV06覆盖属性，BV22覆盖多人Undo与离线语义。
其中BV05需求500张批创建与当前helper100张上限不同，必须明确分批原子/失败语义后验收，不把需求文本当已有实现。
新增Sticky设计应复用这些范围，按最新权威状态派工；不新建重复功能或修改feature_list。
此前实时GitHub查询因api.github.com连接失败，不能确认关联issue/PR当前状态；主协调者恢复查询后补来源，本文不猜编号。
本次材料待与UI/用例/API设计共同交人类确认，范围授权不等于三件签核完成；没有运行行为测试，不宣称通过。
