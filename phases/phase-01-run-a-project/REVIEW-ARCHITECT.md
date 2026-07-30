# phase-01 架构师 + 程序员双视角设计审计

- 日期：2026-07-30
- 快照时刻：**2026-07-30T10:44:00Z**，`git HEAD = efdecb6`，分支 `docs/requirements-prototype-audit`
- 范围：十一束契约 / `feature_list.json`（124 feature / 417 点）/ `packages/contracts/src/*.ts` /
  phase-00 六个已签束 / `design-coherence.md` / `OPEN-QUESTIONS.md` 12 条裁决 + `domain.md` §八 U-1…U-9
- 性质：**只读**。未修改任何代码、契约、需求、`feature_list.json`、任何 `*-signoff.md`。未 commit、未 push。
  三次反证均为「破坏 → 观测 → 恢复」，恢复后 `git status --porcelain` 对相关文件返回空。

> ⚠ **本报告是一个移动靶的快照。** 审计期间有并发 agent 在写工作树：
> `contracts/asset-governance/` 从 1 个文件长到 5 个（18:20 → 18:39），
> `design-coherence.md` / `.github/CODEOWNERS` / `feature_list.json` /
> `packages/contracts/{src/index.ts,tests/*}` 在审计中途变为 `M`。
> 行号与计数以上述快照时刻为准。

---

## 总表

严重度定义：`阻塞开发` = 现在开工会做错或做废；`会返工` = 能跑但后面要回头改；`记录` = 不阻塞，但会长成下一次事故。

| # | 视角 | 一句话 | 严重度 | 影响面 | 建议修法 |
|---|---|---|---|---|---|
| A-1 | 架构 | 第 11 束 `asset-governance` 没有任何 feature 可归它——124 个 feature 已被前十束**无缝无重叠**分完 | 阻塞开发 | asset-governance + skills/agent-runtime/canvas/templates（四束已签） | 要么把 feature 从已签束**移出**（＝撤销四份签名并重签），要么删束、把治理机制作为跨束约束登记进一致性复核 |
| A-2 | 架构 | 一致性复核**从未做过**：14 条 X 项自称「待议不是结论」，第三~六节全是 `待填`，`status: pending` | 阻塞开发 | 全部 11 束 / 124 feature | 复核必须真做完再签；不许只改 `covers_bundles` |
| A-3 | 架构 | `asset-governance` 自报 10 条跨束约束（X-A…X-J），一条都没进阶段复核，其中 X-E 自称「与已签核内容最硬的一处冲突」 | 阻塞开发 | asset-governance × skills/agent-runtime | 先裁 X-E（`AssetDirectory` 多文件 vs skills `fileCount` 恒 1），再谈签核 |
| A-4 | 架构 | 资源可见性枚举有 **≥5 套互不同构的词表**，每束都先声明「本束不定义」再定义一套 | 阻塞开发 | files/chat/skills/canvas/agent-runtime/asset-governance | 收敛为一份封闭枚举 + 机械门控；`chat` 的 `member-private` 在 files 四值里无对应，`N-14` 当前不可断言 |
| A-5 | 架构 | 「不披露存在性 / 四入口 0 命中 / 404 非 403」这一个谓词被 5 束各写一份，用了 4 个不同错误码 | 阻塞开发 | skills/agent-runtime/asset-governance/chat/files/canvas | 收敛为同一判定函数（`asset-governance` I-12 已提出复用，是唯一一处） |
| A-6 | 架构 | 两层交集鉴权在**非工作坊容器**上只有「全拒」或「全放」两条路，没有第三条，且两条都不会让任何断言变红 | 阻塞开发 | phase-00 `identity`（已签）+ project 束 + 全部容器类 feature | `AuthorizeInput` 需带容器 kind，`decide()` 需第三种项目层结果，`PermissionReason` 需新码——三件都是**修订已签核契约** |
| A-7 | 架构 | 机密标记的**生产者**在 phase-3（17-gov），phase-01 有 5 束消费它，传播链 Artifact→Version→Segment→ContextPack **在 phase-01 内无主** | 阻塞开发 | chat/agent-runtime/templates/files/project | X-1 的束清单要补 `files`、`project`；传播链要在 phase-01 内指定负责束，否则路由必判错 |
| A-8 | 架构 | 归档 / 只读语义被 6 束各自定义，其中 3 束是**逐字三重复制**；阶段复核 14 条里一条都没提归档 | 阻塞开发 | canvas/templates/skills/project/chat/asset-governance | 收敛为单一事实源；`project` I-P39 的四条归档连带行为仍未裁 |
| A-9 | 架构 | 议程环节终止词表在 org-admin 是 4 值（`completed/skipped/merged/early-ended`），在 project 只有 4 态（`pending/active/closed/skipped`）——`completed` 与 `early-ended` 都塌成 `closed`，org-admin I-28 要求的 4 条断言有 2 条写不出来 | 阻塞开发 | org-admin（已签）× project | 二者取一并统一；另 `org-admin/usecases.md:507` 把提供方写成不存在的「06-现场协作」束 |
| A-10 | 架构 | 同一个谓词（有角色但该角色不含此动作）有两个错误码；且 org-admin 用 `PROJECT_ROLE_INSUFFICIENT` 报了一个**组织层**失败 | 阻塞开发 | canvas/templates/agent-runtime vs project/files；org-admin | 统一错误码（`design-coherence.md` 第三节正是为此，而它是空的）；org-admin 那处违反 project I-P9 禁止的层混用 |
| A-11 | 架构 | `X-` 编号有**三套互不兼容的命名空间**：一条约束背三个 ID，一个 ID 指两条约束 | 阻塞开发 | 阶段级 + 各束 design-signoff + asset-governance（X-A…X-J） | 全仓统一编号；现在任何「见 X-3」都是歧义的 |
| A-12 | 架构 | `admin_project_access` 是**幻影表**，全仓不存在；它其实是 provenance 事件类型名，真实宿主是 `content_items` | 阻塞开发 | `feature_list.json:2528`、`project/design-signoff.md:306`（人类要签的 X-21）、`domain.md:44/283/461`、`OPEN-QUESTIONS.md:1026`、`no-forbidden-routes.test.ts:74` | 全部 7 处改名为 `content_items`；X-21 现在要求人类对一张不存在的表做审计语义裁决 |
| A-13 | 架构 | `MIGRATION-IMPACT.md` §3.2① —— 它自称「最高风险三条」的第一条 —— **整条是错的**，而且已抄进 feature notes 指挥实现者 | 阻塞开发 | `feature_list.json:2528`、F22 冻结、`0018` 迁移 | `0014` 的冻结是 **catalog 推导**不是写死清单，断言也早已存在；照文档去「再补一条断言」＝制造第二份同事实断言 |
| A-14 | 架构 | Context Pack 的容器过滤：契约是 `projectIds: array`，实现是 `projectId: string \| null` 单值，且 `null` **关掉整个容器过滤** | 阻塞开发 | phase-00 `context-pack`（已签）+ project + X-18 | D 之后同一次调用会把研究项目/用户洞察的 segment 一并扫进候选并按组织层放行；X-18 描述的形状本身是错的 |
| A-15 | 架构 | artifact 绑定在非工作坊容器上**双重死路**：动作词只属工作坊角色，且不存在合法 `agenda_segment_id` 取值 | 阻塞开发 | files/project + phase-00 `artifact`（已签） | 会产生「artifact 属于容器 C，但 C 的界面上没有任何回流列表」且无门控发现 |
| A-16 | 架构 | `PROJECT_ACTIONS` 15 条闭集全是工作坊语义，U-1 的 `owner`/`collaborator` 在这张表里**无任何可映射动作** | 阻塞开发 | project 束全部 13 feature | 与 A-6 同一处修订 |
| A-17 | 架构 | `provenance_events` 的**事件类型封闭枚举无注册人**：phase-00 裁决是两段，phase-01 只登记了前一段 | 会返工 | canvas(15 类)/templates(9 类)/recording(5 类)/project + X-2 | 补「事件类型封闭、新增走 ADR」这半条；已有先例 `admin-project-access` 是「类型定了、产生它的动作没定义」 |
| A-18 | 架构 | 「协同引导师 ⇒ facilitator」在两束各定义一遍，内容不同（project 版多了 `is_host` 与受访者条款） | 会返工 | org-admin（已签）× project | 收敛；另 wire 枚举含 `coFacilitator` 而存储枚举恰好四值，wire/stored 不对称无人负责 |
| A-19 | 架构 | `MIGRATION-IMPACT.md` 写在 U-1…U-9 裁决**之前**，§1.3 / §3.3 五行 / §四.1 已过期，且与 `domain.md` §八 对同一事实给出**互相矛盾**的答案 | 会返工 | project 束 | 按硬约束收敛为单一事实源；现状是「同一事实两处」的第 N 次 |
| A-20 | 架构 | `(project_id, agenda_segment_id)` 无跨表一致性约束：绑定可以「项目是研究项目 P、环节是工作坊 W 的环节」 | 会返工 | F06 + project | 复合外键 `(project_id, agenda_segment_id) REFERENCES agenda_segments(workshop_id, id)`；§2.3 三件事里没这条 |
| A-21 | 架构 | 管理员访问审计的 `target.kind` 恒为 `"project"`，三类容器在审计面上不可区分 | 记录 | project/org-admin | 审计 target 带 kind |
| P-1 | 程序员 | `verify-uc-coverage` 的 R12 检查用**全束扁平 V 编号集合**——一份 UC 的覆盖行可以顶替另一份 UC 的要求。真实需覆盖 689 条 `(UC,V)`，门控只要求 **167** 个不同编号，**遮盖率 76%** | 阻塞开发 | 全部 10 束 / 52 份 UC | 断言改为按 `(UC文件, V编号)` 二元组；见反证 CP-2 |
| P-2 | 程序员 | 签核第 ③ 件（API 契约）**9/10 束不存在**，8 束已以「三件已确认」签核，而**没有任何门控检查第 ③ 件** | 阻塞开发 | agent-runtime/canvas/chat/files/interview/org-admin/recording/skills/templates（8 已签） | 按 ADR-023 决策一实现该门控（`<bundle>.ts` 存在 ∨ domain.md 显式声明无 HTTP 面）；见反证 CP-1 |
| P-3 | 程序员 | `contract-shape` / `no-forbidden-routes` / `out-schemas-strict` 的**束清单是硬编码 import**；9 个束的契约落地后不会被扫，三道门全绿 | 会返工 | packages/contracts 全部未来束 | 清单改为从 `src/*.ts` 或 `index.ts` 派生，并加一条「每个 src 模块都在清单里」的断言 |
| P-4 | 程序员 | `lint-contract-source` 只在 `backend-gates.yml`（push main / tag）跑，**PR 阶段不跑**；`packages/contracts` 的 `lint` 是一句 `echo` | 会返工 | 契约单源链 | 接进 PR 门控。现存真红 1 条：`apps/web/lib/mock/projects.ts:13` 用字面量重定义 `ProjectStatus` |
| P-5 | 程序员 | `verify-uc-coverage` **不在 `verify:base`，也不在任何 CI workflow** —— `contract-design.md` §三 三道门控之一从未在 CI 跑过 | 会返工 | 全阶段 | 接进 `verify:base` + PR 门控（与 `.harness` 101 条断言那次是同一形状） |
| P-6 | 程序员 | `auditSignoff` 的「feature 必须属于某个束」检查在 `featureIds=[]` 时**平凡为真**；`verify-uc-coverage` 显式传 `[]`，`doctor` 传可能为空的 `active` | 记录 | 签核链 | 现由 `verify-uc-coverage` ④ 另一条结构性检查补上，所以此刻不是洞，但机制在 |
| P-7 | 程序员 | `statusOf()` 把「frontmatter 缺 `status` 键」与「`status: pending`」混为一谈 —— `skills` 束的签核三行被 `#` 注释掉，门控报「尚未签核」而不是「frontmatter 坏了」 | 记录 | skills 束 | 缺键应报第三种状态。当前 fail-closed，但「签过又被注释」和「没签」在门控输出里长得一样 |
| P-8 | 程序员 | `hasRequirementsCoverage` 只读 `requirements/` **顶层**；phase-01 顶层只有 `00-overview.md` 一份非 README 文档 | 记录 | 全阶段签核门第 ⓪ 条 | 整个 ⓪ 检查压在一个文件上，13 个子目录 52 份 UC 对它不可见；改为递归 |
| P-9 | 程序员 | `reference-eligibility-gate.test.ts:157` `expect(DOWNSTREAM_PURPOSES).toHaveLength(5)` 断言的是**枚举成员数**——违反纪律 9；而同一文件 `:513` 用 `C.DownstreamPurpose.options.length` 做对了 | 记录 | F07 验收 | 改为对 `options` 比对 + 「非空」防空转 |
| P-10 | 程序员 | ADR-023 §五承诺的 CI 检查（改 `status:` 行且非 CODEOWNER ⇒ 失败）**不存在** | 记录 | 整条签核链的信任根 | 补该 CI 检查。`CODEOWNERS` 本身完整（含 `design-coherence.md`、真实 handle） |
| P-11 | 程序员 | 命名单源：D-03a 三个正名**代码零采用或近零采用**；败选名 `agenda_stage` 仍在 25 个文件，而两处权威登记都写「只剩 2 个文件」且其中一条行号已失效 | 阻塞开发 | templates（已签，11 处契约端口名）/org-admin（已签，8 处 `*StageId`，完全未登记）/interview | 重做波及面登记；`design_facet` 正名代码零采用（真实叫 `ConfigItem`），`method_stage` 零采用 |
| P-12 | 程序员 | Q-3 ① 改名**零进度**，且 **24/25 = 96%** 的波及文件已合入 `main`，含 6 个 kernel 测试（F06/F07/F08/F13 的验收本体） | 阻塞开发 | phase-00 已签的 `identity` / `artifact` 两束 | 21/109 这个数字写下时精确，现为 22 文件 / 111 行；且「109 处」实为 109 **行**，真实出现次数 124 |
| P-13 | 程序员 | `rbac-role-matrix.test.ts:152` 用前缀过滤 `startsWith("stage.")` —— 改名后 `filter` 返回空数组，循环体一次不执行，**测试通过**；而 `MIGRATION-IMPACT:211` 逐字声称它会变红 | 会返工 | F01 验收「组长不能控场」整条性质 | 改名 PR 内换成对角色矩阵差集的逐值断言 + 「差集非空」反证 |
| P-14 | 程序员 | `segment` 在已上线 schema 里**已经有另一个含义**（`segment_text` = 转写片段，且是 `acl_bindings.object_kind` 三值闭集成员）；改名后同库同词两义，**无任何文件登记** | 会返工 | phase-00 `identity`/`artifact`（已签，已合入 main）+ D-03a | 登记为命名冲突并裁决；现有 grep 门控只查三个败选名，看不见这个 |
| P-15 | 程序员 | I-P20 要求的「三个败选名全仓不再出现」grep 门控若不排除 `.next*` / 生成物，旧名清完后**仍会红**，然后被人加宽排除规则 | 记录 | F121 | 门控写死排除生成物目录，并配一条「排除规则不得再加宽」的反证 |
| P-16 | 程序员 | 迁移序号 `0008` 有两个文件，`migrator.ts:34` 按文件名排序，**序号重复不报错** | 记录 | 迁移体系 | 加一条「序号唯一」断言 |

