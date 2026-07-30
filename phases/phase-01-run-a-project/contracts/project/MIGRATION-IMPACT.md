# `project` 束 · 迁移影响面 —— **12 条裁决会回头改哪些已合入 `main` 的东西**

> **为什么单独一份文件。** 2026-07-30 的 12 条裁决里有两条**不是「往前做新东西」，是「回头改旧东西」**：
>
> - **Q-12 连带 4 裁 D**：`projects` 的**语义**从「工作坊」变为「容器超类型」——
>   这是**修订 phase-00 已签核的 `identity` 束**（`status: confirmed`，
>   `confirmed_by: yanbin shen`，`confirmed_at: 2026-07-29T07:35:09+08:00`，覆盖 F01 F02 F03 F15 F16 F17）。
> - **Q-3 B 裁 ①「改名对齐」**：`step_id`/`stepId` → `agenda_segment_id`，`stage.*` → `agendaSegment.*`——
>   这是**修订 phase-00 已签核的 `artifact` + `identity` 两束**（`artifact` 覆盖 F04 F05 F06 F07 F08）。
>
> ⚠ **两条都是签核动作，不是实现细节。** 本文**只登记影响面与风险**，
> 不改任何代码、不建任何迁移、不改任何 `*-signoff.md` 的 `status`。
>
> 风险分级：🔴 高（会改到已 passing 的行为或已签核语义）· 🟠 中（会改到测试夹具或生成物）·
> 🟡 低（文案 / 注释 / 文档）。
> ⚠ **注意第三节**：本文认为**最危险的不是会变红的那些**。

---

## 一、`projects` 语义变更（Q-12 C + 连带 4 D）

### 1.1 好消息先说：**7 条外键一条不改**

这是候选 D 被选中的首要理由。逐条核实（`grep -n "REFERENCES projects" apps/api/migrations/*.sql`）：

| # | 引用方 | 位置 | 删除动作 |
|---|---|---|---|
| 1 | `groups.project_id` | `0003-identity.sql:43` | `ON DELETE CASCADE` |
| 2 | `project_memberships.project_id` | `0003-identity.sql:62` | `ON DELETE CASCADE` |
| 3 | `admin_project_access.project_id` | `0005-f03-admin-boundary.sql:38` | `ON DELETE CASCADE` |
| 4 | `artifacts.project_id` | `0006-f04-artifact-model.sql:61` | `ON DELETE SET NULL` |
| 5 | `artifact_bindings.project_id` | `0008-f06-binding-modes.sql:44` | `ON DELETE CASCADE` |
| 6 | `segment_text.project_id` | `0009-f10-retrieval-index.sql:163` | `ON DELETE SET NULL` |
| 7 | `claims.project_id` | `0009-f10-retrieval-index.sql:328` | `ON DELETE SET NULL` |

⇒ D 下三类容器**都是 `projects` 行**，这 7 条引用**逐条继续成立**。
（候选 B「多态 `owner_kind + owner_id`」会让这 7 条**全部失去外键**，
候选 C「三张平行表」会让它们**各需一份**。这就是 D 的价值所在。）

### 1.2 会被动到的：`acl_binding_same_org()` 触发器 —— 🟡 低（**不改，但必须加断言**）

`0003-identity.sql:122-128` 与 `0006-f04-artifact-model.sql:331-344`：

```sql
IF NEW.object_kind = 'project' THEN
  SELECT org_id INTO object_org FROM projects WHERE id = NEW.object_id;
```

⇒ 在 D 下**继续成立**（三类的容器行都在 `projects` 里）。
⚠ 但「继续成立」是**推理**不是**证据**。要求补一条测试：三类各建容器、各授一条
`object_kind='project'` 的 ACL，断言**三条都通过同一触发器**。
没有它，「D 不破 I-1」只是一句话。

### 1.3 会被动到的：`acl_bindings.object_kind` 闭集 —— 🟠 中（**方向未定**）

- `0003-identity.sql:80`：`CHECK (object_kind IN ('project','artifact','segment'))`
- 契约侧同形：`packages/contracts/src/identity.ts:383`、`:412-413`

**Q-12 连带 1 说要加 2 个值；Q-12 连带 4 的 D 使这件事不必要**（三类都是 `project`）。
两条连带写于同一天，**先后关系没有写明**。
⇒ 登记为 `domain.md` 第八节的 **U-8**，并在 `design-signoff.md` ③ 节列为签核时必须点头的一条。
⚠ **本文按「D 覆盖连带 1」处理**（不加值），但**这是本文的判断，不是裁决**。

