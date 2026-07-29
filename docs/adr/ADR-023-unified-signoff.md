# ADR 023: 签核统一为三件（UI / 用例 / API 契约），并补齐签核链的机械门控

- 状态: Accepted
- 适用层：方法论（可移植：随模板打包）
- 日期: 2026-07-29
- 关系：**扩展并收敛** ADR-003（UI 先行确认关卡）与 ADR-020（阶段设计签核）。
  两者均**继续有效**，但其中「签核对象有几件、放在哪里、由什么脚本执行」以本 ADR 为准。

## 背景

2026-07-29 对签核链做了一次全面盘点。结论不是「规范写得不好」，而是本仓那条老毛病的
第 N 次复现：**规范在、脚本没有**。盘点查出十条「文档这么写、没有任何脚本执行」，
其中三条**已经失效了，不是假设**：

1. **一致性复核被当成阶段级单一布尔，而它只复核了一部分。**
   `phases/phase-00-shared-kernel/design-coherence.md` 的范围表白纸黑字写着
   4 个束 / 17 feature / 88 点，日期 `2026-7-28`；而 `api-kernel` 束签于 07-29、
   `auth` 束签于 07-30。`assertDesignSignedOff` 只读一个布尔，
   于是 **F18–F22 靠一份从没看过它们的复核解锁了开工**，其中 F19/F20/F21 已经 passing 并合入 main。

2. **签核文件没有任何保护。**
   无 `.github/CODEOWNERS`、无 hook、无 CI diff 检查。任何 agent 一次 `Edit`
   就能把 `status: pending` 改成 `confirmed` 并填一个假的 `confirmed_by`，
   `new-sprint` 立刻放行。**这是整条签核链唯一的信任根，且完全裸露。**

3. **ADR-003 想防的事已经原样发生了一遍。**
   它要防「feature_list 在任何人看到真实界面之前就被定成权威」，
   但门控只卡在 `new-sprint`（ADR-003 自己在决策段里做了这个取舍）。
   结果 phase-01/02/03 的 `ui-signoff.md` 全部 `status: pending`，
   而三份 `feature_list.json` 已经生成完毕，共 225+ 个 feature。
   爆点没有被消除，只是被推迟了。

另有一处结构性问题，是本 ADR 的直接动因：

4. **UI 签核与契约束签核分居两处，要签两次。**
   ADR-020 第 56、141 行说「UI 先行关卡成为四件套中第 ④ 件的组成部分」，
   但实现上它们是 `new-sprint.ts` 里**两条互不相干的 assert**，
   数据也在两个文件（phase 级 `ui-signoff.md` vs 束级 `design-signoff.md`）。
   **同一件事（这块设计人类看过没有）声明在两处**——本项目已因此漂移过五次以上。

## 决策

### 一、签核面收敛为三件

人类签核时要确认的是三件，**且只在一处签**：

| # | 签核对象 | 位置 | 它回答的问题 |
|---|---|---|---|
| ① | **UI** | 束目录下 `ui.md`（引用 `ui-preview/` 截图与组件落点） | 人看到的界面对不对 |
| ② | **用例（use case）** | 束目录下 `usecases.md` | 用例接口与失败模式穷举对不对 |
| ③ | **API 契约** | `packages/contracts/src/<bundle>.ts`（zod 单一事实源） | 对外形状与错误码对不对 |

签核动作落在**一个文件**：束目录下的 `design-signoff.md`，正文分三节，
对应上表三件。**不再有 phase 级的独立 `ui-signoff.md` 签核。**

### 二、`domain.md` 与 `coverage.md` 降级为「必备支撑材料」，但不得删除

它们不再属于「签核面」这个对外名词，但**脚本继续强制它们存在**。理由：

- **删掉 `domain.md` 会直接废掉 ADR-020 的立论。** ADR-020 举的四个「事实上的后端契约」——
  模型路由规则、`OrgKind`/`ModelPolicy`、丢弃原因枚举、撤回链两级 SLA——
  **没有一个是 API 形状问题，全是不变量问题**。zod 能写 `reason: enum(8)`，
  写不了「这个枚举是封闭的，新增必须走 ADR」（那正是 ADR-021 的全部内容）。
  删掉 domain，「同一事实两处声明」失去它唯一的收敛点。
