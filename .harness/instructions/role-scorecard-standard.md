# 角色记分卡 —— 每个 agent 的「我现在几分、还差什么、卡在谁」

> 人类 2026-08-12 指令："让 main、domain agent、subagent 很清楚当前他们的目标是什么、
> blocker 是什么、需要谁的帮忙，一眼可以看到；同时需要有一个验收标准，每个人都知道
> 自己的现状分数、目标分数是什么。"
>
> **开工前跑一次：`pnpm harness scorecard --role <你的角色 id>`。**

## 它不是第五套评分卡

本仓已有四条 track 的判据（CLR 的 R/B、`chat-main-fidelity-rubric` 的 D/P），而
`chat-ux-acceptance-criteria.md` 自己就逐字禁止合并评分卡；本仓也已九次栽在
「同一事实声明在两处」。**本文件一个判据都不新定义。**

它补的是一格**真的没人占**的空白——实测 2026-08-12 的 main：
`grep -rln "目标分\|现状分数\|target score" .harness/instructions .harness/rubrics` **零命中**。

| 已有 | 回答的问题 | 不回答的 |
|---|---|---|
| `pnpm harness readiness` | **产品**离交付还差多少 | 我这个角色该做什么 |
| `pnpm harness dashboard` | **全局** PR 队列 / 近期合入 | 跟我有什么关系 |
| `pnpm harness board` / `task-assignment` | 活怎么分 | 干得好不好 |
| **`pnpm harness scorecard`** | **我**现在几分、还差什么、卡在谁身上 | 判据本身（那在各 authority） |

## 四层分工（刻意与 CLR 同构）

| 层 | 放什么 | 谁写 |
|---|---|---|
| **判据** | 各 rubric 自己的维度定义 | 人类 / 评分卡作者 |
| **现状分** | `core-loop-readiness.json` 等既有 state | 该 track 的**授权评分人** |
| **目标分 + 归属** | `.harness/state/role-charter.json`（**只有目标，没有现状**） | 人类 / coord-main |
| **记分卡** | `pnpm harness scorecard` 输出 | **脚本派生，禁止手写** |

### 为什么目标分与现状分必须分开放

目标分是**决策**，现状分是**测量**。混在一起，角色就能靠下调自己的目标来「达标」——
那这套 eval 当场失去意义。所以 charter 里**只准出现 target**，S3 门机械挡住任何现状字段。

同理，**被评的角色不得改自己那条的 target**（沿用 CLR G3 的精神）。

## 一屏四问

```bash
pnpm harness scorecard --role rev-e2e      # 看某个角色
pnpm harness scorecard                     # 看 charter 里全部角色
pnpm harness scorecard --strict            # doctor / CI 用：只在**记录自相矛盾**时退非 0
```

- **① 我的目标**：每条可评项的 `现状 → 目标 → 差多少`，以及**现状分为什么不是记录分**
  （原样透传 CLR 的扣分原因，如 `STALE` / `NEVER_SCORED`）
- **② 我的 blocker**：该 track 声明的 `blocking_issues`
- **③ 我在等谁**：`🔒 等人类` / `👤 等某角色` / `❗ 无人认领` / `✅ 已关闭（该摘掉）` / `❔ 查不到`
- **④ 我的下一个动作**：统一队列里**属于我**的第一条

## 七道机械门（每道都实测过反证）

charter 是手写的，所以每一条都必须被机械检查。实现在
`.harness/scripts/lib/role-scorecard.ts`，反证在同名 `.test.ts`：

| 门 | 规则 | 为什么 |
|---|---|---|
| **S1** | `owns` 为空 ⇒ 判红 | 声明了角色却不给可评项 ⇒ 它会永远 `met=true`，看起来达标其实从未被测量 |
| **S2** | 角色必须存在于 `registry.yaml` | 给一个不存在的角色发分毫无意义 |
| **S3** | charter 里出现任何**现状字段** ⇒ 判红 | 防第二事实源。漂移永远往「看起来达标」的方向走 |
| **S4** | `owns` 必须指向真实存在的可评项 | 防指向虚空（本仓已有五次「锚在不存在的 testid 上」的同型事故） |
| **S5** | `target ∈ [0, max]` | 一个永远达不到的目标 = 门废掉 |
| **S6** | `clr_track` 的 target 必须**逐字等于** `PASS_THRESHOLD` | 见下 |
| **S7** | 每个 target 必须写明 `target_source` | 目标分是**决策**，决策必须可追溯到**做决定的那个人**，否则半年后无人知道这个数字是谁拍的，也就无从推翻（coord-main 2026-08-12 裁决） |

### S7 的取值约定

- `人类裁决 #NNN` —— 人类拍板，agent 不得改
- `coord-main 代裁（可推翻）` —— 全权授权期内 coord 先定，人类醒后可推翻

### S6：允许重复，但机械钉死

合格门槛 9 是人类 #831 的裁决，单一事实源是 `core-loop-readiness.ts` 的
`PASS_THRESHOLD`。charter 里再写一个 9 **本身就是第二份副本**——本仓已五次因此漂移。
但目标分又必须**看得见**（人类原话："每个人都知道自己的目标分数是什么"），
藏进代码常量就不叫"一眼可以看到"。

解法不是二选一，而是**允许它出现，但用 S6 把两处钉死**：门槛改成 8 而 charter 还写 9，
当场判红，不会安静地漂。

## 两条诚实纪律（与 CLR 同源）

1. **查不到就说查不到。** issue 归属要联网；拿不到时整列显示「查不到」并说明原因，
   **不猜成「无人认领」**——猜出来的归属会诱导 agent 去抢一个其实有人在做的活。
2. **空着不等于满分。** 查不到判定的可评项，现状记 **0** 并标 `NO_SUCH_ITEM`，不跳过。

## 已知缺口（可见、有名字，不假装不存在）

- **v1 只实现 `clr_track` 一种可评项**，所以只有 CLR 四条 track 的负责人有分数。
  **domain coordinator 与 worker 今天没有可评分项**——不是遗漏，是 CLR 之外还没有
  任何 per-role 的量化 authority 可引用。他们仍可跑 `scorecard --role <id>` 看 ②③④
  （那三问只需要 `owner:` 标签，不需要分数）。补齐需要新增 `feature` 类可评项
  （读 `feature_list.json`），已登记，不在本轮范围。
- **`--strict` 目前未接入任何 CI 门**。接之前要先把下面两条真实不一致修掉，
  否则一上线就是红的，而"红着的门等于没有门"。

## 上线第一天就抓到的两条真实不一致

这不是 bug，是这套工具的**第一个交付物**——把隐性漂移变成显性：

1. **`rev-uiux` 是 CLR 里 V-D / V-P 的 `allowed_scorers`，却不在 `registry.yaml` 里。**
   评分授权与身份注册表对不上。
2. **`rev-e2e` 在 `registry.yaml` 里是 `active: false`**（2026-08-04 裁决："没有任何在跑的会话"），
   而它整晚都在评 R/B 并合入了 #855 / #885 / #899。注册表与现实漂了。

两条都需要**人类或 coord-main 裁决**（改 registry 还是改 CLR 的 allowed_scorers），
记分卡不替他们决定，只负责让它们不再隐形。
