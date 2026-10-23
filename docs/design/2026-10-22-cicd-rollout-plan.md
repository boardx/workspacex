# CI/CD 分阶段落实计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline execution, or superpowers:subagent-driven-development if explicitly selected. Steps use checkboxes. This document does not authorize execution or production changes.

**Goal:** 在不减少既有业务覆盖的前提下，消除 CI 重复工作，形成 develop 集成、发布分支同步和稳定自动部署闭环。

**Architecture:** 沿用 GitHub Actions、现有可信主机入口、Docker、存储和浏览器测试。验证有唯一生产者，聚合门只消费可核验结果。生产准备和批准后切流继续采用既有协议。

**Tech Stack:** GitHub Actions / GitHub rulesets、Node.js 测试脚本、Vitest、Playwright、现有 Docker 与主机部署。

**Spec:** `docs/design/2026-10-21-stable-automatic-cicd.md`，以其 2026-10-22 分支修正为准。分支和美国暂缓范围已经用户确认；实施状态以文末记录为准。

## 全局约束

- 功能 PR 先进入 develop；发布同步以人工审阅的 PR 进入 main-cn（main-us 接线暂缓），不能强推同步。
- 保留 `.harness/config/ci-check-policy.json` 作为 required checks 单源；第一阶段保持五个 check 名称不变。
- 失败、取消、缺席和未知不能通过结果聚合伪装为成功。
- 验证复用必须绑定源码、workflow/测试策略、依赖、平台及相关环境输入；源码 SHA 相同不是充分条件。
- 不自动创建 main-us，不复制地区配置，不自动重放状态未知的远端写操作。main-cn 语义迁移须连同保护规则和可信生产基线一起验证。
- 中国生产自动准备、人工批准后激活；不重新启用禁用入口来绕过治理。
- 同一 session 复用现有 worktree；每个实现切片一个 issue/PR，实施前获取最新 develop 与 main。

## 审查重点

1. 缺 diff/base 时回退全量或失败，不能判无变化（CI-1）。
2. fork PR 不得写可信缓存、接触部署凭据或进入生产 runner（CI-1/CI-2）。
3. 缓存/证据过期、输入漂移或原始任务失败，不允许复用成功（CI-2）。
4. 分片只划分测试，不能漏选、重复或共享可变数据库（CI-4）。
5. 发布同步中的冲突、批准过期、baseline 变化及未知写状态均停止推进（Release 子项目）。

## 子项目 A：CI 收敛与可测量提速（可先实施）

### CI-1 分支触发与范围计算

修改 `.github/workflows/harness-verify.yml`、`backend-gates.yml`、`board-acceptance.yml`、
`skill-files-e2e.yml`、`dco.yml` 及 `.harness/scripts/ci-change-scope.mjs`。
新建 `.harness/scripts/ci-branch-policy.mjs` 和对应 Node selftest，集中定义集成分支与
已确认的发布分支角色；workflow 事件过滤与脚本策略之间用测试机械核对。

- [ ] 先写反证：develop PR、develop push、发布 PR、merge_group、fork、缺 base、未知分支；确认旧配置不能满足 develop 正确路由。
- [x] CI-1 PR 保持 required check 名称，并按用户明确映射将 Devapp 自动写操作限制到 develop push；尚未合并/部署验收。
- [ ] 将业务跳过条件与依赖/全局输入关联：lockfile、契约、共享库和测试配置变化触发对应覆盖；未知回退全量。
- [ ] 验证 required checks 在每种合法事件下均出现并产出真实结论；PR 新提交只取消旧验证，绝不取消已开始的部署事务。
- [ ] 独立 issue/PR，留存事件矩阵和 scope 判定，CI 绿后交付。

测试：新增 `node --test .harness/scripts/ci-branch-policy.selftest.mjs`；复跑现有
`lib/pr-queue.test.ts`、`lib/merge-queue.test.ts`、`ci-aggregate-consistency.test.ts`，使用仓库 harness Vitest 配置。

### CI-2 全量验证去重与证据聚合

