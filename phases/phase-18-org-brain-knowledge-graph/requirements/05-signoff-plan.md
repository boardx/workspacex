# 05 · 人类签核计划（这一阶段，需要你签的是哪几件）

> **纪律**：签核是**人的动作，agent 不许改 status**（AGENTS.md「设计签核（三件、一处签）」/ ADR-023）。
> 本文件只把「要签什么、签在哪、按什么顺序」列清楚，**它本身不是签核面**。先例：phase-17 `05-signoff-plan.md`。

## 第 0 轮：需求本身（现在就等你）

把需求转成 `feature_list.json`、画界面、写契约之前，先确认这份 `requirements/` 没跑偏。
逐项把 ☐ 改成 ☑ 并署名日期；有异议的写一句为什么。也可以直接在聊天里回复「S0 全部同意」或逐条回复。

| 编号 | 待确认事项 | 在哪看 | 我的建议 | 状态 |
|---|---|---|---|---|
| S0-1 | 本阶段只做 **L0 会话 + L1 个人**，项目 / 组织 / 平台留给后续阶段 | `00-overview.md` R2 | 同意 | ☑ 人类 2026-09-24 聊天确认（代抄） |
| S0-2 | **「个人项目」指什么**。现状：chat 线程要么属于项目，要么是无项目的「个人线程」（`private`，#594）；没有「个人项目」这种容器。选一个：**A.** 同一用户的全部个人线程合起来算一个 L1 作用域（不新建容器）；**B.** 新增一种项目类型「个人项目」；**C.** 只指 `personal-local` 组织里的项目 | `00-overview.md` R2、uc-18-4 | **A**（零新容器，最快闭环；B 以后可以再加） | ☑ 人类 2026-09-24 聊天确认（代抄） |
| S0-3 | L1 跨会话召回是对已签 delta「个人对话只召回本线程附件」的**放宽**：同一用户、已确认晋升的知识可以跨会话召回 | `00-overview.md` R5 | 同意 | ☑ 人类 2026-09-24 聊天确认（代抄） |
| S0-4 | 数值门槛：单条入图 P95 < 30 秒；召回 P95 < 1.5 秒；带权限过滤的向量召回率 ≥ 0.9；关系类评测集上 hybrid > 纯向量；删除失效 ≤ 5 分钟（沿用 uc-22-4） | 各 UC R9 | 同意（跑出基线后可调） | ☑ 人类 2026-09-24 聊天确认（代抄） |
| S0-5 | 实体类型封闭枚举 `person / organization / project / product / concept / term / metric / event`；结论类型 `fact / hypothesis / decision / todo / risk` | uc-18-1 R7 | 同意 | ☑ 人类 2026-09-24 聊天确认（代抄） |
| S0-6 | **三态 ↔ 七态 ↔ 五态统一对照表**（你在 D5 让我提的建议方案）。L0/L1 只用三态；七态在项目层、五态在组织层才放开校验，字段从第一天就在 | `docs/proposals/PROP-ORG-BRAIN-KG-001.md` §3.5 | 同意 | ☑ 人类 2026-09-24 聊天确认（代抄） |
| S0-7 | 硬边界五条：模型不直写本体表；PG canonical，AGE 只返回 id；反对证据不可删；晋升必须人点；不静默降级 | `00-overview.md` R4 | 同意 | ☑ 人类 2026-09-24 聊天确认（代抄） |
| S0-8 | 抽取在后台异步做，**不阻塞发消息**；抽取失败只在知识面板提示，不影响对话 | uc-18-1 R3 / R4 | 同意 | ☑ 人类 2026-09-24 聊天确认（代抄） |

### 第 0 轮结论（2026-09-24）

人类在 issue #4022 的会话中逐字回复：「都同意，我同意按照你的建议来决策。我现在不方便签署，你可以先推进，我后面补签署。」
据此，S0-1…S0-8 全部按「我的建议」一列通过，**S0-2 取 A**：L1 作用域 = 同一用户全部个人线程（无项目、`private`），不新建容器。
本节由 agent 代抄，出处如上，人类可随时改。

