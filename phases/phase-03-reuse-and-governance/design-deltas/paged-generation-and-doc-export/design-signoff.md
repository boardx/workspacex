---
status: draft
bundle: paged-generation-and-doc-export
base_bundle: design-prototype
scope: paged-prototype-generation-per-screen-retry-clickable-html-and-pdf-delivery-doc
covers: [F53, F54, F55, F56, F57]
confirmed_by: ""
confirmed_at: ""
confirmed_via: ""
---

# design delta 签核 · 分页生成 + 可交付文档导出（迭代 12）

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签
（ADR-023 / AGENTS.md「设计签核（三件、一处签）」）。**我把 `status` 留在 `draft`。**

规范唯一来源：[`contract.md`](./contract.md)。验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

两件事，一次交付：

**一、生成撞了天花板。** 2026-09-07 线上实测：一次模型调用要吐出所有页的完整组件树，
输出长度随页数线性增长而模型单次预算固定 ⇒ 先是连续五次超时，接着是「输出太长被截断」，
截断后 JSON 不完整又在对话里回显了裸 JSON。**三个现象一个根因**，把超时从 90s 提到 180s
只是止血。治本是把「一次生成 N 页」拆成「一次骨架 + 每页一次」。

**二、拿不出能发给别人的东西。** 人类 2026-09-07 交办：「需要导出 html，需要导出 pdf 的
文档包括界面一节每个界面的说明文档」。现在只有 `.md`（要阅读器）、`.json`（给机器）、
当前页 PNG（一次一页）。

**先签后做。** 改了 API 契约（闭集加一个成员、patch op 加两种、`validateLinks` 加索引平移
语义），covers 追加三条件一条都不满足，所以走 design-delta。

## ① UI

见 [contract.md](./contract.md) §5。⚠ **这一件目前只有文字，没有截图**——按 ADR-003「UI 先行」，
签核前应由 ui-prototyper 用 `apps/web` 真组件 + 夹具把下面四屏做出来拍进
[`ui.md`](../../contracts/design-prototype/ui.md)：

1. 分页生成中（骨架页已出现、部分页 `ready` 可点、部分页 `generating`）；
2. 某页生成失败的占位框 + 「重试这一页」；
3. 导出菜单新增的两项；
4. PDF 打印视图的「界面」一节（一页图 + 说明）。

**要你确认的：**
- 三态用什么呈现——占位骨架屏？还是页签上一个小圆点？（我倾向前者，画布上直接看得见）
- 失败页的措辞：现在回执是「AI 这次的输出太长被截断了」，分页后应该变成
  「第 3 页没生成完」+ 重试按钮。这个粒度对不对。
- PDF 每页一屏图 + 说明，是否要**同页**（我按同页设计）还是图一页、说明一页。

## ② 用例

见 [verification.md](./verification.md) V36–V50。重点看**失败模式**是否穷举：

- 骨架轮失败 = 与今天等价；第 i 页失败 = 只损失第 i 页，其余可用（V38）；
- 单页重试只重跑那一页（V39）；
- 截断有独立回执，不再只靠「JSON 解析失败」判（V40）；
- **删页后跳转索引整体平移**（V42）——不平移的失败是**静默错位**：界面上一切正常，
  点下去去了错的页。这条是本 delta 最值钱的用例。
- 页间风格漂移（V44）是本 delta 唯一的**未验证假设**，用例直接钉它，且写明
  「实测反复红就改实现，不许改弱断言求绿」。

## ③ API 契约

见 [contract.md](./contract.md) §1–§4、§8。改动就四处：

1. `DesignChatFallbackReason` **+1**：`MODEL_OUTPUT_TRUNCATED`（闭集进响应体 ⇒ 同步
   `all-exceptions.filter.ts` 允许清单）。
2. `PrototypePatchOp` **+2**：`addScreen{at,frame,root?}` / `removeScreen{screen}`。
3. `validateLinks` 增加**索引平移**语义（仍只声明一处纯函数）。
4. 新增运维开关 `KERNEL_MODEL_MAX_OUTPUT_TOKENS`（缺省不传 = 今天的行为逐字保持）。

**没有新路由、没有新表、没有新错误码。** 页级「未生成」是 `root === undefined` 的派生，
不新增存储字段（`root` 可缺是 `prototype-navigation` §5 已确立的合法状态）。

## 请人类拍板的三处取舍（`contract.md` §7）

| # | 取舍 | 建议 | 备选 |
|---|---|---|---|
| ① | 导出 HTML 的渲染来源 | **A** 原语样式收敛成一份 `wx-proto-*` CSS，实时画布与导出共用 | B 导出侧另写一套渲染 + CSS / C 抓 DOM |
| ② | PDF 怎么生成 | **A** HTML 的打印视图 + `window.print()` | B jsPDF 一键下载 / C 服务端 Chromium |
| ③ | 每页轮带多少上下文 | **A** 只带已生成页的结构摘要 | B 第 1 页完整树 + 其余摘要 |

签核时若与建议不同，把选择写在下面这行，agent 按它实现：

> 人类选择：① ＿ ② ＿ ③ ＿

**①、② 是本 delta 真正的成本分水岭，值得你多花两分钟：**

- **①B 便宜一半**，但同一件事声明在两处——AGENTS.md 那条「同一事实不得声明在两处」
  已经栽过五次，且这里没有机械门控能挡漂移（每加一个原语要记得改两处）。我建议 A，
  但如果你要的是"先看到能发的 HTML"，B 也是个诚实的选择——只是要**明确登记为已知漂移面**。
- **②A 的唯一代价是用户要在打印对话框里多点一次「保存为 PDF」。** B 能一键落盘，
  但中文字体要么打包 ~8MB 进 bundle、要么把文字光栅化成图（不可选中不可搜索），
  而这份 PDF 的用途正是发给人读和引用。

## 与既有已签内容的关系

- 挂靠束 `design-prototype` 的 21 个原语、`PROTOTYPE_FIELDS`、版本历史语义**一个不改**。
- `prototype-navigation` 的 `links` / `setLinks` / 预览模式**一个不改**，只是增删页时
  目标索引会平移（§2）。
- 既有导出四项（`.md` / `.json` / PNG / 复制 JSON）**逐字节不变**，V50 钉住。
- 保真评分卡按 2026-09-07 人类裁决，迭代 11 及以后**明确不计分**——迭代 12 同样不入 D1–D10，
  验收看本文的 V36–V50。

## 范围外（登记，见 `contract.md` §6）

导出产物的在线托管/分享链接、并发生成、PDF 自定义模板、清理库里修复前存下的裸 JSON 历史消息。