修改 `.github/workflows/harness-verify.yml`、`.harness/scripts/ci-full-regression.mjs`，
扩展 `ci-full-regression.test.ts`、`ci-lane-dedup.test.ts`。
本地 `verify:full` 保留完整语义；CI 不再通过这个全量包装器重复跑其他 job 已负责的验证。

- [ ] 先补测试证明 full-regression 缺任一基础/浏览器生产者、原任务失败或证据失配必须拒绝。
- [ ] 拆出唯一的强制执行 full-regression 浏览器生产者；保留单独 Smoke 所特有的目录和几何验收。
- [ ] 逐项对照全量基础验证清单，只有覆盖和输入等价的项才能由聚合复用；定时或显式全量复测保留独立目的标记。
- [ ] 非阻塞 Smoke 的表面 SUCCESS 不能当作强制验收证据；使用实际步骤结果、测试报告和绑定输入。
- [ ] 验证同输入重复事件只执行一份昂贵验证；不同分支目标、策略、平台或环境不能误复用。
- [ ] 独立 issue/PR，提供改造前后实际测试清单、执行次数和失败反证。

### CI-3 Devportal 一次构建、同制品部署

修改 `.github/workflows/deploy-devportal.yml`；复用 `apps/devportal/scripts/pages-cutover.mjs`。
新建 `.github/scripts/devportal-artifact-policy.test.mjs` 检查生产者/消费者绑定。

- [ ] 先补反证：artifact 缺失、digest/source/run attempt 不匹配必须拒绝部署。
- [ ] validate 构建并上传已验证的 Pages 目录和 manifest；deploy 下载同一 run 的精确 artifact，保留部署工具所需依赖安装，但不再次构建。
- [ ] 保留现有公网验收与自动 rollback，不改变凭据权限。
- [ ] 静态验证通过后做隔离 artifact 传递验收，再做真实预览部署；未做预览不得声称 Pages 制品可部署。
- [ ] 独立 issue/PR，记录实际构建次数为一次。

### CI-4 API 分片均衡与 Board 重型测试并行

这两项各自一个 issue/PR，互不混合。
API 修改 `.harness/scripts/ci-api-shards.mjs`、对应测试及现有 shard-count policy，
先通过真实 Vitest discovery 证明分片不漏不重，再按历史耗时调整分配。
Board 修改 `.github/workflows/board-native-acceptance.yml`、`board-heavy-batch.mjs`、
`lib/board-native-receipts.mjs` 及其测试，将 R01、connector、files、sync 拆成独立隔离任务。

- [ ] 先写空分片、遗漏、重复、错误 SHA、缺任一 Board 收据的失败测试。
- [ ] API 保持独立数据库；Board 各任务保持专属目录、端口、进程和数据，会议室结论仍独立保留。
- [ ] 固定版本 PostgreSQL/扩展可采用 hash 校验的工具链缓存，不缓存运行中的数据库。
- [ ] 聚合仍要求全部原有覆盖；完整原生收据不能被单一分片通过替代。
- [ ] 对比至少五个同类成功样本，分别报告排队、执行、测试及准备时长，不以增加 runner 数量掩盖总成本。

### CI-5 中国协议测试归属与运维入口清理

修改 `.github/workflows/archive-bridge-tests.yml`、`hk-transfer-performance-tests.yml`；
新增 `.harness/config/ci-test-ownership.json` 和对应机械核对 selftest。

- [ ] 列出实际命令、测试选择和运行参数，先证明重叠及独占覆盖。
- [ ] 共同测试集中为可复用验证任务；专项隔离、故障和性能测试各保留唯一 owner。
- [ ] 同一次事件以唯一编排者调用，不让多个 workflow 各调用一次共享任务造成形式去重。
- [ ] 历史/诊断 workflow 标记用途与适用版本；先查调用者和真实使用记录，再决定归档或禁用。
- [ ] 同步 required check / 聚合与测试，保留历史证据；不删除曾失败的事实。

## 子项目 B：Devapp 稳定部署（单独实施计划）

