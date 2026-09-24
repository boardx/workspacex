# 记忆体验评测集（phase-18 F15，06-user-experience.md R4 的 E1–E10）

人类 2026-09-24：「你要考虑到谁是用户，如何让用户的体验可以达到 9 分，容易使用，获得价值。」
这把尺子量的是**用户在浏览器里看得到的记忆体验**：零负担被记起、答得出来还有出处、改得快、说人话、会提醒、
不打扰、放心、不卡顿。十个维度、46 条检查。

- 维度与打分：`apps/web/e2e/kg-experience-eval/rubric.mjs`（维度得分 = 通过条数 / 总条数，总分 = 十维之和，门槛 ≥ 9.0）
- 检查：`apps/web/e2e/kg-experience-eval/e*.eval.ts`（标题以 `[Ex.cy]` 开头）；每维一段旅程（`journey.ts`）
- 语料：`apps/web/e2e/kg-experience-eval/cases.json`（用户说的话、20 道回忆题、关系题）
- 门：`pnpm --filter web exec vitest run tests/kg-experience/score-gate.test.ts`

## 栈（不起 docker）

| 进程 | 是什么 |
|---|---|
| `apps/api/scripts/loopback-kg-eval-model-provider.ts` | 确定性模型：抽取请求按语料逐字回 JSON（只认用户说过的原话，其余回空）；对话请求**只照着这一轮收到的【记忆】作答**；流式吐字 |
| `apps/api/scripts/seed-kg-experience-eval.ts` → `apps/api` | 种子只建组织、四个账号、一个默认 Agent（一条记忆都不预置）；API 开 `KG_EXTRACTION_ENABLED=1`，抽取与 AGE 投影 worker 就在 API 进程里 |
| `apps/web`（`next build && next start`） | 同源代理 `/__fullstack_api` 走真 API |

Postgres（AGE + pgvector）与 Redis 由调用方给：`PGHOST/PGPORT/PGDATABASE/PGPASSWORD`、`REDIS_PORT`、
`WORKSPACEX_API_PORT/WORKSPACEX_WEB_PORT/WORKSPACEX_MODEL_PROVIDER_PORT`。**不在默认 CI 车道上**（一轮约 6 分钟 + web 构建）。

## 跑法

```bash
cd apps/web
PW_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm run e2e:kg-experience   # 起三个进程 + 跑十段旅程
pnpm run e2e:kg-experience:score --round R1                                                  # → evidence/kg-experience-eval/R1.md/.json + shots/R1/
pnpm exec vitest run tests/kg-experience                                                     # 门
```

已经起好的栈可以复用：`KG_EVAL_REUSE=1`。种子每次启动 API 时重建组织与它的 AGE 图。

## 它不量什么（说在前面）

1. **抽取质量与回答措辞**：本机没有真实模型。抽取回环扮演「把这句话读对了的抽取模型」，对话回环只把它收到的记忆原样说出来——
   所以回答里有没有某件事，完全取决于召回这一轮交给模型什么。量的是记忆系统，不是模型。
2. **E3.c4 hybrid 对纯向量**：本阶段没有嵌入流水线（F05 不在 MVP），「相似」通道从不出现，纯向量基线量不到。
   这条如实红（不拿「0 分的向量」衬托 hybrid），E3 上限 0.75，总分上限 9.75。F05 落地后它会自己变绿或变红。
3. **E10「开启记忆前后」**：产品没有关掉记忆的开关。「开启」= 有 7 条记忆可召回、走图；「对照」= 从没聊过的账号（召回照样执行但为空）。

## 规则

- **冻结**：检查、语料、共用动作、打分、回环模型、种子、playwright config 在 R0 冻结，指纹在 `rubric-lock.json`。
  之后只能修评测自身的 bug：改完重算指纹，在锁文件 `amendments` 里加一条（轮次、新指纹、理由），并在下表写明。门会拒绝没登记的改动、
  拒绝删检查或改条数、拒绝没有证据（截图 / 量到的数）的检查。
- 截图只保留 R0 与最新一轮（中间轮的 `R<n>.json` 里仍有逐条结果与量到的数）。

## 轮次记录

| 轮 | 分数 | 这一轮做了什么 | 评测自身的修正 |
|---|---|---|---|
| R0 | **7.0** | 基线（F01–F14、F16、F17 合入后） | 冻结前两处：新对话要等旧消息从界面撤净（否则把上一段的回答当成这一轮的）；种子清掉上次运行留下的 AGE 图 |
| R1 | **9.4** | 修掉 R0 的五个产品差距（见下）：E1 0.33 → 1.00、E4 0.33 → 1.00、E5 0.33 → 1.00、E9 0.33 → 0.67 | 两处，登记在锁文件 `amendments`：① E4「原话」认用户在语料里真说过的任意一句（跨会话记起后，回答会引用别的对话里的原话；判据仍是逐字出自用户说的话）；② 按回车前等「发送」可用（新对话刚建好时回车被吞，R1 首次运行卡在 E5 第一句） |

