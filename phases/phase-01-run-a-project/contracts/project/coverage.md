# `project` 束 · UC 覆盖矩阵

> **回答的问题**：契约定的接口，真的够跑通业务吗？
> 每条 R12 验收线索都要能指到「哪个 API 操作」与「哪个前端消费点」。
>
> **2026-07-30 修订**：12 条裁决完成后重填。此前大量「待裁决 → Q-N」的格子现在有了落点；
> **仍未裁的九条（U-1…U-9，见 `domain.md` 第八节）保持留空并注明**。
>
> ⚠ **「feature」列现在全空，这是诚实的空。** 本束在 `feature_list.json` 里
> **仍然没有任何 feature**（`design-signoff.md` 的 `covers: []`）——
> 裁决完成后下一步才是 **requirement-author** 据裁决生成 feature。
> **不许为了让这张表好看而编一个 feature 编号或接口名**：编出来的会被别的束当权威引用
> （ADR-020 立论的那类事故）。填空是诚实的空，编一个名字是假的满。
>
> ⚠ 本表**双向都要查**：
> **正向**（第一~三节）= 每条 R12 → 哪个 API 操作、哪个前端消费点；
> **反向**（第四节）= 本束将新造的每个 API 操作 → 它凭哪条 UC / 哪条裁决存在。
> 只查正向会漏掉「凭空多出来的接口」——那正是 ADR-020 说的「后端契约在画界面时被顺手创造出来」。
>
> 前端消费点全部指向 `ui-preview/project/` 的 19 张真实截图对应的屏
> （代码在 `apps/web/app/project/page.tsx` + `apps/web/components/project/*`，**纯 mock 不接后端**）。

---

## 一、`00-project/uc-00-1-项目与议程环节的领域模型.md`

| V | 一句话 | API 操作 | 前端消费点 | 状态 | feature |
|---|---|---|---|---|---|
| V1 | 租户隔离：跨组织查 `projects` 返回 0 行 | 无 API 面（直连 SQL 断言 RLS）。⚠ 裁决后**三张子类型表同样入网**（I-P36，catalog 推导） | —（数据层验收） | 可写 | —（待生成） |
| V2 | 项目角色 CHECK 成员集逐个等于契约枚举 | 无 API 面（`pg_catalog` 断言）。⚠ 适用范围收窄为 `kind='workshop'` | —（数据层验收） | 可写 | —（待生成） |
| V3 | 「无角色」与「无项目上下文」响应体可区分 | phase-00 `authorize` / `resolveIdentity`（已签核，本束只引用） | 项目工作台 · 无权限态（`uc-00-2-overview-denied.png`）+ 全局顶栏两层身份条 | 可写 | —（待生成） |
| V4 | 反证 · `STEP_CLOSED` 双向（closed 拒 + open 通 + `skipped` 亦拒） | phase-00 `bindToProjectStep` + 本束新建的 `agenda_segments` 状态面（Q-2① A 已裁） | 成果沉淀 · 绑定失败提示（`uc-00-3-results-default.png`） | **裁决后可写** | —（待生成） |
| V5 | 反证 · `STEP_REJECTS_ARTIFACT_TYPE` 三向（拒 + 通 + 空白名单全通） | 本束 `setAcceptedSources`（UC-P8，Q-2③ 已裁） | 同 V4。⚠ 白名单控件**原型不存在**（`ui.md` B-4），第 ① 件需补画 | **裁决后可写** | —（待生成） |
| V6 | 同一工作坊内 `active` 环节至多一个（并发推进） | 本束 `advanceAgendaSegment`（UC-P7）+ **DB 部分唯一索引**（I-P44，Q-2② 已裁） | 现场协作 · 主持台「下一环节」（`uc-5-1-live-default.png`） | **裁决后可写** | —（待生成） |
| V7 | 临时提权按流程节点失效（正常/提前/跳过/合并四向 + 反向） | 本束 `advanceAgendaSegment` 的副作用：服务端在状态机变更时**主动收回**（Q-2② 已裁） | 项目工作台 · 视角说明条与只读投影（`uc-00-2-overview-observer.png`） | **裁决后可写** | —（待生成） |
| V8 | 推进权限：`groupLead`/`member`/`observer` 均被拒 | phase-00 项目角色矩阵（已实现，本束**引用不得抄**） | 现场协作 · 非引导师视角下无「下一环节」按钮（`uc-5-1-live-observer.png`） | 可写 | —（待生成） |
| V9 | `observer` 动作集合**恰好** `["read.published"]` | phase-00 项目角色矩阵 | 四个标签的观察者投影（`*-observer.png` 共 5 张） | 可写 | —（待生成） |
| V10 | 审计：创建/推进/越权尝试可检索；`provenance_events` 的 UPDATE/DELETE 被拒 | phase-00 `provenance` 查询面（**不许另造**，I-P3） | 成果沉淀 · 审计与反馈区（`uc-00-3-results-default.png`） | 可写 | —（待生成） |
| V11 | 幂等：同一创建请求重复提交只建出一个容器 | 本束 `createProject`（UC-P1，Q-1 C 已裁：**一条创建路径 + 可选蓝本参数**）。⚠ 幂等必须覆盖**两行写入**（`projects` + 子类型表） | 新建项目流程（**本域截图未覆盖**，`ui.md` C-2） | **裁决后可写** | —（待生成） |
| V12 | 组织冻结：写入被 PG 策略拒绝，读仍可用，界面显示只读原因而非隐藏 | phase-00 F22 组织生命周期（已实现） | 项目工作台 · 只读原因提示（**本域截图未覆盖**，`ui.md` C-3） | 可写（界面部分待补屏） | —（待生成） |
| V13 | 无孤儿绑定（插入指向不存在环节的绑定失败 + 指向存在环节的成功） | 本束新增迁移**加外键**（Q-8 裁「加」；⚠ 序号取 **`0018-*`**，`0016`/`0017` 已被 F13/F17 占用，**不改已 passing 的 `0008`**） | —（数据层验收） | **裁决后可写** | —（待生成） |
| V14 | 命名单源：全仓 grep 断言败选名不再出现 | 门控测试（形如 `no-forbidden-routes.test.ts`），非 HTTP 面 | —（门控验收） | **裁决后可全写**：Q-3 ① 裁「改名对齐」⇒ 三个败选名 `agenda_stage` / `step_id`·`stepId` / `stage.` 一并判负 | —（待生成） |

