# 考证 — 「项目」与「议程环节」在**已签核契约**里已经被规定成了什么

> ⚠ **这不是需求文档。** 它不提出任何主张，只回答一个问题：
> 关于「项目」这个东西，**哪些已经不能改了**——因为 phase-00 的六个契约束已由人类签核、
> 对应实现已 `passing` 并合入 `main`，改动它们等于回退已签核的契约。
>
> 每条结论带**文件路径 + 行号**。凡是我推不出来的，一律不写在这里，
> 写进同目录 `OPEN-QUESTIONS.md`。
>
> **本目录的阅读顺序**：本文（考证，先读）→ `OPEN-QUESTIONS.md`（待人类裁决）
> → `uc-00-*.md`（UC 骨架，其空缺处逐条指回 OPEN-QUESTIONS）。
>
> 作成：2026-07-30。依据的签核状态：`phases/phase-00-shared-kernel/contracts/*/design-signoff.md`
> 与 `design-coherence.md`（本文**未修改**其中任何一份）。

---

## 零、这份考证为什么必要

阶段名叫「能跑完一场项目」，而 `phases/phase-01-run-a-project/requirements/` 下
11 个模块 49 份 UC 里**没有任何一份以「项目本身」为主题**
（见 `phases/phase-01-run-a-project/requirements/00-overview.md:26-38` 的模块清单）。

与此同时，phase-00 内核**已经落地了一批项目形状的东西**：`projects` 表已存在、
项目角色已是闭集、Artifact 已经能绑到「项目环节」上、`/projects/:projectId/backflow`
是真实路由。也就是说——

> **内核已经把产出绑到「项目环节」上，而系统里没有任何东西定义
> 「环节是什么、项目怎么创建、谁在里面、它怎么结束」。**

项目在契约里唯一的出生路径是 `02-tpl/uc-2-2` 的「套用蓝本新建项目」，
即**套蓝本的副产品**。以下逐条列出已被规定死的部分。

---

## 一、项目这个实体：已落库的最小形状

### D-1 `projects` 表只有三列，且强制挂在组织下

```sql
CREATE TABLE IF NOT EXISTS projects (
  id     text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name   text NOT NULL
);
```
出处：`apps/api/migrations/0003-identity.sql:34-38`

**已定死的**：
- 项目**必属于且只属于一个组织**（`org_id NOT NULL`，单列外键）。
  ⇒ **项目不能跨组织**，这不是待定项，是已落库的外键形状。
- 组织删除时项目级联删除（`ON DELETE CASCADE`）。
- 该表与其余六张身份表一起被 `FORCE ROW LEVEL SECURITY` 覆盖：
  `apps/api/migrations/0003-identity.sql:148` 的表数组里逐字列着 `'projects'`。

**已定死地"没有"的**：`projects` 表**没有** status / 生命周期列、没有蓝本引用列、
没有创建者列、没有时间列。对比 `organizations` 表——它在 F22 里被加上了
`status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled'))`
（`apps/api/migrations/0014-f22-org-lifecycle.sql:50,68-69`）。
**组织有生命周期，项目没有。** 这是事实陈述，不是缺陷判定 → `OPEN-QUESTIONS.md` Q-5。

### D-2 项目是 `acl_bindings` 的一等 object 类型

`object_kind text NOT NULL CHECK (object_kind IN ('project', 'artifact', 'segment'))`
——`apps/api/migrations/0003-identity.sql:80`；契约侧同形：
`packages/contracts/src/identity.ts:383`（`authorize`）与 `:412-413`（`authorizeBatch`）。
领域侧写死在 `phases/phase-00-shared-kernel/contracts/identity/domain.md:50`：
「**粒度必须下探到 Segment**」。

⇒ 「对整个项目授权」是契约支持的动作；三种 object 粒度是闭集，**加第四种要改已签契约**。

### D-3 项目是 provenance 的一等 target 类型

