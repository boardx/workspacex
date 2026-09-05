---
bundle: plan-permissions
phase: "14"
covers: [F06, F07, F08]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-09-04T19:21:52Z"
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

## 三、签核后变更记录（issue #2767，2026-09-05，待人类复核——不自封签核）

devapp 人类实测：调用平台 skill `pdf-create` 弹出「等待批准」，判定为错误（生成
一份 PDF 不该需要任何批准）。根因是 `call_skill` 被整体记成 L2（`domain.md` 原文
只写"bash_exec、外部系统写入"是 L2，`call_skill=L2` 是实现层此前自行补的注释，
不是签核文本本身），修法引入了三处**本束未在签核时预见**的设计面，按
`contract-design.md`「covers 追加规则」第 3 条（零新增设计面）判定，**不满足自行
追加条件**，走 design-delta 记录在此，不自行改 `status`/`confirmed_by`/
`confirmed_at`：

1. **`call_skill` 的风险不再是固定档，改按目标 skill 判定**——`ToolRiskLevel`
   枚举本身不变（仍是 L0/L1/L2），但新增了"skill 怎样宣告自己的等级"这一层：
   平台官方目录固定 L0；第三方 skill 可在 `SKILL.md` frontmatter 声明
   `risk_level:`；都没有则缺省 **L1**（`packages/contracts/src/plan-permissions.ts`
   的 `SKILL_RISK_DEFAULT_LEVEL`）。**缺省档为什么是 L1 不是 L2，及一行改回 L2
   的方法，已写在该常量自己的文档注释里，请重点复核这一条**——它决定了"没写
   frontmatter 的第三方 skill 默认要不要问一次"。
2. **新增网关→内核投影键** `KERNEL_HITL_SKILLS_CONFIGURABLE_KEY`
   （`configurable.hitl_skill_names`）：网关把本次 run 挂载集合里 L2 skill 的
   stableName 名单告诉内核，`harness.py` 的 `_call_skill_requires_hitl` 谓词按
   它决定要不要为这次 `call_skill` interrupt；键缺席时 fail-closed 成"每次都
   问"（与本 feature 之前逐字相同）。与 `KERNEL_INTERJECTION_CONFIGURABLE_KEY`
   同一条既有先例（Phase 14 后续 A，#2755），走的是同一条 `configurable` 通道，
   不是新协议。
3. **F06 的四选一（`decideToolPermission`）从"从未被任何路由消费"变成"AG-UI
   resume 路径的真实出口"**——`decide-tool-permission.ts` 落地时已经写好，但
   `copilotkit-agui.controller.ts`/`agui-bridge.ts` 从未调用过它，`Pg
   ToolPermissionGrantRepository` 也从未注入 `AgentRunExecutor`（纯粹的接线
   缺口，不是新设计）。本次补上 `resumeAguiBridgeTurnToolPermission`，让 F08
   卡片的 `respond("once"|"run"|"forever"|"deny")` 真正路由到它。

不变的部分：`ToolRiskLevel` 三档语义、`StandingToolGrant` 存储粒度、
`decideToolPermission` 的输入输出契约形状——本次改动全部是"谁来决定 `call_skill`
的等级"这一件事，没有碰任何一个既有导出符号的形状。

② UI 材料不变（`ui.md` 的两张截图与既有 `ToolPermissionCard` 组件逐字未改，只是
新增了受控 props 与一个 `perm-affects` testid，视觉不变）。
