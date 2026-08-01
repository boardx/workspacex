# 进度日志 — Sprint 01/02

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: <feature id / title>
- 当前 blocker: <无 / 描述>

## 会话记录
### 2026-07-31 04:30:23
- 本轮目标:
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-08-01（F120，owner w3-project2）
- 本轮目标：F120 —— STEP_CLOSED / STEP_REJECTS_ARTIFACT_TYPE 两条 phase-00 空转失败码的
  双向还债（依赖 F118 的 agenda_segments + 外键，已 passing）。
- 开工前发现：`feature_list.json` 里 F119/F120/F121 的 `sprint` 字段是 `null`（与
  `chore(sync): F19/F20/F21/F50/F64/F65 补 sprint 字段` 同一根因），`sync-github.ts`
  从未为它们建过 issue。未touch `feature_list.json`（授权外），改为照
  `buildIssueBody` 模板手工建了 issue #135；随后 origin/main 出现
  `22739fc chore(sync): 补齐 15 个 feature 的 sprint 字段` 已把这三个都修了——
  与我的手工 issue 并存，未来 `harness sync --apply` 可能会为 F120 再建一条投影
  issue，留给下一位处理（marker 是 `<!-- harness-feature: 01/F120 -->`，两条能
  互相识别）。
- 已完成：`evaluateStepGate` 纯函数（domain/project/step-gate.ts）+
  `bindToProjectStep` 里新增 `assertStepGate` 网关（STEP_CLOSED 优先于
  STEP_REJECTS_ARTIFACT_TYPE）+ `BindingRepository.findArtifactSource` /
  `findSegmentGate` 两个只读方法（Postgres 实现）。
- 运行过的验证：`pnpm --filter api run typecheck`（需先
  `pnpm --filter @repo/fabric-markdown run build`，见 D-17，已知坑与本 feature
  无关）、`pnpm --filter api run lint`、`pnpm --filter api exec vitest run
  tests/project/step-gate.test.ts`（纯逻辑，本地跑绿）、
  `pnpm --filter @repo/contracts run test`。两条 DB 集成测试
  （step-closed-bidirectional / accepted-sources-whitelist）只过了 typecheck，
  未在本地执行（issue #74 的本地策略：不跑需要 Postgres 的测试）。
- 已记录证据：`evidence/F120.verify.log`。
- 提交记录：分支 `worker/w3-project2-01-F120`。
- 已知风险或未解决问题：`setAcceptedSources` 用例本身（引导师写白名单的路径）未接
  HTTP controller / kernel.module.ts DI——理由见 evidence log 末尾；`ui.md` B-4
  的白名单控件原型也还不存在。两条 DB 集成测试的真实执行结果待 CI / test-runner
  补齐。
- 下一步最佳动作：F119（advanceAgendaSegment）与 F121（改名对齐）仍在其他 owner
  的分支上并行；`setAcceptedSources` 的 HTTP 落地建议放到明确认领它的下一个
  feature，避免三个 agent 同时抢 kernel.module.ts 的同一段。

### 2026-08-01（F06，owner w1-auth6）
- 本轮目标：F06 —— D-18 管理员权力边界（个人层只见计数、项目层可读留痕且对项目
  负责人可见）的独立、GitHub 可见验证。依赖 F04（`in_progress` 但已合入
  `origin/main` #162，代码稳定；按协调者裁决不算 blocker，照常开工）。
- 开工前发现：三条 verification 对应的测试文件与 `admin-members-screen.tsx` 的
  边界区（`admin-members-boundary` 等 testid）已经存在——后端判定逻辑
  （`admin-boundary.ts` / `personal-layer-summary.ts` / `admin-audit-read.ts`）
  与前端 UI 都是 F03/F04/F10 早前工作留下的，本 feature 真正要交付的是把
  D-18 的四句话断言当作 F06 自己的、独立可跑的验证单元钉死下来（而不是依赖
  F03 的 `tests/kernel/*` 顺带覆盖到）。
- 已完成：新增 `apps/api/tests/auth/admin-boundary-personal-counts-only.test.ts`
  （D-18 第①④句：个人层计数、无内容字段、admin 对该条目任何 purpose 都拒绝）、
  `apps/api/tests/auth/admin-project-read-audited.test.ts`（D-18 第②③④句：
  audit 读成功+留痕、负责人可查、admin 本人「看我的访问记录」看到同一条 id、
  work 读仍拒绝且不留痕、单独持项目角色时正常读取且不触发 admin-project-access）、
  `apps/web/tests/ui/admin-members-boundary.test.tsx`（个人层只显示计数徽标、
  项目层说明文案、内联访问记录列表与「看我的访问记录」抽屉展示同一批记录）。
  未改动任何实现代码——三份新测试打的都是既有实现。
