---
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: deep-agent-skill-catalog
base_bundle: skills   # 与 skill-lazy-loading / agent-default-skill-loading 同一挂靠
scope: single-snapshot-rule-for-run-skills-remove-readPlatformSkills-deep-agent-system-prompt-catalog-only
covers: []
confirmed_by: null
confirmed_at: null
confirmed_via: null
---

# design delta 签核 · skill 加载收敛为快照单一规则；deep-agent 的 system prompt 只放目录

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：[`contract.md`](./contract.md)。验收口径：[`verification.md`](./verification.md)。GitHub：issue #2534。

## 这份 delta 为什么存在

#2519（agent 默认加载全部已启用 skill）与 #2515（deep-agent 执行期并入平台 skill）前后脚合入，
「这次 run 用哪些 skill」在快照与执行期各说一套；且 #2519 把全部已启用 skill 的**全文**贴进
deep-agent 的 system prompt——正是 #2515 实测要削的延迟。人类 2026-09-03 裁决收敛。

## 签核前请确认的三条

- **① 唯一规则留在快照**：删除 `AgentRunStore.readPlatformSkills`（端口 + PG + 消费点）。
  平台已启用 skill 本来就在 #2519 的默认加载集合里，且 curated agent 的覆盖在 deep-agent
  上也成立（此前被 `readPlatformSkills` 绕过）。
- **② deep-agent 的 system prompt 改成目录**（`buildSystemPrompt` 新模式
  `"deep-agent-catalog"`）：每个 skill 一行 `- stable_name: 摘要` + 一句「用 `call_skill`
  按需取全文」；全文只经 `org_skills` 到远端。⚠ 这**修订**已签 delta `skill-lazy-loading`
  §1「deep-agent 一行不改」与其 V5「deep-agent 逐字节不变」——那条口径成立的前提是
  「只有挂载的少数几个 skill」，#2519 之后前提没了。
- **③ e2e 取证信号随之搬家**：`loopback-deep-agent-provider` 改在 `org_skills[].content`
  里看哨兵 `MOUNTPROOF-9317`，不再看 `role:"system"`。`copilotkit-v2-skill-mount` 断言
  不变（哨兵回显 ⇔ skill 正文真的到了远端）。

## 与既有已签内容的关系

- **修订** `skill-lazy-loading` §1 / V5（见上 ②）；§2 的 `read_skill` 文本协议仍只给纯
  provider，deep-agent 不解析它，目录块里也不写它。
- **不改** `agent-default-skill-loading`：`resolveRunSkillVersionIds` 一行不动，它现在是唯一规则。
- **不改** `platform-owned-skills`：可见性/RLS 不动。
