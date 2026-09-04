---
bundle: streaming-transport
phase: "14"
covers: [F03, F04, F05]
status: pending          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `streaming-transport` 设计签核

覆盖：F03（网关 WebSocket 事件端点）、F04（前端订阅改造）、F05（放开一消息一 run）。
判据单一事实源：`requirements/02-streaming-transport.md` 的 R3/R4/R6/R9/R12。

## 一、材料清单

- ① UI：`ui.md`（5 张截图：02/07×2/08×2，对应执行进度流/断线重连两态/暂停两态）。
- ② 用例：`usecases.md`（`subscribeRunEvents`/`listRunAttemptsForMessage`）。
- ③ API 契约：`packages/contracts/src/streaming-transport.ts`。
- 支撑·领域模型：`domain.md`（I-1～I-6）。
- 支撑·覆盖证明：`coverage.md`。

## 二、人类签核时请重点核对

1. **①UI**：`reconnect-toast` 是否需要第三个 `data-state="failed"`（连接中断，请
   手动刷新）的独立截图——本轮 ui.md 第四节已如实标注为缺口，待裁决是否要补屏
   还是仅口头约定第三态复用同一组件的视觉基调。
2. **②失败模式**：`subscribeRunEvents` 没有传统 `err` 返回值（WebSocket 流式操作），
   失败态全部通过 `ReconnectState` 呈现——这个设计选择是否符合预期，还是应该在
   连接建立的握手阶段单独定义一个 HTTP 层的 `err` 分支。
3. **③API 契约**：`AgentKernelRunStatus` 是全新枚举，刻意不复用 `wave2-runtime.ts`
   的旧 `AgentRunStatus`（避免同名两处声明）——`domain.md`"待人类在签核时确认"
   一节标注了旧枚举窗口期共存的问题，请重点核对这段是否需要转成一条正式的
   design-delta 或后续 issue。
4. **不变量**：I-5（`awaiting_approval` 全仓不再出现）目前只能约束新代码，`domain.md`
   已如实标注 `wave2-runtime.ts` 现存同名值的处理方式待定，不代表本束不变量本身
   不成立——请确认这个边界划分。
5. **coverage 双向**：F05 对应的 R12 验收句在原文中未编 V 号（散文式表述），
   `coverage.md` 已补记但格式与其它束不完全对齐，请确认是否需要人类重新编号。
