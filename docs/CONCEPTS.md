# 概念与最佳实践 — 这套模板背后的思想

> README 讲「怎么用」，本文讲「为什么是这样」。每个概念背后都有上游（BoardX）
> 的真实事故或真实收益——这套东西不是设计出来的，是**烧出来的**。读完你应该能
> 回答：为什么不能直接让 agent「自由发挥」，以及这套约束到底在防什么。

## 一、要解决的问题：agent 开发的四种失效模式

用 AI agent 开发软件，规模一上来必然撞上四堵墙：

1. **假完成**：agent 说"做完了"，代码看起来能跑，实际行为不存在或跑不通。
   语言模型的本性是让你满意，不是让事实成立。
2. **上下文蒸发**：会话结束，agent 脑子里的一切消失。下一个会话（或下一个 agent）
   从零开始，重复踩同样的坑。
3. **并行踩踏**：多个 agent 同时干活，改同一个文件、部署互相覆盖、重复做同一件事
   ——没有协调机制时，并行度越高破坏力越大。
4. **纪律漂移**：写在文档里的规范，第 10 次执行时就走样了。人肉纪律对 agent
   和对人一样不可靠。

整套模板就是对这四堵墙的系统性回答。

## 二、基础概念（每个概念 = 一堵墙的一块砖）

### 1. 仓库即唯一事实来源（对抗：上下文蒸发）
**agent 看不到的东西就不存在。** 所有状态——进度、决策、经验、交接——都必须进
仓库文件，不允许只存在于会话记忆或聊天记录里。推论：
- 会话收尾必须写 `session-handoff.md`（下一个全新上下文只靠仓库就能续上）。
- 协调服务的图谱/投影都只是仓库的**索引**，不是第二个真相。

### 2. 证据门控完成（对抗：假完成）
**完成 = verification 命令退出码 0 + 证据落盘。** 每个 feature 定义时就带
可执行的 `verification` 命令（先写验证再写码——这是"完成契约"）；只有
`pnpm harness verify` 能把状态翻成 `passing`，翻的同时把命令输出写进 `evidence/`。
"代码写完了""看起来能跑"在这套体系里是无意义的句子。
`passing` 不可逆——不允许"先标完成回头再修"。

### 3. 审计链（对抗：假完成的高级形态）
证据本身也会造假或断链——上游发生过 9 个 feature 全标 passing 但从没跑过验证的
事故（P23 假 passing 事件，postmortem 是本模板最重要的出处之一）。所以有 `doctor`：
独立体检每个 passing 的证据是否真实非空、是否进了 git、派生视图是否与源一致。
**verify 是门，doctor 是查门的人。** 两者由不同代码路径实现，不能互相背书。

### 4. 渐进式披露（对抗：上下文有限）
入口永远是 `AGENTS.md`——**硬上限 100 行的目录页**，不是百科全书。细则按需
下钻：`.harness/instructions/`（怎么做）→ `docs/adr/`（为什么）→ 模块 skill
（这个模块的坑）。agent 的上下文窗口是稀缺资源，文档架构必须为此设计。

### 5. 机械门控 > 人肉纪律（对抗：纪律漂移）
**能机器判定的一致性，绝不交给人肉抽查。** 上游的数字：肉眼估计 3 处错误泄漏，
lint 门控一扫出 51 处；手抄检查清单第一次全仓体检 85 项 FAIL。所以：单一
in_progress 由脚本断言、证据由 doctor 体检、设计 token 由 lint 拦截、部署漂移由
CI 探针检测。文档里每一条"必须"，都应该问一句：**这条能不能变成机器判定？**

### 6. 租约，不是锁（对抗：并行踩踏）
多 agent 互斥用**带 TTL 的租约**：认领资源 → 心跳续期 → 断心跳自动过期，别人可
接管。没有死锁，没有"某个 agent 崩了把锁带进坟墓"。两条实现铁律（都付过学费）：
- 认领必须用存储层原子原语（唯一索引/条件写入），**禁止 SELECT-then-INSERT**。
- 释放必须带交接说明（handoff note）——"静默消失"是最贵的故障。

### 7. 统一时钟 + 分级 loop（对抗：并行失序）
所有 agent 从同一个权威时钟（`GET /time`）对时，按分级节奏跑循环：主协调者
5 分钟、模块协调者与开发 agent 15 分钟。每个循环 = `tick` 一次（对时+续租+
收件箱）。**时间判断不允许各自看表**——分布式系统的常识，对 agent 组织同样成立。

### 8. 组织分层（对抗：单点协调瓶颈）
主协调者（唯一，独占合并权）→ 模块协调者（分派+初审，无合并权）→ 开发 agent
（一次只做一个 feature）。权力语义写在 registry.yaml 的 `kind` 字段里，由协调
服务强制——**派工是协调层特权，合并是主协调者特权**，不是君子协定。

