---
name: mod-research-studio
description: >
  Research/Studio 模块的活知识库：研究流程、访谈（interview）、录制（recording）、
  检索（retrieval）、模板（templates），对应 apps/web 的 studio/research/tasks/rec/itv
  各子路由。动手改研究工作流、访谈录制、检索排序或模板系统之前必读。
---

# Research/Studio（mod-research-studio） — 模块知识库

> 本文件是 research-studio 模块的**单一经验沉淀点**：每模块一个 skill，让任何
> 开发者（人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该知道：
> 代码在哪、什么不能破坏、前人踩过什么坑。

## 一句话定位
承载研究工作流（research）、访谈（interview）、录制（recording）、检索（retrieval）
与模板（templates）；是产品里"做研究"这条主线的后端与前端实现。

## 代码地图
- 页面：`apps/web/app/research`、`apps/web/app/studio`
  （子路由：`research`/`prototype`/`interview`/`survey`）、
  `apps/web/app/tasks`、`apps/web/app/rec`、`apps/web/app/itv`（`itv/live`）
- API 领域（实测各层实际存在的目录，不是统一三层）：
  - `research`：只有 `apps/api/src/domain/research`（没有独立的 application/
    infrastructure 层，逻辑薄或挂在别的领域下，改动前先确认调用方在哪）
  - `interview`/`recording`/`retrieval`：三层齐全，
    `apps/api/src/{application,infrastructure,domain}/{interview,recording,retrieval}`
  - `templates`：只有 application + domain 两层，
    `apps/api/src/{application,domain}/templates`（没有 infrastructure 层）

## 关键契约与不变量（改代码前必读）
- <录制/访谈涉及的隐私与留存策略——待核实具体实现，改动前先在
  `apps/api/src/{application,domain}/recording` 里确认现有约束，不要假设>
- <检索排序逻辑的既有假设——待核实>
- <公开面/未登录可达的研究/访谈相关端点清单——待核实>

## 架构知识
研究工作流的产品形态接近"访谈转录 → 标签/洞察沉淀 → 检索复用"这条链路（外部
参照：Dovetail、Grain 这类用户研究工具把"转录"和"洞察库"分成两个可独立复用的
层）；本仓对应的是 `recording`（原始素材）→`interview`（结构化产物）→
`retrieval`（跨会话检索）三个领域的分工，改动前先想清楚自己的改动落在哪一层，
不要在 `interview` 里直接操作 `recording` 的存储细节。

## 关联阶段 / ADR / 文档
`phases/`（按当前 sprint 的 active-features.json 定位相关 feature）

## 模块 SOP
1. 动手前：读本文件 + 对应 feature 的 `user_visible_behavior`/`verification`；跑
   `pnpm harness doctor --phase <相关 phase>` 确认没接手一个带审计债的现场。
2. 开发中：独立 worktree（ADR-005）；UI 改动跑 `lint-design.sh`；敏感 area（录制/隐私）
   主动挂安全 review。
3. 交付：`verify --sprint` 门控；PR 描述里写清对上述契约的影响面。

