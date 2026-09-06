# 契约束 `design-prototype` — 签核第 ① 件：UI

> ## 自检（可机械核对）
>
> **本文件引用 4 张截图，目录下实际 4 张。N == M，无死链、无多列、无遗漏。**
>
> 这一行由 `.harness/scripts/lint-ui-material.mjs` 双向对账（引用集合 == 实存集合）。

## 本束不新增屏；改的是设计详情的画布区

三张都是 `components/design-loop/detail-screen.tsx` 同一屏，由 `apps/web/scripts/shot-feedback-design-loop.mjs`
渲染生产同一份组件、`page.route()` 拦 `/pm-designs*` 用固定夹具（`scripts/lib/design-loop-fixtures.mjs`
的 `proj-chat-ui`：两页组件树 + 一轮对话）拍出，落 `ui-preview/design-prototype/`。
图与生产的差别**只有数据，没有代码**。

| 图 | 场景 | 看什么 |
|---|---|---|
| [detail-prototype-dark.png](../../ui-preview/design-prototype/detail-prototype-dark.png) | 第一页「聊天」 | 占位块变成渲染的组件树：导航栏、消息流（`fill` 撑满、用户气泡右对齐、AI 头像 + 卡片 + 「正在生成」badge）、底部输入区（输入框吃满剩余宽度 + 危险色「停止」）；顶栏新增「导出设计文档」 |
| [detail-prototype-page2-dark.png](../../ui-preview/design-prototype/detail-prototype-page2-dark.png) | 切到第二页「历史会话」 | 位置对应（I-8）：标签条切页 ⇒ 画布换树；搜索框、tabs、dot 列表、留白、通栏主按钮 |
| [detail-prototype-focus-dark.png](../../ui-preview/design-prototype/detail-prototype-focus-dark.png) | 迭代 2：点选画布上的「停止」按钮 | 节点描边高亮；对话面板上方出现焦点 chip「针对：按钮「停止」（聊天 › 纵向布局 › 横向布局）」，可 × 清除；输入框占位改为「要怎么改这个节点？」；发送时请求带 `focusNodeId`，模型优先用 patch 改它 |
| [detail-prototype-generating-dark.png](../../ui-preview/design-prototype/detail-prototype-generating-dark.png) | 发送后等待模型（真实等待，夹具晚 3s 才回） | 对话面板底部「正在生成，画布会整页重绘，可能需要一分钟……」，输入框与发送键禁用 |

⚠ 未产出：占位块 + 引导语的空态特写（`design-detail-phone-placeholder`）——与 `design-workbench`
束 `detail-canvas-dark` 的既有占位块外观一致，只多一句引导文字，未单独重拍。
⚠ 未产出：导出后的 `.md` 文件内容——它不是屏，是 `tests/ui/design-doc-markdown.test.ts` 断言的文本。
