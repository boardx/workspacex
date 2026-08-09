---
status: proposed
bundle: agent-instructions
scope: user-created-agent-executable-definition
---

# 用户自建 Agent 的「可执行定义」 —— 设计签核（#660 勘探产出）

这是一份**新的 delta 包**。它不修改、也不重新确认任何已签核的束。
本文件的每一次 status 变更都归人类所有——**agent 不得改 status**（ADR-023）。

## 为什么需要它（实测，不是推测）

#660 的现象是「新建的 Agent 永远是草稿，发消息报 422」。接线发布路径时实测发现，
**发布状态机接通之后 422 依然存在**，因为缺的不止是发布动作：

| 事实 | 实测证据 |
|---|---|
| chat 执行链路读 `agents.published_version_id` → `agent_versions` | `pg-chat-message-command-repository.ts:172-176` 的 `resolvePublished` SQL |
| `agent_versions.instructions` 是 **NOT NULL** | `\d agent_versions` |
| **用户自建 agent 没有 instructions** | `agents` 表无该列；`grep instructions packages/contracts/src/agent-runtime.ts` **零命中**；`updateAgentDefinition.in.patch` 也没有该字段 |

⇒ 今天能执行的 agent **只有** starter-pack 导入与 `ensureSystemAgent` 系统预置这两条**文件源**
路径造出来的（它们自带 `template.instructions`）。**浏览器里建出来的 agent 没有任何字段能承载
「这个 agent 到底执行什么」**，因此即使发布门全过，也拼不出一条可执行的 `agent_versions` 行。

这与 #619 记录的「agent 三套模型断层」是同一根问题在**执行轴**上的显形，也是 #564
「73% 契约无路由」的一个实例。

## ① UI

待定——取决于 ③ 的裁决。若引入 `instructions`，管理端 agent 详情页需要一个多行编辑区，
且要与 skill 的「声明式契约」编辑体验对齐（避免第二套心智模型）。

## ② 用例

UC-4.1 R3 的步骤 8/9/10（试跑 / 提交发布 / 批准发布）今天**默认 agent 是可执行的**，
但没有任何用例说明「它执行什么」是谁、在哪一步写进去的。**这一步在现有用例里是缺失的**，
不是被省略的。

## ③ API 契约 —— 需要你先拍板

**裁决点：用户自建 agent 的「可执行定义」从哪来？**

| 候选 | 做法 | 优点 | 代价 / 风险 |
|---|---|---|---|
| **A：给 `updateAgentDefinition.patch` 加 `instructions`，`agents` 加列** | 与 modelId 同一条写路径 | 改动面最小；与既有编辑流一致 | 新契约字段 + 新列；需要考虑长度上限、是否进审计、改了要不要重新评审 |
| **B：instructions 由挂载的 skill 组合而成，agent 本身不存** | 复用 `skill_mounts` | 不新增「第二种提示词事实源」；与「能力由 skill 提供」的架构叙事一致 | 需要定义组合顺序与冲突规则；空 skill 的 agent 无法执行 |
| **C：沿用 starter-pack 的模板概念，用户自建时必须选一个模板** | 新建时挑模板，instructions 来自模板 | 与今天唯一能跑的路径同源，风险最低 | 用户不能自由定义行为，等于「只能用预置的几种 agent」 |

⚠ 三个候选都**改变契约面**，按 ADR-023 必须人类先签核，agent 不得自行选定。

**我的读法（不是决定）**：证据略微偏向 **A**——`agents` 表已经在收敛「用户自建 agent 的定义」
（#617 加了 initials/role/visibility/model_id 等一整批列），instructions 是这批列里**唯一缺的
那个语义核心**；B 更漂亮但需要额外定义组合语义，属于更大的一次设计。

⛔ 在本文件签核之前，实现侧**不得**用 `role` / `name` 之类现有字段硬凑 instructions——
`role` 是「角色标签」不是「系统提示词」，运行时会真的按它执行，属于会产生错误行为且难察觉的漂移。
（人类裁决 2026-08-09 已明确否掉这条捷径。）

## 与 #660 的关系

#660 本轮交付的是**发布状态机**（submit / decide 两条路由 + 三道门），
它本身是完整且有价值的（它让「谁能批准」「什么条件下能上线」第一次真的生效）。
但 #660 验收里的最后一步「发消息→拿到真实执行结果」**依赖本 delta 签核后的实现**。

## 怎么签

把上面的 `status: proposed` 改成 `status: confirmed`，并补上：

```yaml
status: confirmed
confirmed_by: "<你的名字>"
confirmed_at: "<ISO8601 时间戳>"
```

签之前请先在 ③ 的三个候选里选一个（或给出第四种）。