`packages/contracts/src/provenance.ts:71` 与 `:93`：
`kind: z.enum(["artifact","artifact-version","capability","membership","project","organization"])`。
且已有一个专门的事件类型 `admin-project-access`
（`packages/contracts/src/provenance.ts:46`：「管理员以审计目的读取项目内容（D-18：必留痕且对负责人可见）」）。

⇒ **项目级的审计通道已经存在并已实现**，项目域不需要（也不许）另造一套。

### D-4 `groups`（小组）已存在且必属于某个项目

```sql
CREATE TABLE IF NOT EXISTS groups (
  id text PRIMARY KEY, org_id ..., project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE, name text
);
```
出处：`apps/api/migrations/0003-identity.sql:40-45`。

⇒ 「项目 → 小组」这一层已落库。**分组不是待设计的新概念**，它是既有结构。

---

## 二、项目角色：闭集，且它的"空值"是正常状态

### D-5 项目角色恒为四种，且是 zod 闭枚举

`packages/contracts/src/identity.ts:177`：
`export const ProjectRole = z.enum(["facilitator","groupLead","member","observer"]);`
带注释「**恒为四种**（O-03）」。数据库同形：
`apps/api/migrations/0003-identity.sql:66` 的 CHECK 约束。
领域文档：`phases/phase-00-shared-kernel/contracts/identity/domain.md:33-38`。

**连带已定死的三条**（同一处 `domain.md:41-43`）：
- 协同引导师 / 联合主持 = `facilitator` 的**多实例**，不是第五种角色；
  其中一名带 `is_host boolean`（`0003-identity.sql:69`）持最终确认权。
- 研究员 / 参与者 = **展示别名，不落库**。
- **受访者不持项目角色**，走一次性令牌（UC-6.3）。

### D-6 `ProjectMembership` 的主键是 `(user_id, project_id)`

`apps/api/migrations/0003-identity.sql:60-71`，主键在 `:70`。

⇒ **一人在一个项目里恰好持有一个项目角色**（不是多个）。
⇒ 一人可在**任意多个**项目里各持一个角色——`A3：同一人可在多个项目持有不同项目角色`
（`phases/phase-00-shared-kernel/requirements/00-core/uc-0-3-角色本体与两层权限模型.md:71`）。
上限**没有**任何地方规定 → `OPEN-QUESTIONS.md` Q-7。

### D-7 「没有项目角色」是**正常状态**，不是异常

- `packages/contracts/src/identity.ts:194`：`"NO_PROJECT_ROLE"` 行内注释
  「⚠ 这是**正常状态**不是异常（domain I-11）」。
- `phases/phase-00-shared-kernel/contracts/identity/usecases.md:19` 同义。
- 不变量 **I-11**：`phases/phase-00-shared-kernel/contracts/identity/domain.md:94`
  ——「项目角色只在存在 `projectId` 上下文时有值；无项目上下文时 `projectLayer = null`」。

### D-8 `projectLayer === null` 与 `projectLayer.role === null` 是**两件不同的事**，禁止合并

`packages/contracts/src/identity.ts:260-272` 的注释逐字写明；
`phases/phase-00-shared-kernel/design-coherence.md:331-333` 复述并给出理由：
「**合并这两者会让前端分不清『不是项目页』与『是项目页但你没权限』**」。

⇒ 任何项目域的接口设计**不得**把「无项目上下文」与「有上下文但无角色」压成一个值。

### D-9 项目角色的动作词表已经是闭集，且**已包含环节推进**

`apps/api/src/domain/identity/project-role-matrix.ts:24-44` 的 `PROJECT_ACTIONS` 15 条，
逐条标注了它抄自 UC-0.3 R5 的哪一行。其中前五条是引导师行：

```
"stage.advance",     // 推进环节
"stage.broadcast",   // 广播
"stage.timer",       // 计时
"stage.group",       // 分组
"stage.bulkConfirm", // 批量确认
```

