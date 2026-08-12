# ① UI 签核**增量** —— chat 📎「加材料进这一轮」面板

> 交 coord-main 裁「按备妥材料先行」，次日人类补签（夜间全权，见 2026-08-11 通告）。
> 这是对已 `confirmed` 的 `chat-file-upload` 束 ① UI 的**增量**：只改 📎 的点击交互，其余 V9-a 上传行为不变。

## 变更点（人类反馈起）
人类实测 devapp：点 📎 直接弹**系统文件框**，体验突兀。要求：点 📎 先弹一个附件面板。

## 第一版口径（人类裁决 · coord-main 2026-08-11 转达「从简」）
- 点 📎 → 弹 **「加材料进这一轮」** 面板（复用 `components/files/overlay` 的 `Modal` 壳，不另造）。
- 面板内**从本机文件选择**才触发文件框；拖拽落区行为不变。
- 选/拖 → **25MB / 白名单**校验（维持 V9-a 已签值；原型的 200MB 作废，不动契约）。
- **上传进度条**（唯一新增：XHR `upload.onprogress`，`fetch` 拿不到进度故换 XHR）。
- 面板**列出全部已传文件**；全部随消息进上下文（文件**内容**进模型等 W1/F153 anydoc 落地）。
- **砍掉且不留假占位**（不做假开关）：token 计数 / 逐文件「勾选才进上下文」/ 含机密→本地模型路由。

## 截图（本目录）
| 文件 | 场景 |
|---|---|
| `v9-attach-modal-mix.png` | 混合态：已就绪 / **上传中 60%（真实进度条）** / 失败可重试 |
| `v9-attach-modal-atlimit.png` | 达 10 个上限：「从本机文件选择」禁用 + 上限提示 |
| `v9-attach-modal-empty.png` | 空态：仅拖拽区 + 约束文案（25MB · 支持类型 = 契约白名单派生，无「录音」） |

无鉴权预览路由：`/preview/chat-attach-modal`（mock，不接后端）。

## 活实现与证据（非原型 mock）
- 组件：`apps/web/components/chat/chat-composer-attachments.tsx`（`ChatAttachMaterialModal`，portal 到 body）。
- 上传层：`apps/web/lib/live-chat.ts` `uploadAttachment` 改 XHR + `onProgress`，错误 `reasonCode` 语义不变。
- 测试：组件 13 + XHR 单测 3 全绿；全量 838 通过；tsc / lint-design 通过。
- 残留验证缺口：面板在**活链路**上的定位与真实上传进度需登录会话（agent 不能代登），按通告 PR 前做真栈验证。

## 与契约一致性
- 文件大小 **25MB**、白名单、每消息 **10** 个：全部取 `packages/contracts` 单源，未改契约。
- 不含「文件内容进模型」——那是 V9-b（F153/F154）+ context-engine（F155），未建，本增量不碰。