## 二、`00-project/uc-00-2-项目列表与项目主页.md`

| V | 一句话 | API 操作 | 前端消费点 | 状态 | feature |
|---|---|---|---|---|---|
| V1 | 回流四字段非空 + 徽标 ∈ 三取值 | phase-00 `listBackflow`（已签核已实现） | 成果沉淀 · 成果去向区（`uc-00-3-results-default.png`） | 可写 | —（待生成） |
| V2 | 草稿不泄漏（非创建者查得 0 条；越权直读返回 404 而非 403） | phase-00 `listBackflow` + `readContent` | 成果沉淀 · 非创建者视角（`uc-00-3-results-observer.png`） | 可写 | —（待生成） |
| V3 | 空态返回 `[]` 且响应体不含任何示例条目 | phase-00 `listBackflow` | 概览 · 空态（`uc-00-2-overview-empty.png`） | 可写 | —（待生成） |
| V4 | 分层无权限：响应能区分「组织层拒绝」与「项目层拒绝」 | phase-00 `authorize`（两层交集判定） | 概览 · 无权限态（`uc-00-2-overview-denied.png`） | 可写 | —（待生成） |
| V5 | 观察者可见集 ⊆ 已发布内容（不是「全部减去写按钮」） | phase-00 `authorize` + 本束观察者投影（服务端**不下发**，不是前端隐藏） | 五张 `*-observer.png` | 可写 | —（待生成） |
| V6 | 组织切换隔离：三条副作用逐条断言，缓存判定未被复用 | phase-00 `switchOrganization`（已签核） | 全局顶栏组织切换器（`components/shell/*`） | 可写 | —（待生成） |
| V7 | 非项目页不泄漏 `role-bar-project` / `role-preview-switcher` / `topbar-project-context` | 无 API 面（`verify-ui-states.sh` 反向段） | 全局顶栏 —— ⚠ **本域已发现一处真实分歧**：`/project` 未被 `project-context` 认作项目页（`ui.md` A-2，**12 条裁决未覆盖它**） | 可写（**先裁 `ui.md` A-2**） | —（待生成） |
| V8 | 分页：超过一页的回流条目断言分页或增量加载生效 | phase-00 `listBackflow`（分页参数形状待确认） | 成果沉淀 · 成果去向区 | 可写 | —（待生成） |
| V9 | 依赖失败与空列表**可区分**（不得把失败呈现为空） | phase-00 `listBackflow` 的错误出口 | 概览 · 依赖失败态（`uc-00-2-overview-dep-failed.png`，含重试） | 可写 | —（待生成） |
| V10 | 列表口径（返回谁的项目、是否两段式） | 本束 `listProjects`（UC-P2，**Q-6① B 已裁：两段式，`{member[], managed[]}`，不是混合数组加布尔**）。⚠ `GET /projects` 是本束**新造**的第一个路由 | 全部项目列表屏（**本域截图未覆盖**，`ui.md` C-1） | **裁决后可写** | —（待生成） |
| V11 | 准备度百分比 | **无 API 面**——口径未定（**U-6**，`uc-2-2:419-420` 的 `[待确认]`），**不得给分母** | 概览**刻意未用**准备度，改用「就绪检查 3/3」（`uc-00-2-overview-default.png`） | **待裁前不写，界面亦不显示** | —（待生成） |