- **删掉 `coverage.md` 会切断束↔feature 的映射。** `assertDesignSignedOff` 当前就是
  靠 `coverage.md` 正文那一行把束和 feature 绑起来的；删掉它，
  全部 feature 立刻变成「不属于任何契约束」而被拒。
  它同时是唯一的**双向**检查（UC 有验收线索却找不到 API ⇒ 业务跑不通；
  API 没有 UC 要它 ⇒ 接口多余），这个性质 UI/UC/API 三件各自都无法自查。

### 三、束↔feature 的映射从散文改为结构化字段

现状是 `design-signoff.ts` 用中文正则 `/覆盖 feature[：:]([^\n]+)/` 抓 `coverage.md` 正文，
再 `match(/F\d+/g)`。**契约束↔feature 的映射权威是一行散文**——
有人把那行改成「本束覆盖 Artifact 全部 5 个」就匹配到 0 个编号，
该束下所有 feature 变成「不属于任何束」；反过来正文里随手写个 `F99` 也会被吃进去。

⇒ 映射移入 `design-signoff.md` 的 frontmatter `covers: [F01, F02, …]`，散文不再是权威。

### 四、一致性复核必须声明它复核了哪些束

`design-coherence.md` 的 frontmatter 增加 `covers_bundles: [...]`，
门控要求 **它声明的束集合 ⊇ 本阶段全部束**。
不满足时明确报出「哪几个束没进过一致性复核」，而不是靠一个布尔放行。

这是对上文背景 1 的直接修法。

### 五、签核状态受机械保护

- `.github/CODEOWNERS` 把 `**/design-signoff.md`、`**/design-coherence.md` 指给人类。
- CI 增加一条：PR 若修改了上述文件的 `status:` 行，且提交者不是 CODEOWNERS，直接失败。
- 签核时间戳必须是 ISO 8601，且**不得晚于 CI 运行时刻**（现存一处 `2026-07-30` 的未来时间戳）。

### 六、签核门从「只守 new-sprint」扩到真实开工动作

「开工前必须签核」这条硬约束现在只守住 `new-sprint` 一个入口，
而真正的开工动作是 `claim`，`claim` 不问签核；
且直接手改 `feature_list.json` 的 `sprint` 字段可以把新 feature 塞进已建 sprint，完全绕过。

⇒ `claim` 增加同一道 `assertDesignSignedOff`；`doctor` 增加签核链体检
（签核链是 doctor 目前唯一没覆盖的审计链）。

## 后果

- **人类的签核动作从两次变一次**，且三件在同一份文件里逐节确认。
- **agent 不再需要判断「这个 feature 要不要 UI 签核」**：`needs_ui_signoff` 这个
  feature 级字段全仓只有 `validate-fl.ts` 读、只用来打印计数，
  87 个 feature 带着它却没有任何门控。本 ADR 之后它由束级 `ui.md` 取代，字段删除。
  **留着一个只被打印的布尔比没有更糟——它让人以为有关卡。**
- ADR-003 与 ADR-020 **都不作废**，它们记录了当时为什么这么定；
  但「签核对象有几件、放在哪、由什么脚本执行」以本 ADR 为准，两份 ADR 头部加指向本 ADR 的说明。
- **迁移成本**：现有 6 个束需要各加一份 `ui.md` 和 frontmatter 的 `covers:`；
  phase-01/02/03 的 `ui-signoff.md` 在它们建立 `contracts/` 目录时并入束级。

## 未决（需要人类）

- **phase-00 的一致性复核必须重做**：现有那份只覆盖 4 束 / 17 feature，
  F18–F22（含已 passing 的 F19/F20/F21）从未进入任何一致性复核。
  这是背景 1 的事实后果，补门控**不能**追认已经发生的放行。
- `auth/design-signoff.md` 的 `confirmed_at: 2026-07-30` 是未来时间戳，需要更正为真实签核时刻。
