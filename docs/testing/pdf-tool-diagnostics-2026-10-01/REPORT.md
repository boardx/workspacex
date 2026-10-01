# 标准文档工具失败诊断

关联 [#4873](https://github.com/boardx/workspacex/issues/4873)，线上PDF失败总问题 [#4869](https://github.com/boardx/workspacex/issues/4869)。

- [x] 区分执行标识不匹配、超时、取消、截断和非零退出；错误保持 no-replay 原语义。
- [x] Controller仅记录固定 event/reason，不记录原始异常、文件内容、路径、凭据或私人标识；未知/伪装敏感错误归 unknown。
- [x] 原鉴权拒绝、外部503与失败执行不自动重放保持，25项隔离测试、API类型检查与lint通过。
- [ ] PR CI和线上诊断复测。

这补全定位所需诊断，不证明线上失败根因。日志和报告不包含用户私人对话数据。