用户已确认 develop 对应 Devapp；CI-1 已提交自动部署路由，但这只改变触发条件，不证明旧部署器已经具有候选隔离与自动恢复能力。
修改范围：backend-gates 中 deploy job、`.harness/scripts/vm/deploy.sh`、`deploy-gate.sh`、
`deploy-readiness.sh`、`devapp-operation-policy.json` 及受控安装器。

- [ ] 先定位现有部署约 20 分钟取消的真实原因，保留失败日志，不能先加超时掩盖。
- [ ] 建立真实服务/端口/配置清单，选择隔离 release 目录和候选服务运行方案。
- [ ] 增加固定业务回归清单、数据兼容准入和有界 Agent/SSE/WS drain。
- [ ] 独立构建候选，保留旧静态资源，实际制品验收后才切换。
- [ ] 自动恢复旧入口、完整制品和配置引用，再做旧版浏览器验收。
- [ ] 演练构建失败、候选失败、切流失败、恢复失败、重启和并发两提交；证明旧版未被候选构建破坏。
- [ ] 更新可信主机入口必须通过既有受控安装及字节身份核验；仓库修改不算主机生效。

这部分需独立详细设计/测试命令，不能将上面的交付清单冒充可直接执行的部署实现。

## 子项目 C：发布同步与生产准备（单独实施计划）

已确认：develop 对应 Devapp；main-cn 人工合并后触发中国发布；本次跳过美国。
仍需验证：完整/选择性同步策略，
现有 Environment 审批、runner/可信入口及已禁用 prepare 的替代主路径。
修改范围最终依赖上述确认；候选为新建 release-sync workflow 与脚本、现有正式发布编排器及准入测试。

- [ ] 人工选择目标环境与 develop exact SHA；自动创建或更新唯一同步 PR，冻结目标 baseline。
- [ ] 默认完整快照合并；选提交模式要求显式清单和依赖验证。冲突报告，不自动覆盖目标改动。
- [ ] 验证目标分支实际组合与地区配置，记录 source SHA 和合入后目标 SHA；不能混用。
- [ ] 合入目标分支后按显式环境映射自动准备，不自动触发另一地区部署。
- [ ] 中国生产继续 exact-source 收据、一次批准、过期/漂移复核、激活和恢复验收。
- [ ] 针对分支同步生成的新 SHA 调整现有 main-source admission，保留真实 merged PR 与 tree 证明。
- [ ] GitHub 默认 token 创建 PR/推送可能不触发后续 workflow；在沙箱仓库实测。
      如需 GitHub App 或其他凭据，单独审阅最小权限；不得用 workflow_run 未验证的 artifact 获取部署权限。
- [ ] 验证同步冲突、旧事件、批准过期、基线变化、运输失败、未知远端状态及区域隔离后才启用自动链。

## 保护与启用顺序

1. 导出现有 rulesets、环境与 workflow 配置，记录恢复位置；先检查实际保护匹配的分支。
2. 以 CI-1 至 CI-5 小 PR 交付，先不动生产入口。五个 required check 名称保持稳定。
3. 需要改 check 名称时先部署可产出新旧结论的代码，证明可达后再迁移 ruleset；不能制造恒等待门。
4. Devapp 候选/恢复演练通过后，按环境映射迁移触发；同一环境只能有一个有效 writer。
5. 发布同步先只建 PR，再启用自动准备，最后演练一次批准上线；原有独立入口保留但互斥。
6. 回退 workflow 时不重新启用会原地破坏活动产物的路径；优先关闭新触发，保留当前健康版本。

## 完成判据与估算

- CI：测试归属无丢失；相同等价输入无意外重复；合法事件的 required checks 可达；真实失败仍拦截。
- Devapp：自动部署 exact 版本，旧版隔离，核心回归与自动恢复均有真实浏览器证据。
- 生产：同步版本可追踪、准备自动、人工批准保持、错误环境不被部署、失败恢复可证明。
- 建议工程预算：CI 收敛 2–4 工作日；Devapp 3–5 工作日；发布同步与生产联调 2–4 工作日。
  这些是排期预算，受 runner、权限、现存失败及维护窗口影响，不是当前 session 的完成承诺。
