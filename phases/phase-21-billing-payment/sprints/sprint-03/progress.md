# Sprint 21/03 — 真实钱包与流水查询

2026-10-15：用户实测 /billing 三项暂未开放，继续原支付目标。F03 / issue #5729 已实现真实钱包、稳定游标账本、个人/组织归属隔离；共享DB与身份仓储抽为唯一模块供Kernel/Billing接线，不新增连接池或身份规则。

验证：F03.red.log 缺失源码的预期导入失败；初版query6项通过。第一次HTTP组合hook超时，日志F03.http-config.log保留；加诊断后独跑8项通过；最终组合9+15共24项通过（F03.http-config-recheck.log）。typecheck/lint成功；init快速健康检查成功，不等于全仓验证。正式harness、独立review、CI/main/部署仍待完成，不标passing或线上可用。

原目标尚未完成：充值、回调到账、Stripe购买及token消费仍需后续实现。计划见plans/F03.plan.md。

正式验证修正：全量API15134测试通过、两项失败（新增composition root超上限，后端内部cursor使用z.object）。已将纯持久化适配器模块放在infrastructure/identity，恢复原架构豁免集合；内部opaque cursor改普通严格validator，枚举仍复用契约，坏日期/UUID/额外字段负例加入既有测试。四文件35/35通过，类型/lint成功；新正式验证仍待执行。失败全日志F03.pre-architecture.verify.log保留。没有修改passing或放宽扫描规则。

F02已实际合入main c0dcbb150并部署；devapp/api/billing/config实测200、enabledProviders=[]，见F03.live-config.log，仅证明当前无有效启用渠道。当前分支已同步该main，F03 PR应直接base main。

高风险正式验证在专项9通过后，Web全量发现原main语音测试异步等待失败（937files通过/1失败）。确认失败后安全中止剩余API测试，实际exit143，不能标passing；F03.interrupted-release.log保留。独立修复PR #5746（#5745）保留全部断言并新增可编辑性检查，完整Web938files/8067tests通过、5skip，类型/lint通过，已合入本工作分支供正式复验，等待该PR CI/main合入。钱包PR #5744仍draft，独立源审ACCEPT fa5；现在准备新SHA正式verify，未完成支付链路。

215152fa8正式高风险门禁exit1：专项9、根harness2506、API15136及54项类型/lint通过；Web两处超时使整轮失败，F03仍in_progress。系统在Web运行期间13:03:19–13:06:40(+0800)温控休眠201秒，同期多用例约196秒；原样复跑失败两文件29项通过不抵消全量失败。证据F03.verify.log/F03.host-sleep.log。独立测试资源预算issue #5749将降低自有Web并发后复验，不修改超时/断言/测试范围。外部协调者已实际合入PR5744/5746至main，对应issue关闭，但正式passing未达成。


2026-10-15: Formal F03 verification at 152cae57a exited0 with command-scoped caffeinate -i and Web budget2. Standard verify:quick75/75tasks succeeded,54cached; API15142pass/12skip/2todo, Web8073pass/5skip, local-runtime250pass. Verifier generated passing and fingerprint30ab598aefe11c653a4e54ca4bbdcefcf0934047c337d299e4092356056fae6e. Previous thermal/idle sleep failures remain in separate archived logs. PR#5744 implementation is already main; evidence/status followup belongs to PR#5750, whose earlier strict-doctor failure required this actual verification. Deployed unauthenticated wallet and ledger now401 (routes/auth mounted), not evidence of authenticated UI or complete payment. Next original-goal work is actual WeChat Native order creation/query, then crediting/cashier/Stripe/token settlement.
