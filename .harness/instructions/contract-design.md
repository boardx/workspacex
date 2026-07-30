# 契约先行的设计流程（ADR-020 + ADR-023 的执行书）

> 渐进式披露第 3 层。**开工前读这份**——它规定 feature 从「已生成」到「可开工」之间要做什么。
> 决策依据见 `docs/adr/ADR-023-unified-signoff.md`（签核面的权威）与
> `docs/adr/ADR-020-phase-design-signoff.md`（为什么要有这一层），这里只讲怎么做。
>
> **签核面 = 三件，签在一处**：UI / 用例 / API 契约，全在束目录下同一份
> `design-signoff.md` 的三节里。`domain.md` 与 `coverage.md` 是**必备支撑材料**——
> 不属于「签核面」这个对外名词，但**脚本继续强制它们存在**（见 §一「每束的产出」）。

## 为什么有这一层（一句话）

**UC 说清了「用户要什么」，UI 说清了「长什么样」，但两者都没定「前后端之间的契约」。**
而契约会在画界面时被顺手创造出来——mock 是手写的，它对自己永远自洽，
所以界面跑得通不等于契约成立。

已经发生过的实例：机密数据的模型路由规则住在 `lib/mock/chat.ts`、
组织类型与模型策略住在 `lib/identity.ts`、丢弃原因枚举住在 `lib/omission-reason.ts`。
**它们都是后端契约，却从未作为契约被评审。**

---

## 一、契约束（contract bundle）

### 怎么切
按**能力域**切，不按模块切。判据是「**这些东西的不变量互相依赖吗**」——
互相依赖的必须同束，否则会出现「A 束签了，B 束签的时候发现 A 的不变量不成立」。

phase-00 的**六个束**（试点，磁盘为准：`phases/phase-00-shared-kernel/contracts/`）：

| 束 | 覆盖的 feature | 依据 UC | 点 | 核心不变量 |
|---|---|---|---:|---|
| `identity` 身份与权限 | F01 F02 F03 F15 F16 F17 | uc-0-3 + uc-0-5 | 33 | 两层交集鉴权；RLS 强制；管理员不是超级用户；本地组织三条硬隔离 |
| `artifact` 原件·版本·绑定 | F04 F05 F06 F07 F08 | uc-0-1 | 21 | 原件不可变；更新走新版本；SHA-256 可校验；固定快照绑定后上游变化不改写它 |
| `context-pack` 上下文装配 | F09 F10 F11 F12 F13 | uc-0-2 | 21 | 引用必可定位；丢弃清单可查带原因；同 run id 可重放 |
| `web-kernel` 前端内核 | F14 | uc-0-4 | 13 | 设计 token / 字号档位单源；七态固定保留名 |
| `api-kernel` 后端内核与运行时门控 | F18 | uc-0-6 | 13 | 洋葱依赖只向内；响应体也受契约校验 |
| `auth` 注册与登录 | F19 F20 F21 F22 | 01-auth/uc-1-5 + uc-1-1 | 12 | 邀请码一次性；会话与组织归属绑定（自 phase-01 迁入） |

合计 **113 点 / F01–F22 = phase-00 全量**，无遗漏、无重叠。

> ⚠ **此表是派生视图，不是权威。** 权威是各束 `design-signoff.md` 的 frontmatter
> `covers:`（ADR-023 决策三）。改束的覆盖范围改那里，**不要**只改这张表——
> 「同一事实声明在两处」是本仓最高发的缺陷。

> ⚠ **`binding` 曾被单独列为一个束，后并入 `artifact`。** 判据就是上面那条：
> 它只有 F06 一个 feature，与 artifact 共用同一份 UC（uc-0-1），
> 且它的不变量（固定快照绑定后上游变化不改写它）**依赖** artifact 的不变量（版本不可变）——
> 拆开会出现「artifact 束签了，binding 束签的时候发现前者的不变量不够用」。

### 每束的产出

放在 `phases/<phase>/contracts/<bundle>/`：

