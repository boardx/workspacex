# 契约束 `kernel-gateway` — ① UI（签核面第 ① 件）

> **UI material reuse: no new screen; reuse_bundle: `streaming-transport`.**
>
> **自检**：本文件引用 5 张截图，目录下实际 5 张。

覆盖 feature：F01 F02。判据单一事实源是 `requirements/01-kernel-unification.md`
的 R3/R4/R6/R8/R12（本文件只引用条目号，不重抄正文）。

## 为什么本束不引入新界面

`01-kernel-unification.md` R8「界面线索」逐字写明：**「本需求无直接前端界面（纯后端
架构重构），不涉及 UI 变更」**。网关转发/账本旁路/能力开关默认开启，均是内部系统边界
重构，用户侧无新增可见组件——用户感知到的只是「原本会卡死/误标的场景现在正常了」，
而这个正常态的渲染载体是 `streaming-transport` 束（执行进度流/暂停/重连三屏，本身就是
网关薄化后事件能顺畅转发的前端结果）。因此本束不产出独立截图，复用同 phase 内已产出、
独立通过双向门禁的 `streaming-transport` 材料，作为「本束改动最终体现在哪里」的可视化
证据（并非本束自己的界面）。

## 已产出（复用 `streaming-transport` 目录，逐张列出）

| 编号 | 文件 |
|---|---|
| 02 | `ui-preview/streaming-transport/02-progress-stream.png` |
| 07a | `ui-preview/streaming-transport/07-reconnect-toast-reconnecting.png` |
| 07b | `ui-preview/streaming-transport/07-reconnect-toast.png` |
| 08a | `ui-preview/streaming-transport/08-paused-system.png` |
| 08b | `ui-preview/streaming-transport/08-paused-user.png` |
