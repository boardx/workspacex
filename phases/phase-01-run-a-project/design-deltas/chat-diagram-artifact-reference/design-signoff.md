---
status: confirmed
bundle: chat-diagram-artifact-reference
base_bundle: chat
scope: diagram-message-readonly-preview-references-latest-saved-artifact
covers: ["I1668"]
confirmed_by: usamshen
confirmed_at: 2026-08-21
---

# Design delta 签核 · chat 图表消息只读预览接引用解析（issue #1668）

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签。

本 delta 挂靠已经确认的 `chat` 束（`phases/phase-01-run-a-project/contracts/chat/`），
且直接延用已签核的 `chat-persona-roundtrip`（G1，confirmed 2026-08-18）的读回机制
——不新增、不修改任何 API 契约字段，`packages/contracts/src/chat.ts` 分文不动。

## 人类决定

人类在 issue [#1668](https://github.com/boardx/workspacex/issues/1668) 2026-08-20
的评论里，针对「保存派生独立 artifact、不回写原消息」是否要新增回写能力，给出
2026-08-21 裁决，原话：

> 不做"回写原消息"（那会破坏消息不可变性），而是"评估回写原消息的实现，并执行，
> 所有的图表应该是独立的存储，类似于一个独立的文件可以被引用和搜索，自然也可以
> 独立的编辑和迭代"

并在指派本次实现任务时明确：图表继续独立存储/版本化，但消息的只读预览要能引用
到最新版本，让用户"看起来像编辑生效了"，不需要真的覆盖消息文本；worker 已核实
`design-deltas/chat-diagram-artifact-reference/` 此前不存在（方案此前只停在 issue
评论，未落代码），本次从头落地，不假设任何未经核实的既有实现。

本节由 agent **誊写**该次确认的具体选项，不含任何 agent 代裁的新决定：

- [x] 不新增「回写消息 `text`」的能力——维持消息不可变性（人类裁决核心约束）
- [x] 图表继续走独立存储 + 版本化（`chat_artifact_landings` 每次保存新增一行，
      不覆盖旧行，历史可查、可独立编辑迭代）——不改 `landAsArtifact` 语义
- [x] 只读预览改为引用最新版本（"看起来像编辑生效了"），通过复用已签核的 G1
      读回机制（`fetchLatestSavedDiagramSource`），新增触发时机（挂载滚入视口），
      不新起第二套读回逻辑
- [x] 契约面（`packages/contracts/src/chat.ts`）零改动——G1 已经把需要的读端口
      建好；核实后确认无需扩展契约
- [x] mermaid 标准图表（`ChatDiagramFabric`）与工作坊画布模板围栏
      （`ChatCanvasFabric`）一并同步修，避免只修一半留下新的不一致
- [x] `onSaved`/`onClose` 回调核实后确认已实现（PR #1696），本次不改
- [x] 全部通过，直接进入实现

## ① UI

无新增交互元素、无新增 `data-testid`、无新增视觉状态——只读预览的渲染源
（`previewCode`）本身已经是 `savedSource?.markdown ?? code` 这套既有链路，本次
只是让它在「消息挂载滚入视口」这个时机也有机会被 `savedSource` 命中，用户能感知
到的差异是「不用先点一次最大化，气泡里的图就已经是最新保存版」。详见
[contract.md](./contract.md) §2.1。

## ② 用例

延用 `chat-persona-roundtrip` 契约二节已有的用例表（「重开读回（有保存版）」
「重开读回（无保存版）」），本次新增的是触发时机而非新用例：挂载读回与最大化
读回命中/未命中的行为完全一致，同一个 `fetchLatestSavedDiagramSource`。见
[contract.md](./contract.md) §2.1、§三 交叉检查。

## ③ API 契约

零改动。见 [contract.md](./contract.md) §2.3、§三。