矩阵本体在同文件 `:56-78`；`observer` 行只有 `read.published` 一条，
注释 `:51-54` 特别说明「read-only ≠ may read everything」。

⇒ **「环节可以被推进」这件事已经被签核过了**——它写在已签核的 UC-0.3 R5
（`.../uc-0-3-角色本体与两层权限模型.md:110`：引导师「控场：**推进环节**、广播、计时、分组、批量确认」），
并已实现为闭集动作词。项目域**不能重新讨论"环节要不要有状态"这个前提**，
只能讨论"状态机长什么样"→ `OPEN-QUESTIONS.md` Q-2。

⚠ 该文件 `:5-16` 自己声明了一条纪律：这份矩阵**将来要"移进" `packages/contracts` 而不是复制一份**。
项目域若需要角色矩阵，必须引用它，不得抄。

### D-10 绑定动作复用矩阵里已有的 `group.submitOutput`，不许新造动作 id

`apps/api/src/application/artifact/bind-to-project-step.ts:71-77`：
`export const BIND_ACTION = "group.submitOutput";`，注释写明理由——
「A new action id would amend a bundle that is already signed」。

### D-11 组织角色「项目负责人（lead）」的职责里**逐字**写着「创建与管理项目」

`phases/phase-00-shared-kernel/requirements/00-core/uc-0-3-角色本体与两层权限模型.md:99`：
「**项目负责人** | 创建与管理项目；可被授予对部分 MCP 的访问…」。
组织角色闭集见 `packages/contracts/src/identity.ts:170`
（`admin` / `lead` / `consultant` / `compliance`）。

⇒ **"谁能创建项目"在角色本体层面已经有答案：组织角色 `lead`。**
但"怎么创建""能不能不套蓝本"没有 → `OPEN-QUESTIONS.md` Q-1。
⚠ 同一份文档 `:131` 又写着管理员「**不是超级用户**」，`:132` 写项目负责人
「在其负责的项目中通常同时持有项目角色『引导师』，但两者是**独立授予**的」
（`phases/phase-01-run-a-project/requirements/01-auth/uc-1-4-角色可见性判定.md:132`）。
⇒ **组织角色 `lead` 不自动带来项目内容读取权**，这与 D-18 是同一条规则。

---

## 三、议程环节（step）：契约引用它，但**没有任何东西定义它**

这一节是本次考证最要紧的发现。

### D-12 `Binding` 把 `(projectId, stepId)` 当作**给定输入**

`packages/contracts/src/artifact.ts:201-208`：

```ts
export const Binding = z.object({
  id, artifactId, projectId: z.string(), stepId: z.string(), mode: BindingMode, pinnedVersionId
}).strict();
```
领域侧同形：`phases/phase-00-shared-kernel/contracts/artifact/domain.md:63-72`。
操作侧：`packages/contracts/src/artifact.ts:298-312`（`bindToProjectStep`，`in` 含 `stepId: z.string()`）；
用例侧 `phases/phase-00-shared-kernel/contracts/artifact/usecases.md:63-75`。

### D-13 数据库明确记下了「**没有 steps 表**」，并拒绝造假

`apps/api/migrations/0008-f06-binding-modes.sql:23-31`，逐字：

> `step_id` has NO foreign key, because there is no `steps` table anywhere in phase-00 --
> project templates and their stages arrive in phase-01. Two of the contract's declared
> failures for `bindToProjectStep` (`STEP_CLOSED`, `STEP_REJECTS_ARTIFACT_TYPE`) are
> therefore **not evaluable by anything in this repository today**.

列定义在 `:47`：`step_id text NOT NULL CHECK (length(step_id) > 0)` —— 只保证非空串。
唯一约束在 `:66`：`UNIQUE (artifact_id, project_id, step_id)`，
注释 `:62-65` 说明它允许同一 artifact 钉到**多个环节的不同版本**。

