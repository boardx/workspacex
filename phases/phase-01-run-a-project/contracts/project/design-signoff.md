---
bundle: project
phase: "01"
# ⚠ 空列表是**故意的**，不是漏填。本域在 feature_list.json 里目前**没有任何 feature**
#   （估 8–10 个 / 32–40 点，待 OPEN-QUESTIONS 的 12 条裁决完成后由 requirement-author 生成）。
#   空 `covers:` 会让 auditSignoff 报红，那正是我们要的——见正文顶部的醒目块。
covers: []
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:             # 确认人（姓名/邮箱）
confirmed_at:             # ISO 8601，且不得晚于签核当下
---

# 契约束 `project` 设计签核（第 10 个束）

> ## 🔴 本束**现在不可签核**。请不要把 `status` 改成 `confirmed`。
>
> 理由不是材料没写完，是**签核对象还不存在**：
>
> - `phases/phase-01-run-a-project/feature_list.json` 里**没有任何属于本域的 feature**。
>   全仓 111 个 feature 分给了前九个束（F03–F115），本域是 0 个。
> - 本域的 feature 生成被 `requirements/00-project/OPEN-QUESTIONS.md` 的 **12 条裁决**卡住：
>   项目怎么创建（Q-1）、议程环节是不是一张表（Q-2）、项目实体上有没有父子/类型维度（Q-12）
>   ——**这三条不定，连「项目」这张表有几列都写不出来**，更写不出可执行的 `verification`。
> - 因此 frontmatter 的 `covers:` 是 `[]`。
>
> **`covers: []` 会让 `pnpm exec tsx .harness/scripts/verify-uc-coverage.ts 01` 报红**，
> 报错逐字为「声明了 `covers: []`（空）—— 一个不覆盖任何 feature 的束不成立，**因此它不可签核**」。
> **这条红是本束的正确状态**，不是待修的故障。
>
> ### 为什么宁可红，不肯不建这个束
>
> 不建束 = 本域的设计**不在任何签核范围内**，将来它的 feature 生成出来时会落进
> 「不属于任何契约束」，`assertDesignSignedOff` 直接拒绝——那时才发现要补束，
> 而那时 UI 与 API 形状已经被别人顺手创造出来了（ADR-020 的立论）。
> 建束 + 报红 = **缺口是可见的、有名字的、会在每次 `doctor` 里出现的**。
>
> ### 解除这条红的唯一路径（顺序不可颠倒）
>
> 1. 人类裁决 `requirements/00-project/OPEN-QUESTIONS.md` 的 12 条
>    （其中 **Q-3 已降级为确认动作**，见该文「已有答案」列）。
> 2. **requirement-author** 读 `00-project/uc-00-1/2/3` + 裁决结果 → 生成本域 feature
>    并写进 `feature_list.json`（它是唯一有权改清单的角色）。
> 3. 有人把生成出来的 feature 编号填进本文件 frontmatter 的 `covers:`。
> 4. 补齐本目录 `usecases.md` / `coverage.md` 里所有「待裁决 → Q-N」的留白。
> 5. **然后**人类才逐节核对下面三件并签核。
>
> ⚠ **不要为了消红而随手填一个 feature 编号。** 那是把「还没有 feature」谎报成
> 「已经评审过这些 feature」，比现在这条红糟得多。

覆盖 feature：**（无 —— 待生成，估 8–10 个 / 32–40 点）**
依据 UC：`00-project/uc-00-1 项目与议程环节的领域模型` · `uc-00-2 项目列表与项目主页` ·
`uc-00-3 项目成员与两层角色交互`
支撑考证：`requirements/00-project/DERIVED-FROM-CONTRACTS.md`（已签核契约定死了什么，**权威在那份文件**）
待裁清单：`requirements/00-project/OPEN-QUESTIONS.md`（12 条）
UI 材料：`ui-preview/project/`（19 张截图）+ `ui-preview/project/PROTOTYPE-ANSWERS.md`

## 这个束为什么现在才出现

九束的切分是在 `project` 域**被发现缺失之前**定的。缺失本身是这样发现的：

阶段名叫「能跑完一场项目」，而 `requirements/` 下 11 个模块 49 份 UC 里
**没有任何一份以「项目本身」为主题**；与此同时 phase-00 内核已经落地了一批项目形状的东西
（`projects` 表已存在、项目角色已是闭集、Artifact 已能绑到「项目环节」上、
`/projects/:projectId/backflow` 是真实路由）。
即：**内核已经把产出绑到「项目环节」上，而系统里没有任何东西定义
「环节是什么、项目怎么创建、谁在里面、它怎么结束」。**

