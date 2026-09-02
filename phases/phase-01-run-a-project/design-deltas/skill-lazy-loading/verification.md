# verification · skill-lazy-loading

> 每条门控配一条反证（本仓九次栽在"全绿但空转"）。

⚠ **V7 的真栈测试当场抓出一个假绿**：`skill-lazy-loading.test.ts`（内存 fake，V1-V6）
全绿的实现，接进真实 `RoutingModelCallPort` 后本优化**从未真正生效过**——原实现按
`deps.model.completeStream === undefined` 判断"这个 run 会不会走流式"，但生产接线里
`deps.model` 是路由器，`completeStream` 方法**恒存在**（对不支持流式的叶子 provider
内部退回 `complete()`，见 `routing-model-call-port.ts` 头注），按存在性判断永远是
`false`。内存 fake 里 `deps.model` 直接就是叶子 port，测不出这层路由包装，所以 V1-V6
全绿掩盖了这个问题。已改成只按 `isDeepAgentRun` 判断（见 `execute-run.ts` 对应注释），
`chat-skill-mount-produces-pptx-real-stack.test.ts` 的 T6 补上真栈门控防止再退回。
这正是本仓"真栈测试 vs 内存 fake"的又一次真实印证，不是理论提醒。

## V1 — 未挂 skill：system prompt 逐字节不变（T2 纪律延续）

断言：`buildSystemPrompt(instructions, [], canvasGuidance)` 的输出，在本 delta 前后逐字节相同。

⚠ 反证：把"未挂 skill 时不追加协议段"这条判据改成恒真（总是追加），断言必须变红。

## V2 — 挂载 skill 但本轮消息用不上：system prompt 只含目录，不含全文

断言：挂 2 个 skill（如 docx-create + xlsx-create），system prompt 里出现两个 `stable_name` 各一行摘要，**不**出现任一份 `SKILL.md` 正文里独有的、目录摘要不会带到的句子（比如某个具体的 API 用法示例代码行）。

⚠ 反证：把"目录只放摘要"改成"目录直接塞全文"，断言必须变红（因为那时正文特征句会出现在 system prompt 里）。

## V3 — 模型请求 `read_skill` 后，下一轮 system prompt 真的含该 skill 全文

断言：用可控的 loopback 模型替身，第一轮回复一个 `read_skill` 块（请求 `docx-create`），断言第二轮 `complete()` 收到的 `system` 参数里出现该 skill `SKILL.md` 正文的一个独有句子；且该轮目录条目仍然保留（能看到"还有 xlsx-create 没读"）。

⚠ 反证：把"追加全文"改成"什么都不追加、只是再调一次模型"，断言必须变红。

## V4 — 轮数上限：超过 `MAX_READ_SKILL_ROUNDS` 后降级返回，不报错、不死循环

断言：loopback 替身**每一轮都**回一个 `read_skill` 块（模拟"模型不断请求，从不给出最终答案"的最坏情况），断言最终 `complete()` 调用次数恰好等于 `MAX_READ_SKILL_ROUNDS + 1`（最后一轮强制不再展开、直接把当前回复当最终答案），run 状态是**成功**（不是 `failed`），不是无限循环/超时。

⚠ 反证：把轮数上限判据改成不生效（恒可继续展开），断言必须变红（要么调用次数超出预期、要么测试本身超时）。

## V5 — deep-agent provider 路径逐字节不受影响

> ⚠ **2026-09-03 作废**（issue #2534，delta `deep-agent-skill-catalog`）：#2519 之后 run 默认加载全部已启用 skill，「全文进 deep-agent system prompt」不再可接受；deep-agent 改走 `"deep-agent-catalog"` 模式。下文保留为历史口径。

断言：`run.modelProvider === DEEP_AGENT_PROVIDER_NAME` 时，`buildSystemPrompt` 与 `deep-agent-model-provider.ts` 传给远端的 `input.system`/`org_skills`，在本 delta 前后逐字节相同（既有 `deep-agent-model-provider.test.ts` 全绿即为证据，本 delta 不新增专属测试，因为没有新代码路径可测——判据本身就是"这个分支完全没被碰"）。

⚠ 反证：若不小心让 §2 的目录化逻辑对 deep-agent 分支也生效，`deep-agent-model-provider.test.ts` 里断言 `input.system` 含全文的既有用例必须变红——这就是天然的反证，不用新写。

## V6 — `read_skill` 请求一个未挂载的 skill：诚实拒绝，不是静默忽略也不是报错中断 run

断言：模型请求一个不在这次 run 挂载集合内的 `stable_name`，下一轮 system prompt 里**不**出现该 skill 的任何内容，且附带一句告诉模型"这个 skill 没有挂载在这次对话里"的说明（而不是模型第二轮收到和第一轮一样的目录、猜不出请求为什么没生效）。run 本身继续正常往下走，不因为一次无效请求而失败。

⚠ 反证：把"未挂载"分支改成静默忽略（什么提示都不给），断言必须变红。

## V7 — 端到端真实验证（devapp，人类要求的"端到端测试"）

不是 vitest 断言，是真实浏览器路径：
1. 建一个自定义 agent（非"通用助手"，即非 deep-agent provider），挂载 2 个 office-docs skill。
2. 发一句与 skill 无关的话（"你好"）——用浏览器 devtools 或后端日志确认这一轮的 system prompt 长度/token 数明显小于"两份 SKILL.md 全文都拼进去"的基线（本仓已有 pptx 多 skill 挂载的历史超时记录做基线参照）。
3. 发一句真实需求（"帮我生成一份周报 Word"）——确认最终真的产出一个可下载、可打开、内容正确的 .docx（与 F979 的验证标准同一条纪律：断言真实字节，不是"看起来成功"）。
4. 记录实际往返轮数（目录判断 → read_skill → 全文 → run_script → 执行）与总耗时，与不做本 delta 时的单轮耗时对比，如实记录"多轮但没超时" vs "单轮但曾经超时"的权衡结果。
