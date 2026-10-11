---
name: mod-user-research
description: 用户研究计划、资料检索、来源证据和研究报告；修改研究五步流程时使用。
---

# 用户研究模块

负责研究主题、研究方向、大纲、资料检索、来源证据和报告生成。

## 代码地图

- 前端：`apps/web/app/research`、`apps/web/app/studio/research`
- API：`apps/api/src/application/research`、`apps/api/src/domain/research`、`apps/api/src/infrastructure/research`
- 契约：`packages/contracts/src/research.ts`

## 迭代约束

- 每个启用的大纲章节尽量补足三个相关来源；不足时保留缺口，不用无关来源凑数。
- 搜索摘要只用于发现和筛选。报告引用前必须读取真实网页或文档，并验证逐字证据。
- 来源删除意图、失败任务和报告检查点必须持久化，重试不能把排除来源重新加入。
- 报告按已确认大纲逐章生成；来源 ID由服务端绑定，模型不得自行编造链接。

改动检索或报告前先读 `guided-runtime-service.ts`、`guided-report-evidence.ts`、`guided-report-chapters.ts` 及对应测试。

## 模块 SOP

先读本文件与 feature 验证契约，在独立 worktree 中修改；报告或检索变更必须跑 API、来源证据和受影响 UI 测试。

## 踩坑与经验（append-only）

- 2026-10-07：综合结论若直接复制长 UUID，模型可能两次重复同一拼写错误。上下文章节正文与来源列表应使用精确短别名，服务端严格还原；修复反馈指出字段及无效引用，不能模糊匹配或放宽质量门。真实续写综合一次成功约11.4秒，但两章质量警告仍阻止正式发布（出处：issue #5502、docs/verification/research-synthesis-citations-5502/README.md）。

- 2026-10-07：SSE 的当前与历史来源可以引用同一份完整传输对象，但只有整个来源对象一致、完整 baseline fingerprint 匹配或同 patch 已带完整 sources 时才允许；浏览器先合并后独立克隆历史，元数据不能冒充正文。压缩必须逐帧 flush，并在背压下保留大帧及终态尾部。样本字节减少不等于线上耗时改善（出处：issue #5499、docs/verification/research-compact-report-transport-5499/README.md）。

- 2026-10-07：字段级 SSE patch 仍会在 sources 任一对象改变时重传全部正文；研究中间快照复用 polling 元数据 cursor，最终结果与报告阶段仍完整同步。保活事件不代表模型调用，离线字节减少不能替代线上耗时证据（出处：issue #5491）。

- 2026-10-03：六步研究页头应优先使用 runtime brief.topic，旧会话 title 可能仍是导入的长段落；计划/大纲需独立共享时限，修复输出不得重置计时。限时失败与真实模型成功耗时要分开证明，本地真实 qwen3.8-max 五章节计划实测 25.9 秒（出处：issue #5241）。

- 2026-10-01：文档读取单测已模拟 HTTP 时也须显式控制 DNS 输入，否则来源解析依赖公网而污染单测；保留真实地址分类逻辑，并反证私网、混合地址、空解析和解析失败均在 fetch 前拒绝。此类单测不代表真实来源下载验收（出处：issue #4889、#4890 扩大回归）。
- 2026-09-07：来源数量不等于报告深度，缺少匹配证据的章节必须明确缺口，不能塞入无关来源（出处：issue #2904）。
- 2026-09-28：研究计划的可编辑 Markdown 已承载章节结构；同屏重复展示章节、核心问题、成功标准和来源范围卡片会拉长页面且造成视觉重复。收敛展示时应保留 Markdown 保存与确认命令，不删除服务端研究边界数据（出处：issue #4528）。
- 2026-09-24：首页状态总数必须能直接筛出对应研究，并与标签和搜索条件组合；只展示数字会让“需要处理”无法转化为下一步动作（出处：issue #4066）。
- 2026-09-28：导入需求页尚未接通的录音、上传按钮和仅用于高级编辑的 Markdown/草稿入口会遮挡核心动作；最小闭环应直接让用户输入需求并确认进入主题，保留服务端确认与冲突恢复逻辑（出处：issue #4546）。
- 2026-09-24：研究首页不能用孤立百分比代替真实阶段与证据健康；进入报告阶段但零来源时必须明确标出证据缺口，下一动作应由服务端恢复阶段派生（出处：issue #4026）。
- 2026-09-28：资料研究页的章节预览应直接读取报告下一步使用的已启用 outline；网址列表只显示非排除的搜索来源，过滤手动来源与内部合成证据。隐藏操作面板时保留服务端检索、重试及报告证据契约，不要用前端列表状态代替持久化状态（出处：issue #4550）。
- 2026-09-28：收敛资料研究操作面板时，旧会话可能持久化为 paused；必须保留携带 planRevision 与 idempotencyKey 的恢复命令，否则 start/retry 被服务端拒绝，研究无法继续（出处：PR #4554 审查）。
- 2026-09-29：资料检索失败后的主操作必须由服务端持久化任务状态派生；失败或中断显示单一“继续重试”，保留成功来源并复用 retry 命令。若仅传输结果不确定，先同步最新进度再决定是否重放，避免重复任务（出处：issue #4638）。
- 2026-09-29：报告生成页应优先展示流式正文，再展示生成 timeline；刷新恢复时轻量进度合并不得清掉已持久化的 reportCheckpoint，否则已保存章节会在下一次轮询后消失（出处：issue #4651）。

