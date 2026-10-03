来源正文与片段引用修复 #5142：最终集成生产 SHA 07542505c12b7491a7527babb900c5842175c678，独立 reviewer ACCEPT。依赖 #5130 的 53ccbbb2d3e21d1d5368b1861d5d8c94aba6f070，包含外部合入的 #5134 引用协议与 main 更新；本会话未合并 main。

TDD 5失败/6通过 → 11通过。最终研究单元9文件211测试通过，API typecheck退出0。完整研究回归37文件488测试全部通过（44.08s；隔离环境总45s、清理0s）。原先440通过/1超时及初始化超时是历史失败，保留其记录，最新回归已覆盖持久化测试。命令：pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research。原始日志 /private/tmp/research-5170-final-research-suite.log、research-5170-final-unit.log、research-5170-final-typecheck.log。

真实公开来源 qwen3.7-plus 筛选：接受1来源，3调用113846ms，14个合法块内引用；两批输入 quoteOptions 共45510字符。结果 contentCharacters=125 是保留的搜索片段长度，不是模型所读正文长度。首调用返回schema envelope，第二调用整批修复成功，第三调用处理后半正文。目录 /private/tmp/research-5170-source-screen-real-final/。

语义检查 FAIL：保存的问题前提把 WCAG 2.4.11 与2.4.13错置，模型仍将真实2.4.13引文标为错误2.4.11问题的直接证据，且混淆1.4.3/1.4.11。引用合法不等于问题回答正确。仅诊断的前提纠正提示实验仍失败（3调用113972ms），未部署该提示。目录 /private/tmp/research-5170-source-premise-experiment/。不能宣称报告质量或整体速度PASS。早先两次provider失败亦保留，不推断唯一原因。

Draft PR #5170 需同步当前提交、改依赖至 #5130 并刷新CI；当前源码验证与语义限制已明确。下一项 #5179：无证据章节跳过写作，结论仅接收质量审核通过的正文。#5056仍未整体验收。

#5130已外部合入main78c51ddbe0332b54df2dbf53f386da7e4280d137。最新同步生产dfc065e6fbeb70c16184812b9de58993da5e7afd独立ACCEPT：相对7b研究代码/测试无差异，仅保留共享引用schema既有导出。main为祖先；新211unit/typecheck通过。PR改base main，CI重新验收；仍Draft/整体语义FAIL。