⇒ 本束的存在理由不是「再切一块能力」，是**把一个已经在被引用、但从未被定义的实体收进签核范围**。

## 这个束为什么这样切

按**能力域**切，边界是「**项目实体与议程环节实体本身**」，而不是「项目里发生的事」：

- **在本束内**：项目的创建与身份（Q-1 / Q-12）、议程环节实体与状态机（Q-2 / Q-3 / Q-8）、
  项目成员名单的形成与两层角色交叉（Q-4）、项目生命周期（Q-5 / Q-9）、
  项目列表与项目主页的读取面（Q-6 / Q-10 / Q-11 / Q-7）。
- **不在本束内**：项目里各能力域自己的事——套蓝本的六类初始化在 `templates`、
  现场转录在 `recording`、分组画布在 `canvas`、访谈在 `interview`……
  本束只提供它们共同依赖的**挂载点**。

⚠ **这是一个「被六个束依赖、自己却是空的」束。** 六个束已经把议程环节当既有挂载点用：
`agent-runtime`（载入触发源）、`canvas`（白名单）、`files`（N-4 有 information_schema 断言）、
`templates`、`skills`、`interview`。它们的 feature（F05 F16 F19 F26 F27 F31 F63 F64 F81 F102）
已经在环节上排工，而**环节实体本身没有任何 feature**。
⇒ **本束不签，那六个束的挂载点就是悬空的**；本束一签，它们才有地基。
这也是本束应当**优先**被解锁的原因。

---

## ① UI —— 人看到的界面对不对

材料：本束 [`ui.md`](./ui.md) → `ui-preview/project/` 的 **19 张真实截图**
（`next dev`、视口 1360×900、deviceScaleFactor 2 抓的真实组件，不是设计稿；抓图时 0 条控制台报错）。

**⚠ 本域是九个域里 UI 材料**最完整**的之一——但仍不可签核，原因见顶部醒目块（无 feature 可覆盖）。**

第 ① 件的待确认项**全部**来自 `ui-preview/project/PROTOTYPE-ANSWERS.md` 与
`ui-preview/project/README.md` 第三、五节自报的「原型未覆盖 / 无法自洽」，逐条列在
[`ui.md`](./ui.md) 第四节。**签核时请以 `ui.md` 第四节为清单**，不要在这里再抄一遍
（同一事实两处声明是本仓头号失败模式）。

其中**必须先裁才能签 ① 件**的三条：

- [ ] **Q-12 的第五种形状**：原型是「项目挂父项目」的父子归属，**不是 `kind` 维度**。
      请确认这是数据模型（项目自引用外键）还是仅 UI 措辞。
      → `OPEN-QUESTIONS.md` **Q-12**（候选 **E**）。**它决定整个 project 实体的形状，也决定 itv 的范围模型。**
- [ ] **`/project` 要不要纳入 `project-context`**：全局顶栏说「不在项目上下文中 · 项目角色不适用」，
      而工作台顶头又显示满满的项目身份——**两处对「我在不在项目里」给了相反答案**。
      这是真实的信息架构分歧，不是样式 bug（`ui-preview/project/README.md` 第三节 #2）。
- [ ] **议程环节字段名**：UI 已显示中文、testid 用中性名 `agenda-item-*`。
      → **Q-3 已由 D-03a 定为 `agenda_segment`**，此处只需确认「testid 是否随之改名」。

---

## ② 用例 —— 用例接口与失败模式穷举对不对

材料：本束 [`usecases.md`](./usecases.md)（**骨架**，凡待裁项写「待裁决 → OPEN-QUESTIONS Q-N」）。
支撑：本束 [`domain.md`](./domain.md)（不变量，**每条都指回 `DERIVED-FROM-CONTRACTS.md` 的 D-N**）。

⚠ **`usecases.md` 现在是骨架而不是定稿**，因为用例的**输入形状**取决于 Q-1 / Q-2 / Q-12：
`createProject` 的入参有没有 `blueprintVersionId?`、有没有 `parentProjectId?`，
`advanceSegment` 操作的是一张表还是一段 JSON——三条都还没答。
**在这些留白被填上之前，第 ② 件不具备签核条件。**

### 签核前请重点确认（不依赖裁决、现在就能看的部分）

- [ ] **本束不得重新讨论「环节要不要有状态」这个前提**——它已经签核过了
      （`stage.advance` 在已实现的闭集动作词表里，源自 UC-0.3 R5）。
      本束只讨论**状态机长什么样**。见 `domain.md` I-P9。