- 2026-10-01：执行步骤与查看步骤必须分离，POST、轮询和失败恢复都保留用户所选页面；章节生成与核验合并展示时，待核验不能掩盖正在生成的 loading；搜索候选应先去空摘要、去重再限量，章节补搜携带研究主题/区域/问题，继续保留相关性与正文证据门（出处：issue #4897）。

- 2026-10-02：有界检索/文档队列应按完成顺序串行落盘，不能让慢同批请求或空结果补搜阻塞已完成来源；补搜在初始结果落盘后处理。独立证据批次可以限并发，但合并顺序、进度与写入必须稳定，章节正文仍按核验前缀串行流出；重定向的每一跳都要重新核验 DNS 和公网地址。虚拟时钟吞吐测试不等于生产耗时改善（出处：issue #4983、docs/verification/4983-research-reliability-performance.md）。

- 2026-10-03：研究页路由必须读取服务端会话 title 并传入流程壳，不能用 brief.topic 代替创建名称；跨会话切换时应屏蔽旧名称并取消过期响应（出处：issue #5232）。

- 2026-10-03：运行态增量应按客户端字段指纹省略未变字段，提示信息必须在执行前从幂等命令中剥离；轮询 patch 必须合并到发起请求时的基线，再与 SSE 当前快照比较，避免同版本下旧轮询覆盖新 timeline。首次进入/刷新读完整快照，步骤切换使用按凭据隔离的页面内存（出处：issue #5235）。

## 知识回流规则

- 2026-10-07：brief 生成只需派生 topic；不要要求模型复述最终被服务丢弃的完整 goal/focus。公共 brief 仍校验完整原需求，directions 仅传 brief+明确 instruction，outline 保留启用方向；输入输出收敛不等于模型调用次数或线上耗时已下降（出处：issue #5492）。

谁修改本模块，谁在 PR 中追加可验证经验；不删除旧条目，推翻时注明替代来源。

- 2026-10-03：报告确认后的目的步骤需在外部读取前持久化并推送 snapshot；证据 timeline attempts 是跨批次调用计数，显示 completed/total 批次。生成报告复用已读取正文，不自动重试已失败网页；单调用限时由 `apps/api/src/application/research/guided-search-budget.ts` 的 `GUIDED_REPORT_MODEL_BUDGET_MS` 定义；限时与关闭回调共同防止迟到流写入（出处：issue #5243）。

- 2026-10-03：report pause/resume 必须同时通过共享命令契约；同 execution version 的 SSE/轮询不能覆盖较新 planRevision 控制。检查点 basis 未变时续写复用来源准备；内部尝试/批次放在诊断，不作为产品提示。真实本地关闭深度思考后已有4章正文，但格式与质量仍需独立验收（出处：issue #5246）。

- 2026-10-03：关闭深度思考需覆盖流式正文以及兼容 checkpoint direction/outline 接口；可信任务策略经 ModelCallInput 显式传递，provider 双维兼容门才转为厂商参数。真实 qwen3.8-max 方向16.1秒/大纲7.6秒/短正文首段0.52秒，不能代替完整报告质量验收（出处：issue #5249）。

- 2026-10-05：用户以「约十分钟完成报告」软性能目标覆盖旧整轮三分钟 deadline。搜索与报告来源准备使用无整轮计时的作用域，逐次 search/read/model 请求仍限时且透传取消；达到 180 秒或 600 秒不得自动把整轮/剩余任务标失败。旧持久化预算失败仅显示上次中断，保留来源与任务，显式重试恢复；plan/model 单调用限时不等同整轮 deadline（替代旧整轮限时约定，出处：issue #5359）。

- 2026-10-07：堆叠 PR 的 MERGED 只代表进入其 base 分支；检查 baseRefName 和 main祖先关系后再声明主线交付。初始检索按章共享时，全部已确认问题与逐题证据门仍保留，旧任务重试不重建；五章六十题反证必须同时检查任务数与问题缺口（出处：issue #5496）。

- #5502 follow-up: model review JSON format errors must not trigger prose rewrites. Preserve recoverable negative verdicts/issues mechanically during bounded formatting repair; passing evidence gaps differ from omitted chapter answers. Model-only chapter source aliases and exact quote registries reduce copying without changing canonical provenance. Real continuation and browser reload evidence: docs/verification/research-synthesis-citations-5502/README.md.

