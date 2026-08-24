---
name: mod-chat
description: >
  聊天/对话模块的活知识库：apps/web 的聊天主界面（app/chat）与 apps/api 的
  chat 领域实现。动手改聊天消息渲染、工具调用可见性、共用壳文案、对话列表/
  会话流转之前必读——这里记录了代码地图、不能破坏的契约和前人踩过的坑。
---

# 聊天（mod-chat） — 模块知识库

> 本文件是 chat 模块的**单一经验沉淀点**：每模块一个 skill，让任何开发者
> （人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该知道：
> 代码在哪、什么不能破坏、前人踩过什么坑。

## 一句话定位
承载对话主界面（消息流、工具调用可见性、会话/预设/直播三种聊天形态）与其后端
chat 领域逻辑；不含 agent/skill 的运行时决策逻辑（那部分见 [[mod-agent-skill-runtime]]）。

## 代码地图
- 页面：`apps/web/app/chat`（子路由：`landing` 落地页、`preset` 预设对话、
  `live` 实时对话、`copilotkit-preview` 集成预览）
- API：`apps/api/src/application/chat`、`apps/api/src/domain/chat`、
  `apps/api/src/infrastructure/chat`
- e2e：`apps/web/e2e`（搜索聊天相关用例）
- 共享壳文案/UI 规范：见 `.harness/instructions/uiux-standards.md`

## 关键契约与不变量（改代码前必读）
- **工具调用可见性**：`apps/web/components/chat/ai-message.tsx`、
  `chat-live-message-panel.tsx` 是渲染工具调用状态的入口（源自 #728/#732 的
  「工具调用可见性渲染」改动，见提交 `d9561e71`）——新增消息类型/工具调用态
  优先扩展这两个组件既有的状态结构，不要另起一套渲染路径。
- **消息行结构演进历史**：近期几次改动（`ad07baf0`「D8/D2 裸原生 select 换手写
  选择器；编制行拆两行」、`99a1448e`「JSX 注释 markdown 加粗改纯文本」）都是
  lint-design 门控逼出来的修复——改消息行 UI 前先跑一遍 `lint-design.sh`，
  不要凭直觉写 className。
- <公开面/未登录可达的聊天页面清单——待核实，改动前先自己走一遍未授权视角>

## 架构知识
chat 是消费端：真正的 agent/skill 执行决策在 [[mod-agent-skill-runtime]]，
chat 只负责把执行状态（含工具调用）渲染出来、把用户输入送进去；两者共享
`packages/contracts` 里的消息/工具调用 schema。外部参照：Vercel AI SDK 的
`useChat` 用统一的 `parts` 数组承载文本/工具调用/附件等异构消息片段，本仓
`ai-message.tsx` 的状态结构可以对照这个思路检查是否有遗漏的消息片段类型。

## 关联阶段 / ADR / 文档
`phases/`（按当前 sprint 的 active-features.json 定位相关 feature）；
近期改动见 issue #728、#732

## 模块 SOP
1. 动手前：读本文件 + 对应 feature 的 `user_visible_behavior`/`verification`；跑
   `pnpm harness doctor --phase <相关 phase>` 确认没接手一个带审计债的现场。
2. 开发中：独立 worktree（ADR-005）；UI 改动跑 `lint-design.sh`；敏感 area 主动挂安全 review。
3. 交付：`verify --sprint` 门控；PR 描述里写清对上述契约的影响面。

## 踩坑与经验（append-only，最新在上）
- 2026-08-25：三方渲染库「不抛错但没渲染出内容」是一类不能靠 try/catch 兜住的失败——
  `pptx-preview` 的 `preview()` resolve 后 DOM 可能仍是空的/裸黑的（wrapper 硬编码
  `background:#000`，靠幻灯片内容盖住；`background-size` 传纯数字被浏览器当非法值丢弃，
  与上游未修复的 pptx-preview#12 对应）。只用 `vi.mock` 做组件测试测不出这类问题——
  mock 直接 resolve 掉，不会暴露「真实渲染完但 DOM 是空的」这种半失败态。教训：
  任何调用第三方渲染库的组件，「渲染完成」判定必须加渲染后体检（查真实产出的 DOM
  节点数），不能只信任 resolve/reject 语义；上线前必须用真实文件走一遍真实浏览器
  截图，mock 测试只能保证「UI 分支选对了」，保证不了「渲染器本身没有半成品失败」
  （出处：PR #1997，跟进 #1980）。
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