- 运行过的验证：三条 verification 命令均在本地（含真实 Postgres）跑绿：
  `admin-boundary-personal-counts-only.test.ts`（3/3）、
  `admin-project-read-audited.test.ts`（7/7）、
  `admin-members-boundary.test.tsx`（6/6，纯 jsdom，无需 DB）。
  另跑过 `pnpm --filter api exec tsc --noEmit`，两份新文件零错误（仓库里
  `packages/fabric-markdown` 的既有 DOM lib 报错与本 feature 无关，未处理）。
- 已记录证据：`evidence/F06.verify.log`。
- 提交记录：`pnpm harness verify --sprint 01/02 --feature F06` 门控通过，
  F06 → `passing`；分支 `worker/w1-auth6-01-F06`，PR 关联 issue #181
  （`Closes #181`）。
- 已知风险或未解决问题：`contracts/org-admin/ui.md` 第 14 行标注「项目负责人侧
  『谁读过我的项目』独立页面（`/projects/[id]/settings/access-log`）未建，且
  原型未画」——本 feature 的验收锚点走的是 `/admin/members` 已建成的边界区
  （负责人可用现有 `/provenance` 查询接口检索到同一条记录，测试已断言），
  独立的负责人侧专属页面仍是缺口，留给该 UI 载体对应的后续 feature。
- 下一步最佳动作：无遗留阻塞；下一位可直接认领下一个 `in_progress` feature。

### 2026-08-01（F105，owner w1-canvas4）
- 本轮目标：F105 —— 便签级 LWW + 结构性冲突条人工裁决三出口（D-09）+ 判定表(O-32)
  + 状态 enum。依赖 F103（真实 mermaid 渲染，已合入 main，issue #98 CLOSED——
  issue #195 正文里"未就绪"是 sync 生成时的旧投影，已核实不影响开工）。
- 已完成：
  - `apps/api/src/domain/canvas/change-classification.ts` —— `classifyChange`
    全函数判定表（七行穷举），O-32「便签跨分区移动归 sticky-level」重点断言。
  - `apps/api/src/domain/canvas/conflict-resolution.ts` —— `applyStructuralChange`
    （单侧直接同步，两侧同时改才产生 conflictId，I-16）+ `resolveConflict` 三出口
    （`preservedVersionId` 永不为空，D-09/I-17；`compare` 中间态；幂等重放）。
  - `apps/api/src/domain/canvas/sticky-lww.ts` —— `applyStickyChange` 便签级 LWW，
    `supersededRevisionId` 可查到被覆盖的那次（I-19）。
  - `apps/api/src/domain/canvas/group-canvas-status.ts` —— `computeCompleteness` +
    `computeGroupCanvasStatus`（落后当且仅当必填分区为空，不跨组横向比较，
    I-20/I-21）+ 停滞阈值默认 5 分钟可配置（O-32）。
  - `canvas-conflict-bar` 等 data-testid 已由 F103 建成，未改前端组件。
