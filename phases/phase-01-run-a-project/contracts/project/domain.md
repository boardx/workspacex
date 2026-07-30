# `project` 束 · 领域模型与不变量

> **本文只写不变量，不写考证。**
>
> 「为什么这些是硬约束」的**考证与逐条行号出处，权威在**
> `phases/phase-01-run-a-project/requirements/00-project/DERIVED-FROM-CONTRACTS.md`
> （27 条 D-1…D-27 + D-17b，每条带文件路径与行号）。
> ⚠ **本文不复制那份考证**——同一事实声明在两处是本仓头号失败模式（已发生八次）。
> 下面每条不变量只给「约束是什么 + 怎么断言 + 出处指针」，
> 想知道它凭什么成立，去读 `DERIVED-FROM-CONTRACTS.md` 的对应 D-N。
>
> **阅读顺序**：`DERIVED-FROM-CONTRACTS.md`（考证，先读）→ `OPEN-QUESTIONS.md`（**12 条裁决，
> 2026-07-30 已全部由人类填写**）→ 本文（不变量）→ [`usecases.md`](./usecases.md)
> → [`ui.md`](./ui.md) → [`MIGRATION-IMPACT.md`](./MIGRATION-IMPACT.md)（裁决会回头改哪些已合入 main 的东西）。
>
> **本次修订（2026-07-30）**：按 12 条裁决重写实体与不变量。
> **裁决没覆盖的一律标「待裁 → Q-N」**，逐条汇总在第八节，**一个都不发明**。

---

## 零、本束的实体 —— **2026-07-30 按人类 12 条裁决重写**

> ⚠ **本节的形状不再是「待裁」。** `OPEN-QUESTIONS.md` 的 12 条已于 2026-07-30 由
> yanbin shen 逐条裁决（勾选 + 署名 + ISO 时间戳）。本文按裁决结果写实，
> **仍未裁的部分逐条标「待裁 → Q-N」，一个都不发明**。
>
> **裁决原文是权威**，本文不复制它的论证，只写落到不变量上的结果。

### 0.1 三类独立实体（Q-12 裁决 **C**）+ 超类型表（Q-12 连带 4 裁决 **D**）

人类原话（`OPEN-QUESTIONS.md` Q-12 裁决理由，逐字）：
「研究项目和项目是完全不同的两种项目……还有一个是用户洞察，也是一种独立的项目。」

⇒ **三类，不是两类**；⇒ 实现形状取 **D（超类型表 + 1:1 子类型表）**：

| 层 | 表 | 承担什么 |
|---|---|---|
| **超类型** | `projects` | **容器身份 + 组织归属 + 状态**（`id` / `org_id` / `name` / `status` / `kind`）。**仅此而已** |
| 子类型 ①（工作坊） | `workshops` | 议程环节、分组、会前/现场/会后三段 AI 增强 |
| 子类型 ②（研究项目） | `research_projects` | 研究计划 → 深度研究 |
| 子类型 ③（用户洞察） | `user_insights` | 访谈、问卷 |

`projects(id)` 现有 **7 条外键一条不改**（`groups` · `project_memberships` ·
`admin_project_access` · `artifacts` · `artifact_bindings` · `segment_text` · `claims`
—— 逐条行号见 [`MIGRATION-IMPACT.md`](./MIGRATION-IMPACT.md) 第一节）。

### 0.2 本束的实体清单（按裁决后的形状）

| 实体 | 裁决后的状态 | 仍未裁的 |
|---|---|---|
| `Project`（容器超类型） | `id` / `org_id` / `name` / `status`（Q-5 **B**：`active` \| `archived`）/ `kind`（判别列，见 I-P34 ⚠ **本文替人类做的判断**） | Q-5 连带四问全空 → 见 I-P38 |
| `Workshop` | 1:1 于 `projects`；持议程环节与分组；四种项目角色**只在这里适用** | 会前/现场/会后三段的字段（本束不定义，属 `templates` / `rec` / `canvas` 束） |
| `ResearchProject` | 1:1 于 `projects`；研究计划 → 深度研究 | **成员模型未裁** → Q-12 连带 2 后半 |
| `UserInsight` | 1:1 于 `projects`；访谈、问卷（**访谈属这一类**） | **成员模型未裁** → Q-12 连带 2 后半 |
| `AgendaSegment`（议程环节） | **建独立表**（Q-2① **A**）；四态 + `mergedInto`（Q-2② **B**）；`acceptedSources` 默认全接受（Q-2③）。**挂 `workshops`**（Q-12 必裁三件之 2「议程环节挂在哪一级：项目」＋「议程环节是工作坊的机件」） | 无 |
| `Group`（小组） | **已落库**，`project_id → projects(id)`。⚠ 分组是**工作坊机件**，但外键指的是超类型 —— 见 I-P37 的处置 | 「非工作坊容器下能否有分组」→ **待裁 → Q-12 连带 2 后半** |
| `ProjectMembership` | **已落库**，主键 `(user_id, project_id)`，四种角色**只对 `kind='workshop'` 成立** | 另两类的成员模型 → **待裁 → Q-12 连带 2 后半** |

