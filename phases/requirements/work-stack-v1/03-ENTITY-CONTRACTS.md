# WorkspaceX Work Stack v1 — Entity Contracts

## SkillDefinition
stable_id, name, domain, source_strategy, provenance[], risk_class, required_primitives[], optional_tools[], context_policy, permission_policy, input_schema, output_schema, eval_suite_id.

## WorkflowDefinition
stable_id, name, trigger_schema, state_machine_version, stages[], skill_pins[], tool_requirements[], gates[], retry_policy, idempotency_policy, recovery_policy, audit_policy, eval_suite_id.

## DigitalHumanDefinition
stable_id, name, avatar_asset_id, role_policy, delegation_policy, escalation_policy, mounted_skill_pins[], workflow_pins[], model_policy_id, tool_policy_id, context_policy_id, memory_scope, eval_suite_id.

## Versioning
- Definition 修改产生新 version；run 必须 snapshot version。
- Skill pin / Workflow pin / DigitalHuman pin 全部指 immutable version。
- Avatar 是 versioned asset，但不改变 Digital Human stable id。
- 任一 source/license/dependency 变化都可使旧 eval evidence stale。

## API 原则
- Contracts 只定义一次，TypeScript/Zod 为 WorkspaceX web/api 的权威；Python 侧跨语言一致性必须有会红测试。
- 前端不得复制 enum/阈值。
- 写 API 必须带 expectedRevision/CAS。