## 三、`00-project/uc-00-3-项目成员与两层角色交互.md`

> ⚠ 本节全部条目的隐含前置是 **`kind = 'workshop'`**（Q-12 追加裁决：四种项目角色属工作坊）。
> 研究项目 / 用户洞察的成员模型 **U-1 待裁**，本节**不为它们写任何一行**。

| V | 一句话 | API 操作 | 前端消费点 | 状态 | feature |
|---|---|---|---|---|---|
| V1 | 第五种项目角色被 DB CHECK 拒绝，且成员集逐个等于契约枚举 | 无 API 面（`pg_catalog` 断言） | 设置 · 参与者与邀请（`uc-2-2-settings-default.png`，身份四选） | 可写 | —（待生成） |
| V2 | 一人一项目一角色（写第二行主键冲突） | 无 API 面（DB 断言） | 设置 · 已在册名单 | 可写 | —（待生成） |
| V3 | 四格交叉逐格断言（含第 ④ 格 `lead` 自建未加入） | phase-00 `authorize` 三格 + 第 ④ 格本束落地（**Q-4② 已裁：持管理权、不持内容读取权**） | 设置 · 参与者与邀请 + 概览无权限态。⚠ 第 ④ 格**原型从未演示**（`ui.md` B-5） | **裁决后可全写** | —（待生成） |
| V4 | 管理员不是超级用户；`purpose:"audit"` 则**放行且 `provenanceEventId` 非 null** | phase-00 `readContent`（⚠ 断言方向被 **O-04** 反转过，照旧稿写 `expect(403)` 是**错误方向的绿灯**） | 成果沉淀 · 审计与反馈区 | 可写 | —（待生成） |
| V5 | `audit` 不豁免组织层（不在该团队的 admin 仍被拒） | phase-00 `readContent` | —（API 层验收） | 可写 | —（待生成） |
| V6 | 个人层只出计数（响应 JSON **不存在** content/body/text/excerpt/preview/snippet 任一键） | phase-00 `getPersonalLayerSummary`（需 `out.safeParse()` **反向**断言） | —（API 层验收） | 可写 | —（待生成） |
| V7 | 角色变更**下一次请求**即生效（不等会话过期、不等缓存 TTL） | 本束 `changeProjectRole`（UC-P9，**Q-4③ 已裁：不缓存跨请求判定，只缓存单请求内的**） | 设置 · 角色下拉即时生效 | **裁决后可写** | —（待生成） |
| V8 | 临时提权按流程节点失效 · 四向 + 反向反证 | 本束 `advanceAgendaSegment` 副作用（Q-2② 已裁） | 视角说明条与只读投影（`*-observer.png`） | **裁决后可写** | —（待生成） |
| V9 | 不一致即拒（指向已停用组织成员的项目角色按拒绝处理并告警） | phase-00 `authorize` + F22 组织生命周期 | 设置 · 名单状态标注 | 可写 | —（待生成） |
| V10 | 防枚举：对存在与不存在的 id 两次响应**不可区分**，且两次都写越权审计 | phase-00 `authorize` / `readContent` | —（API 层验收） | 可写 | —（待生成） |
| V11 | 审计可检索（授予/变更/移除/临时提权）；`provenance_events` UPDATE/DELETE 被拒 | phase-00 `provenance` 查询面 | 成果沉淀 · 审计与反馈区 | 可写 | —（待生成） |
| V12 | 组织置 `disabled` 后改成员被 PG 策略拒绝 | phase-00 F22 组织生命周期 | 设置 · 只读投影 | 可写 | —（待生成） |
| V13 | 展示别名不落库（「协同引导师」入库值是 `facilitator`，无 `co-facilitator` 字样） | 本束 `addProjectMember`（UC-P9，**Q-4① B 已裁：两入口共用同一个 application 用例**） | 设置 · 身份四选（`uc-2-2-settings-default.png`） | **裁决后可全写** | —（待生成） |

---

## 四、反向：本束将新造的每个 API 操作，凭什么存在

> ⚠ 只查正向会放过「凭空多出来的接口」。下表每一行都要能指回**一条 UC 的 R12** 或**一条裁决**；
> 指不回去的，就不该存在。

