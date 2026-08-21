# chat 图表消息只读预览接引用解析（issue #1668）· contract delta

Status: confirmed（见 [design-signoff.md](./design-signoff.md)）。

> 背景来源：issue [#1668](https://github.com/boardx/workspacex/issues/1668)
> （2026-08-20 真机实测发现 + 2026-08-21 人类裁决评论）。本材料核实裁决评论里提到的
> 「方案文档已经写好」在合入 `main` 的历史里从未真正落地——`design-deltas/` 下不存在
> 本目录，之前只是把方案写进了 issue 评论，代码也从未改过。本次是从头落地。
>
> 实测基线：`origin/main`（本分支切出点 SHA `df402344`）。

## 零、issue 复现的现象与根因（真机实测，原样登记）

场景：项目聊天室（`canLandArtifacts=true` 引导师身份）发一条含 ```mermaid 代码块的
消息 → 打开图表编辑器 → 加一个节点 → 点「保存」→ 真实 `POST
/chat/threads/:threadId/artifacts` 落库 → 界面出现「已保存」徽标 → **刷新页面、
重新打开该线程后，原消息气泡里的只读预览仍是编辑前的内容**，编辑加的节点看不到。

**这不是 bug，是 `chat-diagram-canvas-modal.tsx` 文件头注释已写明的设计取舍**：
「保存派生一个独立 canvas artifact，不新起持久化通道，也不回写消息」。issue 指出的
可用性问题是：这个语义没有任何 UI 提示，容易被理解成「编辑覆盖了原图」。

### 根因定位（核实结论，非臆造）

本仓已有一套**确认过、已实现**的引用解析机制——design-delta
[`chat-persona-roundtrip`](../chat-persona-roundtrip/contract.md)（G1，2026-08-18
confirmed，2026-08-19 起随 #1541/#1593/#1696/#1723 逐步实现并合入 `main`）：

- 契约面已落（`packages/contracts/src/chat.ts` `listThreadArtifacts.out.items[].messageId`
  + `getThreadArtifactSource`），后端读端口真实可用（`apps/api/src/application/chat/
  get-thread-artifact-source.ts`、`artifact-landing-ports.ts`）。
- 前端取数序列已抽成纯函数 `fetchLatestSavedDiagramSource`
  （`apps/web/lib/chat/diagram-readback.ts`）：`listThreadArtifacts` 按 `messageId`
  过滤取最新一条 → `getThreadArtifactSource` 取回 markdown；查不到 / `NOT_VISIBLE`
  （他人草稿，I-36 不提示存在性）/ 任何失败 ⇒ 返回 `null`。
- `ChatDiagramFabric`/`ChatCanvasFabric` 的只读预览已经在读 `savedSource?.markdown
  ?? code`（`previewCode`），modal 关闭时若带回保存结果也会回填 `savedSource`
  （PR #1696「全屏编辑器保存后气泡只读预览不同步的问题」修的正是这一段）。

**实测确认的唯一缺口**：`fetchLatestSavedDiagramSource` 只在 `openMaximized`（点
「最大化」按钮）这一个触发点被调用（`chat-diagram-fabric.tsx:92-115` 改动前）。
组件首次挂载（包括整页刷新后的重新挂载）时，`savedSource` 恒为 `React.useState`
的初始值 `null`，只读预览渲染 `previewCode = savedSource?.markdown ?? code`，等于
恒画消息原文 `code`——**除非用户主动点过一次「最大化」**，只读小图才会跟着更新
（因为 `openMaximized` 里 `setSavedSource(saved)` 是在打开 modal *之前* 执行的，
这次 state 更新对气泡本身同样生效，只是从未在「不点最大化」的路径上被触发过）。

issue 复现的「刷新后气泡没变」，本质是「刷新后组件重新挂载，而这次用户只是打开
线程看了一眼，没有再点一次最大化」——不是保存没生效，也不是读回逻辑有 bug，是
读回从未在「挂载」这个时间点被调用过。

## 一、人类裁决（2026-08-21，原话见下方「人类决定」节）

**不做「回写原消息」**（会打破 chat_messages 的不可变性，且 G1 已裁决的版本/权限
语义要重新裁一遍）。而是：**评估回写原消息的实现，并执行——所有的图表应该是独立的
存储，类似于一个独立的文件可以被引用和搜索，自然也可以独立的编辑和迭代**。

翻译成本仓已有词汇：图表继续走 G1 已经建好的「独立存储 + 版本化 + 引用解析」
（`chat_artifact_landings` 每次保存新增一行，不覆盖旧行，历史可查、可独立编辑
迭代——人类裁决的核心诉求），只是把这套引用解析**从「只服务编辑器重开」扩到
「也服务消息只读渲染的挂载时机」**，让只读预览不再需要用户先点一次「最大化」
才能看到最新版本。

## 二、技术方案

### 2.1 只做一件事：挂载滚入视口即读回一次

`ChatDiagramFabric`/`ChatCanvasFabric` 新增一条 `React.useEffect`，依赖
`[inView, savedSource, threadId, messageId, projectId, bearer]`：

- `inView` 为真（复用已有的 `IntersectionObserver` 惰性化闸门，图表消息挂载
  滚入视口才校验渲染——读回搭这班车，不额外发一轮独立的可见性判断）
  ∧ `savedSource === null`（还没有任何来源，避免与 `openMaximized`/`onClose`
  已经拿到的结果打架、也避免拿到 `null` 后无限重试）
  ∧ `threadId`/`messageId`/`bearer` 三者俱全（预览页/流式草稿维持现状不发请求）
  ⇒ 调 `fetchLatestSavedDiagramSource`，命中则 `setSavedSource(saved)`。
- 命中 ⇒ `previewCode` 自动切到保存版，已有的「阶段一校验」「阶段二渲染」两个
  effect 因 `previewCode` 变化重新跑一次，只读预览画出保存版内容——**不新增
  任何渲染分支**，复用既有的 `previewCode` 驱动链路。
- 未命中 / 无权限（他人草稿，I-36）/ 任何失败 ⇒ `saved === null`，`previewCode`
  维持 `code`，与今天完全一致，不提示、不报错。

`openMaximized`（点「最大化」）保留自己独立的一份读回（`fetchLatestSavedDiagramSource`
再查一次），不复用挂载 effect 的结果——理由：用户可能在挂载 effect 还没跑完时就
点了最大化（图刚进入视口），modal 打开前需要一份确定性的读回序列，不能依赖另一条
effect 的时序。代价是同一份数据可能被查两次（轻微冗余，两条路径各自的组件测试
分别钉死），换来的是两条触发路径互不依赖、任一条出问题不影响另一条。

### 2.2 编辑保存后立即更新只读预览——核实结论：已经实现，本次不改

任务描述里提到「编辑器新增 `onSaved` 回调」——核实 `chat-diagram-canvas-modal.tsx`
现状：`onClose: (result?: { markdown: string }) => void`（PR #1696 已加），保存成功
后 `saved` state 被写入，关闭 modal 时 `closeModal` 把 `saved.mermaid` 通过 `onClose`
带回调用方，调用方（`ChatDiagramFabric`/`ChatCanvasFabric`）在 `onClose` 里
`setSavedSource(...)`，只读预览立即用新内容重渲染——**不必等下一次网络往返，也
不必刷新页面**，与任务描述的验收目标逐字相符，只是回调命名是 `onClose(result)`
不是单独的 `onSaved`。因为「保存」这个动作本身不会自动关闭 modal（用户可能连续
编辑多次才关闭一次），气泡预览在 modal 关闭前不可见，语义上不需要在每次点「保存」
时都单独回传一次——本材料判定**这条不需要改动**，如实记录以避免重复实现。

### 2.3 消息 `text` 不可变、不新增写口

本次改动零后端代码、零契约改动——`packages/contracts/src/chat.ts` 分文不动。
`chat_messages.text` 全程只读，`landAsArtifact` 的写口语义不变（每次保存新增一行
`chat_artifact_landings`，不覆盖旧行）。

### 2.4 两种引用形态的取舍（沿用 G1 已裁决的选择，不重新裁）

- **方案甲（已选，本次延用）**：隐式 join（`chat_artifact_landings.message_id`）。
  零后端改动、不触碰消息不可变性、复用 G1 已签核的版本与权限语义。
- **方案乙（不选）**：消息文本嵌标记 / 消息表新增字段。需要新迁移、新写口，且会把
  G1 已经裁决过的问题（版本语义、权限判定）重新裁一遍——本次 issue 的裁决原话
  明确排除「回写原消息」，方案乙的任何变体都与裁决冲突，不在候选内。

### 2.5 工作坊画布模板 / mermaid 标准图表——一并同步修

`ChatCanvasFabric`（工作坊画布模板围栏）与 `ChatDiagramFabric`（mermaid 标准图表）
在只读预览、最大化、G1 读回三处结构逐字对称（`ChatCanvasFabric` 文件头注释已明确
「G1 读回与围栏语言无关，直接复用 mermaid 路径同一份逻辑」）。本次改动对两个组件
做逐字对称的同一处修改，避免只修一半留下新的不一致。

## 三、与已签核契约的交叉检查

- **不新增/修改契约字段**：`listThreadArtifacts.out`、`getThreadArtifactSource`
  在 G1 已经把需要的读端口建好，本次读端口不够用的情况没有出现，无需上报缺口。
- **不违反 I-36**：他人草稿的 `NOT_VISIBLE` 在挂载读回路径与最大化读回路径走的是
  同一个 `fetchLatestSavedDiagramSource`，静默退回 `null` 的行为一致，不新增
  任何「有你看不到的草稿版本」的提示。
- **不违反 D-38**（只读端口不写任何东西）：挂载 effect 只调用既有的只读
  `getThreadArtifactSource`，不新起任何写口。
- **`chat-persona-roundtrip` 的用例表**（「重开读回（有保存版）」「重开读回（无
  保存版）」）本次未修改语义，只是新增了「挂载即读回」这一个额外触发时机，命中/
  未命中的行为与既有的「点最大化」触发时机完全一致（同一个纯函数、同一套失败
  降级）。