**小计 37 条：阻塞开发 20 · 会返工 9 · 记录 8。**
**另有契约可实现性 26 条（阻塞开发 5 · 会返工 18 · 记录 3），见下方独立小节 —— 全报告合计 63 条：阻塞开发 25 · 会返工 27 · 记录 11。**

### 总表（续）· 契约可实现性（第 5 问）

| # | 视角 | 一句话 | 严重度 | 影响面 | 建议修法 |
|---|---|---|---|---|---|
| C-1 | 程序员 | `unarchiveProject` **按契约实现不出来**：归档冻结若照 F22 抄成 PG RESTRICTIVE 策略，`UPDATE projects SET status='active'`（解归档本体）自己也被拒 | 阻塞开发 | project 束 F116-F128 | F22 刻意把承载冻结标记的表排除在策略外，而项目的 `status` 就长在被扫描的 `projects` 上；需第三条路，且 `KNOWN_CONTRACT_GAPS` P1…P9 未登记此矛盾 |
| C-2 | 程序员 | `advanceAgendaSegment.out.revokedTemporaryGrants` **无出处**：没有任何契约操作能授予临时提权 | 阻塞开发 | project + phase-00 identity | 恒返回 `0` 完全满足契约与四向断言；而反向断言「环节进行中权限有效」**无接口可构造前置状态**——F07 那一类 |
| C-3 | 程序员 | `acl_bindings` **全无写面**：它被定为唯一权限判定源，而 14 个 identity 操作没有一个创建/撤销绑定 | 阻塞开发 | phase-00 identity（已签）+ project + files | C-2 与 `previewExport.out.items[].willBeVisibleTo` 都建立在没有任何契约操作能写出的行上 |
| C-4 | 程序员 | `addProjectMember.out.userId` 在**邀请链接路径上不存在**（免注册主体此刻无 userId），而该字段非空非 nullable | 阻塞开发 | project F128 / org-admin | 两个入口共用一个用例（Q-4① B）要求同一形状，不能靠分支绕开；另缺「令牌无效/过期」与「已是成员（撞主键 409）」两码 |
| C-5 | 程序员 | `exportOrganization` 做了「停用期间仅管理员可导出」这条判定，**却没有码表达拒绝** | 阻塞开发 | phase-00 auth（已签，F19-F22 已 passing） | UC-1.5 V12 ② 的验收在协议层无法断言；`AuthReason.ORG_DISABLED` 也不在该操作 err 里 |
| C-6 | 程序员 | **6 个 err 码不属于任何枚举**，而面向客户端的原因通道恒是 `PermissionReason` —— `EXPORT_PREVIEW_REQUIRED` 被静默吞掉的成因就是这个结构，它至今仍是六个之一 | 会返工 | phase-00 identity（已签） | 实测：`LOCAL_ORG_ONLY` `CAPABILITY_NOT_FOUND` `CLOUD_MODEL_FORBIDDEN` `LOCAL_RUNTIME_UNAVAILABLE` `EXPORT_DIRECTION_FORBIDDEN` `EXPORT_PREVIEW_REQUIRED`；反向 `LOCAL_ORG_ISOLATED` `AUTH_SERVICE_UNAVAILABLE` 声明未用 |
| C-7 | 程序员 | `AuthReason.ORG_DISABLED` **没有任何路径能返回**，而契约为它写了一整段「为什么必须单独一个码」；整个 `AuthReason` 枚举零消费者，8 个操作 err 全是裸字符串 | 会返工 | phase-00 auth（已签） | 与 `EXPORT_PREVIEW_REQUIRED` 同形状 |
| C-8 | 程序员 | 五个 `/auth/*` 操作的 `in` **不是 strict**（全仓仅此 5 处），认证面静默吞掉多余入参 | 会返工 | phase-00 auth（已签） | `out` 方向有 `out-schemas-strict.test.ts` 一整套门控，**`in` 方向没有任何对应测试** |
| C-9 | 程序员 | `err` 与各束 reason 枚举之间**没有门控**：10 个 err 都是裸 `as const`，无 `satisfies`；`contract-shape` 只查大写下划线与束内不重复 | 会返工 | 全部束 | 改名、拼错、删掉最后一个引用点全部静默通过。`project.ts` 为**跨束**同码同义写了 4 处 `satisfies`，偏偏本束自己的失败面没有；`identity.ts` / `auth.ts` / `provenance.ts` 各 0 处 |
| C-10 | 程序员 | `PROJECT_FORBIDDEN_ROUTES` 是**同一事实的第二份声明**：`no-forbidden-routes.test.ts` 不 import 它，自己硬编码了 `/^DELETE\s+\/projects…/i` | 会返工 | project 束 | 实测该常量在全仓（除自身定义与一句注释）**零消费者**；测试那份才是权威 ⇒ 两份可独立漂移 |
| C-11 | 程序员 | `getIngestionStatus`：九态阶梯把失败作为 `out` 的一种取值，而 `err` 又有 `INGESTION_FAILED` —— **二者必有一个是死的** | 会返工 | phase-00 artifact（已签）+ files 束 | 抛错的实现让摄取抽屉永远渲染不出失败档；返回 200 的实现让该码永不可达。契约没选，也没登记；另 `out` 是单条 run 而重跑会产生多条，返回哪一条无出处 |
| C-12 | 程序员 | `verifyCitation`：越界引用要么 200+`allowed:false`、要么抛 `CITATION_OUT_OF_PACK`，**两者互斥 ⇒ 一个必然不可达** | 会返工 | phase-00 context-pack（已签） | 讽刺的是该处注释正在担心「拒绝看起来像通过但有提示」，而契约本身让「拒绝」有两副面孔 |
| C-13 | 程序员 | `assembleContextPack.err` 的 `CONFIDENTIAL_REQUIRES_LOCAL_MODEL` **与 D-U1 裁决反向**（装配本身不调模型），且与 `gateAiCall.out.blockReason` 重复 | 会返工 | context-pack（已签）+ chat/agent-runtime | 删该码，阻断出口保留在 gate |
| C-14 | 程序员 | `ContextPackReason` 有 **3 个成员任何操作都到不了**：`EVIDENCE_WITHDRAWN_MIDWAY` / `ANCHOR_MISSING` / `EMPTY_CANDIDATE_SET` | 会返工 | context-pack（已签） | 实测确认。E5 在 context-pack 侧完全没有协议面；`ANCHOR_MISSING` 已被 `omission-reason.ts:70` 的 `unlocatable` 接管 |
| C-15 | 程序员 | `queryProvenance.err` 的 `PROJECT_ROLE_INSUFFICIENT` **无从判定**：`in` 只有 `orgId`，没有 `projectId` | 会返工 | provenance + X-2 | `targetKind:'project'` 是过滤器不是作用域；要么永不抛，要么实现者自行发明作用域来源 |
| C-16 | 程序员 | 「管理员查他人个人层只返回计数」在 `queryProvenance.out` 里**表达不出来** | 会返工 | provenance × phase-00 identity I-8（已签） | `out` 只有 `{events, nextCursor}`，无降级形状（对照 `getPersonalLayerSummary.out` 有 `itemCount`+`reasonCode`）⇒ 实现会做一次没人能断言的隐式裁剪 |
| C-17 | 程序员 | `createProject.err` 的 `INVALID_KIND` **不可达**：zod enum + 全局 ValidationPipe + DB CHECK 三道等值，应用层这个码是空的 | 会返工 | project | 删码。文件头自己引的「一个不会被任何路径抛出的错误码读起来像覆盖」在此应验 |
| C-18 | 程序员 | `getProjectOverview` 三处：① 管理员审计读取**无 `purpose` 入参、无 `provenanceEventId` 出参** ② `out` 缺已签核截图上的「就绪检查 3/3」 ③ `currentAgendaSegment: null` 语义重载 | 会返工 | project + 已签核 UI 材料 | ① 对照 `identity.readContent` 两者都有，且 `ADMIN_NOT_SUPERUSER` 与 `NO_PROJECT_ROLE` 无优先级规则、其一必为死码 ② 三份签核材料一致要求它、契约无数据来源 ③ 全部环节 closed 与非工作坊不可分辨 |
| C-19 | 程序员 | `advanceAgendaSegment` 四个动作有两个**结果表达不出来**：`merge` 与 `mergeIntoSegmentId` 互不约束（`{action:"merge", …:null}` 合法且无码可拒）、merge 后落哪个 `state` 无出处、`advance` 要动两行而 `out.segment` 只有一条 | 会返工 | project + canvas/templates 三视角首屏 | 「议程环节状态是三视角唯一驱动源」在响应体层面断了——客户端必须再拉一次 list |
| C-20 | 程序员 | `ProjectListItem.readOnlyReason` 是单标量，**表达不了「容器归档」与「组织停用」同时成立**，而契约逐字要求「两种只读必须可分辨」 | 会返工 | project + F22 | 归档项目所在组织被停用是正常状态；两个前端会各选一个显示 |
| C-21 | 程序员 | `usecases.md` §3.2 恰好 4 行而 `ProjectReason` ③ 段有 5 个 —— 契约自己那句「**这里不许多一条**」在写下的同时就不成立 | 会返工 | project | `ORG_ROLE_INSUFFICIENT` 被加到 5 处而 usecases 只在 UC-P1 授权过；反向 UC-P9 逐字含 `ADMIN_NOT_SUPERUSER` 而三个成员操作 err 里都没有；`DEPENDENCY_UNAVAILABLE` 只在 zod 里 |
| C-22 | 程序员 | project 束 **10 个操作零个 `*_NOT_FOUND`**，而兄弟束都有 | 会返工 | project | 带路径 id 的 9 个操作里，`workshopId`+`segmentId` 不匹配无码、`changeProjectRole`/`removeProjectMember` 的目标 userId 非成员时无码（`NO_PROJECT_ROLE` 说的是调用者） |
| C-23 | 程序员 | `upgradeBinding` 只能用**错名词的码**报「绑定不存在」（`in` 是 `bindingId`，`err` 是 `ARTIFACT_NOT_FOUND`）；`pinVersion` 收 `artifactId` 而 err 里根本没有 `ARTIFACT_NOT_FOUND` | 会返工 | phase-00 artifact（已签） | 后者使「`ARTIFACT_NOT_FOUND` 兼任草稿越权返 404」这条设计在定版路径上**无码可用** |
| C-24 | 程序员 | `PasswordRejection`（`TOO_SHORT`/`WEAK_COMMON`）**零引用**，口令被拒原因不可返回 | 会返工 | phase-00 auth（已签） | 已登记的是「检查未实现」（C4），**没登记的是契约面没有承载它的出口**——补上检查也没地方报 |
| C-25 | 程序员 | `adjustRetrievalWeights.in.weights` 是 `z.record(z.number())`，**键不受校验**；拼错的通道名被静默接受并忽略 | 记录 | context-pack（已签） | `RetrievalChannel` 就在同文件；同型问题已被 `KNOWN_CONTRACT_GAPS.C_F17_3` 登记过一次，这是第二处 |
| C-26 | 程序员 | `contract-shape` 与 `out-schemas-strict` 的束清单**漏了 `auth` 与 `provenance`**（P-3 的当下实例） | 记录 | phase-00 auth / provenance（已签） | `auth` 的 8 条路径与 `provenance` 的路由从未参与跨束 path 冲突检查；且 `auth.ts:354-355` 声称「其余束的 out 都还不是 strict」已过时——陈述与事实两头都不对 |