⚠ **字段名已定，不要再选**：议程环节 = `agenda_segment` / `agenda_segment_id`
（**D-03a**，全局权威）。且 **Q-3 B 已裁 ①「改名对齐」**——
phase-00 已落库的 `stepId` / `step_id` 与已实现的动作词 `stage.*` **要改名对齐**。
⚠ 这是**修订已签核束**（phase-00 `artifact` + `identity`），是**签核动作不是实现动作**；
波及面（真实文件清单与出现次数）见 [`MIGRATION-IMPACT.md`](./MIGRATION-IMPACT.md) 第二节。

---

## 一、项目实体（出处 → D-1 … D-4）

| # | 不变量 | 怎么断言 | 出处 |
|---|---|---|---|
| **I-P1** | 项目**必属于且只属于一个组织**。`org_id` 是单列非空外键 ⇒ **项目跨组织不可表达**（这不是待定项，是已落库的外键形状） | 用非 owner 运行时角色直连 SQL 跨组织查 `projects`，断言返回 0 行（同 I-4 技法）。另断言 `org_id` 的 `is_nullable = 'NO'` | D-1 |
| **I-P2** | 项目是 `acl_bindings` 的一等 object 类型；三种 object 粒度（`project` / `artifact` / `segment`）是**闭集**，**加第四种要改已签契约** | 从 `pg_catalog` 读出 `object_kind` 的 CHECK 成员集，断言**逐个等于**契约侧枚举 | D-2 |
| **I-P3** | 项目级审计通道**已存在并已实现**（`provenance` 的 `kind` 含 `project`，且有专用事件类型 `admin-project-access`）。本束**不得另造一套**项目审计表或查询面 | 断言 `provenance_events` 的 UPDATE / DELETE 被拒；断言本束代码里不存在第二张审计表 | D-3 · D-34 侧 |
| **I-P4** | 「项目 → 小组」这一层**已落库**。分组不是待设计的新概念 | 断言 `groups.project_id` 非空且外键指向 `projects` | D-4 |
| **I-P5** | ~~项目表已定死地「没有」status……~~ **2026-07-30 作废并由 I-P33 取代**：Q-5 裁 **B** ⇒ `projects` 加 `status`；Q-12 连带 4 裁 **D** ⇒ `projects` 成为容器超类型。**这条现状快照已过期，保留编号只为不悬空引用** | 见 **I-P33** | D-1（已被裁决覆盖） |

---

## 一之二、超类型 / 子类型模型（Q-12 裁 **C** + 连带 4 裁 **D**）

> ⚠ 这一整节是 2026-07-30 新增。它是本束**最容易被顺手违反**的一节：
> 「往 `projects` 上加一列」在任何一次实现里都只是一行 SQL，而它一旦发生，
> 人类裁决 C 的原意（三类的**过程与目的完全不同**）就被悄悄抹平了。
> 因此 I-P34 / I-P35 都要求**机械门控**，不接受纸面约定。

