# 进度日志 — Phase 03 跨项目复用与治理

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: <feature id / title>
- 当前 blocker: <无 / 描述>

## 会话记录
### 2026-07-28 04:39:05
- 本轮目标:
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-09-08 迭代 13（design-delta `design-chat-inputs`）
- **本轮目标**：人类三轮实测反馈 + 交办的九件事，落成 F59–F65 七个 feature。
- **已完成（代码已合入 main：`4da85d57`，合并即部署）**：
  - F59 引导式澄清（新建从填表改成问答；模型挂了退通用六问并如实说明是兜底；删掉顶部三张模板卡片）
  - F60 参考图（按钮/拖拽/粘贴三入口一条上传路径；随每轮对话发给模型；模型看不了图时不发图并在回复里说明）
  - F61 从已有对话线程导入上下文（一次性摘要不是订阅；预览可改、确认才写；留痕进 chat）
  - F62 列表按 `updated_at` 倒序（排序在 SQL）+ 标签过滤（交集）
  - F63/F64 视觉判据进 `DESIGN_PRINCIPLES`；原型主题与后台主题互不影响，导出跟随原型的
  - F65 属性面板视觉组（只给档位不给自由数值，默认折叠）
- **运行过的验证**：PR #3115 上 18 个 check 全绿（gates-fast / gates-test ×4 / gates-runtime /
  fullstack-smoke / e2e-core-loop / verify-affected / verify-full-compile / verify-control-plane /
  merge-gate / native-*）。本机 contracts 594 绿、api design-workbench 140 绿、web design-loop 131 绿。
- **CI 抓到两个本机测不出来的真 bug**（本机无 Docker/Postgres）：
  1. `design_project_ref_images` 建了表、开了 RLS、写了策略，但**没 GRANT** ⇒ 每次读项目 42501
     （参考图是 `SELECT_COLUMNS` 里的子查询，每条读路径都碰它）。修复 `bc4d25bd`。
  2. `lint-permission-paths` 的 allowlist **棘轮**（条目数 − 边界规则数 ≤ 90）被新仓储顶破。
     没有调上限——把会红的信号调成不会红等于取消掉「再加一条豁免要有成本」这件事本身；
     改成把参考图三条语句并进已在 allowlist 上的项目仓储，让豁免不必存在。修复 `5642b2b8`。
- **反证抓到 6 处「为错误理由通过」**，3 处是本轮自己写的。最典型：`FakeDesignProjectRepo.listForOrg`
  按 `createdAt` 升序返回（fake 自己的顺序，不是产品的），拿它验「最近改过的排最前」会得到与生产
  **相反**的结论，而且是绿的。
- **已知风险 / 未解决问题**：
  1. ⚠ **F59–F65 七个 feature 仍是 `not_started`，且无法合法转 `passing`**。它们**不在任何 sprint 里、
     没有 GitHub issue**（本阶段连 `sprints/` 目录都没有），而完成定义第 5 条要求「有对应 issue 且
     该 issue 已由 PR 关闭」。`sync-github.ts` 头注逐字写着「只对当前/近期 sprint 开 Issue」，
     所以补建 issue 也要先补 sprint；而关闭它的 PR 已经合了，事后手工关不等于「由 PR 关闭」。
     **代码在 main、CI 合入时全绿（第 6、7 条满足），差的是第 5 条那道可见性门。**
     这是「用户直接交办、不走 sprint/feature 流程」这条路径与 feature_list 记账之间的真实缺口，
     需要人类裁决怎么补（见 session-handoff.md）。
  2. ⚠ 本机 `pnpm harness doctor` 报 0 FAIL，但它那行 `读不到 GitHub issue（gh 未登录 / 离线）——
     本次跳过` 说明**第 5 条根本没被检查**。本机绿 ≠ CI `--strict` 绿。这正是
     `static-trace-vs-live-fact.md` 说的那种痕迹。
  3. ⚠ F63 的视觉判据是 prompt 改动，单测只能证明约束进了提示词，**证明不了产出更好看**——
     需要人类在 devapp 上真实生成一轮才算数。
  4. issue #3138：`design-prototype-loop` 等三个 playwright project 从未在 CI 上跑过，
     按本仓判据它们等于不存在。本轮新写的 V60 拖拽 e2e 也在其中。
- **下一步最佳动作**：见 `session-handoff.md`。