（另 3 条低度：`referenceForDownstream.err` 的 `SNAPSHOT_IMMUTABLE` 不可达（本操作只新建引用，不修改删除任何版本）；`listOmissions` 的 `droppedCount`/`thresholdUsed` 与 `reasonFilter` 并存而未说过滤前后；`provenance.ts` 的 `target.kind` 六值闭集在同文件逐字写两遍、无单一常量。已并入上表 C-14 / C-25 / C-9 的同类处置。）

---

## 逐条详述

### A-1 · 第 11 束 `asset-governance` 没有任何 feature 可归它（阻塞开发）

机械核对（脚本读全部 `design-signoff.md` 的 frontmatter `covers:`，对 `feature_list.json` 做双向差集）：

```
features: 124        dup ids: []          points: 417
covered feats: 124   OVERLAP: {}          UNCOVERED: []   GHOST: []
```

即**前十束已经把 124 个 feature 无缝、无重叠地分完了**。而 `asset-governance` 的
`covers:` 是空的，`auditSignoff` 对它报的正是那条故意的红：

```
FAIL: 契约束「asset-governance」声明了 `covers: []`（空）—— 一个不覆盖任何 feature 的束不成立，
      **因此它不可签核**。… 修法只有两条：⑴ 裁决完成 → 生成 feature → 填进 covers；⑵ 删掉束目录。
```

