# PROP-CONTEXT-ENGINE-001 执行 Backlog

> 每个 CE 条目实施时必须独立 issue、独立分支、独立 PR（同 PROP-HARNESS-AGENT-001 的
> 纪律）；涉及 UI 的条目是 **CE-032**。CE-030~032 同属 Claim 生命周期契约束，三项
> 开工前必须先有该束唯一的 `design-signoff.md`（ADR-023，UI/用例/API 契约三节），
> 不能把 migration 编号误当 UI，也不能跳过签核直接改 schema 或画界面。
>
> **执行主体**：dev-ai-runtime / coord-chat（或其派生 worker），不是 coord-architecture。
> 本清单由 coord-architecture 代拟，等 coord-main 分派。
>
> **技术决策已锁定**（详见 `PROP-CONTEXT-ENGINE-001.md`）：对象存储 = 本地 MinIO
> （`apps/api/docker-compose.dev.yml` 已配置）；OCR = tesseract.js；ASR = FunASR
> （独立 Python 服务，同 `apps/deep-agent-service` 的部署模式）。

## Epic CE-E0 — 决策与签核

| ID | P | 状态 | 交付物 | 依赖 | 完成契约 |
|---|---|---|---|---|---|
| CE-000 | P0 | ✅ 完成（2026-08-11） | 本提案人类 Accept/Revise/No-Go | 无 | 人类逐字「CE-000 接受，解析统一用 anydoc」——Accepted 带一处修订（CE-012/013 统一 anydoc），已写回提案头 |
| CE-001 | P0 | ⬜ 未开始 | CE-030~032（Claim 生命周期；UI 条目为 CE-032）所属契约束的 `design-signoff.md` | CE-000 | 束内三节签核（UI/用例/API 契约）齐全，人类签字，不能 agent 自签；CE-030~032 共同引用这一处签核 |
| CE-002 | P0 | ⬜ 未开始 | FunASR 独立服务的资源占用现场实测报告 | CE-000 | 真实起 FunASR 服务，记录模型加载时间、内存/CPU 占用、单次转录延迟，写进 issue evidence——不是查文档估算，是真跑一次 |

## Epic CE-E1 — 证据底座补完（P1 缺口：真实存储 + 真实解析）

| ID | P | 状态 | 交付物 | 依赖 | 完成契约 |
|---|---|---|---|---|---|
| CE-010 | P0 | ⬜ 未开始 | `MinioObjectStore`（`ObjectStore` port 的第二个实现） | 无 | 复用 `fs-object-store.ts` 同一 port 接口；真实读写 MinIO（`docker-compose.dev.yml` 已有的 minio 服务）；write-once 语义靠 MinIO 版本化/object-lock 落实（不是应用层假装）；反证：并发两次 `putOnce` 同 key，一个成功一个报 `ObjectExistsError` |
| CE-011 | P0 | ⬜ 未开始 | 生产环境对象存储配置切换（fs → MinIO） | CE-010 | 一个环境变量/配置开关切换实现，不改上层代码；现有 `fs-object-store.test.ts` 的契约测试对 MinIO 实现重跑一遍全绿 |
| CE-012 | P0 | ⬜ 未开始 | 真实 PDF 解析（替换"字节当 UTF-8 文本"的 stub） | 无 | 解析统一用 `@firecrawl/anydoc`（人类 2026-08-11 裁决「解析统一用 anydoc」；W1/#934 已过依赖评审），提取真实文本+页码锚点；反证：喂一份多页真实 PDF，`anchors.page` 字段对应真实页码，不是伪造的连续整数 |
| CE-013 | P0 | ⬜ 未开始 | 真实 Office 解析（docx/pptx，替换 stub） | 无 | 解析统一用 `@firecrawl/anydoc`（同 CE-012 的人类裁决，docx/pptx 同库），提取真实文本；`generatorModel` 字段如实写真实库名+版本，不再是 `"deterministic-document-parser"` |
| CE-014 | P0 | ⬜ 未开始 | tesseract.js OCR 真实接入 | 无 | 真实识别一张含文字的真实图片，`derived_representations` 落真实识别文本 + 置信度；`generatorModel` 如实写 `tesseract.js@<version>`，不再是 `"stub-ocr-engine"` |
| CE-015 | P0 | ⬜ 未开始 | FunASR 独立服务骨架（同 `apps/deep-agent-service` 部署模式） | CE-002 | `apps/asr-service`（Python，FunASR 官方 FastAPI 范式）；`apps/api` 摄取 adapter 通过 HTTP 调用；反证：喂一段真实音频，返回真实转录文本 + 时间码，`generatorModel` 如实写 FunASR 模型名+版本 |
| CE-016 | P1 | ⬜ 未开始 | 摄取幂等性在真实解析器下重新验证 | CE-012~015 | 既有 `idempotent-no-duplicate-segment.test.ts` 换真实解析器后重跑，确认幂等键（`content_hash+pipeline_version+parser_version`）在真实解析场景下仍然成立 |

