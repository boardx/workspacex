---
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: canvas-layout-source
base_bundle: canvas   # 改的是 phase-01 canvas 束已签核的 fence-template-resolver.ts
  # 判据 + canvas_templates 表 + listTemplates 契约（跨 phase 引用 phase-01 的
  # contracts/canvas；本 feature 本身按 2026-08-27 人类裁决落在独立的
  # phase-13-canvas-fixes，不再往 phase-01 加任何新 feature）
scope: chat-canvas-fence-rendering-reads-org-layout-source-instead-of-always-builtin
covers: [F01]   # phase-13-canvas-fixes 自己的编号，不是 phase-01 的 F1681
confirmed_by: ""    # TODO：人类签核时填
confirmed_at: ""    # TODO：人类签核时填，ISO 8601
confirmed_via: ""   # TODO：人类签核时填，摘要引用哪次对话/哪条批准
---

# design delta 签核 · chat 内置 canvas 模板渲染改按 layoutSource 判据读组织自定义

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

issue [#2221](https://github.com/boardx/workspacex/issues/2221)：chat 里渲染 19 个
内置 canvas 模板（persona/bmc/swot 等）时，`fence-template-resolver.ts` 只要
`getTemplate(key)` 命中内置注册表就直接用 `fabric-markdown` 包内写死的原生几何，
从不查组织在 `canvas_templates` 表里的自定义行——模板编辑器里对内置模板发布的
改动从未真正影响过 chat 渲染。

这是一份**开工前**的提案，与本束已签核的 ③-补（那 8 处是已上线事后补签的既成
事实）性质不同：`status: confirmed` 之前不会有任何代码改动。人类已在对话中口头
同意方案方向并要求「继续开发」，但按本仓纪律（ADR-023：「agent 不得代劳，也不得
为了让门控变绿而改这些字段」），`confirmed_by`/`confirmed_at`/`confirmed_via`
仍需人类本人在这份文件里落一次笔，机制同
`design-deltas/skill-office-docs-node-runtime`（`confirmed_via: "手工"` 先例）。

## 签核前请重点确认

- [ ] **① 判据本身**：用 `canvas_templates` 新增列
      `layout_source: 'builtin-derived' | 'user-edited'` 做「组织是否真的自定义过」
      的单一事实源——不用「DB 里有没有行」（backfill 恒会建行）、不用「内容是否
      等于默认值」（比对脆弱）、不用 `actorId`（backfill 也是拿真实管理员账号跑
      的，无法靠身份区分意图）。一旦某 key 被标过一次 `user-edited`，不可退回
      `builtin-derived`。
- [ ] **② 判定落点**：写入判定放在应用层一处（`mint-template-version.ts`），
      backfill 脚本显式传 `builtin-derived`，编辑器触发的真实分区/几何改动写
      `user-edited`。
- [ ] **③ 兜底行为**：查询失败 / 无 orgId / 未自定义时，`ensureCanvasFenceTemplate`
      静默退回 `fabric-markdown` 包内原生几何，不报错、不提示用户、不炸围栏渲染。
- [ ] **④ 存量数据**：迁移时给已存在的组织行统一补写
      `layout_source = 'builtin-derived'`——即「迁移前的任何内容一律视为未自定义」，
      哪怕运营侧曾经手工改过库但没走 `mintTemplateVersion`。如实登记为已知限制，
      不追溯重建。
- [ ] **⑤ 性能**：内置且未自定义的 key 现在也会打一次 `listCanvasTemplates`
      （之前 0 次），复用既有 30 秒/orgId 缓存摊薄；`verification.md` 要求实测
      这一跳延迟，不是靠推断。

具体契约形状、错误码、DB 迁移见 [`contract.md`](./contract.md)。