- [ ] **两个失败码的反证是硬要求**。`STEP_CLOSED` / `STEP_REJECTS_ARTIFACT_TYPE` 在已签契约里，
      而迁移注释逐字记着它们今天「not evaluable by anything in this repository today」，
      并拒绝用「一个永远说 open 的可空查表」假装覆盖：
      > a check that cannot fail is worse than an absent one, because it reads as coverage.

      ⇒ 本束交付它们时**必须同时交双向断言**（closed 环节拒绝 **且** open 环节通过）。
      单向断言会让「永远返回 STEP_CLOSED」的实现全绿。见 `usecases.md` 的 V4 / V5。
- [ ] **「无项目角色」是正常状态，且必须与「无项目上下文」可分辨**——两者禁止合并成一个值
      （合并会让前端分不清「不是项目页」与「是项目页但你没权限」）。见 `domain.md` I-P6 / I-P7。
- [ ] **管理员不是超级用户，但 `purpose: "audit"` 是放行 + 留痕，不是 403**。
      ⚠ 这个断言方向被 **O-04** 反转过一次；照旧稿写 `expect(403)` 会写出一个
      **断言错误方向的绿灯**。见 `usecases.md` V4/V5 与 `uc-00-3` R12。
- [ ] **项目级审计通道已存在，本束不许另造一套**（`provenance` 的 `kind` 已含 `project`，
      且有专门事件类型 `admin-project-access`）。见 `domain.md` I-P3。

---

## ③ API 契约 —— 对外形状与错误码对不对

**本束有对外 HTTP 面。** 第 ③ 件的落点将是：

```
packages/contracts/src/project.ts        ← 尚未创建，且**现在不该创建**
apps/api/migrations/00NN-project-*.sql   ← 尚未创建
```

⚠ **现在不该创建 `project.ts`，因为它的第一行就要在三个未裁决的分叉上二选一：**

| 未裁决项 | 它决定 `project.ts` 的什么 |
|---|---|
| **Q-12**（`kind` / 两外键 / 两表 / 无维度 / **父子**） | `Project` schema 上有没有 `parentProjectId` 或 `kind`；以及**权限投影有几套** |
| **Q-1**（创建路径） | `createProject.in` 有没有 `blueprintVersionId?`；创建事务有一处还是两处 |
| **Q-2①**（环节是不是一张表） | 有没有 `AgendaSegment` 实体与 `agenda_segments` 表；两个失败码可不可判 |
| **Q-5**（生命周期） | `Project` 上有没有 `status`；有没有 `archiveProject` 操作 |
| **Q-6①**（列表返回谁的） | `listProjects.out` 是一个数组还是**两段**（「我在里面」/「我管着它」） |
| **Q-10**（无项目内容怎么读） | 要不要把 phase-00 `readContent.in.projectId` 放开为 nullable（**改已签核束**） |

⇒ 先写 schema 再等裁决 = 写一份注定要改的单源，而**它一落地就会被别的束当权威引用**。

### 签核前请重点确认

- [ ] **本束必须复用、不得新造的四样东西**（每样都已签核并已实现）：
      ⑴ `acl_bindings` 三种 object 粒度闭集（`project` / `artifact` / `segment`）；
      ⑵ 项目角色四种枚举与 `project_role` CHECK；
      ⑶ `provenance` 的项目审计通道；
      ⑷ 项目角色的 15 条闭集动作词矩阵（`project-role-matrix.ts`，且该文件自己声明
      「将来要**移进** `packages/contracts` 而不是复制一份」——本束若需要它，**必须引用不得抄**）。
      见 `domain.md` I-P2 / I-P5 / I-P3 / I-P9。
- [ ] **错误码跨束同码同义**：`NO_PROJECT_ROLE` / `ADMIN_NOT_SUPERUSER` /
      `PROJECT_ROLE_INSUFFICIENT` / `STEP_CLOSED` / `STEP_REJECTS_ARTIFACT_TYPE`
      必须与 phase-00 `identity` / `artifact` 束**同码同义**，不得在 `project.ts` 里另起一份名字。
- [ ] **响应体也要被契约校验**。本束的观察者投影与「个人层只出计数」都是**减字段**——
      若只校验请求体，服务端多下发一个字段**不会有任何门控变红**（前端类型也从同一份契约生成）。
      需要 `out.safeParse()` 的**反向断言**。
- [ ] **`GET /projects` 目前在契约里不存在**（`packages/contracts` 里 `/projects` 只出现于
      backflow 一处）。它是本束要**新造**的第一个路由，其形状被 Q-6① 卡着。
- [ ] **`DELETE /projects/*` 若裁决为「不提供」，需要一条断言守着它不存在**——
      照抄 N-5 的做法（「『没有』这件事本身没人会去验」）。见 `usecases.md` 与 Q-9。

