# 需求录入流水线（新阶段开工前）

> 渐进式披露第 2 层。根 `AGENTS.md` 只留一条索引指到这里(#390:目录页有 140 行硬预算,
> 执行书不住在目录页里)。本文件是这条流水线的**唯一原文**——根 `AGENTS.md`、
> `phases/<phase>/phase.md` 只许引用,不许把步骤复述回去。
>
> **一句话**:原始需求 → 智能体 → 权威功能清单。`requirements/` 是**输入,不是权威**;
> 权威永远是 `feature_list.json`。

## 五步

1. `pnpm harness new-phase [--ui]` scaffold 出 `phases/<phase>/requirements/` 文件夹
   （`--ui` = 有界面的阶段,会一并建出 UI 先行所需的目录）。
2. 把**原始需求**（大白话 / 用户故事）写进该文件夹,可按领域放多份 `*.md`
   （`auth.md` / `teams.md` / `rooms.md`……）。这一步不要求形式化,要求**真实**——
   裸模板会被 `hasRequirementsCoverage` 判定为没有覆盖（见 `contract-design.md`）。
3. **UI 先行**（ADR-003）：有界面的阶段由 **ui-prototyper** 用真实组件
   （`apps/web` + mock）把界面做出来、截图存 `phases/<phase>/ui-preview/`——它是签核
   第 ① 件的材料,不再单独签一次。八条硬规则的原文见
   `.harness/instructions/ui-prototyper-hard-rules.md`。
4. 调 **requirement-author** 智能体：读该文件夹全部 `*.md`（UI 阶段还读已建成的 UI）→
   生成 / 更新 `feature_list.json`（每个 feature 带可执行 `verification`,锚定真实
   `data-testid`,带 `spec_ref` 回指需求出处）。
5. **设计签核关卡**（ADR-023）：**UC + UI 不足以确认整个设计**——后端契约会在画界面时
   被顺手创造出来却无人评审。按能力域切**契约束**,人类在束级 `design-signoff.md`
   一次签三件（UI / 用例 / API 契约）,再做**阶段一致性复核**（查各束交叉约束是否打架）。
   判定规则以根 `AGENTS.md` 硬约束「设计签核(三件、一处签)」为准,本文件不复述;
   细则、支撑材料与逃生口见 `.harness/instructions/contract-design.md`。

## 开工判据

一个 feature 可开工 ⟺ **所属契约束已签** ∧ **阶段一致性复核通过**。
两者都是人的动作,agent 不许改 `design-signoff.md` 的 status——机械核对见
`.harness/scripts/lib/design-signoff.ts`。