### 9. 知识回流（对抗：重复踩坑）
每个模块一个活知识库 skill：代码地图 + 契约不变量 + **append-only 的踩坑经验**。
规则只有一条硬的：**谁干活谁回流**——修 bug 建立的新认知，在同一个 PR 里追加进
skill。被推翻的旧经验标删除线不删除（错误的历史也是知识）。

### 10. 诚实降级（对抗：静默假装）
依赖不可用时，宁可明确报"未接线/不可用"，绝不静默假装正常或悄悄换一条更差的
路径。例：协调服务未配置 → harness 明说并退化为单 agent 模式；图检索挂了 →
报错，**不许**静默降级成纯向量检索。用户看到的降级提示是功能，不是缺陷。

### 11. ADR 文化（对抗：决策失忆）
重要决策写 ADR：背景、选项、为什么、**什么情况下会改主意**。被推翻标 Superseded
并链到取代者——决策的演化史和决策本身一样有价值。本模板的 ADR 分两层：方法论
（<100 号，随模板走）和项目实现（你自己的，从 ADR-100 起）。

## 三、四大支柱（概念如何落成体系）

上面的概念不是清单，是四个相互咬合的体系。每个支柱这里给全景，细节在指向的文档里。

### 支柱 1：技术架构（详见 `.harness/instructions/architecture.md`）

一条硬约束统领全部选型：**架构可移植**——同一套代码部署到任意云与私有环境，
业务逻辑不绑单一云的专有原语。在此之下是 8 层参考栈（每层：默认选型/为什么/可替换点）：

```
前端  Next.js + 设计token单源+lint门控     实时同步  WS + 服务端权威 + CRDT（协议不变载体可换）
后台  三层中间件 Guard/Pipe/ErrorBoundary   图/本体   PG canonical + pgvector + AGE 可重建投影
AI    gateway 抽象 + sanctioned stub        对象存储  S3 兼容接口
数据  PostgreSQL + 显式 SQL 迁移            缓存队列  Redis 仅运行时（可丢失）
```

三个纪律贯穿所有层：
- **canonical 只有一个**（PG）——向量、图、缓存全是可重建投影，灾备 = 重放迁移+重建投影。
- **三层机械门控是标配不是可选**：鉴权（withAuth）/ 校验（withValidation）/ 错误边界
  （意外错误只回 internal_error）。缺哪层，哪层就是下一个事故。
- **部署三形态同一套代码**：单机私有（compose+systemd+Caddy）/ 多云容器 / 边缘混合
  （边缘代码必须纯 Web 标准——这决定了后台不用重框架）。
- 组织本体/知识图谱的完整数据架构 → `docs/architecture/knowledge-ontology.md`
  （四表 canonical、ontology_actions 唯一写入口、graph-first 检索）。

### 支柱 2：Harness 过程（详见 `.harness/instructions/harness 各标准 + AGENTS.md`）

harness 是控制平面：管理"工作如何被定义、执行、验证、审计"。核心是一条**不可绕过
的状态机**：

```
原始需求 ──requirement-author──▶ feature_list.json（唯一权威）
                                     │ new-sprint 派生只读工作集
                                     ▼
              not_started ─▶ in_progress ─▶ passing（不可逆）
                                     ▲            ▲
                        一次只做一个（脚本断言）   │
                                     只有 verify 能翻（证据落盘）
                                                  │
                              doctor 独立体检证据链（防假 passing）
```

关键机制：
- **feature 三元组**：user_visible_behavior（人话说清行为）+ verification（可执行
  命令，先于实现写下）+ evidence（verify 自动写入）。三者缺一不是 feature。
- **verify 与 doctor 分离**：翻状态的门和查门的人是两套代码，不能互相背书。
- **会话生命周期**：开工读 progress/handoff/active-features → 干活 → 收尾过
  clean-state 清单 + 写 handoff。上下文蒸发被仓库文件接住。
- **多 agent 时**：registry.yaml 定身份与权力，租约管互斥，tick 管对时与收件箱，
  协议契约见 `docs/coordination-protocol.md`。单 agent 时这些全部可以不配。

### 支柱 3：Sprint 管理（详见 `.harness/templates/` + sprint-planner skill）

交付平面三级：**phase（阶段=项目）→ sprint → feature**。

- **phase**：`new-phase` scaffold 出 requirements/ 文件夹；原始需求（大白话/用户
  故事）先进文件夹，再由 requirement-author 转成带可执行验证的 feature_list。
  **requirements 是输入不是权威**——权威永远是 feature_list.json。
- **设计签核关卡**：feature 开工前，人类在束级 `design-signoff.md` 一次签**三件**——
  ① UI（先用真实组件+mock 把界面做出来）② 用例接口 ③ API 契约；再加一道阶段一致性复核。
  未签核 `new-sprint` / `claim` 直接拒绝。规格见 ADR-023（扩展并收敛 ADR-003 / ADR-020），
  执行书见 `.harness/instructions/contract-design.md`。
- **sprint**：`new-sprint` 从 feature_list 圈一批 feature，派生只读 active-features
  视图（禁止手改）。sprint 内纪律：每 owner 同时只有一个 in_progress；范围只及
  当前 feature；`verify --sprint` 是唯一收口。