⇒ **两个已签核的失败码目前不可达。** 它们的判据（环节有没有"关闭"态、
环节收不收某类产出）必须由项目域给出，否则 phase-00 的契约里会永远留着两条空转的错误码。
这是项目域**已被指派**的债，不是可选项 → `OPEN-QUESTIONS.md` Q-2 / Q-8。

### D-14 ⚠ 同一个概念，仓库里已经有**四个名字**——第七次「同一事实两处」的候选

| 名字 | 出处 | 层 |
|---|---|---|
| `stepId` / `step_id` | `packages/contracts/src/artifact.ts:205`；`apps/api/migrations/0008-f06-binding-modes.sql:47` | 已签契约 + 已落库 |
| `stage.*`（`stage.advance` 等） | `apps/api/src/domain/identity/project-role-matrix.ts:26-30` | 已实现的动作词表 |
| `agenda_stage` | `phases/phase-01-run-a-project/requirements/02-tpl/uc-2-2-套用蓝本新建项目.md:29`：「代码、接口字段、UI 文案、测试断言中**不得裸用「环节」二字**，须写全 `agenda_stage`」（裁决 D-03） | phase-01 需求，人类已拍板 |
| `agenda_segment` / `agenda_segment_id` | 同一份 uc-2-2 的 `:394`；`phases/phase-01-run-a-project/requirements/22-files/uc-22-1-项目文件浏览器.md:40,72,85` | phase-01 需求 |

⚠ 注意第三、四行**出自同一份文件**：`uc-2-2:29` 命令写 `agenda_stage`，`uc-2-2:394` 自己写了
`agenda_segment_id`。而 phase-00 已签核并已落库的是 `stepId`，已实现的动作词是 `stage.*`。

本仓已**六次**因「同一事实声明在两处」漂移
（`phases/phase-00-shared-kernel/design-coherence.md:141-142` 列出六次）。
这是第七次的现成候选，且它跨越了"已签契约"与"未签需求"两侧——
**改哪边都不是实现者能决定的** → `OPEN-QUESTIONS.md` Q-3。

### D-15 环节**有状态**，且已有两条跨模块规则依赖它

- **临时提权按环节失效**：`phases/phase-01-run-a-project/requirements/01-auth/uc-1-4-角色可见性判定.md:97-100`
  ——「**`环节 3 结束自动失效`**。即失效条件是**流程节点**（某个议程环节结束），**不是时间点**；
  环节被提前结束、被跳过或被合并时，该临时读权同样立即失效」，
  且 `:100` 要求「失效必须由服务端在**环节状态机变更**时主动收回」。
- **环节状态驱动三视角首屏**：`.../02-tpl/uc-2-2-套用蓝本新建项目.md:286-287`
  ——「组长切换环节状态后，三种视角的首屏立刻跟着换」，
  并明确「**议程环节状态是三视角首屏的唯一驱动源**」。

⇒ 「环节有状态机」**不是待定项**（已有两处规则以它为前提，其中一处是已签核的 phase-00 邻接面），
但**状态集合与迁移规则完全没有** → `OPEN-QUESTIONS.md` Q-2。

### D-16 环节归属可以为空

`phases/phase-01-run-a-project/requirements/22-files/uc-22-1-项目文件浏览器.md:85`：
「所属环节 | `agenda_segment` 名称，**可空**（显示「—」而非留白）」，
`:72` 给未绑定者一个「**未归入环节**」节点。

⚠ 这与 D-12 张力明显：`Binding.stepId` 是 `z.string()`（**非空**）。
两者可以同时为真（一个 artifact 可以有零条绑定），但读法不唯一 → `OPEN-QUESTIONS.md` Q-8。

---

## 四、项目与内容的关系：三条已签核的硬边

### D-17 Artifact 的 `projectId` **可空**——"不属于任何项目"是被契约祝福的状态