| # | 不变量 | 怎么断言 | 出处 |
|---|---|---|---|
| **I-P33** 🔴 | **`projects` 的列集合是一个封闭清单**：恰好 `{id, org_id, name, status, kind}`。三类共用的只有「**容器身份 + 组织归属 + 状态**」。**任何把工作坊专属字段（议程环节、分组、蓝本引用、会前/现场/会后……）加进 `projects` 的改动都违反 Q-12 裁决** | 见下方 **§一之三「护栏门控的设计」**（不是一句「要断言」，是一份可实施的门控设计 + 它的反证） | Q-12 裁决 C + 连带 4 裁决 D，逐字：「⚠ **不变的部分要写死**：三类共用的只有『容器身份 + 组织归属 + 状态』……任何把工作坊专属字段（议程环节、分组）加进 `projects` 的改动都违反本条」 |
| **I-P34** ⚠ | **一个 `projects` 行至多属于一个子类型。** 判据不能靠「大家都小心」：三张子类型表各自 `id text PRIMARY KEY REFERENCES projects(id)` **只能保证「每张表至多一行」，保不了「三张表里合计至多一行」**——一个 `projects` 行同时有 `workshops` 与 `research_projects` 两条子行，在纯 PK+FK 下**完全合法** | **本文的判据 + 断言设计见 §一之三第 2 小节**（判别列 + 复合外键，纯声明式，不用触发器）。⚠ **判别列 `projects.kind` 是本文替人类做的判断，须在签核时确认**——见该节末尾的「我替你做了什么判断」 | 推导自 Q-12 连带 4「1:1 子类型表」；⚠ **裁决原文没有说 1:1 怎么保证** |
| **I-P35** | **`acl_bindings.object_kind` 仍是三值闭集**（`project` / `artifact` / `segment`），**在 D 下不需要加值**。⚠ 与 Q-12 **连带 1** 的字面（「三类实体意味着要加 2 个值」）**不一致**——连带 1 是在候选 **C（两/三张平行表）** 下写的，而人类随后把落地形状裁成了 **D（超类型）**：三类的行**都是 `projects` 行**，`acl_bindings` 指向的仍是 `projects(id)` | ⚠ **待确认 → Q-12 连带 1 与连带 4 的先后关系**（本文按「D 覆盖 C 的连带 1」处理，并把它列为**签核时必须点头的一条**，见 `design-signoff.md` ③ 节）。断言方式：`0006-f04:331-344` 的 `acl_binding_same_org()` 触发器 `IF NEW.object_kind='project' THEN SELECT org_id FROM projects` **在 D 下继续成立**（子类型行也有 `projects` 行）——加一条测试：为三类各建一个容器，各授一条 `object_kind='project'` 绑定，断言三条**都通过**同一触发器 | Q-12 连带 1 vs 连带 4 |
| **I-P36** | **RLS 与租户隔离自动覆盖三张子表**：`verify-rls.sh` 从 `pg_catalog` 推导租户表（`kernel_tenant_table_audit()`），**新表自动入网**。⇒ 三张子表**必须各带 `org_id`** 且策略与 `projects` 一致，否则 `verify-rls.sh` 直接变红 | 建表后跑 `apps/api/scripts/verify-rls.sh`，断言 `verdict NOT LIKE 'ok'` 的表数为 0；并断言 `ok` 表计数**增加了 3**（防「新表被判成 exempt 却没人看见」） | Q-12 连带 3；`apps/api/scripts/verify-rls.sh:57-80` |
| **I-P37** | **`groups`（分组）是工作坊机件，但其外键指向超类型 `projects`**（已落库，D-4，**不改**）。⇒ 「非工作坊容器下能不能有分组」在**外键层不可表达为禁止**，只能靠一条断言 | 断言：为 `kind='research_project'` / `'user_insight'` 的容器插入 `groups` 行——**期望行为待裁 → Q-12 连带 2 后半**。⚠ **裁决前不写这条断言**：现在写就得先猜一个期望值 | D-4 + Q-12 连带 2 |
| **I-P38** | **项目生命周期 = 两态 `active` / `archived`，`archived` = 只读，归档不删除任何内容**（Q-5 裁 **B**）。状态在**超类型**上（三类共用「状态」这一项） | 归档后断言：⑴ 该容器下任何写入被拒；⑵ **读仍可用**（反向断言——只有「拒写」一条时，一个「归档即 404」的实现也会全绿）；⑶ 归档**不产生任何删除**（`artifact_versions` / `provenance_events` 行数差为 0） | Q-5 裁决 B |
| **I-P39** | **归档的四个连带行为全部未裁**：⑴ 归档可逆吗 ⑵ 归档时**进行中的议程环节**怎么办 ⑶ 归档容器的 artifact 还能被**下游引用**吗 ⑷ **Context Pack 会不会召回**归档内容 | **待裁 → Q-5 连带 1–4（裁决块中四格为空）**。⚠ **裁决前不写任何一条断言**——写一个永远为真的断言比不写更糟 | Q-5 裁决块 `:524-525` 四格空白 |
| **I-P40** | **不提供删除项目**（Q-9 裁「不提供」）。交付物是**一条断言它不存在的测试**，不是一个接口 | 把 `DELETE /projects/*` 加进 `no-forbidden-routes.test.ts` 的禁止清单（照抄 N-5）。⚠ 反证：同时断言该清单**非空且含至少一条既有条目**，否则一个清空了清单的实现也全绿 | Q-9 裁决 |
| **I-P41** | **一人所属项目数不设上限**（Q-7① 裁「不设」）；**组织被停用时其项目显示且标注只读，不消失**（Q-7③）；**跨组织不可表达**（I-1 已答死，非待定项） | Q-7③：把组织置 `disabled`，断言项目**仍出现在列表里**且带只读标注（**不是 0 行**）。这与 I-P28 是同一种只读呈现，两处必须一致（Q-5 ↔ Q-7③ 耦合） | Q-7 三条裁决 |

---

## 一之三、护栏门控的设计（I-P33 / I-P34 的落地）

> 本仓硬约束：**没有脚本的规范条目视为未落地**。所以这一节不是「建议加断言」，
> 是把两条护栏写成可实施的门控 + **它们各自的反证**。
> ⚠ 用户记忆里的纪律：本仓已九次「全绿但空转」——**写完门控立刻造反证**。

### 1. I-P33「`projects` 列集合封闭」的门控

**门控 A（结构断言，主门）**
```
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='projects'
```
断言返回集合 **恰好等于** `{'id','org_id','name','status','kind'}`——
**是集合相等，不是「包含」也不是「不包含黑名单」**。
理由与 `files` 束 N-4（已有 information_schema 门控）同型，但方向相反：
N-4 断言「某两列**不存在**」，那是**黑名单**——黑名单挡不住下一个没被想到的名字
（`agenda_segment_id` 被挡住了，`current_segment_id` 没有）。
⇒ 本条必须是**白名单等值**。

**门控 B（反证 / 非空转证明）**
把判定抽成一个**纯函数**而不是写死在测试体里：
```ts
// apps/api/src/domain/project/projects-column-set.ts（示意，本文不写实现）
export const PROJECTS_COLUMNS = ["id","org_id","name","status","kind"] as const;
export function checkProjectsColumnSet(actual: string[]): { ok: boolean; extra: string[]; missing: string[] }
```
然后**两条测试**：
- **正向**：拿真库的列集合喂进去，断言 `ok === true`；
- **反向（反证）**：喂一个**伪造的**列集合 `[...PROJECTS_COLUMNS, "agenda_segment_id"]`，
  断言 `ok === false` 且 `extra` 恰为 `["agenda_segment_id"]`；
  再喂 `["id","org_id"]`，断言 `missing` 非空。

⚠ **没有反向那条，一个 `return {ok:true}` 的实现会让主门永远绿**——
这正是 `0008-f06:29-31` 拒绝「永远说 open 的可空查表」的同一个形状。