### R0 看到的差距

| 维 | 差距 | 属于 |
|---|---|---|
| E1 | 新会话里记不起之前的对话：跨会话只召回「记到长期记忆」的条目，而那一步要人点——零负担做不到 | 产品 |
| E2 | 「首发做哪个平台？」答不出：问题与记下的「首发只做安卓版」只共享「首发」一个词，字面召回够不着，也没有实体可走图 | 产品（召回） |
| E3 | c4 纯向量基线量不到（见上） | 阶段范围（F05） |
| E4 | 来源抽屉的「跳到原消息」点了没反应（真实 `/chat` 没接 `onJumpTo`）；跨会话同理 | 产品 |
| E5 | 忘掉一条要 3 次点击（不对 → 忘掉这条 → 确认框）；改写要 3 次（不对 → 改写 → 保存，回车不保存） | 产品 |
| E9 | 另一个账号请求别人的记忆得 404（「不存在」），界面上不说「无权查看」 | 产品 |

### R1 做了什么（产品）

| 维 | 修了什么 | 在哪 |
|---|---|---|
| E1 | 本人其他个人对话里记下的，新会话里零操作就能记起（个人空间 = 同一用户全部个人线程，S0-2=A）；同一件事只出现一次、改过 / 忘掉的说了算；项目对话与别人不受影响 | `apps/api/src/infrastructure/knowledge-graph/pg-knowledge-recall.ts`、`pg-knowledge-read.ts`（回答下标「来自你 {日期} 的对话」） |
| E4 | 来源抽屉「跳到原消息」：滚到那条消息并高亮；在别的对话里 ⇒ 打开原对话再高亮 | `apps/web/lib/chat-message-focus.ts`、`thread-knowledge-tab.tsx`、`copilotkit-v2-user-message.tsx` |
| E5 | 「不对 → 忘掉这条」两次点击直接生效；改写框回车即保存 | `knowledge-list.tsx`、`claim-action-dialog.tsx` |
| E5 | 召回排序：字面命中之间先比字面分，图路只在并列时抬名次（刚改过的一条还没投影进图时，会被一个人人都提到的实体挤出前 8） | `apps/api/src/domain/knowledge-graph/recall.ts` |
| E9 | 来源读不到时照实说「已经不在了，或你无权查看」（看不见与不存在同一个出口，不泄露存在性） | `knowledge-panel.tsx` |
| E10 | `kg_graph_neighbors` 逐跳锚定：结果与 F08 版逐行相同，94 个节点时 2.7s → 29ms（原来聊十几轮之后每轮都超 2 秒上限降级） | `apps/api/migrations/20260925100000_kg_f15_graph_neighbors_anchored.sql` |

### R1 之后仍然红的（诚实地红）

| 检查 | 为什么 | 需要谁 |
|---|---|---|
| E2.c06「首发做哪个平台？」 | 问题与记下的「首发只做安卓版」只共享「首发」一个词，字面召回够不着（阈值 0.2），问题里也没有能走图的实体。要靠语义（向量）召回 | F05（嵌入 / 向量通道） |
| E3.c4 hybrid 对纯向量 | 纯向量基线量不到（本阶段没有嵌入） | F05 |
| E9.c2 越权返回 403 | 06-UX R4 E9 写的是 403；但 F09/F14 的不变量 I-3 是「看不见与不存在同一个出口（404，响应体逐字相同）」，e2e-zero-leak 测试钉着它。两条人类约束互相冲突，本 feature 不单方面改安全不变量；界面那一半（E9.c3「无权查看」）已按不泄露存在性的方式做到 | 人类裁决：403（泄露「这个 id 存在」）还是保持 404 并改 E9 原文 |

### 已知产品缺口（不在检查里，但评测过程中看到的）

- 在新会话里说「忘掉 X」，只列本会话与长期记忆里的 X：本人**其他个人对话**里记下的 X 跨会话被记起，但忘掉卡的执行（`kg_act_on_memory_card`）只认这两处，要到原对话里去忘。
- 跨会话记起是 E1 要求的行为变化（此前只有「记到长期记忆」的才跨会话）。它与 06-UX R2 M1 / R3-1 一致，但改动了 F08 / F12 的召回范围与 `recall-repo-guard` 的豁免前提（已按新前提逐条重钉），合入前请人类确认。
