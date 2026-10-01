# Work Stack 运行效果测试与修复 Backlog

关联：[Issue #4862](https://github.com/boardx/workspacex/issues/4862)。基线 `68e1146c3`。

## 目标与完成判据

依据 320 实体清单验证数字人是否真正使用角色能力、Skill 是否执行固定版本内容、Workflow 是否完成阶段衔接、审批和持久化。每项仅在验证命令成功且保存证据后勾选。文档评审 PASS、模型回显或测试替身成功不能替代真实运行效果。

用户授权独立开发、跳过 coord-gateway 注册。白板画布/工具交互由另一 session 负责；本次聚焦 Agent/Skill/Workflow，不改其交互文件。浏览器端到端由“明确测试工程师职责”session 执行并交付报告；当前无跨 session 发送工具，未声称已派发。

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
- [ ] B10 后台官方数字人不可发现（[Issue #4865](https://github.com/boardx/workspacex/issues/4865)）。验收：后台可发现并启用完整依赖；推荐区提供入口；权限、失败重试、组织切换隔离通过；独立 PR/CI 与浏览器报告待交付。
- [ ] B09 回归与 PR 交付。验收：受影响测试、类型检查和 lint 通过；PR 关联 #4862，记录全部剩余限制；CI 红项跟进到解决。

## 产品覆盖缺口（保持未勾选）

- [ ] C01 200 个尚未作者化实体：缺少行为契约，不能开展效果验收；需后续作者化与实现任务。
- [ ] C02 完整评测覆盖：目前仅 27 个 Skill 套件、1 个通用 eval 主体。全量门的 89 个包声明中，63 个 schema 无法解析（Markdown `$ref`），62 个无套件、27 个缺有效报告；存在逐字节相同跨包副本，唯一 Skill 数为 83。S003 已补当前版本报告，G3/G4 通过但 G2 因 Markdown `$ref` 失败；其余用专项测试与缺口报告如实区分。
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