### 1.4 🔴 **最高风险的一条：`projects` 加 `kind` 与 `status` 两列，怎么加决定它会不会静默**

`kind`（判别列，I-P34）与 `status`（Q-5 B）都要加到 `projects` 上。加法有两种：

| 写法 | 后果 |
|---|---|
| `kind text NOT NULL` **无默认值** | 所有现存的 `INSERT INTO projects (id, org_id, name)` **立刻编译/运行失败** ⇒ **会变红** ⇒ 有人去看 |
| `kind text NOT NULL DEFAULT 'workshop'` | 一切**保持全绿**，同时**把全部历史项目静默判定为工作坊** ⇒ 没有任何东西报警 |

⚠ **本文强烈建议第一种**，理由不是洁癖：第二种正好是本仓九次「全绿但空转」的形状——
一个语义变更（`projects` 不再默认是工作坊）被一个默认值抹平，**而抹平这件事没有任何门控看得见**。

**会因此变红的地方（这是好事，逐条列出便于评估工作量）**：

| 文件 | 行 | 内容 |
|---|---|---|
| `apps/api/tests/support/db.ts` | `:215` | `INSERT INTO projects (id, org_id, name) VALUES ($1,$2,$3)` —— **中央夹具，一处改全仓生效** |
| `apps/api/tests/auth/org-disabled-readonly.test.ts` | — | 直接插 `projects` |
| `apps/api/tests/kernel/backflow-list-fields.test.ts` | — | 直接插 `projects` |
| `apps/api/tests/kernel/rls-cross-tenant-zero-leak.test.ts` | — | 直接插 `projects` |

⇒ **4 处**，其中 1 处是中央夹具。工作量小，**信号价值大**。

### 1.5 三张新表进 RLS 网 —— 🟠 中（**自动，但要断言它真的自动了**）

`apps/api/scripts/verify-rls.sh:57-80`：`kernel_tenant_table_audit()` 从 `pg_catalog`
推导租户表，「a table added next month is in scope without anyone updating a list」。
⇒ `workshops` / `research_projects` / `user_insights` **自动入网**，
三张表若缺 `org_id` 或缺策略，`verify-rls.sh` **直接变红**。这是设计好的。

⚠ 但同一脚本 `:71-75` 有一条非空转检查：`ok_tables >= 8`。
**建这三张表后它仍然会满足**，所以「新表被判成 `exempt-*` 而没人发现」这条路**没被堵住**。
⇒ 要求补断言：`verdict='ok'` 的表计数**比建表前多 3**。

### 1.6 已 passing 的 feature 影响评估

| feature | 束 | 影响 | 等级 |
|---|---|---|---|
| **F01**（两层角色 → `acl_bindings`） | identity（已签） | `object_kind='project'` 的语义从「工作坊」变为「三类容器」；触发器不改，**但语义已变** | 🔴（语义）/ 🟡（代码） |
| **F02**（RLS 强制隔离） | identity（已签） | 三张新表自动纳管；`rls-cross-tenant-zero-leak.test.ts` 的 `projects` 夹具要加 `kind` | 🟠 |
| **F03**（管理员边界） | identity（已签） | `admin_project_access.project_id` 现在可能指向三类中任何一类 —— **审计语义是否需按 kind 区分？未裁** | 🟠 |
| **F04**（artifact 六表） | artifact（已签） | `artifacts.project_id` 同上：一个 artifact 现在可能挂在研究项目或用户洞察下 | 🟠 |
| **F06**（三模式绑定 + 回流） | artifact（已签） | `artifact_bindings` 同上；且**本节与第二节的改名叠加**（见 2.3） | 🔴 |
| **F10**（五路召回） | context-pack（已签） | `segment_text.project_id` / `claims.project_id` 现在跨三类容器；**检索是否要按 kind 分区？未裁** | 🟠 |
| **F22**（组织停用只读） | org 生命周期 | `projects` 在受管表清单内；三张子表自动进冻结策略（`0014` 是 catalog 推导的**函数**），但该函数**只在被调用时**重算 | 🟠 **见 3.2①**：新迁移末尾加一行 `SELECT kernel_apply_org_freeze_policies();` |

---

## 二、`stepId` / `stage.*` 改名对齐（Q-3 B ①）

