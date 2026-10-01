# Work Stack 运行效果测试与修复 Backlog

关联：[Issue #4862](https://github.com/boardx/workspacex/issues/4862)。统一交付：[PR #4867](https://github.com/boardx/workspacex/pull/4867)。基线 `68e1146c3`。

## 目标与完成判据

依据 320 实体清单验证数字人是否真正使用角色能力、Skill 是否执行固定版本内容、Workflow 是否完成阶段衔接、审批和持久化。每项仅在验证命令成功且保存证据后勾选。文档评审 PASS、模型回显或测试替身成功不能替代真实运行效果。

用户授权独立开发、跳过 coord-gateway 注册。白板画布/工具交互由另一 session 负责；本次聚焦 Agent/Skill/Workflow，不改其交互文件。浏览器端到端由“测试工程师”session 执行并交付报告；当前无跨 session 发送工具，未声称已派发。

## 现状分析

- 组合图：60 数字人 + 60 Workflow + 200 Skill = 320；实体文档 7 + 27 + 86 = 120，独立评审 86。
- `evals/work-stack`：27 个 Skill 套件，数字人/Workflow 均无套件；`harness eval` 的注册主体只有 S003。
- 已执行 49 项评测门测试、270 项内容包/组合闭包测试，全部通过。这是确定性测试证据，不能宣布 320 个实体运行效果通过。
- 疑似运行缺陷：`ModelContentSkillRunner` 只传 Skill ID/版本，不读取该版本 `SKILL.md`，因此模型无法按已作者化 Skill 工作。原实现正文敏感反证 2/2 失败；修复后 6 项单元/权限边界回归及 2 项真实 PG/HTTP 版本隔离与 W029 全链路测试通过。
- 尚未作者化的 200 个实体无可执行目标；作为产品覆盖缺口记录，不伪造为失败用例，也不擅自新增 200 个能力。

## 执行清单

- [x] B01 盘点全部 320 实体与文档/套件覆盖。验收：组合图 lint 通过；`inventory.json` 有 320 个唯一 ID；证据 `graph.log`。
- [x] B02 恢复指定 pnpm 9.15 环境并完成初始化。验收：`init.sh` 退出 0；证据 `init.log`。移除错误 pnpm 版本生成的配置漂移，不提交依赖改动。
- [x] B03 检查现有内容包/关系与评测门基线。验收：49 + 270 项通过；证据 `gates-baseline.log`、`content-baseline.log`。
- [x] B04 修复 Workflow 未加载固定版本 Skill 正文。验收：正文敏感反证先失败，修复后通过；缺失/跨组织/版本更新不静默退回通用模型；生产 DI 使用真实版本读取适配器。
- [x] B05 验证数字人导入、模型路由、Workflow 白名单和升级边界。验收：真实 PG/API 测试通过；证据 `integration-initial.log` + `pinned-integration.log`。
- [x] B06 验证 Workflow 审批/拒绝、恢复幂等和内容链路。验收：真实 PG/API 的研究/产品/销售链路及权限/恢复测试通过；证据 `integration-initial.log` + `pinned-integration.log`。
- [x] B07 校验评测证据的可信边界。验收：运行全部当前已发布实体门检查；缺套件/缺执行器逐项记录；任何真实可复现的错误门判定补反证并修复；证据 `coverage-gates.json`。
- [ ] B08 浏览器端到端验收。验收：测试工程师 session 的报告涵盖选角色→调用 Skill→启动 Workflow→审批→可见产出；每个失败附输入、预期/实际、截图、日志、版本；待测试提交通道可用。
- [ ] B11 产品经理角色错答（[#4868](https://github.com/boardx/workspacex/issues/4868)）：用户询问能力却按佛学记忆回答。验收：验证固定角色指令全链路传递；能力介绍与角色一致，个人记忆不能重定义角色；需真实模型报告。
- [ ] B13 PDF 分析工具调用无回执、MODEL_CALL_FAILED（[#4869](https://github.com/boardx/workspacex/issues/4869)）。需真实 run/tool_call_id 与服务端日志；同时核对 extraction 404 是否预期缺失。
- [ ] B12 实时语音仍连接失败（[#4869](https://github.com/boardx/workspacex/issues/4869)）。验收：部署版本/反代 WebSocket 鉴权握手、上游就绪、麦克风与双向转写通过；当前线上探针被云环境出站代理 403 拒绝，缺线上运行证据。
- [ ] B10 后台官方数字人不可发现（[Issue #4865](https://github.com/boardx/workspacex/issues/4865)）。验收：后台可发现并启用完整依赖；推荐区提供入口；权限、失败重试、组织切换隔离通过；统一 PR 的 CI 与浏览器报告待交付。
- [ ] B09 回归与 PR 交付。验收：受影响测试、类型检查和 lint 通过；PR 关联 #4862，记录全部剩余限制；CI 红项跟进到解决。

## 产品覆盖缺口（保持未勾选）

- [ ] C01 200 个尚未作者化实体：缺少行为契约，不能开展效果验收；需后续作者化与实现任务。
- [ ] C02 完整评测覆盖：目前仅 27 个 Skill 套件、1 个通用 eval 主体。全量门的 89 个包声明中，63 个 schema 无法解析（Markdown `$ref`），62 个无套件、27 个缺有效报告；存在逐字节相同跨包副本，唯一 Skill 数为 83。以上为原始覆盖快照。S003 1.0.1 已修复严格机器契约并通过 G0–G5；旧角色包仍固定 1.0.0，其余实体用专项测试与缺口报告如实区分。
- [ ] C03 真实模型效果：当前环境未配置模型凭据/服务访问。确定性回环只验证协议与编排，无法证明领域产出质量。

## 进展记录

- 2026-10-01：完成 B01–B03，开始 B04 反证及真实 PG 测试环境准备。尚未改运行时代码。

## 着色执行计划

```mermaid
flowchart TD
  G([目标：验证运行效果并修复真实缺陷])
  B1[1. 盘点与基线]
  B2[2. 正文敏感反证与修复]
  B3[3. 数字人和 Workflow 集成测试]
  B4[4. 全量发布门与缺口报告]
  B5[5. 测试工程师浏览器验收]
  B6[6. 回归与 PR]
  G --> B1 --> B2 --> B3 --> B4 --> B5 --> B6
> 改完 `check` 一遍；不要手改 classDef 颜色。
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class B1 tested
  %% evidence B1: graph.log; gates-baseline.log 49 passed; content-baseline.log 270 passed
  class B2 tested
  %% evidence B2: pinned-counterproof.log 原实现 2/2 失败；pinned-unit.log 6/6、pinned-integration.log 2/2 通过
  class B3 tested
  %% evidence B3: integration-initial.log 120/121；修正夹具后 pinned-integration.log 2/2 通过
  class B4 tested
  %% evidence B4: coverage-gates.json 完整门失败分布；s003-eval.log 10/10 baseline2/10；s003-gates.log G2 schema 引用失败
  class B5 blocked
  %% blocked B5: 当前云端工具未提供 send_message_to_thread，无法向用户指定 session 派发浏览器测试；测试请求已记录，报告尚未收到。
  class B6 doing
```

- 2026-10-01：B04–B06 验证完成。集成初跑 120/121 通过，新增夹具直接发布违反生命周期；改为草稿→写文件→正式发布后，目标文件 2/2 重跑通过。单元/权限边界 6/6 通过，API typecheck/lint 通过。真实专业质量仍未验证。

- 2026-10-01：B07 完成覆盖检查。S003 `harness eval --baseline` = 10/10，基线 2/10；G2 因无法解析 Markdown `$ref` 失败，G3/G4 通过，诚实保持 G5 未通过。问题属于现有包的机器 schema 缺口；本次不降低发布门或伪造评测主体。

- 2026-10-01：后台发现修复 PR #4866，运行时正文修复 PR #4867 已创建，本地正常 pre-push 通过。CI 仍运行，未部署。用户追加角色错答/语音握手/PDF工具未闭问题，B11–B13 保持未勾选。

- 2026-10-01：独立审查发现旧 S003 回环报告的 10/10 不能证明机器契约合规：grader 与契约枚举/必填字段存在漂移。C02 保持未完成，正在修复严格 schema、输出校验及新包版本；旧报告仅保留历史编排证据。
- 2026-10-01：B11 的共享 Python “通用助手”身份冲突已修复并更新 PR #4872，12 项 Python 角色/图测试与 49 项 TypeScript 测试通过；真实模型和部署验收待验证。
- 2026-10-01：B10 发现导入中组织切换可影响后续请求，正在追加冻结组织/凭据、取消和服务端组织匹配检查；未以初版 UI 测试代替租户隔离验收。
- 2026-10-01：B12 新增部署公共匿名 WebSocket 握手门，38 项测试通过，关联 #4874；B13 有界 PDF 失败诊断 25 项测试通过，关联 #4873。两者均不代表线上问题已经恢复。
- 2026-10-01：测试工程师交接状态为 BLOCKED_NOT_DISPATCHED。当前工具没有跨 session 发送能力，云环境不能访问本地收件箱；验收请求已准备，尚无已发送或接单证据。

## 本轮可核验修复交付

- [x] 后台导入绑定启动组织、冻结凭据并取消后续请求；服务端在读取或写入前拒绝组织失配。6 项 HTTP/契约、38 项 UI 与 12 项补充回归通过；API/Web typecheck、lint 和正常 pre-push 通过。PR #4866 更新至 97ba08145。
- [x] 产品经理角色在共享 Python 运行时不再被通用助手身份覆盖；记忆不得重定义角色。PR #4872 更新至 5e6f481ef，仍需真实模型验收。
- [x] PDF 工具保留有界内部失败原因；25 项回归与提交检查通过，PR #4875。线上失败根因尚未查明。
- [x] 公共 WebSocket 匿名握手加入部署门；38 项回归和提交检查通过，PR #4876。线上双向语音尚未验收。
- [x] S003 严格机器契约与新包版本交付：PR #4879，正常 pre-push typecheck/lint 通过；提交检查发现的测试类型遗漏已修复并复跑。G0–G5 通过，新包 1.0.1 保留旧固定版本。真实模型质量和其余实体 schema 缺口仍未完成。
- [x] 既有 chat picker 两入口接入同一会话 scope、冻结组织/凭据和取消；原实现 6 项反证失败，修复后目标/能力回归 46 项通过，已整合统一 PR。
- [ ] 最新提交的全部 CI、合并部署与测试工程师浏览器报告。

## 统一交付与继续开发（2026-10-01）

用户要求把本轮修复整合到一个 PR，统一使用 #4867；原 #4866/#4872/#4875/#4876/#4879 的记录为历史子任务证据。相关问题继续分别跟踪，最新验收以统一分支与部署 SHA 为准。

- [x] 整合全部六个 PR 的提交并同步最新 main；40 个原修复生产/测试/包文件逐字节一致，经验记录保留所有条目。
- [x] 验证首轮统一分支：API 122/122、前端/聊天/Python/部署门通过，正常 pre-push 20 项任务成功。两次失败及修正经过保留在 UNIFIED-DELIVERY.md。后续新增修复需单独复跑。
- [x] 关闭五个被统一 PR 替代的 PR；所有正式验收指向 #4867 统一分支，交接 SHA 继续随提交更新。
- [x] 补齐聊天入口官方角色导入的组织切换取消范围；实际 helper/组件反证 6/6 失败，修复后 46/46 通过。
- [x] 补齐 PDF 原生运行时缺失的有界内部诊断；生产 factory→controller 反证 2/2 失败，统一分支专项 15/15 通过。

- 2026-10-01：统一分支稳定 API 13 文件 122/122 通过；前端 82 项、chat 46 项（含重叠 helper）、PDF 15 项、Python 12 项、部署门 38 项通过。两次失败原因与原始日志在 UNIFIED-DELIVERY.md 如实保留；最终提交检查、最新 CI 和线上验收仍未勾选。

- [x] C04 评测证据漂移：变更 graderVersion、断言或 fixture 后，旧报告仍让 G0–G5 全通过。三项反证已复现并修复当前 suite/fixtures 身份校验；60 项回归、31 项门反证及 8 项契约检查通过，详情见 EVAL-EVIDENCE-TRUST.md。
- [x] B14 首次无附件发送的 extraction 空线程请求：真实组件已复现线程未建时发起 threads//messages/...，修复等待有效线程与旧请求隔离。该反证不能解释已有附件线程的原截图 404。

- [x] 修复 CI 契约单源门：S003 Zod 定义移至 contracts，整合后 11/11 通过。
- [x] 修复 CI 权限预算反证：受控 pinned Skill reader 增量精确为一项，完整权限文件通过。
- [x] 修复 CI 评测包夹具：当前 builder 版本与源码 digest 对齐，保留历史包不匹配反证；子任务真实 PG/HTTP 2/2 通过。
- [ ] 最新统一头 fullstack 真实 GitHub 导入：旧头因上游 rate limit remaining=0 失败，需新头 CI 证据。

- [x] 整合后数据库回归：12 文件 134/134 通过，覆盖评测、完整权限反证、固定 Skill 真实回环；隔离环境已清理。

- [x] 后续修复正常推送检查：统一头 8456b5a92 的 typecheck/lint 20/20 成功，无绕过检查。最新 CI 待完成。

## 完整用户验收（用户追加要求）

- [x] A01 制定完整验收计划：ACCEPTANCE-PLAN.md 覆盖环境/后台/前端/功能/可用性/权限/恢复/证据及退出条件。
- [x] A02 建立 89 场景模板、第一阶段 81 实体及 544 必需检查项、全量 320 实体的独立运行验收登记；所有浏览器场景初始 NOT_RUN，不借用文档评审或单元结果。
- [ ] A03 本轮三角色真实启用、发现及使用界面：D002/D003/D011实际截图（原4角色保留历史基准）、真实登录/导入/目录；旧拦截接口截图不作本项证据。
- [ ] A04 本轮D002/D003/D011真实模型完整任务及产出重读：每角色独立步骤截图＋连续trace/视频；真实模型凭据缺失BLOCKED。D005及销售/CRM用户授权DEFERRED，非PASS。
- [ ] A05 原19 Workflow / 58 Skill登记保留；本轮12非销售Workflow / 58 Skill运行验收，逐实体异常/授权/固定版本与专业输出。
- [ ] A06 管理员/成员/受限用户/审批者的后台配置、前端体验、隔离与故障恢复复验。
- [ ] A07 非开发用户可用性、跨浏览器/移动/键盘/读屏与性能基线。
- [ ] A08 devapp 部署版本、真实音频/PDF/领域质量及最新CI最终验收报告。

执行状态与派发状态分别记录；当前真实模型凭据/云出站访问缺失，测试工程师本地收件箱不可写且无跨chat发送工具，未派发。

## 用户调整范围与真实浏览器发现（2026-10-01，北京时间）

- DEFERRED（不勾选、非PASS）：D005及W011/W012/W013/W014/W015/W016/W018、销售流程/CRM验收，用户明确本轮暂缓；原4角色/19Workflow/58Skill历史基准保留，其他角色所需共享Skill不整体排除。当前完整E2E范围D002/D003/D011。
- [ ] B15 真实PG浏览器启用后目录roleLabel:null导致500：实际缺陷待修复，需正常启用→目录→角色详情与聊天入口复验。
- [ ] B16 W029已发布v1触发schema为空{}：缺业务输入契约，待修复并验证正常入口传入完整任务、各阶段消费与产出。
- [ ] 本轮三角色真实模型领域任务：缺真实模型/Deep Agent凭据BLOCKED；不能把确定性上游或启用成功勾为完整旅程通过。
