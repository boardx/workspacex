# contract · skill 加载收敛为快照单一规则；deep-agent 的 system prompt 只放目录

> 规范唯一来源。签核见 `design-signoff.md`，验收见 `verification.md`。触发缘由：issue #2534。

## §0 现状（main 3642c6a2）

| | #2519 | #2515 |
|---|---|---|
| 位置 | `acceptHumanMessage` → 快照 `skill_version_ids` | `execute-run.ts` 执行期 `readPlatformSkills` |
| 范围 | 组织+平台全部已启用；agent 钉了则覆盖 | 只平台；只 deep-agent；并集 |
| 进 system prompt | 是（deep-agent 全文模式） | 否，只进 `toolSkills` |

后果：延迟回归（全部已启用 skill 全文每轮进 deep-agent system prompt）、curated 覆盖被绕过、同一事实两处声明。

## §1 唯一规则

`resolveRunSkillVersionIds`（`message-roundtrip.ts`，delta `agent-default-skill-loading`）是
「这次 run 用哪些 skill」的唯一实现。执行期 `execute-run.ts` 只 `readPinnedSkills(run.skillVersionIds)`，
不再读任何目录。删除 `AgentRunStore.readPlatformSkills`（`ports.ts`）、`PgAgentRunRepository.readPlatformSkills`、
`execute-run.ts` 的并入块。

## §2 deep-agent 的 system prompt

`buildSystemPrompt(..., "deep-agent-catalog")`（`skill-catalog.ts` `buildDeepAgentSkillCatalogBlock`）：
- 条目与 `"catalog"` 同一份（同一个 `deriveSkillSummary`）；
- 取全文的说明指向远端真实工具 `call_skill` / `list_org_skills`，**不写** `read_skill` 围栏；
- 0 个 skill 时三种模式输出逐字相同；
- `toolSkills`（→ `org_skills`，含全文）与沙箱协议门不变。

判据：`run.modelProvider === DEEP_AGENT_PROVIDER_NAME`。纯 provider 路径（`"catalog"` / `"full"`）一行不改。

## §3 e2e 取证信号

`loopback-deep-agent-provider.ts` `mountedSkillReachedUpstream(body)`：在
`body.config.configurable.org_skills[].content` 里找哨兵；仍只看本轮真实字节。全文若被贴回 system
而 `org_skills` 漏了，替身如实不回显，e2e 红——这是新的反证方向。

## §4 对已签 delta 的修订

`skill-lazy-loading` §1「deep-agent 一行不改」、V5「deep-agent 逐字节不变」作废，由本 delta 取代；
`skill-lazy-loading.test.ts` V5 改为断言 deep-agent-catalog 形状。