`packages/contracts/src/artifact.ts:126-130`：
「`projectId` 可空：Studio 可独立发起、不依赖项目（A1）」；
领域侧 `phases/phase-00-shared-kernel/contracts/artifact/domain.md:22` 同义；
`saveDraft` 的 `in.projectId` 也是 `z.string().nullable()`（`artifact.ts:255`）。
Context Pack 侧一致：`packages/contracts/src/context-pack.ts:253` `projectId: z.string().nullable()`，
用例文档 `phases/phase-00-shared-kernel/contracts/context-pack/usecases.md:43`
——「projectId 为 null ⇒『不属于任何项目』范围，项目层为空、仅装组织层+个人层偏好（A1）」。

⇒ **项目不是内容的必需容器。** 项目域不得假设「所有 artifact 都有项目」。

### D-18 但**内容读取面**要求 `projectId` **非空**

`packages/contracts/src/identity.ts:443-450`，`readContent` 的
`in: { orgId, projectId: z.string(), itemId, purpose }` —— 注意**没有** `.nullable()`，
与同文件 `authorize`（`:382` `projectId: z.string().optional()`）、
`resolveIdentity`（`:500`）不同。
`design-coherence.md:394` 说明这是**唯一**的内容读取面，个人层与项目层共用它。

⇒ 这是一条**已签核契约内部的紧张关系**（D-17 说内容可以没有项目，D-18 说读内容必须给项目）。
我不替它下结论 → `OPEN-QUESTIONS.md` Q-10。

### D-17b 项目与 Studio 的关系：**契约规定了"产出"这一侧，没有规定"Studio"这个东西**

这一条是应并行的 `itv` UI 原型 agent 的输入专门核实的。逐字结论分两半：

**(a) 已规定的：Studio 产出可以不属于任何项目，并可**事后**挂进项目环节。**
- `packages/contracts/src/artifact.ts:126`：「`projectId` 可空：**Studio 可独立发起、不依赖项目**（A1）」。
- `phases/phase-00-shared-kernel/contracts/artifact/domain.md:22` 同义，并把 A1 的原话
  「不属于任何项目」写进表格。
- `phases/phase-00-shared-kernel/contracts/artifact/usecases.md:42`（`saveDraft` 的前置条件）：
  「用户在**四个 Studio 之一**有可保存内容（**无项目归属也可**，A1）」。
- `.../context-pack/usecases.md:43`：`projectId` 为 null ⇒「不属于任何项目」范围，
  **项目层为空、仅装组织层+个人层偏好**。
- 事后挂载的路径已签核且已实现：`bindToProjectStep`
  （`packages/contracts/src/artifact.ts:293-313`；F06 passing）。
- ⚠ 连带：`ArtifactSource` 七类里有一类就叫 `"prototype-run" // 原型 Studio 产出`
  （`packages/contracts/src/artifact.ts:31`）——**Studio 是 artifact 的来源，不是 artifact 的容器**。

⇒ **「项目是顶层容器、一切挂在项目下」这个隐含假设，在已签契约里是不成立的。**
契约明确允许「先产出、后归属」，且「不属于任何项目」是一等状态而非兜底分类。

**(b) 未规定的：`Studio` 本身在契约里不是任何东西。**
全文搜索 `packages/contracts/src/*.ts`，`Studio` 只出现在 **4 处注释**里
（`artifact.ts:11,31,126`；`context-pack.ts:11`），**没有实体、没有字段、没有路由、没有枚举**。
phase-00 六个束的 `domain.md` / `usecases.md` 里，`Studio` 也只出现在依据说明与
**缺口登记**中（`.../artifact/coverage.md:54`、`.../context-pack/coverage.md:29,31,47`
把「Studio 栏未建」记为界面缺口，随 phase-01 交付）。

