# 本地版效率与质量迭代（#3749 续，2026-09-22 夜）

人类指令：一晚十轮，每轮实现→验证→评测→据数字找出下一轮的 10 个候选。交付一个效率与质量都更高的本地版。

## 度量
`scripts/local-bundle/eval-local.mjs`。速度指标：wall 中位、首块延迟、块/s、系统提示长度。
质量指标本轮起新增：围栏可渲染率、工具绕路次数、JSON 站点合法率、答案是否答到点（人工抽查）。

## 起点（第 0 轮 = 2b9ee9e52，after3）
| 套件 | wall 中位 | 首块 | 块/s | 提示 chars | 工具 | 围栏 |
|---|---|---|---|---|---|---|
| chat | 11 s | 2.8 s | 34.6 | 629 | 0 | — |
| url | 31 s | 5.2 s | 7.6 | 629 | 5 | — |
| canvas | 67 s | 12.9 s | 15.8 | 4298 | 0 | 5/5 |
| followup 1.3 s ｜ feedback 2.9 s ｜ title 5/5 |

## 第 1 轮（模型预热 + 工具预算）

**取证**：记录代理拦在模型前，一次画布请求 25 519 字符 = 工具 schema 17 347（15 个工具）+ deepagents 基座 3 845 + 我们的提示 4 304 + 用户 23。
服务端：4 098 token，预填充 14.6 s。工具是最大单项（68%），不是我们的提示。
冷加载实测 11.7 s——用户的第一条消息在付这笔钱。

**改动**
1. `warmModel`：起栈后不 await 地发一次 1-token 请求，模型在用户看启动页时就位。
2. `tool_budget.py` + `DEEP_AGENT_EXCLUDED_TOOLS`：末位中间件按名剥掉工具（deepagents 的 FilesystemMiddleware/SubAgentMiddleware 是必需脚手架不能摘，只能从请求里过滤）。本地排除 grep / glob / delete / edit_file / task / spawn_async_task。未设环境变量 ⇒ 中间件根本不挂载，云端逐字节不变。

**数字**（canvas 套件，同机同模型）
| | 第 0 轮 | 第 1 轮 |
|---|---|---|
| wall 中位 | 67 s | **52 s** |
| 首块中位 | 12.9 s | 18.9 s（见下）|
| 围栏 | 5/5 | 4/5 |

**本轮暴露的更大问题**：31 次模型调用里 **15 次 `cached n_tokens = 0`**——前缀缓存完全没命中，整段提示重算（一次 6 653 token 的调用光预填充 18.3 s）。首块变差与围栏 4/5 都指向它和「工具仍可见导致模型绕 call_skill」。

### 第 2 轮候选（按预期收益排）
1. 定位前缀缓存失效根因（中间件是否每轮重写消息前缀）——记录代理逐请求 diff
2. 逐请求工具预算：API 判定为画布请求时连 call_skill/list_org_skills 一起排除（本轮 4/5 的那次就是绕了 call_skill）
3. `write_todos` schema 4 333 字符，单个工具占提示 10%——评估本地是否需要
4. API 侧 4.2 s（发消息到首个账本事件）拆解
5. 画布请求直接走单次模型调用，不进 agent 循环（canvas 不需要工具）
6. 评测脚本记录每轮模型调用次数与 token 数，speed 之外加「调用次数」列
7. MLX 版 4B 已下载完，做同题对比
8. Laya CPU 延迟/内存实测回帖 #3770
9. 冷启动首条消息端到端复测（验证预热真的省了 12 s）
10. 反馈结构化 2.9 s 中位仍偏高，看是否也在重算前缀
## 第 2 轮（逐请求工具预算 + 评测口径换成低噪指标）

**取证**（记录代理，一次画像请求的真实轨迹）：
1. 模型臆造 skill 名 `create_user_profile_canvas` → 「未知技能」
2. 调 `list_org_skills` 查目录
3. 把画布委托给 `diagram-and-canvas` skill（整轮子调用，独立 system prompt）
4. 该 skill 回了一张 **markdown 表格，一个围栏都没有** → 这就是围栏 4/5 的那次
5. 收尾还有一次 grader 调用（`You are a grader…`，user 4 534 字符）

即：一张画布 = 5 次模型调用，其中两次纯绕路。而且子调用穿插在主对话之间，**把单槽 KV 缓存冲掉**，主对话下一次调用只能整段重算（`cached n_tokens = 0`）。

**改动**
- `configurable.excluded_tools`：API 逐请求告诉远端哪些工具本轮不挂。画布请求排除 `call_skill / list_org_skills / web_search / fetch_url`——画布是写围栏写出来的，没有 skill 能代劳，也不需要联网。
- `ToolBudgetMiddleware` 改为恒挂载，按「部署级 env ∪ 本轮 config」过滤；两者都空 ⇒ 请求原样透传。
- 评测加 `modelCalls` 列。理由：同一类提示的墙钟在这台机上从 26 s 摆到 149 s，用它判优劣是自欺；模型调用次数不受 CPU 负载影响。

**数字**：画布 5 次里 4 次实现零工具调用（第 1 轮是混合）。墙钟受 Laya 权重下载与 torch 推理争用，本轮不作数——第 3 轮空闲机器重测。
