# A1 独立交叉审阅

审阅对象为 A2/A5 最新源码；未修改其文件、未重复运行其大套件，也没有供应商请求。本文件是只读审阅结论，不替代 A6 的真实 PG 或模型验收。

## 授权、事务与读取

A2 `accessIn` 使用传入的同一 `TenantSession`，按 project → organization → org membership → general membership → thread 取得锁，再复用真实 `resolveVisibility`/Identity 判定。后续 Stage repository 只重入同一项目与组织锁。A1 的 prepare/persist/revalidateAccepted 三方法未受 Guarded 接口变化影响。

store 正文返回真实 `Guarded`；scope 读口只返回授权定位元数据。执行先 `resolve` 完成当前权限与 ref 匹配，再 disclose，随后核对 immutable org/run/project/thread/message/作者以及 canonical hash。replay 重验旧 focus 与准确来源修订，不读新 head 或活动 mount。

审阅提出的两处小守卫已由 A2 实现：纯计算返回后检查总 prepare deadline；冻结 focus 回读显式核对 versionId。A5 已将精确单 focus 作为执行校验，防意外重新并入全目录，并更新真实 guard 测试夹具。

## 实际序列化与回执

Deep adapter 核对实际已序列化 messages 的 reference slot/hash/128KiB 上限，随后在 dispatch 前重验权限；仅成功 2xx 且拿到真实 remote run ID 后记录 message-dispatch observation。它不能证明每次供应商内部子调用都消费了材料。

两条 resume 路径使用 command，不重发 messages。journal 通过既有首派发事件关联 checkpoint 恢复；不伪造本 attempt 的新消息派发时间。Configured adapter 实际消息固定 system 第 0 位，因此 reference offset=1 成立；该路径只声称 assembled。

附件组装是等长 map；无附件的 synthetic reference 内容不变、slot 不移。它不带伪造 messageId，所以不会假借已有历史消息来源。formatter 预留 1KiB native envelope，transport 仍验证带真实 id 后的最终大小。日志失败不导致远端请求重发；缺失的回执仍按 unknown/已有事实处理。

未发现新增阻塞。实际教学回答、付费计量和供应商消费仍需各自授权的真实验收。