> **裁决逐字**：`[x] ① 改名对齐`（yanbin shen，2026-07-30 09:19:24+08:00）。
> 代价在裁决文本里已经写明：「新增一支列改名迁移（**不改已 passing 的 `0008`**）、
> `project-role-matrix.ts` 的闭集动作词表连带改、phase-00 现有绑定测试的夹具跟着改」。

### 2.1 `step_id` / `stepId` 的真实波及面 —— **21 个文件 / 109 处**

（`grep -rcE 'stepId|step_id' apps packages --include='*.ts' --include='*.tsx' --include='*.sql'`）

**契约层（单源，先改这里）** —— 🔴
| 文件 | 处数 |
|---|---|
| `packages/contracts/src/artifact.ts` | 3 |

**迁移层** —— 🔴
| 文件 | 处数 |
|---|---|
| `apps/api/migrations/0008-f06-binding-modes.sql` | 5 |

⚠ **不改 `0008`**，新增一支列改名迁移。**下一个可用序号是 `0018-*`**——
`0016` 已被 `f13-context-pack-persistence` 占用、`0017` 已被 `f17-local-export` 占用。
（`OPEN-QUESTIONS.md` Q-8 推荐里写的「新增 `0016-*`」在写下时已经过期，**不要照抄那个序号**。）

**后端实现层（39 处 / 7 个文件）** —— 🔴
| 文件 | 处数 |
|---|---|
| `apps/api/src/infrastructure/artifact/pg-binding-repository.ts` | 14 |
| `apps/api/src/application/artifact/bind-to-project-step.ts` | 8 |
| `apps/api/src/interface/controllers/artifact-binding.controller.ts` | 6 |
| `apps/api/src/application/artifact/binding-ports.ts` | 4 |
| `apps/api/src/application/artifact/list-backflow.ts` | 3 |
| `apps/api/src/application/provenance/record-audit.ts` | 2 |
| `apps/api/src/application/artifact/upgrade-binding.ts` | 2 |

⚠ `bind-to-project-step.ts` 这个**文件名本身**也含旧概念（`step`）。
改不改文件名 → **本文不决定**，登记为签核时的一条边界。

**测试层（54 处 / 6 个文件）** —— 🟠
| 文件 | 处数 | 属于 |
|---|---|---|
| `apps/api/tests/kernel/binding-three-modes.test.ts` | 23 | F06 · F07 的验收命令 |
| `apps/api/tests/kernel/audit-backflow-searchable.test.ts` | 13 | F08 |
| `apps/api/tests/kernel/mode-upgrade-no-downgrade.test.ts` | 8 | F06 |
| `apps/api/tests/kernel/backflow-list-fields.test.ts` | 7 | F06 |
| `apps/api/tests/kernel/reference-eligibility-gate.test.ts` | 2 | F07 |
| `apps/api/tests/kernel/context-pack-pinned-replay.test.ts` | 1 | F13 |

⇒ **改名直接触及 F06 / F07 / F08 / F13 四个已 passing feature 的验收命令。**

**前端层（8 处 / 6 个文件）** —— 见 3.3，**这一层最危险**。

### 2.2 `stage.*` 动作词的波及面 —— **14 处 / 4 个文件**

| 文件 | 内容 |
|---|---|
| `apps/api/src/domain/identity/project-role-matrix.ts:26-30, :59` | 5 条动作词 × 2 处（闭集清单 + 矩阵行）= **10 处** |
| `apps/api/tests/kernel/org-switch-context-reset.test.ts:228,236` | 2 处 `"stage.advance"` |
| `apps/api/tests/kernel/contract-response.test.ts:79` | 1 处 `"stage.advance"` |
| `apps/api/tests/kernel/rbac-two-layer.test.ts` | 1 处 `"stage.selfDestruct"` —— ⚠ 这是一条**故意的不存在动作**的反证；改名时**必须一起改**，否则这条反证会因为「新前缀下 `stage.` 本来就不存在」而**变成永远通过的空转断言** |

⇒ 触及 **F01**（`rbac-role-matrix.test.ts` / `rbac-two-layer.test.ts` / `org-switch-context-reset.test.ts` /
`contract-response.test.ts` 四条都在 F01 的验收命令里）。

⚠ `project-role-matrix.ts:5-16` 自己声明了一条纪律：这份矩阵**将来要「移进」`packages/contracts`
而不是复制一份**。改名是碰它的好时机，但**移进 contracts 是另一件事**，
两件事混在一个 PR 里会让「改名」这件事的 diff 不可读。**建议分开。**

### 2.3 🔴 F06 是唯一被两条裁决同时命中的 feature

