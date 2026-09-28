# 契约束 `work-skill-meta` — 领域模型与不变量（支撑材料）

## 一、现状核实

- 包模型表 `skills` / `skill_versions` / `skill_version_files` / `skill_mounts` 定义于
  `apps/api/migrations/20260804031000_wave2_skill_starter_import.sql`；`skill_versions.manifest jsonb` 不可变。
- 导入唯一入口 `POST /admin/skills/starter-pack-imports`（`packages/contracts/src/wave2-runtime.ts`
  `importSkillStarterPack`，错误枚举 `SkillStarterImportError`）。
- 工具目前仅有 `sideEffect`（`packages/contracts/src/agent-runtime.ts`），尚无 `capabilityCategory`（ADR-120 引入）。
- `apps/api/src/application/skill/resolve-runtime-context.ts` 现只算数据范围，无就绪性（requirements R1 现状核实）。

## 二、概念

- **WorkSkillManifest**（值对象，版本内不可变）：`stableId, domain, riskClass, dependencies{required,optional},
  provenance[], locales[], jurisdictions[], evalSuiteId, inputSchema, outputSchema`；存于 `skill_versions.manifest.work`。
- **SkillCatalogEntry**（可变聚合，表 `skill_catalog_entries`）：`org_id, skill_id, stable_id, domain, channel,
  successor_skill_id, search 字段, updated_by, updated_at`；门状态由 ADR-119 写回（本束仅占位）。
- **CapabilityCategory**：ADR-120 的能力分类；分类登记表是其合法值来源。
- **SkillReadiness**（派生值，按请求计算）：`required/optional × 组织已授权且启用工具的分类集合`。

## 三、不变量

| # | 不变量 | 出处 |
|---|---|---|
| I-1 | Work Skill 只用包模型承载；不新建 DigitalHuman/声明式 Work 字段 | ADR-117 #1/#4，ADR-116 |
| I-2 | manifest 随版本不可变；改元数据 = 发新版本；任何角色不可改 `skill_versions.manifest` | ADR-117 #2，R5 |
| I-3 | 通道/后继/检索字段只在目录行；manifest 不含 channel（同一事实不两处） | ADR-117 #3，R7 |
| I-4 | 新迁移不改 `skill_versions` 结构；`skills.status` enabled/disabled 语义不变 | ADR-117 后果，R10 |
| I-5 | 每个 Work Skill（每组织）有且仅有一行目录记录；`(org_id, stable_id)` 唯一 | R6，E2 |
| I-6 | 导入原子：manifest 校验失败 → 不写 skill_versions 也不写目录行 | E1/E6/E8 |
| I-7 | 依赖只写能力分类，不写供应商；分类须已登记 | ADR-120 #1，E6 |
| I-8 | 通道转移仅 `candidate→verified`、`candidate→deprecated`、`verified→deprecated`；deprecated 终态；重导入不回退通道 | R7，R3.4 |
| I-9 | verified 须满足 ADR-119 门（G5 胜过基线）；门脚本前需显式 `gateEvidenceRef`；只有 verified 可被官方 Agent 绑定 | ADR-119 #3/#4 |
| I-10 | 后继不得指向不存在/自身/成环 | E3 |
| I-11 | 就绪性不缓存为事实；查询失败 = `unknown` ≠ ready；被拒授权不得用同分类其他供应商静默替代 | R7，ADR-120 #3 |
| I-12 | 目录可见性不以 Agent 挂载为条件；Workflow 固定的 Skill 版本无需所属 Agent 挂载 | ADR-118 #9 |
| I-13 | provenance 必含 license；`copied=true` 必含 notice | ADR-119 G1，E8 |
| I-14 | RLS 按 org_id；跨组织/不存在一律 404；未登录 401 | R5 |

## 四、洋葱落点

- domain：manifest 校验规则、通道转移表（`WORK_SKILL_CHANNEL_TRANSITIONS`）、就绪性纯函数。
- application：import 扩展、catalog 查询/变更、readiness 用例；ports：`SkillCatalogRepository`、`CapabilityRegistry`、`ToolGrantReader`、`AuditSink`。
- infrastructure：PG 仓储（新迁移 `skill_catalog_entries` + RLS）、trigram/全文索引。