**门控 C（意图断言，防「改白名单来消红」）**
白名单常量与迁移是两处，改白名单就能让门控闭嘴。
⇒ 追加一条断言：`PROJECTS_COLUMNS` 的**长度恒为 5**，且**逐值**等于字面量数组。
它的作用不是技术上的（重复了 A），是**社会性的**：
任何加列的人必须同时改两处并解释，改动会出现在 diff 的显眼处。
⚠ 诚实说明其限度：**这挡不住一个决心加列的人**，它只保证「加列不可能是顺手的」。
真正的门是签核——见 `design-signoff.md` 的交叉约束表。

### 2. I-P34「一个 `projects` 行至多属于一个子类型」的判据

**先说清楚常见做法为什么不够。** 「子表 PK = FK 到 `projects.id`」确实是超类型建模的标准手法，
它给的是：*每张子表*对同一个 `projects.id` 至多一行。
但**三张子表之间互相不知道对方**——
```sql
INSERT INTO workshops(id) VALUES ('p1');
INSERT INTO research_projects(id) VALUES ('p1');   -- 两条都合法
```
⇒ 「至多属于一个子类型」**在纯 PK+FK 下不可断言**。

**本文的判据：判别列 + 复合外键（纯声明式，无触发器）**

```sql
-- 超类型
ALTER TABLE projects ADD COLUMN kind text NOT NULL
  CHECK (kind IN ('workshop','research_project','user_insight'));
ALTER TABLE projects ADD CONSTRAINT projects_id_kind_uniq UNIQUE (id, kind);

-- 子类型（三张同形，此处只示意一张）
CREATE TABLE workshops (
  id     text PRIMARY KEY,
  kind   text NOT NULL DEFAULT 'workshop' CHECK (kind = 'workshop'),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,  -- I-P36 要求
  ...
  FOREIGN KEY (id, kind) REFERENCES projects (id, kind) ON DELETE CASCADE
);
```

**为什么这条判据成立**（三步，每步都是数据库层的）：
1. `projects` 的一行只有**一个** `kind` 值；
2. `workshops` 的 `kind` 被 CHECK 钉死为 `'workshop'`，复合外键要求
   `(id, kind)` 在 `projects` 里存在 ⇒ **只有 `kind='workshop'` 的容器能有 `workshops` 子行**；
3. 三张子表的 CHECK 常量两两不同 ⇒ 同一个 `id` 不可能同时满足两张表的复合外键。

⇒ 「至多一个子类型」**从三张表之间的协定，降成了一行的 `kind` 值** —— 可机械断言。

**这条判据的断言（含反证）**
- **正向**：三类各建一个容器 + 对应子行，断言三条 INSERT 都成功；
- **反证 ①（互斥真的生效）**：对一个 `kind='workshop'` 的容器插入 `research_projects` 行，
  断言**外键冲突**（不是应用层报错）；
- **反证 ②（不是「谁都插不进去」）**：紧接着对同一个容器插入**第二条** `workshops` 行，
  断言是**主键冲突**而不是外键冲突——两种失败**必须可区分**，
  否则一个「三张子表全部只读」的实现两条反证都会绿；
- **反证 ③（判别列不是摆设）**：把某容器的 `kind` 从 `'workshop'` 改成 `'research_project'`，
  断言 UPDATE **被复合外键拒绝**（因为 `workshops` 子行仍引用 `(id,'workshop')`）。
  ⚠ 没有这条，`kind` 就成了一个「写进去没人用」的列。

**⚠ 我替你做了什么判断（签核时必须确认，不确认就当它没定）**

判别列 `projects.kind` **是本文提出的，不在人类裁决原文里**。
裁决只说「三类各建 1:1 子类型表」，**没有说 1:1 怎么保证**。
- 它**看起来**像被否决的候选 **A**（`projects.kind ∈ {research, delivery}`）。
  两者的差别是：候选 A 的 `kind` 是**行为分支**（一张表两条代码路径），
  本文的 `kind` 是**判别列**（指出这行的子类型表在哪，本身不承载任何行为）。
- 它是否属于 I-P33 允许的「容器身份」？**本文按「是」处理**——
  `kind` 回答的是「这个容器是什么」，与 `id` / `name` 同类，不是工作坊专属字段。
- **若签核人判定 `kind` 不可接受**，替代方案是：不设判别列，
  改用「一条测试断言三张子表的 `id` 集合两两不相交」。
  代价诚实说明：那是**应用层/测试层**约束，**数据库允许违反它**，
  与本仓「约束要下沉到数据库」的纪律相反（F04 级联删除、F08 append-only 两次栽在这上面）。

---

## 二、项目角色（出处 → D-5 … D-11）

> 🔴 **2026-07-30 裁决收窄了这一整节的适用范围。** 人类原话逐字：
> 「在访谈里是没有这几种角色的，引导师、组长什么的是不必要的。」
> ⇒ **四种项目角色（`facilitator` / `groupLead` / `member` / `observer`）是「工作坊」的角色**，
> **不适用于**研究项目与用户洞察。本节全部不变量的隐含前提是 `kind = 'workshop'`。
>
> ⇒ **研究项目与用户洞察各自的成员模型：未裁 → Q-12 连带 2 后半。**
> 本文**不发明**它们的角色集合、不复用四种角色、也不假设「它们没有成员」。
> ⚠ 这不是遗漏，是**裁决确实没覆盖到**；`ui-preview/itv/`（v1）正是因为把工作坊四角色
> 套到访谈上而被推翻（错误逐条见 `ui-preview/itv-v2/V1-WAS-WRONG.md` 错误 5）。