```
phases/phase-00-shared-kernel/contracts/identity/
  ui.md              签核① UI：界面落点 + 引用 phases/<phase>/ui-preview/ 截图
  usecases.md        签核② 用例接口：application 层的输入/输出端口 + 失败模式
  domain.md          支撑：领域模型——实体、值对象、**不变量**
  coverage.md        支撑：UC 覆盖证明——UC 的 R12 → API 操作 → 前端消费点
  design-signoff.md  签核状态（人类改，agent 不许改），frontmatter 带 covers: [F01, …]
```

> ⚠ **机械门控对 `ui.md` 的强制范围只到 `roadmap.yaml` 里 `has_ui: true` 的阶段。**
> `requiredBundleFiles()`（`.harness/scripts/lib/design-signoff.ts`）是这条的唯一实现，
> `verify-uc-coverage` / `new-sprint` / `claim` / `doctor` 都读它。
> phase-00 没有 `has_ui`（它是共享内核，零界面），因此它的六个束不因缺 `ui.md` 被拦。
> 有界面的阶段（01/02/03）建 `contracts/` 目录那一刻，这条对它们全部束生效。
> 写在这里是因为「文档要求」和「脚本强制」不一致时，本仓的纪律是**以脚本为准**——
> 没有脚本的规范条目视为未落地。

**签核③ API 契约不住在束目录**，它住在 `packages/contracts/src/<bundle>.ts`（zod 单一事实源），
因为它要被后端、前端、mock、OpenAPI 同时 import——放进 `phases/` 下就无法被代码引用。

> ⚠ **旧版本本文件写的 `api.contract.ts` 是错的：全仓不存在任何 `api.contract.ts`。**
> 真实位置见上（`packages/contracts/src/artifact.ts`、`identity.ts`、`auth.ts`、
> `context-pack.ts` …）。束名与文件名对齐；新束加文件时同时在 `src/index.ts` 导出。

#### 签核① `ui.md` —— 人看到的界面对不对

写这一束的**界面落点**：路由、关键组件、稳定 `data-testid`，并逐条引用
`phases/<phase>/ui-preview/` 下的截图。UI 由 **ui-prototyper** 用 `apps/web` 真实组件 + mock 做出来
（ADR-003），但**签核动作不再单独发生在 phase 级 `ui-signoff.md`**，
而是作为 `design-signoff.md` 的第一节被人类确认（ADR-023 决策一）。

> ⛔ **phase 级 `ui-signoff.md` 已于 2026-07-30 停用。** `lib/ui-signoff.ts` 与
> `assertUiSignedOff` 已删除，`new-phase --ui` 不再产出该文件。
> phase-01/02/03 那三份保留为档案，**改它们的 `status` 不产生任何门控效果**
> （`design-signoff.test.ts` 有一条测试钉住「harness 可执行代码里不存在任何对它的引用」）。
> 束级 `design-signoff.md` 是**唯一**的签核门。

> ### 截图材料完整性由 `lint-ui-material.mjs` 机械门控（2026-07-30 起）
>
> 命令：`node .harness/scripts/lint-ui-material.mjs`（已接进 `pnpm -w run verify:base`
> 与 `harness-verify.yml` 的 PR 门控）。它对每个 `contracts/<束>/ui.md` 断言：
> **引用的截图集合 == 对应 `ui-preview/<目录>/` 里实存的 png 集合**——
> 双向、逐张、点名到具体路径/文件名。
>
> 三条写作约定，违反会红：
> 1. **束↔截图目录的映射只声明在 `.harness/scripts/ui-material-map.json`**（唯一事实源）。
>    四个束目录名与束名不同（`interview`→`itv-v2`、`recording`→`rec`、`skills`→`skill`、
>    `templates`→`tpl`），所以门控**不猜同名**；新束不补映射 = 报「未声明」，不是静默跳过。
> 2. **缺口条目（`⚠ 未产出：…`）不得写成 `.png` 路径。** 缺口是文字，不是链接——
>    写成 `foo.png` 会被判为死链。正确写法：去掉 `.png` 后缀，用文字描述缺哪张。
> 3. **顶部那行「本文件引用 N 张，目录实存 M 张」的自检必须存在，且数字被机械核对。**
>    它是同一事实的第二份副本，不核对就一定漂移。
>
> ⚠ 别再手写 grep 去数截图：文件名含中文，`[a-z0-9-]+\.png` 那类正则会对每个束返回
> **0 处命中**而看起来「全绿」——2026-07-30 已真实发生过一次，错数字还被上报了两次。