⇒ **「Studio 与项目是什么从属关系」在已签契约里查不到——不是被否定，是从未被规定。**
我不从 `projectId` 可空反推「Studio 因此是一等对象」：可空的是 **artifact 的字段**，
不是 Studio 的地位。两者的差别正是 `OPEN-QUESTIONS.md` **Q-11** 要人类回答的东西。

### D-19 项目侧的回流列表已经是**真实路由与真实形状**

`packages/contracts/src/artifact.ts:333-339`：
`listBackflow: { method: "GET", path: "/projects/:projectId/backflow",
in: { projectId, stepId? }, out: BackflowEntry[], err: ["NO_PROJECT_ROLE"] }`。
`BackflowEntry` 七字段在 `:214-224`，其中 `mode/version/pinnedBy/pinnedAt` **四字段非空**；
`badge` 是闭枚举 `["draft","live","pinned"]`。
用例侧 `phases/phase-00-shared-kernel/contracts/artifact/usecases.md:88-97`：
**草稿不在此列表**，空态返回 `[]`、**不生成伪数据**。

⇒ **项目主页至少已经有一个已签核的板块**：某环节下已回流的产出与版本。
其字段、徽标、空态、失败码都不可再自行发明 → `uc-00-2` 据此起草。

### D-20 三模式绑定与"只有固定快照可被下游引用"是项目内容流转的硬约束

- 三模式：`packages/contracts/src/artifact.ts:41-45`；`draft` **不产生项目侧绑定行**
  （`phases/phase-00-shared-kernel/contracts/artifact/domain.md:72`）。
- 不变量 **I-14**（跨束）：`.../artifact/domain.md:105`
  ——任何下游引用**只能指向 `pinned` 版本**。
- 不变量 **I-11**：`.../artifact/domain.md:102`
  ——固定快照**不可降级、不可删除、不可修改**（任何接口）。

### D-21 项目内容的可见性沿数据链路传播，且**只收紧不放宽**

不变量 **I-13**（跨束）：`phases/phase-00-shared-kernel/contracts/artifact/domain.md:104`；
identity 侧 **I-7**：`.../identity/domain.md:90`
——「交集生成内容的权限取**所有来源中最严格**的一档（不是最宽松，也不是并集）」。

---

## 五、项目与组织：切换、冻结、删除

### D-22 切换组织**必须清空全部项目级上下文**——这是契约的一部分，不是实现细节

`packages/contracts/src/identity.ts:516-521`（`switchOrganization` 的副作用声明）：

> ① 清空全部项目级上下文（**当前项目/环节**/Context Pack/鉴权缓存/未提交草稿）
> ② 清空全部组织级能力解析 ③ 权限按新组织**重新求值**

用例侧 `phases/phase-00-shared-kernel/contracts/identity/usecases.md:62` 同义；
UC 侧 `.../uc-0-3-角色本体与两层权限模型.md:78-79`。

⇒ 契约里**已经存在"当前项目"与"当前环节"这两个会话级概念**，
且它们的清空时机已被签核。项目域不得另起一套会话状态。

### D-23 组织停用会把项目一起冻成只读（F22 已落地）

`apps/api/migrations/0014-f22-org-lifecycle.sql:50,68-69` 加 `status`；
`:108` 的 `SECURITY DEFINER` 判定函数；`:165-184` 对每张受管表装
`_org_frozen_ins/_upd/_del` 三条 RESTRICTIVE 策略。
`projects` 在 `0003-identity.sql:148` 的受管表清单内。

⇒ **项目已经有一种"只读"形态**——但它来自**组织**层，不是项目自己的状态。
项目自身有没有生命周期，仍无出处 → `OPEN-QUESTIONS.md` Q-5。

### D-24 「删除组织」API 已裁决**不提供**，并有一条测试守着"它不存在"

`phases/phase-00-shared-kernel/design-coherence.md:209`（N-5，2026-07-29 关闭）：
取「不提供」，并补 `no-forbidden-routes.test.ts` 断言路由表里确实没有它，
同时禁掉 `DELETE /artifacts/*/versions` 与 `PUT/PATCH/DELETE /provenance`。