| # | 不变量 | 怎么断言 | 出处 |
|---|---|---|---|
| **I-P6** | 项目角色**恒为四种**（`facilitator` / `groupLead` / `member` / `observer`），zod 闭枚举 + DB CHECK 同形。**且仅对 `kind='workshop'` 的容器成立** | 尝试写入第五种，断言 CHECK 拒绝；并断言 CHECK 成员集**逐个等于**契约枚举。⚠ 「给非工作坊容器写 `project_memberships` 行是否应被拒」——**待裁 → Q-12 连带 2 后半**，裁决前不写这条断言 | D-5 + Q-12 追加裁决 |
| **I-P7** | 协同引导师 / 联合主持 = `facilitator` 的**多实例**，不是第五种角色（其中一名带 `is_host` 持最终确认权）；研究员 / 参与者 = **展示别名，不落库**；**受访者不持项目角色**（走一次性令牌） | 以「协同引导师」身份进场，断言 `project_memberships.project_role` 的值是 `facilitator`，且库中不存在任何 `co-facilitator` 字样 | D-5 · O-03 |
| **I-P8** | **一人在一个项目里恰好持有一个项目角色**（主键 `(user_id, project_id)`）；一人可在**任意多个**项目各持一个。⚠ 上限无出处 → Q-7① | 为同一 `(user, project)` 写第二行，断言主键冲突 | D-6 |
| **I-P9** | 「**没有项目角色**」是**正常状态**不是异常（`NO_PROJECT_ROLE`）；且 `projectLayer === null`（无项目上下文）与 `projectLayer.role === null`（有上下文但无角色）是**两件不同的事，禁止合并** | 构造「非项目请求」与「项目请求但无角色」两次调用，断言两者响应体**可区分** | D-7 · D-8 |
| **I-P10** | 项目角色的动作词表**已是闭集（15 条）**，且**已包含环节推进**（`stage.advance` 等 5 条引导师动作）。⇒ 本束**不得重新讨论「环节要不要有状态」这个前提**，只能讨论状态机长什么样 | 以 `groupLead` / `member` / `observer` 调 `stage.advance`，断言三者均被拒且 `reasonCode === "PROJECT_ROLE_INSUFFICIENT"` | D-9 |
| **I-P11** | `observer` 的动作集合**恰好** `["read.published"]` —— 不是「不含写动作」，是**恰好等于**（防止读动作悄悄增加）。read-only ≠ may read everything | 断言集合相等（不是子集） | D-9 |
| **I-P12** | 角色矩阵**必须引用，不得抄**。该文件自己声明将来要「**移进** `packages/contracts` 而不是复制一份」 | 断言本束代码里不存在第二份 `PROJECT_ACTIONS` 常量 | D-9 |
| **I-P13** | 绑定动作**复用矩阵里已有的 `group.submitOutput`，不许新造动作 id**（「A new action id would amend a bundle that is already signed」） | 断言闭集动作词表的成员数与已签契约一致 | D-10 |
| **I-P14** | 「谁能创建项目」已有答案：**组织角色 `lead`**（其职责逐字写着「创建与管理项目」）。但组织角色 `lead` **不自动带来项目内容读取权**——「管理员不是超级用户」是同一条规则 | 以 `lead` 且无项目角色调 `readContent`，断言被拒且 `reasonCode === "ADMIN_NOT_SUPERUSER"` 语义等价的码 | D-11 · D-18 |

---

## 三、议程环节（出处 → D-12 … D-16）—— **本束最硬的债，2026-07-30 已裁**

> **Q-2 三个待答全部采纳推荐**（yanbin shen，2026-07-30）：
> ① **建独立表** `agenda_segments`，并给 `artifact_bindings.step_id` **补外键**；
> ② **四态 + `mergedInto`**：`pending` / `active` / `closed` / `skipped`，
>    `closed` 与 `skipped` 均可带 `mergedInto`；
> ③ `acceptedSources` **默认全接受**（空数组 = 不限制），**且必须配反证**。
>
> **归属**：议程环节挂 **`workshops`**（`agenda_segments.workshop_id → workshops(id)`）。
> 依据两条：Q-12 必裁三件之 2 逐字「议程环节挂在哪一级：**项目**」，
> 且人类同日追加「议程环节、分组、现场协作……**本来就是工作坊的机件**」。
> ⚠ 在 D 下这两句不冲突：`workshops.id ≡ projects.id`，
> 所以 `bindToProjectStep` 的 `(projectId, agendaSegmentId)` 里那个 `projectId` 仍是容器 id。