---

## 本束与哪些束有交叉约束（留给阶段一致性复核）

| # | 交叉点 | 对方 | 为什么必须在复核时看 |
|---|---|---|---|
| **X-6** | **议程环节（`agenda_segment`）是谁的**：绑定挂载点 / 三视角首屏切换驱动源 / 临时提权失效锚点 | `templates` · `canvas` · `skills` · `org-admin` · `agent-runtime` · `files` · `interview` | 阶段 `design-coherence.md` 的 X-6 已记「它既不在 `org-admin` 也还不存在」。**本束就是它的归属答案。**⚠ 六个束的 feature 已在环节上排工——本束不定，它们的挂载点悬空 |
| **X-3'** | **字段名单源**：`agenda_segment` 已由 **D-03a** 定稿并有机械门控（`files` 束 N-4），但 `templates` 束仍有 **2 处**写旧名 `agenda_stage`（`domain.md:25` 两名并列、`ui.md:123`） | `templates` · `files` · phase-00 `artifact`（`stepId`） | 这是**第七次「同一事实两处」已经开始的样子**。⚠ 复核时还要处置 phase-00 的 `stepId` / `stage.*` 改不改（**修订已签核束**）→ `OPEN-QUESTIONS.md` Q-3 第三节 |
| **X-15** | **父子项目（若 Q-12 裁 E）与 I-7 / I-13 的方向冲突** | phase-00 `identity` · `artifact` · phase-01 `interview` | 原型那句「挂到哪个项目（**决定能读哪些洞察与图谱**）」字面要的是**沿父子边放宽读范围**，而 I-7 逐字「取所有来源中最严格的一档（不是最宽松，也不是并集）」、I-13「只收紧不放宽」。**二者必有一个要改**，这是签核动作 |
| **X-16** | **项目归档（若 Q-5 裁 B）与 X-4 豁口边界** | phase-00 `artifact`（I-11 / X-4） | 「归档不删除任何内容」这句话本身就是 X-4 豁口的正确一侧——豁口只留给**合规撤回**，不该被「项目结束」借道。⚠ 且 X-4 依赖 **O-39 法定留存清单**，那份清单**不存在** |
| **X-17** | **`readContent.in.projectId` 非空 vs `Artifact.projectId` 可空** | phase-00 `identity` · `artifact` · `context-pack` | 一条**已签核契约内部的紧张关系**：按字面，`projectId = null` 的 artifact 没有合法读取路径。→ Q-10 / Q-11 连带 1，**两条是同一个洞** |
| **X-18** | **`QueryContext.projectIds` 不按项目状态过滤** | phase-00 `context-pack` | 若项目可归档（Q-5 B），Context Pack 会不会召回归档项目的内容？现在没有任何地方说它要按状态过滤。**这是一个真实的检索面缺口** |
| **X-19** | **`groups` 挂哪一级 / `projects` 的级联删除路径** | phase-00 `identity`（`0003-identity.sql`） | `groups` / `project_memberships` / `acl_bindings` / `artifact_bindings` 全部 `ON DELETE CASCADE` 到 `projects`。若 Q-12 裁 E（自引用外键），**级联会多一条路径**；若 Q-9 裁「提供删除」，级联会静默清掉绑定行 |
| **X-20** | **保留 testid 清单是单源，本域 19 屏必须进那张表** | phase-00 `web-kernel` | `web-kernel` 的屏清单是手维护的，已被登记为漂移候选并注明「phase-01 屏数增长后风险放大」。本域一次加 7 个标签页 |

---

## 确认动作

⚠ **本束现在没有「确认动作」可做。** 见顶部醒目块：签核对象（feature）还不存在。

将来可签时的动作与其它束相同——人类逐节核对上面三节后，把 frontmatter 的 `status`
改为 `confirmed`，并填 `confirmed_by` / `confirmed_at`（ISO 8601，**不得晚于签核当下**）。

⚠ **这是人的动作，不是 agent 的。** agent 不得代劳，该字段受 CODEOWNERS + CI 保护
（ADR-023 决策五）。

⚠ 另需注意：本束是**第 10 个束**，它的加入意味着
`phases/phase-01-run-a-project/design-coherence.md` 的 `covers_bundles` 必须包含 `project`，
且**那份一致性复核要重做**（新增一个从没被复核看过的束，正是 ADR-023 背景 1 记录的爆点）。
`covers_bundles` 已补为十束，但复核本身仍是 `pending` —— **不要只改 `covers_bundles` 就当复核过了**。
