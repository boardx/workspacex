# design delta 契约 · Skill 双模型（声明式契约 vs 文件式导入）收敛

> **规范唯一来源。** 已签核的 `skills` 束（F61-F68, F176）**保持不变、不被本文件静默修改**——
> 本 delta 处理的是该束签核之后才出现的一条实现分叉（wave2 文件式模型的引入），
> 把收敛方向写在这里等人类签。若实现与已签束正文冲突，**实现停下等人类签**，
> 不允许 agent 改已签束的 `status`。
>
> - **登记来源**：issue #598（debt，`area:skill p1 backlog core-loop`）。
> - **base_bundle**：`skills`（已签，`status: confirmed`，签核立意是"Skill＝声明式契约"）。
> - **调研依据**：本 delta 基于 2026-08-16 对代码库的逐文件核实（见 §0），不是转述 issue 正文——
>   issue #598 写于 2026-08-06 前后，其"运行时完全不读 B / 后台只写 B"的描述**读侧已过时**
>   （#662/#689 已把 `GET /skills` 合并读打通），本 delta 以核实后的现状为准。
> - 验收口径见同目录 [`verification.md`](./verification.md)；签核栏见 [`design-signoff.md`](./design-signoff.md)。

## §0 现状核实（实测 SHA `06474f4c`）

**两套模型，两条独立血统：**

| | 模型 A（wave2，文件式） | 模型 B（#459，声明式契约） |
|---|---|---|
| 表 | `skills`/`skill_versions`/`skill_version_files` | `skill_contracts`/`skill_contract_versions` |
| 建表 | `20260804031000_wave2_skill_starter_import.sql` | `20260805140000_i459_skill_declarative_contract_store.sql` |
| 内容形态 | 多文件，`SKILL.md` 为根，`content bytea` | 单记录 `{promptTemplate, inputSchema, outputSchema, dataScope, …}` |
| **运行时读取**（`execute-run.ts` 唯一真读的一套） | ✅ `pg-agent-run-repository.ts:readPinnedSkills` | ❌ 从未被运行时读取 |
| 写入方 | starter 导入 / URL 导入 / 文件编辑器 / F156 试跑 | 仅 `POST /skills`（`createSkillDraft`） |

**`skills` 束当初签的是模型 B**（束正文"Skill＝声明式契约（提示词模板＋输入输出 schema＋数据范围声明）"）。
模型 A 是**后来**（wave2）为了让"上传的 skill 真能被 chat 调用"而引入的独立血统，从未与已签束的
声明式设计正式收敛过——这正是 #598 说的"同一事实声明在两处"（AGENTS.md 明令禁止）。

**读侧已部分桥接，写侧和详情侧仍分裂**（2026-08-16 核实，晚于 issue #598 原文，也晚于 #595 裁决）：

1. `GET /skills`（列表）**已合并**：`pg-skill-contract-repository.ts:listAll`（:284-325）先查
   `skill_contracts` 再查 `skills` WHERE `status='enabled'`，两个结果集合并返回；wave2 行用哨兵
   `WAVE2_BACKED_DUTY_MARKER` 标记（前后端字面量耦合，`skill-catalog-live.tsx:126`），前端据此把这些行
   路由到"编辑源码"入口而非"查看契约"入口。
2. `capability_listings` 目录投影是**两模型的官方交汇点**（B 建表文件头 :16-25 自己写明）：三个写入方
   （B 的 create、A 的 starter 导入、A 的 URL 导入）都投影进这张表；后台"Skill 目录"页读的是
   `GET /capabilities?kind=skill`，不是 `GET /skills`。
3. **`POST /skills`（createSkillDraft）仍只写模型 B**——`/skill` 库屏"完全新建"面板
   （`skill-catalog-live.tsx:820`）是**唯一**从 UI 产出声明式契约 skill 的入口。这条路径产出的 skill
   **运行时读不到**（运行时只读 A），也没有 chat 挂载后可执行的路径——#598 说的"后台只写 B、运行时
   只读 A"，这一半**仍然成立**。
4. **`GET /skills/:skillId`（详情）仍只读模型 B**——`get-skill-detail.ts` 的 `loadDetail` 只
   `FROM skill_contracts`，对模型 A 的行恒返回 `null` → `SKILL_NOT_FOUND(404)`。前端靠给 A 行换入口
   （跳到 `AgSkillEditor`）绕过，没有修详情端口本身（`skill-catalog-live.tsx:100-115` 标了这处绕行，
   代号 G2/G6）。

**#595 裁决（"导入/目录/编辑/测试落地在模型 A"）已完整落地**：URL 导入、文件导入、目录浏览、代码编辑、
后台试跑（F156 trial-run）全部读写模型 A。模型 B 目前是**功能性死路**——能建、能列、能看详情，
但建出来的东西无法被 agent 运行时调用，不是纯死代码（仍有真实前端入口和测试依赖）。

