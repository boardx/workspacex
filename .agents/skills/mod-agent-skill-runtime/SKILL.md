---
name: mod-agent-skill-runtime
description: >
  Agent/Skill 运行时与相关 API 契约的活知识库：agent 定义/导入/运行、skill 装配、
  MCP 接线、模型路由、context-pack、provenance，以及 packages/contracts 里这些
  领域对应的契约单源。动手改 agent 运行逻辑、skill 持久化、工具调用协议或相关
  契约 schema 之前必读。
---

# Agent/Skill 运行时（mod-agent-skill-runtime） — 模块知识库

> 本文件是 agent-skill-runtime 模块的**单一经验沉淀点**：每模块一个 skill，让
> 任何开发者（人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该
> 知道：代码在哪、什么不能破坏、前人踩过什么坑。

## 一句话定位
承载 agent 的定义/导入/运行与 skill 的装配/导入/持久化能力，以及支撑这两者的
MCP 接线、模型路由、context-pack、provenance；不含对话 UI 本身（见 [[mod-chat]]）。

## 代码地图
- API 领域：`apps/api/src/application/{agent,agent-run,agent-skill-pins,agent-import,skill,skill-import,mcp,model,context-pack,provenance}`
- API 基础设施：`apps/api/src/infrastructure/{agent,agent-run,skill,model,context-pack,provenance}`
- API 领域模型：`apps/api/src/domain/{agent,skill,model}`
- 页面：`apps/web/app/skill`、`apps/web/app/brain`、`apps/web/app/preview/agent-runtime`
- 契约单源：`packages/contracts/src`（`project.ts`/`context-pack.ts`/`provenance.ts` 等）——
  这是 API 契约的唯一权威，改字段先改这里，不要在 controller 里另起一套

## 关键契约与不变量（改代码前必读）
- <agent/skill 的权限与鉴权顺序：新端点必须逐行复用哪个既有实现，禁止另起一套>
- <契约变更的兼容性要求：`packages/contracts` 改动影响面覆盖 web+api，谁改谁核对双端>
- <公开面/未登录可达的 agent/skill 相关端点清单>

## 关联阶段 / ADR / 文档
`phases/`（按当前 sprint 的 active-features.json 定位相关 feature）；
契约设计流程见 `.harness/instructions/contract-design.md`。

## 模块 SOP
1. 动手前：读本文件 + 对应 feature 的 `user_visible_behavior`/`verification`；跑
   `pnpm harness doctor --phase <相关 phase>` 确认没接手一个带审计债的现场。
2. 开发中：独立 worktree（ADR-005）；契约字段变更先改 `packages/contracts`，
   再改依赖它的 web/api 两端；敏感 area 主动挂安全 review。
3. 交付：`verify --sprint` 门控；PR 描述里写清对上述契约的影响面。

## 踩坑与经验（append-only，最新在上）
<空着开始。格式：`- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`>

## 知识回流规则（本文件怎么迭代——这是这个 skill 存在的意义）

1. **谁干活谁回流**：在本模块交付 feature/修 bug/做 review 时，踩到新坑、建立新做法、
   推翻旧假设 → 在同一个 PR（或紧随的小 PR）往上方"踩坑与经验"**追加**一条：
   `- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`。append-only，不删旧条目
   （被推翻的旧经验标 ~~删除线~~ 并注明被哪条取代）。
2. **module coordinator 每 C-cycle 复盘**：检查本周期内本模块合并的 PR，有值得沉淀而
   没回流的，补写。
3. **结构变更**（新增章节/重组）走正常 review；追加"踩坑与经验"条目可随任意 PR 顺带。
4. 开源贡献者同权：任何人对本模块的经验修订都走 PR，以可验证事实为准，不看资历。