⇒ 「治理机制归 asset-governance、领域模型归各束」这条切法在具体 feature 上**站不住**：
没有一个 feature 是「纯治理机制」。任何给它填 feature 的动作都必须把 feature 从
`skills` / `agent-runtime` / `canvas` / `templates` 中**移出**，而这四束都已 `confirmed`
（`confirmed_by: yanbin shen`）——移出即改变已签核的评审范围，等于撤销四份签名。

判据「边界是否可判定」的直接反例在该束自己的文件里：
`contracts/asset-governance/domain.md:289-302` 自报 10 条跨束约束，其中 **X-E** 自称
「本束与已签核内容最硬的一处冲突」（`AssetDirectory` 多文件 vs `skills` 的 `fileCount`
phase-1 恒为 1）。一条需要修订已签束才能落地的约束，说明边界**尚未可判定**。

### A-2 / A-3 · 一致性复核从未做过；第 11 束的 10 条约束一条未进复核（阻塞开发）

`phases/phase-01-run-a-project/design-coherence.md`：`status: pending`；正文第 90-105 行
那张 14 项表（X-1…X-14）的标题逐字是「待议清单（**是议程不是结论**）」；处置段
（107-109 行）是一个空 HTML 注释；第三节（错误语义）、第四节（单源候选）、第五节（阻塞）、
第六节（人类裁决）全部 `待填`。

frontmatter 自己也写着两次「本次**只改了 covers_bundles 这一个字段**，
`status` / `confirmed_by` / `confirmed_at` 一律未动，第二~六节的交叉约束复核**仍未做**」。

这与「8 个束已 `confirmed`」并置的后果是：单束都签了，而**跨束这一层完全没人看过**。
下面 A-4…A-11 是我自己找的，全部是任何单束都发现不了的那一类——它们本该由这层查出来。

### A-4 · 资源可见性枚举 ≥5 套互不同构（阻塞开发）

每束的写法都是「先声明本束不定义，再定义一套」：

| 位置 | 值集 |
|---|---|
| `contracts/files/domain.md:45` | `全场 / 本组 / 私有 / 仅某团队`（4 值，注「判定属 identity 束，本束只投影」） |
| `contracts/chat/domain.md:26-36` | `member-private \| group-shared \| plenary \| team-visible \| private`（自称「**五值封闭**」） |
| `contracts/skills/domain.md:24`、`contracts/canvas/domain.md:50` | `org-wide \| team-only`（canvas 注「**不另起一套**」） |
| `contracts/agent-runtime/domain.md:126` | `全组织可用 \| 仅某组` |
| `contracts/asset-governance/domain.md:82` | `指定团队 \| 全组织 \| 仅自己-私有草稿` |

两个硬后果，不是文风问题：

1. `chat` 的 `member-private` 在 files 的四值里**没有对应**，而
   `contracts/files/domain.md:111`（N-14）要求物化的 `messages.jsonl` 携带
   「所有引用来源可见性的最严结果」——最严的 chat 取值在 files 侧不可表示，
   **N-14 对私密会话不可断言**。
2. phase-00 已经抓过同一类：`phases/phase-00-shared-kernel/design-coherence.md:166`
   点名 `"org"|"team"` vs `"org-wide"|"team-only"`，判词是「**会成为联调 bug**」。
   phase-01 的 X-14 登记的是**相反方向**的担忧（不要把两个事实并进一个字段），
   「一个事实五套词表」无人登记。

### A-5 · 「不披露存在性」谓词五份实现、四个错误码（阻塞开发）

- `contracts/skills/domain.md:161` I-14 —— 四入口 0 命中，直读 `SKILL_NOT_FOUND`（404 非 403）
- `contracts/agent-runtime/domain.md:324` I-52 —— 四入口，`AGENT_NOT_FOUND`（「**404 语义，非 403**」）
- `contracts/asset-governance/domain.md:254` I-12 —— 四入口 0 命中，404 非 403，且**唯一**写了
  「与 `skills` I-14 同形，**复用同一判定函数**」
- `contracts/chat/domain.md:272-273` —— 「返回 **404 而非 403**」，六身份清扫，「逐字节相同的 404」
- `contracts/files/usecases.md:481` —— 折叠为 `ARTIFACT_NOT_FOUND`；`contracts/canvas/usecases.md:42` —— `INSTANCE_NOT_FOUND`

一个谓词、五份实现、四个错误码、一处请求复用。X-1…X-14 一条都没登记。

### A-6 · 两层交集鉴权在非工作坊容器上没有正确分支（阻塞开发）

U-1 裁 B（非工作坊容器各自一张成员表，只落拥有者 + 协作者两档），
签核见 `contracts/project/domain.md:394`（`yanbin shen 2026-07-30T16:34:55+08:00`）。

`apps/api/src/domain/identity/permission-decision.ts:104-133` 与
`apps/api/src/application/identity/authorize.ts:79-99` 只有两条路：

- 传 `projectId = <研究项目容器 id>` ⇒ `findProjectMembership` 查 `project_memberships` 返回
  `null` ⇒ `projectLayer.role = null` ⇒ `passed = false` ⇒ 返回 `NO_PROJECT_ROLE`。
  **容器的拥有者也被拒。**
- 传 `projectId = undefined` ⇒ `authorize.ts:93` `project: null` ⇒
  `permission-decision.ts:120` 整个项目层判定被跳过 ⇒ 只剩组织层
  ⇒ **组织内任何成员对任何研究项目 / 用户洞察容器全权。**

**两条都不会让任何断言变红**：F01 全部测试
（`rbac-two-layer.test.ts` / `rbac-role-matrix.test.ts` / `org-switch-context-reset.test.ts` /
`contract-response.test.ts`）的夹具全是工作坊 + `project_memberships` 行。

被破的 phase-00 已签核不变量：

| 不变量 | 位置 | D 之后 |
|---|---|---|
| I-11「项目角色只在存在 `projectId` 上下文时有值」 | `phase-00/contracts/identity/domain.md:94` | 断言只写了「非项目请求的 `projectLayer` 为 null」——**单向蕴含**。「有上下文但角色恒为 null」落在盲区，I-11 依然绿 |
| I-P9「`projectLayer === null` 与 `projectLayer.role === null` 是两件事，禁止合并」 | `contracts/project/domain.md:225` | **第三件事**（本容器不用项目角色本体）被折叠进第二件；研究项目拥有者与越权陌生人在响应体上完全不可区分 |
| O-03「项目角色恒四种」 | `phase-00/contracts/identity/domain.md:38,41` | 形式不破（CHECK 仍四值），**实质已破**：一个 `projects` 行的成员角色词汇表现在可以是 `{owner, collaborator}` |
| I-1 / I-4 / I-5 / I-6 / I-7 | 同上 `:84,87-89,90` | **不破**（见「设计对的地方」） |

`MIGRATION-IMPACT.md` §四 的五条签核确认项**一条都没提**这件事。

### A-12 · `admin_project_access` 是幻影表（阻塞开发）

`grep -rn "CREATE TABLE" apps/api/migrations/*.sql` 里没有 `admin_project_access`；
它是 provenance 事件类型名（`apps/api/src/application/identity/read-content.ts:122`
`type: "admin-project-access"`）。`MIGRATION-IMPACT.md` 第 3 条外键指的
`0005-f03-admin-boundary.sql:38` 真实宿主是 **`content_items`**（我实测确认：
`:33 CREATE TABLE IF NOT EXISTS content_items`，`:38 project_id text REFERENCES projects (id) ON DELETE CASCADE`）。

