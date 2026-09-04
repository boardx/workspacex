---
bundle: plan-permissions
phase: "14"
covers: [F06, F07, F08]
status: pending          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `plan-permissions` 设计签核

覆盖：F06（后端状态机+工具风险分级+三档授权存储）、F07（计划确认卡片）、
F08（工具权限确认弹层）。判据单一事实源：`requirements/03-plan-mode-permissions.md`
的 R3/R4/R5/R6/R12。

## 一、材料清单

- ① UI：`ui.md`（2 张截图：01 计划确认卡片、03 工具权限确认弹层）。
- ② 用例：`usecases.md`（UC-1～UC-6）。
- ③ API 契约：`packages/contracts/src/plan-permissions.ts`。
- 支撑·领域模型：`domain.md`（I-1～I-5）。
- 支撑·覆盖证明：`coverage.md`。

## 二、人类签核时请重点核对

1. **①UI**：E1（"待你确认"入口提醒）与 E2（编辑不合法内容的内核提示）两处缺口
   截图，`ui.md` 第四节已如实标注，请确认是否要求补屏还是接受留在实现阶段细化。
2. **②失败模式**：`PLAN_INVALID_AFTER_EDIT` 目前笼统覆盖"删除必要前置步骤"与
   "删到 0 步"两种情况，`domain.md` I-5 提出是否需要拆出独立错误码
   `PLAN_EMPTY_NOT_ALLOWED`，请裁决。
3. **③API 契约**：`decideToolPermission` 的 `forever` 决策写入 `StandingToolGrant`
   后，契约本身不提供撤销/查看操作（R6 明确不包含），这个契约面的完整性边界
   是否符合预期——后续若要做管理界面需要走新的契约面，不是本束扩展。
4. **不变量**：I-1（L2 无自动执行例外）是本束最核心的安全不变量，请重点确认它
   能否真正写成断言（"没有例外"这类全称否定命题在实现阶段容易被具体分支绕过）。
5. **coverage 双向**：`cancelPlan` 对应的 R4 A1 在原文 R12 里没有编号，
   `coverage.md` 已补记，请确认补记方式是否可接受。