| 将新造的操作 | 凭哪条存在 | 对应 R12 | 前端消费点 |
|---|---|---|---|
| `createProject` | Q-1 C（一条创建路径 + 蓝本可选参数）+ D-11（`lead` 职责逐字「创建与管理项目」） | uc-00-1 V11 | 新建项目流程屏（**未画**，`ui.md` C-2） |
| `listProjects`（`GET /projects`） | Q-6① B（两段式） | uc-00-2 V10 | 全部项目列表屏（**未画**，`ui.md` C-1） |
| `getProjectOverview` | Q-6②（只放已有出处的东西） | uc-00-2 V1–V9 | 概览 10 张截图 |
| `archiveProject` | Q-5 B（两态、只读、不删内容） | uc-00-1 V12 的同型（只读投影） | 列表卡片「已归档」标签（**行为未演示**，`ui.md` B-3） |
| ~~`unarchiveProject`~~ | **不存在** —— 归档是否可逆 **U-2⑴ 待裁**。⚠ 现在写它就是发明 | — | — |
| ~~`deleteProject`~~ | **不存在** —— Q-9 裁「不提供」。交付物是断言它不存在的测试 | uc-00-1 V15 类（`no-forbidden-routes`） | —（门控验收） |
| `createAgendaSegment` / `listAgendaSegments` | Q-2① A（独立表）+ O-02②（蓝本 ⊃ 工作流模板，引用而非内联） | uc-00-1 V4/V6/V13 | 项目筹备 · 议程环节三角色分工表（`uc-2-2-prep-default.png`） |
| `advanceAgendaSegment` | Q-2② B（四态 + `mergedInto`）+ D-9（动作词已在闭集里） | uc-00-1 V6/V7/V8 | 现场协作 · 主持台（`uc-5-1-live-default.png`） |
| `setAcceptedSources` | Q-2③（默认全接受 + **必须配反证**）+ Q-8（判据由本域给） | uc-00-1 V5 | **原型无此控件**（`ui.md` B-4）—— ⚠ 第 ① 件缺口 |
| `addProjectMember` / `changeProjectRole` / `removeProjectMember` | Q-4① B（两入口共用一个 application 用例）+ Q-4③ | uc-00-3 V7/V13 | 设置 · 参与者与邀请 |
| （**修改 phase-00**）`readContent.in.projectId` 放开为 nullable | Q-10 A —— ⚠ **不是本束的接口，是提给 phase-00 两束签核人的契约缺陷报告** | uc-00-2 V4 的邻接面 | —（API 层） |
| （**修改 phase-00**）`step_id`→`agenda_segment_id`、`stage.*`→`agendaSegment.*` | Q-3 B ① —— ⚠ **签核动作**，波及面见 `MIGRATION-IMPACT.md` | uc-00-1 V14 | —（全仓改名） |

**反向查出来的两条空缺**（正向表里看不出来的）：
- **非工作坊两类容器**（`research_projects` / `user_insights`）的**任何成员/角色接口都没有依据** → **U-1**。
  ⇒ 现在为它们造任何接口都是发明。
- **`kind` 判别列**（I-P34 用来保证 1:1）在**任何 UC 的 R12 里都没有出处** → **U-9**。
  ⇒ 它是本文为落地 D 而提出的机件，**必须在签核时被显式接受或否决**。

---

## 五、本束的覆盖缺口（诚实登记，**不假装覆盖**）

| # | 缺口 | 12 条裁决之后还剩什么 |
|---|---|---|
| **G-1** | **没有任何 feature**，上表没有一行能落到 `feature_list.json` 的 `verification` | ✅ 裁决已完成，阻塞解除了一半；剩下的是 **requirement-author 尚未生成 feature** |
| **G-2** | **`GET /projects` 在契约里不存在** | ✅ 形状已由 Q-6① B 定死（两段式）。剩：它仍是**待新造**的路由，且**列表屏未画**（C-1） |
| **G-3** | **两个已签失败码今天不可评估** | ✅ Q-2① A + Q-8 已裁「建表 + 加外键 + 双向反证」。剩：**尚未实现**，且白名单控件在原型里不存在（B-4） |
| **G-4** | **「项目成员名单本身怎么形成」在全仓没有归属** | ✅ Q-4① B 已给归属（两入口共用一个 application 用例）。剩：**仅工作坊**，另两类 → **U-1** |
| **G-5** | **项目生命周期在九束契约里一次都没出现** | ✅ Q-5 B 已裁两态只读。剩：**四个连带行为全空** → **U-2** |
| **G-6** | **`QueryContext.projectIds` 不按项目状态过滤** | ⚠ **仍然是洞**：归档既已成立，这条就从假设变成了真缺口 → **U-2⑷**（跨束 X-18） |
| **G-7**（新） | **三张子类型表的形状只定了「工作坊」一张** | 研究项目 / 用户洞察的字段与成员模型 → **U-1**。⚠ 本束**不发明**它们 |
| **G-8**（新） | **`ui.md` A-2（`/project` 是不是项目上下文）不在 12 条之内** | 它是第 ① 件的阻塞项，12 条裁决**没有覆盖它**，签第 ① 件前仍须裁 |