为什么不是笔误级别：`content_items` 是 `readContent` 的唯一读路径宿主。D 之后一条
`layer='project'` 的行可以挂在用户洞察容器上，而 `content_items_layer_project` CHECK
（`:51-54`）**仍然满足**——它断言的是「有 `project_id`」，从来没断言过「这个 project 是工作坊」。
**结构不变、断言全绿、被断言的性质已经没了。**

错名已扩散 7 处，其中两处是权威件：`feature_list.json:2528`、
`contracts/project/design-signoff.md:306`（X-21，**人类要签的那一条**）。
签 X-21 的人被要求对一张不存在的表做审计语义判断。

### A-13 · `MIGRATION-IMPACT.md` §3.2① 整条错误（阻塞开发）

文档 `:220-227` 逐字：「`0014-f22-org-lifecycle.sql` 的冻结策略是「逐表装」的……
**表清单是写死的**……**没有这条断言，这个洞不可能被发现**。」

我实测反驳（`apps/api/migrations/0014-f22-org-lifecycle.sql:151-172`）：

```sql
CREATE OR REPLACE FUNCTION kernel_apply_org_freeze_policies() RETURNS void AS $$
  FOR r IN
    SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n …
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_constraint con … AND a.attname = 'org_id' …)
  LOOP
```

**是 catalog 推导，不是写死清单**——文档引对了行号，读反了机制。
且对应断言早已存在（`apps/api/tests/auth/org-disabled-readonly.test.ts:300-310`，
同样 catalog 推导，`:311-318` 还配了非空转反证）。

为什么阻塞：文档给的处置是「补一条断言」，照做即**在已有 catalog 门控之外再造一份同事实断言**——
正是 `AGENTS.md` 明令禁止的「同一事实两处」。而这个错误已抄进
`feature_list.json:2528`：「⚠ 三张新子表不在 `0014:165-184` 的写死表清单里，需一并补进去」。
**一个 feature 的 notes 现在指挥实现者去做一件基于错误前提的事。**
真实的 `0018` 要求只剩一行：末尾 `SELECT kernel_apply_org_freeze_policies();`。

### A-14 · Context Pack 的容器过滤（阻塞开发）

| 层 | 形状 | 位置 |
|---|---|---|
| 契约 | `projectIds: z.array(z.string())` | `packages/contracts/src/context-pack.ts:147` |
| 应用层 | `readonly projectId: string \| null`（**单值**） | `apps/api/src/application/retrieval/retrieve-candidates.ts:111`、`ports.ts:49,71` |
| SQL | `AND ($2::text IS NULL OR st.project_id = $2 OR st.layer <> 'project')` | `apps/api/src/infrastructure/retrieval/pg-segment-retriever.ts:101` |

1. `projectIds` **从未接进检索路径**。X-18 与 `MIGRATION-IMPACT:255` 把风险描述成
   「`QueryContext.projectIds` 不按 `status` 过滤」——这句话预设它是被过滤器用的。
2. `projectId === null` ⇒ 容器过滤**整体关闭**，且 `retrieve-candidates.ts:198` 使鉴权同时
   退化为仅组织层（走 A-6 的第二条错路）。D 之前 `segment_text.project_id` 只可能指向工作坊，
   所以「无项目上下文的组织级检索」的实际范围就是工作坊；**D 之后同一次调用把研究项目与
   用户洞察的 segment 一并扫进候选集并按组织层放行**。结构不变、
   `rls-cross-tenant-zero-leak.test.ts` 与 F10 全部断言仍绿、「容器隔离」这个性质已经没了。
3. 因为非工作坊容器上没有可用的项目角色（A-6），实现者被**结构性地推向传 `null`**——
   这不是疏忽风险，是当前代码形状下的唯一可跑通路径。

### A-15 · artifact 绑定双重死路（阻塞开发）

1. **动作词**：`apps/api/src/application/artifact/bind-to-project-step.ts:75`
   `BIND_ACTION = "group.submitOutput"`，只属 `facilitator` / `groupLead`
   （`project-role-matrix.ts:65-69`）。非工作坊容器无 `project_memberships` 行 ⇒
   抛 `NoProjectRoleError`。**U-1 的 `owner` 拥有者也绑不了。**
   而 `:69-73` 的注释逐字说明「新造 action id 会修订已签核束」——这条路在设计上被锁死。
2. **环节归属**：`packages/contracts/src/artifact.ts:205,302` `stepId: z.string()`（非可选非 nullable）。
   Q-2① 裁 A 后环节挂 `workshops`（`domain.md:242`）⇒ 非工作坊容器**不存在任何合法取值**。
3. 但 `artifacts.project_id`（`0006-f04-artifact-model.sql:61`）无 kind 约束 ⇒ artifact
   **可以属于**研究项目容器，只是**不能被绑定到环节** ⇒ 出现「artifact 属于容器 C，
   但 C 的界面上没有任何回流列表」的状态，无任何门控发现。

### P-1 · `verify-uc-coverage` 的 R12 检查跨 UC 遮盖（阻塞开发）

`.harness/scripts/verify-uc-coverage.ts:76-121`：`mappedV` 是**整个 coverage.md 的一个扁平
V 编号 Set**，而 `declared` 是**逐份 UC** 的 R12 编号。各束的 UC 编号都从 V1 重新起算，
于是一份 UC 的覆盖行会顶替另一份 UC 的要求。反证见 CP-2。

量化（我写脚本按门控自己的逻辑重算）：

```
bundle            UC数  表内行数  真实需覆盖(Σ每UC)  门控实际要求(∪编号)
agent-runtime       9      24            158              24
canvas              4      17             49              17
chat                5      18             56              18
files               4      14             50              14
interview           8      15            102              15
org-admin           5      14             61              14
project             3      14             38              14
recording           4      16             43              16
skills              6      16             77              16
templates           4      19             55              19
合计：真实需覆盖 689 条 (UC,V)；门控实际只要求 167 个不同编号 —— 遮盖率 76%
```

`interview` 最极端：8 份 UC / 102 条真实线索，门控只要 15 个编号。

另有两条**尚未触发但机制在**的空集路径（同一函数内）：
`:80 if (!existsSync(covPath)) continue;`（无 coverage.md 静默跳过 ②③）
与 `:104 body.slice(body.indexOf("## R12"))`——`indexOf` 返回 `-1` 时
`slice(-1)` 取最后一个字符，`declared` 变空数组，**平凡为真**。
我实测 phase-01 当前 52 份 UC 全部有 `## R12`、全部路径存在，所以这两条现在不是洞。

### P-2 · 签核第 ③ 件既不存在、也无门控（阻塞开发）

`packages/contracts/src/` 实存 9 个模块（`artifact` `auth` `context-pack` `filter-action`
`identity` `omission-reason` `project` `provenance` `thresholds`），`index.ts` 全部导出（无遗漏）。

phase-01 十束里**只有 `project.ts` 存在**。其余九束的 `design-signoff.md` 自己逐字写着「尚未创建」：

```
agent-runtime/design-signoff.md:51   | ③ API 契约 | `packages/contracts/src/agent-runtime.ts` | **尚未创建**——本轮只是骨架 |
canvas/design-signoff.md:102        packages/contracts/src/canvas.ts        （zod 单一事实源，尚未创建）
chat/design-signoff.md:138          packages/contracts/src/chat.ts        ← 尚未创建
interview/design-signoff.md:99      packages/contracts/src/interview.ts        ← 尚未创建
recording/design-signoff.md:117     packages/contracts/src/recording.ts        （zod 单一事实源，尚未创建）
```

其中 **8 束已 `status: confirmed` / `confirmed_by: yanbin shen`**。
ADR-023 决策一写着「两者都没有 ⇒ 失败并报出「第 ③ 件缺失」」，且
「**不接受沉默的第三种情况**」。我核了 `.harness/scripts/`：
`requiredBundleFiles()`（`lib/design-signoff.ts`）只返回
`["domain.md","usecases.md","coverage.md","design-signoff.md"(+"ui.md")]`，
`grep -rn "第 ③\|无对外 HTTP\|没有业务 HTTP" .harness/scripts/` **零命中**。
**该门控不存在。** 反证见 CP-1。

（phase-00 的 `api-kernel` / `web-kernel` 走的是 ADR-023 允许的第二形态，
`web-kernel/domain.md:130` 逐字「零后端、零 HTTP、零 mock 生成、零 OpenAPI」——那是正当使用。
phase-01 九束**既没有契约文件、也没有这样的声明**，正是 ADR-023 说不接受的第三种情况。）

### P-3 · 三道契约门控的束清单是硬编码（会返工）

```
packages/contracts/tests/out-schemas-strict.test.ts:29   const BUNDLES = { identity, artifact, contextPack, auth, project }
packages/contracts/tests/contract-shape.test.ts:17       const BUNDLES = [identity, artifact, context-pack, project]
packages/contracts/tests/no-forbidden-routes.test.ts:24  const ALL_OPERATIONS = { identity, artifact, context-pack, provenance, project }
```