#### 支撑材料 `domain.md` —— 最内层，不依赖任何人

写实体、值对象，**重点是不变量**。不变量的判据：**它在任何时刻都为真，违反即数据损坏**。

```
不变量 I-1：artifact_version 一经写入，其 content_hash 永不改变
不变量 I-2：任一 acl_binding 的 subject 与 object 必属同一 organization
```

⚠ 不要写「应该」「建议」——那些是规则不是不变量。不变量必须能写成断言。

⚠ **`domain.md` 不在签核面里，但不许删。** zod 能写 `reason: enum(7)`，写不了
「这个枚举是封闭的，新增必须走 ADR」——ADR-020 举的四个事实上的后端契约
**没有一个是 API 形状问题，全是不变量问题**。删掉它，「同一事实两处声明」失去唯一收敛点。
理由全文见 ADR-023 决策二。

#### 签核② `usecases.md` —— 中层，定义端口

每个用例一段：输入、输出、前置条件、失败模式。
**失败模式要穷举**——「失败长什么样」是契约的一半，界面靠它渲染异常态。

```
UC: 把 Studio 产出保存回项目
  in:  { studioRunId, projectId, mode: "draft"|"live"|"pinned" }
  out: { artifactId, versionId, contentHash }
  pre: 调用者在该项目有写权限（两层交集）
  err: NO_PROJECT_ROLE | STUDIO_RUN_NOT_FOUND | PINNED_REQUIRES_SNAPSHOT
```

#### 签核③ `packages/contracts/src/<bundle>.ts` —— 唯一事实源

zod schema。**这一份生成四样东西**：

```
  packages/contracts/src/<bundle>.ts（唯一事实源）
     ├─→ 后端 DTO + ValidationPipe 运行时校验
     ├─→ 前端 client 类型
     ├─→ OpenAPI（对外文档 + 契约 diff 门控）
     └─→ 前端 mock 数据          ←── 这条是关键
```

⚠ **mock 必须从契约生成，不许手写。** 本项目已五次因「同一事实声明在两处」而漂移
（设计 token / 字号档位 / 丢弃原因枚举 / 撤回链 SLA / 估点）。手写 mock 是第六次。
从契约生成后，**前端自动成为契约的第一个消费者：契约错了界面当场崩**，而不是等到联调。

#### 支撑材料 `coverage.md` —— 横切，证明接口够用

一张表，每行一条 UC 的 R12 验收线索：

| UC / R12 条目 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|
| uc-0-1 V3 固定快照不可变 | `POST /artifacts/:id/versions` | `/projects/[id]/files` `files-version-drawer` | ✅ |
| uc-0-2 V6 同 run id 可重放 | `GET /context-packs/:runId` | `/brain` `brain-context-pack` | ✅ |

**两个方向都要查**：
- **UC → API**：有 UC 的验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：有 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

⚠ **`coverage.md` 不在签核面里，但不许删。** 它是唯一做**双向**检查的一件——
UI / 用例 / API 三件各自都无法自查这个性质（ADR-023 决策二）。

---

## 二、洋葱架构与依赖方向

```
apps/api/src/
  domain/           实体 / 值对象 / 不变量      —— 不 import 任何外层
  application/      用例 / 端口（interface）    —— 只 import domain
  infrastructure/   PG / S3 / 模型网关          —— 实现 application 的端口（依赖倒置）
  interface/        NestJS 控制器 / DTO / 路由  —— import application，不直接碰 infrastructure
```

