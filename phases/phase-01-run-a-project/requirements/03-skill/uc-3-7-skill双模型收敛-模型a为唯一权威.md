# 原始需求（细化）— UC-3.7 Skill 双模型收敛：模型 A 为唯一权威，模型 B 冻结只读

> 所属：阶段一 · 能跑完一场项目 / M3 上传 Skill（技术债收敛，非新增用户可见能力）
> 来源：issue #598（debt 登记）→ design-delta `skill-model-a-b-convergence`
>   （**已签核，选项②，2026-08-16，yanbin shen**）——本文只是把已签核的技术决定
>   转成 requirement-author 能读的输入格式，**不重新论证方向**，方向以
>   `phases/phase-01-run-a-project/design-deltas/skill-model-a-b-convergence/`
>   三件套为唯一权威（尤其 `contract.md` §0 现状核实 + §1 选项②）。
> 与常规 UC 的差异：本用例**不新增用户可见能力**，是收敛一个已签 `skills` 束
> （F61-F68, F176）内部两套互不连通实现模型的技术债——用户侧唯一可感知的变化是
> `/skill` 库屏的"完全新建"入口消失（改并入 A 的编辑器工作流）。

## R1 概览

- **Use Case ID / 名称**：UC-3.7 / Skill 双模型收敛
- **Actor**：能力维护者（后台 Skill 库屏的使用者）
- **目标**：消除"同一事实声明在两处"——模型 B（`skill_contracts`/`skill_contract_versions`，
  声明式契约）冻结为只读 legacy，模型 A（`skills`/`skill_versions`/`skill_version_files`，
  wave2 文件式，运行时唯一真读的一套）成为**唯一**可写入口。
- **系统边界**：`POST /skills`（`createSkillDraft`）写入路径、`/skill` 库屏"完全新建"面板、
  `GET /skills/:skillId` 详情读取路径、`packages/contracts/src/skills.ts` 契约标注。
  **不触碰**：F595 已落地的导入/目录/编辑/试跑（全部已在模型 A，本用例不改）；
  `GET /skills` 列表合并读逻辑（`pg-skill-contract-repository.ts:listAll`，已经是 A+B
  合并，保持不变）；`capability_listings` 目录投影（两模型的既有交汇点，保持不变）。

## R2 前置条件 / 触发条件

- **前置条件**：design-delta `skill-model-a-b-convergence` 的 `design-signoff.md`
  `status: confirmed`（已满足，见上）。
- **触发条件**：本 issue 由 harness readiness 统一队列的 #624（admin→chat 全链路核心闭环）
  追出——#624 的最后一个子缺口就是本用例代表的这条收敛。

## R3 主流程

1. **契约层**：`packages/contracts/src/skills.ts` 里的 `createSkillDraft` 操作标记废弃
   （不删除定义本身——存量调用方/测试仍需引用到它曾经存在过；新增到
   `SKILLS_FORBIDDEN_ROUTES` 或等价的路由级禁用机制，防止未来有代码悄悄复活这条写路径）。
2. **后端**：`skill.controller.ts` 的 `POST /skills` 路由摘掉，或改为对新请求一律返回
   410 Gone（附带指向模型 A 编辑器工作流的引导信息，不是裸 404/500）。
3. **后端**：`get-skill-detail.ts` 的 `loadDetail`（`GET /skills/:skillId`）**保持不变**——
   继续只读模型 B，因为这条读路径是给**存量** B 行用的（VG：不删数据、不 404 化存量）。
   本用例不新增对模型 A 行的详情读（那属于 delta `contract.md` 选项①/③才需要的能力，
   选项②不需要——A 行的详情本就走 `AgSkillEditor`，不经过这个端点）。
4. **前端**：`skill-catalog-live.tsx` 移除"完全新建"面板与其触发 `createSkillDraft`
   的调用（:820 附近）；引导用户改走已有的导入/文件编辑器工作流（URL 导入、文件上传、
   或从 starter-pack 起步后编辑）。
5. **前端**：`WAVE2_BACKED_DUTY_MARKER` 哨兵字面量与 A/B 分流逻辑保持不变——
   已存在的模型 B 行（历史遗留）继续在列表里正常显示、可点开只读详情。
