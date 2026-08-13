# 验收口径 · L3 检索改走文件式检索

规范以 [`contract.md`](./contract.md) 为准。以下是**签核后** F155 的验收改写口径（真栈反证，不伪造）。

## V1（关键词命中·附件）——问项目里已上传文件的内容，能检索到
- 构造：某项目线程上传一份文件，已抽取（`extraction_status='extracted'`），内容含一个独特关键词
  （如某个代号），该轮消息随后被推出 L1 近端窗口（堆够多轮）。
- 以该关键词提问，run 一次，读 `agent_run_context`（或过渡期的等价快照）。
- 断言：history 里出现一条来源标记为文件式检索的伪消息，内容含那份附件里的相关片段；
  `ModelCallInput.history` 类型不变（仍是 `role+content`）。
- 反证：把索引建在错误的列上（比如只索引文件名不索引正文），本断言当场红。

## V2（关键词命中·落地的画布产物，含保存的 mermaid 图）
- 构造：一次 AI 回复里的 mermaid 图，经 #1149 的 `landAsArtifact` 保存成 canvas artifact，
  `content.md` 含一个独特关键词。
- 以该关键词提问，run 一次。
- 断言：该 artifact 的内容片段被召回，来源标记区分于"附件"（例如 `canvas-artifact`）。
- 反证：只对 §1 第 1 类（附件）建索引、漏了第 2 类（产物），本断言当场红——这是本 delta
  与人类原话第二条要求（"生成的 mermaid 格式的文档也要在检索的范围"）的直接反证。

## V3（未保存的图不进检索范围）
- 构造：AI 生成一张 mermaid 图，用户**没有**点保存，该轮消息被推出 L1 窗口。
- 以图里的独特关键词提问。
- 断言：**不**召回这张未保存的图（它已经不在 L1/L2 窗口里，也没有 `content.md`）；
  这不是 bug，是本 delta §4 明确的边界。

## V4（权限约束·不越权）
- 构造：actor A 所在项目的附件/产物；actor B 不属于该项目（或角色不足以看到）。
- 断言：文件式检索的 SQL 谓词本身带权限判定（复用既有可见性判定），B 的 run 绝不召回
  A 项目范围外的内容——不是"召回了再过滤"，是查询本身就不出这些行（同已签束"权限约束"
  这条不变量，实现机制换了，判权不变）。

## V5（个人对话仍零跨范围召回，只召回自己线程的附件）
- 与 F156 delta 的 V1/V2 相同断言，**这里再跑一遍是确认换了 L3 实现机制后结论不变**：
  `cross_scope_retrieval_requests == 0` 恒真；仅本线程自有附件可召回（`own_attachment_retrieval`）。

## V6（检索失败降级，不 fail run）
- 注入：全文检索查询失败（模拟索引缺失/DB 短暂错误）。
- 断言：run **不**失败（不是 `RETRIEVAL_UNAVAILABLE` block）；降级为「本次 L3 未召回」，
  快照记录降级；用户仍收到基于 L1/L2 的正常回答。
- 反证：这条刻意**不**沿用五路召回引擎"任一路失败即整体 block"的纪律——若实现误套用了那条
  （比如直接复用 `RetrievalUnavailableError`），本断言会红，提示实现抄错了失败模式。

## V7（既有五路召回引擎未被破坏）
- 静态断言：`apps/api/src/application/retrieval/`、`apps/api/src/application/context-pack/`
  目录下文件内容与签核前逐字节相同（本 delta 不删除、不修改它们），既有对它们的单测全部仍绿。
- 理由：这条引擎为未来 embedding provider 落地后并入留着，本 delta 只是不在 L3 首版调用它，
  不是宣判它作废。

## V8（`ModelCallPort` 契约不动）
- 契约层断言：`ModelCallPort` 的 `complete`/`completeStream`/`completeWithProgress`/
  `supportsProgress` 签名与语义未变（同 F154 已验证的同一条纪律，L3 延续，不重新开一次口子）。
