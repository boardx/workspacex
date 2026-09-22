# 本地版 chat「健壮性 + 本地↔在线差异」十轮迭代（2026-09-22 夜）

人类指令：一晚十轮，每轮实现→验证→评估→据评估找出下一轮 10 个候选；交付一个效率与质量
都更高的 chat；要结合 local workspace，用户能从本地切到正式系统，界面要有明显变化，
本地与在线的功能可以不一样。

## 分工（与并行会话协商，双方书面确认）
机器上另有一个会话（「本地工作区端到端验证」）在跑 #3749 的**效率**线（提示裁剪 / 模型预热 /
逐请求工具预算 / 评测 lane），主 checkout 归它。本文件是**另一条线**：故障纪律与健壮性、
本地 vs 在线的版次差异。工作树 `/Users/shenyanbin/Documents/wsx-wt/chat10`，分支
`worker/claude-3749-chat-quality-local-mode`，基线 `16b7fe4ae`（收尾时已合入对方
`claude/local-perf-3749`，无冲突）。

## 取证起点（不是推测）
用户那台机器的**安装版**日志 `~/Library/Application Support/WorkspaceX/local/logs/api.log`：
- `agent run model call failed` 共 **2** 条，**两条都是** `skill_activity_delivery_unavailable`
  —— 这台机器上迄今每一次 chat 硬失败，原因都不是模型、不是工具，而是一条**展示/溯源**
  事实没投递到。
- `error log summarization timed out` 数十条：一个给运维看的后台 AI 摘要在本地反复用 4B
  模型超时（并发上限 5），与用户正在等的回答抢同一个模型槽。

本轮还实测出一条更严重的：用本地版真实交给 API 的那份 env 调真实的 `selectImageProvider`，
返回 **bailian**，`baseUrl=https://dashscope.aliyuncs.com`、`apiKey="ollama-local"`——
一个声明「数据不出本机」的构建会把出图提示词发到公网，然后 401。

## 十轮

| 轮 | 做了什么 | 反证 |
|---|---|---|
| R1 | 版次骨架（`contracts/deployment.ts`：版次枚举 + 能力差异矩阵 + 故障纪律）；溯源投递从 fail-closed 降级为本地 best-effort，新账本事件 `skill_activity_gap` | 恒 fail-closed ⇒ 新测 5/6 红；删前端分支 ⇒ 缺页被渲染成失败工具行 |
| R2 | 本地版不跑「系统异常 AI 研判」元任务（`errorLogAiDepsForEdition`） | cloud 纪律下同一次 `record()` 必须发起一次模型调用 |
| R3 | 「切到在线正式系统」出口：四条代价先说清（`CLOUD_SWITCH_NOTES`）+ 新窗口交给系统浏览器；没配地址不画死按钮 | `parseCloudUrl` 拒 javascript:/data:/file:/带凭据/非 URL；没配 ⇒ 确认按钮不存在 |
| R4 | 长时间不返回的工具调用在界面上说话（`tool_progress`，计时器挂在 `OpenToolCalls`） | 未注入 ⇒ `vi.getTimerCount() === 0`；删 `closeAll` 清理 ⇒ 当场红；writer 抛异常第二句照说 |
| R5 | 失败之后告诉用户「下一步做什么」（9 条，本地版不再说「联系管理员」） | 在线版返回值与既有函数**逐字**相同（9 个成因各断言一次） |
| R6 | 承认 `/admin/local` 的导出是演示态（屏幕上说 + 徽标），R3 那句承诺改口 | `data-stays` 不含「用「导出到正式组织」」、含「还没实现」 |
| R7 | 解释「3/3 步已标记完成」与「执行失败」同屏（纯函数 `planAllDoneButFailedNote`） | 三种无矛盾情形各断言不说话；返回 `null` 而非空串 |
| R8 | 本地版不再把出图提示词发到公网 DashScope（选择器 + provider 路由表两处） | 同一 env 只去掉版次标记 ⇒ 必须又变回 bailian；显式指定也不放行 |
| R9 | 顶栏那句「请求不出网」是假的（#3716 挂了 `fetch_url`/`web_search`），改成三类出网事实 | 断言横幅**不含**「请求不出网」；三类逐字与契约比对 |
| R10 | 能力矩阵加落地门控（`enforcement` / `enforcementRef` + `lint-edition-capabilities.mjs`，已进 gates-fast） | ref 搜不到 ⇒ 红且指名；缺口计数变多 ⇒ 红；非 gated 带 ref ⇒ 红 |

