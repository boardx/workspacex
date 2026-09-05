# 契约束 `streaming-transport` — ① UI（签核面第 ① 件）

> **自检**：本文件引用 5 张截图，目录下实际 5 张。（2026-09-04 ui-prototyper 交付，签核用静态原型）

覆盖 feature：F03 F04 F05（`feature_list.json`）。判据单一事实源是
`requirements/02-streaming-transport.md` 的 R3/R4/R6/R8/R12（本文件只引用条目号，不重抄正文）。

## 一、本束需要哪几块屏

本束**不新建独立路由**。全部落点在 `/chat` 主屏的执行进度流区域内，签核阶段用
`/preview/agent-kernel` 这一个静态原型页承载全部 8 屏（含其它三束的屏），见
`apps/web/app/preview/agent-kernel/page.tsx` + `apps/web/components/agent-kernel/agent-kernel-units.tsx`。

| 屏 | 一句话 | 对应需求 | 现状 |
|---|---|---|---|
| **S1 执行进度流** | 工具调用/diff/结果摘要按序渲染，非终态下前端持续更新 | R3 步骤 2-3 | 已建（原型） |
| **S2 断线重连 · 重连中** | 轻量「正在重连…」提示，出现在流顶部 | R4 E2、R8 | 已建（原型） |
| **S2' 断线重连 · 已恢复** | 「连接已恢复」提示，自动消失 | R4 E2、R8 | 已建（原型） |
| **S3 暂停 · 用户发起** | `paused` 态，展示可恢复动作 | R4 E4（依赖 03 束状态机） | 已建（原型） |
| **S3' 暂停 · 系统保护性** | `paused` 态但不可直接恢复，仅通知/联系入口 | R4 E4 | 已建（原型） |

## 二、界面落点与稳定 `data-testid`

| 组件 | data-testid | 触发条件 |
|---|---|---|
| 执行进度流 | `agent-kernel-progress-stream` | run 处于 `running`，逐条渲染 `ProgressStep` |
| 重连提示（进行中） | `reconnect-toast` `data-state="reconnecting"` | WebSocket 断开且自动重连中（R4 E2） |
| 重连提示（已恢复） | `reconnect-toast` `data-state="restored"` | 重连成功，展示后自动消失 |
| 暂停 · 用户态 | `paused-user`（含 `paused-resume` 恢复按钮） | `paused` 且 `pausedBy: "user"` |
| 暂停 · 系统态 | `paused-system`（含 `paused-system-notify` / `paused-system-contact`，不含恢复按钮） | `paused` 且 `pausedBy: "system"`（保护性暂停不提供直接恢复） |

⚠ 「连接中断，请手动刷新」（R4 E2 重连持续失败态）尚未在本轮原型中单独出屏——
待人类在签核时确认：是复用 `reconnect-toast` 的第三种 `data-state="failed"`，
还是独立组件。**如实标注为待确认，不在本文件替人类拍板。**

## 三、已产出（截图）

| 编号 | 文件 | 对应上表 |
|---|---|---|
| 02 | `ui-preview/streaming-transport/02-progress-stream.png` | S1 |
| 07a | `ui-preview/streaming-transport/07-reconnect-toast-reconnecting.png` | S2 |
| 07b | `ui-preview/streaming-transport/07-reconnect-toast.png` | S2'（已恢复态） |
| 08a | `ui-preview/streaming-transport/08-paused-system.png` | S3' |
| 08b | `ui-preview/streaming-transport/08-paused-user.png` | S3 |

## 四、缺口

- ⚠ 未产出：重连持续失败后「连接中断，请手动刷新」态的独立截图（若签核裁定为独立组件而非
  `reconnect-toast` 第三态）。
- ⚠ 未产出：多端同时观看同一 run 的一致性展示（R4 A1）——需求本身声明"不要求多端 UI
  同步细节"，故本轮不产出对应屏，如实记录而非默默略过。