- 当前有 CI 实施 PR；未改 rulesets、主机、凭据或生产流量。CI/部署/真实性能验收分开记录。


## 实施记录与交接（2026-10-22）

以下均为独立 issue/PR，按顺序叠加；后续 PR 的 base 是前一切片分支。父 PR 合并后须
将子 PR retarget 到 develop。未自动合并，不把“开出 PR”标成全部完成。

| 切片 | Issue / PR | 已验证边界 |
|---|---|---|
| develop 路由与范围 | #5863 / #5864 | 事件判定、缺失 base 拒绝、控制面跳过证明；旧 Skill/Board 分支断言已修正 |
| Smoke 唯一生产者 | #5865 / #5866 | 169 项相关 harness 测试和 20 项真实子进程 fixture；实际步骤失败不能由 informational success 掩盖 |
| Devportal 同制品部署 | #5867 / #5868 | 9 项制品测试、16 项门户测试、typecheck；散列/源码/run/生产者 attempt 绑定，保留切换验收和回退 |
| Board 四套完整并行 | #5869 / #5870 | 37 项 harness 和 47 项原生策略/runner 测试；独立 runner，保留完整收据，拒绝批次缺席 |
| 淘汰同 PR 旧验证 | #5871 / #5872 | 61 项相关测试；只取消 Board/Skill 的同 PR 过时验证，不取消部署事务 |

独立审查已覆盖以上五片。发现并修复了 Devportal failed-job 重跑使用错误 artifact attempt、
Board 批次失败导致汇总跳过假绿两个问题，均有回归测试。最新云端 CI 尚在排队/执行；
不得将本地通过改写为 CI 全绿。未测新的真实部署耗时，不能承诺提速百分比。

下一步依赖：

1. 跟踪以上 PR 到实际 CI 判定，修复失败；保留五个 required checks 的单源策略。
2. 独立完成 Devapp 候选目录/服务、旧资源保留和自动回退；当前 deploy.sh 仍在活动目录
   git reset/install/build，路由修改没有解决原地构建风险。
3. 迁移中国源码准入、main-cn 分支保护及生产 baseline：当前需要 source 在 main，且
   required_deployments 依赖生产批准；人工合并在先的新语义不能直接复用旧门禁。
4. 可信主机脚本改动须准备 exact 安装负载，通过现有受控安装和字节比对；仓库 PR
   不能自动授予 root 安装权。全部具体代码可评审后再进入对应安装步骤。
5. 在 Devapp 演练失败/恢复和两提交并发，再对中国链做受控发布/恢复，记录两只时钟。
   API 分片耗时均衡、中国协议重复测试归属也仍待实施。

本轮复用既有 worktree，初始化已通过。协调握手缺少 COORD_GATEWAY_URL/凭据，用户已
明确允许本轮跳过。未改 feature_list 或 passing 状态；未执行生产写操作。
一次未限制目录的本地 Vitest 扩展检查误选了整个 monorepo，已中止（exit 130），
不能计为验证通过；上述表格只记录明确选定范围且退出码为 0 的命令。


### 2026-10-22 后续核验修正

实时核验发现 #5864 已进入 develop；#5866、#5868、#5870、#5872 虽已合并，但合入的是
前一切片的临时分支，尚未证明进入 develop。#5874 改为面向 develop 的集成 PR，汇入此前
已分别审查的剩余改动；它不再是仅文档 PR。后续以 develop 内容和实际部署验收判断生效。

#5874 原 organization-create 失败发生在 Playwright 的系统依赖安装阶段：
run 39762945819 / job 119771330389 的 Ubuntu 26.04 Microsoft APT 源返回 403，业务测试
尚未执行。该任务固定到 ubuntu-24.04，保留浏览器安装、原测试命令和截图上传。
推送后的云端重跑结果仍须独立验证，不能因调整 Runner 标签便宣称故障已解决。
