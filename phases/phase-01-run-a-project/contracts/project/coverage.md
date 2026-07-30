# `project` 束 · UC 覆盖矩阵（**骨架**）

> **回答的问题**：契约定的接口，真的够跑通业务吗？
> 每条 R12 验收线索都要能指到「哪个 API 操作」与「哪个前端消费点」。
>
> ⚠ **本束目前没有任何 feature**（`design-signoff.md` 的 `covers: []`），
> 所以「API 操作」一列大量是「**待裁决 → Q-N**」——那不是偷懒，是**接口形状还不存在**：
> `createProject` 的入参、`listProjects` 的响应体、`agenda_segments` 是不是一张表，
> 全部卡在 `requirements/00-project/OPEN-QUESTIONS.md` 的 12 条上。
>
> ⚠ **不许为了让这张表好看而编一个接口名。** 编出来的接口名会被别的束当权威引用
> （ADR-020 立论的那类事故）。填「待裁决 → Q-N」是**诚实的空**，编一个名字是**假的满**。
>
> 前端消费点全部指向 `ui-preview/project/` 的 19 张真实截图对应的屏
> （代码在 `apps/web/app/project/page.tsx` + `apps/web/components/project/*`，**纯 mock 不接后端**）。

---

## 一、`00-project/uc-00-1-项目与议程环节的领域模型.md`

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 租户隔离：跨组织查 `projects` 返回 0 行 | 无 API 面（直连 SQL 断言 RLS） | —（数据层验收） | 可立即写 |
| V2 | 项目角色 CHECK 成员集逐个等于契约枚举 | 无 API 面（`pg_catalog` 断言） | —（数据层验收） | 可立即写 |
| V3 | 「无角色」与「无项目上下文」响应体可区分 | phase-00 `authorize` / `resolveIdentity`（已签核，本束只引用） | 项目工作台 · 无权限态（`uc-00-2-overview-denied.png`）+ 全局顶栏两层身份条 | 可立即写 |
| V4 | 反证 · `STEP_CLOSED` 双向（closed 拒 + open 通） | phase-00 `bindToProjectStep` + **本束待建的环节状态面**：待裁决 → Q-2① / Q-8 | 成果沉淀 · 绑定失败提示（`uc-00-3-results-default.png`） | 待裁决 → Q-2① |
| V5 | 反证 · `STEP_REJECTS_ARTIFACT_TYPE` 双向 | 同 V4，判据来源待裁决 → Q-2③ | 同 V4 | 待裁决 → Q-2③ |
| V6 | 同一项目内 `active` 环节至多一个（并发推进） | 待裁决 → Q-2②（建议做成 DB 部分唯一索引而非应用层规则） | 现场协作 · 主持台「下一环节」（`uc-5-1-live-default.png`） | 待裁决 → Q-2② |
| V7 | 临时提权按流程节点失效（正常/提前/跳过/合并四向 + 反向） | 待裁决 → Q-2②（失效由服务端在状态机变更时主动收回） | 项目工作台 · 视角说明条与只读投影（`uc-00-2-overview-observer.png`） | 待裁决 → Q-2② |
| V8 | 推进权限：`groupLead`/`member`/`observer` 均被拒 | phase-00 项目角色矩阵（已实现，本束**引用不得抄**） | 现场协作 · 非引导师视角下无「下一环节」按钮（`uc-5-1-live-observer.png`） | 可立即写 |
| V9 | `observer` 动作集合**恰好** `["read.published"]` | phase-00 项目角色矩阵 | 四个标签的观察者投影（`*-observer.png` 共 5 张） | 可立即写 |
| V10 | 审计：创建/推进/越权尝试可检索；`provenance_events` 的 UPDATE/DELETE 被拒 | phase-00 `provenance` 查询面（**不许另造**，I-P3） | 成果沉淀 · 审计与反馈区（`uc-00-3-results-default.png`） | 可立即写 |
| V11 | 幂等：同一创建请求重复提交只建出一个项目 | `createProject`：待裁决 → Q-1 | 新建项目流程（**本域截图未覆盖**，见 `ui.md` 第四节 #1） | 待裁决 → Q-1 |
| V12 | 组织冻结：写入被 PG 策略拒绝，读仍可用，界面显示只读原因而非隐藏 | phase-00 F22 组织生命周期（已实现） | 项目工作台 · 只读原因提示（**本域截图未覆盖**，见 `ui.md` 第四节 #4） | 可立即写（界面部分待补屏） |
| V13 | 无孤儿绑定（插入指向不存在环节的绑定失败） | 待裁决 → Q-8（加外键，新增 `0016-*` 不改已 passing 的 `0008`） | —（数据层验收） | **待裁前不写** |
| V14 | 命名单源：全仓 grep 断言败选名不再出现 | 门控测试（形如 `no-forbidden-routes.test.ts`），非 HTTP 面 | —（门控验收） | **半条现在就可写**：`agenda_stage` 已由 D-03a 判负；`stepId`/`stage.*` 改不改待裁决 → Q-3 第三节 |