- **进度可见**：progress.md（人读）与 roadmap/PROGRESS（机器派生）分离；
  doctor 检测两者漂移。
- **节奏**：sprint 不定长，以 feature 批次为界；每轮会话收尾 = 一次微交接；
  周期性复盘由协调层的 C-cycle 承担（报告与运营 loop 分离，见 ADR-014）。

### 支柱 4：DevOps 架构流程（详见 `.github/workflows/` + examples/）

CI 与 CD 是两条独立防线，共享一个原则：**响亮失败，绝不静默**。

**CI（harness-verify.yml）**——每次 push/PR：
1. 生成物防漂移（gen-subagents 后 git diff 必须干净——生成物与源不一致当场红）；
2. `turbo --affected` 只测受影响的包（模块只为自己的改动买单，CI 时长不随仓库
   规模线性膨胀）；
3. 全栈冒烟不随每个 PR 跑——每小时门卫检查 main 有无新合并，有才跑（省 runner
   不省覆盖）。

**CD（examples/deploy-pattern.yml.example）**——合并 main 触发，四步固定顺序：
```
门控（typecheck+test）→ 迁移（幂等，先于部署）→ 部署（只从 main）→ 冒烟+漂移探针
```
- **唯一部署入口 = 合并 main**。禁手动部署：两个分支各自手动 deploy 会
  last-write-wins 互相覆盖（上游真实事故：线上功能静默消失一天半）。
- **串行不取消**（concurrency cancel-in-progress: false）：迁移+部署非原子，
  中途取消会留半套。
- **漂移探针**：冒烟断言关键端点存在性（POST /x 无凭据应 401 而非 404）——
  "线上落后于 main"要 CI 当场红，不靠人肉发现。
- **env/secret 与部署原子**：同 PR 或先加后删；"先删等下次部署补"的窗口必然被
  自动部署踩中。
- 凭据三分法：本地 = gitignore 的 `.harness/state/.cache/`；CI = repo secrets；
  运行时 = 平台 secret 注入。任何一处都不进 git/聊天/issue，引用时只给路径。

## 四、最佳实践（工作流层面的操作指南）

### 开发节奏
- **一次只做一个 feature**。范围纪律：只动当前 feature 涉及的代码，不顺手重构。
- **先写验证再写码**：verification 命令是实现前就定下的完成契约。
- **验证要双向**：新测试通过还不够——把实现临时改坏，确认测试真的变红，再改回来。
  绿的测试可能只是写松了的摆设。
- 多 agent 共享 checkout 时，动手前先开独立 git worktree（ADR-005）。

### 交付纪律
- PR 描述写清对模块契约的影响面；评审锚定到 commit SHA（防 stale review 之争）。
- **干净收尾**：每轮会话结束过一遍 clean-state 清单——标准启动/验证路径仍可用、
  progress 已更新、handoff 已写、没有未记录的半成品。
- 状态不自己改：永远走 verify 门控，绝不手改 feature_list 的 status 字段。

### DevOps
- **有 CD 的目标不手动部署**。上游事故：两个分支各自手动 deploy，last-write-wins
  互相覆盖，线上功能静默消失。唯一部署入口 = 合并 main 触发 CD。
- **迁移先于部署且幂等**；冒烟带**部署漂移探针**（断言关键端点存在性——例如
  POST /x 无凭据应 401 而非 404，404 意味着路由整个丢了）。
- **env/secret 变更与部署原子**（同 PR 或先加后删）——"先删再等下次部署补"的
  窗口必然被自动部署踩中。
- 凭据只进 gitignore 的本地文件和 CI secrets，**永不进 git/聊天/issue**；
  引用凭据时给文件路径，不贴值。

### 有 UI 的阶段
- **UI 先行**（ADR-003）：feature 清单定稿前，先用真实组件+mock 数据把界面做出来
  经人类确认。文字描述的 UI 需求和真实界面之间的鸿沟，永远比你以为的大。
- 设计 token 单源 + lint 门控，杜绝"这个页面的字号/颜色是另一套"。

### 引入新规则时
问三个问题：① 这条规则防的事故真实发生过吗？② 能不能机器判定？③ 违反时的
失败是响亮的还是静默的？三问都及格再进标准；否则先当提案放 `docs/proposals/`。

## 五、如何读这套模板

按角色给路径：
- **只想快速上手** → README「十分钟接入」，遇到不明白的再回本文。
- **要给团队引入** → 本文全文 + `docs/adr/` 十份方法论 ADR（每份都短）。
- **只关心某一支柱** → 第三章按支柱给了全景与细节文档索引，可单独跳读。
- **要接多 agent 并行** → `docs/coordination-protocol.md` + ADR-010/014。
- **要改模板本身** → 先读 `docs/README.md` 的分层规则，改动走 PR。

最后一句话总结这套东西的立场：**不信任任何"看起来"，只信任可执行的验证、
落盘的证据、和机器强制的门控——对 agent 如此，对人也如此。**