| # | 不变量 | 怎么断言 | 出处 |
|---|---|---|---|
| **I-P42** 🔴 | **`agenda_segments` 是独立表**（Q-2① 裁 A），且 `artifact_bindings.step_id`（改名后 `agenda_segment_id`）**有外键**指向它。⇒ 两个已签失败码从「不可评估」变为**可评估**；孤儿绑定**不可能存在** | 断言外键存在（`information_schema.table_constraints`）；插入指向不存在环节的绑定，断言**外键冲突**。⚠ 反证：同时插入一条指向**存在**环节的绑定并断言成功——只有前者时「所有绑定都拒绝」的实现也全绿 | Q-2① 裁决 A + Q-8 裁决 2 |
| **I-P43** | **四态 + `mergedInto`**：`pending` / `active` / `closed` / `skipped`；`skipped` 与 `closed` 均可带 `mergedInto` 外键（指向并入的目标环节）。⚠ **不得**退化成 `startedAt/endedAt` 时间戳——与 uc-1-4:98「失效条件是**流程节点**……**不是时间点**」正面冲突 | CHECK 成员集**逐个等于**契约 zod 枚举（技法同 0006/0008）；断言 `mergedInto` 只在 `closed`/`skipped` 上可非空 | Q-2② 裁决 B |
| **I-P44** 🔴 | **同一工作坊内 `active` 的议程环节至多一个**，且这条要做成**数据库层的部分唯一索引**而非应用层规则——「议程环节状态是三视角首屏的**唯一驱动源**」这句话**只有这样才是可断言的** | `CREATE UNIQUE INDEX … ON agenda_segments (workshop_id) WHERE state = 'active'`；并发推进两条，断言恰好一条成功。⚠ 反证：断言**能**把某一条置为 `active`（否则「谁都不能 active」的实现也全绿） | Q-2② 裁决 B + D-15 |
| **I-P45** | **`acceptedSources` 默认全接受**（空数组 = 不限制），由蓝本的「材料要求」投影而来。⚠ **默认全接受 = 这道门默认不生效** ⇒ **必须**同时有「至少一个环节配置了非空白名单」的反证测试 | 见 `usecases.md` V5：⑴ 配非空白名单的环节拒绝不在名单内的来源；⑵ **同一环节**接受名单内的来源。缺 ⑵ 时「永远拒绝」全绿；缺 ⑴ 时这道门是空的 | Q-2③ 裁决 |
| **I-P15** | **绑定的身份是 `(artifact, project, step)` 三元组**，`stepId` **非空**；唯一约束 `UNIQUE (artifact_id, project_id, step_id)` 允许同一 artifact 钉到**多个环节的不同版本** | 断言唯一约束存在且允许多环节多版本 | D-12 |
| **I-P16** | **现状**：`steps` 表不存在，`step_id` 无外键，只保证非空串，两个失败码今天不可评估。**裁决后**（Q-2① A + Q-8）：建 `agenda_segments` 表 + 补外键 ⇒ 见 **I-P42**。⚠ 补外键的迁移**新增一支**（下一个可用序号是 **`0018-*`**，因为 `0016` / `0017` 已被 F13 / F17 占用），**不改已 passing 的 `0008`** | 见 I-P42 | D-13 + Q-8 裁决 2 |
| **I-P17** | **拒绝用「永远说 open 的可空查表」假装覆盖这两个失败码。** 迁移注释逐字：*a check that cannot fail is worse than an absent one, because it reads as coverage.* ⇒ 交付时**必须双向断言**（closed 拒绝 **且** open 通过） | 见 `usecases.md` V4 / V5：两条都要，只有前者时「永远返回 STEP_CLOSED」的实现也会全绿 | D-13 |
| **I-P18** | **环节有状态**，且已有两条跨模块规则以它为前提：⑴ 临时提权「环节 3 结束自动失效」——失效条件是**流程节点不是时间点**，且**被提前结束 / 被跳过 / 被合并**三种情形同样立即失效，收回必须由服务端在**状态机变更时主动**做；⑵ 议程环节状态是**三视角首屏的唯一驱动源** | ⑴ 授临时读权 → 分别以正常结束 / 提前结束 / 跳过 / 合并四种方式终结环节，断言四种均立即失效；**再**断言环节仍进行时该权限有效（缺反向断言时「从不授权」的实现也全绿）。⑵ 断言同一项目内 `active` 环节**至多一个**（建议做成 DB 部分唯一索引而非应用层规则——「唯一驱动源」只有这样才可断言） | D-15 |
| **I-P19** | **环节归属可以为空**（文件浏览器侧「所属环节可空，显示『—』而非留白」，并给未绑定者一个「未归入环节」节点）。这与 I-P15 并不矛盾（一个 artifact 可以有零条绑定），但**读法不唯一** → Q-8 | 断言「未归入环节」分组的成员恰好是零绑定的 artifact | D-16 |
| **I-P20** | 字段名单源：议程环节一律 `agenda_segment` / `agenda_segment_id`（**D-03a**，已确认有效）。**且 Q-3 B 裁 ①「改名对齐」** ⇒ phase-00 已落库的 `step_id` / `stepId` **改名为** `agenda_segment_id`，已实现的闭集动作词 `stage.*` **改名为** `agendaSegment.*`。⚠ 这是**修订已签核束**（phase-00 `artifact` + `identity`），签核动作 | 一条 grep 门控（形如 `no-forbidden-routes.test.ts`）断言**三个败选名**（`agenda_stage` / `step_id`·`stepId` / `stage.`）在全仓不再出现。⚠ 反证：断言该门控对一个**故意植入败选名的字符串**返回失败（否则一个「什么都不扫」的 grep 也全绿）。波及的真实文件清单与出现次数见 [`MIGRATION-IMPACT.md`](./MIGRATION-IMPACT.md) 第二节 | D-14 + D-03a + Q-3 B 裁决 ① |

---

## 四、项目与内容的关系（出处 → D-17 … D-21 + D-17b）

