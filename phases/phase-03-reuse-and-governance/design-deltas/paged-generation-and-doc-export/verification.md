# verification · paged-generation-and-doc-export（迭代 12）

> 每条都写**反证**——把哪一行删掉这条就红。写不出反证的验收线索不算验收线索。
> 编号接 `prototype-navigation` 的 V26–V35。

## V36 — 骨架轮只要标签与意图，不要组件树
`apps/api/tests/design-workbench/design-chat-model.test.ts`：空项目首次生成 ⇒ 第 0 次调用的
prompt 明确只要 `outline`，模型返回 `{"outline":[{frame,intent}×5]}` ⇒ 落库得到 5 个
`root === undefined` 的页、`frames` 为那 5 个标签、画布可渲染（空页占位）。
⚠ 反证：骨架轮 prompt 里保留 `prototype` 字段说明，模型照旧整页吐 ⇒ 断言"第 0 次调用不含
`PROTOTYPE_SCHEMA_GUIDE`"红。

## V37 — 每页一次调用，单次输出量与页数无关
同文件：8 页骨架 ⇒ 恰好 8 次页轮调用，第 i 次的 prompt 只要求第 i 页，**不含**其余页的完整树。
⚠ 反证：页轮把 `JSON.stringify(ctx.prototype)` 整个塞进上下文 ⇒ 断言"页轮 prompt 长度不随
已生成页数线性增长"红（这正是今天的做法）。

## V38 — 第 i 页失败只损失第 i 页，其余页照常
同文件：第 3 页调用抛超时 / 返回截断 JSON ⇒ 其余 7 页正常落库；第 3 页 `root === undefined`；
接口回执带 `MODEL_OUTPUT_TRUNCATED`；**不**回滚已写回的页。
⚠ 反证：把页轮包进一个"任一页失败 ⇒ 整批不写"的事务，这条红——它正是今天"白等三分钟"的形状。

## V39 — 单页重试只重跑那一页
`apps/api/tests/design-workbench/project-lifecycle.test.ts`：对 `root === undefined` 的页发重试
⇒ 恰好 1 次模型调用、只改那一页、记 1 条 `model` 版本；其余页的树与版本历史不变。
⚠ 反证：重试走首次生成那条路径 ⇒ 调用次数断言红（会变成 1 + N）。

## V40 — 截断有独立回执，不再只靠"JSON 解析失败"
`packages/contracts/tests/design-ai-collab.test.ts` + `design-chat-model.test.ts`：
`DesignChatFallbackReason` 含 `MODEL_OUTPUT_TRUNCATED`；provider 返回 finish reason `length`
⇒ 直接判该 reason（**不**先去 parse）；`superRefine` 仍绑定 `source==="fallback"` ⇔ 有 reason。
⚠ 反证：闭集加了成员但漏进 `all-exceptions.filter.ts` 允许清单 ⇒ 接口层用例红（回不到前端）。
⚠ 反证：删掉 finish-reason 分支，只留 parse 失败 ⇒ "返回可解析但被截断的 JSON"那条红。

## V41 — `addScreen` / `removeScreen`：增删页不再整页重给
`packages/contracts/tests/design-prototype.test.ts`：`addScreen{at:1}` ⇒ `frames` 与 screens
同时插入、长度一致；`removeScreen{screen:1}` ⇒ 同时删除。`at` 越界 / `screen` 越界 ⇒
`UNKNOWN_SCREEN`。
⚠ 反证：`addScreen` 只插 screens 不插 frames ⇒ 长度一致性断言红。

## V42 — 增删页时跳转目标索引整体平移
同文件：三页、page0 有 `to:2` 的 link ⇒ `removeScreen{1}` 后该 link 变 `to:1`（**不是**仍指 2、
也不是被丢）；指向被删页本身的 link 被丢；`addScreen{at:1}` 后 `to:1` 变 `to:2`。
⚠ 反证：删页后不平移 ⇒ 这条红。**这是本 delta 最值钱的一条**——不平移的失败是静默错位，
界面上一切正常，点下去去了错的页。

## V43 — 输出预算开关生效且缺省不改变今天的行为
`apps/api/tests/…/model-provider.test.ts`：设 `KERNEL_MODEL_MAX_OUTPUT_TOKENS=2048` ⇒ 请求体
带该上限；不设 ⇒ 请求体**不含**该字段（今天的行为逐字保持）。
⚠ 反证：缺省填一个硬编码默认值 ⇒ "不设时不含该字段"红。

