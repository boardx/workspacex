# PROP-HARNESS-MODEL-001 — 执行 Checklist

**这不是第二份规格。** backlog 每条的描述/依赖/完成契约唯一定义在
[`PROP-HARNESS-MODEL-001.md` §14](./PROP-HARNESS-MODEL-001.md#14-backlog)（原文表格）。
本文件只勾状态，出现分歧以正文为准（P3：引用优于复制）。

**记录规则**：状态只有四种，禁止用"看起来做了"顶替：

- `⬜ 未开始`
- `🔶 进行中`（写谁在做、哪个分支/PR）
- `✅ 完成`（写 PR 链接 + 反证证据摘要，没有证据不许打勾）
- `⏭️ 已有等价实现`（今天/近期已经用别的形式解决了同一个问题，需要在正式 Wave 里把它**收编**进模型，而不是重做）

最后更新：2026-08-11，dev-chat-e2e 会话对账（E1 合并状态 + H3A 等价实现收编标注）。

---

## 启动条件（正文 §17，本次执行口径变更）

- [x] 人类接受本 Proposal 作为解决思路（"这个是一个解决思路"）
- [ ] 建立总追踪 Issue —— **按人类指示跳过，用本文件代替**
- [ ] HMV2-001～005 各自建立 issue —— **同上，跳过**
- [x] 指定 coord-architecture 负责人（Proposal 自己写的建议负责人）
- [ ] 明确旧格式冻结时点
- [ ] 当前共享 checkout 清理完毕
- [x] 所有开发使用独立 worktree（本仓今晚全天在执行的规矩）
- [x] 不把本计划合并进任何在途产品 feature（今晚三条并行任务全部走独立分支）

---

## Epic E0：决策与安全基线

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-001 | P0 | ✅ 完成 | **裁定（2026-08-07，coord-architecture 按人类"你来决定使用最佳实践"授权裁定）：不需要单独 ADR**——本文件头的签核记录（"这个是一个解决思路"/"按照你的建议开始吧"）本身就是可读、可引用、带日期的决策记录，同 H3A-001（PROP-HARNESS-AGENT-001）刚示范的模式；另立 ADR 是重复声明同一签核事实，违反 AGENTS.md 单一事实源纪律 |
| HMV2-002 | P0 | ✅ 完成 | 全仓模板 inventory：8 个候选（1 个 subagent 广度扫描，每个 ≥2 真实实例），3 个文件级、适合 E1 InstanceMetadata 模型（已转 HMV2-004 注册），5 个是嵌在别的文件/非文件制品里的重复结构，如实记录"现在的模型盖不到"、不强行注册（同 #641 的判断纪律）。见 `docs/proposals/PROP-HARNESS-MODEL-001-inventory.md`。PR #653（已合并，但内容一度从 main 消失——见 worker/coord-architecture-recover-641-653 的找回记录） |
| HMV2-003 | P0 | ⬜ 未开始 | 冻结旧模板新增入口（WARN，不阻断）——留给下一个 PR，需要先定"新增入口"对分类 A 三个类型分别是什么可判定事件 |
| HMV2-004 | P0 | ✅ 完成 | 为 HMV2-002 分类 A 的 3 个新发现类型分配永久编号：`TPL-SKL-001`（Skill Activation Metadata，17 实例）/`TPL-UIP-001`（UI Preview Index，21 实例）/`TPL-DLT-001`（Design Delta Bundle，2 实例）。用 `pnpm harness templates allocate` 分配，不是手改数组——dogfood E1 自己的分配器。PR #653（已合并，找回记录同上） |
| HMV2-005 | P0 | ⬜ 未开始 | 迁移兼容策略与 rollback 规则 |

---

## Epic E1：模板注册表与 Schema 基础

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-006 | P0 | ✅ 完成 | TPL-REG-001 注册表——`.harness/templates/registry.yaml`，seed 全部 23 个模板类型。PR #634 已合并（2026-08-07），其余六条同此 PR |
| HMV2-007 | P0 | ✅ 完成 | Template Registry schema——`.harness/scripts/lib/template-model.ts` |
| HMV2-008 | P0 | ✅ 完成 | Instance 公共元数据 schema——同上，`InstanceMetadata` |
| HMV2-009 | P0 | ✅ 完成 | 原子 Template ID 分配器——`template-id.ts` + `pnpm harness templates allocate` |
| HMV2-010 | P0 | ✅ 完成 | Instance ID 唯一性门控——`template-doctor.ts` `duplicateInstanceIds` |
| HMV2-011 | P0 | ✅ 完成 | retired/deprecated 生命周期门控——`retiredTemplateViolations` |
| HMV2-012 | P0 | ✅ 完成 | 模板引用完整性门控——未注册引用 + 版本不受支持 + 死链，均含活体反证 |

---

## Epic E2：Renderer 与生成物治理

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-013 | P0 | ✅ 完成 | `renderer-model.ts`：按 template_id 注册的类型化 renderer 注册表 + `renderChecked` 三类完整性校验（模板匹配/来源指纹回指/revision 一致），12 条单测含 4 组反证。API 形状经 coord-main 裁决（#422，2026-08-11 夜间，E2 由 dev-chat-e2e 代跑）。本 PR |
| HMV2-014 | P0 | ✅ 完成 | `placeholder-gate.ts`：machine（`{{...}}`）+ human（`<CJK>`/`<…>`）两类检测，规则取自 `.harness/templates/` 实测语法；纯 ASCII 尖括号如实标注不覆盖（与 HTML/泛型不可区分）；行内 ignore 标记同 skill-doctor 先例。9 条单测含反证。本 PR |
| HMV2-015 | P0 | ✅ 完成 | `generated-metadata.ts`：文件内注释头（.md/.yaml 两种语法）+ 正文哈希三件原语（wrap/parse/verify），哈希由 wrap 内部计算防伪造，未登记扩展名抛错不静默省略。口径经 #422 提案无异议。12 条单测含 5 组反证。本 PR |
| HMV2-016 | P0 | ✅ 完成 | `generated-drift-gate.ts`（presence-based：带 015 元数据头即受控，畸形头/正文哈希不符即红）接入 `templates doctor`（§12 第 9 条，从 notYetImplemented 移除）；git ls-files -z 全量扫描，git 失败=UNKNOWN 非零退出（P7）。6 条单测 + 活体反证（基线绿→种手改文件红 exit=1→恢复绿）。'该有头而没有'的目录约定半边如实标注留给 017 落盘时定。本 PR |
| HMV2-017 | P1 | ✅ 完成 | `templates render [--dry-run]`：E2 五件套组装（render-pipeline.ts 纯组合层 013→014→015，016 在下游复检）+ 收编 H3A-035 为首个注册 renderer（adapter 零改动渲染逻辑，兑现 HMV2-025 行的收编标注）+ 首份真实 TPL-EVT-001 事件实例与其生成物入库。发现并上报 TPL-EVT-001 双 schema 并存（E1 示例 vs H3A-033 envelope，#422 待裁）；template-scan 豁免从按 template_id 改为按目录（每份文件恰归一道门）。口径依据 #422 无异议协议。本 PR |
| HMV2-018 | P1 | ⬜ 未开始 | `templates migrate` 框架 |
| HMV2-019 | P1 | ⬜ 未开始 | Mermaid renderer 基础 |

---

## Epic E3：Agent 组织与通信模型

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-020 | P0 | ⏭️ 已有等价实现 | H3A-020~029 分层授权模型（PR #686）+ H3A-022 Role↔Domain 绑定（PR #698）已落 Role schema 与门控；收编=对齐 TPL-ROL-001 编号，不重做 |
| HMV2-021 | P0 | ⏭️ 已有等价实现 | `.harness/agents/registry.yaml` + H3A-004 旧角色新增冻结 WARN（PR #675）已是注册权威+门控；收编同上 |
| HMV2-022 | P0 | ⏭️ 已有等价实现 | 既有 `gen-subagents`（双工具生成）+ H3A-028 portable role generator 接层校验（PR #807） |
| HMV2-023 | P0 | ⏭️ 已有等价实现 | H3A-030（PR #717）落了 TPL-TSK-001 schema+doctor；另有 H3A-031/032 两道派工 gate（PR #722/#723） |
| HMV2-024 | P0 | ⏭️ 已有等价实现 | H3A-033（PR #721）落了 TPL-EVT-001 四类 envelope schema+doctor；H3A-034（PR #760）补 stable ID + append-only gate |
| HMV2-025 | P0 | ⏭️ 已有等价实现 | H3A-035（PR #761）12 行短文本 renderer（`workflow-event-renderer.ts`） |
| HMV2-026 | P0 | ⏭️ 已有等价实现 | H3A-036（PR #764）落了 TPL-RVW-001 schema+doctor；H3A-037（PR #779）补 stale gate |
| HMV2-027 | P0 | ⏭️ 已有等价实现 | `pr-queue.ts`（PR #472/#574 系列）已做"verdict 锚定 exact SHA、head 漂移旧 verdict 失效"，未来收编进 TPL-RVW-001 schema |
| HMV2-028 | P1 | ⬜ 未开始 | TPL-CYP-001 Cycle Plan |
| HMV2-029 | P1 | ⬜ 未开始 | TPL-CYR-001 Cycle Result |
| HMV2-030 | P1 | ⏭️ 已有等价实现 | H3A-039（PR #813）`workflow-event-github-projection.ts`，Board 可靠解析不猜标题 |

---

## Epic E4：交付模型

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-031 | P0 | ⬜ 未开始 | TPL-PHS-001 Phase schema |
| HMV2-032 | P0 | ⬜ 未开始 | TPL-REQ-001 Requirement schema |
| HMV2-033 | P0 | ⬜ 未开始 | TPL-FTR-001 Feature schema |
| HMV2-034 | P0 | ⏭️ 已有等价实现 | `assertSingleInProgress` + `verify.ts` 已做"状态不能自己改、只能命令转"，未来收编进模型 |
| HMV2-035 | P0 | ⬜ 未开始 | TPL-SPR-001 Sprint schema |
| HMV2-036 | P0 | ⏭️ 已有等价实现 | evidence fingerprint + doctor 已存在，未来收编进 TPL-EVD-001 |
| HMV2-037 | P0 | ⬜ 未开始 | TPL-RDY-001 Readiness schema |
| HMV2-038 | P1 | ⬜ 未开始 | TPL-HOF-001 Handoff schema |
| HMV2-039 | P1 | ⬜ 未开始 | progress 自动视图 |
| HMV2-040 | P1 | ⬜ 未开始 | Phase/Sprint Markdown renderer |

---

## Epic E5：契约束模型与签核

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-041 | P0 | ⬜ 未开始 | TPL-CTR-001 Bundle schema |
| HMV2-042 | P0 | ⬜ 未开始 | Operation 稳定 ID 规则 |
| HMV2-043 | P0 | ⬜ 未开始 | TPL-INV-001 Invariant schema |
| HMV2-044 | P0 | ⏭️ 已有等价实现 | design-delta 签核（今天 `realtime-asr` 那份）已做"绑 bundle hash + commit + 人类身份"，且已补防伪造检查（`confirmed_by` 必须是 registry 里的人类），未来收编进 TPL-SGN-001 |
| HMV2-045 | P0 | ⏭️ 已有等价实现 | 同上，design-delta 的 status 门控就是雏形 |
| HMV2-046 | P0 | ⬜ 未开始 | TPL-COH-001 Coherence schema |
| HMV2-047 | P0 | ⬜ 未开始 | Traceability validator |
| HMV2-048 | P1 | ⬜ 未开始 | Bundle Markdown renderer |
| HMV2-049 | P1 | ⬜ 未开始 | Traceability Mermaid renderer |
| HMV2-050 | P1 | ⬜ 未开始 | Contract dependency graph |

---

## Epic E6：GitHub、看板与可视化

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-051 | P0 | ⬜ 未开始 | TPL-ISS-001 Issue renderer |
| HMV2-052 | P0 | ⬜ 未开始 | 删除 Issue body 双实现 |
| HMV2-053 | P0 | ⏭️ 已有等价实现 | `rewrite-coverage.ts` 的 `incomplete` 分支已做"数据源不可用时不下否定性判断"，未来收编进看板健康模型 |
| HMV2-054 | P0 | ⬜ 未开始 | Board 读取结构化 Issue 评论 |
| HMV2-055 | P0 | ⬜ 未开始 | 下一动作推导器（今晚已实证：看板给的下一步曾经写错，见 #574 review 记录） |
| HMV2-056 | P0 | ⬜ 未开始 | 最长串行链计算 |
| HMV2-057 | P0 | ⬜ 未开始 | E2E 状态绑定 CI SHA |
| HMV2-058 | P1 | ⬜ 未开始 | 系统组件图 renderer |
| HMV2-059 | P1 | ⬜ 未开始 | Feature 生命周期图 |
| HMV2-060 | P1 | ⬜ 未开始 | Agent 协作泳道图 |
| HMV2-061 | P1 | ⬜ 未开始 | Board 可视化摘要 |

---

## Epic E7：Invariant 与坏仪器治理

> ⚠ 这个 Epic 里三条今天已经有真实、已合入 main 的实现（不是设计稿），
> 是本 checklist 里进度最高的一块。收编方式：把它们的判定逻辑抽成 E1 的
> schema 驱动版本，而不是重写。

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-062 | P0 | ⬜ 未开始 | Gate 统一 finding ID —— 今天各道新门（rewrite-coverage/stack-admission/isolation-guard）各自的报错格式不统一，需要真做 |
| HMV2-063 | P0 | 🔶 进行中（无系统化协议） | 今天每道新门都手动做了"基线绿、单点破坏红、恢复绿"（PR #574/#578/#488/#620/#621 全部照做），但没有强制机制，是人肉纪律不是门控 |
| HMV2-064 | P0 | ✅ 完成 | `.harness/scripts/lib/rewrite-coverage.ts` 的 `analyzeRewriteCoverage`：扫到 0 条路由/rewrite → `incomplete: true`，拒绝下否定性判断。PR #574（已合入 main）。反证：注入空输入 → 不报缺口，只报 WARN |
| HMV2-065 | P0 | ✅ 完成 | 同上文件 `staleAllowlistEntries`：allowlist 只能变短，补好的豁免不删会被报陈旧。PR #574。反证：塞入已不缺的前缀 → 报红 |
| HMV2-066 | P0 | ⏭️ 已有等价实现（非 schema 驱动） | 同一份 #574 也做了 contract→route 覆盖扫描的雏形（今天量出 429 操作/126 路由/72% 缺口），但是脚本级不是模型级，需要在 E1 之后重做成读 TPL-CTR-001 |
| HMV2-067 | P0 | ✅ 完成 | `rewrite-coverage.ts` 主体就是这一条：route→rewrite 完整门，两种形态（空前缀 controller、裸路径+`:path*` 成对）都覆盖，11 条反证。PR #574 |
| HMV2-068 | P1 | ⬜ 未开始 | UI→controller 追踪门（即 #397，已有 issue 判断"应提前、做成棘轮"，尚未实现） |
| HMV2-069 | P1 | ⬜ 未开始 | Literal snapshot 检测替代方案 —— 今天手动修过三次同类问题（`deploy-readiness.test.ts` 钉死整行命令、`workspacex-integration.test.ts` 钉死错误网关值、`test-isolation.test.ts` 钉死函数名），但都是逐个发现逐个修，没有通用扫描器 |

---

## Epic E8：试点迁移

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-070 | P0 | ⬜ 未开始 | coord-main Role 试点 |
| HMV2-071 | P0 | ⬜ 未开始 | #564 Work Event 试点 |
| HMV2-072 | P0 | ⬜ 未开始 | 一个新 Feature 试点 |
| HMV2-073 | P0 | ⬜ 未开始 | chat Contract Bundle 试点 |
| HMV2-074 | P0 | ⬜ 未开始 | chat Bundle 人类复签 |
| HMV2-075 | P0 | ⬜ 未开始 | 新 Board 并行只读试跑 |
| HMV2-076 | P0 | ⬜ 未开始 | 试点差异报告 |
| HMV2-077 | P0 | ⬜ 未开始 | 人类 Go/No-Go |

---

## Epic E9：批量迁移与退役

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-078 | P1 | ⬜ 未开始 | 全部角色迁移 |
| HMV2-079 | P1 | ⬜ 未开始 | Phase 00 交付模型迁移 |
| HMV2-080 | P1 | ⬜ 未开始 | Phase 01 交付模型迁移 |
| HMV2-081 | P1 | ⬜ 未开始 | Phase 02/03 交付模型迁移 |
| HMV2-082 | P1 | ⬜ 未开始 | Phase 00 契约束迁移（migration program，逐束独立 issue/PR） |
| HMV2-083 | P1 | ⬜ 未开始 | Phase 01 契约束迁移（同上） |
| HMV2-084 | P1 | ⬜ 未开始 | 模块知识模板迁移 |
| HMV2-085 | P1 | ⬜ 未开始 | ADR 模板迁移 |
| HMV2-086 | P1 | ⬜ 未开始 | Runtime/Handoff 迁移 |
| HMV2-087 | P1 | ⬜ 未开始 | 删除手写 progress 模板 |
| HMV2-088 | P1 | ⬜ 未开始 | 正式退役 ui-signoff 模板文件 |
| HMV2-089 | P1 | ⬜ 未开始 | 删除 Issue body 规格副本 |
| HMV2-090 | P1 | ⬜ 未开始 | 删除旧 agent prompt 副本 |

---

## Epic E10：文档收敛与退出

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-091 | P1 | ⬜ 未开始 | AGENTS.md 压缩为入口页（≤100 行；实测当前 131 行） |
| HMV2-092 | P1 | ⬜ 未开始 | ON-JOIN.md（≤80 行） |
| HMV2-093 | P1 | ⬜ 未开始 | EVERY-LOOP.md（≤40 行） |
| HMV2-094 | P1 | ⬜ 未开始 | BEFORE-DELIVERY.md（≤60 行） |
| HMV2-095 | P1 | ⬜ 未开始 | instructions 重分类为 reference |
| HMV2-096 | P1 | ⬜ 未开始 | 重复事实扫描与清理 |
| HMV2-097 | P1 | ⬜ 未开始 | 模板 V1 兼容读取冻结 |
| HMV2-098 | P1 | ⬜ 未开始 | V2 全量 doctor |
| HMV2-099 | P1 | ⬜ 未开始 | 效率与信息损失复盘 |
| HMV2-100 | P1 | ⬜ 未开始 | Harness V2 正式启用（人类最终签核） |

---

## 现状汇总（2026-08-06 现场统计）

```
100 条总数
  ✅ 完成            2 条（HMV2-064, HMV2-067）
  ⏭️ 已有等价实现     6 条（HMV2-027, 034, 036, 044, 045, 053, 066）
  🔶 进行中           1 条（HMV2-063，纪律层面，非机械）
  ⬜ 未开始          91 条
```

**结论**：Epic E7（坏仪器治理）是今天实际进度最高的一块，纯属"今天全天在补 CI 门控"这条主线
的副产品，不是刻意按这份 Proposal 的顺序做的。**没有一条 P0 基础设施项（E0/E1，HMV2-001~012）
真正开始**——而依赖图显示，E1（Registry/Schema）不完成，E2~E10 全部无法真正开工，"已有等价实现"
那 6 条也只能停留在"脚本级"，进不了"模型级"。

## 建议的下一步（不是决定，等你确认）

1. **先做 HMV2-006~012**（Template Registry + Schema + 各类门控，Epic E1 全部）——这是唯一
   一批"做完之后别的东西才能真的开始"的项，且规模不大（一个 registry 文件格式 + 一个 schema
   validator + 几个 CLI 子命令），今天的吞吐量（近 24h 合并 50 个 PR）下，粗估 1 天量级可以出
   第一版可用的骨架。
2. 做完 E1 之后**停下来**，把 Epic E7 那 3 条"已有等价实现"的脚本改写成读 E1 的 schema——这是
   一次**真实的验收**：如果收编成本很低，说明模型设计对了；如果发现削足适履，说明 schema 需要
   改，趁早改比迁移到一半再改便宜得多。
3. E3/E4 可以在 E1 完成后并行开工（Proposal 自己的依赖图这么画的），但**不要**在验收步骤 2
   之前启动，理由同上。

要我现在开始 HMV2-006（Template Registry 骨架）吗？

> **进展更新（2026-08-06）**：人类已确认"按照你的建议开始吧"。HMV2-006~012（Epic E1 全部）
> 已实现、48 条单测 + 3 条活体反证全过，PR [#634](https://github.com/boardx/workspacex/pull/634)
> 待独立 review（本会话无合并权限）。上表状态已同步为"🔶 PR #634 待 review"，merge 后再改
> "✅ 完成"。下一步严格按上面第 2 条执行：**先**验收 E7 那 3 条脚本能否改读 E1 schema，
> 再谈是否启动 E3/E4。
>
> **验收结果（2026-08-06，PR [#641](https://github.com/boardx/workspacex/pull/641)，
> 叠在 #634 分支上、还没合，因为 #634 自己也还没合）**：
> 挑的不是"把 HMV2-064/065/067 的判定逻辑改成读 schema"（那三条本身是 route↔rewrite
> 完整性判定，不天然长得像"模板实例"，硬套会是那种"发现削足适履"的坏结果）。
> 真正命中的是 **HMV2-066 点名要做但本身还没做**的那类收编：给 `TPL-EVD-001`
> （Evidence Manifest）接第一个真实消费者——`lint-rewrite-coverage.mjs`
> 每次运行后把判定结果包成一份 `InstanceMetadata` 实例落盘，`templates doctor`
> 原样扫到、原样校验，**零改动**`analyzeRewriteCoverage`本身的判定逻辑。
> 新增代码 <100 行 + 6 条单测 + 2 条活体反证（真实注入坏 template_id，一次触发
> schema 校验、一次触发未注册引用，均命中预期 finding code）。
> **结论：收编成本很低——E1 的 InstanceMetadata 形状对"机器生成的证据"这类场景
> 直接成立，不需要改 schema。** HMV2-066 本身（contract→route 扫描改读
> `TPL-CTR-001`）**仍未做**，规模明显更大（今天量出 429 操作/126 路由），留给
> 下一轮；HMV2-064/065/067 维持"✅ 完成（脚本级）"不变——它们的判定逻辑没有
> 理由被迫套进模板实例的形状。

---

## 现状对账（2026-08-11，实测 origin/main，非沿用 08-06 快照）

```
100 条总数
  ✅ 完成            13 条（E0: 001/002/004；E1: 006~012 全部——PR #634/#653 已合并，
                          #641 验收也已合并；E7: 064/065/067）
  ⏭️ 已有等价实现    15 条（E3: 020/021/022/023/024/025/026/027/030 共 9 条——大部分由
                          PROP-HARNESS-AGENT-001（H3A）系列 PR 落地，见各行备注；
                          E4: 034/036；E5: 044/045；E6: 053；E7: 066）
  🔶 进行中           1 条（HMV2-063，纪律层面）
  ⬜ 未开始          71 条
```

**关键事实（对账发现）**：HMV2 Epic E3（Agent 通信模型）在本 checklist 未更新期间，
被另一份提案 PROP-HARNESS-AGENT-001 的 H3A-030~039 系列**用 HMV2 规划的同一批
模板编号（TPL-TSK-001/TPL-EVT-001/TPL-RVW-001）** 实现掉了——不是"类似的东西"，
是字面同名 schema 的机械门控已合入 main（各行备注附 PR 号可核）。这不算重复建设
（两份提案共享模板编号体系，H3A 是消费者），但 checklist 五天没对账导致快照
一度显示"91 条未开始"。教训：动手前先对账，同"修 CI 红前先查有没有人在修"。

**剩余真实缺口（按 §15 依赖序）**：
1. **E2（HMV2-013~019）Renderer 与生成物治理**——typed renderer/占位符门/
   generated drift gate 全部真未做，是 E4/E5/E6 一切"从模型生成视图"的地基。
2. **E4/E5 交付模型与契约束 schema**（031~033/035/037~043/046~050）——bundle.yaml
   三件套收敛是契约束人工内容降 60% 目标的关键。
3. **E6 看板**（051~061 未覆盖项）+ **E8 试点**（070~077）→ 人类 Go/No-Go（HMV2-077）。
4. **E9/E10 批量迁移与文档压缩**——Go/No-Go 之前禁止动（§15 不可并行约束）。