`grep -rn "readdirSync\|import.meta.glob" packages/contracts/tests/` 只命中
`pending-thresholds.test.ts:103`（它是文件系统派生的，做对了）。
⇒ 九个束的契约落地时，**只要没人手动改这三份清单，三道门就看不见它们**，
`out` 不 strict、路由禁令被违反、`method/path/in/out/err` 缺件，全部静默通过。
这正是「结构没变、断言全绿、性质已经没了」的前瞻形态。

### P-11 / P-12 · 命名单源与改名成本（阻塞开发）

D-03a（`phases/requirements/DECISIONS-FINAL.md:31`，自称「全局权威」）三个正名的实际采用：

| 正名 | 文档层 | 代码层（`apps/` + `packages/`） |
|---|---|---|
| `agenda_segment` | 广泛 | **`apps/api` 全域 0 命中**（含全部 migrations）；仅 `apps/web` mock/组件 10 文件 + 未提交的 `project.ts` |
| `design_facet` | 16 文件，**全部 .md** | **0 命中**（真实契约与代码统一叫 `ConfigItem`） |
| `method_stage` | 19 文件，**全部 .md** | **0 命中** |

`design_facet` 在 D-03a 自己声明的 4 个引用方里 **3 个是 0 命中**
（`requirements/02-tpl/`、`requirements/03-skill/`、`phase-02/requirements/13-deliv/` 全部 ZERO，
`contracts/templates/`、`contracts/skills/` 也 ZERO）。这比「两名并存」更隐蔽——
按 `design_facet` 去 grep 会一片安静，看起来像没问题。

**败选名 `agenda_stage` 仍在 25 个文件**，而两处权威登记都写「只剩 2 个文件」：
`requirements/00-project/OPEN-QUESTIONS.md:312-317` 与
`contracts/project/design-signoff.md:304`（X-3'）。两处引的第二个证据
`contracts/templates/ui.md:123` **不存在**（该文件只有 111 行，`grep -c agenda_stage` = 0）。
而完全未被提及的是 `contracts/templates/usecases.md` 的 **11 处**，包括
实体名 `AgendaStageInstance`、端口名 `setAgendaStageStatus`、发布器名 `AgendaStageStatusPublisher`——
这是本束**契约端口的正式名字**，不是遗留注释。

**`org-admin` 束是一个完全未登记的第三套名字**：`domain.md:104,105,113,159,184` +
`usecases.md` 共 8 处 `*StageId` 指议程环节（字段说明逐字写「议程环节」），
`agenda_segment` 在该束 0 命中。它既不在 OPEN-QUESTIONS 的清单里，
也不在 D-03a 的引用方列表里，也不在 MIGRATION-IMPACT 的波及面里。

Q-3 ① 的成本：`git log --oneline main -- <path>` 逐个核 25 个文件 ⇒ **24 个已在 `main`（96%）**，
唯一不在的是 `apps/web/lib/mock/project.ts`。含迁移 `0008-f06-binding-modes.sql`（已 passing 不可改）、
契约单源 `artifact.ts`（3 处）、7 个后端实现（39 行）、
**6 个 kernel 测试（54 行，是 F06/F07/F08/F13 的验收命令本体）**、
`project-role-matrix.ts`（10 处动作词）+ 3 个 F01 验收测试。
改名**零进度**：`grep -rn 'agenda_segment' apps/api` = ZERO，无 `0018-*` 迁移，无命名门控
（`grep -rn 'lint-naming\|forbidden-name' package.json .harness/` = 0）。
而 `feature_list.json` F121 的 `user_visible_behavior` 已把「全仓只剩一种叫法」写成现状。

### P-14 · `segment` 库内两义，无人登记（会返工）

`segment` = **转写/检索片段** 已经在已合入 `main` 的 schema 里：

- `apps/api/migrations/0009-f10-retrieval-index.sql:155` `CREATE TABLE segment_text`
- `apps/api/migrations/0003-identity.sql:80`
  `object_kind text NOT NULL CHECK (object_kind IN ('project','artifact','segment'))`
- `packages/contracts/src/identity.ts:413,442` `kind: z.enum(["project","artifact","segment"])`
- `apps/api/migrations/0006-f04-artifact-model.sql:131,335` `acl_bindings.object_kind = 'segment'` 触发器分支

D-03a 把 `agenda_segment` 派给**议程环节** ⇒ 同一个数据库里 `segment` 同时指两件事，
且它是 ACL 对象类型闭集的成员。`MIGRATION-IMPACT.md` 里 `segment_text` 只出现在
`:33`（外键清单）、`:107`（F10 影响）、`:254`（下游），**全是外键/kind 分区语境，
一次都没提「segment 已经有别的含义」**。
`packages/contracts/src/project.ts:202` 自己嗅到了边缘（「`agenda_segment_id` 被挡住了，
`current_segment_id` 没有」），但没有任何文件把它登记为命名冲突。

同类混用已在契约里发生：`contracts/canvas/domain.md:78,79,84,159` 的 `agendaSegmentId`
与 `:104,191,195` 的 `segmentId`（转写片段）在**同一份 domain.md 里各指一物**；
`contracts/interview/domain.md:31,33` 的 `StepAttachment.stepId`（议程环节）与
`:92` 的 `WithdrawalStep`（撤回链 5 步）**在同一份 domain.md 里用同一个词指两件事**。

### P-13 · 一条改名后会空转的验收断言（会返工）

```ts
// apps/api/tests/kernel/rbac-role-matrix.test.ts:151-155
it("a group lead cannot control the room", async () => {
  for (const a of PROJECT_ACTIONS.filter((x) => x.startsWith("stage."))) {
    expect((await ask("u-groupLead", a)).allowed, a).toBe(false);
  }
});
```

我实测确认 `PROJECT_ACTIONS` 里的 `stage.*` 恰有 5 条
（`project-role-matrix.ts:26-30`）。改名为 `agendaSegment.*` 之后
`filter` 返回**空数组**，循环体一次不执行，**测试通过**。
它守的是 F01 验收「组长不能控场」这一整条性质。

而 `MIGRATION-IMPACT.md:211` 逐字声称 `stage.*` 改名会让 `rbac-role-matrix.test.ts` 变红
（理由是「矩阵成员逐值比对」）——对 `:152` 这条**不成立**：它不是逐值比对，是前缀过滤。
⇒ 文档把一条会空转的断言列进了「可以放心依赖门控发现」。

---

## 我做的反证

### CP-1 · 「签核三件」的第 ③ 件不存在，门控毫无察觉 —— **证实**

**破坏**：在 `phases/phase-97-counterproof/`（全新、未跟踪目录）造一个最小合规阶段：
`requirements/story.md`（一份真实 story，非裸模板）、`feature_list.json`（F01）、
`contracts/faux/{domain,usecases,coverage,ui}.md`（各一行）、
`contracts/faux/design-signoff.md`（`covers: [F01]`、`status: confirmed`、
`confirmed_by: counterproof`、`confirmed_at: 2026-07-29T10:00:00+08:00`）、
`design-coherence.md`（`covers_bundles: [faux]`、`status: confirmed`）。
**故意不创建** `packages/contracts/src/faux.ts`（已确认 `ls` 报 No such file）。

**结果**：

```
$ auditSignoff("97", ["F01"])
fails: 0 warns: 0 applicable: true
>>> 放行：束「三件」的第 ③ 件不存在，门控毫无察觉

$ pnpm exec tsx .harness/scripts/verify-uc-coverage.ts 97
  1 个契约束｜已签 1｜待签 0
  阶段一致性复核：✅ 已通过
  ✅ 覆盖矩阵完整
✅ 全部阶段通过        verify-uc-coverage EXIT=0
```

**附带证实的第二件事**：`coverage.md` 里只有一行 `# coverage`（零表格、零 V 行），
仍被判「✅ 覆盖矩阵完整」——②③ 遍历表格行，零行 ⇒ `emptyCells = []` ⇒ 不报错；
R12 检查因 `story.md` 无 `## R12` ⇒ `declared = []` ⇒ **平凡为真**。
这就是纪律 10 所指的形状，在一次实跑里同时命中两条。

**恢复**：`rm -rf phases/phase-97-counterproof`，并重跑 `lint-ui-material` 确认
关于 `phase-97-counterproof/faux` 的那条红消失。

### CP-2 · `verify-uc-coverage` 的 R12 检查跨 UC 遮盖 —— **证实**

对象：`requirements/08-chat/uc-8-1-对话卡片列表.md` 与 `contracts/chat/coverage.md`
（破坏前 `git status --porcelain` 对两者返回空 = 已跟踪且干净）。

**第一次尝试（不成立，记录在此以免误导）**：删掉 `coverage.md` 里第一条 `| V1 |` 行 ⇒
**无新红**。原因不是门控失效，而是 `V1` 在该文件其它表格里还有第二处出现，
`mappedV` 是 Set ⇒ 删一处不改变集合。这正好指向真正的缺陷，于是改用下面这个设计。