## 二、`00-project/uc-00-2-项目列表与项目主页.md`

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 回流四字段非空 + 徽标 ∈ 三取值 | phase-00 `listBackflow`（`GET /projects/:projectId/backflow`，已签核已实现） | 成果沉淀 · 成果去向区（`uc-00-3-results-default.png`） | 可立即写 |
| V2 | 草稿不泄漏（非创建者查得 0 条；越权直读返回 404 而非 403） | phase-00 `listBackflow` + `readContent` | 成果沉淀 · 非创建者视角（`uc-00-3-results-observer.png`） | 可立即写 |
| V3 | 空态返回 `[]` 且响应体不含任何示例条目 | phase-00 `listBackflow` | 概览 · 空态（`uc-00-2-overview-empty.png`） | 可立即写 |
| V4 | 分层无权限：响应能区分「组织层拒绝」与「项目层拒绝」 | phase-00 `authorize`（两层交集判定） | 概览 · 无权限态（`uc-00-2-overview-denied.png`，逐字说明是**项目层**限制） | 可立即写 |
| V5 | 观察者可见集 ⊆ 已发布内容（不是「全部减去写按钮」） | phase-00 `authorize` + 本束的观察者投影：待裁决 → Q-6② | 五张 `*-observer.png` | 可立即写（投影范围待补） |
| V6 | 组织切换隔离：三条副作用逐条断言，缓存判定未被复用 | phase-00 `switchOrganization`（已签核，副作用已声明） | 全局顶栏组织切换器（`components/shell/*`，本域复用） | 可立即写 |
| V7 | 非项目页不泄漏 `role-bar-project` / `role-preview-switcher` / `topbar-project-context` | 无 API 面（`verify-ui-states.sh` 反向段） | 全局顶栏 —— ⚠ **本域已发现一处真实分歧**：`/project` 未被 `project-context` 认作项目页（`ui.md` 第四节 #2） | 可立即写（**先裁 #2**） |
| V8 | 分页：超过一页的回流条目断言分页或增量加载生效 | phase-00 `listBackflow`（分页参数形状待确认） | 成果沉淀 · 成果去向区 | 可立即写 |
| V9 | 依赖失败与空列表**可区分**（不得把失败呈现为空） | phase-00 `listBackflow` 的错误出口 | 概览 · 依赖失败态（`uc-00-2-overview-dep-failed.png`，含重试） | 可立即写 |
| V10 | 列表口径（返回谁的项目、是否两段式） | `listProjects`：待裁决 → Q-6①（⚠ 契约里**目前不存在** `GET /projects`） | 全部项目列表屏（**本域截图未覆盖**，`ui.md` 第四节 #1） | **待裁前不写** |
| V11 | 准备度百分比 | 待裁决 → `uc-2-2:419-420` 的 `[待确认]`（口径不定不得给分母） | 概览**刻意未用**准备度，改用口径明确的「就绪检查 3/3」（`uc-00-2-overview-default.png`） | **待裁前不写，界面亦不显示** |

