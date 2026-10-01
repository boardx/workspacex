# 所选角色与个人记忆边界

关联 [#4868](https://github.com/boardx/workspacex/issues/4868)。用户实际选中产品经理，却在问候/能力介绍及 PDF 分析中被个人佛学画像带偏。

读取链路确认：固定版本 instructions 经 PG claim、execute-run、deep-agent provider system message 传递。未证实角色传递丢失；已有个人画像每轮进入历史，角色职责过短且缺边界。本修复是提示上下文约束，不能代替真实模型验收。

- [x] 生产 execute-run 追加当前职责/记忆边界；不覆盖固定版本正文、不修改角色包与快照。
- [x] 召回材料标明用户背景不得重定义角色或擅自改变附件分析主题，保持引用、三态、降级和单行防伪造格式。
- [x] 49 项 executor/model provider/recall/remember 回归通过；类型检查通过。
- [ ] PR CI 与真实模型验收：同一有佛学画像账号选择产品经理，问候、能力介绍、通用 PDF 分析、明确要求佛学关联的 PDF 分析分别验证。

测试新增断言验证实际 executor 传给模型端口的 system/user/history，保留原有个人记忆；没有伪造模型专业质量通过。首次回归 48/49（新增标题多一行破坏防伪造断言），保持同一行后最终 49/49；相关日志随报告。

线上语音/PDF工具失败另见 [#4869](https://github.com/boardx/workspacex/issues/4869)，本修复未部署。
