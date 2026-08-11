# PROP-HARNESS-SIGNOFF-002 — claim 门认识 design-delta

状态：待人类裁决
提出：2026-08-12（dev-org-admin，coord-main 批准立案）
实测基线：`origin/main@11c32a0c`
相关：ADR-023（束级签核是唯一签核门）、ADR-020、#953（design-delta 补签先例）

## 1. 一句话

**`#953` 立的「design-delta 补签」这条路只覆盖了评审侧，`claim` 门这一侧漏了。**
结果是：只被 delta 覆盖的 feature **可以实现、可以合并、但永远转不了 `passing`**。

## 2. 这是怎么撞出来的（实测，不是推演）

2026-08-12 夜间做后台「成员与配额」真栈化。coord-main 裁决：走已签核的 `org-admin` 束，
新端点按 #953 先例走 `design-deltas/token-quota-and-usage/` 补签。五条 feature（F159–F163）
全部实现完毕、六个 PR 开好、门控全绿。收口时：

```
$ pnpm harness claim --phase 01 --feature F159 --owner dev-org-admin
✗ 设计签核未完成，拒绝开工（ADR-020 / ADR-023）：
  · F159 不属于任何契约束 —— 无法确认它的设计被评审过
```

读实现确认根因（`.harness/scripts/lib/design-signoff.ts`）：

```ts
// 第 213 行
const contractsDir = join(findPhaseDir(phaseId), "contracts");
if (!existsSync(contractsDir)) return [];
```

它**只扫 `phases/<phase>/contracts/*/design-signoff.md` 的 `covers:`**。
`phases/<phase>/design-deltas/*/design-signoff.md` 里的 `covers:` 在它的视野之外。

同文件 285–300 行的逃生口（「没有 contracts/ 目录的阶段直接放行」）对 phase-01 关闭——
它有 contracts/。`claim.ts` 里也没有 `--force` / `--skip-signoff` 一类的开关。

⇒ **这条路上没有 agent 能合法走的出口**，只能改门或改数据。

## 3. 为什么这不是「delta 机制设计如此」

`#953` 建立 delta 的理由是：一个已签核的束在落地时会撞到新端点，
**重开整束签核的代价远大于收益**，所以允许「delta 文档 + 实现并行，PR 等人类签 delta 再合」。
那次裁决解决的是**评审范围**的问题。

但 feature 的生命周期是 `claim → 实现 → verify → passing → 合入`。
`claim` 是**开工动作**，`design-signoff.ts` 的注释自己写着（第 38–40 行附近）：

> 「开工前必须签核」此前只守 `new-sprint` 一个入口，而**真正的开工动作是 claim**

也就是说，这道门当初正是为了堵住「绕过签核开工」才补到 claim 上的——
它做对了。它只是**不知道 delta 也是一种签核**。

⚠ 这恰好是 AGENTS.md 那条「**没有脚本的规范条目视为未落地**」的**镜像**：
这次反过来了——**规范（#953）已裁决，脚本没跟上**。

## 4. 提案（方案 b）

让 `loadBundles()` 同时扫两个目录：

```ts
// 语义：contracts/ 是束，design-deltas/ 是束的增量。两者的 covers 合并成同一个覆盖集。
const dirs = ["contracts", "design-deltas"].map((d) => join(findPhaseDir(phaseId), d));
```

**三条不可放宽的约束**（否则这个提案就变成拆门）：

1. **delta 必须 `status: confirmed` 才放行**。`pending` 的 delta 照拦。
   这保住 ADR-023 的核心——**签核是人的动作**，delta 也一样。
2. **delta 必须声明 `base_bundle`，且那个基座束必须存在且 `confirmed`**。
   一个凭空出现、不挂在任何已签束上的 delta 不构成签核——
   否则「新建一个 delta 目录 + 自己写 confirmed」就是一条绕过整个流程的路。
   （⚠ `status` 的写入权本来就归人类，但门不该依赖「没人会作弊」这个假设。）
3. **同一个 feature 被多处 `covers` 声明时判失败**，不是「取第一个」。
   同一事实两处声明是本仓栽过五次的那件事；这里让它当场变红。

## 5. 影响面

- **改一个文件**：`.harness/scripts/lib/design-signoff.ts` 的 `loadBundles()`。
  `claim.ts` / `new-sprint.ts` / `doctor.ts` 三个入口读的是同一个函数（该文件第 285 行注释：
  「三个入口读同一份结论，否则『同一事实声明在多处』会第 N+1 次发生」），所以只改这一处。
- **现存 delta 目录**：`phases/phase-01-run-a-project/design-deltas/` 下 **8 个**（实测）。
  **只有本轮新建的 `token-quota-and-usage` 声明了 `covers:`**，其余 7 个一个都没有
  （它们是 #953 之前/期间的形态，且部分连 `design-signoff.md` 都没有）——
  **没有 `covers:` 的 delta 不影响任何 feature 的放行判定**（`coversDeclared: false`），
  所以这个改动对它们是零行为变化。
- **不改** ADR-023 的任何一条，不改任何已签束的 frontmatter。

## 6. 反证（提案落地时必须一起写）

单靠「加了 delta 之后 claim 通过」是空转——一个把门直接删掉的实现同样能让它变绿。
四条必须同时红/绿：

| 断言 | 一个「把门删掉」的实现会怎样 |
|---|---|
| delta `status: pending` ⇒ claim **仍被拒** | ❌ 放行 → 当场红 |
| delta 无 `base_bundle` 或基座未 confirmed ⇒ **拒** | ❌ 放行 → 当场红 |
| feature 同时被束和 delta covers ⇒ **判失败** | ❌ 放行 → 当场红 |
| delta `confirmed` + 基座 confirmed ⇒ 放行 | ✅（这条是唯一的正向） |

第 1 条尤其重要：它是「签核仍然是人的动作」这句话在脚本层的落点。

## 7. 今晚的具体卡点（人类的动作包）

F159–F162 现在卡在这道门后。给人类的**一个动作包**（coord-main 已列入晨报）：

1. 签 `design-deltas/token-quota-and-usage/design-signoff.md`
   （含 §4 待裁两条：未设置额度=不限额 / 失败调用也记一行；③ 已实测解决、缺口已撤销），
   并确认它的 `covers: [F159, F160, F161, F162]`；
2. 裁决本提案（改门 or 手工把这几条加进 `contracts/org-admin/design-signoff.md` 的 `covers:`）；
3. 两步之后 claim / verify 流水线自然通，五条 feature 正常收口。

⚠ 方案 (a)（人类手工改已签束的 `covers:`）**今晚就能解卡**，但它有系统性副作用：
每来一个 delta 就要人类去改一次已签束的 frontmatter，那道门迟早被磨成流水账。
所以本提案主张 (b)，(a) 只作为「今晚要解卡」的临时手段——**两者可以同时做**。