6. **测试**：更新 `skill-contract-crud.test.ts` 等依赖 `createSkillDraft` 仍可写的测试，
   改为断言"新写入路径已关闭、存量数据仍可读"这个新语义，不删测试、不跳过断言。

## R4 备选流程与异常流程

- **异常流程**：
  - E1：对已冻结的 `POST /skills` 发起请求（遗留调用方/直连脚本）——服务端明确拒绝
    （410），不得静默成功也不得裸 500。
  - E2：存量模型 B 数据在冻结后依然可通过 `GET /skills/:skillId` 只读——若发现任何路径
    导致存量数据不可读或被误删，判失败（VG 硬约束，见 delta `verification.md`）。

## R5 权限与可见性

- 与既有 `skills` 束的权限模型不变（能力维护者可写、其余角色按既有可见性规则），
  本用例不新增权限维度，只是关闭一个写入口。

## R6 后置条件 / 不包含

- **正常后置条件**：
  - `POST /skills` 不再是任何生产代码/前端的可达写入口。
  - 存量 `skill_contracts`/`skill_contract_versions` 数据保持只读可访问，
    `GET /skills` 合并列表与 `GET /skills/:skillId` 详情两条读路径行为不变。
  - F595 已落地的导入/目录/编辑/试跑路径（全部模型 A）行为不变。
- **不包含**：
  - 模型 B 存量数据的迁移到模型 A（那是 delta 选项①的范围，本用例是选项②，明确不迁移）。
  - B→A 的编译桥（delta 选项③的范围，本用例不做）。
  - D08（`SkillStatus` 状态枚举五态 vs 四态）的裁决——与本用例正交，不在此处顺带解决。

## R7 业务规则

- **[已签核 · design-delta 选项②]** 模型 A 是唯一权威写入口；模型 B 冻结为只读 legacy，
  不删除存量数据。
- 冻结动作必须是**唯一入口被摘**，不是"前端按钮藏起来但接口还在"——契约层与路由层都要
  真实关闭（对应 delta `verification.md` 选项②·V2 的反证要求）。

## R8 界面线索

- **前端入口（变化点）**：`/skill` 库屏（`skill-catalog-live.tsx`）"完全新建"面板移除。
- **必须呈现的状态**：入口移除后，原按钮位置的替代引导（指向导入/编辑器工作流）需给出
  真实空态/引导态，不是留一个死链接或裸消失。

## R9 非功能约束

- 无新增性能/规模要求；冻结动作本身应是低风险的路由/契约层改动，不涉及数据迁移
  （数据迁移属选项①范围，本用例不做）。

## R10 已知约束 / 依赖

- 依赖 design-delta `skill-model-a-b-convergence`（已签，选项②）——规范唯一来源。
- 与 F595（已完成）不冲突，本用例不改 F595 已落地的行为。
- 派工节奏提示（来自 delta `contract.md` §3）：`skill.controller.ts` /
  `pg-skill-contract-repository.ts` / `skill-catalog-live.tsx` 是 #595/#662/#689 系列
  反复 touch 的热点，建议与当前活跃的 skill 相关分支串行化，不并行改。

## R11 切分提示（给 requirement-author）

- 建议整体作为**一个** feature（工作量档位 M，属收敛性质，拆得更碎反而增加"半收敛"状态
  的风险——写路径摘掉和存量只读验证应该在同一个 PR 里一起验收）。
- 验收命令建议覆盖：契约层废弃标注的类型检查、`POST /skills` 返回 410 的真栈反证、
  存量数据经 `GET /skills`/`GET /skills/:skillId` 仍可读的真栈反证、前端"完全新建"入口
  确实不可达的组件测试。

## R12 AI Ready 验收线索

- V1：对 `POST /skills` 发起真实 HTTP 请求，断言返回 410（不是 404/500/200）。
- V2：`skill-catalog-live.tsx` 渲染后，DOM 中不存在触发 `createSkillDraft` 的"完全新建"
  按钮（真栈组件测试，不是快照比对）。
- V3：构造一条已存在的 `skill_contracts` 记录，冻结后仍能通过 `GET /skills`（出现在合并
  列表里）与 `GET /skills/:skillId`（详情可读）访问到，内容与冻结前一致。
- V4：F595 覆盖的导入/编辑/试跑测试套件（模型 A 路径）在本次改动后仍全部通过，
  无回归。
