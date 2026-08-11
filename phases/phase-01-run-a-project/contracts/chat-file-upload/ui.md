# 契约束 `chat-file-upload` — ① UI（人看到的界面对不对）

> **自检**：本文件引用 9 张截图，目录 `ui-preview/chat-file-upload/` 下实际 9 张 PNG + 一份
> `README.md`。N == M == 9，逐张核对全部真实存在，无死链。
> 复核命令（唯一实现）：`node .harness/scripts/lint-ui-material.mjs`
>
> phase-01 是 `has_ui: true` 阶段，本文件由 `requiredBundleFiles()` 强制存在。
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（**权威**）——F151 是本束唯一 CAP-UI 条目。
> ⚠ **参数不在这里复述**：25MB / 白名单 / 10 张的数值单一事实源是
> `packages/contracts/src/chat-file-upload.ts`（③ 件契约）；本文件只描述**界面呈现**，
> 校验数值指针引用契约（ADR-020，本仓「同一事实两处声明」教训）。

## 一、这批截图是什么

V9-a 附件能力寄生在 chat 输入区（composer）。原型用 `apps/web` 真实组件 + mock 数据产出
（`/preview/chat-file-upload?scene=`，mock 单一事实源 `apps/web/lib/mock/chat-file-upload.ts`
逐字取自签核值），**不接后端、不动活路由 `chat-live-message-panel.tsx`**——它是签核① 的
材料，V9-a 落地时按此实现。

## 二、索引表（每态一行，逐张对应 `ui-preview/chat-file-upload/` 下实存 PNG）

| # | 界面态 | 截图 | 服务 feature |
|---|---|---|---|
| ① | 默认 · 空 composer + 📎 附件按钮 + N/10 计数 + 底部参数说明 | `ui-preview/chat-file-upload/v9-composer-attach-default.png` | F151 |
| ② | 拖拽高亮 · 虚线落区 +「松开即上传」+ 参数提示 | `ui-preview/chat-file-upload/v9-composer-attach-dragover.png` | F151 |
| ③ | 已挂多个附件 · 竖排预览条（图标 + 名 + 大小 + 已就绪 + ✕） | `ui-preview/chat-file-upload/v9-composer-attach-attached.png` | F151 |
| ④ | 上传中 · 旋转图标 + 百分比 + 进度条 | `ui-preview/chat-file-upload/v9-composer-attach-uploading.png` | F151 |
| ⑤ | 失败·超上限 · 就地报错横幅 + 附件条标红 | `ui-preview/chat-file-upload/v9-composer-attach-error-oversize.png` | F151 |
| ⑥ | 失败·非白名单 · 列出支持类型 | `ui-preview/chat-file-upload/v9-composer-attach-error-type.png` | F151 |
| ⑦ | 失败·超张数 · 满 10/10 + 拒收横幅 | `ui-preview/chat-file-upload/v9-composer-attach-error-count.png` | F151 |
| ⑧ | 失败·可重试 · 传输中断 +「重试」按钮 | `ui-preview/chat-file-upload/v9-composer-attach-error-retry.png` | F151 |
| ⑨ | 二次确认·移除 · 含影响说明 + 取消/移除 | `ui-preview/chat-file-upload/v9-composer-attach-remove-confirm.png` | F151 |

## 三、签核① 须人类核对的设计决定（ui-prototyper 报告，超签核字面处）

1. **附件预览「竖排整条」而非「横排小 chip」**——签核 ① 字面偏横排 chip，但 25MB×10 + 长中文
   文件名 + 进度/重试/错误容不下横排。这是签核时人类担心的「10 个 + 25MB 排布不下」的解法，
   **未改任何签核数值，只改排布形态**。若须横排 chip 请签核时点出。
2. **📎 达 10 上限即禁用**（不是点了再报错），沿用活路由「不做假按钮」惯例。
3. **失败可否重试的划分**：仅网络类失败可重试（⑧）；类型/大小/张数错不可重试（得换文件）。
   对应契约 `ChatAttachmentError` 的分类。
4. **移除二次确认**（⑨）写了影响范围文案「它不会随这条消息发送」；也可改成「移除 + 可撤销 toast」，
   两种都满足 UC 的 R8，需人类定一种。

## 四、范围诚实

本件证明的是 V9-a 的**界面呈现**（F151）。附件**真的落库 + 随消息发送 + 回读**是 F149/F150
（后端，② usecases / ③ 契约管），**进 context 检索**是 F152（V9-b）。原型不接后端，是签核材料
不是活功能。
