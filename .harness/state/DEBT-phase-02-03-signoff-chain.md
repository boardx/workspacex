# 欠债登记：phase-02 / phase-03 标了 `has_ui: true` 却没有契约束

- 登记日期：2026-07-31
- 登记人：main coordinator
- 状态：**没有被消掉**。`pnpm harness doctor` 每次都逐条打印它（现为 WARN，理由见下）
- 开工资格：**仍然被挡死**——`claim --phase 02` 与 `new-sprint --phase 02` 实测均被拒

## 这条判定是什么

ADR-023 决策一：签核面收敛为束级 `design-signoff.md` 的三件。配套门控：

> `has_ui: true` ∧ 零契约束 ⇒ 「本阶段标了 has_ui 却没有契约束，
> 按 ADR-023 它无法被签核；建 contracts/ 或把 has_ui 撤掉」

phase-02（46 feature）与 phase-03（47 feature）正好落在这个状态。
**这条判定是对的**，它挡的正是它该挡的：这两个阶段现在没有资格开工。

## 出的事：一道会让所有 PR 变红的门，等于没有门

CI 的 `verify` job 跑的是 `pnpm harness doctor`（**不带 `--phase`，体检全部阶段**）。
于是 phase-02/03 这条红让**每一个 PR** 失败，包括与它们毫无关系的 phase-01 feature PR。
2026-07-31 的 PR #57 就是这样红的。

一道让所有 PR 无条件变红的门，真实后果只有一个：**大家一律 `--no-verify`**。
那才是真正把门拆了——而且是拆得看不见的那种。

## 修法：doctor 里按「有没有开工」分级，**其余入口一字未动**

`auditSignoff` 增加 `mode: "gate" | "audit"` 参数（`.harness/scripts/lib/design-signoff.ts`）：

| 入口 | mode | 零束 ∧ 零开工 feature | 零束 ∧ 有 in_progress/passing |
|---|---|---|---|
| `claim` / `new-sprint`（`assertDesignSignedOff`） | gate | **FAIL** | **FAIL** |
| `verify-uc-coverage` | gate | **FAIL** | **FAIL** |
| `doctor` | audit | **WARN**（仍逐条打印） | **FAIL** |

立论：**doctor 是审计链体检**——它问「已经做出来的东西，证据链断没断」。
一条 feature 都没开工的阶段**没有审计链可断**；它欠的是「开工资格」，
而开工资格由 `claim` / `new-sprint` 各自独立地挡着。

## 这不是「改成绿」，三件事钉住它

1. **doctor 仍然逐条打印全文**，只是级别从 FAIL 变 WARN；WARN 文案额外点名
   「该阶段一条 feature 都还没开工」和本文件的路径。
2. **一旦 phase-02/03 有任何 feature 进入 `in_progress` / `passing`，立刻变回 FAIL。**
3. **反证套件**（`design-signoff.test.ts`，`UNSTARTED_PHASE_IS_WARN` 那一组三条）：
   - gate 模式 + 零开工 ⇒ 必须 FAIL
   - audit 模式 + 有开工 feature ⇒ 必须 FAIL
   - WARN 文案必须点名 `has_ui` / 「没有任何契约束」/「一条 feature 都还没开工」/ 本文件名

   **实测反证**：把 `mode === "audit" && featureIds.length === 0` 改成 `mode === "audit"`
   （即写成「audit 模式一律放行」），第二条测试当场红。改回后 42/42 绿。
   这条测试红了，就说明降级被误写成了无条件放行。

## 三种「更快」的做法为什么全没做

| 做法 | 为什么不做 |
|---|---|
| 建 `phases/phase-0{2,3}-*/contracts/<束>/` 空壳 | 门控自己的报错文案逐字写着**「不要为了消红而建一个空壳束」**，空 `covers` 会在下一条红里被抓住 |
| 撤 `roadmap.yaml` 的 `has_ui` | 这两个阶段**确实有界面**（`components/survey/` `components/tasks/` `components/brain/` 已建成）。撤它是在磁盘上写假话 |
| `git push --no-verify` | 绕过一次不解决 CI；而且这条判定指向真问题，只是指错了对象 |

## 什么时候真正还清

phase-02 / phase-03 立项时，按各自 `requirements/` 下已有的需求目录
（p2：`11-board` / `12-survey` / `18-proto` …；p3：`14-brain` …）切契约束，
人类逐束签核。在那之前它就该以 WARN 的形式一直挂在 doctor 输出里。

## 相关

- ADR-023 决策一、决策六，以及它「未决（需要人类）」一节
- `phases/phase-01-run-a-project/contracts/README.md` 最后一节
  （survey / tasks / brain / prototype 四个域**明确不属于** phase-01）
- `phases/phase-01-run-a-project/requirements/SCOPE-DELTA-2026-07-30.md`
