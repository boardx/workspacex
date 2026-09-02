# contract · agent 默认加载全部已启用 skill，具体 agent 的编排覆盖全局

> 规范唯一来源。签核口径见同目录 `design-signoff.md`，验收口径见 `verification.md`。
> 触发缘由：2026-09-02 人类裁决（issue #2514）。

## §0 现状核实（读代码）

- run 的 skill 列表在 `acceptHumanMessage`（`message-roundtrip.ts`）定型为不可变快照
  （D-30）：`withThreadMounts(agentSnapshot, mounts)` = `agent_versions.skill_version_ids
  ∪ thread_skill_mounts`，写进 `agent_runs.skill_version_ids`；`execute-run.ts` 经
  `readPinnedSkills` 读 `SKILL.md` 正文拼 `buildSystemPrompt`。
- REST（`chat.controller.ts`）、CopilotKit v2 桥接（`agui-bridge.ts`）、计划确认
  （`accept-message-plan-run-creator.ts`）三条轨道都过 `acceptHumanMessage`。
- **结论**：用户不挂、agent 不钉 ⇒ 模型收不到任何 skill。前端已移除挂载入口 ⇒ v2 用户
  在任何情况下都拿不到 skill。

## §1 规则（唯一实现：`message-roundtrip.ts` `resolveRunSkillVersionIds`）

```
resolved = (agentPinned 非空 ? agentPinned : orgEnabled) ∪ mounted
```
并集 / 去重 / 顺序（底座在前、挂载追加在后、先出现的留原位）三条语义**复用**
`withThreadMounts`，不写第二份。

## §2 默认加载：`orgEnabled` 的口径

新读口 `EnabledSkillVersionReader.currentEnabledSkillVersionIds(orgId)`
（`message-command-ports.ts`；PG 适配器 `pg-enabled-skill-version-reader.ts`）：
- `skills.status = 'enabled'`，`org_id ∈ {自己, org-platform}`——与
  `pg-skill-contract-repository.ts` `listAll()` wave2 分支的 WHERE 逐字相同；
- 每个 skill 取最新一条 `published` 的 `skill_versions`（同 `listAll()` 的子查询）；
  没有已发布版本的 skill **不进**（进了 run 会 `SKILL_VERSION_UNAVAILABLE` 整体失败）；
- 只含模型 A（`skills`/`skill_versions`）；模型 B `skill_contracts` 的「已启用」不进
  （`readPinnedSkills` 读不到它的正文，理由同 #1559）；
- 顺序 `skills.created_at ASC, id ASC`；
- 返回 `Guarded`，调用方 `discloseDecided`（同 `ThreadMountedSkillReader`）。
- **只在 `agentPinned` 为空时读**——钉了就是覆盖，连读都省掉。

## §3 agent 级覆盖

`agent_versions.skill_version_ids` 非空（后台 A2 pin，`set-agent-skill-pins.ts`）⇒
`resolved` 的底座就是它，`orgEnabled` 一个都不进。**不新增任何 agent 配置字段**：
「钉了什么」已经是 agent 编排的事实源，再加一个「模式」字段就是同一事实声明在两处。
⚠ 表达不了「钉了但要空」——一个 agent 钉空数组 = 走默认。今天没有这个需求；要它时
另开 delta。

## §4 旧线程挂载（`thread_skill_mounts`）的去留：保留，作为追加

- `/chat/legacy`（`chat-read-screen.tsx` / `personal-chat-screen.tsx`）的
  `ChatSkillMountPanel`、`skill-mount.controller.ts`、`ThreadMountedSkillReader` 全部不动。
- 优先级：挂载在 §2/§3 之上**追加**（并集去重）。默认加载已带上的 skill 再挂是幂等；
  对钉了 skill 的 agent，挂载是「在编排之上临时加一个」。
- v2 轨道不再有挂载入口，但同一条线程若在旧轨道挂过，v2 的 run 照样带上（同一条
  `acceptHumanMessage`）。

## §5 契约改动（`packages/contracts/src/identity.ts`）

- 新增 `SkillOrchestration = z.enum(["all-enabled", "curated"])`。
- `CapabilityListing.skillOrchestration: SkillOrchestration.nullable().optional()`——
  **派生只读投影**：`kind === 'agent'` 且已发布版本钉了 skill ⇒ `curated`；没钉 ⇒
  `all-enabled`；非 agent / 读不到已发布版本 ⇒ null；写路径的 RETURNING 不带（缺省）。
  唯一产出点 `pg-capability-repository.ts` 读路径的 LEFT JOIN `agents → agent_versions`。
- 不改表结构、不加迁移、不加写路径。

## §6 改动点清单

1. `message-command-ports.ts`：`EnabledSkillVersionReader` + `ENABLED_SKILL_VERSION_READER`。
2. `message-roundtrip.ts`：`Deps.enabledSkills`（**必填**，同 `threadMounts` 的理由）、
   `resolveRunSkillVersionIds`、`acceptHumanMessage` 改用它。
3. `pg-enabled-skill-version-reader.ts`（新）。
4. 合成点：`kernel.module.ts`、`chat.controller.ts`、`copilotkit-agui.controller.ts`、
   `agui-bridge.ts`、`accept-message-plan-run-creator.ts` + 四个 plan-control 真栈测试。
5. 契约 + `pg-capability-repository.ts` + 重新 `gen:mock`。
6. e2e：`copilotkit-v2-skill-mount.spec.ts`（前端分支已改写）转绿；
   `chat-agent-skill-context.spec.ts` 第二条按 §4 改写（旧对照在新规则下不可能成立）。
7. `.harness/instructions/chat-task-workbench-acceptance.md` TW-P0-5 括注。
