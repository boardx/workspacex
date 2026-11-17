# S2 因果与计量叙述：独立只读复核

本页为2026-11-16的新增followup，保留原S1、旧S2取消、新S2失败、浏览器早期assembled及晚到native提交记录，不改写旧历史。仅读取现有源码和A1/A2/A5/A6安全证据；没有新网络请求、模型、资源启动、结算或教学评分。

以下“原run/历史S2故障”专指补测run `40539aa6-2732-4661-9665-913013af806d`（与后验HEAD及本机对照相区分）；旧echo误识后取消的`8a4188ab…`仍单独保留，不混为同一次失败。

## 核心判定

**已证明的是可复现的启动环境转发缺陷和当前修正profile的非模型TLS/HTTP连通；尚不能直接证明它就是14:20原S2失败的底层根因。** 原运行现有安全投影只有`APIConnectionError / Connection error`，没有关联到该次physical request的完整cause/errno/HTTP状态。后续重构旧profile的证书verify19与修正profile的HTTP404不能填回缺失历史cause。

原生提交观察只证明向native服务提交了与冻结块相同的消息；没有assistant回复或学生后续保存，教学内容不可评价，S2不通过、后续任务暂停不变。

## Exact位置与最小措辞建议

本次在下列实际审阅范围**未发现正文明确把provider_rejected等同供应商拒绝、把0token等同0费，或把当前S2账写成已结算**。以下为容易在摘要/交付中丢失的限定及一处历史待核状态，不能当作已发现相反事实。

