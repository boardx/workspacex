---
bundle: kernel-gateway
phase: "14"
# 束↔feature 映射的权威（ADR-023 决策三）。
covers: [F01, F02]
status: pending          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `kernel-gateway` 设计签核

覆盖：F01（apps/api 退化为薄网关）、F02（deep-agent-service 能力开关默认开启并移除）。
判据单一事实源：`requirements/01-kernel-unification.md` 的 R3/R4/R5/R6/R7/R12。

## 一、材料清单

- ① UI：`ui.md`（本束无新增界面，`reuse_bundle: streaming-transport`，
  R8 原文明确"本需求无直接前端界面"）。
- ② 用例：`usecases.md`（`forwardRun`/`proxyToolExecution`/`checkKernelHealth` 三操作，
  失败模式见该文件"统一失败枚举"）。
- ③ API 契约：`packages/contracts/src/kernel-gateway.ts`（zod 单一事实源）。
- 支撑·领域模型：`domain.md`（I-1～I-5 五条不变量）。
- 支撑·覆盖证明：`coverage.md`（R12 六条 V 编号双向核对）。

## 二、人类签核时请重点核对

1. **①UI**：本束确实无新增界面吗？R8 原文"本需求无直接前端界面（纯后端架构重构）"
   是否仍然成立——若后续实现发现网关侧需要暴露任何调试/监控界面，需要走
   design-delta 补签，不能事后悄悄加进已签核范围。
2. **②失败模式**：`usecases.md` 的失败枚举是否穷举了 R4 备选/异常流程的全部分支——
   尤其 E1（内核内部执行异常）目前只落在"必须触发 status_change→failed"这条不变量
   （I-4），并没有作为 `forwardRun`/`proxyToolExecution` 自身的一个 err 分支，
   这个设计选择（异步上报 vs 同步错误返回）是否符合预期，请确认。
3. **③API 契约**：`kernel-gateway.ts` 的 `forwardRun`/`proxyToolExecution` 是否真的
   应该是"内部操作、不对前端暴露"——若未来发现前端需要直接感知转发过程（而不是
   只通过 streaming-transport 束的事件流间接感知），需要重新评估是否该暴露 HTTP 路由。
4. **不变量**：`domain.md` 的 I-1～I-5 是否都能写成可执行断言（不是"应该"式规则）；
   I-5（能力开关移除）的"待人类在签核时确认"段落——kernel-gateway 与
   error-observability 束在沙箱错误分类上的分工是否符合预期。
5. **coverage 双向**：`coverage.md` 的 R12→API 与 API→判据两个方向是否都核过，
   有没有遗漏的判据或多余的操作。