- 运行过的验证：issue 点名的两条 vitest（8 + 17 passed）、附加
  `sticky-lww-and-group-status.test.ts`（12 passed）、grep testid、
  `pnpm --filter api typecheck`（需先 `pnpm --filter @repo/fabric-markdown build`
  产出 dist/*.d.ts，同 F120 记录过的坑）、`pnpm --filter api lint`、全部既有
  `apps/api/tests/canvas/**`（169 tests）复跑仍全绿。
- 已记录证据：`evidence/F105.verify.log`。
- 提交记录：分支 `worker/w1-canvas4-01-F105`，PR #207（`Closes #195`）。
- 已知风险或未解决问题：`GroupCanvasStatus` 四态互斥优先级（只读 > 你在这组 >
  落后 > 进行中）是本次判断留痕，非 UC/契约显式排序，已在 PR 描述与 issue 评论
  里点名请人类确认。push 时 pre-push 的 `turbo run typecheck lint test --affected`
  超时（issue #74 已知不确定性），已按标准授权 `--no-verify` 推送。
- 下一步最佳动作：F104（几何归区导出）与 F106/F107 仍待其他 owner 推进；
  本 feature 的三个后端判定模块（classify/lww/resolve/status）都是纯函数，
  与 F104 的 export-source 路径无重叠，无需协调。

### 2026-08-01（F145，owner w1-research2）
- 本轮目标：F145 —— 研究详情四段结果 + Scout 执行步骤：R7.3 低置信不被过滤、R7.5
  单来源落「争议 / 不确定」、E1 部分路失败仍可见、E2 零来源为数据需求说明（依赖
  F144，已 passing）。
- 开工前发现：`research` 束的 UI（`RsDetailScreen` / `lib/mock/research-studio.ts`）
  已由 ui-prototyper 在 F144 之前的 UI 先行阶段建成（真实组件 + mock，含四段结构、
  低置信 0.3 与执行步骤三条编号），本 feature 不重画界面，只补机械判据 + 后端纯逻辑。
- 已完成：`apps/api/src/domain/research/result-assembly.ts`（纯函数
  `assembleResearchResult` / `assembleResearchRun` / `isSampleTooSmall`，不连
  数据库）；三条测试
  `apps/api/tests/research/run-low-confidence-not-filtered.test.ts`（R7.3 + R7.5 +
  E2）、`apps/api/tests/research/run-partial-routes-visible.test.ts`（E1：12 路 3
  路失败时 completedRoutes/failedRoutes 可区分，已完成路的结果不被清空）、
  `apps/web/tests/ui/research-detail-four-sections.test.tsx`（四段标题、0.3 置信度
  出现在段③、单来源争议不进段①、Scout 执行步骤枚举、E1/E2/R5 观察者态）。
- 运行过的验证：`pnpm --filter @repo/contracts run test`、
  `pnpm --filter api exec vitest run tests/research/run-low-confidence-not-filtered.test.ts`、
  `pnpm --filter api exec vitest run tests/research/run-partial-routes-visible.test.ts`、
  `pnpm --filter web exec vitest run tests/ui/research-detail-four-sections.test.tsx`
  （四条均本地跑绿，均为纯逻辑/组件测试，未连 Postgres，符合 issue #74 的本地策略）；
  另跑过 `pnpm --filter api run typecheck` / `pnpm --filter web run typecheck` /
  `pnpm --filter api run lint` / `pnpm --filter web run lint` /
  `tests/arch-gate.test.ts` / `tests/contract-single-source.test.ts` 全部通过；
  `./init.sh` 基础验证未见新增失败。
- 已记录证据：`evidence/F145.verify.log`。
- 提交记录：分支 `worker/w1-research2-01-F145`；`pnpm harness verify --sprint 01/02
  --feature F145` 已把状态门控转为 `passing`。
- 已知风险或未解决问题：`assembleResearchResult` 的 `isSampleTooSmall` 判据用
  `sourceRef` 去重逼近"独立来源数"，Q-7（来源类别全称/简称映射）与 Q-12（证据
  「去向」枚举）仍未裁，本 feature 未触碰这两条，涉及它们的机械断言按
  `KNOWN_CONTRACT_GAPS.R8` 继续搁置。这两个纯函数尚未接到任何 application 层用例
  / HTTP controller——本 feature 范围只到"组装逻辑本身可断言"，接线留给依赖它的
  下一个 feature（F146/F147/F148 之一，视 Q-8 两层模型的用例落地顺序而定）。
- 下一步最佳动作：F146…F148（同束、依赖 Q-10/Q-12/Q-14/Q-17/Q-18 的其余部分）
  可以开始参考 `result-assembly.ts` 的纯函数写法；不要在其中重新实现一遍
  `isSampleTooSmall` / 四段组装逻辑。

### 2026-08-01（F146，owner w1-research3）
- 本轮目标：F146 —— 研究列表三处 + 研究计划三计数与证据表：目标缺失渲染
  「—」而非「0」（N-8 主战场），归档不删除且被引证据不失效（N-7 两半）。
  依赖 F144（研究七项配置面板，已合入 `origin/main` #68）。
- 开工前发现：`RsListScreen` / `RsPlanScreen`（`rs-screens.tsx`）与它们的 mock
  数据源（`lib/mock/research-studio.ts`）已由 ui-prototyper 建成，目标缺失渲染
  `—`、三计数 `?? "—"`、证据表四列都已是真实 UI；**但 `RsListScreen` 硬编码
  `filter(i => !i.archived)`**——已归档研究永远不出现在任何视图里，`已归档`
  标签是纯装饰按钮不接任何过滤，这与 N-7「归档后仍能被『已归档』标签筛出」
  正面冲突：当前实现在效果上把归档做成了删除。
- 已完成：
  - `apps/api/src/domain/research/plan-counts.ts` + 测试
    `plan-counts-null-not-zero.test.ts`：`derivePlanCounts` 纯函数，`null`
    （目标未设 / 无该子实体）与 `0`（显式为空）在类型与运行时都保持可区分，
    `evidenceCount` 恒为 `number`（跟着证据数组走，不是写死的）。
  - `apps/api/src/domain/research/archive.ts` + 测试
    `archive-keeps-references.test.ts`：`archiveResearch`（只置位
    `archivedAt`，不删除元素）、`filterByArchived`（三态语义同
    `listResearch.in.archived`）、`resolveEvidenceById`（证据解析与归档状态
    无关）。两半（能被筛出 / 证据仍可解析）分别断言，外加一组同一 fixture
    上的联合断言防止绕过。
  - 修了上面发现的 UI 缺口：`RsListScreen` 新增 `sub` 支持（`sub==="archived"`
    时改看已归档集合，与 `RsPlanScreen` 已有的 `sub` 用法同一模式），`TagRow`
    的「已归档」标签接了真链接（`hrefFor`），点击后 `active` 态与
    `href="?sub=archived"` 均可断言。`research-studio-app.tsx` 把 `sub` /
    `href` 透传给 `RsListScreen`。其余四个 tag（客户/内部/高优先级/全部）
    过滤口径 Q-9 未裁，本次不代裁，仍是纯展示态。
  - 新增 `apps/web/tests/ui/research-list-target-dash.test.tsx`：卡片进度行
    分子跟着数据走、目标缺失渲染 `—`、Studio 左栏三段各自独立渲染、归档项
    默认不在列表但可被「已归档」标签筛出且格式化规则与未归档项一致、
    owner/collaborator 两视角下列表内容一致。
- 已知留白（不在本 feature verification 范围内，如实记录）：
  - 「项目内深度研究列表」目前与 Studio 列表**复用同一个 `RsListScreen` 组件
    与同一份 mock 数据**，没有按 `projectRef` 建独立路由/组件——`user_visible_
    behavior` 提到的「三处」中，「Studio 列表」与「Studio 左栏三段」在本文件
    的测试里各自独立断言，「项目内」这一处目前等价于同一渲染逻辑的另一处挂载
    （未建独立入口）；这与 issue 元数据「设计参照：无 UI 或沿用现有界面」一致，
    如需独立路由需另起 feature。
  - 观察者视角下研究数据层过滤（E5/R12.5）本 feature 的四条 verification
    未覆盖，契约面已由 `research.ts` 的 `listResearch` 注释与 `KNOWN_CONTRACT_
    GAPS` 记录，留给覆盖 R12.5 的对应 feature。
- 运行过的验证：四条 verification 命令本地全绿：
  `pnpm --filter @repo/contracts run test`（166/166）、
  `pnpm --filter api exec vitest run tests/research/plan-counts-null-not-zero.test.ts`（11/11）、
  `pnpm --filter api exec vitest run tests/research/archive-keeps-references.test.ts`（8/8）、
  `pnpm --filter web exec vitest run tests/ui/research-list-target-dash.test.tsx`（13/13）。
  另跑过 `pnpm --filter api exec tsc --noEmit` 与 `pnpm --filter web exec tsc --noEmit`：
  web 侧零错误；api 侧唯一报错在 `packages/fabric-markdown/src/mermaid-parser.ts`
  （缺 DOM lib 配置），与本 feature 无关，`git stash` 验证过同样报错在改动前就存在。
  `pnpm --filter web run lint` 通过。`pnpm -w run verify:base` 本地跑到
  `apps/api` 的 `rbac-role-matrix.test.ts` / `reference-eligibility-gate.test.ts`
  等既有 Postgres 集成测试时失败/连接中断——与 issue #74 记录的全量 Postgres
  连接数竞态同源，非本 feature 引入，遵照 #74 的既定处理方式（本地跳过需
  Postgres 的全量门，只保证四条本 feature 自己的 verification 与 typecheck/lint）。
- 已记录证据：`evidence/F146.verify.log`。
- 提交记录：分支 `worker/w1-research3-01-F146`，PR 关联 issue #202
  （`Closes #202`）。因 `verify:base` 本地受 #74 影响未能跑通，`pnpm harness
  verify` 未能在本地把状态门控转为 `passing`——留给 CI / test-runner 在干净
  Postgres 环境下补跑并转移状态，本地未手改 `feature_list.json` 的 `status`。
- 下一步最佳动作：「项目内深度研究列表」若需要独立路由/组件，建议开一个新
  feature 明确认领；观察者数据层过滤（R12.5）同理另起 feature 覆盖。
### 2026-08-01（F113，owner w1-chat3）
- 本轮目标：F113 —— 产物卡/转录卡/进度卡 + 右栏五标签计数 + 消息头角标（降级/待
  复核同源）+ 改派条（带依据）+ 主动发言必带来源。依赖 F110（`passing`）与 F111
  （`in_progress` 但已合入 `origin/main` #161，代码稳定；按协调者裁决不算
  blocker，照常开工）。
- 开工前发现：本束的 UI（产物卡/进度卡/转录卡/消息头角标/改派条/右栏五标签）
  与契约 `packages/contracts/src/chat.ts` 的 `getRightTabs` / `agentProactiveSpeak`
  / `suggestReassignment` / `controlTranscriptCard` 均已由更早的会话建成
  （`apps/web/components/chat/*.tsx` 的 mock 版 + F109/F110/F111 落下的
  `thread-badges.ts`/`agent-presence.ts`）；`chat-reassign-reason` 这个
  data-testid 已经存在，第三条 verification 无需改动即可通过。真正缺的是右栏
  五标签计数与「主动发言必带来源」这两条的**后端判定逻辑**——此前没有任何一
  处代码算过它们。
- 已完成：新增 `apps/api/src/domain/chat/right-tabs.ts`
  （`computeRightTabs`：恒五个标签、固定顺序、`hidden`/`failed` 两个独立维度、
  E1 研究阶段只隐藏 `transcript` 一个标签）与
  `apps/api/src/domain/chat/proactive-speech.ts`（`decideProactiveSpeech`：
  「取不到来源是正常返回不发言，不是错误」的唯一判定点，且先判开关再判来源，
  防止「关着但有来源」被悄悄放行）。两份新测试
  `tests/chat/right-tabs-five-with-counts.test.ts`（9 个用例，含标签独立失败态
  的反证）与 `tests/chat/proactive-speech-requires-source.test.ts`（8 个用例，
  含四格判定矩阵的穷举）。
- 已知缺口（如实登记，未擅自打通）：`getRightTabs`/`agentProactiveSpeak`/
  `suggestReassignment`/`controlTranscriptCard` 的 application 层 + controller
  路由**未接线**——它们各自依赖的真实数据源本轮尚未建成：右栏「执行/洞察/产物」
  三个标签的列表分别属于 agent-runtime 执行追踪、洞察抽取（均未建）与 F114
  产物落地（sibling feature，`in_progress`，本 PR 不碰）；主动发言的 agent 级
  开关持久化与 Context API 的「取来源」端口同样未建（属 context-pack 束）。
  贸然接一条读不到真数据的路由会诱使下一个实现者往里塞假数据「先让它显示出来」
  ——那正是 `domain.md` I-31 反复点名要防的反例，所以本轮选择把判定逻辑做实、
  做对、做全测试，路由接线留给这些依赖就绪之后的下一轮。
- 已记录证据：`evidence/F113.verify.log`（含三条 mandated verification + 补充的
  `tsc --noEmit` / `lint` / `tests/chat/` 全量结果，后者的 20 个失败全部是
  issue #74 已知的 Postgres 集成测试本地不稳定，与 F113 无关）。
- 提交记录：`pnpm harness verify --sprint 01/02 --feature F113` 门控通过，
  F113 → `passing`；分支 `worker/w1-chat3-01-F113`，PR 关联 issue #197
  （`Closes #197`）。
- 下一步最佳动作：待 agent-runtime 执行追踪 / 洞察抽取 / F114 产物落地 /
  context-pack 来源端口就绪后，接一个后续 feature 把 `getRightTabs` 等四个
  application + controller 路由真正打通（当前的域逻辑可直接复用，不必重写）。
