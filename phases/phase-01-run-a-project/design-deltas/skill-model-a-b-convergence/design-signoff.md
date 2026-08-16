---
status: confirmed
bundle: skill-model-a-b-convergence
base_bundle: skills
scope: converge-skill-declarative-contract-model-b-and-file-based-model-a
# covers 追加（2026-08-16，requirement-author 生成 F190 后回填）：签核时（08:42）尚无
# F-number，人类已确认的是选项②这个技术方向本身（不是某个具体 F 编号），F190 是
# 该方向唯一对应的 feature（UC-3.7），回填是账本记录，不是新的设计决定——不改
# status/confirmed_by/confirmed_at/confirmed_via 一字。
covers: [F190]
confirmed_by: yanbin shen
confirmed_at: 2026-08-16T08:42:00+08:00
confirmed_via: >-
  人类在 PR #1408 讨论中选定选项②（A 为唯一权威，B 冻结为只读 legacy）——理由：
  #595 已把导入/编辑/试跑全部落地在模型 A，模型 B 现在唯一还在用的入口
  （`POST /skills` 新建）建不出可执行的 skill，留着只是继续维持一条死路；
  选②风险和工作量都最低，与既成事实一致。选①（B 废弃搬进 A）、选③（保留
  双模型补编译桥）未选。
---

# design delta 签核 · Skill 双模型（声明式契约 vs 文件式导入）收敛

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 已选方向：选项②——A 为唯一权威，B 冻结为只读 legacy

`POST /skills`（`createSkillDraft`）摘掉或改 410；`skill-catalog-live.tsx`"完全新建"入口
移除，声明式录入并入 A 的编辑器工作流；存量 `skill_contracts`/`skill_contract_versions`
行保留只读（不迁移、不删除，`GET /skills/:skillId` 继续服务它们）；`listAll` 合并读维持
不变。验收断言见 `verification.md`"若选 选项 2"一节。

## 这份 delta 为什么存在

已签的 `skills` 束（F61-F68, F176）设计立意是"Skill＝声明式契约"（提示词模板＋输入输出 schema＋
数据范围声明）——落地成了 `skill_contracts`/`skill_contract_versions`（模型 B）。但 wave2
（`#412`，早于本束签核前后）为了让"上传的 skill 真能被 chat 调用"，引入了一套完全独立的
文件式模型（`skills`/`skill_versions`/`skill_version_files`，模型 A），运行时（`execute-run.ts`）
**只读**模型 A，从未读过模型 B。issue #598（2026-08-06 登记）指出这是 AGENTS.md 明令禁止的
"同一事实声明在两处"。

2026-08-16 逐文件核实后发现：读侧（`GET /skills` 列表）已经部分桥接（#662/#689），但**写侧
（`POST /skills` 仍只写模型 B）和详情侧（`GET /skills/:skillId` 仍只读模型 B）没有收敛**——
模型 B 建出来的 skill 运行时读不到、chat 里挂不上，是"功能性死路"，不是纯死代码（仍有活跃前端
入口 `skill-catalog-live.tsx` 的"完全新建"面板 + 多个测试依赖它）。

## 与既有束的关系

- **不修改** `contracts/skills/` 下任何已签文件的 `status`；本 delta 是对该束核心设计前提
  （"Skill 是什么"）的收敛，规范以本目录 `contract.md` 为准，签核后由 requirement-author 按
  选项②生成新的 F-number（目前 #598 在 `feature_list.json` 里没有对应条目）。
- **不阻塞**已合入的 F595（后台导入/目录/编辑/试跑）——那条已完整落地在模型 A，选项②不改
  它已验收的行为（`verification.md` VG1）。

## 派工节奏

签核后单独排期，与当前活跃的 skill 相关分支（trial-run/url-import/asset-file-repo 等）串行化，
不并行改 `skill.controller.ts` / `pg-skill-contract-repository.ts` / `skill-catalog-live.tsx`
这几处热点文件（`contract.md` §3）。
