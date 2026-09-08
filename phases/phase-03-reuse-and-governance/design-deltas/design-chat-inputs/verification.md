# verification · design-chat-inputs（迭代 13）

> 每条都写**反证**——把哪一行删掉这条就红。写不出反证的验收线索不算验收线索。
> 编号接 `paged-generation-and-doc-export` 的 V36–V50。

## V51 — 参考图按**字节**判类型，不信 Content-Type
`apps/api/tests/design-workbench/ref-image-upload.test.ts`：改扩展名的 `.exe`、声明
`image/png` 实为 zip 的字节 ⇒ 拒；真 PNG/JPEG/WebP ⇒ 收。超 4MB ⇒ 拒。第 4 张 ⇒ 拒。
⚠ 反证：改成信 `Content-Type` ⇒「声明 png 实为 zip」那条红。
⚠ 反证：删掉张数上限 ⇒ 第 4 张那条红（成本敞口没有门）。

## V52 — 类型闭集与 `ModelCallImageMime` 同源，不是第二份枚举
`packages/contracts/tests/design-prototype.test.ts`：参考图允许的 mime 集合 **=**
端口的 `MODEL_CALL_IMAGE_MIMES`（集合相等，不是"包含"）。
⚠ 反证：在设计侧另写一个 `["image/png","image/jpeg","image/webp"]` 字面量 ⇒
端口那边加一种格式时这条立刻红——这正是"同一事实声明两处"的门。

## V53 — 参考图随**每一轮**发给模型，不是只发第一轮
`apps/api/tests/design-workbench/design-chat-model.test.ts`：3 页的分页生成 + 2 张参考图 ⇒
骨架轮与 3 个页轮**各自**的 `ModelCallInput.images` 都是那 2 张。
⚠ 反证：只在骨架轮带图 ⇒ 页轮那三条断言红（「照这张画」在第 3 页就失效了）。

## V54 — 模型看不了图时：不发图，且**在回复里说出来**
同文件：`visionModelIds` 不含当前 modelId ⇒ 请求体**不含** `images`，且回复文本含
「看不了图」这类明示；`applied` 不谎报。
⚠ 反证：静默不发图、回复照旧 ⇒ 这条红。**这是本 delta 最重要的一条**——
界面显示图已上传、模型根本没看过，是本仓反复栽过的形态。

## V55 — 参考图属于项目，跨轮可复用；删了就不再发
`apps/api/tests/design-workbench/project-lifecycle.test.ts`：上传 ⇒ 两轮对话都带；
删除其中一张 ⇒ 下一轮只带剩下的；`DesignProject.refImages` 只有元信息**不含字节**。
⚠ 反证：把字节也放进 `DesignProject` ⇒ 「不含字节」那条红（列表接口会被撑爆）。

## V56 — 导入线程：只读得到自己有权读的线程
同文件：导入别人的线程 ⇒ 与 `getThread` 同一个拒绝码，不是 500，也不泄露标题。
⚠ 反证：绕过 `getThread` 直接查库 ⇒ 这条红。

## V57 — 导入是**一次性**的，且留痕
同文件：导入后 `problem` 被写入摘要；`chat` 里多一条 system 消息记「从线程《X》导入了 N 条」；
**线程随后新增消息 ⇒ 项目 `problem` 不变**（不是订阅）。截断时留痕里写明截断了。
⚠ 反证：改成每轮实时读线程 ⇒「线程变了项目不变」那条红。
⚠ 反证：删掉 system 留痕 ⇒ 那条红（半年后没人知道背景从哪来）。

## V58 — 导入要**确认**才写，不覆盖用户已写的 problem
`apps/web/tests/ui/design-loop.test.tsx`：选中线程 ⇒ 出现可编辑的导入预览；
不点确认 ⇒ 项目 `problem` 一个字没变；改了预览再确认 ⇒ 写入的是**改后**的文本。
⚠ 反证：选中即写 ⇒ 「不点确认不变」那条红。