| 位置 | 当前表述/事实 | 最小修正或引用限定 |
| --- | --- | --- |
| [人工手册M24，第352行](../a6/aidt-v2-human-acceptance.md#L352) | “旧网络HEAD复现SSLverify19：restore漏3项可信CA且覆盖NO_PROXY”，随后修后404 | 引用摘要时改为：“以**当前工具环境按旧转发规则重构**的无认证HEAD复现verify19；修正profile得到404。原run缺少保留cause，历史effective env digest未存，未直接确认原run根因。”现有机器/教学不通过、pending未结算的限定保留。 |
| [A1 README，第21–24行](../a1/s2-supplement-20261116/README.md#L21) | 已写Reconstructed与不回溯恢复原cause；第24行单独摘出“This reproduces the old launch CA compatibility defect”仍可能被压缩成原run根因证明 | 不是需要改写历史的反证；建议统一摘要为：“Reproduces the forwarding defect under the reconstructed current client environment; does not establish the failed run's retained low-level cause.”不能删除其下一句原有限定。 |
| [A5诊断，第15行](../../context-bridge-20261116/a5/s2-supplement-failure-diagnosis.md#L15) | 当时“total-source field needs the separate owner query” | 后续新增引用宜说明：“A1后续已实际读到两条total_source均为unknown，仍不是已知零用量。”原诊断是当时安全投影，不回改成当时已查询。 |
| [A1原始计量JSON，第154–157行](../a1/s2-supplement-20261116/native-failure-details-accounting.json#L154) | 汇总字段tokensTotal/tokensPrompt/tokensCompletion/debitedHundredths为0 | 这些是原始汇总，不删除。展示必须同时带第116–151行的`total_source:unknown`、prompt/completion null、pending及settled_at null；改用“记录总数占位0，用量未知，尚未结算”，不能摘成确定零消费/0费。 |
| [A1环境投影，第3、84–85行](../a1/s2-supplement-20261116/network-environment-contract.json#L3) | 明确是当前工具key presence/hash+committed forwarding contract；actualProcEnvironReadable=false，historicalSuccessfulStack04EnvDigestRecorded=false | 不能改称“已读取原失败进程实际完整env”或“已证明与历史成功环境相同”。当前hash不能补造历史hash。 |

以上行号为本次读取时的位置，链接仅定位原文件，不触碰原人类签核、PDF或Library版本。

## 证据层级互校

1. **原失败运行。** [A1 README:13](../a1/s2-supplement-20261116/README.md#L13)、[A5诊断:10–20](../../context-bridge-20261116/a5/s2-supplement-failure-diagnosis.md#L10)：原安全日志只有ConnectionError类/文本，cause/status/errno未保留在这些投影中。`tool_choice`字样也不证明参数错误或模型能力不支持。`domain/agent-run/model-call-failure-reason.ts`把native run error归入`provider_rejected`；此闭码不是供应商HTTP拒绝回执。
2. **真实来源与native提交。** [A2 actual-failed-run报告](../a2/s2-supplement-audit-20261116/actual-failed-run-report.json)：canonical428d、S2 f434、S1V2/S2V5及block/snapshot均匹配；新local/remote与旧记录分离、0resume；journal14:20:48.750为message-dispatch-observed，14:20:50.442随后failed。`supplierConsumptionProvenByAudit:false`仍成立。事件中的`AIDT_CONTEXT_UNAVAILABLE`是封闭fallback，不单独证明权限或来源丢失。
3. **源码与当前环境。** `scripts/lib/aidt-checkpoint-network-env.mjs:5–14`现在按白名单保留CA、proxy与NO_PROXY大小写，未由模型配置文件提供可信网络参数。旧规则漏传CA/覆盖排除项是确定的源码契约缺陷；[环境投影](../a1/s2-supplement-20261116/network-environment-contract.json)不等于原进程实测，更不含历史成功stack04的完整effective env摘要。
4. **两个后验HEAD。** [旧profile](../a1/s2-supplement-20261116/one-head-old-network-contract.json)是14:31:03的无认证、无正文、retry0、timeout5s、TLS verify/trust_env开启的单次非模型HEAD，观察到ConnectError→SSLCertVerificationError/errno1/verify19；[修正profile](../a1/s2-supplement-20261116/one-head-fixed-network-contract.json)在14:35:05相同约束下收到HTTP404。它证明当前请求已获得TLS/HTTP响应，不证明认证、model endpoint、completion、额度或Agent教学成功。修正profile同时保留了CA与排除项，不能仅凭此组合对照将唯一因子锁定到某一个变量，更不能反推历史cause。
5. **当前计量。** [A1原始计量](../a1/s2-supplement-20261116/native-failure-details-accounting.json)与[A2 README:38–44](../a2/s2-supplement-audit-20261116/README.md#L38)一致：一个native任务内2个physical starts、2条failed usage；两条total_source均unknown，prompt/completion均null。两笔credit request pending，reserved为3412与5217 hundredths；held与remainingHeld各8629，**不是相加为17258的最终账单**。settled_at/debited均无已结算证据，allCreditSettled/noOutstanding均false。两个starts也不能仅凭计数判为SDK自动重试。
6. **恢复与清理。** A1已保留包含新failed/pending状态和第三账的私有诊断备份，但它尚未实证restore且不是zero-outstanding检查点。旧两run检查点不包含本次失败。清理掉进程、容器与port lease不等于供应商/平台计量已结算，不得用旧检查点覆盖新失败或重置本次已用max1额度。

## 新增：本机真实TLS机制因果已证，历史原run因果仍未证

已实际读取A6的[受控本机机器记录](../a6/loopback-tls-machine.json)、[6/6日志](../a6/loopback-tls-green.txt)、[范围/清理计划](../a6/loopback-tls.plan.md)，并只读核其测试源码；没有由A3再次运行。JSON显式`historicalS2RootCauseProven:false`，不能删掉这项限定。

- 实际使用Python3.12.14/httpx0.28.1与OpenSSL3.5.7，临时独立CA签127.0.0.1 SAN证书。真实标准租约保护的loopback TLS listener，无外网、DB、模型、用户配置或凭据；不是MockTransport。
- 同一受控listener/临时证书：旧base-only child env没有SSL_CERT_FILE，真实证书校验失败，服务端HEAD计数保持0；新`restoreOwnerEnvironment`继承同一临时CA，在`verify=True/trust_env=True/retries=0`、timeout3秒下HEAD200，服务端恰1条无auth/cookie/body的HEAD。两个child均无外部proxy，默认localhost排除项不会在此制造外部代理路径差异。此对照验证了**省略/继承调用者CA足以造成/解决该受控证书错误**，不只是字符串包含式单测。
- 实际1个TLS对照加5个既有env测试共6/6、0skip；listener关闭、同port rebind、lease释放、临时CA/server私钥删除均记录成功。原QA cause-only采集误判的首红与修正后结果均保留，没用关闭TLS验证来取得绿。
- 该试验使用新生成的合成CA和新受控child，并非14:20失败进程/供应商模型请求。它加强了**继承缺陷的机制因果**，没有生成原run未保存的effective env digest或底层cause，不证明旧S2一定因该错误失败，也不证明供应商模型已恢复或86.29占款已结清。原失败/教学未过/预算占满状态不变。

A1独立分界意见与上述一致：本机临时CA机制回归及有界cause私有诊断纯测试可以零外网准备，但原S2仅ConnectionError无cause/status的历史证据缺口不因此消失；未来任何native复验需新task授权与独立预算，HEAD404不能清pending占款。A2随后已完成network-none的限定原备份取证，实际结果见下一节；仍未找到可直接归因原run的cause。

## 最终离线取证：结论冻结

已实际读取A2新目录的[README](../a2/zero-cost-followup/README.md)、[机器结论](../a2/zero-cost-followup/conclusion.json)、[debug安全投影](../a2/zero-cost-followup/debug-recorder-safe-projection.json)及[native安全投影](../a2/zero-cost-followup/native-safe-projection.json)。机器结论时间`2026-11-16T15:02:32.410017+00:00`，源dump为原14:33:36.845诊断备份，SHA与A1留存一致；不是新模型运行或恢复后的新故障。

- debug/error共得到53条关联元数据（52 HTTP+1 error），不是53次失败。与真实run/thread直接关联的错误trace及同trace HTTP行均无cause/SSL/errno/verify_code，外层只到`MODEL_CALL_FAILED`。HTTP行org_ref为空，不能写成每行自带租户归属；关联依据是直接错误记录与trace。
- 最后窄4张native表范围已收口：精确remote run状态error，其error字段只保留`APIConnectionError`；精确remote thread的`__error__`为41B msgpack，完整安全primitive遍历也只有该类，没有cause字段、errno、SSL verify code或opaque ExtType。没有使用pickle、JsonPlus构造、eval/exec。
- 精确run事件只看metadata：updates8、metadata1，没有error行；非error data未读，不能将无error行推为没发生错误。检查点关联只到精确remote thread+checkpoint ID；未读checkpoint正文或checkpoint_blobs，不声称已检查全部LangGraph内部内容。
- A2使用已缓存工具，network none/read-only/无挂载无端口，受限CPU/内存/pids；只解码SQL文本，未连接DB、未执行SQL或恢复备份。首轮工具stdin attachment错误与有效两轮退出0均保留，own containers最终0；没有外部请求、模型或财务写。`followupClosedWithoutMoreTables:true`，不再扩表。

**冻结的独立结论：CA继承缺陷在受控真实TLS机制中已证；原S2的直接历史底层原因仍不可直接证明。** 原run仅留`APIConnectionError`，无实际cause链或历史effective env/CAbundle fingerprint；后验HEAD19/404与本机TLS不能回填这项历史缺口。不能升级为“供应商拒绝”“确定没有收到”或“修后真实模型已通过”。原S2失败、无教学回复及学生后续保存、新登录未完成的结论保留。

最后已保存的财务状态也明确冻结为证据时点：细项14:31:55.872读取、14:33:36.845备份、14:38:14.476与当时live完整比对一致、14:40:26.196清理回执。2条failed physical/usage，unknown用量与pending两笔、预留86.29测试credits；没有最终结算/退款或供应商账单证据。清理完成不改变该保留状态，不能当作已结清，也不在无新授权下查询外部账单。

## 下一最小验证方案的独立评审

**上一版建议的最小离线取证已经实际完成，不再发HEAD或模型，也不继续扩大原备份检索。** A2的有限检索仍未找到同一physical request的底层cause，当前结论保持unknown；不把解码退出0写成模型成功或历史故障已修。

已有两次HEAD已达到其当前profile兼容性验证范围；新增受控loopback也已实际验证CA继承机制，无需重复这6项。再请求一次不能补回历史未记录的cause或env digest，没有必要为表面绿继续探测。

A5另已提供future-only的私有有界cause诊断源码与11/11离线unittest结果：精确闭集异常类、cause/context合计最多6节点、仅有界errno/SSL verify code/HTTP状态及UUID关联，不输出原始错误文本/URL/prompt；runtime只在原catch补私有投影，普通sink失败不替换原错误。A3已只读核源码和既有日志，未重跑；未运行完整旧pytest，也未在新真实native任务使用，不能据sourceReady追认历史cause。

如以后另行明确授权真实Agent复验，最小准备应先包括：

- 真实child启动时直接输出受约束的网络env存在性/摘要与source版本，而非仅由父工具环境重构；仅保留CA/proxy/排除项的存在与hash、CA文件可读性/摘要、TLS校验与trust_env、retries等，不导出私密值或端点。
- 失败投影按run/physical request关联，保留有界异常类、cause类、errno、SSL verify code、HTTP状态与时间；未知保持null，禁止原始URL、代理凭据、key、prompt、header、response body或完整traceback流入共享证据。
- 新计划明确如何保全最新failed/pending状态和三账，不能把旧zero-outstanding检查点当最新状态，不能手工释放hold或伪造usage/结算；当前耗尽的S2 max1不重置。
- 任何新的model请求都需新的明确额度/单任务窗口，不由此followup授权。先核实际新环境与正确canonical角色/pin/来源，再由一次真实native请求验证模型链；HEAD404、直接供应商连接或单元测试均不能代替。结算无确定回执时仍记pending/unknown并停止，不自动再发；无实际教学回复则仍不评价教学质量。

本页只是独立审阅与下一步边界，不执行上述新准备/资源/请求，不更改已签Skill或人类验收结果。