## 踩坑与经验（append-only，最新在上）
- 2026-09-06：五步研究复用 BoardX Google 搜索代理时，适配 GET q 与 results/title/url/snippet 协议；snippet 只代表检索摘要，不冒充全文，部署时移除旧 Tavily endpoint 覆盖。缺密钥导致的旧失败任务可在接入后直接重试，无需重建会话（出处：issue #2815）。
- 2026-09-06：确认后自动生成下一步骤须先展示目标步骤 loading，再用确认返回的版本提交下一命令；并发新快照与离开会话后的迟到响应不得触发自动生成。没有本地竞争草稿时直接恢复服务端进度，避免空恢复面板阻断工作（出处：issue #2803）。
- 2026-09-05：研究命令失败后，读取最新服务端快照不能覆盖未提交的本地草稿；应保留编辑、阻止自动重放模型命令，并由用户选择采用最新进度或继续编辑。首次恢复失败须提供原地重试入口（出处：issue #2791）。
- 2026-09-05：研究会话迁移须保留旧 checkpoint 的方向、大纲与原始状态；没有持久化真实来源的旧报告不能当新链路成功产物。模型生成应携带页面未保存的有效草稿，轮询与命令响应都须按版本防回退，不能让迟到响应覆盖协作者新版本（出处：issue #2775）。
- 2026-09-04：五步访谈页面的“当前查看/编辑步骤”不能复用服务端状态机的 `currentStep`；用户回看历史步骤时，Skill proposal 仍应以页面步骤为 target、以最新 aggregate version/revision 做并发与失效保护，服务端不得因 targetStep 不等于流程推进位置而拒绝（出处：issue #2635）。
- 2026-09-04：访谈 Skill 的“添加/增加/补充专家”必须把静态候选目录随草稿上下文提供给模型，并在服务端把模型 patch 归一化为“现有 ID ∪ 新 ID”；只让模型返回一组 `expertIds` 再由前端整体覆盖，会把增量意图误实现成替换，未知 ID 必须在持久化 proposal 前 fail closed（出处：issue #2635）。
- 2026-09-03：数字访谈报告流不得把完整工作流当作 progress 帧重复发送；每条连接应以紧凑持久化快照建立基线，后续只发送可校验的正文后缀、finding 与元数据增量，重连再以服务端快照恢复（出处：issue #2560、ADR-109）。
- 2026-09-03：报告生成 POST 长连接断开不代表服务端任务失败；客户端必须先读取持久化工作流状态，任务仍 running 时自动切换到可重连的恢复流，不能同时展示“网络错误”和“流式生成中”（出处：issue #2546）。
- 2026-09-02：数字访谈报告按 revision 唯一存储时，失败重试不能再次 INSERT；必须锁定并原子复用 failed 行、清空所有部分产物并更新 requestId，否则唯一约束异常会在模型调用前被兜底成 `DEPENDENCY_UNAVAILABLE`（出处：issue #2525）。
- 2026-08-30：数字访谈把 Persona、问题或回答发送给外部模型前，必须先用与写事务相同的 actor 可见性谓词取得带 version/revision 的授权快照；模型调用结束后再在锁内复查权限与版本，且不得跨模型调用持有数据库事务，否则同组织越权者可在最终落库被拒前造成资料外发与模型费用（出处：PR #2377 独立安全 review）。
- 2026-08-30：数字访谈的 `generate_questions` 不能用“姓名插值 + 固定三问”冒充 AI 针对性生成；必须把已确认候选的完整 Persona 与主题一起传给模型，校验每位专家恰好三问且跨专家问题不重复，模型输出无效时 fail closed（出处：issue #2376）。
- 2026-08-15：`/rec` 的 AudioWorklet render quantum 不能与浏览器 WebSocket 帧一一对应；48 kHz 输入会产生约 84–86B/2.7ms 的微帧并放大浏览器、API 与 ASR provider 的消息开销。应在保持 16 kHz PCM16LE 字节顺序不变的前提下聚合为约 80ms/2560B 的传输帧，并在停止时刷新尾帧（出处：issue #1335）。
- 2026-08-14：引导式 `/research` 已接真实 API 时不得继续向 `AppShell` 传原型 `mockIdentity`，否则会绕过 `SessionProvider`、让失效会话渲染出假登录壳后再由业务请求暴露 401；预览身份只留给显式 `?screen=…` Studio 原型入口（出处：F174 本地回归）。
- 2026-08-12：数字专家访谈复用 `interview_sessions` 时，任何恢复/状态读取都必须复用既有 SQL 可见性谓词并返回 `Guarded`，再经 application decision 解封；只靠 RLS 只能隔离组织，挡不住同组织内访谈泄露（出处：issue #973）。

## 知识回流规则（本文件怎么迭代——这是这个 skill 存在的意义）

1. **谁干活谁回流**：在本模块交付 feature/修 bug/做 review 时，踩到新坑、建立新做法、
   推翻旧假设 → 在同一个 PR（或紧随的小 PR）往上方"踩坑与经验"**追加**一条：
   `- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`。append-only，不删旧条目
   （被推翻的旧经验标 ~~删除线~~ 并注明被哪条取代）。
2. **module coordinator 每 C-cycle 复盘**：检查本周期内本模块合并的 PR，有值得沉淀而
   没回流的，补写。
3. **结构变更**（新增章节/重组）走正常 review；追加"踩坑与经验"条目可随任意 PR 顺带。
4. 开源贡献者同权：任何人对本模块的经验修订都走 PR，以可验证事实为准，不看资历。