⚠ 这不等于第 1 轮签核：`design-signoff.md` 与 `design-coherence.md` 的 `status` 仍然只能由人类改。
第 1 轮材料可以先全部备好，但 feature 要等人类补签后才能 `claim` 开工（门控由脚本强制）。

## 第 1 轮：正式的三件一处签（S0 过了才开始）

1. **ui-prototyper** 用 `apps/web` 真实组件 + mock 做出以下界面，截图存 `../ui-preview/`：
   - 知识面板：列表视图、图视图，各带七态；
   - 来源抽屉、编辑菜单；
   - 回答下方的引用与「为什么召回」、图 / 向量不可用提示；
   - 「存入个人空间」与 AI 提名卡片。
2. **requirement-author** 读本文件夹与已建成的 UI → 生成 `../feature_list.json`。
3. 契约束，建议**一束** `chat-knowledge-graph`：五个 UC 的不变量互相依赖（入图、召回、编辑、晋升、失效共用同一套表和执行器），按 contract-design.md 的判据应该同束。产出放在 `../contracts/chat-knowledge-graph/`：
   - `ui.md`（签核第 ① 件）
   - `usecases.md`（签核第 ② 件）
   - `domain.md`，含 §3.5 对照表与不变量
   - `coverage.md`
   - `design-signoff.md`
   - 第 ③ 件正文在 `packages/contracts/src/chat-knowledge-graph.ts`

   **你在那一份 `design-signoff.md` 里一次签三节：① UI ② 用例 ③ API 契约。**
4. **阶段一致性复核** `../design-coherence.md`：重点查本束与 phase-01 `chat` / `chat-context-engine` / `files` 三束、phase-00 `context-pack` 束之间是否有冲突（可见性、召回边界、删除级联、错误码）。**你签这一份。**
5. 两份都签完，feature 才可以 `harness claim` 开工，从 KG-M1（AGE 镜像 + 表）开始。

## 第 1 轮材料状态（2026-09-24）

全部备齐，等人类审阅：

| 件 | 位置 |
|---|---|
| ① UI | `../signoff-draft/chat-knowledge-graph/ui.md` + `../ui-preview/chat-knowledge-graph/`（21 张） |
| ② 用例 | `../signoff-draft/chat-knowledge-graph/usecases.md` |
| ③ API 契约 | `packages/contracts/src/chat-knowledge-graph.ts` |
| 领域 / 覆盖 | `../signoff-draft/chat-knowledge-graph/{domain,coverage}.md` |
| 签核文件 | `../signoff-draft/chat-knowledge-graph/design-signoff.md`（D-KG-1 = A、D-KG-2 = A 已拍板；U-1…U-6 体验修订） |
| 两个 delta | `../signoff-draft/context-pack-delta/`、`../signoff-draft/personal-recall-delta/` |
| 体验标准 | `06-user-experience.md`（9 分标准 E1–E10，F15 为阶段退出门） |
| 一致性复核 | `../signoff-draft/design-coherence.md` |
| 功能清单 | `../feature_list.json`（F01…F17，91 点，validate-fl 通过） |

**怎么签**：D-KG-1 / D-KG-2 已于 2026-09-24 按建议拍板。人类审阅后说「签」即可。agent 按 `human-decision-packaging.md`
把两份材料移入 `contracts/` 与阶段根目录，写入 `status: confirmed` 和逐字的 `confirmed_via`，然后开一个 `chore(signoff):` PR。
人类在那个 PR 上 Approve → Merge，这就是签核动作本身。**agent 不自己合并这个 PR。**

## 为什么材料先放在 `signoff-draft/`，而不是直接放进 `contracts/`

`contracts/<束>/` 一建出来，签核链门控（`design-signoff.ts`，经 `doctor --strict` 在 CI 里跑）就立刻要求束与阶段一致性复核都是 `confirmed`。
pending 状态放进去，整个 PR 会一直红到人类签字为止，而 agent 又不许代签。
所以材料先放在门控不看的 `signoff-draft/`，签核 PR 里再原样移入 `contracts/`。
在那之前，feature 不可能被 claim：`contracts/` 不存在 + `has_ui: true` ⇒ claim / new-sprint 判失败。