**R6、R9 是对我自己前几轮的纠正**——R3 承诺了一条演示态通道，R1 写了一句假的「请求不出网」。
两条都由后续轮次实测推翻并改掉，反证留在测试里，理由留在契约注释里。

## 本轮结束时的口径
- 我这条线新增/改动的测试：contracts 10 / api 40 / web 31 / local-runtime 4，全绿。
- 四处 `tsc --noEmit`、`lint-design`、`lint-arch-deps`、`lint-edition-capabilities` 全绿。
- **没有**真机 e2e：并行会话整夜在这台机器上跑评测，两套 Ollama 同时跑会让双方的数字都不可信
  （本仓既有教训：评测须空闲机器）。本条线的判据全部是单元/集成级 + 对真实 env、真实日志、
  真实函数的取证；「用户点开界面看到的样子」尚未取证，是已知缺口。

## 下一轮的 10 个候选（按价值排序，供接手者）
1. **真机 e2e 一轮**：机器空闲后起安装版，走「本地版界面外观 → 展开能力差异 → 切换对话框 →
   一次画布请求看停滞通知 → 断一次 SSE 看 run 不再失败」，截图存证。
2. **`declared-only` 三条缺口收一条**：`collaboration`（后台成员/邀请屏在本地版照旧可达）。
3. **真实的本地→正式导出通道**（R6 承认它今天是演示态；契约与后端路由已在）。
4. **默认工作区不是那个个人本地组织**（2026-09-22 更正，原文写的是「personal-local 组织
   在桌面版根本没启用」，**那是错的**）：向本机 API 要 `GET /identity/local-org` 拿到 200
   ——`org-local-88ced53c…`、kind `personal-local`、memberCount 1。注册路径在同一个事务里
   就建好了它。真正的缺口是**作用域**：桌面版默认进入的是普通组织「我的本地工作区」，
   聊天发生在它里面，所以 org 级出站守卫对默认工作区不生效。
   ⚠ 我犯的两个错都值得留着：① 从 `provision-admin.ts` 的代码推断「没有」，而没问运行中的
   系统；② 去查库时读到「只有一行」就以为证实了——那张表 `relforcerowsecurity` 为真，
   连 postgres 都被 RLS 过滤，那个计数从来不是权威。
5. **run 级重试的代价**：`retryPlanStep` 是整轮重跑，本地 4B 上又是几分钟；能否从
   checkpoint 续跑（deep-agent 侧已有 LangGraph checkpoint）。
6. **`MODEL_PROVIDER_NOT_CONFIGURED` 的本地文案**：R5 的下一步表按 `failureReason` 分，
   而这条走的是 `errorCode`，本地版仍会看到「请联系管理员」。
7. **agent 选择器标注不可用**：本地版仍列出图片生成 agent，选中必失败（R8 只堵了出网）。
8. **出网事实与 `LOCAL_ORG_GUARANTEES` 的口径冲突**：那三条承诺写着「禁止任何 MCP 出网」，
   而 `fetch_url` 走的是另一条路径且显式 `localOnlyOrg: false`——两处对「出网」说的不是同一件事。
9. **停滞通知的阈值该按工具分**：60 s 对 `fetch_url` 太晚、对一次画布 `call_skill` 太早。
10. **本地版启动期的失败**：`provider_transport_failed` 在刚启动时最常见，能否在服务未就绪时
    直接不让发送，而不是让用户等一次失败。