`artifact_bindings` 这张表同时被：
- 第一节（`projects` 语义变更 + `kind`/`status` 加列）
- 第二节（`step_id` → `agenda_segment_id` 改名）
- `agenda_segments` 新表 + **补外键**（Q-2① A + Q-8）

三件事命中。⇒ **F06 的三条验收测试**（`binding-three-modes` 23 处 ·
`backflow-list-fields` 7 处 · `mode-upgrade-no-downgrade` 8 处）会同时因改名与夹具变更而失败。
**这是全仓改动量最集中的一点，建议单独一个 issue / 一个 PR。**

### 2.4 两个失败码的**名字**改不改 —— 🟠 中，**未裁**

`STEP_CLOSED` / `STEP_REJECTS_ARTIFACT_TYPE` 是**已签核契约里的错误码字面量**。
Q-3 的裁决文本只提到**字段名**与**动作词**，**没有提错误码**。
⇒ 本文**不改**，登记为签核时的一条边界（`usecases.md` §3.1 已同步登记）。
⚠ 若改，它是**第三处**修订已签核束，且错误码是跨束同码同义的东西，波及面比字段名更宽。

---

## 三、哪些会让门控变红，哪些不会 —— **后者更危险**

> 本仓硬约束逐字：**没有脚本的规范条目视为未落地**。
> 一个改动如果不会让任何东西变红，它就是**在无人看管的情况下改变系统语义**。
> 本节把这类改动单独列出来。

### 3.1 ✅ 会变红的（好事，可以放心依赖门控发现）

| 改动 | 哪个门控会红 |
|---|---|
| `step_id`/`stepId` 改名 | `pnpm --filter api run typecheck`（TS 类型不匹配）+ 6 个 kernel 测试 + `pnpm --filter @repo/contracts run test` |
| `stage.*` 改名 | `rbac-role-matrix.test.ts`（矩阵成员逐值比对）+ `contract-response.test.ts` |
| `agenda_segments` 新表缺 `org_id` 或缺 RLS 策略 | `apps/api/scripts/verify-rls.sh`（catalog 推导，**不靠清单**） |
| `projects` 加 `kind NOT NULL` 无默认值 | 4 处 `INSERT INTO projects` 全部失败（含中央夹具 `db.ts:215`） |
| `artifact_bindings` 补外键后夹具没建环节行 | `binding-three-modes.test.ts` 等外键冲突 |
| 迁移文件写坏 | `pnpm --filter api run migrate:check`（强制重放全部迁移） |
| 契约与 mock 漂移 | `node .harness/scripts/lint-contract-source.mjs` + `apps/web/lib/generated/artifact.mock.ts` 需重新生成（`pnpm --filter @repo/contracts gen:mock`） |

### 3.2 🔴 **不会变红，但会改变行为**（本文认为风险最高的三条，逐条给处置）

**① 新建的租户表不会自动获得冻结策略——但缺的只是「在新迁移末尾调一次函数」。**

⚠ **本条此前的表述是错的，2026-07-30 实测更正**（旧表述：「`0014:165-184` 表清单是写死的」
「没有这条断言这个洞不可能被发现」）。两句都不成立：

- **不是写死清单**：`apps/api/migrations/0014-f22-org-lifecycle.sql:151-172` 是
  `CREATE OR REPLACE FUNCTION kernel_apply_org_freeze_policies()`，表集合由
  **`pg_class` / `pg_constraint` catalog 推导**（「带 `org_id` 且该列有指向 `organizations`
  的单列外键的普通表」），`organizations` / `rls_probe` 由推导条件自然排除。
  该文件 `:140-150` 的注释已记录这次重构的起因，正是 F17 新表拿不到策略。
- **断言早已存在**：`apps/api/tests/auth/org-disabled-readonly.test.ts:300-318`
  （注意在 `tests/auth/` 不在 `tests/kernel/`）——`frozenTableAudit()` 逐表核
  `ins/upd/del` 各恰 1 条，`missing` 必须为空；并配了**反空转反证**
  （`audit.length >= 8`、`not.toContain('rls_probe')`、`not.toContain('organizations')`），
  所以「一张表都没扫到」不会让主断言平凡为真。

**真实缺口只剩一行**：`CREATE OR REPLACE FUNCTION` 只在被**调用**时才重算策略
（`0014:203`、`0017-f17-local-export.sql:174` 各调一次）。新迁移建完
`workshops` / `research_projects` / `user_insights` / `agenda_segments` 后若不调用，
这四张表在**新库首次跑迁移时**没有冻结策略——只有 `migrate:check` 的强制重放才会补上，
表现为「重放后 schema 摘要不一致」。

