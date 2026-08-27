---
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: skill-office-docs-node-runtime
base_bundle: skills   # 与 skill-sandbox-execution 同一挂靠理由：改的是 skills 束里的
  # DeclarativeContract 实体（新增三条 skill 声明），不是新开一个契约束。
scope: three-node-only-create-from-scratch-skills-for-docx-xlsx-pdf-original-implementation-not-a-port-of-anthropic-skills
covers: [F979]   # 机械登记，一次真实碰撞的实录：requirement-author 2026-08-27 按取号规则
  # （读工具调用当刻 feature_list.json 现存最大号）生成时得到 F972；落到本地 worktree、
  # 拉取当前 origin/main 后发现 F972 已被另一个不相关 feature（计划账本契约单源）占用，
  # 且 max 已推进到 F978——同 F962 记录过的那条纪律再次成立：ID 空间会被并行会话推进，
  # 权威只在 main 的 signoff，不由 worker 自行分配。机械改成 F979（下一个空闲号）。
  # 不改设计决定，只是取号登记；若合入时 main 上 F979 又已被占用，以 main 的 signoff 为准
  # 再次重编号，不影响 status/confirmed_by/confirmed_at/confirmed_via。
confirmed_by: usamshen    # TODO：人类签核时填
confirmed_at: 2026-08-26T09:19:24+08:00      # TODO：人类签核时填，ISO 8601
confirmed_via: "手工"     # TODO：人类签核时填，摘要引用哪次对话/哪条批准
---

# design delta 签核 · 新增 Word/PDF/Excel 文档生成 skill（原创 Node 实现）

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

人类 2026-08-27 要求"研究 GitHub 上 Claude Code 的开源 Word/PDF/Excel skill，按现有
后台 skill 管理规则导入"。调研发现这个前提不成立——Anthropic 官方 skill 仓库那几个
文档处理 skill 是限制性许可（禁止复制/衍生/再分发），社区 fork 也没有解决这个授权
问题（详见 `contract.md` §0）。就"怎么推进"这个分叉点已经问过人类，人类选择
**"原创重新实现"**：不碰 Anthropic 官方或任何 fork 的代码/提示词原文，用开源 Node 库
（docx/exceljs/pdf-lib，各自独立 MIT 许可）原创写三份新的 skill 声明。

本 delta 是那条路径的设计。**这是一份等待人类正式签核的提案**，不是已批准的设计——
下面每一条打勾都需要你显式确认；在 `status: confirmed` 之前，不会有任何代码改动
（包括沙箱镜像、`skills.ts` 契约、starter-pack 导入包）。

## 签核前请重点确认

- [ ] **① 授权结论本身**：确认"不引入 Anthropic 官方/社区 fork 的任何代码或提示词
      原文，改用开源 Node 库原创实现"这条路径——而不是等待/寻求与 Anthropic 的
      单独商业授权协议（那是另一条路，需要你或法务对接，本 delta 不覆盖）。

- [ ] **② 首个切片范围**：三个 skill 都只做"从零创建新文件"，不做编辑已存在的
      docx/xlsx/pdf、不做格式转换、不做 Word 修订记录/Excel 图表与公式求值/PDF
      表单与 OCR（`contract.md` §2 完整列表）。这条编辑存量文件的能力，未来若要做
      需要另开一条 delta（读+改+存的保真度是完全不同量级的工程问题）。

- [ ] **③ 沙箱镜像扩大**：本条会往 `apps/skill-sandbox` 的镜像里加三个新的 npm
      依赖（docx/exceljs/pdf-lib），机制与 pptxgenjs 完全一致（预装进镜像、
      `network: none` 下运行时不能装包）——不改变、不放宽任何一条既有隔离边界
      （L1 容器 `network: none`/只读 rootfs、L2 Node 权限模型），只是让沙箱能
      `require` 更多库。

- [ ] **④ 不新增失败码/不新增导入机制**：复用 pptx delta 已签的
      `SANDBOX_UNAVAILABLE`/`SANDBOX_TIMEOUT`/`SCRIPT_FAILED_AFTER_RETRIES` 三个
      失败码、复用既有"提示协议"重试循环（上限 3 次）、复用既有 starter-pack 导入
      + 双重门禁（安全扫描 + 人工方法论审核，提交人 ≠ 审核人）流程。这份 delta
      不改这些机制的任何一条规则，只是新增三份走这条既有流水线的 skill 声明。

## 与既有已签内容的关系

- **不改** `skill-sandbox-execution`（covers F962）已签的隔离边界、产物落地机制、
  失败码集合、重试循环——三个新 skill 完全复用这套已验证过的机制，只是新增
  三条 promptTemplate + schema 声明和三个预装的 npm 依赖。
- **不动** 手建 skill 入口冻结（`createSkillDraft` 恒 410）这条既有裁决——三个新
  skill 走既有 starter-pack 导入路径，不重新开一条手建入口。
- **不动** `skill-model-a-b-convergence` 已签的模型 A 单一权威结论。
