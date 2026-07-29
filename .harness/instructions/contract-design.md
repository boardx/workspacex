# 契约先行的设计流程（ADR-020 的执行书）

> 渐进式披露第 3 层。**开工前读这份**——它规定 feature 从「已生成」到「可开工」之间要做什么。
> 决策依据见 `docs/adr/ADR-020-phase-design-signoff.md`，这里只讲怎么做。

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

phase-00 的五个束（试点）：

| 束 | 覆盖的 feature | 依据 UC | 点 | 核心不变量 |
|---|---|---|---:|---|
| `identity` 身份与权限 | F01 F02 F03 F15 F16 F17 | uc-0-3 + uc-0-5 | 33 | 两层交集鉴权；RLS 强制；管理员不是超级用户；本地组织三条硬隔离 |
| `artifact` 原件·版本·绑定 | F04 F05 F06 F07 F08 | uc-0-1 | 21 | 原件不可变；更新走新版本；SHA-256 可校验；固定快照绑定后上游变化不改写它 |
| `context-pack` 上下文装配 | F09 F10 F11 F12 F13 | uc-0-2 | 21 | 引用必可定位；丢弃清单可查带原因；同 run id 可重放 |
| `web-kernel` 前端内核 | F14 | uc-0-4 | 13 | 设计 token / 字号档位单源；七态固定保留名 |

合计 **88 点 = phase-00 全量**，无遗漏、无重叠。

> ⚠ **`binding` 曾被单独列为第五束，后并入 `artifact`。** 判据就是上面那条：
> 它只有 F06 一个 feature，与 artifact 共用同一份 UC（uc-0-1），
> 且它的不变量（固定快照绑定后上游变化不改写它）**依赖** artifact 的不变量（版本不可变）——
> 拆开会出现「artifact 束签了，binding 束签的时候发现前者的不变量不够用」。
> **一个束 = 一份 UC** 在 phase-00 恰好成立，这不是巧合：UC 本来就是按能力域写的。

### 每束四件产出

放在 `phases/<phase>/contracts/<bundle>/`：

```
phases/00-shared-kernel/contracts/identity/
  domain.md          ① 领域模型：实体、值对象、**不变量**
  usecases.md        ② 用例接口：application 层的输入/输出端口
  api.contract.ts    ③ API 契约：zod schema（唯一事实源）
  coverage.md        ④ UC 覆盖证明：UC 的 R12 → API 操作 → 前端消费点
  design-signoff.md  签核状态（人类改，agent 不许改）
```

#### ① `domain.md` —— 最内层，不依赖任何人

写实体、值对象，**重点是不变量**。不变量的判据：**它在任何时刻都为真，违反即数据损坏**。

```
不变量 I-1：artifact_version 一经写入，其 content_hash 永不改变
不变量 I-2：任一 acl_binding 的 subject 与 object 必属同一 organization
```

⚠ 不要写「应该」「建议」——那些是规则不是不变量。不变量必须能写成断言。

#### ② `usecases.md` —— 中层，定义端口

每个用例一段：输入、输出、前置条件、失败模式。
**失败模式要穷举**——「失败长什么样」是契约的一半，界面靠它渲染异常态。

```
UC: 把 Studio 产出保存回项目
  in:  { studioRunId, projectId, mode: "draft"|"live"|"pinned" }
  out: { artifactId, versionId, contentHash }
  pre: 调用者在该项目有写权限（两层交集）
  err: NO_PROJECT_ROLE | STUDIO_RUN_NOT_FOUND | PINNED_REQUIRES_SNAPSHOT
```

#### ③ `api.contract.ts` —— 唯一事实源

zod schema。**这一份生成四样东西**：

```
  api.contract.ts（唯一事实源）
     ├─→ 后端 DTO + ValidationPipe 运行时校验
     ├─→ 前端 client 类型
     ├─→ OpenAPI（对外文档 + 契约 diff 门控）
     └─→ 前端 mock 数据          ←── 这条是关键
```

⚠ **mock 必须从契约生成，不许手写。** 本项目已五次因「同一事实声明在两处」而漂移
（设计 token / 字号档位 / 丢弃原因枚举 / 撤回链 SLA / 估点）。手写 mock 是第六次。
从契约生成后，**前端自动成为契约的第一个消费者：契约错了界面当场崩**，而不是等到联调。

#### ④ `coverage.md` —— 横切，证明接口够用

一张表，每行一条 UC 的 R12 验收线索：

| UC / R12 条目 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|
| uc-0-1 V3 固定快照不可变 | `POST /artifacts/:id/versions` | `/projects/[id]/files` `files-version-drawer` | ✅ |
| uc-0-2 V6 同 run id 可重放 | `GET /context-packs/:runId` | `/brain` `brain-context-pack` | ✅ |

**两个方向都要查**：
- **UC → API**：有 UC 的验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：有 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

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

1. agent 产出四件套 → `design-signoff.md` 的 `status: pending`
2. **人类**逐件核对，重点看：
   - **不变量**是不是真的不变量（能写成断言吗）
   - **失败模式**穷举了吗（界面的异常态靠它）
   - **coverage 的两个方向**都查了吗
3. 人类把 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`
4. 全部束签完后，做**阶段一致性复核** → `phases/<phase>/design-coherence.md`
5. `new-sprint` 门控：feature 所属束已签 ∧ 一致性复核通过，否则拒绝

### 阶段一致性复核查什么

**只查交叉约束**——单束内的问题在签束时已经看过了。

- **同一事实是否在多束中被重复定义**（这是本项目最高发的缺陷）
- **跨束的不变量是否互相矛盾**（例：`identity` 说管理员看不到个人层，
  `context-pack` 的召回是否绕过了它）
- **跨束的级联是否闭合**（例：撤回链跨 4 个模块，每一环都有人接吗）
- **错误语义是否一致**（同一种失败在不同束里是不是同一个错误码）

---

## 五、给 agent 的硬规则

1. **不许改 `design-signoff.md` 的 status** —— 那是人类的动作（同 ADR-003 的 `ui-signoff.md`）。
2. **不许手写 mock** —— 从契约生成。发现手写的，收敛掉。
3. **不许在两处声明同一事实** —— 发现第二份副本，收敛为单源 + 加门控。
   本项目的先例：`lib/font-scale.ts`、`lib/omission-reason.ts`、`lib/withdrawal-flow.ts`
   都是这样收敛出来的，每一份都配了机械门控。
4. **不变量要能写成断言** —— 写不成断言的是「规则」不是「不变量」，别混。
5. **失败模式要穷举** —— 只写 happy path 的契约是不完整的契约。
   已有原型就是 happy path 演示、零异常态，别继承这个缺陷。
