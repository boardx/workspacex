# 契约束 `plan-permissions` — 领域模型与不变量（支撑材料）

> 洋葱最内层。翻译自 `requirements/03-plan-mode-permissions.md`，不发挥。

## 一、实体与值对象

### `ToolRiskLevel`（值对象，固定白名单映射）

```
L0 只读        grep/read_file/web_fetch 等无副作用      自动执行，不打断
L1 可撤销副作用  write_file/edit_file（有版本历史可回滚）  默认自动执行，事件带完整 diff
L2 不可逆/高风险 bash_exec、外部系统写入                  默认需用户确认
```

分级规则本身固定，不支持组织自定义（R6 不包含）。

### `PlanStepDraft`（计划步骤，可编辑态）

```
PlanStepDraft {
  stepId:          string
  todo:            AguiPlanTodo    # 复用 agui-state-events 的 { content, status }
  risk:            ToolRiskLevel
  dependsOnStepId: string | null
}
```

### `StandingToolGrant`（"以后都允许"运行时持久化记录）

```
StandingToolGrant {
  orgId:            string
  toolName:         string
  grantedByUserId:  string
  grantedAt:        timestamptz
}
```

授权粒度三档：单次（不持久化）/ 本次 run 内（run 生命周期内持久化，run 结束失效）/
以后都允许（组织级运行时持久化，无过期）。存储在网关侧，内核只需知道调用被批准
还是拒绝，不持有授权状态本身（R5）。

## 二、不变量

- **I-1 L2 无自动执行例外**：L2 操作在用户未曾授权同类操作的情况下，绝不允许
  自动执行，没有例外，包括"agent 自认为这次风险很低"也不能绕过（R7）。可断言：
  遍历一组 L2 工具调用请求，在无 `StandingToolGrant` 命中且非本 run 内已批准的
  情况下，判定结果恒为 `awaiting_tool_permission`，不存在自动执行分支。
- **I-2 确认粒度限制**：Plan Mode 的确认粒度限制在"首次规划"与"方向性重新规划"
  两种时机，逐步骤确认在设计上被禁止（R7）。可断言：单个 run 内，除首次规划和
  插话触发的重新规划外，不出现额外的计划确认请求（R4 E4，R12 验收线索）。
- **I-3 完整信息**：每次 L1/L2 操作的完整入参出参（diff/命令内容）通过事件传递给
  前端，不是截断摘要（R6 后置条件）。可断言：`ToolPermissionRequest.command` 与
  `PlanStepDraft` 相关字段不做长度截断处理。
- **I-4 授权粒度独立生效**：单次/本 run/以后三档授权互不越界——"仅本次"批准的
  调用不影响同 run 内后续同类调用的授权状态；"以后都允许"需验证跨 run 持久化生效
  （R12 验收线索）。
- **I-5 空计划禁止**：计划不得被编辑成空（删到 0 步）——需求原文虽未直接写出该
  条目字面量，但由"内核应能识别不合法编辑并给出提示"（E2）与"确认粒度限制在首次
  规划"共同蕴含：一个空计划无法被"确认执行"。**待人类在签核时确认**是否需要独立
  的 `PLAN_EMPTY_NOT_ALLOWED` 错误码（本契约当前用 `PLAN_INVALID_AFTER_EDIT`
  笼统覆盖，未单独区分空计划这一种）。

## 三、待人类在签核时确认

- E1（用户长时间未响应确认/权限弹层，需要"待你确认"入口提醒）——本束契约未定义
  任何"提醒"相关的操作或事件，需求原文只说"需要有明确入口提醒"但未指定机制
  （通知/角标），这是纯 UI 层还是需要后端产生一个提醒事件，待人类裁决。
- E3（插话导致方向性改变，是否需要重新触发计划确认由内核判断）——本束的
  `confirmPlan`/`getPlan` 是被动响应操作，内核的判断逻辑本身不在契约层面约束
  （属于内核实现细节），这个划分是否符合预期待确认。