**处置**：`0018-*` 建表语句之后、文件末尾加一行
```sql
SELECT kernel_apply_org_freeze_policies();
```
**不要**在新迁移里再抄一份三条策略——那才是第二份事实源（`0014:148-150` 逐字警告过）。
断言不需要新写：上面那条 catalog 审计会自动覆盖新表。

**② `projects.kind` 加了默认值 `'workshop'` 的那条路（见 1.4）。**
全绿，且把历史数据静默归类。**处置**：`NOT NULL` 无默认值，让 4 处 INSERT 变红。

**③ 前端 5 处「命名待裁决」的注释会变成事实错误，而前端不会变红。**
逐条（`grep -n "stepId" apps/web/`）：

| 文件 | 行 | 现在写的（**已过期**） |
|---|---|---|
| `apps/web/lib/mock/project.ts` | `:311` | 「⚠ 命名待裁决 → OPEN-QUESTIONS Q-3（stepId / stage.* / agenda_stage / agenda_segment）」 |
| `apps/web/lib/mock/canvas.ts` | `:37,:42` | 「四名并存」「命名待裁决」 |
| `apps/web/lib/mock/skill.ts` | `:19` | 「字段名**仍未裁决**（四个名字…）」 |
| `apps/web/lib/mock/tpl.ts` | `:338` | 「四个名字打架……改哪边都非实现者能定（Q-3）」 |
| `apps/web/components/skill/skill-app.tsx` | `:126` | **渲染到界面上**：「『议程环节』字段命名未定（…四名并存）」 |

⚠ 这五处**全是注释或文案，不是类型**，所以改名后 `typecheck` **一处都不会红**。
其中 `skill-app.tsx:126` 更严重——它把「未裁决」**画在了界面上**，
签核人看截图时会读到一句**与裁决相反**的话。
**处置**：把「败选名不得出现」的 grep 门控（`domain.md` I-P20）**范围包含 `apps/web`**，
否则前端会成为旧名的保留地。这正是 `design-coherence.md:163-177` 处理
`IngestionRun.status` vs `state` 时立下的纪律：**改名的一侧连带改所有引用，拒绝两个名字都留着**。

### 3.3 🟠 其余不会变红的语义漂移（登记，不给处置——它们对应仍未裁的问题）

| 漂移 | 对应待裁 |
|---|---|
| `segment_text.project_id` / `claims.project_id` 现在跨三类容器，检索**不区分 kind** | U-1 的下游 |
| `QueryContext.projectIds` 不按 `status` 过滤 ⇒ 归档容器的内容仍会被召回 | **U-2⑷**（跨束 X-18） |
| `groups.project_id` 指向超类型 ⇒ 研究项目下可以插分组，无人阻止 | **U-7** |
| `project_memberships` 可以写到非工作坊容器上，四种角色因此「适用」了不该适用的地方 | **U-1 / U-7** |
| `admin_project_access` 的审计语义是否要按 kind 区分 | 无登记处 —— **本文新登记为 U-7 的邻接面** |

---

## 四、建议的执行顺序（**不是承诺，是给签核人看工作量的**）

⚠ 本文**不安排开工**——本束目前**没有任何 feature**，「开工」尚不成立。
下列顺序只用于评估「这条裁决落地要动多少东西」。

1. **签核动作先做**：`identity` / `artifact` 两束的签核人确认
   ⑴ `projects` 语义变更、⑵ 改名对齐、⑶ `readContent.projectId` 放开为 nullable（Q-10 A）、
   ⑷ `object_kind` 加不加值（U-8）、⑸ `kind` 判别列可不可接受（U-9）。
   **五条都是人的动作。**
2. requirement-author 据裁决生成本束 feature → 填 `covers:`。
3. 改名（第二节）单独一支，**先契约后实现后测试**，一个 PR 一件事。
4. 建三张子类型表 + `agenda_segments` + 补外键（`0018-*` 起）。
5. 加 `status`；冻结策略**不用手写**——按 3.2① 在新迁移末尾调一次
   `kernel_apply_org_freeze_policies()`。
6. 门控与反证（`domain.md` §一之三 + `usecases.md` §4.1 的十条双向断言）。

⚠ 第 6 步**不许放到最后当收尾**。本仓九次「全绿但空转」的共同形状就是
**门控写在功能之后，于是门控是照着实现写的**。反证要和功能同一个 PR。
