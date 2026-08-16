---
status: pending
bundle: skill-model-a-b-convergence
base_bundle: skills
scope: converge-skill-declarative-contract-model-b-and-file-based-model-a
covers: []
confirmed_by: null
confirmed_at: null
confirmed_via: null
---

# design delta 签核 · Skill 双模型（声明式契约 vs 文件式导入）收敛

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

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

这不是纯技术债清理，而是要不要保留"结构化 skill 契约"这个产品设计的问题——所以走 delta 签核，
不能 agent 自己拍板。

## 签核前请重点确认（逐条在 `contract.md` §1 展开）

- [ ] **三选一**：`contract.md` §1 列了三个收敛方向——① B 整体废弃、声明式能力搬进 A（工作量 L，
      需先裁决未决契约分歧 D08）；② A 为唯一权威、B 冻结只读 legacy（工作量 M，与 #595 既成事实一致，
      本 delta 倾向的方向）；③ 保留双模型、补一条 B→A 的显式编译桥（工作量 M，但有持续同步维护成本，
      形状正是 AGENTS.md 警告的"同一事实两处"）。选哪个？
- [ ] **如果选①**：确认同意先由人类另行裁决 D08（`SkillStatus` 五态 vs 域层四态），不在本 delta 内
      顺带决定。
- [ ] **如果选②**：确认可以接受"完全新建声明式 skill"这个入口从 UI 上移除（声明式录入的价值
      —— 结构化约束——可以作为 A 的编辑器工作流里的辅助校验功能保留，但不再是独立数据模型）。
- [ ] **如果选③**：确认接受长期维护成本（每次模型 B 的 schema 演进都要想一遍编译桥要不要跟着改），
      以及要求实现方补一条同步一致性反证测试（`verification.md` V4）。
- [ ] **派工节奏**（`contract.md` §3）：确认签核后单独排期，与当前活跃的 skill 相关分支
      （trial-run/url-import/asset-file-repo 等）串行化，不并行改同一批热点文件。

## 与既有束的关系

- **不修改** `contracts/skills/` 下任何已签文件的 `status`；本 delta 是对该束核心设计前提
  （"Skill 是什么"）的收敛，规范以本目录 `contract.md` 为准，签核后由 requirement-author 按选中方向
  生成新的 F-number（目前 #598 在 `feature_list.json` 里没有对应条目）。
- **不阻塞**已合入的 F595（后台导入/目录/编辑/试跑）——那条已完整落地在模型 A，任何一个选项都不改
  它已验收的行为（`verification.md` VG1）。