⇒ **"删除项目"是否同样禁止，没有出处。** 这是一个已有先例、但未被推广的裁决 →
`OPEN-QUESTIONS.md` Q-9。

### D-25 X-4：快照不可删 vs 合规撤回必须删——**已裁决，且阻塞点仍在**

`phases/phase-00-shared-kernel/design-coherence.md:101-113`：

- 豁口边界：**只有合规撤回**能删快照，且必须同时作用于 S3 与 PG。
- 删除后引用它的下游**标失效而非静默消失**。
- ⚠ 它依赖 **O-39 法定留存清单**，而那份清单**不存在**
  （`phases/requirements/COMPLIANCE-INQUIRY.md` Q-1；代码里登记为
  `legalHoldCategories: {known:false}`，取值抛错而非放行）。

⇒ **任何"项目结束后清理内容"的设计都撞在这条上**：在 O-39 给出之前，
「哪些快照必须删、哪些不得删」没有判据 → `OPEN-QUESTIONS.md` Q-5 必须知道这一点。

---

## 六、项目在界面上的形状：已签核的两条

### D-26 项目页有**两层身份条**，非项目页不得泄漏项目层

`phases/phase-00-shared-kernel/contracts/web-kernel/domain.md:107`（不变量 I-10）：
「项目层身份**只在项目上下文**渲染；非项目页不得出现 `role-bar-project` /
`role-preview-switcher` / `topbar-project-context`」，
断言方式是 `verify-ui-states.sh` 的反向段——注释直说这是 identity I-11 的界面投影。
文案形状：`phases/phase-00-shared-kernel/contracts/web-kernel/usecases.md:127-128`
——「两层身份条形如『顾问 · 能源组 ｜ 本项目：组长 · 第 2 组』」。

⇒ 项目主页的**顶栏结构已被签核并有机械门控**。项目域的 UI 只能在此之上做加法。

### D-27 保留 testid 是单源，项目域新增屏必须进那张表

`.../web-kernel/usecases.md:76-78`：任一保留 testid 缺失 / 互斥破坏 /
**项目层泄漏到非项目页** → `exit 1`。
`design-coherence.md:149` 已把「屏清单手维护」登记为漂移候选，
并注明「phase-01 屏数增长后风险放大」。

---

## 七、一句话总结：哪些人类改不了

1. **项目必属于恰好一个组织**（外键，已落库，跨组织不可表达）。
2. **项目角色恒为四种**，一人一项目一角色，「无角色」是正常状态且必须与「无项目上下文」可分辨。
3. **绑定的身份是 `(artifact, project, step)` 三元组**，`stepId` 非空，
   而 `steps` 表不存在、两个已签失败码因此不可达——**这笔债已指派给 phase-01**。
4. **环节可被推进**（`stage.advance` 已在闭集动作词表里，已签核）。
5. **只有固定快照能被下游引用；固定快照不可删改降**（I-11 / I-14）。
6. **切换组织必须清空"当前项目 / 当前环节"**——这两个会话概念已存在于契约。
7. **项目侧回流列表的路由、字段、徽标、空态、失败码已定**。
8. **项目页两层身份条已定并有机械门控**。

---

## 八、我在考证过程中**没有**找到出处的东西（不在本文下结论）

逐条移交 `OPEN-QUESTIONS.md`：项目创建路径、环节的实体与状态机、环节的字段命名、
成员进入方式、项目生命周期、项目主页内容、项目数量与跨组织、
`STEP_CLOSED`/`STEP_REJECTS_ARTIFACT_TYPE` 的判据、项目删除、无项目内容的归属、
**项目与 Studio 的从属关系（契约未规定，见 D-17b(b)）**、
**「研究项目 / 业务项目」是不是项目实体上的一个维度**。
