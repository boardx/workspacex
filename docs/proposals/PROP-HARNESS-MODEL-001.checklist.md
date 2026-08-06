# PROP-HARNESS-MODEL-001 — 执行 Checklist

**这不是第二份规格。** backlog 每条的描述/依赖/完成契约唯一定义在
[`PROP-HARNESS-MODEL-001.md` §14](./PROP-HARNESS-MODEL-001.md#14-backlog)（原文表格）。
本文件只勾状态，出现分歧以正文为准（P3：引用优于复制）。

**记录规则**：状态只有四种，禁止用"看起来做了"顶替：

- `⬜ 未开始`
- `🔶 进行中`（写谁在做、哪个分支/PR）
- `✅ 完成`（写 PR 链接 + 反证证据摘要，没有证据不许打勾）
- `⏭️ 已有等价实现`（今天/近期已经用别的形式解决了同一个问题，需要在正式 Wave 里把它**收编**进模型，而不是重做）

最后更新：2026-08-06，coord-architecture。

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
| HMV2-001 | P0 | ⬜ 未开始 | 本 Proposal 尚未 ADR 化；按人类口径本条降级为"本文件即決策记录"，是否仍需正式 ADR 待人类确认 |
| HMV2-002 | P0 | ⬜ 未开始 | 全仓模板 inventory，含隐形模板（散落的重复格式） |
| HMV2-003 | P0 | ⬜ 未开始 | 冻结旧模板新增入口（WARN，不阻断） |
| HMV2-004 | P0 | ⬜ 未开始 | 为现有模板分配永久编号 |
| HMV2-005 | P0 | ⬜ 未开始 | 迁移兼容策略与 rollback 规则 |

---

## Epic E1：模板注册表与 Schema 基础

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-006 | P0 | ⬜ 未开始 | TPL-REG-001 注册表 |
| HMV2-007 | P0 | ⬜ 未开始 | Template Registry schema |
| HMV2-008 | P0 | ⬜ 未开始 | Instance 公共元数据 schema |
| HMV2-009 | P0 | ⬜ 未开始 | 原子 Template ID 分配器 |
| HMV2-010 | P0 | ⬜ 未开始 | Instance ID 唯一性门控 |
| HMV2-011 | P0 | ⬜ 未开始 | retired/deprecated 生命周期门控 |
| HMV2-012 | P0 | ⬜ 未开始 | 模板引用完整性门控 |

---

## Epic E2：Renderer 与生成物治理

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-013 | P0 | ⬜ 未开始 | Typed renderer API |
| HMV2-014 | P0 | ⬜ 未开始 | 未解析占位符门控 |
| HMV2-015 | P0 | ⬜ 未开始 | Generated file metadata |
| HMV2-016 | P0 | ⬜ 未开始 | Generated drift gate |
| HMV2-017 | P1 | ⬜ 未开始 | `templates render` 命令 |
| HMV2-018 | P1 | ⬜ 未开始 | `templates migrate` 框架 |
| HMV2-019 | P1 | ⬜ 未开始 | Mermaid renderer 基础 |

---

## Epic E3：Agent 组织与通信模型

| ID | P | 状态 | 备注 |
|---|---|---|---|
| HMV2-020 | P0 | ⬜ 未开始 | TPL-ROL-001 Role schema |
| HMV2-021 | P0 | ⬜ 未开始 | TPL-AGT-001 Registration schema |
| HMV2-022 | P0 | ⬜ 未开始 | Claude/Codex role prompt generator |
| HMV2-023 | P0 | ⬜ 未开始 | TPL-TSK-001 Task Assignment |
| HMV2-024 | P0 | ⬜ 未开始 | TPL-EVT-001 Work Event |
| HMV2-025 | P0 | ⬜ 未开始 | Work Event 短文本 renderer |
| HMV2-026 | P0 | ⬜ 未开始 | TPL-RVW-001 Review Verdict |
| HMV2-027 | P0 | ⏭️ 已有等价实现 | `pr-queue.ts`（PR #472/#574 系列）已做"verdict 锚定 exact SHA、head 漂移旧 verdict 失效"，未来收编进 TPL-RVW-001 schema |
| HMV2-028 | P1 | ⬜ 未开始 | TPL-CYP-001 Cycle Plan |
| HMV2-029 | P1 | ⬜ 未开始 | TPL-CYR-001 Cycle Result |
| HMV2-030 | P1 | ⬜ 未开始 | GitHub 评论结构化投影 |

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