⚠ **洋葱的全部价值在「依赖只能指向内层」这一条，而它可以机械检查。**
只分目录不查依赖方向 = 四层文件夹 + 零收益。故 `lint-arch-deps` 是强制的。

**为什么 `infrastructure` 不算违规**：它 import `application` 的端口接口去**实现**它，
控制流向外、依赖向内——这就是依赖倒置。脚本对它单独放行，但仍禁止它 import `interface`。

---

## 三、三道门控

| 门控 | 命令 | 检查什么 |
|---|---|---|
| 依赖方向 | `node .harness/scripts/lint-arch-deps.mjs` | 依赖只能指向内层；`domain` 干净 |
| 契约单源 | `node .harness/scripts/lint-contract-source.mjs` | mock 带生成标记且与 schema 一致；无手写第二份类型 |
| UC 覆盖 | `pnpm exec tsx .harness/scripts/verify-uc-coverage.ts <phase>` | 每条 R12 都有 API 与前端消费点；无孤儿 API |

加上既有七道（typecheck / lint-design / lint-dead-controls / lint-omission-reason /
lint-withdrawal-flow / check-token-contrast / verify-ui-states）与 `validate-fl`。

---

## 四、签核流程（人类的动作，agent 不许代劳）

1. agent 产出三件签核材料 + 两件支撑材料 → `design-signoff.md` 的 `status: pending`，
   frontmatter 写 `covers: [F01, F02, …]`（束↔feature 映射的**权威**，ADR-023 决策三）。
2. **人类**在同一份 `design-signoff.md` 里逐节确认三件，重点看：
   - **① UI**：界面落点与截图对不对
   - **② 用例**：**失败模式**穷举了吗（界面的异常态靠它）
   - **③ API 契约**：对外形状与错误码对不对
   - 顺带核支撑材料：**不变量**是不是真的不变量（能写成断言吗）；**coverage 的两个方向**都查了吗