## 三、`00-project/uc-00-3-项目成员与两层角色交互.md`

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 第五种项目角色被 DB CHECK 拒绝，且成员集逐个等于契约枚举 | 无 API 面（`pg_catalog` 断言） | 设置 · 参与者与邀请（`uc-2-2-settings-default.png`，身份四选） | 可立即写 |
| V2 | 一人一项目一角色（写第二行主键冲突） | 无 API 面（DB 断言） | 设置 · 已在册名单 | 可立即写 |
| V3 | 四格交叉逐格断言（第 ④ 格 `lead` 自建未加入待裁） | `authorize` 三格已定；第 ④ 格待裁决 → Q-4② | 设置 · 参与者与邀请 + 概览无权限态 | 前三格可写，**第 ④ 格待裁前不写** |
| V4 | 管理员不是超级用户；`purpose:"audit"` 则**放行且 `provenanceEventId` 非 null** | phase-00 `readContent`（⚠ 断言方向被 **O-04** 反转过，照旧稿写 `expect(403)` 会写出错误方向的绿灯） | 成果沉淀 · 审计与反馈区 | 可立即写 |
| V5 | `audit` 不豁免组织层（不在该团队的 admin 仍被拒） | phase-00 `readContent` | —（API 层验收） | 可立即写 |
| V6 | 个人层只出计数（响应 JSON **不存在** content/body/text/excerpt/preview/snippet 任一键） | phase-00 `getPersonalLayerSummary`（需 `out.safeParse()` 反向断言） | —（API 层验收） | 可立即写 |
| V7 | 角色变更**下一次请求**即生效（不等会话过期、不等缓存 TTL） | 待裁决 → Q-4③（不缓存跨请求判定 vs 缓存失效广播） | 设置 · 角色下拉即时生效 | 待裁决 → Q-4③ |
| V8 | 临时提权按流程节点失效 · 四向 + 反向反证 | 待裁决 → Q-2②（状态机变更时服务端主动收回） | 视角说明条与只读投影（`*-observer.png`） | 待裁决 → Q-2② |
| V9 | 不一致即拒（指向已停用组织成员的项目角色按拒绝处理并告警） | phase-00 `authorize` + F22 组织生命周期 | 设置 · 名单状态标注（「已确认 / 邀请已发 2 天」） | 可立即写 |
| V10 | 防枚举：对存在与不存在的 id 两次响应**不可区分**，且两次都写越权审计 | phase-00 `authorize` / `readContent` | —（API 层验收） | 可立即写 |
| V11 | 审计可检索（授予/变更/移除/临时提权）；`provenance_events` UPDATE/DELETE 被拒 | phase-00 `provenance` 查询面 | 成果沉淀 · 审计与反馈区 | 可立即写 |
| V12 | 组织置 `disabled` 后改成员被 PG 策略拒绝 | phase-00 F22 组织生命周期 | 设置 · 只读投影 | 可立即写 |
| V13 | 展示别名不落库（「协同引导师」入库值是 `facilitator`，无 `co-facilitator` 字样） | `addProjectMember`：入口归属待裁决 → Q-4①（DB 侧断言现在就能写） | 设置 · 身份四选（`uc-2-2-settings-default.png`） | 可立即写（DB 侧） |

---

## 四、本束的覆盖缺口（诚实登记，**不假装覆盖**）

| # | 缺口 | 为什么现在补不上 |
|---|---|---|
| **G-1** | **没有任何 feature**，因此上表没有一行能落到 `feature_list.json` 的 `verification` | 12 条裁决未完成 → requirement-author 不能生成 feature。见 `design-signoff.md` 顶部醒目块 |
| **G-2** | **`GET /projects` 在契约里不存在** | 形状被 Q-6① 卡着。⚠ 这意味着「项目列表」这块屏**今天没有任何后端面**，`uc-00-2:195` 已明写「Q-6 裁决前不要为项目列表生成 feature」 |
| **G-3** | **两个已签失败码今天不可评估** | `steps` 表不存在（I-P16）。⚠ 迁移注释已拒绝用「永远说 open 的可空查表」假装覆盖 |
| **G-4** | **「项目成员名单本身怎么形成」在全仓没有归属** | 「怎么发邀请」有归属（`01-auth`），「名单怎么形成」没有 → Q-4 |
| **G-5** | **项目生命周期在九束契约里一次都没出现** | 各束出现的「归档」全是蓝本 / 模板 / skill / 对话的归档，**不是项目** → Q-5 |
| **G-6** | **`QueryContext.projectIds` 不按项目状态过滤** | 若项目可归档，这是一个**真实的检索面缺口**（跨束，见 `design-signoff.md` 的 X-18） |