**破坏 步骤 1**：给 `uc-8-1.md` 的 R12 新增一条真实验收线索 `- V99 …`（coverage 表里无人管它）。

```
✗ chat/coverage.md 漏了 08-chat/uc-8-1-对话卡片列表.md 的验收线索：V99（R12 共 9 条，覆盖 8 条）
```

⇒ 门控确实能发现「某份 UC 漏了一条」，**它不是完全空转的**。

**破坏 步骤 2**：把 `| V99 | 这一行属于 uc-8-5 的表，与 uc-8-1 毫无关系 | ... |` 插进
`coverage.md` 里 **uc-8-5 段落**的表格（第 195 行后），**完全不碰 uc-8-1 的表**。

```
（关于 chat/coverage 的红：一条都没有）
```

⇒ **红消失。跨 UC 遮盖证实。** 一份 UC 的覆盖行可以顶替另一份 UC 的要求，
门控无法把覆盖行归属到 UC。

**恢复**：`git checkout -- <UC> <COV>`，`git status --porcelain` 对两者返回空。

**量化**（用门控自己的逻辑重算，见 P-1 表）：真实需覆盖 **689** 条 `(UC,V)`，
门控实际只要求 **167** 个不同编号 —— **遮盖率 76%**。

### CP-3 · `lint-ui-material` 是真的会红 —— **门控通过反证**

**破坏**：CP-1 的 fixture 里 `contracts/faux/ui.md` 存在，而
`.harness/scripts/ui-material-map.json` 未声明它（map 的 `//4` 承诺此时应报「未声明」而非静默跳过）。

**结果**：

```
✗ [未声明] phase-97-counterproof/faux/ui.md 存在，但 ui-material-map.json 里没有声明它的截图目录。
✗ [目录缺失] phase-01-run-a-project/asset-governance 声明的截图目录不存在：…/ui-preview/asset-governance
    这里**不**当成 0/0 通过——「空集使断言平凡为真」是本仓栽过的形状。
❌ lint-ui-material: 2 处材料不一致。   EXIT=1
```

⇒ 两条都红，且第二条正是并发 agent 刚给 `asset-governance` 加了 map 条目、
截图目录还没建时的真实缺口——**它不会被当成 0/0 通过**。
这道门控的实现与它的承诺一致（428 张截图、双向、点名到文件）。

**恢复**：删除 fixture 后重跑，只剩 `asset-governance` 那一条既存红。

### CP-5 · 契约 `err` 码与 reason 枚举的双向差集 —— **机械核实，非推理**

不是破坏型反证，而是一次**机械测量**：写脚本 import 六个契约模块，
对每个束做 ①「`operations[*].err` 用到但枚举里没有」②「枚举里有但没有任何操作用」
两个方向的差集，并扫描全部 `in` 的 `unknownKeys`。实测输出（未改动任何文件）：

```
=== in-schema strictness per operation ===
  NOT-STRICT  auth.login                     (unknownKeys=strip)
  NOT-STRICT  auth.requestPasswordReset      (unknownKeys=strip)
  NOT-STRICT  auth.completePasswordReset     (unknownKeys=strip)
  NOT-STRICT  auth.validateSession           (unknownKeys=strip)
  NOT-STRICT  auth.redeemInviteAndCreateOrg  (unknownKeys=strip)
=== err codes vs reason enums (double difference) ===
  identity:    err-not-in-enum=[LOCAL_ORG_ONLY, CAPABILITY_NOT_FOUND, CLOUD_MODEL_FORBIDDEN,
                                LOCAL_RUNTIME_UNAVAILABLE, EXPORT_DIRECTION_FORBIDDEN,
                                EXPORT_PREVIEW_REQUIRED]
               enum-never-used=[LOCAL_ORG_ISOLATED, AUTH_SERVICE_UNAVAILABLE]
  auth:        err-not-in-enum=[]   enum-never-used=[ORG_DISABLED]
  contextPack: err-not-in-enum=[]   enum-never-used=[EMPTY_CANDIDATE_SET,
                                                     EVIDENCE_WITHDRAWN_MIDWAY, ANCHOR_MISSING]
  project:     err-not-in-enum=[]   enum-never-used=[]
  artifact:    NO reason enum at all;  err codes used=12
  provenance:  NO reason enum at all;  err codes used=2
```

三条结论：
① **`/auth/*` 那五个 `in` 非 strict 是全仓唯一的五处**，其余所有束的所有操作都是 strict（C-8）。
② `EXPORT_PREVIEW_REQUIRED` 至今仍在「不属于任何枚举」的六个之列——
   **它的成因结构没有被修掉，只修了那一次的表现**（C-6）。
③ `project` 束当前双向差集为空（它自称的「每个成员都在某个 `err` 里出现」**今天成立**），
   但没有 `satisfies` 钉住它：实测 `identity.ts` / `auth.ts` / `provenance.ts` 各 **0** 处
   `satisfies`，`project.ts` 有 4 处却全用在**跨束**同码同义上，本束自己的失败面裸着（C-9）。

另核实 C-10：`grep -rn "PROJECT_FORBIDDEN_ROUTES" packages apps .harness` 除自身定义
（`project.ts:295`）与一句注释（`:493`）外**零命中**，而
`tests/no-forbidden-routes.test.ts:70` 自己硬编码 `pattern: /^DELETE\s+\/projects(\/:?[^/]+)?$/i`。

### 其它已实跑但非「破坏/恢复」型的门控核查

| 门控 | 命令 | 结果 |
|---|---|---|
| `validate-fl` | `tsx .harness/scripts/validate-fl.ts 01` | `124 个 feature / 417 点 ✅ 全部通过` |
| `verify-uc-coverage 01` | 同上 | 真实退出码 **1**（5 项不合格，全部来自签核链）。⚠ 我第一次用 `\| tail` 取 `$?` 读到 0，是**我自己的测量错误**，已纠正——纪律 5 的形状 |
| `lint-arch-deps` | `node …/lint-arch-deps.mjs apps/api/src` | `148 files, all dependencies point inward` EXIT=0 |
| `lint-contract-source` | `node …/lint-contract-source.mjs` | **EXIT=1，真红 1 条**：`apps/web/lib/mock/projects.ts:13` 用字面量重定义 `ProjectStatus` |
| `pending-thresholds` | `pnpm --filter @repo/contracts exec vitest run` | **1 failed / 37 passed**，红在三处「180 天」硬编码（`mock/itv.ts:537`、`mock/project.ts:338`、`components/project/tab-settings.tsx:82`）——与 COORDINATOR-LOOP 记的既存红一致 |
| `no-builtin-capability-lists` | `node apps/api/scripts/lint-no-builtin-capabilities.mjs` | `violations=0 debt=76 migrations=18` EXIT=0；债务逐条点名，不是数量阈值 |
| 签核链现状 | 自写脚本调 `auditSignoff("01", [])` | 11 束：**已签 8**，待签 3（`asset-governance` `project` `skills`）；一致性复核 `pending` |

---

## 我认为设计是对的地方

一份全是问题的审计和一份全是通过的审计可疑程度相同。以下是我**核过并判它没问题**的，附核法。

1. **束↔feature 映射是干净的，而且是结构化单源。** 我写脚本读全部 11 份
   `design-signoff.md` 的 frontmatter `covers:`，对 `feature_list.json` 做双向差集：
   `124 features / covered 124 / OVERLAP {} / UNCOVERED [] / GHOST [] / dup ids []`。
   ADR-023 决策三想解决的「映射权威是一行散文」确实解决了——`design-signoff.ts` 只从
   frontmatter 读，`verify-uc-coverage.ts:17-22` 的注释还专门记了「此前两处各有一份中文正则」
   这个已收敛的缺陷。**这一层没有问题，A-1 的问题在于第 11 束无处可分，不是分错了。**

2. **`lint-ui-material` 是本轮我见到最扎实的门控。** 双向集合相等、点名到文件、
   束↔目录映射有唯一事实源、显式拒绝把缺失目录当 0/0、映射缺条目报「未声明」而非静默跳过。
   CP-3 实测两种破坏都红。它自己的文档还记着「别再手写 grep 数截图：文件名含中文，
   `[a-z0-9-]+\.png` 会对每个束返回 0 处命中」——这条经验被写进了正确的位置。

3. **`out-schemas-strict.test.ts` 是「断言性质 + 防空转」的教科书写法。**
   它断言的是 `unknownKeys === "strict"` 这个性质（不是数量），递归走嵌套与数组元素，
   并且**自带一条反空转断言**：
   `expect(total.length, "一个 out 都没扫到，上面那条会永远为真").toBeGreaterThan(20)`，
   外加一组正反识别断言（宽松的确实吞字段、严格的确实拒绝）。
   它的缺陷（P-3）在**清单来源**，不在断言方式。