## V44 — 页间风格一致（§1.1 的未验证假设，这条就是钉它的）
`apps/web/tests/ui/design-loop.test.tsx` + 夹具：8 页生成后，各页顶层结构同族（都有 navbar 或
都没有）、按钮 variant 取值集合 ⊆ 骨架轮声明的集合、间距 token 取值 ≤ 2 种。
⚠ 反证：页轮上下文里去掉已生成页的结构摘要 ⇒ 这条红。
⚠ 若实测反复红：按 §1.1 退路改成"带第 1 页完整树"，**不许**改弱这条断言来求绿。

## V45 — 生成中的三态在界面上分得开
`apps/web/tests/ui/design-loop.test.tsx`：骨架落库后每页有 `data-screen-state`（`pending` /
`generating` / `ready` / `failed`）；`ready` 的页此刻就能点选改属性（不必等全部完成）；
`failed` 的页渲染占位框 + 原因 + `design-detail-retry-screen-{i}` 按钮。
⚠ 反证：把"生成中禁用整个画布"加回来 ⇒ "ready 的页此刻可点"红。

## V46 — 导出 HTML 是自包含的，且链接真的能点
`apps/web/tests/ui/prototype-export-html.test.ts`：产物是单个字符串，**不含** `http://` /
`https://` 外链、不含 `<script src=`；每页一个锚点；每条 link 生成一个指向目标页锚点的可点击元素；
页数 == `frames.length`；`frameNotes` 与跳转清单在产物里。
⚠ 反证：把内联 `<style>` 换成外链 CDN ⇒ "不含外链"红。
⚠ 反证：只渲染当前页 ⇒ 页数断言红。

## V47 — 导出 HTML 与实时画布同一套渲染（人类选 A 时）
同文件 + `apps/web/tests/ui/design-loop.test.tsx`：新增一个原语只改一处即可同时出现在画布与
导出产物里——用例对同一棵树分别取实时渲染与导出渲染，断言两者的语义 class 集合一致。
⚠ 反证：导出侧另写一份 `renderNodeHtml` ⇒ 这条红（两处会漂）。
若人类选 B（两套渲染）：本条改为登记在《明确不计分/已知漂移面》，**并说明每加一个原语要改两处**。

## V48 — PDF 文档结构完整，界面一节每页图文齐全
`apps/web/tests/ui/prototype-export-pdf.test.ts`（选 A ⇒ 断言打印视图的 DOM）：
封面 / 问题与目标 / 验收标准 / **界面** / 设计过程 五节都在；界面一节下每页一个小节，含
该页整屏图、交互说明、结构大纲、跳转清单（人话，形如 `按钮「发送」 → 第 2 页「设置」`）；
`@media print` 下每页小节不跨页断开。
⚠ 反证：跳转清单直接打印裸节点 id ⇒ 断言"人话标签"红（迭代 11 已在同一处踩过：
夹具节点没给 id 时标签静默回落成裸 id，那半边等于没测）。
⚠ 反证：删掉整屏图 ⇒ 红。人类交办的原话是「每个界面的说明文档」+ 界面本身。

## V49 — 真浏览器：分页生成看得见，导出的两个文件真的产出
`apps/web/tests/e2e/design-prototype-loop.spec.ts`（`playwright-grep` 注册形式）：
mock 分页响应 ⇒ 骨架页先出现、逐页填充；导出菜单点「可点击原型 (.html)」触发 download 且
产物非空、在新页面打开后点一条 link 真的换页；点「设计文档 (PDF)」进入打印视图（选 A）。
⚠ 反证：导出用 `<a download>` 但 blob 为空 ⇒ 产物非空断言红。

## V50 — 既有导出四项一个不动
`apps/web/tests/ui/design-doc-markdown.test.ts` 与既有导出用例**全部原样通过**，
`.md` / `.json` / 当前页 PNG / 复制 JSON 的产物逐字节不变。
⚠ 反证：为复用而重构 `buildDesignDocMarkdown` 的输出格式 ⇒ 既有用例红。

---

## 门控（与既有一致，不复述规则）

- `pnpm harness doctor --phase 03` 0 FAIL；
- `lint-verification-can-fail` 对上述每条命令成立（**只证明能红，不证明会绿**——两者都要各自跑）；
- `lint-ui-material`：本 delta 新增截图（分页生成中态、失败页占位、导出菜单、PDF 打印视图）入参照集。