## V59 — 三种加图方式走同一条路径
同文件：按钮选文件 / 拖拽放入 / ⌘V 粘贴，三者产出**同一个**上传调用与同一份状态；
拖拽悬停时出现放置区高亮，离开消失。
⚠ 反证：粘贴另写一条分支 ⇒ 三者产物一致那条红。

## V60 — 真浏览器：拖一张图进去，画布真的照它画
`apps/web/e2e/design-prototype-loop.spec.ts`（`playwright-grep` 注册形式）：
mock 视觉模型响应 ⇒ 拖拽一张图到对话面板 ⇒ 参考图条出现缩略图 ⇒ 发送 ⇒ 请求体带
`refImageIds` ⇒ 画布更新。
⚠ 反证：前端拿到文件但不传 `refImageIds` ⇒ 这条红（图上传了但没进请求）。

## V61 — 澄清问题是**按这段 brief 生成的**，不是固定问卷
`apps/api/tests/design-workbench/intake-questions.test.ts`：两段不同的 brief（牙膏电商 /
内部审批工具）⇒ 生成的问题**不相同**，且各自含各自领域的词。
⚠ 反证：把实现换成返回 §3.5 那张固定问卷 ⇒ "两段 brief 问题不同"红。

## V62 — 模型不可用时退回固定问卷，并**说明**是兜底
同文件：模型抛错 ⇒ 仍返回问题（§3.5 六维），且带一个标记让前端能说"AI 没能生成针对性
问题，先按通用的问一遍"。**不是**整个新建流程失败。
⚠ 反证：模型失败就抛 ⇒ 这条红（模型挂了新建就用不了）。

## V63 — 跳过就是跳过，后面不再拦
`apps/web/tests/ui/design-loop.test.tsx`：整段跳过 ⇒ 直接建项目进画布，**不再**弹任何
补充信息的提示；单条跳过 ⇒ 那条不进 `problem`。
⚠ 反证：跳过后在画布上再拦一次 ⇒ 这条红。引导是帮忙，不是关卡。

## V64 — 问答落地成 `problem` / `criteria`，不新增第四种事实源
`apps/api/tests/design-workbench/project-lifecycle.test.ts`：带 `intake` 创建 ⇒
`problem` 含答案内容、可验收条目进 `criteria`；`DesignProject` **没有**新的
"指导原则"字段。
⚠ 反证：另加一个 `guidelines` 字段 ⇒ 这条红（同一事实第二处声明）。

## V65 — 列表按 `updatedAt` 倒序，且排序在**服务端**
同文件：三个项目按不同 `updatedAt` ⇒ 返回顺序即倒序；前端不做二次 `sort`。
⚠ 反证：改成 `createdAt` 倒序 ⇒ "刚改过的排最前"那条红。
⚠ 反证：把排序挪到前端 ⇒ 服务端返回顺序那条红（分页后会乱）。

## V66 — 标签：上限、过滤取交集、集合从现有项目派生
同文件 + `design-loop.test.tsx`：第 9 个标签 ⇒ 拒；超 20 字 ⇒ 拒；
选两个标签过滤 ⇒ 只返回**同时**有这两个的项目（不是并集）；顶部 chip 列表 = 该用户
现有项目上出现过的标签去重。
⚠ 反证：过滤实现成并集 ⇒ 这条红。
⚠ 反证：为标签另建一张表 ⇒ "集合从现有项目派生"那条红（会留下没有项目引用的孤儿标签）。

## §3.6 顶部三张模板卡片已删
`apps/web/tests/ui/design-loop.test.tsx`：工作台不再出现「移动端设计 / UI 原型 / 线框图」
三张卡片；主入口是一个「新建设计」按钮。类别在澄清之后由模型建议、用户可改。
⚠ 反证：卡片留着 ⇒ 这条红。

---

## 门控（与既有一致，不复述规则）

- `pnpm harness doctor --phase 03` 0 FAIL；
- `lint-verification-can-fail` 对上述每条命令成立（**只证明能红，不证明会绿**——两者都要各自跑）；
- `lint-ui-material`：新增截图（参考图条、拖拽高亮、线程选择器、导入预览）入参照集。