4. **`pending-thresholds` 是文件系统派生的，且此刻真的红着。**
   `readdirSync` 递归扫产品代码，不是硬编码清单；豁免要写成
   `[threshold-ok:<name>] <理由>` 出现在 diff 里。它现在因三处「180 天」失败——
   **一个正在红的门控是它有效的最好证据**。

5. **`omissions-auditable.test.ts` 的 `toHaveLength(27)` / `toHaveLength(3)` 不是纪律 9 的违规。**
   我核了 `:325-365`：27 来自**同文件构造的夹具**（`Array.from({length: 27}, …)`），
   3 是合规三条的**固定语义**；而枚举成员数那处 `:296` 明确写着「刻意**不是**
   `toHaveLength(8)`」。同文件还带一条真反证（把合规栏写成「对过滤后的列表再筛一次」，
   断言错误实现输出 `[]`、正确实现输出 3）。**这是对的，我只把 `reference-eligibility-gate.test.ts:157`
   判为违规（P-9），因为那处断的确实是枚举成员数。**

6. **`design-signoff.ts` 的解析器毛边处理是真解决过真问题的。**
   `scalar()` 里「整行只有 `#` ⇒ 空值」那段——在它之前
   `confirmed_by:            # 确认人（姓名/邮箱）` 会被解析成非空字符串，
   于是「confirmed 必须记名」被一个注释骗过去（九份模板全长这样）。
   `checkTimestamp()` 对日期做**回环校验**（`2026-02-30` 在 V8 里会悄悄滚到 3 月 2 日，
   只查 `isNaN` 会放过一个不存在的日子）。这两处都不是想象出来的防御。

7. **空 `covers` 判红是故意的，而且现在正确地打在 `asset-governance` 上。**
   `auditSignoff` 对空 covers 的失败文案逐字解释了为什么不能放行
   （「会因为集合为空而**平凡为真**，读起来像绿灯」）并明确禁止「为了消红而随手填一个 feature 编号」。
   我实测它就是当前 phase-01 的两条红之一。**这是纪律 10 被正确落地的一例。**

8. **RLS 面是三类容器里唯一真正 kind-agnostic 且已被门控覆盖的一面。**
   `projects_tenant` 策略（`0003-identity.sql:143-161`）只按 `org_id`；
   `verify-rls.sh:57-68` 是 catalog 推导（新表自动入网）+ `:74-75` 静态阈值防空转；
   `0014` 的冻结同样是 catalog 推导（我实测确认，见 A-13）且已有 catalog 断言 + 反证。
   **`0018` 只需在末尾调一次 `kernel_apply_org_freeze_policies()`。**
   注意：这里对的是**设计**，错的是描述它的 `MIGRATION-IMPACT.md` §3.2①。

9. **`MIGRATION-IMPACT.md` 的多数事实核对是准的。** 7 条外键的数量正确、
   「一条不改」正确、6/7 条行号正确；触发器两处行号正确且 D 之下继续成立的推理正确；
   4 处 `INSERT INTO projects` 完整无遗漏；`verify-rls.sh` 的 catalog 推导与静态阈值
   两条判断正确；`0018` 是下一个可用序号正确；`stage.*` 14 处 / 4 文件**精确命中**；
   后端层 7 文件 39 处、测试层 6 文件 54 处逐文件计数全部命中；
   `kind DEFAULT 'workshop'` 会静默污染这条推理成立。
   它的问题集中在**写作时点早于 U-1…U-9 裁决**（A-19）与 §3.2①（A-13）、
   幻影表（A-12）三处，不是整份不可信。

10. **phase-00 `identity` 的多数不变量在裁决 D 下不破，我逐条核过。**
    I-1（`acl_bindings` 的 subject 与 object 同组织）不破：`0006:332`
    `SELECT org_id FROM projects WHERE id = NEW.object_id`——三类都是 `projects` 行。
    I-4/I-5/I-6（RLS）不破且三张子表自动入网。I-7（最严交集）不破：
    `strictestScope`（`permission-decision.ts:145-154`）只处理 scope，与 kind 无关。
    **U-8 裁 B（`object_kind` 不加值）在数据完整性维度是对的**——破的是
    I-11/I-P9/O-03 那三条（A-6），且**只有 A-6 那一处**需要修订已签契约。

11. **`binding` 束并入 `artifact` 的判据是对的。** `contract-design.md` §一记的理由
    （只有 F06 一个 feature、共用 uc-0-1、其不变量**依赖** artifact 的不变量）
    正是「不变量互相依赖 ⇒ 必须同束」这条判据的正确应用。
    A-1 判 `asset-governance` 不成立，用的是同一条判据的同一个方向。

12. **`api-kernel` / `web-kernel` 走 ADR-023 第 ③ 件的第二形态是正当的。**
    `web-kernel/domain.md:130` 逐字「零后端、零 HTTP、零 mock 生成、零 OpenAPI」。
    P-2 判 phase-01 九束为缺陷，依据是它们**既无契约文件也无这类声明**——
    正是 ADR-023 说「不接受」的沉默第三种情况，不是对第二形态的否定。

13. **`.harness/scripts/**.test.ts` 已接进 CI。** `harness-verify.yml` 里
    `pnpm exec vitest run --dir .harness` 存在，注释还记着「2026-07-30 发现 100+ 条断言
    CI 里一条都没跑过」。**那条已修，我核过，不是仍在的问题。**
    `CODEOWNERS` 也已含 `design-signoff.md` / `design-coherence.md` / `CODEOWNERS` 自身，
    handle 是真实的 `@usamshen`（不是占位符）。缺的只是 ADR-023 §五那条 CI 检查（P-10）。

---

## 本审计的盲区

1. **`packages/contracts/src/*.ts` 的审计已完成（C-1…C-26），但其中「不可达」多为静态推理。**
   `err` 码与 reason 枚举的双向差集、`in` 的 strict 性、`satisfies` 缺失、
   `PROJECT_FORBIDDEN_ROUTES` 零消费者这四类是**机械核实**的（见 CP-5）。
   而 C-1（`unarchiveProject` 实现不出来）、C-11 / C-12（二者必有一死）、
   C-17（`INVALID_KIND` 不可达）属于**按契约与迁移形状推理**——
   后端实现尚不存在，无法用运行时反证钉死。C-2 的「恒返回 0 也合规」同理。

2. **未跑 `apps/api` 测试套件**（需 Docker + PostgreSQL，在 `backend-gates.yml` 的自建 runner 上）。
   A-6 / A-14 / A-15 / P-13 的运行时行为是**按代码路径推演**的，不是实测的。
   P-13 的「空集空转」在逻辑上无歧义（`filter` 返回 `[]` ⇒ 循环体不执行），
   但我没有真跑一遍看它变绿。

3. **三张子类型表的 DDL 尚不存在**（`apps/api/migrations/` 止于 `0017-f17-local-export.sql`）。
   I-P34 复合外键判据、I-P36 的「ok 表 +3」、以及「`0018` 会不会调
   `kernel_apply_org_freeze_policies()`」三项只能按 `domain.md:157-170` 的示意 DDL 推演，**不能实测**。

4. **UIUX 与最终用户两个视角完全不在本审计内。** 428 张 `ui-preview/` 截图我一张没看，
   `apps/web` 没起过。`design-coherence.md:160-165` 关于 UI 签核就绪度的主张
   **无法验证**。七态、四视角、IA 一致性、可达性均未审。

5. **GitHub 分支保护是否勾了「Require review from Code Owners」，仓库内看不见。**
   `CODEOWNERS` 文件本身完整，但它「只能做到需要人类 review」这句话是否已生效，**无法验证**。

6. **我找的跨束约束不是「复核结果的差集」，因为复核根本没做。**
   A-4…A-11 是我按 `contract-design.md` 那四类（重复定义 / 不变量矛盾 / 级联不闭合 /
   错误语义不一致）自己扫出来的，覆盖面是 11 束的 `domain.md` + `usecases.md` +
   全部 `design-signoff.md` 的跨束约束表。**`coverage.md` 正文未逐份通读**——
   可能还有只登记在那里的缺口。这不是一份穷尽清单。

7. **工作树在审计期间被并发 agent 修改。** `contracts/asset-governance/` 从 1 个文件长到 5 个，
   `design-coherence.md` / `CODEOWNERS` / `feature_list.json` /
   `packages/contracts/{src/index.ts,tests/*}` 均在中途变为 `M`。
   本报告所有行号与计数以 **2026-07-30T10:44:00Z** 为准，`asset-governance` 相关结论
   （A-1 / A-3）尤其可能已被那个 agent 推进。

8. **phase-02 / phase-03 未审。** 它们是 `has_ui: true` 且零契约束，
   按 ADR-023 决策一落地后应该判失败——我没有核这条对它们是否真的生效。

9. **`feature_list.json` 124 条对原型的覆盖度未审**（那是需求分析师视角）。
   我只核了它与束 `covers:` 的双向一致，没核「原型里真实存在的能力是否都有 feature」。