## §1 待决问题（这份 delta 真正要人类拍板的地方）

`skills` 束签的是模型 B 的声明式契约设计（prompt 模板 + 输入输出 schema + 数据范围声明），这是一个
**产品设计选择**——用结构化字段约束 skill 的能力边界，而不是让 skill 是任意文件。模型 A（wave2）
则是纯文件式、无 schema 约束、`TRIAL_RUN_SCHEMA_MISMATCH` 永不抛（因为模型 A 根本没有 schema）。

**这不是一个纯技术债问题，是要不要保留"结构化 skill 契约"这个产品设计的问题。** 三个方向：

### 选项 1 — B 整体废弃，声明式能力搬进 A
把 `prompt_template`/`input_schema`/`output_schema`/`data_scope` 作为附加列或旁表挂到
`skill_versions`；`createSkillDraft` 改为产出 A 结构（生成含 `SKILL.md` 的文件包）；存量
`skill_contracts` 行迁移到 A。
- 影响：`getSkillDetail.out` 契约签名变化；需要人类先裁决已登记的**未决契约分歧 D08**
  （`contract-divergences.ts:158`，`SkillStatus` 五态 vs 域层四态）；数据迁移。
- 工作量：**L**。彻底解决"两处声明"，但代价最大。

### 选项 2 — A 为唯一权威，B 冻结为只读 legacy（推荐，理由见下）
`POST /skills` 摘掉或改 410；`skill-catalog-live.tsx`"完全新建"入口移除，声明式录入并入
A 的编辑器工作流（模板/校验可以是编辑器里的辅助功能，不必是独立数据模型）；存量 B 行保留只读
（不迁移、不删除，`GET /skills/:skillId` 继续服务它们）；`listAll` 合并读维持不变。
- 影响：`createSkillDraft` 契约需标废弃，触及 `skill-contract-crud.test.ts` 等测试判定；不改运行时、
  不迁数据。
- 工作量：**M**。与 #595 既成事实一致（#595 之后所有"真能跑"的路径已经改道 A 了，这只是把最后一个
  还写着 B 的入口也关掉）。

### 选项 3 — 保留双模型，补一条 B→A 的显式编译桥
`createSkillDraft` 发布时把 `prompt_template` 渲染成 `SKILL.md`，同步 INSERT 进
`skill_versions`/`skill_version_files`（复用既有 `wave2_publish_skill_version`）；
`getSkillDetail` 补齐对 A 行的读，消除现有的 404 绕行。
- 影响：不删契约、不迁存量数据；但又添一条"B→A 同步"链路——**正是 AGENTS.md 那条「同一事实两处 +
  机械门控」的警告形状**，需要额外的同步一致性测试兜底，否则将来某次改动让两边再次漂移。
- 工作量：**M**，但有持续维护成本（每次 B 的 schema 演进都要想一遍桥要不要跟着变）。

**本 delta 的立场（不是拍板，是给人类判断的依据）**：选项 2 破坏面最小、与 #595 既成事实最一致、
不引入新的双写风险；选项 1 最彻底但需要先解决 D08 且工作量最大；选项 3 保留了"结构化录入"的
产品体验但背上长期同步维护成本，且与 AGENTS.md 明确告诫的模式同形。**選哪个由人类定**，本 delta
不预设结论往下写实现。

## §2 与既有束的关系

- **不修改** `contracts/skills/` 下任何已签文件的 `status`；本 delta 是对该束"Skill 是什么"这一设计
  前提的收敛，规范以本目录 `contract.md` 为准。
- 签核后由 requirement-author 依据选定选项生成新的 F-number（本 issue 目前没有对应 feature_list 条目，
  纯 debt 登记），并把选中选项的验收口径写进 `feature_list.json`。
- **不阻塞**已合入的 F595（后台导入/目录/编辑/测试）——那条已完整落地在模型 A，本 delta 不改它。

## §3 派工冲突提示（如实标注，不阻塞签核本身）

调研时发现：`skill.controller.ts`（`POST /skills` / `GET /skills/:skillId`）、
`pg-skill-contract-repository.ts`（合并读逻辑）、`skill-catalog-live.tsx`
（前后端哨兵字面量 `WAVE2_BACKED_DUTY_MARKER` 两处耦合）三处无论选哪个方向都要改，
且是 #595/#662/#689 系列反复touch的热点——**建议签核后单独排期，与其他 skill-catalog 相关 PR 串行化**，
不要和当前活跃的 skill 相关分支（trial-run/url-import/asset-file-repo 等）并行改，避免撞车。
