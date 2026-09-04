---
covers_bundles: [kernel-gateway, streaming-transport, plan-permissions, artifacts-steering, error-observability]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-09-04T19:21:52Z"
---

# Phase 14 阶段一致性复核

> 只查**交叉约束**——单束内的问题在各束 `design-signoff.md` 里已经看过。
> 五束全部签核完成后，人类在此确认跨束的事实不重复、不变量不矛盾、级联闭合、
> 错误语义一致，再把 `status` 改为 `confirmed`。

## 一、同一事实是否在多束中被重复定义（本项目最高发的缺陷）

| 事实 | 权威落点 | 消费束 | 核查结果 |
|---|---|---|---|
| run 状态机 `AgentKernelRunStatus` | `streaming-transport` | `plan-permissions`（消费 `awaiting_plan_confirmation`/`awaiting_tool_permission`）、`artifacts-steering`（消费 `running`）、`error-observability`（消费 `failed`） | ✅ 各消费束均未重新定义该枚举，只在文字里引用状态名 |
| todo/计划快照形状 `AguiTodosSnapshot` | `agui-state-events`（phase-01 既有束） | `streaming-transport`（`PlanUpdateEvent.plan`）、`plan-permissions`（`PlanStepDraft.todo` 复用 `AguiPlanTodo`） | ✅ 两束均 import 复用，未重新定义 todo 形状 |
| 沙箱/内核/模型错误分类 | 争议点，见下方"待人类裁决" | `kernel-gateway`（`ProxyToolExecutionError.SANDBOX_UNAVAILABLE`）、`error-observability`（`FailureCode.SANDBOX_UNAVAILABLE`/`MODEL_CALL_FAILED`） | ⚠ 两束各自声明了同名或近似的错误码，"谁是第一现场"未定，见下方交叉约束 |

## 二、跨束的不变量是否互相矛盾

- `plan-permissions` I-1（L2 操作无自动执行例外） vs `kernel-gateway` I-2（网关是
  唯一执行权）：**不矛盾，互相加强**——授权判断产生在 `plan-permissions`，
  执行权收口在 `kernel-gateway`，两条不变量描述的是同一条安全边界的两端。
- `streaming-transport` I-1（终态覆盖完整） vs `artifacts-steering` I-3（失败不
  计入版本历史）：**不矛盾**——`continueArtifact` 触发的 run 若以 `failed` 终态
  结束，`streaming-transport` 保证该终态被正确上报，`artifacts-steering` 保证
  该终态不产生半成品版本，两者是因果关系不是冲突。

## 三、跨束的级联是否闭合

- **插话→重新规划→授权范围歧义链**（`artifacts-steering` E3）：插话触发内核判断
  是否方向性改变 → 若是，触发 `plan-permissions` 的 `plan_update`/重新确认 →
  已批准的"本 run 内都允许"授权（`StandingToolGrant` 的 run 级粒度）是否需要失效。
  **⚠ 待人类裁决**：`artifacts-steering/domain.md` 与 `plan-permissions/domain.md`
  均未给出这条级联最终由谁收口（内核判断触发重新规划时是否连带清空 run 级授权，
  还是授权与"计划版本"无关、天然延续）。这是本轮最需要在阶段复核阶段拍板的
  一条交叉约束。
- **沙箱故障分类链**（`kernel-gateway` → `error-observability`）：`kernel-gateway`
  的 `proxyToolExecution` 产生 `SANDBOX_UNAVAILABLE` 是分类的第一现场，
  `error-observability` 的 `toFailure`/`getRunFailure` 在其上做进一步人性化转换——
  **⚠ 待人类裁决**：两束各自的 domain.md 都留了"这一分工待确认"的段落，需要
  人类给出统一结论后，其中一束应改为明确引用另一束的错误码而不是各自平行声明。

## 四、错误语义是否一致

- `NOT_VISIBLE` 在 `kernel-gateway`（隐含委托）、`plan-permissions`、
  `artifacts-steering`、`error-observability`（`getRunFailure` 隐含委托）四束中
  语义一致：均委托上游 `chat`/`identity` 束的可见性判定，未各自发明新的可见性
  规则。✅
- `RUN_NOT_RUNNING`（`artifacts-steering`）与 `RUN_NOT_AWAITING_*`（`plan-
  permissions`）：语义一致的"状态前置条件不满足"错误族，均直接引用
  `streaming-transport` 的 `AgentKernelRunStatus` 具体取值命名错误码，未使用
  含糊的通用码。✅

## 五、待人类裁决的交叉约束汇总（阶段复核的核心工作）

1. 沙箱/模型错误分类的"第一现场"归属：`kernel-gateway` 还是 `error-observability`。
2. 插话触发重新规划时，run 级"以后都允许于本 run 内"授权是否连带失效。
3. `error-observability` 完整 transcript 的字段级加密合规方案（R9 明确要求人类
   签字，不是普通设计确认）。

⚠ 五束的 `design-signoff.md` 目前全部 `status: pending`，本文件同样 `status:
pending`——按 ADR-023 决策四，一致性复核必须在全部束签核之后才由人类确认为
`confirmed`。本文件当前只是**声明复核范围**（`covers_bundles` 已列全五束）与
**预先识别交叉约束**，供人类签核各束时参考，不代表复核已经完成。
