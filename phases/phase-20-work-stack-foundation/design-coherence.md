---
phase: "20"
covers_bundles: [work-skill-meta, workflow-runtime, agent-role, work-eval, work-content]
status: pending
---

# Phase 20 阶段一致性复核

> 待人类复核。只检查跨束问题：同一事实是否在两个束里各声明一次、不变量是否互相矛盾、级联是否闭合、同一失败是否在不同束里给了不同错误码。
> 人类授权（2026-09-28）：先行开发，签核与本复核稍后补做；agent 不修改本文件的 status / confirmed_* 字段。

## 复核范围

| 束 | 核心不变量 | 主要交叉边界 |
|---|---|---|
| `work-skill-meta` | Work Skill 元数据写在不可变版本的 manifest；目录状态在可变表 | work-eval（门状态回写目录）、work-content（Skill 包） |
| `workflow-runtime` | 业务行是事实、checkpoint 只是编排状态；副作用必有 receipt；执行前重查权限；实例固定版本 | agent-role（Workflow 白名单）、work-content（Workflow 定义） |
| `agent-role` | Agent 即数字人，不建第二身份；新字段随版本快照冻结；官方包只声明能力分类不带授权 | workflow-runtime（白名单执行点）、work-content（官方角色包） |
| `work-eval` | 只有过 G5 的 Skill 才能标 verified；门状态单一来源 | work-skill-meta（catalog 状态字段） |
| `work-content` | 实体内容来自已 PASS 的 v2 需求；组合关系以矩阵为准，不另存 | 以上全部 |

## XC-01 · 同一事实只声明一次
- [ ] Skill 发布渠道（candidate / verified / deprecated）只在 `work-skill-meta` 定义；`work-eval` 只写入、不另定义枚举。
- [ ] Workflow 白名单的数据结构只在 `agent-role` 定义；`workflow-runtime` 只读取并执行。
- [ ] 组合关系（Workflow→Skill、Agent→Workflow/Skill）只来自两张 v2 矩阵，任何束都不存副本。

## XC-02 · 错误码一致
- [ ] 权限被撤销、审批被拒、版本不存在这三类失败，在 workflow-runtime / agent-role / work-content 里使用同一组错误码。

## XC-03 · 级联闭合
- [ ] Skill 版本被 deprecated 时，引用它的已发布 Workflow 版本与角色 Agent 的处理规则在各束一致。