3. 人类把 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`
   （**ISO 8601，且不得晚于当下**——现存 `auth` 束有一个 `2026-07-30` 的未来时间戳待更正）。
4. 全部束签完后，做**阶段一致性复核** → `phases/<phase>/design-coherence.md`，
   其 frontmatter 必须写 `covers_bundles: [...]`，**声明的束集合 ⊇ 本阶段全部束**（ADR-023 决策四）。
5. 门控：feature 所属束已签 ∧ 一致性复核覆盖并通过，否则拒绝。
   门守在 `new-sprint` **和 `claim`**（真正的开工动作是 claim），`doctor` 另有签核链体检。

### 签核状态受机械保护（ADR-023 决策五）

`design-signoff.md` / `design-coherence.md` 的 `status:` 是整条签核链**唯一的信任根**。
它由 `.github/CODEOWNERS` 指给人类，CI 检查「改了 status 行且提交者不是 CODEOWNERS ⇒ 失败」。
**agent 一次 `Edit` 就能把 pending 改成 confirmed**——这就是为什么它必须被机械保护，
而不是靠本文件写一句「不许改」。

### 门控的三条实际行为（脚本在做、以前文档没写）

以下三条是 `.harness/scripts/lib/` 里已经在执行、而 ADR-020 / ADR-003 从未写过的：

1. **没有契约束 ⇒ 静默放行，但 `has_ui: true` 的阶段除外**（2026-07-30 收口）。
   `auditSignoff` 在 `readBundleSignoffs` 返回空数组时返回 `applicable: false`。
   理由是不追溯拦住 2026-07-28 之前的阶段；**代价是这成了新阶段的默认逃生口**——
   一个阶段只要不建 `contracts/`，签核门对它等于不存在。
   ⚠ **`has_ui: true` 的阶段没有这个逃生口**：零契约束 ⇒ **判失败**，
   报「本阶段标了 has_ui 却没有契约束，按 ADR-023 它无法被签核；建 contracts/ 或把 has_ui 撤掉」。
   这条是 ADR-023 决策一落地时补的——撤掉 phase 级 UI 门的同时若不堵这里，
   phase-02/03 会从「有门」变成「无门」（收敛前 `claim --phase 02` 实测已经放行）。
2. **feature 必须属于某个束，否则失败。** 不属于任何束**不是「无需签核」而是拒绝**：
   报「`Fxx` 不属于任何契约束 —— 无法确认它的设计被评审过」。
3. **束签核即便 `confirmed` 也可能不放行。** `auditSignoff` 的第 ⓪ 条先跑
   `hasRequirementsCoverage`：该阶段 `requirements/` 若没有真实 story 覆盖（全是裸模板），
   直接拒绝。人类拍板 2026-07-19：**「设计对不对」不能替代「这块设计背后有没有一个真实需求」。**
   ⚠ 这条原先住在已停用的 `assertUiSignedOff` 里、只管 `has_ui` 阶段；
   2026-07-30 随门收敛搬到束级，适用面扩到**任何采用契约束流程的阶段**。

### 阶段一致性复核查什么

**只查交叉约束**——单束内的问题在签束时已经看过了。

- **同一事实是否在多束中被重复定义**（这是本项目最高发的缺陷）
- **跨束的不变量是否互相矛盾**（例：`identity` 说管理员看不到个人层，
  `context-pack` 的召回是否绕过了它）
- **跨束的级联是否闭合**（例：撤回链跨 4 个模块，每一环都有人接吗）
- **错误语义是否一致**（同一种失败在不同束里是不是同一个错误码）

---

## 五、给 agent 的硬规则

1. **不许改 `design-signoff.md` / `design-coherence.md` 的 `status` / `confirmed_by` /
   `confirmed_at`** —— 那是人类的动作，且受 CODEOWNERS + CI 保护（ADR-023 决策五）。
2. **不许手写 mock** —— 从契约生成。发现手写的，收敛掉。
3. **不许在两处声明同一事实** —— 发现第二份副本，收敛为单源 + 加门控。
   本项目的先例：`lib/font-scale.ts`、`lib/omission-reason.ts`、`lib/withdrawal-flow.ts`
   都是这样收敛出来的，每一份都配了机械门控。
4. **不变量要能写成断言** —— 写不成断言的是「规则」不是「不变量」，别混。
5. **失败模式要穷举** —— 只写 happy path 的契约是不完整的契约。
   已有原型就是 happy path 演示、零异常态，别继承这个缺陷。
6. **响应体也要被契约校验，不只是请求体**（修订 B-8，2026-07-29 升为通用规则）。

   全局 ValidationPipe 校验的是**进来的**请求。出去的响应如果没人校验，
   ADR-020 单源链的**返回方向就是断的**——服务端返回一个契约没描述的结构，
   所有门控照样全绿，**因为前端类型也从同一份契约生成，它只会「对现实的判断是错的」，
   不会报错**。

   ⚠ 不是假设：F01 实现时，契约的 `Organization` 带 `team` 字段而仓储层的行类型漏了，
   `/identity/me` 会返回一个缺字段的 body。**在 `contract-response.test.ts` 存在之前，
   没有任何东西会失败。**

   落法：每条路由的响应体在测试里 `C.operations.<op>.out.safeParse()` 逐条断言，
   **并特别覆盖拒绝路径**（那正是 B-7 里契约写错的地方），
   外加一组反向断言证明这些 schema 确实会拒绝漂移的 body——否则整个文件可能在空转。

   ⚠ **刻意不做「响应校验管道」**：那会把一次 schema 疏漏变成生产环境的 500。
   构建期失败才是发现它的正确位置。
7. **枚举的封闭性是要守的性质，成员数不是**（修订 E-4 的教训）。
   断言写成 `toHaveLength(7)` 会让一个经 ADR 评审的正当新增被自己的测试拦下。
   要断言的是：成员集合与契约一致，且**未声明的值不能通过**。
