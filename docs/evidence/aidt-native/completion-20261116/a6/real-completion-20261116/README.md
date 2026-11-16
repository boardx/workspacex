# 本次同组实证索引（2026-11-16）

以下只记录实际结果；人工验收结果与签字未填写。技术actor为已有测试余额的admin+自有组owner，普通学生资金/教学与课堂规模验收未获证明。全部材料为合成练习，没有真人访谈、测试或教师点评。

| 证据 | 实际结果与边界 |
| --- | --- |
| [S1机器](./s1-machine.json)、[完整安全附件](./completion-s1.json) | 真实1 passed；来源冻结/实际派发、学生重写主题保存V2/新登录通过。1physical/10065tokens/settled10.07测试credit。追问段3问，singleQuestionBehaviorPassed=false；实际基础role为echo测试夹具，不能称教学全通过。 |
| [S1内容复核](../../a3/real-completion-content-review.md)、[来源只读审计](../../a2/source-audit-20261116/s1-report.json)、[独立计量](../../a1/context-stack04-s1-accounting.json) | 分别核实际文案/旧S1V1未换headV2/供应商与结算，不用wire文字当消费。 |
| [S2中断机器](./s2-interrupted-machine.json)、[实际来源失败附件](./s2-native-turn-failure-aidt-empathize.json) | 唯一S2真实send，源S1V2/S2V4已派发，实际echo基础任务卡误解；没有批准/编辑，正常取消。1physical/8222tokens/8.23测试credit，旧预算仍占用。 |
| [S2错误基础指令](../../a1/context-stack04-s2-agent-base-instructions.json)、[取消与结算](../../a1/context-stack04-s2-cancelled-accounting.json) | 旧agentVersion/消息/快照/费用保留；不是阶段引导师成功。 |
| [零费两场机器](./free-deliverables-machine.json)、[原始2pass日志](./logs/free-deliverables-attempt-01.run.log) | 新Web ec5ff/API c361，2 passed/10.1秒，旧账与额外S1账前后hash不变。 |
| [人工fallback清单详情](./s2-manual-fallback-guide-pdf.json)、[实际PDF文件](./student-manual-interview-guide.pdf) | 学生写明AI未成功，人工修订保存V5与新登录；真实beforeprint DOM副本→Chromium PDF bytes/文本/字体/可读性。没有自动操作OS另存为，也不是AI采纳成功。 |
| [S6独立原件详情](./s6-independent-synthetic-test-original.json) | TXT+PNG真实UI上传/字节/SHA/来源/decode/保存/新登录，同org consultant非组员与错project404；独立组无假原型、快照或学习完成。 |
| [免费after独立核验](../../a1/context-stack04-free-deliverables-after.json) | 总physical/usage/credit仍各2（此前S1/S2），此次无新增，active/holds/unsettled/unbounded0。 |
| [QA准备计划](../real-completion-plan-20261116.md) | 同组S3–SUM及本次新2个Design任务未执行，不因用例可发现而写通过。 |

## 失败与预算不变量

[logs](./logs/)保留S1启动器No tests found、S2四次零native发送QA前置红、真正S2任务错误卡失败、最终零费两场绿。S2前置失败分别是上传201误期望202、Content-Type合法charset参数、已保存稿重复prepare、发现卡披露折叠后寻找隐藏控件；逐次A1真实run0/无新physical/旧账相同证明与显式continuation均保留，没有抹除phase或重发模型。

旧七次账本没有改为8；额外S1独立最多1账已用。S2错误任务取消仍计入旧额度，后续重验须新的明确授权，不挪用剩余阶段/SUM或Design名额。当前不再发收费请求。

## 范围

新S1实际机械成功与内容失败分开；S2模型任务未完成、免费人工fallback不是修复后的AI成功。S6仅材料入口独立实测，不是完整原型反馈链。原历史N08/N09、旧A5两原型、PG22/return7分别保留，不能拼成这次完整六步/报告已过。学生/教师/测试负责人签字一律由人类实际操作后填写。

## 后续零模型配置修复

当前测试实例已追加不可变canonical版本并切默认指针，旧版本与本页所有旧运行/费用保持；不是普通发布API验收，也不等于S2补测成功。见[修复记录](../../../context-bridge-20261116/a5/fixture-canonical-repair.md)及A1独立after；后续S2补测仍需新增一次额度，其余原有阶段与Design额度保留。