- 2026-10-08：检索 gap 仅是提示，不应作为正文审核结论传入模型；独立复核保留全部争议问题但避免传入旧 reviewer 对象，否则旧审核错误可能被写成章节 defects。使用不变原文段落注册表和问题所属 direct quote 引用验证，拒绝跨问题引用；正确且具体的数据限制可随正式报告自动保存，不需要用户确认草稿。真实续跑5章、199.499秒、17次模型调用并刷新恢复；此证据不是全新研究 SLA（出处：issue #5502、docs/verification/research-synthesis-citations-5502/README.md）。

- 2026-10-09：outline 的完整模型响应偶发非法 JSON，会被通用 UNAVAILABLE 包装；本地 qwen3.7-plus 复现 SyntaxError。生成大纲可使用完整 JSON5 数据解析后继续原 schema/深度门，不能截取片段或补齐缺失内容。格式修复只对生成大纲启用且共享原时限，不能误用于讨论提案或取消/截断响应。真实尾随逗号注入五章恢复32.249秒、无额外调用；不代表该线上请求已取证（出处：#5523、docs/evidence/research-outline-recovery-5523/README.md）。

- #5523 复审修正：truncated 缺席不能证明完整；不允许将 SyntaxError 交给模型补成完整大纲。最终只解析完整 JSON/JSON5，不可解析的响应保留失败，不增加补全调用；对应反证覆盖未标 truncated 的残缺响应。

- 2026-10-10：真实正文候选可按三源窗口逐批相关性校验并落盘；满足当前任务三个已批准正文后停止其余候选读取。后续失败/取消保留已批准批次，不能把任务误标成功；纯摘要路径保留批处理以免增加模型调用。富大纲结构门按确认的小节数量检查，legacy 仍要求三节。受控测试不代表 devapp 24 分钟问题已完成线上计时验证（出处：issue #5525、docs/evidence/research-duration-5525/README.md）。

- 2026-10-10：研究公开生成流与访谈共享 NDJSON stage/delta/completed/failed 基础契约；结果仅带 locator，权威状态仍经鉴权 runtime/progress 同步。零 offset reset 只能改最新 UI 的文本流，不可给旧 baseline 赋新 revision 当完整 snapshot；旧序号 reset 不能覆盖轮询已同步的新文本。Accept 协商保留旧 SSE 兼容（出处：issue #5531、docs/evidence/research-unified-stream-5531/README.md）。

- 2026-10-10：供应商 HTTP 400 + 精确 data_inspection_failed 属于整次请求内容拒绝，不等于来源无关或引文无效；只记录受控分类和完整请求摘要，不重试、拆分归因或切供应商。来源筛选和证据提取都需保留该批排除范围；同模型实例、同实际请求才复用拒绝记录，修复请求必须按自身 payload 建摘要。富大纲的 section.questions 与 subsection.questions 要使用提取/审核同源问题 ID 统一规划正文位置，missing 审核意见逐题映射修复，不能以旧正式报告加新草稿宣称重新生成成功（出处：issue #5546、docs/evidence/research-organizing-5546/investigation.md）。

- #5546 后续修复：rich 章节内部逐题写作使用可信 question ID 绑定实质正文，服务端只按确认大纲排序组装；引用失败反馈须定位具体题/段落/允许 alias，不能由服务清洗坏引用。最终完整正文继续经过独立支持性/深度/缺口审核，绑定不代表语义通过。gap proof 只为 direct entry 生成可选 proof ID，context 原文及来源/相关性保留但没有证明 ID；私有 ID/模型响应不能进入产品正文或持久公开状态。实际诊断通过仍不等于正常 UI 首次+重新生成双正式报告验收（出处：issue #5546、docs/evidence/research-organizing-5546/full-scope-repair.md）。

- #5546 人类后续覆盖：2026-10-10 明确要求引用失败丢弃且不影响主流程，替代本任务前述禁止丢弃 marker 约束。仅生成边界集中弃用 unknown/malformed/题外引用，sourceIds 从幸存正文派生，零引用允许进入完整语义审核；不能把弃用引用后的原断言自动当可信，严格持久化/编辑 canonical 输入仍拒绝非法引用。残缺 parser fragment 包含整行后文，不可整段删除；须保留后续中文说明、代码与同一行好引用（出处：issue #5546、docs/evidence/research-organizing-5546/full-scope-repair.md）。

- #5546 最终验收：独立普通/缺口审核共享明确 supported_answer / explicit_evidence_gap / omitted_answer wire 含义，成功响应先严格 schema 后映射 canonical；格式修复前同源映射已有负 verdict，防止改写成 gap 假绿。完整段落注册表让 reviewer 检查正文而非只查引文。上一版正式报告须跨失败/续写保留，现有 history reader 必须实际挂在 report 页（包含生成中），previous-锚点/导出动作与当前文档隔离。真实 v10 正常从头生成4章32题，38调用，7坏引用弃用，刷新保持当前/上一版hash；初次v2不可变响应经最终guard离线复核，不能宣称v2运行了后来wire协议（出处：issue #5546、docs/evidence/research-organizing-5546/README.md）。