## Epic CE-E2 — 检索接线（P2：把已经写好、测过、但零调用的管线接上生产）

| ID | P | 状态 | 交付物 | 依赖 | 完成契约 |
|---|---|---|---|---|---|
| CE-020 | P0 | ⬜ 未开始 | `context-pack.controller.ts`（生产 HTTP 端点） | 无（`retrieve-candidates.ts`/`rrf.ts`/`screening.ts` 已存在） | 真实 controller 调用既有五路检索+RRF+screening 管线，返回 `ContextPack`；反证：真实 HTTP 请求打进来，能拿到真实召回结果，不是 mock |
| CE-021 | P0 | ⬜ 未开始 | chat/agent-run 接入 Context Pack（替换今天的"Skill pin 拼接"） | CE-020 | `execute-run.ts` 的上下文组装改为调用 CE-020，AI 回答真实基于检索到的 Segment，不再只是"最近 N 条历史 + Skill 正文" |
| CE-022 | P1 | ⬜ 未开始 | pgvector ANN 索引（HNSW/IVFFlat） | 无（需先定 embedding 模型） | 选定生产 embedding 模型+维度后建索引；`pgvector-permission-recall.test.ts` 反过来断言索引存在且召回率达标（今天这条测试断言"不存在"，届时要改） |
| CE-023 | P0 | ⬜ 未开始 | 端到端引用可定位性真实回归 | CE-020、CE-012~015 | 真实上传一份文件 → 真实提问 → AI 回答的引用能在真实前端打开到对应页码/时间码——首批完成门槛第①条从"单测证明逻辑对"升级为"真实生产验证" |

## Epic CE-E3 — 知识与图谱补完（P3：Claim 生命周期 + 实体 + 审核 UI）

| ID | P | 状态 | 交付物 | 依赖 | 完成契约 |
|---|---|---|---|---|---|
| CE-030 | P0 | ⬜ 未开始 | `claims` 表补全 6 字段（migration） | CE-001（签核） | 加 `confidence`/`valid_from`/`valid_to`/`created_by`/`reviewed_by`/`supersedes_claim_id`；反证：两条冲突结论能并存（一条 `superseded` 指向新的 `accepted`），查询能区分"当时对现在错" |
| CE-031 | P0 | ⬜ 未开始 | `ontology_objects` 表（真实建，今天完全不存在） | CE-001（签核）、CE-030 | 人/项目/研究对象/需求/决策等实体，`ontology_edges` 挂到真实 entity_id 上，不是纯字符串 |
| CE-032 | P0 | ⬜ 未开始 | Claim 审核工作台（UI） | CE-001（签核）、CE-030 | 人工能看到 `proposed` 状态的 Claim、看支持/反驳证据（`claim_segments`）、批准/驳回/标记 superseded；走 ADR-003 UI 先行 + mock 数据流程 |
| CE-033 | P1 | ⬜ 未开始 | Claim 生命周期状态机 gate（禁止非法 transition） | CE-030 | 同 harness 里 `assertSingleInProgress` 的思路：`superseded`/`contested` 不能凭空产生，必须有 `supersedes_claim_id`/反驳证据支撑 |
| CE-034 | P1 | ⬜ 未开始 | 跨 tenant Claim 泄漏回归（真实数据） | CE-030、CE-032 | 既有 RLS 零泄漏测试扩展到真实 Claim 审核场景，不只是 Segment 检索场景 |

