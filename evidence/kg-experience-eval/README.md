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

### R0 看到的差距

| 维 | 差距 | 属于 |
|---|---|---|
| E1 | 新会话里记不起之前的对话：跨会话只召回「记到长期记忆」的条目，而那一步要人点——零负担做不到 | 产品 |
| E2 | 「首发做哪个平台？」答不出：问题与记下的「首发只做安卓版」只共享「首发」一个词，字面召回够不着，也没有实体可走图 | 产品（召回） |
| E3 | c4 纯向量基线量不到（见上） | 阶段范围（F05） |
| E4 | 来源抽屉的「跳到原消息」点了没反应（真实 `/chat` 没接 `onJumpTo`）；跨会话同理 | 产品 |
| E5 | 忘掉一条要 3 次点击（不对 → 忘掉这条 → 确认框）；改写要 3 次（不对 → 改写 → 保存，回车不保存） | 产品 |
| E9 | 另一个账号请求别人的记忆得 404（「不存在」），界面上不说「无权查看」 | 产品 |
