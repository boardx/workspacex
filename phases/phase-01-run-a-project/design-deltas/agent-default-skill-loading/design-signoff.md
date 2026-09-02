---
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: agent-default-skill-loading
base_bundle: skills   # 与 skill-lazy-loading / platform-owned-skills 同一挂靠：改的是"哪些 skill 进模型"，不是新开契约束
scope: agent-loads-all-enabled-skills-by-default-curated-agent-overrides-thread-mounts-append
covers: []   # 待人类/harness 回填 F 号（同 F979 / skill-lazy-loading 先例）
confirmed_by: usamshen
confirmed_at: 2026-09-02
confirmed_via: file
---

# design delta 签核 · agent 默认加载全部已启用 skill，具体 agent 的编排覆盖全局

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。GitHub：issue #2514。

## 这份 delta 为什么存在

2026-09-02 人类裁决原话：**skills 不由用户在 composer 里挑选**——agent 直接加载全部
已启用 skill；当用户选了具体 agent 时，该 agent 内部可以做 skill 编排，agent 的 skill
列表覆盖全局列表。

同日稍后的裁决（PR #2517）把 composer 的「技能」入口**保留**下来——两条裁决的分歧只在
UI 入口，不在服务端语义；人类 2026-09-02 晚间在会话里确认「默认可以调用任何可用的
skill；选了某个 agent 就用这个 agent 的 skills」，本 delta 据此重开。服务端此前的规则是 `run.skillVersionIds =
agent 钉的 ∪ 线程挂载`——用户不挂、agent 不钉，模型一个 skill 都收不到。这是一条
**运行时语义**的改动（哪些 skill 进 system prompt），ADR-023 之下不能免签。

## 签核前请确认的四条

- **① 默认 = 全部已启用**：agent 已发布版本没钉 skill 时，run 加载组织 + 平台组织
  全部「已启用且有已发布版本」的 skill，口径与 `listSkills` 目录逐字相同
  （`contract.md` §2）。⚠ 后果：已启用 skill 越多，system prompt 越长——非 deep-agent、
  非流式 run 走已签的 `skill-lazy-loading` 目录模式缓解；deep-agent run 全文进
  `input.system`（该 delta §1 明确不碰），这一点未变。
- **② agent 钉了 skill ⇒ 覆盖，不是并集**（`contract.md` §3）。选了精心编排的 agent，
  全局 skill 一个都不进。
- **③ 旧线程挂载保留，作为追加**（`contract.md` §4）：`/chat/legacy` 的
  `ChatSkillMountPanel` 不删；挂载在 ①/② 之上并集去重追加。默认加载已带上的 skill
  再挂是幂等的。⚠ 备选是整个下线 `thread_skill_mounts`（含控制器、面板、四个 e2e），
  本 delta **没有**选它——范围与裁决无关，留作后续独立决定。
- **④ 契约只加一个派生只读字段** `CapabilityListing.skillOrchestration`
  （`"all-enabled" | "curated" | null`，optional），不加写路径、不改表结构
  （`contract.md` §5）。

## 与既有已签内容的关系

- **不改** `skill-lazy-loading`：目录 + 按需展开机制原样，只是进入目录的 skill 变多。
- **不改** `platform-owned-skills`：平台 skill 的可见性/RLS 不动；它们因为「已启用」
  而自然进入默认加载（该 delta 曾登记「只做到能看到、能挂载，没有自动进入 run」，
  本 delta 把那一句关掉）。
- **不改** #1559 的挂载注入读口与其语义（并集/去重/顺序）。