| # | 不变量 | 怎么断言 | 出处 |
|---|---|---|---|
| **I-P21** | **项目不是内容的必需容器。** `Artifact.projectId` 可空（「Studio 可独立发起、不依赖项目」），`saveDraft.in.projectId` 亦可空，Context Pack 侧「不属于任何项目」是**一等范围**。⇒ 本束**不得假设「所有 artifact 都有项目」** | 断言 `projectId = null` 的 artifact 可保存、可被 Context Pack 以「不属于任何项目」范围装载 | D-17 · D-17b(a) |
| **I-P22** | **Q-10 已裁 A**：把 `readContent.in.projectId` **放开为 `nullable`**，且**作为契约缺陷报告提给 phase-00 `artifact` / `identity` 两束的签核人**，**不由实现者顺手改**。连带已定：无项目时 `projectLayer = null`（I-11），即只走组织层 + 个人层 | 裁决落地后：断言 `projectId=null` 的 artifact **可被 `readContent` 读回**，且响应里 `projectLayer === null`（**不是 `projectLayer.role === null`**，两者禁止合并，见 I-P9） | D-18 · D-17b · Q-10 裁决 A |
| **I-P23** | **Q-11 已裁 ②**：**Studio 一等，可选关联项目**（`projectId` 可空 + 事后 `bindToProjectStep`）。⚠ 但 `Studio` 在契约里**仍不是任何实体**（全文只在 4 处注释出现）——裁 ② 规定的是**关系**，没有规定要新建 `Studio` 实体。**不得**从这条裁决反推「要建 Studio 表」 | 断言 `packages/contracts` 里仍不存在 `Studio` 实体；断言无项目归属的产出可保存、可事后挂载 | D-17b(b) + Q-11 裁决 ② |
| **I-P23b** | ⚠ **Q-11 的连带三问在裁决块里是空的**：⑴ 无项目归属的 artifact 怎么读回（**已由 Q-10 A 答**）；⑵ **Studio 产出进项目的路径唯一吗**（推荐写「唯一」并加断言「不存在第二条挂载路由」）——**空**；⑶ **概览是否展示未绑定产出**（与 Q-6② 同裁）——**空** | ⑵⑶ **待裁 → Q-11 连带 2 / 3**。裁决前不写断言 | Q-11 裁决块 `:877-878` 两格空白 |
| **I-P24** | **项目侧回流列表的路由、字段、徽标、空态、失败码已定，不可再自行发明**：`GET /projects/:projectId/backflow` → `BackflowEntry[]`；`mode/version/pinnedBy/pinnedAt` **四字段非空**；`badge` 是三值闭枚举；**草稿不在此列表**；空态返回 `[]` 且**不生成伪数据** | 任取一条 `pinned` 绑定断言四字段非空 + 徽标 ∈ 三取值；以**非创建者**（含项目管理员与组织 `admin`）查列表断言 draft 条目数为 **0**；新建项目断言返回 `[]` 且响应体**不含任何示例条目** | D-19 |
| **I-P25** | **只有 `pinned` 版本能被下游引用**（I-14）；**固定快照不可降级、不可删除、不可修改**（I-11，任何接口）；`draft` 模式**不产生项目侧绑定行** | 断言下游引用非 pinned 版本被拒；断言删除/修改快照的任何路径被拒 | D-20 |
| **I-P26** | 项目内容的可见性**沿数据链路传播，且只收紧不放宽**——交集生成内容的权限取**所有来源中最严格**的一档（**不是最宽松，也不是并集**） | 构造多来源合成内容，断言其可见性等于最严格来源 | D-21（I-13 / I-7） |

---

## 五、项目与组织（出处 → D-22 … D-25）

| # | 不变量 | 怎么断言 | 出处 |
|---|---|---|---|
| **I-P27** | 切换组织**必须清空全部项目级上下文**（当前项目 / 当前环节 / Context Pack / 鉴权缓存 / 未提交草稿）+ 清空组织级能力解析 + 权限按新组织**重新求值**。⇒ 契约里**已经存在「当前项目」与「当前环节」两个会话级概念**，本束**不得另起一套会话状态** | 切换组织后立即请求上一个组织的项目，断言被拒，且三条副作用**逐条**断言（任何缓存的判定都未被复用） | D-22 |
| **I-P28** | 组织停用会把项目一起**冻成只读**（做在 PG 的 RESTRICTIVE 策略里，`projects` 在受管表清单内）。⇒ **项目已经有一种只读形态，但它来自组织层，不是项目自己的状态** → Q-5 | 把组织置为 `disabled`，断言项目的任何写入被 PG 策略拒绝，且**读仍可用**、界面显示只读原因而非隐藏 | D-23 |
| **I-P29** | 「删除组织」API 已裁决**不提供**；**Q-9 已裁：「删除项目」同样不提供**，并照抄 N-5 加断言。⇒ 落点见 **I-P40**。⚠ 级联事实不变：`groups` / `project_memberships` / `artifact_bindings` 是 `ON DELETE CASCADE`，`artifacts` / `segment_text` / `claims` / `admin_project_access` 是 `SET NULL` 或 CASCADE ——**如果谁加上删除，级联会静默清掉或摘掉一批行**，这正是要守着它不存在的原因 | 见 I-P40 | D-24 + Q-9 裁决 |
| **I-P30** | **快照不可删 vs 合规撤回必须删**（X-4）：豁口**只留给合规撤回**，且必须同时作用于 S3 与 PG，下游**标失效而非静默消失**。⚠ 它依赖 **O-39 法定留存清单**，而那份清单**不存在**（代码里 `legalHoldCategories: {known:false}`，取值**抛错而非放行**） | ⇒ **任何「项目结束后清理内容」的设计在 O-39 给出之前都没有判据。** 断言取 `legalHoldCategories` 抛错（不许有人给它编一个默认值） | D-25 |