## Epic CE-E4 — Agent 工作流（P4：补齐 checkpoint + Context Pack 联动）

> exact baseline 已有 `DeepAgentModelProvider`（TS 侧并已注入路由）、
> `langgraph-cli[inmem]` 与 `create_deep_agent`；它们是本 Epic 的现有前置能力，不再作为
> 未开始 CE 条目重复规划。尚缺的是持久化 checkpoint/恢复、动态 `interrupt()` 与
> Context Pack 运行记录。

| ID | P | 状态 | 交付物 | 依赖 | 完成契约 |
|---|---|---|---|---|---|
| CE-041 | P0 | ⬜ 未开始 | `agent_runs`/`agent_run_steps` 加 `context_pack_id` | CE-020 | 每次 Agent 运行记录它实际用了哪个 Context Pack；反证：重放某次真实 run，能查到当时的 Context Pack 内容 |
| CE-042 | P0 | ⬜ 未开始 | checkpoint 保存与恢复（现有 DeepAgent/LangGraph 基线上尚未实现） | CE-041 | Agent 运行中定期落持久化 checkpoint，并与该 run 的 Context Pack 关联；反证：真实 kill 掉一个跑到一半的深度研究进程，从 checkpoint 恢复，不是从头重跑 |
| CE-043 | P1 | ⬜ 未开始 | 高影响操作的动态 `interrupt()` 人工审批 | CE-042 | 深度研究流程里"发布/写入"类动作暂停等人工 approve；反证：不 approve 就卡住，不会静默继续 |
| CE-044 | P1 | ⬜ 未开始 | 崩溃/恢复端到端演示（补齐"9 分"验收第 9 条） | CE-042、CE-043 | 一条真实深度研究 run：跑到一半 kill → 从 checkpoint 恢复 → 最终产出跟不 kill 的对照组一致 |

## Epic CE-E5 — 组织大脑（P5：跨项目聚合，今天零实现）

| ID | P | 状态 | 交付物 | 依赖 | 完成契约 |
|---|---|---|---|---|---|
| CE-050 | P1 | ⬜ 未开始 | 跨项目 Claim 聚合视图 | CE-030、CE-031 | 同一实体（比如同一个客户）跨多个项目的 Claim 能聚合查看 |
| CE-051 | P1 | ⬜ 未开始 | 矛盾发现（对同一实体的冲突 Claim 自动标记） | CE-050 | 反证：两个项目对同一实体给出矛盾结论，系统能标出来，不是要求人工先发现 |
| CE-052 | P1 | ⬜ 未开始 | 删除级联补齐 ontology-edges 那一类（补齐"首批门槛"第④条剩下的诚实失败项） | CE-031 | 今天 `delete-six-cascade-invalidation.test.ts` 里 ontology-edges 那类测试诚实断言失败——这条要把它变成真通过，不是把测试改成不测 |
| CE-053 | P1 | ⬜ 未开始 | retention/删除传播的组织级策略 | CE-050~052 | 对应设计文档"retention、删除传播与知识失效"，用户反馈能反哺检索排序但不能直接改事实 |

## 反证纪律（沿用 PROP-HARNESS-AGENT-001 的先例）

每条 CE 条目实现完，必须在真实环境（不是 mock）里做至少一次真实反证：能触发的失败
场景要真的失败、能通过的场景要真的通过，把命令输出贴进 PR 描述。凡是"今天做不到"
的部分，如实标注为什么做不到，不允许编造看似合理但没跑过的验证结果。

本清单的未完成 backlog 共 **27 项**。机械复核：

```bash
test "$(rg -n '^\| CE-[0-9]{3} ' docs/proposals/PROP-CONTEXT-ENGINE-001.checklist.md | wc -l | tr -d ' ')" = 27
```