---

## 六、项目在界面上的形状（出处 → D-26 · D-27）

| # | 不变量 | 怎么断言 | 出处 |
|---|---|---|---|
| **I-P31** | 项目页有**两层身份条**（形如「顾问 · 能源组 ｜ 本项目：组长 · 第 2 组」）；**非项目页不得出现** `role-bar-project` / `role-preview-switcher` / `topbar-project-context`（这是 I-11 的界面投影，已有机械门控）。⇒ 项目域的 UI **只能在此之上做加法** | 在非项目页断言三个 testid **均不存在**（复用 `verify-ui-states.sh` 反向段） | D-26 |
| **I-P32** | 保留 testid 是**单源**，本域新增屏必须进那张表。⚠ 该清单**手维护**，已被登记为漂移候选并注明「phase-01 屏数增长后风险放大」——而本域一次加 7 个标签页 | 任一保留 testid 缺失 / 互斥破坏 / 项目层泄漏到非项目页 → `exit 1` | D-27 |

---

## 七、一句话总结：哪些人类改不了

1. **项目必属于恰好一个组织**（外键，已落库，跨组织不可表达）。
2. **项目角色恒为四种**，一人一项目一角色，「无角色」是正常状态且必须与「无项目上下文」可分辨。
   ⚠ **2026-07-30 收窄**：这四种角色**只属于工作坊**。
3. **绑定的身份是 `(artifact, project, agenda_segment)` 三元组**，环节 id 非空；
   `agenda_segments` 表**将由本束建立**并补外键，两个已签失败码由此变为可评估。
4. **环节可被推进**（动作词已在闭集里，已签核；Q-3 ① 裁「改名对齐」后为 `agendaSegment.advance`）。
5. **只有固定快照能被下游引用；固定快照不可删改降**。
6. **切换组织必须清空「当前项目 / 当前环节」**——这两个会话概念已存在于契约。
7. **项目侧回流列表的路由、字段、徽标、空态、失败码已定。**
8. **项目页两层身份条已定并有机械门控。**
9. **`projects(id)` 的 7 条现有外键一条不改**——这是候选 D 被选中的首要理由。

## 八、12 条裁决之后，**仍未裁**的部分（逐条，不发明）

> ⚠ 本仓有过「有人编了一个数值制造出已算过的假象」的事故
> （`phases/phase-00-shared-kernel/design-coherence.md:200`）。
> 下列每一条在裁决到达前**不写断言、不写字段、不写默认值**。

| # | 仍未裁的 | 登记处 | 阻塞谁 |
|---|---|---|---|
| **U-1** 🔴 | **研究项目与用户洞察各自的成员模型**（四种项目角色不适用，那用什么？还是没有成员？） | Q-12 连带 2 后半（人类只答了「不适用」，没答「那是什么」） | `research_projects` / `user_insights` 两张子表的形状；`itv` 束的权限投影 |
| **U-2** 🟠 | **归档的四个连带行为**：可逆？进行中的环节怎么办？归档容器的 artifact 还能被下游引用？Context Pack 召回吗？ | Q-5 裁决块四格空白 | I-P39、`UC-P4`、跨束 X-16 / X-18 |
| **U-3** 🟠 | **Studio 产出进项目的路径唯一吗**；**概览是否展示未绑定产出** | Q-11 连带 2 / 3 空白 | I-P23b、`UC-P3` |
| **U-4** 🟡 | **`admin` 能否创建项目**（`lead` 已定，`admin` 未定；⚠「能创建」与「能读内容」是两件事） | Q-1 连带 2（裁决块只勾了主问） | `UC-P1` |
| **U-5** 🟡 | **空项目能否事后补套蓝本、已有内容如何合并** | `uc-2-2:418` 的 `[待确认]`（本域不重复提问） | `UC-P1` |
| **U-6** 🟡 | **准备度百分比的计算口径** | `uc-2-2:419-420` 的 `[待确认]` | `UC-P3`；⚠ **不要在本域编一个分母** |
| **U-7** 🟡 | **非工作坊容器下能不能有分组 / 能不能写 `project_memberships`** | Q-12 连带 2 的下游，无登记处 —— **本文新登记** | I-P6 · I-P37 |
| **U-8** 🟡 | **`acl_bindings.object_kind` 在 D 下要不要加值**（连带 1 说加 2 个，连带 4 的 D 使它不必要） | Q-12 连带 1 vs 连带 4 —— **本文新登记** | I-P35；⚠ 它决定要不要修订 phase-00 已签的 `identity` 束 |
| **U-9** 🟡 | **`projects.kind` 判别列是否可接受**（本文为保证 1:1 而提出，不在裁决原文里） | **本文新登记**，见 §一之三第 2 小节末尾 | I-P34 —— 不接受则 1:1 只能靠测试层断言 |

⚠ **U-7 / U-8 / U-9 是本文新提出的三个洞。** 它们不是「12 条没答完」，
是**裁决落地时才浮出来的下一层问题**。按本仓纪律，它们应回流进
`OPEN-QUESTIONS.md`（**由人类或 requirement-author 做，本文无权改那份文件**）。
